# AGENTS.md — the Sema development manual

The working manual for anyone (human or AI agent) changing Sema. It is organized
around the **engineering patterns the codebase runs on**: what each pattern is,
where it is applied, how to follow it, and what breaks if you don't. You should
be able to develop against this document alone; read
[HOW_IT_WORKS.md](HOW_IT_WORKS.md) only when you need the theory behind a
pattern, not to get work done.

---

## 1. Orientation

Sema is a deterministic reasoning engine with no ML runtime: a content-addressed
graph store (the knowledge), two approximate vector indexes over it (the search
accelerators), and a cost-based search that composes answers from stored facts
(the inference). Everything is plain TypeScript, CPU-only, with `node:sqlite` as
the only runtime dependency of the library.

```bash
npm install        # dev tooling + the parquet reader used by one example
npm run build      # tsc → dist/
npm test           # tsc && node --test test/**/*.test.mjs
npm run demo       # example/demo.ts — the four-note README demo
```

Hard facts you must not fight:

- **Node ≥ 22.5** (`node:sqlite`). No native add-ons. If you want a GPU, you are
  working against the architecture.
- **ES modules with explicit `.js` extensions** in imports. Keep the convention
  in new files.
- **Determinism is the product.** Same seed + same deposit order + same query ⇒
  byte-identical answer. Tests pin it.
- **Perception is a pure function of the bytes**, and the deposit and inference
  paths must compute the same tree for the same input (2.15). Anything that
  makes one side impose structure the other does not is a correctness bug, not a
  tuning choice.

The mental model, top to bottom:

```
mind/pipeline.ts     the grounding decider: mechanisms compete on one cost scale
mind/mechanisms/*    cover · cast · confluence · extraction · reference ·
                     recall · alu
mind/*               shared machinery: match/project, attention, recognition,
                     junction ascent, graph search, learning, rationale;
                     recall's refusal-path tiers (bridge, prefix-completion,
                     frame-filler) live beside them, not inside recall.ts
store.ts             AbstractStore: ALL domain logic of the DAG store
store-sqlite.ts      the one concrete backend (thin SQL wrappers)
geometry.ts + vec/alphabet/sema/canon
                     vectors, the fold (content-defined cuts + two-ended
                     seats), every derived threshold, and the injected
                     content canonicalizer
derive/ · alu/ · rabitq-ivf/
                     firewalled sublibraries with their own READMEs and tests
```

Lower layers never import higher ones. The three sublibraries import nothing
from the rest of Sema (the ALU may use `../bytes.ts` only); Sema reaches them
through narrow interfaces (`DeductionSystem`, `PipelineMechanism`,
`VectorDatabase`). A change that makes a sublibrary import mind code is
architecturally wrong, full stop.

---

## 2. The patterns

Each subsection: what the pattern is → where it is applied → how to follow it.

### 2.1 Determinism as a contract

No `Math.random`, no `Date.now` in behaviour, no iteration over unordered
collections where order can reach output. All randomness flows from the config
`seed` (alphabet, keyring, index PRNGs). Every tie-break bottoms out in a fixed,
corpus-determined ordering — insertion order or lowest node id, with
**first-inserted** as the universal no-evidence fallback (last-inserted was once
used in one place; it was a bug).

_Follow it:_ when you introduce any choice among equals, pick the tie-break
explicitly and make it corpus-determined. If a test becomes flaky, you broke
this contract, not the test.

### 2.2 Derived thresholds — never tuned

Every similarity/decision threshold is a **formula** over the vector dimension
D, the perception window W, or the corpus size N, defined once in
`src/geometry.ts` (`mergeThreshold`, `identityBar`, `reachThreshold`,
`significanceBar`, `estimatorNoise`, `conceptThreshold`, `consensusFloor`,
`dominates`, …), with the corpus-scale readings beside them in
`mind/traverse.ts` (`corpusN`, `hubBound`, `hubCap`, `atomReach`, `atomIsHub`).
`src/config.ts` holds **capacities and budgets only** (cache byte budgets, batch
sizes, vector-index parameters, query k, ALU precision, the seed).

_Follow it:_ if you are about to add a tunable cutoff to config, derive it in
`geometry.ts` instead. A threshold knob is a design bug here — one was already
removed once. When a decision needs a scale, express it in D, W, or N.

Two derivations bite in practice and are worth knowing before you reach for a
bar:

- `identityBar(D, W, len)` is the SCALE-AWARE identity claim (`1 − W/len`,
  floored at `mergeThreshold`). Reuse `mergeThreshold` for a whole-span claim
  and long spans silently tolerate whole windows of foreign content.
- A bar calibrated for one quantity does not transfer to another. `chooseNext`
  carries a comment recording exactly this: the consensus floor is priced for
  pooled, N-scaled climb votes, and gating an N-invariant support count against
  it fails once N is large enough (test/40 pins it).

### 2.3 Exact decides, approximate proposes

Every score from the vector indexes (`resonate`, `resonateHalo`) is a RaBitQ
_estimate_. Identity is decided only by content-addressed lookup (`resolve`,
`findLeaf`, `findBranch`, and the canonical fallback `canonResolve`), never by
`score >= threshold`. Scores rank candidates and gate broad regions; bytes make
decisions. Even the echo decision in `recall.ts` re-folds the top hit's bytes
rather than trusting the estimate it already has.

