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
  accounted: [number, number][];
  moves: number;
  unexplained: string;
  scaffolding?: number;
  complete?: boolean;
  used?: ReadonlySet<number>;
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
   explained), `moves` (priced on `MICRO/STEP/CONCEPT/PASS`), `unexplained`
   (diagnostic label); optionally `scaffolding` (answer bytes from unrecognised
   spans — equal-grade tie-break) and `complete` (trained-form continuation
   reached via identity; post-grounding must not extend). The decider honours
   all three without knowing who set them.

## Two disciplines

- **Admissible-floor pruning.** `floor` runs for every mechanism in list order
  before any `run`. `run` fires only if `worthRunning(floor)` where
  `worthRunning = (floor) => best === null || grade(floor) < grade(best.weight)`.
  Cover runs first so a near-zero-cost computed span prunes the rest through the
  same mechanism — not a special case.

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
out so `PASS`-bridged bytes are still charged. `unexplained`, `narrowDecision`,
`thinGrounding` are observational only.

## Pins

- `test/01-floor` — floor geometry.
- `test/04-think` — decider, admissible pruning, investment discipline.
