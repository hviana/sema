# Ingestion benchmarks

`ingest-bench.mjs` — instrumented ingestion benchmark. Ingests synthetic
(context, continuation) pairs shaped like real training corpora (word-salad
sentences, ~15% repeated short continuations) through `CachedIngest`, exactly as
`example/train_base/` does, and reports:

- per-batch throughput (pairs/s), node count, RSS/heap — the degradation curve;
- a per-phase wall-clock breakdown (store methods wrapped with timers), per
  batch and total — attributes cost to HNSW upserts, SQLite probes, commits,
  contain appends, halo pours, etc.

```sh
node bench/ingest-bench.mjs [pairs] [dbPath|mem]
# env: BATCH=500 D=1024 VEC_MB=256 SEED=42 CSV=out.csv
```

Run it against `mem` (fresh, in-memory), a fresh file path (fresh, on-disk), or
a copy of a trained store (at-scale cost). Change `SEED` to generate a different
corpus (e.g. when re-using a store a previous run already ingested into).

## Findings (2026-07-16, part 2): HNSW → partitioned IVF index

The remaining dominant ingest cost after the WAL/cache fixes was the HNSW graph
insert itself (~40% of wall at scale, O(log N) beam search with dozens of random
storage reads per vector). Replaced wholesale by `src/rabitq-ivf`: an adaptive
partitioned (IVF) index over the same 1-bit RaBitQ codes — insert = one RAM
pivot scan + a chunk append (flat in N), query = bounded nprobe cluster scans,
deterministic median splits, no RNG. Legacy HNSW code removed; `.vec` files are
format `ivf1` (old files must be rebuilt via `repairContentIndex`).

Same 20k-pair benchmark, same machine: **76.8 → 164.8 pairs/s (2.1×)**, with
`_vecContentUpsert` down from 44.6% → 14.2% of wall and RSS roughly halved. All
310 tests pass (303 behavioral + 7 IVF-layer tests in `test/35-ivf.test.mjs`).

Review round (profiled at 400k–3M codes, D=1024): two-level routing
(super-groups of 64 pivots — flat O(K) pivot scans were 33% of bulk-load CPU and
growing with N), single-probe `upsert` (the vmap point probe was the largest
insert term), sampled majority pivots (25% → ~11%), batched vmap rewrites on
split, honest `reads` gating (clean-chunk retention now requires a cache
budget), int32 ext guard. Standalone index: **500k codes at D=1024 in 6.4 s
(~79k inserts/s, 2.15× the v1 IVF)**; at 3M codes / K=1058 insert windows hold
~103k/s and reads/query stays bounded (~500).

Known next bottleneck (200k-pair run, 2.9M nodes): `putBranch` — the main DAG's
content-addressed dedup probes — is now 38.7% of ingest wall and the dominant
degrading term; the vector index is ~10%.

## Findings (2026-07-16, part 3): negative dedup Bloom filter

Added a persistent Bloom filter over `node.h` (store-sqlite): dedup probes that
would MISS (novel content about to be minted) are answered in RAM instead of an
`idx_node_h` descent. Crash-safe by construction — the filter sees every insert
synchronously, persists with a coverage watermark at checkpoint/close, and tops
up from the table after an unclean exit (a false negative would silently break
hash-consing; `test/36-bloom.test.mjs` pins live/clean-close/crash dedup with a
real subprocess crash).

Measured honestly: on THIS benchmark's synthetic corpus (300-word vocabulary,
heavily repeated windows) the filter absorbs ~36 SQLite probes per pair
(`store.bloomSkips`) but wall-clock is parity through 2.1M nodes — at that scale
the h-index is still page-cache-resident, so each skipped probe was only ~2 µs,
and most probes are HITS (repeated content), which no negative filter can skip.
20k fresh-store bench: 164.8 → 179.1 pairs/s (+9%, misses dominate while the
store is young). The filter's payoff case is miss-heavy novel corpora (real
multilingual training data) and stores whose h-index outgrows the page cache; it
costs ~2 bytes/node of RAM and nothing measurable in CPU, so it stays. The
residual `putBranch` cost is hit-probes on repeated content past the bounded
dedup cache — that is storage-floor work (raise `dedupCacheMax`/`sqliteCacheMb`
to trade RAM for it).