The same principle appears as **graded evidence ladders** — exact tier first,
distributional second, geometric last — in five places built on one shape:

- `resolve` in `mind/primitives.ts`: exact content-addressed fold →
  `canonResolve` (equivalence class, hash-then-verify).
- `locate` in `mind/match.ts`: exact bytes → halo role → gist.
- `alignGraded` in `mind/match.ts`: literal W-gram runs → halo-matched sites
  (the weave adds a third pass from the climb's own proposals — see
  `pipeline-mechanism.ts`).
- `bridge` in `mind/resonance.ts`: junction containers by identity → edge
  junctions → synonym junctions → whole-gist resonance as last resort.
- `crossRegionVotes` in `mind/attention.ts`: exact containers → single synonym →
  double synonym → `structuralResonance` (a synthetic gist; the one tier with no
  byte containment behind it, and gated hardest because of it).

_Follow it:_ never reorder a ladder's tiers, and never let an approximate tier
override an exact one. Two asymmetries in `attention.ts` encode that rule and
must not be flattened: only the EXACT tier may explain ordinary votes away, and
only container-backed evidence may consume its endpoints. If you need a new
matcher, add a tier to the shared family (2.5), not a private score check.

### 2.4 One cost currency

The graph search's cost ladder (`mind/graph-search.ts`, exported constants) is
the single pricing scheme of the whole mind:

```
MICRO (1e-3)  advance over recognised material; per-byte unit of the A* heuristic;
              a RECOMPOSED form's onward edge
STEP  (1)     follow one learned edge (EVERY hop, first or fifth); one computed
              result; one projection
CONCEPT (10)  a halo-mediated act (synonym hop, consensus climb); also the price
              of ABANDONING an edge chain early (graph-search's stop-here rule)
PASS  (1000/byte)  carry a byte nothing explains
```

Only the _ordering_ matters. The pipeline weighs whole mechanisms in the same
units: `weight = moves + PASS · unaccounted-bytes`, so a mechanism-level choice
and a byte-level choice are the same kind of decision. Weights are compared at
STEP resolution (`grade = ⌊w/STEP⌋`); at equal grade the candidate reporting
fewer `scaffolding` bytes wins, and only then does the mechanism list's order
decide.

Two pricings inside `graph-search.ts` are easy to "simplify" and are not free to
change: charging every edge hop STEP is what makes the lightest derivation the
SHORTEST chain (charging later hops nothing made every stopping depth tie), and
the stop-here rule at CONCEPT-above-chain-cost is what keeps a genuine fixpoint
preferable to giving up at the same depth.

_Follow it:_ place any new cost deliberately in the ordering; never make the A\*
heuristic exceed a real per-byte cost (admissibility breaks silently — answers
degrade, nothing errors). Never encode _policy_ as cost: "computation always
wins" is implemented by masking colliding sites in cover, not by pricing. Keep
policy in callers, the engine neutral.

### 2.5 One factored machinery: match → project, under a gate

`mind/match.ts` is the shared family every generalising mechanism configures:
matchers (`locate`, `alignRuns`, `alignGraded`, `alignAround`/`frameSlots`,
`bestHaloMate`, `haloSiblings`, `analogyStrength` and its structural tier
`sharedFrameStrength`, `spanHalo`, `spanSynonymStrength`), projections
(`follow`, `reverseContext`, `project`, `conceptHop`), the span-shape family
(`skillExemplar`, `isSpanShaped`, `containsSpan`), and the two STRUCTURAL gates
that are byte predicates rather than derived thresholds (`isSpanShaped`,
`carriesFillers`). `mind/traverse.ts` owns the graph readings (`edgeAncestors`,
`reachOf`, `chooseNext`/`chooseAmong`, `guidedFirst`, `leadsSomewhere`,
`allWindowsAreScaffolding`) and the corpus scale (`corpusN`, `hubBound`,
`hubCap`, `atomReach`).

_Follow it:_ before writing a new generalising mechanism, express it as a
(matcher, direction, gate) triple. If those already exist, the mechanism is a
configuration — write only the configuration. If it genuinely needs a new
matcher or projection, add it **to the shared family** with a derived gate
(2.2), never as a private helper. A mechanism file that re-implements locating,
aligning, edge-following to a fixpoint, predecessor-picking, or fan-out capping
is reintroducing duplication that was deliberately removed.

A shared analysis must not live inside a mechanism. If `pipeline-mechanism.ts`
(the shared contract and `Precomputed`) or a post-grounding stage has to import
_out of_ `mechanisms/`, the dependency is inverted and the market's decoupling
(2.6) is broken — deleting that mechanism would break the shared container. The
span-shape family (`isSpanShaped` / `containsSpan` / `skillExemplar`) was
exactly this and now lives in `match.ts`, where its two consumers can reach it
without knowing extraction exists.

The **frame reading** (`alignAround` / `contractGap` / `frameSlots` /
`carriesFillers`, plus `Precomputed.frames`) is the same story told at full
length, and it is worth reading as the worked example — including the way it was
got WRONG first. Sema is otherwise fully GROUND: nothing anywhere represents a
position whose occupant comes from the context rather than the corpus, so no
mechanism could tell "the corpus does not explain these bytes" (PASS, refuse)
from "these bytes occupy a place the corpus keeps open" (bind). Split along the
§2.5 triple the notion lands in three places, each at its own altitude:

