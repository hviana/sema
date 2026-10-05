# Cost Model — One Currency

> **Law:** every choice, whether a byte inside the search or a mechanism in the
> market, is a lightest derivation on one ladder (`mind/graph-search.ts`). The
> price is the question left unexplained, never confidence.

**Why.** Exact identity yields no confidence to choose by. What can be measured
exactly is how much of the question an answer accounts for. Pricing that makes
the winner the reading that explains the most, not the one most eager to speak.
When nothing explains the question, silence is the lightest answer.

## The ladder

| Cost      | Value       | Charged for                                                                                                                                  |
| --------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `MICRO`   | `1e-3`      | a recognised advance, and a recomposed form's onward edge; it is also the A\* heuristic's unit per byte                                      |
| `STEP`    | `1`         | every edge hop, computed result and projection. Charging every hop makes the lightest derivation the shortest chain                          |
| `CONCEPT` | `10`        | an act mediated by a halo (a synonym hop, the consensus climb), and abandoning a chain early, so that a real fixpoint always beats giving up |
| `PASS`    | `1000`/byte | carrying a byte nothing explains. It dominates everything, so the search always prefers to recognise                                         |

Only the order `MICRO < STEP < CONCEPT < PASS` matters. Any constants with that
order give the same derivations. The market weighs candidates on the same
ladder, `moves + PASS·unaccounted`, compared at `STEP` grade
(`mechanism-market.md`).

## Two semirings, one engine (`src/derive`)

- **(min, +), the tropical semiring:** the lightest derivation. Costs add along
  a derivation, and the cheapest route to a conclusion wins. This powers
  `cover`, form and continuation rules, edge following, fusion, and the A\*
  agenda.
- **(+, +), the arithmetic semiring:** pooled evidence. Rules with
  `combine: "sum"` add every independent line of evidence for a conclusion
  instead of keeping the cheapest. This powers the consensus climb's votes
  (`poolVotes`).

## Admissibility and dominance

The heuristic `h = (queryLen − right) · MICRO` is admissible and consistent.
`MICRO` is the smallest cost per byte, and only the suffix past the item is
counted.

Because the heuristic charges `MICRO` for a byte the goal will charge `PASS`
for, the search could spend up to `PASS/STEP` hops looking for one more
explained byte. Coverage cannot use them: every recognised completion of
`[i, j)` advances the cover at the same price. So a form or completion of
`[i, j)` that costs as much as one already yielded is **dominated**, and fires
no rule (`searchDominated`). Fusion, splicing and joining fire from the
completion the search stands on, never from every alternative it reached. That
makes the first hop's stop-here (`STEP + CONCEPT`) a real horizon.

## Policy is not cost

"Computation always wins" is not priced. A computed result costs `STEP`, like a
learnt edge. It is enforced by masking: `cover.ts` removes any recognised site
overlapped by a computed span. Keep policy in the callers, and keep the engine
neutral. Tuning `PASS` to encode a preference breaks the one contract the ladder
has, its order.

## Pins

- `test/04`, `test/55` — the decider's weighing, and the cost meter.
- `test/151` — dominance: a hub's degree generates no work in the chart.
- `test/52`, `test/53`, `test/54` — instrumentation of the climb, the
  cross-region probe and evidence `k`.