## Findings (2026-07-16, part 1, 7.5M-node trained store — HNSW era)

Baseline at scale was 28.7 pairs/s vs ~105 on a fresh store. Two systemic
causes, both fixed:

1. **WAL autocheckpoint thrash** — all three SQLite files use 1 KiB pages, so
   SQLite's default `wal_autocheckpoint = 1000` pages meant a synchronous
   checkpoint (~1 MiB of WAL) on nearly every batch commit: random writes into
   GB-scale files, hot B-tree pages copied out per commit instead of coalescing
   in the WAL. Measured 114 ms per commit (~19% of ingest wall). Fixed with
   `wal_autocheckpoint = 65536` (64 MiB) on the main store and both vector
   databases.
2. **Uncached main DAG database** — `sema.sqlite` ran on SQLite's ~2 MiB default
   page cache while serving millions of content-addressed point probes
   (findLeaf/findBranch/kid/contain). New `StoreConfig.sqliteCacheMb` knob
   (default 64; `SQLITE_CACHE_MB` env in train_base, default 256).

Result: ~46 pairs/s at 7.5M nodes (+60%). Remaining cost is dominated by the
HNSW graph insert itself (~40%, grows O(log N) — inherent) and SQLite point
probes on the mint path.

---

# Inference profiling

`profile-inference.mjs` — attributes one inference call's cost across the whole
stack using the work meter (`src/meter.ts`, AGENTS §2.14). Deterministic
counters (diff them between runs to catch a work regression) plus nested,
inclusive phase timings and per-phase counter deltas.

```sh
node bench/profile-inference.mjs [n]     # n = probes to run
```

Profile WITHOUT a rationale attached: a trace bypasses the per-response memos
(AGENTS §2.11) and measures a different machine.

## Findings (2026-07-24): where a refusing query's time goes

On the 17.9M-node / 325K-context trained store, ANSWERING queries cost 107–172
ms; essentially all remaining cost is the REFUSAL path, and it is accounted for
rather than mysterious:

- **`recall.exhaustiveResonate` ~570 ms, ~45% of inference.** Entirely the
  `exhaustive` whole-index probe, not the widened `k` — measured: k=571
  exhaustive 632 ms, k=24 exhaustive 536 ms, k=571 NON-exhaustive **12 ms**.
  Load-bearing: over an 18-query battery the substitution bridge produced a
  winner 4 times and ALL FOUR came from this proposal channel; the anchor-climb
  channel won nothing alone. Reordering the channels would pay the climb, fail,
  and pay this anyway.
- **`climb.crossRegion` (junction ascent) ~200 ms/query.** 64 walks burning
  ~2035 of their 2284-pop (√N·W) budget each. Giving it `edgeAncestors`'
  lateral-cone limit would cut ~85% of the pops but TWO OF THE FOUR walks that
  actually found a container had lateral spread past 1425, far beyond √N — half
  the successful junctions would be lost. Refuted; see `junction.ts`.
- Byte volume is 92% `substitutionBridge` + `climb.crossRegion`, both now
  bounded by the derived phrase-scale cap (`|query|·W`).
- `confluence.run` issues ~78% of all leaf lookups (~22K/query) via `windowsOf`
  over ranked anchors, but costs only ~60 ms — dramatic in counters, cheap in
  time. A scaling watch-item if anchor length grows, not a current cost. (Having
  both counters and times is what separates these.)

## Findings (2026-07-24): the capability battery is mostly a CORPUS gap

`analyze_training.ts` reports "26.2% of probes weak or empty" and flags
translation / generalization / multi-hop as weak areas. Classifying every empty
probe — does a TRAINED, FOLLOWABLE pair exist that could answer it? — shows most
of that verdict is the engine being honest, not failing:

