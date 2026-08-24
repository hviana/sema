# Cost Model — One Currency

Every mechanism and every byte competes on one cost ladder defined in
`src/mind/graph-search.ts`. GraphSearch and `pipeline.ts:think` use the same
units, so a mechanism-level choice and a byte-level choice are the same kind of
decision: a lightest derivation.

## Ladder (`src/mind/graph-search.ts`)

| Cost      | Value         | Meaning                                                                                                                                                                           |
| --------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MICRO`   | `1e-3`        | Recognised advance (one `rec` bridge); per-byte unit of the A\* heuristic. A recomposed form's onward edge is also `MICRO`.                                                       |
| `STEP`    | `1`           | Every edge hop (first or fifth), every computed result, every projection. Charging every hop makes the lightest derivation the shortest chain.                                    |
| `CONCEPT` | `10`          | Halo-mediated act (synonym hop, consensus climb) and abandoning an edge chain early (`CONCEPT` above chain cost — genuine fixpoint at `+0` always beats giving up at same depth). |
| `PASS`    | `1000` / byte | Carrying a byte nothing explains. Dominates everything so the search always prefers to recognise.                                                                                 |

Only the **ordering** `MICRO < STEP < CONCEPT < PASS` matters; any constants
with that order give the same derivations.

## Pipeline weighing (`src/mind/pipeline.ts:think`)

Mechanism candidates are weighed in the same ladder:

```
weight = moves + PASS * unaccounted_bytes
grade  = floor(weight / STEP)
```

`unaccounted` is the query bytes no `accounted` span covers. Comparison is at
`STEP` resolution: lowest `grade` wins. At equal grade the candidate with fewer
`scaffolding` bytes (answer bytes lifted from unrecognised spans) wins; only
then does mechanism list order decide.

## Two semirings

- **(min, +) tropical** — lightest derivation in `GraphSearch` via `src/derive`
  (`lightestDerivation`). Cost accumulates with `+`, choice selects `min`.
  Powers `cover`/`form`/`out`, edge following, fusing, and the A\* agenda
  (`g + h`).

- **(+, +) arithmetic** — evidence pooling in `src/mind/attention.ts:poolVotes`.
  Each region's vote is an axiom; rules carry `Rule.combine = 'sum'` so costs to
  the same anchor **add** rather than minimise. Powers IDF-weighted consensus,
  `votes`/`votesIdf`/`support`, and `regionSupport`/`regionPeak`.

## Admissibility

The A\* heuristic is admissible and consistent:

```
h(it) = (queryLen - right) * MICRO
```

`right` is `p` for `cover(p)` or `j` for `form/out [i,j)`. `MICRO` is the
minimum per-byte cost in the ladder (every real per-byte cost is `>= MICRO`,
including `PASS`), and only the suffix past `right` is counted, so `h` never
exceeds the true remaining cost.

## Policy is not cost

"Computation always wins" is **not** priced into the ladder (a computed result
costs `STEP`, same as a learned edge). It is enforced by masking: `pipeline.ts`
removes recognised sites overlapped by a `ComputedResult` so the computation is
the sole completion there. Keep policy in callers; keep the engine neutral.

## Pins

- `test/52` — climb consensus instrumentation
- `test/53` — cross-region probe instrumentation
- `test/54` — evidence `k` instrumentation
- `test/55` — cost meter (`Meter`, `CostReport`, `searchPops`/`searchPushes`)
