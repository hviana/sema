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

Candidates are weighed in ONE place — a mechanism reports `moves` and
`accounted`, never a price:

```
weight = moves + PASS * unaccounted_bytes
grade  = floor(weight / STEP)
```

`unaccounted` is what no `accounted` span covers. Comparison is at `STEP`
resolution: lowest `grade` wins; at equal grade fewer `scaffolding` bytes
(answer bytes lifted from unrecognised spans) wins; then list order.

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

## Dominance — why `PASS ≫ STEP` does not flood the chart

The heuristic charges `MICRO` for a byte the goal will pay `PASS` for, so a
cover that leaves bytes unexplained lets the search spend up to `PASS / STEP`
hops looking for one more explained byte. Coverage itself cannot use them: every
recognised completion of `[i, j)` advances the cover from `i` to `j` at the same
`MICRO`. So a form or completion of `[i, j)` whose cost has reached that of a
completion of `[i, j)` already yielded is DOMINATED and fires no rule
(`buildSearch`, metered as `searchDominated`): every completion it could lead to
costs at least as much, and a tie goes to the one yielded first. What a
completion's BYTES could still do — fuse, splice, join — fires from the
completion the search would stand on for that span, the same cure the join
license and `deepen` apply. The first hop's stop-here (`STEP + CONCEPT`) is then
a real horizon: no chain deeper than it is expanded.

## Policy is not cost

"Computation always wins" is **not** priced into the ladder (a computed result
costs `STEP`, same as a learned edge). It is enforced by masking: `cover.ts`
removes recognised sites overlapped by a `ComputedResult`, so the computation is
the sole completion there. Keep policy in callers; keep the engine neutral.

## Pins

- `test/52` — climb consensus instrumentation
- `test/53` — cross-region probe instrumentation
- `test/54` — evidence `k` instrumentation
- `test/55` — cost meter (`Meter`, `CostReport`, `searchPops`/`searchPushes`)
- `test/151` — dominance: a hub's degree generates no chart work