| probe                                                        | verdict                                                                         |
| :----------------------------------------------------------- | :------------------------------------------------------------------------------ |
| B "Quelle est la capitale de la France?"                     | CORPUS GAP — no French capital fact of any kind is trained                      |
| C thank-you→merci, water→Wasser, obrigado→EN                 | CORPUS GAP — no such translation pair exists                                    |
| F "Water is made of hydrogen and"                            | CORPUS GAP — no water-composition pair resolves                                 |
| G "If a week has 7 days…"                                    | CORPUS GAP — no days-in-a-week pair resolves                                    |
| D "Can you write a short poem?"                              | CORPUS GAP — generative request, nothing trained                                |
| A "What is photosynthesis?"                                  | ENGINE GAP — `What is the process of photosynthesis?` is trained and followable |
| F "Which city is France's seat of government?"               | ENGINE GAP — the France capital pair is trained                                 |
| F "Tell me the name of the biggest planet orbiting our sun." | ENGINE GAP — the largest-planet pair is trained                                 |

**Silence is the correct output for the corpus gaps** — section C can never
exceed 25% on this store however the engine changes. Beware one trap when
checking this by hand: raw SQL on the `node` table shows these facts with
`in=0 out=0`, which looks like "nothing is connected". Those rows are the FLAT
content twins; the edges live on the deposit-shaped FOLD node (see
`canonResolve` in `primitives.ts`). Resolve through the engine, not the table.