- the **matcher** (`frameSlots`) REPORTS and does not judge: every place a
  pairing varies, contracted to its varying core, tagged
  substitution/insertion/deletion, plus how much the two share. It rejects
  nothing.
- the **gate** (`carriesFillers`) is the much stronger claim that a slot may be
  VOICED through, so it is deliberately not folded into the matcher: a consumer
  taking the matcher's answer as permission to voice would be making exactly the
  claim the licence withholds.
- the **inventory** (`Precomputed.frames`) elects no frame, because a slot is a
  property of a PAIRING, not of the query. Election is each consumer's own.

**The failure mode to learn from.** Four VOICING gates were first written
_inside_ `frameSlots` — the frame must dominate the query, each slot must reach
one window on both sides, an insertion or deletion disqualifies the pairing,
fillers must be pairwise distinct — and a fifth (a candidate-length floor) sat
in `frames`. Every one is a requirement for substituting and SPEAKING, not for
knowing where a pairing varies. With them in place the "shared" reading was
shaped like its only consumer: measured over four real pairings, three came back
as NOTHING, including a definite description standing where a proper noun stands
— the shape `frame-filler.ts` exists for. It compiled, every test passed, and
the abstraction was worthless to anyone else.

_The rule this yields:_ a shared analysis with exactly ONE consumer is unproven,
whatever its address. Before declaring machinery shared, run a second consumer's
real case through it and check the answer is not `null`. If every gate you wrote
happens to be one your own mechanism needs, they are not the matcher's gates.

Making a notion available is not the same as imposing it, and two mechanisms
deliberately do **not** consume this one: the substitution bridge (its
substitution asserts equivalence, and it grounds through its candidate's
continuation UNSUBSTITUTED, so admitting a slot-gap there voices the corpus's
filler for the asker's referent) and CAST (its frame gate is weave-local while a
slot is cohort-local — §2.7 again).

Related single-definition contracts (define once, import everywhere):

- `contentLevels` (`geometry.ts`) — the ONE boundary rule: where a stream
  segments and at what level. `contentBoundaries` is a projection of it, not a
  second copy; it used to carry its own rolling-hash loop, which is exactly how
  a write side and a read side drift apart without a type error.
- `canonical.ts` — the write/read contract for canonical segmentation
  (`canonicalWindows`, `chainReach`, `leafIdRun`, `leafIdPrefix`, `windowIds`).
  Learning writes through it; recognition, attention, confluence, the bridge and
  prefix-completion read through it. Changing one side means changing this file
  — drift between sides breaks canonical recognition with **no type error**.
- `junction.ts` — the content-addressed "which learnt whole contains these two
  forms?" ascent, shared by the bridge and cross-region attention, with its
  per-response `WalkCache` and once-per-candidate seed computation.
- `joinWithBridge` (`resonance.ts`) — the one out-of-search way to join two
  answer spans; it emits a `bridgeMiss` trace step on a bare join.
