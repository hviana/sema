# Closure — One Law, One Unit, Every Transition

> **Law:** a step is admitted only when it CLOSES the derivation, or MOVES to
> structure it has not consumed, or CARRIES material the asker left unaccounted.

One unit and one law, asked by every tier that decides whether to continue: the
chart's frontier, the market's candidates, the post-grounding walk, fusion, and the
mechanisms' own gates. None re-spells a condition the law owns.

## The unit — `src/mind/derivation.ts`

| Field | What it is |
| --- | --- |
| `product` | the answer bytes so far |
| `accounted` | the spans of the asker's bytes it explains |
| `remainder` | what the asker still owes, per span, at the `W` floor |
| `cost` | the currency's total for the steps taken |
| `fixed` | a declared fixpoint: no transition is offered |
| `used` | the anchors the producer speaks for |

No identity field (`resolve(product)` is one), no structure field, no frontier
field, no producer field, and no count of any kind.  The witnesses `contains` and
`moves` are the LAYER's: it holds the structure and hands them in, so the law never
probes the store.

## The transition

`admissible(state, continuation, query, W)` returns the witnesses the step pays in,
or `null`; `advance(state, continuation, witnesses)` is the only transition.  The
remainder TRAVELS UNCHANGED — a step engages what is left, it does not consume it
(measured: draining it let `test/110`'s chain drift one hop past its answer).

## One cost home

`moves + PASS · unaccountedBytes` is computed in ONE place (`pipeline.ts`, `weigh`).
A mechanism reports `moves` and `accounted` — what it did — and never a price;
`cover` reports the discrete work of its chart derivation.

## Two limits, proved and left out

1. **The chart cannot evaluate accounting** — its interface has no parameter for it,
   and carrying it per chart item was measured and rejected.  The chart reads the
   same law off an item: identity is its `key`, continuation the rule's existence,
   progress the frontier advancing, closure the goal test, `fix` is `fixed`.
2. **Closure by the query's position in the graph is not a term of the unit** —
   `reason`'s echo guards stop with the remainder non-empty, and recall's reverse
   tiers close with an empty accounting.  That is a fact about the asker's material
   in the store, available only to the layer holding it.

## Layering

Imports `../bytes.js` only, and sits below `graph-search.ts`, `match.ts`,
`rationale.ts` and `pipeline.ts`.  The span algebra lives here too — the law's
vocabulary, not the tracer's.

## Pins

- `test/133` — the state is rendered where it is decided; the law reads no producer.
- `test/134` — the law explains the engine's own refusal.
- `test/135` — one law over real states from three producers.
- `test/136` — the two limits above, with the measurements.
- `test/137` — the law lives once, and below everything that asks it.
