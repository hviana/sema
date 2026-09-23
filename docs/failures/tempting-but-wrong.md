# Tempting but Wrong — 13 Traps

Thirteen shortcuts that look plausible and break an invariant. Each states what
not to do, why it fails, and what to do instead.

### 1. `score >= threshold` decides identity

- **WRONG:** Treat a RaBitQ cosine above a cutoff as proof the bytes are the
  same node.
- **WHY:** Scores are estimates that rank and gate; they never decide identity
  (`AGENTS §2` Invariant 3 — Exact decides / approximate proposes).
- **CORRECT:** Gate with the score, decide with
  `resolve`/`findLeaf`/`canonResolve` and re-fold verification. Pinned by
  `test/51-structural-resonance-ladder.test.mjs` and
  `test/56-bridge-identity-admission.test.mjs`.

### 2. `Math.random()` / `Date.now()` on a behavioural path

- **WRONG:** Sample randomness or wall-clock time in grounding, indexing, or
  tie-breaking.
- **WHY:** Determinism is the product: same seed + deposit order + query ⇒
  identical bytes (`AGENTS §2` Invariant 1).
- **CORRECT:** Derive all randomness from `MindConfig.seed` via `rng`/`Prng`;
  keep `example/train_base` as the only non-library exception. Pinned by
  `test/20-stability.test.mjs` and
  `test/42-recognise-trace-idempotence.test.mjs`.

### 3. Last-inserted tie-break

- **WRONG:** Break equal-rank ties by picking the most recently inserted
  edge/node.
- **WHY:** Tie-breaks must be corpus-determined and stable; last-inserted is
  recency-dependent and was fixed as a bug (`AGENTS §2` Invariant 1 —
  first-inserted fallback).
- **CORRECT:** `guidedFirst`/`chooseNext`/`chooseAmong`: rank then
  first-inserted (lowest node id / `LIMIT 1` insertion order). Pinned by
  `test/03-recall.test.mjs` determinism suites.

### 4. Tunable threshold in `config.ts`

- **WRONG:** Add a new `threshold: number` to `src/config.ts` and tune it.
- **WHY:** Every cutoff is a formula over `D`, `W`, or `N` in `src/geometry.ts`;
  config holds only capacities/budgets (`AGENTS §2` Invariant 2 — Derived
  thresholds).
- **CORRECT:** Add `mergeThreshold`/`identityBar`/`significanceBar` etc.
  derivation in `geometry.ts`; `traverse.ts:hubBound` for scale caps. Pinned by
  `test/64-two-ended-thresholds.test.mjs` and
  `test/40-choosenext-scale-guard.test.mjs`.

### 5. Tuning `PASS` to encode policy

- **WRONG:** Raise/lower `PASS` (1000/byte) so "computation always wins" or
  another preference falls out of pricing.
- **WHY:** The ladder's order `MICRO < STEP < CONCEPT < PASS` is the contract;
  policy is enforced by masking, not pricing (`AGENTS §2` Invariant 4 — One cost
  currency; `docs/architecture/cost-model.md` § Policy is not cost).
- **CORRECT:** Keep `PASS` dominating; enforce precedence in the caller (e.g.
  `pipeline.ts` masks recognised sites overlapped by `ComputedResult`). Pinned
  by `test/04-think.test.mjs` and `test/55-cost-meter.test.mjs`.

### 6. Reimplementing `locate`/`align` inside a mechanism

- **WRONG:** Copy-paste matching logic into `mind/mechanisms/*.ts` with a
  private gate.
- **WHY:** Match/project/gate is factored once in `mind/match.ts` (`AGENTS §2`
  Cross-cutting contracts; `AGENTS §3` — Where things live).
- **CORRECT:** Configure the shared family:
  `locate`/`alignRuns`/`alignGraded`/`frameSlots` + `follow`/`reverseContext` +
  `isSpanShaped`/`carriesFillers` with a `geometry.ts` gate. Pinned by
  `test/50-cast-analog-consensus-floor.test.mjs`.