The genuine engine gaps share one shape: reach across _content_ rewording
(phrase-scale deletion or synonym), which needs a judgement about whether an
omitted span is scaffolding or content — corpus-global structural IDF, the tool
confluence already prices commonality with. The bridge's existing safety comes
from requiring at least one corroborated substitution to anchor a match, and a
bare interior deletion has a real counterexample shape ("Is water wet?" vs "Is
_heavy_ water wet?"), so this is a design change, not a gate tweak.

## Fixed (2026-07-24): typographic identity reached the ladder's blind spot

`Who wrote Romeo and Juliet?` against the trained
`Who wrote "Romeo and
Juliet"?` — two inserted quote characters — returned
silence. The gist is a STRUCTURAL signature, so a mid-string insertion shifts
every fold boundary after it: the pair scored cos **0.377**, BELOW unrelated
neighbours like "Who wrote the opera Carmen??" (0.603), while `identityBar` was
0.969 and `reachThreshold` 0.875 — no gist-based tier could ever see it. Only
byte-exact alignment could, and the bridge refused it for producing zero
substitutions. Closed with a narrow zero-substitution IDENTITY admission (mutual
end-to-end coverage, ≤ W glue per side), disjoint from the prefix trap by the
candidate-surplus test. Battery: 73.8% → **76.2%**, section A 75% → 87.5%, still
**0 wrong answers**.

## Fixed (2026-07-24, part 2): reach across content rewording

The remaining engine gaps all had the shape "a trained, followable pair exists,
but the query words it differently". Closed by asking ONE question — "may these
two forms differ HERE without differing in what they SAY?" — and answering it
with machinery that already existed: the corpus-global
discriminative-vs-scaffolding reading (AGENTS §2.7), the same one confluence's
filler gate uses. No new threshold; the bar is `edgeAncestors` saturation (√N)
and half-dominance, both already derived.

Two readings had to be got right, and each was found by a WRONG ANSWER, not by
reasoning:

1. **`reachOf` is the wrong lens.** It maps both "saturated" and "reaches
   nothing" to Infinity — equivalent for IDF weighting, opposite here. A window
   reaching nothing is novel content. Using it answered `Is water wet?` with
   "No, heavy water is not wet."
2. **Sub-quantum tolerance is asymmetric.** Below W, byte OVERLAP is chance — a
   below-W DIFFERENCE is not. Allowing one window of query-side slack made
   `what is 2^10?` match the trained `what is 2+2?` ("^10" vs "+2") and answer
   "2+2 is 4.", outweighing cover's authoritative ALU result. The identity claim
   now requires `covered === query.length` exactly; only the STORED side may
   differ.

Also needed: a truthful `accounted` for the identity tier (a substituted bridge
accounts for nothing out of epistemic humility — an identity bridge substituted
nothing and genuinely explains the query), and `MechanismResult.complete`, by
which a mechanism declares its answer a finished trained continuation so
post-grounding does not extend it. Without the latter, the correct
photosynthesis grounding was pivoted forward four times into an unrelated
"Hello! How can I assist you today?" turn.

Battery: 76.2% → **78.6%**, section A 87.5% → **100%**, E held at 100%, still
**0 wrong answers**.

## Refuted (2026-07-24): order-free "discriminative content set" reach

The obvious principled answer to _content_ rewording (as opposed to the
typographic rewording the identity bridge closed) is to stop aligning bytes and
compare CONTENT SETS: split the query's windows into scaffolding and
discriminative by the corpus-global reading `explainedSpan` already uses, climb
each discriminative window with `edgeAncestors`, and require the candidate to
carry a dominating share of them. It is order-insensitive — exactly what
paraphrase needs — and reuses only existing machinery.

**Measured on the 17.9M-node / 325K-context store, it has no signal at all.**

W is **4 bytes**, so a "content window" is a four-byte fragment. The
discriminative windows of `Which city is France's seat of government?` are
`"nce'"`, `"'s s"`, `"f go"`, `"ernm"` — typography and morphology, not content.
Their top agreeing contexts (4 of 12 windows each) are an Eminem-styled
explanation of government bonds, an oil-price/trade-balance essay, and a
quantum-gravity paragraph.

The decisive number is the CONTROL. `What is the capital of France?` — which
answers correctly in 91 ms — has the **weakest** census in the battery: 3
discriminative windows, whose top agreeing contexts are a Morse-code-replying
tree and Michael Jordan's Hall of Fame induction. A working answer scores worse
on the proposed measure than a failing one, so the measure is noise.

Reading: the window climb is a LOCAL STRUCTURE device, not a content-scale
retrieval one. At N = 325K a 4-byte window either saturates (`roots = 0`) or
reaches an arbitrary handful of contexts. Content-scale reach is the GIST
geometry's job, and it works — for
`Tell me the name of the biggest planet
orbiting our sun.` the rank-1 resonance
neighbour at cos 0.6219 is exactly
`"What is the name of the largest planet in our solar system?"`. Retrieval is
not the gap there; the bridge's gates are.

## Findings (2026-07-24): multi-hop is corpus, multi-topic ORDER was a defect

Decomposing each failing probe into atomic hops and asking each bare separates
the two causes cleanly.

CORPUS (silence is correct — no reasoning closes these):

- G1 two-hop Eiffel: hop 2 (`capital of France`) answers in 91 ms; hop 1
  (`Where is the Eiffel Tower?`, `In which country…`, `The Eiffel Tower is in`)
  is silent in every phrasing. The chain has no first link.
- D2 turn 3: `Which is larger, Paris or Madrid?` and both population facts are
  all silent. The comparison has no operands.
- D3: generative poem request; out of scope by design.

INTELLIGENCE (the corpus has everything needed):

- **G2 multi-topic fusion — FIXED.**
  `"What is the capital of France? And what
   is 2 + 2?"` answered
  `"4The capital city of France is Paris."` Both pieces correct, order reversed.
  `fuseAttention` sorts pieces by query position, and every attention ROOT
  carries its own `start` — but `primary` was given `forest[0].start`, the FIRST
  root's position, which is primary's own source only by coincidence. The ALU
  result, whose evidence is the `"2 + 2"` span at the END of the query,
  inherited the France root's start of 0. primary is now placed by its own
  evidence (`accounted`, or the computed span when a pure computation prices
  `accounted` empty), resolved in `think()` where both readings are in hand.
  Now: `"The capital city of France is Paris.4"`. Pinned by test/57.
- G3 `If a week has 7 days, how many days are in 4 weeks?` is NOT a corpus gap,
  despite `How many days are in a week?` being silent: the premise is stated IN
  the query and `what is 7 * 4?` answers `28`. What is missing is quantity/unit
  composition — no operator is NAMED, so the ALU never sees a computation. No
  existing mechanism covers it. See the open-problem note below.

Not probed by the battery, and a live wrong answer:
`In which country is the Eiffel Tower?` →
`"Hello there. If you are looking for
Open Assistant, look no further."` A
greeting node voiced as a fact — the same class as the photosynthesis
corruption, on a path the grade sheet does not cover.

## Partial (2026-07-24): the Eiffel greeting leak — what was fixed, what was not

THE BUG (17.9M-node trained store, outside the graded battery):

    "In which country is the Eiffel Tower?"
      -> "Hello there. If you are looking for Open Assistant, look no further."

WHAT THE TRACE SHOWS (`inspectRationale`, a sink function — not `true`):

- recall refuses honestly: _"below reach threshold — nothing in the store
  relates to this query"_.
- cover then grounds the greeting at **density 0.054** — 2 of 37 query bytes.
- `thinGrounding` fires with exactly that verdict and DOES NOTHING; it only
  emits a trace step.

### Attempt 1 — make the honesty-density floor binding. REVERTED.

The bar already exists and is already derived (1/W, "honesty density"); making
it binding at `consider()` time looked like pure reuse. It fixed Eiffel and
broke three working answers:

    "wHaT iS tHe CaPiTaL oF fRaNcE"                    -> silence
    "What is the capital of France? And what is 2 + 2?" -> silence
    "The capital of France is"                          -> silence

REASON, and it is the load-bearing lesson: **`accounted` is not a coverage
measure.** Recall deliberately reports EMPTY `accounted` out of epistemic
humility — the same humility that makes a substituted bridge account for
nothing. A density floor over `accounted` therefore guts recall wholesale.
Adding `pre.computed` (the cost-ladder-vs-coverage correction used for the
fusion remainder and the fusion reading order) does not help: recall's spans are
not computed spans either.

A uniform density floor is still the right shape, but it must come AFTER making
each recall tier's `accounted` truthful — the same repair already done once for
the identity-bridge tier. That is per-tier work in recall.ts, not a one-line
gate.

### Attempt 2 — SHIPPED, but it does not fix this query.

At hub scale a recognised form shorter than one river window is chance, not
evidence — the same quantum floor `identityBar` prices and the bridge's
`attestedQ` applies. Enforced in `recognition.emit`, the single choke point
every pass (structural subtree, chunk sub-runs, canonical chains, edge trims)
emits through; scoped by the existing `atomsAreHubs` switch; whole-query spans
exempt. No new constant.

Measured effect on the query's sites:

    before:  "hi"  "the"  "Eiffel Tower"
    after:   "Eiffel Tower"

`"hi"` is the i=0 sub-run of the fold chunk `"hich"` in `"In w[hi]ch"` — the
coincidence the canonical pass's own comment already names. Removing it is
correct on its own terms and is pinned by test/58.

**It does not fix the greeting.** Cover still grounds at density 0.054 through a
2-byte span that does NOT come from `sites` at all — so the `"hi"` site was
never the causal path. Cover's `accounted` is a genuine coverage claim
(recognised, non-restating segs), so the next step is to find which 2-byte
recognised seg cover's derivation search is standing on, given that the only
surviving site is the 12-byte `"Eiffel Tower"` (which has no continuation edge,
only a halo).

STATUS: leak still open. Two dead ends closed with reasons, one real improvement
shipped, and the exact next probe identified.

### Method note

`git stash` is unsafe in this tree: iterations 5–7 are uncommitted, so a stash
rewinds past all of them and leaves the working set inconsistent (observed:
`reasoning.ts` reverted to a pre-iteration-5 shape that no longer compiled
against the current `match.ts`). Use a file copy to A/B a single change.

---

# Sema vs Gemma — 3-arm fair benchmark (`bench/sema-vs-gemma.mjs`)

Covers `hviana/sema#5`. Compares Sema (non-parametric, VSA + Merkle DAG) against Gemma
(parametric transformer) without contamination, without fine-tuning, without local GPU.

## Why a direct comparison is invalid

- **Contamination.** Public benchmarks (MMLU, HELM, HumanEval) are in Gemma's
  training data. Closed-book accuracy then measures memory, not reasoning
  (SeedRG arXiv 2605.08838: 50%+ leakage, ConTAM arXiv 2411.03923: contamination
  underestimated; `longest contaminated substring` n=8, min_count=1 is the most
  sensitive metric; larger models exploit leakage more).
- **Interference.** Ingesting new facts on top of the trained store (`sema.sqlite`
  6.4G + `sema.content.vec` 2.4G + `sema.halo.vec` 752M) shares DAG structure;
  recall may use neighbouring nodes, not the newly ingested fact.

## Method (SeedRG + ConTAM style)

- `D_relex` — type-constrained relexicalization of real relations: novel
  high-entropy surface, preserved relational structure (3 demos + 1 held-out per
  group). Validated by no-context leakage check (Gemma without `D_relex` must
  fail) and n-gram 8 longest-match. Not generic synthetic.
- `Arm A` — `Sema-empty` (`:memory:`) + `D_relex` — pure reasoning.
- `Arm B` — `Sema-fork` (`cp sema.sqlite -> sema-bench.sqlite` + `.vec` files,
  `commit()` after ingest, watermark `maxNodeId` pre-ingest; `PASS` only when
  answer node or rationale node is `> watermark`) — `B - A` quantifies background
  bias (scaffolding vs crutch). This profile stays
  `meta/muse-spark-1.2-contributor`; Gemma is code-only via `fetch`.
- `Arm C` — `Gemma via OpenRouter` (`google/gemma-3-4b-it` — smallest Gemma
  available on OpenRouter, 131K ctx, temperature 0, same `D_relex` as in-context)
  — zero fine-tuning, API cost only. Determinism is `10x` on Sema (byte-identical).

All new thresholds are formulas in `geometry.ts` (derived from D/W/N), never
hand-picked. No `Math.random`/`Date.now` on behavioural paths. Bounded reads via
`hubBound = sqrt(N)`.

## Findings (dry-run, typed templates)

Arm A on nonce templates is `COVER`-heavy for long questions and `EMPTY` for
unseen surfaces; after fixing `ingestPairs` to include the held-out fact
(`[...demos, heldOut]`), Arm A PASS rises to ~75% on the nonce capital template
because the query is now in-store recall, not cross-form generalization.
Arm B's `cover` answers like `"The performer of What is Melinda Marx."` reveal
that on the 17.9M-node fork the resonant neighbourhood drowns short novel facts;
`prefix` queries (`"The capital of X is"`) still recall. The harness correctly
downgrades those to `WEAK` via the watermark filter, so `B - A` is the honest
bias signal (currently negative — the background hurts, not helps — on these
templates). See the report's `Bias delta` line.

This is the baseline the comparison will be judged against: `A` measures reasoning
on a novel surface, `B - A` measures interference, `C` measures parametric
in-context use of the same surface. Increase `--n` and run with
`OPENROUTER_API_KEY` for statistical power.

## Usage

```sh
node bench/sema-vs-gemma.mjs --help
OPENROUTER_API_KEY=sk-or-... node bench/sema-vs-gemma.mjs --n 50 --verbose
node bench/sema-vs-gemma.mjs --dry-run --n 12          # no API calls, Gemma mocked
node bench/sema-vs-gemma.mjs --keep-fork --n 4         # retain sema-bench.* for inspection
```
