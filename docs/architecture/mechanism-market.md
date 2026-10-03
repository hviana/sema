# Mechanism Market — The Free-Will Architecture

Every grounding mechanism — including the ALU and user extensions — speaks one
interface (`mind/pipeline-mechanism.ts`). The decider in `mind/pipeline.ts`
(`think`) holds a plain list and never branches on which mechanism it holds.

## Interface

```ts
interface PipelineMechanism {
  parse?(query: Uint8Array): Promise<ComputedSpan[]>; // authoritative spans
  floor(ctx, query, pre, worthRunning): Promise<number | null>; // bound or null
  run(ctx, query, pre): Promise<MechanismResult[]>; // candidates
}
interface MechanismResult {
  bytes: Uint8Array;
  accounted: Array<[number, number]>;
  moves: number;
  used?: ReadonlySet<number>;
  scaffolding?: number;
  provenance?: string;
  complete?: boolean;
}
```

- `parse` is optional; all results are collected into `Precomputed.computed`
  before any `floor`/`run`.
- `floor` returns `null` when structurally impossible, otherwise an admissible
  lower bound (never overstates cost).
- `run` returns candidates with travelling evidence (below).

## Decider

`think` iterates `defaultMechanisms` in list order:

```
defaultMechanisms = [cover, cast, confluence, extraction, reference, recall,
                     prefix-completion] + ALU (`aluToMechanism`) + extensions
```

Weight is one currency: `weight = moves + PASS · unaccountedBytes` where
`unaccountedBytes = unexplainedSpans(query.length, accounted)`. Comparison is at
`STEP` grade ; equal grade prefers fewer `scaffolding` bytes, then list order.

## Four constraints

1. **Decoupled** — zero cross-imports between `mind/mechanisms/*`. Adding one
   never touches another; no mechanism asks what already decided.
2. **Declared competence** — binary structural gates inside `floor`/`run` (query
   length, anchor shape, weave existence). Never a learned score; rationale
   states why a mechanism abstained.
3. **Visible budget** — every corpus-scale loop is capped at a named constant:
   `√N` via `hubBound`/`hubCap` and `k = 2·recallQueryK` (`Precomputed.k`).
   Enforced at the store.
4. **Evidence travels** — every candidate carries `accounted` (query spans
   explained) and `moves` (priced on `MICRO/STEP/CONCEPT/PASS`); optionally
   `scaffolding` (answer bytes from unrecognised spans — equal-grade tie-break),
   `complete` (trained-form continuation reached via identity; post-grounding
   must not extend) and `provenance`. The decider honours them without knowing
   who set them.

## Two disciplines

- **Admissible-floor pruning.** `floor` runs for every mechanism in list order
  before any `run`. `run` fires only if `worthRunning(floor)` where
  `worthRunning = (floor) => best === null || grade(floor) < grade(best.weight)`.
  Cover runs first so a near-zero-cost computed span prunes the rest through the
  same mechanism — not a special case.

- **A cheaper bound is looked at first.** Before mechanism `m` first-touches
  anything, every LATER mechanism whose floor grade is strictly below `m`'s runs
  ahead of it (cheapest first); the lowest grade they reach is `bound`, and any
  mechanism floored above `bound` is skipped (`meter.mechanismsBounded`). The
  bound is learnt by calling `floor` with a `worthRunning` that refuses — the
  investment discipline makes that free. The DECISION is the declared order's: a
  run-ahead mechanism bounds the final grade whether or not the declared order
  would have run it (if pruned, the incumbent already sat at or below its
  floor); every candidate above `bound` loses to the winner, and every mechanism
  floored at or below it meets the same run-or-prune decision, so `consider`
  replays the same candidates in declared order. Equal floors are not skipped,
  so an earlier mechanism keeps the tie it would win. Running ahead is never
  extra work: only a mechanism floored at or below `p` can prune `p`, and each
  such mechanism has already run or runs ahead of `p`. Measured on the
  31.7M-node store: a lowercased Persian turn (#83) went from 18.0 s to 1.2 s,
  and #114 from 1.9 s to 0.7 s. In both, a grade-1 recall or prefix answer no
  longer waits behind CAST's climb and weave. Of 42 composition-regime queries,
  none changed its answer.

- **Investment discipline.** `worthRunning` is passed _into_ `floor`. A floor
  that would first-touch an expensive shared analysis (`pre.attention()` climb,
  `pre.weave()`, `pre.resonance()`) checks `worthRunning(cheapestBound)` first
  and returns the uninvested bound if it loses. Never compute a shared analysis
  just to discard it. `cast.ts`/`extraction.ts` are the references.

## Accounting

- **Extraction:** located frames are always evidence; the span between them
  counts only when _both_ borders were located. An open-ended read is priced by
  exclusion (`PASS`/byte).
- **Reverse reading:** `reverseContext` produces bytes but explains nothing
  forward: `accounted = []`, weight ≈ `PASS·|query|` — last resort by
  arithmetic, not rule.
- **Paid acts are accounted:** the bridge's corroborated substitutions cost
  `CONCEPT` each in `moves`, so their spans must be `accounted`; otherwise the
  same act is charged twice (`PASS`/byte dominates).

`accounted` is a cost-ladder quantity; `cover.ts` leaves masked computed spans
out so `PASS`-bridged bytes are still charged. `narrowDecision` and
`thinGrounding` are observational only.

## Pins

- `test/01-floor` — floor geometry.
- `test/04-think` — decider, admissible pruning, investment discipline.
- `test/153` — run-ahead bounds: the composition market is skipped below CAST's
  floor, and the decision equals a declared-order oracle.