### 7. Putting voicing gates in `frameSlots`

- **WRONG:** Make `frameSlots` refuse pairings that fail `carriesFillers` or
  reference's four voicing conditions.
- **WHY:** `frameSlots` reports (contracted gaps tagged
  substitution/insertion/deletion); `carriesFillers` judges;
  `Precomputed.frames` inventories — elects nothing (`AGENTS §2` Cross-cutting
  contracts — `docs/architecture/match-project.md` § Frame reading).
- **CORRECT:** Report everything in the shared layer; apply
  `substituteAll(contA, fillersA→fillersB)==contB` and
  frame-dominance/`W`-reach/distinctness in the consumer (reference). Pinned by
  `test/47-cast-comparison-coverage.test.mjs`.

### 8. Swapping corpus-global and weave-local commonality

- **WRONG:** Use `reachOf`/`dominates(reach,N)` to decide CAST's frame, or
  `depth[i]`/`dominates(depth, aligned)` to decide climb/IDF.
- **WHY:** They measure different things: global reach (minority discriminates,
  powers climb/pooling) vs weave-local depth with `MIN_WEAVE=2` (what the local
  cohort shares, powers CAST) (`docs/architecture/commonality.md`).
- **CORRECT:** Climb/attention uses corpus-global;
  `frame(i) ⇔ depth[i]>MIN_WEAVE ∧ dominates(depth[i],aligned)` for CAST. Pinned
  by `test/50-cast-analog-consensus-floor.test.mjs` and
  `test/67-climb-anchor-breadth.test.mjs`.

### 9. Materialise-then-slice instead of `LIMIT ?`

- **WRONG:** `store.next(id).slice(0, k)` or `parents(id).length` to cap a
  fan-out.
- **WHY:** Per-query reads must not grow with `N`; caps are enforced in SQL as
  `LIMIT ?` / `EXISTS` probes (`AGENTS §2` Invariant 5 — Bounded reads).
- **CORRECT:** `nextFirst`/`parentsFirst`/`containersSlice` with `hubBound`
  (`ceil(sqrt(N))`), `hasNext`/`hasParents`/`hasHalo` probes,
  `bytesPrefix`/`contentLen` caps, `chainRun` CTE. Pinned by
  `test/14-scaling.test.mjs` and `test/90-connector-read-cap.test.mjs`.

### 10. Bypassing `recogniseMemo` under trace

- **WRONG:** Skip `recogniseMemo`/`perceiveMemo`/`climbMemo` when
  `ctx.trace !== null` to "emit more steps."
- **WHY:** Only `guidedNext`/`sharedReachMemo` are trace-bypassed; bypassing
  recognition re-runs `recogniseImpl` with a warm cache and changes site count —
  31→5 observed (`AGENTS §2` Cross-cutting — `Precomputed` owns memoization;
  `docs/architecture/memoization.md`).
- **CORRECT:** Always consult `recogniseMemo`; `foldTree` already descends fully
  when `visit` is present. Pinned by
  `test/42-recognise-trace-idempotence.test.mjs`.

### 11. Stopping junction ascent when one cone is exhausted

- **WRONG:** Terminate the `junction.ts` walk as soon as parents or containers
  run out.
- **WHY:** Junction ascent climbs both cones within a bounded `√N·W` walk via
  `WalkCache`; exhausting one cone does not imply the other is exhausted —
  stopping early misses the shared ancestor (`AGENTS §2` Cross-cutting contracts
  — `junction.ts` is the shared ascent; `AGENTS §3` — `WalkCache`).
- **CORRECT:** Continue the live cone until the walk budget is spent or a
  meeting point is found; cap reads with `hubBound`. Pinned by
  `test/34-cross-region.test.mjs` and
  `test/52-climb-consensus-instrumentation.test.mjs`.

### 12. Imposing turn boundaries on `fold`