- `dismissedKnownContent` (`bridge.ts`) — the one IGNORED-KNOWN test ("does the
  unaccounted remainder contain a STORED window?"), shared by the substitution
  bridge's own acceptance and CAST's frame-tier comparison gate.
- `sharedReachMemo` (`traverse.ts`) — the one definition of the ancestor-reach
  memo's lifetime (session-scoped between writes, cold under a trace). There
  used to be two memos that never met.
- `guidedFirst` (`traverse.ts`) — the one answer-shaped "what does this lead
  to?" read (guided pick merged with the first-inserted fallback).
- `leadsSomewhere` (`traverse.ts`) — the one admission predicate for recognition
  sites (edge-or-halo, via existence probes).
- `isChunk` (`sema.ts`) — the one "children are all leaves" predicate.
- `twoEndedSeat` (`sema.ts`) — the one positional-coordinate algebra, shared by
  perception, `fold`, and every synthetic/canonical fold.

### 2.6 The mechanism market (the free-will architecture)

Every grounding mechanism — including the ALU and user extensions — implements
the same interface, `PipelineMechanism` (`mind/pipeline-mechanism.ts`): optional
`parse` (authoritative computed spans, collected before anything else), `floor`
(an admissible lower bound, or `null` when the mechanism structurally cannot
fire), and `run` (candidate answers). The decider in `mind/pipeline.ts`
(`think`) holds a plain list (`defaultMechanisms`: cover, cast, confluence,
extraction, reference, recall, plus the ALU and any user mechanisms) and never
branches on which mechanism it is holding.

Four constraints make the market honest — verify all four for anything you add:

1. **Decoupled.** Zero cross-imports between mechanism files. Adding one never
   touches another. No mechanism asks "did an extension already decide?" — it
   only asks "can I still beat the incumbent?".
2. **Declared competence.** Gates are binary structural preconditions checked
   inside `floor`/`run` (query length, anchor shape, weave existence), never
   learned scores — so the rationale states exactly why a mechanism abstained.
3. **Visible budget.** Every corpus-scale loop is capped at a named constant
   (`√N` via `hubBound`, `k = 2·recallQueryK`), enforced at the store level
   (2.8).
4. **Evidence travels.** Every candidate carries `accounted` (query spans its
   structural evidence explains), `moves` (its acts, priced on the ladder), and
   `unexplained` (a diagnostic label). Two optional fields let a mechanism state
   things only it can know: `scaffolding` (answer bytes lifted from spans
   nothing recognised — the equal-grade tie-break) and `complete` (this answer
   is a trained form's own continuation reached through an identity claim about
   the query, so post-grounding must not extend it). The decider honours both
   without ever asking which mechanism set them. It sees only weights.

Two disciplines inside the loop:

- **Admissible-floor pruning.** `floor` runs for every mechanism in list order,
  before any `run`; `run` fires only if the floor can still beat the incumbent
  (`worthRunning`). Cover runs first so a computed span's near-zero cost prunes
  everything after it through this same mechanism — not a special case.
- **Investment discipline.** `worthRunning` is also passed _into_ `floor`: a
  floor that would first-touch an expensive shared analysis (the climb, the
  weave) checks its cheapest possible bound against the incumbent _before_
  paying, and returns the uninvested bound when it already loses. Never compute
  a shared analysis just to discard it.

Evidence accounting rules that bite:

- **Read-out content is selectively accounted.** Extraction's located frames are
  always evidence; the span between them counts only when _both_ borders were
  located. An open-ended read is content-novel and is priced by exclusion
  (PASS/byte), like the cover's carried literals.
- **Reverse reading is not derivation.** A `reverseContext` projection produces
  bytes but explains nothing forward: `accounted = []`, weight ≈ PASS·|query|.
  It is the designated last resort by arithmetic, not by rule.
- **An act you PAID for is accounted.** The mirror of the rule above: the
  bridge's corroborated substitutions cost a CONCEPT each in `moves`, so leaving
  their spans unaccounted charges the same act twice — and the PASS-per-byte
  charge is far the larger (measured: a bridge matching 28 of 29 bytes declared
  the whole query unexplained and lost).
- `accounted` is a COST-LADDER quantity, not a coverage one. `cover.ts`
  deliberately leaves masked computed spans out of it so PASS-bridged bytes are
  still charged, so a fully-explained query can report `accounted: []`. The
  post-grounding fusion gate therefore reads `accounted ∪ pre.computed`, not
  `accounted` alone.
- `unexplained`, `narrowDecision`, and `thinGrounding` are **observational
  only** — they appear in the trace and never alter the decision.

### 2.7 Two measures of commonality — pick the right population

"Is this content discriminative?" has two formally independent answers, and
using the wrong one is a semantic bug the type system cannot catch:

- **Corpus-global** — reference set: all learned contexts. Tooling: `reachOf` +
  `dominates` (+ `corpusN`). Used by the climb's IDF weighting and confluence's
  filler/scaffolding gate. Answers "does this discriminate anything in the
  store?"
- **Weave-local** — reference set: the structures aligned with _this query_.
  Tooling: the `depth[]` array built in `computeWeave` + `MIN_WEAVE` +
  `dominates`. Used by CAST's frame gate and by the frame filler's constituency
  reading. Answers "does this discriminate among the structures this query
  activates?"

`depth[]` counts **distinct covering structures**, not accumulated alignment
weight: the frame test compares it against a COUNT of aligned points, so
accumulating weight there compares weight-mass against a cardinality. It reads
like a harmless refinement and inverts the frame verdict (measured: 29 of 42
bytes reading FRAME against 6 of 42, with nothing else changed).

_Follow it:_ when adding a gate on "shared vs. discriminative", write down which
population your question is about before choosing the tool. Substituting one for
the other in CAST misfires on reordered single-fact queries (test 17 pins this).

### 2.8 Bounded reads — the cap lives in the store

No per-query read may grow with the corpus. The cap is √N (`hubBound(ctx)`,
derived from `corpusN(ctx)` — the one definition of corpus size, floored at 2).
Crucially, the cap is enforced **at the store level**:

- LIMITed reads: `nextFirst`, `prevFirst`, `parentsFirst`, `containersSlice`. In
  an adapter these must be real `LIMIT ?` statements — never "materialise then
  slice". Reading `hubBound + 1` parents decides "hub or not" exactly.
- Existence probes: `hasNext`, `hasParents`, `hasContainers`, `hasHalo`,
  `prevCount` — indexed point probes that never decode vectors or unpack blobs.
  Use them for every "does this lead anywhere?" question instead of
  `next(id).length > 0`.
- Prefix-capped reads: `bytesPrefix(id, cap)` and `contentLen(id, cap)`. A
  candidate that exceeds the cap is rejected without reconstructing it — the
  weave, the junction walks and the bridge all read this way, and uncapped reads
  there cost seconds per query on a large store.
- `chainRun` climbs transparent scaffolding chains in one bounded read.
- The full materialising reads (`next`, `prev`, `parents`, `containers`) exist
  for maintenance and inspection only. Keep them off hot paths.

`edgeAncestors` is the reference consumer: it decides saturation from LIMITed
reads alone, by five named stops (predecessor fan-in, distinct-context limit,
parent fan-out, the cumulative **lateral-cone** bound, and **byte-atom**
commonality). The last two are the ones a new walk forgets. An atom carries no
kid/contain rows by construction, so its commonality is unmeasurable and must
not default to "maximally rare" — `atomReach`/`atomIsHub` are the honest floor.

_Follow it:_ any new fan-out walk uses `hubBound`/`hubCap` — do not invent a
second convention, and do not call `edgeSourceCount()` or
`Math.ceil(Math.sqrt(...))` inline.

### 2.9 Template-method store

`store.ts` (`AbstractStore`) owns **all** domain logic: exact dedup,
byte-verified near-dedup, lazy gist indexing and bridge promotion, halo
quantization and exact in-session accumulators, containment buffering, write
batching, LRU budgets, compaction cadence. `store-sqlite.ts` implements only the
abstract `_db*`/`_vec*` methods as thin statement wrappers.

_Follow it:_ a new backend subclasses `AbstractStore` and implements the
abstract methods — nothing else. If you find yourself re-implementing dedup or
indexing logic in an adapter, stop. Facts an adapter (and any store caller) must
respect:

- Branch ids are dense non-negative integers minted in order, never deleted.
  Single-byte leaves are **implicit negative ids** (−256…−1) with no DB row —
  id-iterating code must handle both ranges.
- Flat branches (all-leaf children) are stored as raw bytes with an empty kids
  blob as marker (`flatKidsBytes`/`flatBytesKids`).
- `bytes()`/`bytesPrefix()` return arrays **shared with caches — never mutate**;
  copy first.
- `contentLen(id, cap?)` reads a node's byte length; pass `cap` when exact
  length beyond a bound doesn't matter.
- The **canon index** (`canonAdd`/`canonFind`/`canonCount`/`eachContent`) is an
  OPTIONAL capability: a backend may omit all four, and resolution then simply
  has no equivalence fallback. The store never learns what the equivalence IS —
  the canonicalizer is injected by the caller and every candidate is verified by
  re-canonicalizing its bytes, so a hash collision costs a read, never a wrong
  id.
- Maintenance entry points (`compactContentIndex`, `repairContentIndex`,
  `Mind.buildCanonIndex`) are batch operations for checkpoints, never the hot
  path. `buildCanonIndex` is incremental — it remembers the last indexed id in
  store meta — and must be run under the SAME canonicalizer queries will carry.

### 2.10 The async/sync seam and pre-resolution

Perception, recognition, and the graph search are **synchronous**; anything
touching the ANN indexes is **async**. A synchronous consumer that needs
resonance uses _pre-resolution_: gather the async answers first (concept
siblings, connectors, ALU operand meanings), hand them in as maps
(`resolveConcepts`/`resolveConnectors` in `mechanisms/cover.ts` are the models).
Do not try to make the search async.

### 2.11 Per-response memoization

Asking never writes, which is the only reason per-response memos are sound.
`Precomputed` (`pipeline-mechanism.ts`) is the shared response-scoped container:
eager fields (recognition, computed spans, guide, the evidence-breadth constant
`k`) plus **lazily-cached methods** for expensive analyses (`attention()` — the
consensus climb, `weave()`, `resonance()` — the response's ONE top-k
content-index read, `frames()` — the frame/slot inventory,
`spanShapedOf`/`spanShapedAll`, `queryWindows`, `queryResolved`, `windowsOf`,
`reachMemo`) — each computed at most once, shared by mechanisms and
post-grounding stages, and never computed if nobody asks. The async ones are
cached **by promise**, so a second caller awaits the first computation rather
than starting another.

Mind-level memos (`climbMemo`, `recogniseMemo`, `perceiveMemo`, `canonMemo`,
`_resolvedSubtrees`, `_edgeChoice`, `_gistCache`) are created in
`beginResponse()` and torn down in `endResponse()` — a new memo must be added to
both. A conversation supplies its own maps for the first four, so they persist
across turns.

**Which memos a trace bypasses, and why the answer is "almost none".** Only
`_edgeChoice` (via `guidedNext`) and `sharedReachMemo` are trace-bypassed —
there, a memo hit would swallow a repeat's `disambiguate` step or black out
reach detail the trace serialises. `perceiveMemo`, `recogniseMemo` and
`climbMemo` are **always** consulted, tracing or not, and that is a correctness
contract rather than a speed choice: `recogniseImpl` walks the query tree
through `foldTree`, whose subtree-resolution fast path skips `visit` — and
therefore skips EMITTING SITES — for any subtree already cached. A second call
on identical bytes is not idempotent; it finds strictly fewer sites (observed:
31 → 5). Bypassing these under trace made every traced turn re-run recognition
at each of the many call sites that recognise the same query, each call more
incomplete than the last, measurably changing which mechanism grounded the
answer (test/42 pins this). Trace steps still fire on a cache hit, so a hit is
never silent.

_Follow it:_ an expensive analysis a new mechanism needs goes on `Precomputed`
as a lazy method, not inside the mechanism. Do not add a `if (!ctx.trace)` guard
to a memo without checking whether the memoised function is idempotent. And
still **never benchmark with a trace attached** — the two bypassed memos, plus
the trace's own allocation, measure a different machine.

### 2.12 Caches are budgets, not correctness

Every in-memory acceleration structure is a `BoundedMap` with a byte budget; a
miss re-derives from durable state. The degradation order is fixed: what is lost
under pressure is always speed or reach (a re-perception, a duplicate probe,
reduced resonance until repair), never identity, reconstruction, or a learned
relation.

The deposit-path caches (`_depositTrees`/`_depositLens` for folded segments,
`_internIds` for already-interned tree nodes, `_resolvedSubtrees` for resolved
ones) obey the same rule, with one extra obligation: `contentFoldIncremental`
reuses segments keyed on their **offsets**, which cannot witness that the
underlying bytes agree. The caller must discharge that structurally — the
deposit cache is keyed by the prefix's own bytes, and a conversation's fold
advances only by append. A caller that cannot make the same argument passes no
`prev` at all; the cold path is always correct. Handing it a mismatched `prev`
produced a wrong tree on 336 of 400 random streams.

_Follow it:_ new caches get budgets and a re-derivation path. If memory grows,
look for something bypassing a budget — not for a leak in the DAG (nodes are
meant to accumulate).

### 2.13 Honest degradation, visible failure

Nothing degrades silently: counters (`danglingReads`, `compactFailures`), trace
steps (`bridgeMiss`, `narrowDecision`, `thinGrounding`, `skipMechanism` with the
reason it skipped, `anchorFallback`), the `echoed` flag on recall's last tier,
`recall-echo` provenance, and the per-region/per-anchor rejection reasons in the
climb's structured payload. Empty results are legitimate outputs (silence), not
errors — and several suites assert exactly that (5).

_Follow it:_ when your code can degrade, emit a counter or trace step. And mind
the classic trap: **empty bytes are truthy** — `Uint8Array(0)` passes
`if (answer)`; always test `.length`.

### 2.14 Measured, not guessed — the work meter

`src/meter.ts` is the one computational-usage accounting surface: a `Meter`
counts the WORK one inference call performs at every layer (store reads by kind
and by VOLUME, ANN queries and vectors scanned, perceptions, recognitions,
climbs and ancestor visits, alignment cells, chart pops, mechanism floors/runs)
and times named PHASES. Off by default and free when off;
`new Mind({ profile:
true })` attaches one per response and leaves a
`CostReport` on `mind.lastCost`. `bench/profile-inference.mjs` is the reference
harness.

It is the profiling counterpart of the rationale — the rationale says why an
answer was chosen, the meter says what it cost. Four contracts:

1. **Never read by inference.** A counter that reached a decision would end
   determinism (2.1). Write-only from the engine's side.
2. **Counts are the product; times are the hint.** Counters are deterministic,
   so two runs are diffable and a work regression is visible without a
   stopwatch. Only `elapsedMs` and the phase millisecond totals are not.
3. **Phases nest, and carry their own counter deltas.** `think` ⊃ `<mech>.run` ⊃
   `substitutionBridge` ⊃ `recall.exhaustiveResonate`. Inclusive, never summed —
   but each phase reports the work done inside it (`PhaseCost.counters`), which
   is what makes "which phase did those byte reads?" answerable at all.
4. **Count a logical operation once.** A recursive read (`bytesPrefix`
   descending a branch) is charged at the public entry point only — the private
   `_prefix` body is uncharged. Counting the recursion made one read of an
   N-byte branch report as N reads, so the counter measured tree size instead of
   read requests.
5. **Shared analyses are charged to themselves.** `attention`, `weave`,
   `spanShaped` and `substitutionBridge` bill their own phase, not the mechanism
   that happened to first-touch them — otherwise the profile blames whoever paid
   on everyone's behalf (it once read "cast.floor costs 2.9 s" when 2.7 s of
   that was the consensus climb).

