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

The mental model, top to bottom:

```
mind/pipeline.ts     the grounding decider: mechanisms compete on one cost scale
mind/mechanisms/*    cover · cast · confluence · extraction · recall · alu
mind/*               shared machinery: match/project, attention, recognition,
                     junction ascent, graph search, learning, rationale
store.ts             AbstractStore: ALL domain logic of the DAG store
store-sqlite.ts      the one concrete backend (thin SQL wrappers)
geometry.ts + vec/alphabet/sema
                     vectors, the fold, and every derived threshold
derive/ · alu/ · rabitq-hnsw/
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
`dominates`, …). `src/config.ts` holds **capacities and budgets only** (cache
byte budgets, batch sizes, HNSW parameters, query k, ALU precision, the seed).

_Follow it:_ if you are about to add a tunable cutoff to config, derive it in
`geometry.ts` instead. A threshold knob is a design bug here — one was already
removed once. When a decision needs a scale, express it in D, W, or N.

### 2.3 Exact decides, approximate proposes

Every score from the vector indexes (`resonate`, `resonateHalo`) is a RaBitQ
_estimate_. Identity is decided only by content-addressed lookup (`resolve`,
`findLeaf`, `findBranch`), never by `score >= threshold`. Scores rank candidates
and gate broad regions; bytes make decisions.

The same principle appears as **graded evidence ladders** — exact tier first,
distributional second, geometric last — in three places built on one shape:

- `locate` in `mind/match.ts`: exact bytes → halo role → gist.
- `alignGraded` in `mind/match.ts`: literal W-gram runs → halo-matched sites.
- `bridge` in `mind/resonance.ts`: junction containers by identity → edge
  junctions → synonym junctions → whole-gist resonance as last resort.

_Follow it:_ never reorder a ladder's tiers, and never let an approximate tier
override an exact one. If you need a new matcher, add a tier to the shared
family (2.5), not a private score check.

### 2.4 One cost currency

The graph search's cost ladder (`mind/graph-search.ts`, exported constants) is
the single pricing scheme of the whole mind:

```
MICRO (1e-3)  advance over recognised material; per-byte unit of the A* heuristic
STEP  (1)     follow one learned edge; one computed result; one projection
CONCEPT (10)  a halo-mediated act (synonym hop, consensus climb)
PASS  (1000/byte)  carry a byte nothing explains
```

Only the _ordering_ matters. The pipeline weighs whole mechanisms in the same
units: `weight = moves + PASS · unaccounted-bytes`, so a mechanism-level choice
and a byte-level choice are the same kind of decision.

_Follow it:_ place any new cost deliberately in the ordering; never make the A\*
heuristic exceed a real per-byte cost (admissibility breaks silently — answers
degrade, nothing errors). Never encode _policy_ as cost: "computation always
wins" is implemented by masking colliding sites in cover, not by pricing. Keep
policy in callers, the engine neutral.

### 2.5 One factored machinery: match → project, under a gate

`mind/match.ts` is the shared family every generalising mechanism configures:
matchers (`locate`, `alignRuns`, `alignGraded`, `bestHaloMate`, `haloSiblings`,
`analogyStrength`) and projections (`follow`, `reverseContext`, `project`,
`conceptHop`). `mind/traverse.ts` owns the graph readings (`edgeAncestors`,
`reachOf`, `chooseNext`/`chooseAmong`, `guidedFirst`, `leadsSomewhere`) and the
corpus scale (`corpusN`, `hubBound`, `hubCap`).

_Follow it:_ before writing a new generalising mechanism, express it as a
(matcher, direction, gate) triple. If those already exist, the mechanism is a
configuration — write only the configuration. If it genuinely needs a new
matcher or projection, add it **to the shared family** with a derived gate
(2.2), never as a private helper. A mechanism file that re-implements locating,
aligning, edge-following to a fixpoint, predecessor-picking, or fan-out capping
is reintroducing duplication that was deliberately removed.

Related single-definition contracts (define once, import everywhere):

- `canonical.ts` — the write/read contract for canonical segmentation
  (`canonicalWindows`, `chainReach`, `leafIdRun`, `leafIdPrefix`, `windowIds`).
  Learning writes through it; recognition and attention read through it.
  Changing one side means changing this file — drift between sides breaks
  canonical recognition with **no type error**.
- `junction.ts` — the content-addressed "which learnt whole contains these two
  forms?" ascent, shared by the bridge and cross-region attention, with its
  per-response `WalkCache` and once-per-candidate seed computation.
- `joinWithBridge` (`resonance.ts`) — the one out-of-search way to join two
  answer spans; it emits a `bridgeMiss` trace step on a bare join.
- `guidedFirst` (`traverse.ts`) — the one answer-shaped "what does this lead
  to?" read (guided pick merged with the first-inserted fallback).
- `leadsSomewhere` (`traverse.ts`) — the one admission predicate for recognition
  sites (edge-or-halo, via existence probes).
- `isChunk` (`sema.ts`) — the one "children are all leaves" predicate.

### 2.6 The mechanism market (the free-will architecture)

Every grounding mechanism — including the ALU and user extensions — implements
the same interface, `PipelineMechanism` (`mind/pipeline-mechanism.ts`): optional
`parse` (authoritative computed spans, collected before anything else), `floor`
(an admissible lower bound, or `null` when the mechanism structurally cannot
fire), and `run` (candidate answers). The decider in `mind/pipeline.ts`
(`think`) holds a plain list (`defaultMechanisms`: cover, cast, confluence,
extraction, recall, plus the ALU and any user mechanisms) and never branches on
which mechanism it is holding.

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
   `unexplained` (a diagnostic label). The decider sees only weights.

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
  Tooling: the `depth[]` array from `alignGraded` + `MIN_WEAVE` + `dominates`.
  Used by CAST's frame gate. Answers "does this discriminate among the
  structures this query activates?"

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
- `chainRun` climbs transparent scaffolding chains in one bounded read.
- The full materialising reads (`next`, `prev`, `parents`, `containers`) exist
  for maintenance and inspection only. Keep them off hot paths.

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
- Maintenance entry points (`compactContentIndex`, `repairContentIndex`) are
  batch operations for checkpoints, never the hot path.

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
eager fields (recognition, computed spans, guide) plus **lazily-cached methods**
for expensive analyses (`attention()` — the consensus climb, `weave()`,
`spanShapedOf`, `queryWindows`, `windowsOf`, `reachMemo`) — each computed at
most once, shared by mechanisms and post-grounding stages, and never computed if
nobody asks.

_Follow it:_ an expensive analysis a new mechanism needs goes on `Precomputed`
as a lazy method, not inside the mechanism. Mind-level memos (`climbMemo`,
`recogniseMemo`, `perceiveMemo`, `_edgeChoice`, `_gistCache`) are created in
`beginResponse()` and torn down in `endResponse()` — a new memo must be added to
both. `climbMemo`/`recogniseMemo` are bypassed while a rationale trace is
attached (every mechanism must emit its steps); `perceiveMemo` is not.
Consequence: **never benchmark with a trace attached.**

### 2.12 Caches are budgets, not correctness

Every in-memory acceleration structure is a `BoundedMap` with a byte budget; a
miss re-derives from durable state. The degradation order is fixed: what is lost
under pressure is always speed or reach (a re-perception, a duplicate probe,
reduced resonance until repair), never identity, reconstruction, or a learned
relation.

_Follow it:_ new caches get budgets and a re-derivation path. If memory grows,
look for something bypassing a budget — not for a leak in the DAG (nodes are
meant to accumulate).

### 2.13 Honest degradation, visible failure

Nothing degrades silently: counters (`danglingReads`, `compactFailures`), trace
steps (`bridgeMiss`, `narrowDecision`, `thinGrounding`), the `echoed` flag on
recall's last tier, `recall-echo` provenance. Empty results are legitimate
outputs (silence), not errors.

_Follow it:_ when your code can degrade, emit a counter or trace step. And mind
the classic trap: **empty bytes are truthy** — `Uint8Array(0)` passes
`if (answer)`; always test `.length`.

### 2.14 Comment style

Comments state _constraints and failure modes_ — "this guard exists because X
breaks without it", often naming the test that pins the behaviour — never
narration of what the next line does. Two standing examples in
`graph-search.ts`: the `hasHalo` guard on fusing completed rewrites (answer
corruption via phrase-interior chunks) and the `couldGrow` liveness rule (O(N²)
chart growth). When you fix a subtle bug, leave the constraint behind, not the
story of the fix.

---

## 3. Where things live

| Concept                                       | File(s)                                                                |
| :-------------------------------------------- | :--------------------------------------------------------------------- |
| Public surface / assembly                     | `src/index.ts`, `src/mind/mind.ts`                                     |
| Config (capacities, budgets, seed)            | `src/config.ts`                                                        |
| Derived thresholds, river fold, Hilbert       | `src/geometry.ts`                                                      |
| Vector primitives, alphabet, node/fold types  | `src/vec.ts`, `src/alphabet.ts`, `src/sema.ts`                         |
| Store domain logic / SQLite adapter           | `src/store.ts`, `src/store-sqlite.ts`                                  |
| Mechanism contract + shared `Precomputed`     | `src/mind/pipeline-mechanism.ts`                                       |
| The grounding decider (`think`)               | `src/mind/pipeline.ts`                                                 |
| Grounding mechanisms (one file each)          | `src/mind/mechanisms/{cover,cast,confluence,extraction,recall,alu}.ts` |
| Weighted deduction system + cost ladder       | `src/mind/graph-search.ts` (engine in `src/derive/`)                   |
| Match/project family                          | `src/mind/match.ts`                                                    |
| Graph traversal, corpus scale, disambiguators | `src/mind/traverse.ts`                                                 |
| Consensus climb + cross-region attention      | `src/mind/attention.ts`                                                |
| Recognition / canonical contract              | `src/mind/recognition.ts`, `src/mind/canonical.ts`                     |
| Junction ascent (bridge + attention share)    | `src/mind/junction.ts`, `src/mind/resonance.ts`                        |
| Learning / ingestion / training cache         | `src/mind/learning.ts`, `src/ingest-cache.ts`                          |
| Post-grounding (reason, fuse, articulate)     | `src/mind/reasoning.ts`, `src/mind/articulation.ts`                    |
| Rationale / trace                             | `src/mind/rationale.ts`, `src/mind/trace.ts`                           |
| Extension host types                          | `src/extension.ts`                                                     |
| Sublibraries (own READMEs, own tests)         | `src/derive/`, `src/alu/`, `src/rabitq-hnsw/`                          |

Mind functions are **free functions over `MindContext`** (`mind/types.ts`), not
methods — `mind.ts` is a thin assembly that implements the context and
delegates. Follow that shape: it keeps every mechanism testable in isolation
with no hidden `this` state.

---

## 4. Recipes

### Add a grounding mechanism or extension

Implement `PipelineMechanism`: `floor` returns an admissible bound or `null`
(structurally can't fire); `run` returns candidates with `bytes`, `accounted`,
`moves`, `unexplained`; add `parse` only if you compute authoritative spans (the
ALU's `aluToMechanism` in `mechanisms/alu.ts` is the reference). Register with
`new Mind({ mechanismFactories: [host => yourMechanism(host)] })` (or
`mechanisms: [...]` if no host is needed); reach meaning only through the
`ExtensionHost`. Verify the four market constraints (2.6). You never touch
`think()` or another mechanism's file.

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

### Debug an answer

```ts
const r = await mind.respond(query, (rationale) => {
  console.dir(rationale, { depth: null }); // every step, cost, data-flow edge
});
console.log(r.provenance); // cast | join | cover | extract | recall | recall-echo
```

Read top-down: which mechanism fired (and why the others abstained), what
recognition found, how the climb voted, which edges were followed
(`disambiguate` steps carry the evidence). `recall-echo` means "nearest stored
form, not a derived fact". Remember traced responses bypass memos (2.11).

### Train at scale

Use `CachedIngest` (`ingest-cache.ts`) as a drop-in for `mind.ingest` — it
memoises perceive+intern of repeated inputs and routes through the same
`dispatchIngest` as the direct path (shape detection can't drift). Call
`store.commit()` at checkpoints; run `compactContentIndex` /
`repairContentIndex` post-training if eviction was heavy. See
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
  tier order, extraction's two span-shape readings, determinism, honest
  silence). A "simplification" that fails an existing test is wrong until you
  can argue the _test_ is wrong — several guards exist precisely because a
  plausible simplification once failed a dozen suites.
- Sublibraries test themselves (`src/{alu,derive,rabitq-hnsw}/test/`) with zero
  Sema dependency. Keep it so.
- Performance claims are tested (the rabitq-hnsw benchmark asserts sub-linear
  scaling and compression). Changing index behaviour means running it.

---

## 6. Dependencies and licensing

PolyForm Noncommercial 1.0.0 with separate commercial licensing (see
[LICENSE.md](LICENSE.md), [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md),
[TRADEMARKS.md](TRADEMARKS.md), [CONTRIBUTING.md](CONTRIBUTING.md)). Do not
vendor code under licenses incompatible with dual distribution, and do not add
runtime dependencies casually — the near-zero-dependency footprint is a product
feature.