- **WRONG:** Cut the byte stream at conversation turn edges before folding, so
  deposits and queries fold differently.
- **WHY:** Perception is a pure function of the bytes; deposit and inference
  must compute the same tree for the same input (`AGENTS §1` Orientation — Hard
  facts).
- **CORRECT:** Fold content-defined cuts (`contentLevels` in `geometry.ts` +
  `twoEndedSeat`); turns are API state in `mind/mind.ts`, not segmentation.
  Pinned by `test/59-fold-invariance.test.mjs` and
  `test/63-fold-invariants.test.mjs`.

### 13. Capping a combinatorial explosion instead of budgeting it

- **WRONG:** Answer a combinatorial explosion with a geometry-derived limit —
  capping the pairs a sweep enumerates, the continuations a hop offers, the
  candidates a scan probes. A derived limit is a legitimate cutoff for a
  DECISION, but used as the answer to explosion it is a short-circuit: it stops
  the computation silently, truncates reach, and removes capability without a
  single test failing.
- **WHY:** Both failure modes are measured in this repository. With the cap, a
  legitimate 24-byte slot stopped being reachable — the alignment truncated every
  learned frame whose slot exceeded `chainReach(W)=W²=16`, and the asker's own
  filler came back as another instance's. Without it, removing the bound outright
  took the corpus-cost guard from milliseconds to 68 seconds. Neither is an
  answer, because the answer is not a number.
- **CORRECT:** BUDGET it — the work is charged in the one currency
  (`MICRO`/`STEP`/`CONCEPT`/`PASS`; `weight = moves + PASS·unaccounted`, see
  `docs/architecture/cost-model.md`) and the charge is visible in the meter and
  the rationale, so the SEARCH decides whether the work is worth paying. And
  where the work is mechanical rather than evidential — enumeration, scans,
  sweeps — an algorithm whose cost is structural in the bytes it is given is not
  a smaller cap.

- **THE IDEAL, WHICH IS NOT WHAT THIS REPOSITORY DOES.** The aim of the project
  is a universal **closure engine**: ONE law of closure, stated in the quantities
  the machine already has (`leadsSomewhere`, the exact-then-canonical identity,
  `accounted` bytes, the ladder, `hubBound`), from which the reach of a gap, the
  offer of a hop, the depth of a join and the scope of a substitution all FOLLOW.
  None of that law exists. It is not stated anywhere in this repository, and
  nobody has stated it yet.

- **WHAT THIS REPOSITORY ACTUALLY HAS, STATED PLAINLY.** A series of LOCAL
  corrections, each measured and pinned, each standing on its own: the alignment
  sweep indexes the context's windows and walks the query's outward, so its work
  is proportional to the bytes a run spans (a 60-byte divergence is bridged;
  `test/14` 60.0 s against a 67.8 s baseline); the join's key prefixes come from
  the query's own fold boundaries instead of every byte length (5 of 5 accepted
  keys landed on a boundary; 153 candidate probes became 52); a duplicated
  per-offset scan was deleted; an offer cap was removed once the fan-out was
  measured to be linear in the hub's degree rather than quadratic. Those are
  patches. They lower cost and restore reach, and they are pinned by
  `test/101-alignment-gap-bound.test.mjs`,
  `test/103-alignment-gap-budget.test.mjs`,
  `test/114-alignment-budget-is-per-sweep.test.mjs`,
  `test/108-the-join-chains.test.mjs`,
  `test/112-the-exploration-does-not-grow-with-the-hub.test.mjs`,
  `test/110-the-reasoner-stops-when-the-question-is-answered.test.mjs` and
  `test/116-the-extension-is-gated-by-the-pipelines-own-remainder.test.mjs`.

- **THE OPEN PROBLEM.** How to state the closure law so that those four
  quantities — gap reach, hop offer, join depth, substitution scope — are
  consequences of it instead of four separate decisions. It is unsolved. A change
  that cannot be stated that way is not ready, and this entry does not claim
  otherwise.