_Follow it:_ a new layer that wants to be visible bumps a field in `meter.ts` —
never a private counter. (`danglingReads`/`compactFailures` in `store.ts` stay:
those are session-lifetime HEALTH counters, not per-response work.) Add the
counter to the report the same way, and remember the classic trap: **profile
without a trace attached** (2.11).

### 2.15 The fold contract: train and infer must agree

`perceiveDeposit` and `perceive` must produce the SAME tree for the same bytes.
That is not a nicety — it is what makes a trained context node and the node
`resolve(query)` reaches the same node. The deposit path therefore imposes
nothing: no boundaries, no turn convention, nothing read out of the bytes. When
the two sides disagreed, the alignment family went quadratic (measured: 5.2M
cells on a 476-byte context, against 0 when they agree) and cumulative contexts
stopped resolving to what they were trained as.

Three consequences you will meet:

- **Boundaries are a separate feature from reuse.** `contentFoldIncremental`
  (segment reuse, transparent, imposes nothing) and `stablePrefixFold`
  (caller-supplied cuts, left-nested, buys prefix-ROOT identity) solve different
  problems. Conflating them is what once put an imposed boundary set on the
  inference path.
- **A conversation's turn offsets are API metadata**, not a fold instruction.
  They feed `ConversationState`, `answeredSpans` and `currentTurnStart`; the
  geometry never sees them.
