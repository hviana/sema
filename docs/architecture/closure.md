# Closure — One Law, One Unit, Every Transition

> **Law:** a step is admitted only when it CLOSES the derivation, or MOVES to
> structure it has not consumed, or CARRIES material the asker left unaccounted.

One unit and one law, asked by every tier that decides whether to continue: the
chart's frontier, the market's candidates, the post-grounding walk, fusion, and
the mechanisms' own gates. None re-spells a condition the law owns.

## The unit — `src/mind/derivation.ts`

| Field       | What it is                                            |
| ----------- | ----------------------------------------------------- |
| `product`   | the answer bytes so far                               |
| `accounted` | the spans of the asker's bytes it explains            |
| `remainder` | what the asker still owes, per span, at the `W` floor |
| `cost`      | the currency's total for the steps taken              |
| `fixed`     | a declared fixpoint: no transition is offered         |
| `used`      | the anchors the producer speaks for                   |

No identity field (`resolve(product)` is one), no structure field, no frontier
field, no producer field, and no count of any kind. The witnesses `contains` and
`moves` are the LAYER's: it holds the structure and hands them in, so the law
never probes the store.

## The boundary

`product` (what it stands on, its identity being `resolve(product)`),
`accounted` (the price its steps summed) and `remainder` (the question's debt,
at one quantum) are the derivation's own. What it REACHED and what it SPENT are
the layer's (`reaches`, `consumed`), never a field here: the law decides
admission and consumption, the layer decides frontier and termination.

## The transition

`admissible(state, continuation, query, W)` returns the witnesses the step pays
in, or `null`; `advance(state, continuation, witnesses)` is the only transition.
The remainder is consumed only by a declared move, and only by the material that
move CARRIES: `carries` admits by ENGAGEMENT and consumes nothing, a move
consumes what its window proves. Whole-span draining was refuted by `test/110`,
the window alone by `test/138`. The state is BORN owing what its product does
not carry.

The walk ends when the layer stops offering or the law refuses; owning no
search, the law cannot prevent a cycle — that is the layer's, over the structure
it holds.

## One cost home

`moves + PASS · unaccountedBytes` is computed in ONE place (`pipeline.ts`,
`weigh`). A mechanism reports `moves` and `accounted` — what it did — and never
a price; `cover` reports its chart derivation's work.

## Two limits, proved and left out

1. **The chart cannot evaluate accounting** — its interface has no parameter for
   it, and carrying it per item was measured and rejected. The chart reads the
   same law off an item: identity is its `key`, continuation the rule's
   existence, progress the frontier advancing, closure the goal test, `fix` is
   `fixed`.
2. **Closure by the query's position in the graph is not a term of the unit** —
   `reason`'s echo guards stop with the remainder non-empty, and recall's
   reverse tiers close with an empty accounting. That is a fact about the
   asker's material in the store, available only to the layer holding it.

## Layering

Imports `../bytes.js` only, and sits below `graph-search.ts`, `match.ts`,
`rationale.ts` and `pipeline.ts`. The span algebra lives here too — the law's
vocabulary, not the tracer's.

## Pins

- `test/133`–`137` — the law's home, readings, refusal, limits.
- `test/138` — a cycle cannot close it, a carried move can.
- `test/139` — carrying is ENGAGEMENT, not explanation.
- `test/140` — irrelevant supply changes nothing.
- `test/142`, `test/143` — the offer's contract, and the cycles.
- `test/144`, `test/146`, `test/147` — identity is content, the `contains` gate,
  the witness ladder.