- **Identity must not depend on W**, or on absolute offset. If you are adding
  anything that groups by index — a stride, a tile, a fixed-arity row — you are
  reintroducing the bug content-defined cuts exist to remove. Two such attempts
  are recorded as refuted at `collectRegions` and `contentLevels`; test/59 and
  test/63 pin the invariance floors.

_Follow it:_ changes to `contentLevels` — the cut rate, which bits are read, the
minimum/maximum segment length, the forced cut — are changes to the segment
DISTRIBUTION every downstream mechanism is fitted to. Each of those four has
been altered experimentally and cost 5–21 tests. Re-measure the whole suite, not
the one query that motivated the change.

### 2.16 Comment style

Comments state _constraints and failure modes_ — "this guard exists because X
breaks without it", often naming the test that pins the behaviour — never
narration of what the next line does. Two standing examples in
`graph-search.ts`: the `hasHalo` guard on fusing completed rewrites (answer
corruption via phrase-interior chunks) and the `couldGrow` liveness rule (O(N²)
chart growth). When you fix a subtle bug, leave the constraint behind, not the
story of the fix.

---

## 3. Where things live

| Concept                                             | File(s)                                                                           |
| :-------------------------------------------------- | :-------------------------------------------------------------------------------- |
| Public surface / assembly                           | `src/index.ts`, `src/mind/mind.ts`                                                |
| Conversation API (turns, state, answered spans)     | `src/mind/mind.ts`                                                                |
| Config (capacities, budgets, seed)                  | `src/config.ts`                                                                   |
| Derived thresholds, the fold, Hilbert               | `src/geometry.ts`                                                                 |
| Content canonicalizer (injected, modality-specific) | `src/canon.ts`                                                                    |
| Vector primitives, alphabet, node/fold types, seats | `src/vec.ts`, `src/alphabet.ts`, `src/sema.ts`                                    |
| Perceive / resolve / read primitives                | `src/mind/primitives.ts`                                                          |
| Store domain logic / SQLite adapter                 | `src/store.ts`, `src/store-sqlite.ts`                                             |
| Mechanism contract + shared `Precomputed`           | `src/mind/pipeline-mechanism.ts`                                                  |
| The grounding decider (`think`)                     | `src/mind/pipeline.ts`                                                            |
| Grounding mechanisms (one file each)                | `src/mind/mechanisms/{cover,cast,confluence,extraction,reference,recall,alu}.ts`  |
| Weighted deduction system + cost ladder             | `src/mind/graph-search.ts` (engine in `src/derive/`)                              |
| Match/project family                                | `src/mind/match.ts`                                                               |
| Graph traversal, corpus scale, disambiguators       | `src/mind/traverse.ts`                                                            |
| Consensus climb + cross-region attention            | `src/mind/attention.ts`                                                           |
| Recall's refusal-path tiers                         | `src/mind/bridge.ts`, `src/mind/prefix-completion.ts`, `src/mind/frame-filler.ts` |
| Recognition / canonical contract                    | `src/mind/recognition.ts`, `src/mind/canonical.ts`                                |
| Junction ascent (bridge + attention share)          | `src/mind/junction.ts`, `src/mind/resonance.ts`                                   |
| Learning / ingestion / training cache               | `src/mind/learning.ts`, `src/ingest-cache.ts`                                     |
| Post-grounding (reason, fuse, articulate)           | `src/mind/reasoning.ts`, `src/mind/articulation.ts`                               |
| Rationale / trace                                   | `src/mind/rationale.ts`, `src/mind/trace.ts`                                      |
| Computational-usage meter                           | `src/meter.ts` (harness: `bench/profile-inference.mjs`)                           |
| Extension host types                                | `src/extension.ts`                                                                |
| Sublibraries (own READMEs, own tests)               | `src/derive/`, `src/alu/`, `src/rabitq-ivf/`                                      |

Mind functions are **free functions over `MindContext`** (`mind/types.ts`), not
methods — `mind.ts` is a thin assembly that implements the context and
delegates. Follow that shape: it keeps every mechanism testable in isolation
with no hidden `this` state.

---

## 4. Recipes

### Add a grounding mechanism or extension

Implement `PipelineMechanism`: `floor` returns an admissible bound or `null`
(structurally can't fire); `run` returns candidates with `bytes`, `accounted`,
`moves`, `unexplained` (plus `scaffolding`/`complete` when your mechanism can
state them); add `parse` only if you compute authoritative spans (the ALU's
`aluToMechanism` in `mechanisms/alu.ts` is the reference). Register with
`new Mind({ mechanismFactories: [host => yourMechanism(host)] })` (or
`mechanisms: [...]` if no host is needed); reach meaning only through the
`ExtensionHost`. Verify the four market constraints (2.6). You never touch
`think()` or another mechanism's file.

If your `floor` needs an expensive shared analysis to be tight, check
`worthRunning(cheapestBound)` FIRST and return the uninvested bound when it
already fails — that is the investment discipline (2.6), and `cast.ts` /
`extraction.ts` are the two reference implementations.

### Add an ALU operation

One declarative `registry.derive(name, arity, surfaceForms, body)` in the
relevant `src/alu/src/kernel-*.ts`; the body composes existing ops. Scalar ops
broadcast over n-d automatically. No parser, search, or mind edits — see
`src/alu/README.md`.

### Add a deduction rule

Rules live in `GraphSearch` (`coverRules`/`formRules`/`outRules`/`fuse`). Place
its cost in the ladder deliberately (2.4), emit it lazily from the item kind
that triggers it, keep the heuristic admissible, extend `classifyMove` (the
single rule-shape → move-name mapping for the rationale), and add a
rationale-visible test. Async data is pre-resolved in the pipeline (2.10).

### Add a store backend

Subclass `AbstractStore`; implement the `_db*`/`_vec*` methods as thin statement
wrappers (`SQliteStore` is the template); LIMITed variants must be real `LIMIT`
queries and existence probes real point probes (2.8, 2.9). Run the full suite
with your store substituted.

### Add a modality

Perception consumes byte streams. Grid-shaped data: build a `Grid`
(`{width, height, channels, data}` or n-dimensional `dims`) — `geometry.ts`
Hilbert-linearizes it; `Grid[]` stacks frames. Anything else: produce a
`Uint8Array` with a deterministic, locality-preserving ordering. Nothing
downstream changes.

A modality may also supply its own **canonicalizer** (`Canon`) and its own
reading of "edge" — that is the one place presentation rules belong. Nothing in
the store or the mind's core knows what case or whitespace is; the text entry
points inject `textCanon`/`textEdgeTrim`, byte and grid inputs inject neither
(for them `0x20` is content). If you find yourself adding a character class
inside a mechanism, it belongs here instead.

### Hold a conversation

```ts
const conv = mind.beginConversation(savedState); // state optional
const { response, state } = await mind.respondTurnText(conv, "…");
mind.addTurn(conv, "…"); // a turn to hear but not answer
mind.endConversation(conv);
```

Turns append raw bytes plus an offset — never a separator. To replay a corpus
that joins turns with `"\n"`, pass `"\n" + turnText` as the turn; the separator
rides inside the turn bytes, where it belongs. `ConversationState` (context,
boundaries, answered spans) is serialisable and restores exactly. One
`respondTurn` may be in flight per Mind: the conversation's memos are swapped
into the response-scoped slots for the turn's duration.

### Debug an answer

```ts
const r = await mind.respond(query, (rationale) => {
  console.dir(rationale, { depth: null }); // every step, cost, data-flow edge
});
console.log(r.provenance); // cast | join | cover | extract | reference | recall | recall-echo
```

Read top-down: which mechanism fired (and why the others abstained), what
recognition found, how the climb voted, which edges were followed
(`disambiguate` steps carry the evidence). `recall-echo` means "nearest stored
form, not a derived fact"; `reference` means "part of this answer is bytes the
ASKER supplied, voiced through a slot the corpus attests as a carriage" — read
its `bindReferent` step for the referents and the instances, and
`referenceLicence` for why a binding was refused.

Three steps carry **structured data**, so tooling need not parse notes:
`decideGrounding` (every candidate's provenance, exact weight, discrete grade,
unexplained bytes, which won, plus the runner-up margin), `climbConsensus` (per
region: source, span, selected anchor, IDF, contrastive margin and its rival,
mutual weight, outcome; per anchor: pooled vote, peak, breadth, clusters, and
the live commit verdict with its rejection reasons; plus every cross-region
probe and its tier), and `narrowDecision`. When an answer is wrong, the fastest
route is usually `decideGrounding` first (was the right mechanism outbid, or did
it never produce a candidate?), then the per-region climb detail (did the
evidence vote at all?).

### Profile an answer

```ts
const mind = new Mind({ store, profile: true }); // no trace — see 2.14
await mind.respondText(query);
console.log(formatReport(mind.lastCost!)); // counters by layer + nested phases
```

`bench/profile-inference.mjs` runs a battery this way and prints per-query and
aggregate reports; `sumReports` aggregates a run. Diff the COUNTERS between two
runs to catch a work regression — they are deterministic; read the PHASES to see
where the wall clock went.

### Train at scale

Use `CachedIngest` (`ingest-cache.ts`) as a drop-in for `mind.ingest` — it
memoises perceive+intern of repeated inputs and routes through the same
`dispatchIngest` as the direct path (shape detection can't drift). Call
`store.commit()` at checkpoints; run `compactContentIndex` /
`repairContentIndex` post-training if eviction was heavy, and
`mind.buildCanonIndex()` if queries will carry a canonicalizer (2.9). See
`example/train_base.ts`. Profiling note: the first `resonate` after a big ingest
pays the pending index flush; the dominant query-side ANN cost is connector
pre-resolution (bounded by recognised-site count — don't add another loop over
site pairs).

---

## 5. Testing norms

Tests are plain `node:test` suites in `test/*.test.mjs`, numbered by theme, run
against the built `dist/` (`npm test`; one suite:
`node --test test/22-multihop.test.mjs` after `tsc`).

- New behaviour ⇒ a test in the matching numbered suite, or a new numbered
  suite.
- Many tests pin **contracts that look like implementation details** (the bridge
  tier order, the bridge's identity admission vs. its prefix trap and the
  scaffolding reading behind it, the two span-shape readings (`match.ts`),
  `MechanismResult.complete`, fold invariance under shifts (test/59, test/63),
  recognition's idempotence under trace (test/42), the cross-region tier ladder
  (test/51), the instrumentation payloads (test/52–55), determinism, honest
  silence). A "simplification" that fails an existing test is wrong until you
  can argue the _test_ is wrong — several guards exist precisely because a
  plausible simplification once failed a dozen suites.
- **Honest silence is a tested behaviour, not an absence of one.** Several
  suites assert that a query grounds NOTHING; a change that makes the engine
  more forthcoming fails them, and that is the suite working.
- Sublibraries test themselves (`src/{alu,derive,rabitq-ivf}/test/`) with zero
  Sema dependency. Keep it so.
- Performance claims are tested (the rabitq-ivf benchmark asserts sub-linear
  scaling and compression). Changing index behaviour means running it.

---

## 6. Dependencies and licensing

PolyForm Noncommercial 1.0.0 with separate commercial licensing (see
[LICENSE.md](LICENSE.md), [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md),
[TRADEMARKS.md](TRADEMARKS.md), [CONTRIBUTING.md](CONTRIBUTING.md)). Do not
vendor code under licenses incompatible with dual distribution, and do not add
runtime dependencies casually — the near-zero-dependency footprint is a product
feature.
