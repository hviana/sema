# Closure — One Law for Every Transition

> **Law:** a step is admitted only when it **closes** the derivation, **moves**
> to structure the derivation has not consumed, or **carries** material the
> asker left unaccounted.

**Why.** Every tier that decides whether to continue asks this one law, and none
re-spells a condition it owns. Those tiers are the chart's frontier, the market,
the walk after grounding, fusion, and the mechanisms' own gates. Without the law
a derivation could wander: restate what it already said, cycle, or extend into
facts nobody asked for.

## The unit — `DerivationState` (`src/mind/derivation.ts`)

| Field       | Meaning                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `product`   | the answer bytes, what the derivation stands on; its identity is `resolve(product)` |
| `accounted` | the asker's spans its steps explain, a cost quantity                                |
| `remainder` | what the asker still owes, per span, at the `W` floor; empty means **closed**       |
| `cost`      | its position on the ladder                                                          |
| `fixed`     | a declared fixpoint: the query _is_ the context, so no transition is offered        |
| `used`      | the anchors the product speaks for; an empty set declares that it voices nothing    |

There is no identity field, no frontier, no producer and no count. What the
derivation _reached_ and _spent_ belongs to the layer, which holds the structure
and hands the law its witnesses (`contains`, `moves`). The law never probes the
store.

## The transition

`admissible(state, continuation, query, W)` returns the witnesses a step pays
in, or `null`. `advance(state, continuation, witnesses)` is the only transition.
No state is built by hand anywhere else (`test/137.7`).

- **A state is born owing** everything its product does not carry.
- **`carries` admits by engagement and consumes nothing.** Only a declared move
  consumes, and only the material its window proves. Both shortcuts were
  refuted: draining whole spans (`test/110`) and trusting the window alone
  (`test/138`).
- **A step the question did not name pays from what it still owes.** Naming is
  the evidence law (`evidence.md`).
- **The law owns no search, so it cannot prevent a cycle.** That belongs to the
  layer, which holds the structure. A fusion the law refuses is simply not
  taken, and there is no hand-built fallback.

## The engine — `closeOver`

`closeOver(state, query, W, layers)` closes a derivation layer by layer. A layer
(`ClosureLayer`) is a named offer with its own instrumentation. Layers are
phases: each runs to its own end, in order, and is never revisited.

- **"Not fixed" is checked first.** A fixed state admits no transition, so no
  layer is entered.
- **Engagement is the layer's.** A layer with nothing to offer a state
  (`engages`) is not entered, and pays no offer and no meter phase.
- **The pipeline's post-grounding stage is this engine,** with two layers. The
  walk (`walkLayer`) absorbs forward or pivots. The fusion (`fusionLayer`) makes
  one composed transition, and engages only while the derivation is open.

## What the law decides, and what it does not

- **The offer of a hop is a consequence.** The chart offers the corpus's
  continuations under the read cap, each a move priced `STEP`, and the search
  decides (`test/112`).
- **The depth of a join is a consequence.** A join consumes the shortest tail
  prefix that names a learnt key leading somewhere, and chains until the tail is
  consumed (`test/108`). It is priced only for the facts the lightest derivation
  stands on, never for everything the exploration reached (`test/150`).
- **A gap's reach is not a consequence everywhere.** In alignment it is: the
  walk goes outward with no cap. Recognition's interior pass is bounded at
  `W⁴ + 2r`, because exact unbounded reach would need a whole-stream index the
  store does not have.

Three limits were proved and deliberately left out:

1. **The chart cannot evaluate accounting.** Carrying it per item was measured
   and rejected, so the chart reads the law off its items: identity is the key,
   continuation is a rule existing, closure is the goal test.
2. **Closure by the query's position in the graph is the layer's, not the
   unit's.** The echo guards stop with the remainder non-empty, and recall's
   reverse tiers close with nothing accounted.
3. **The extension is not priced into the market.** Only the winner is closed,
   because pricing every candidate's closure has not been measured
   (`test/136.2`).

## Layering

`derivation.ts` imports only `../bytes.js` and sits below `graph-search.ts`,
`match.ts`, `rationale.ts` and `pipeline.ts`. The span algebra
(`unexplainedSpans` and its relatives) lives here as the law's vocabulary.

## Pins

- `test/133`–`137` — the law's home, its readings, refusal and limits.
- `test/138`, `test/139` — a cycle cannot close a derivation, and a carried move
  can; carrying is engagement, not explanation.
- `test/142`, `test/143` — the offer's contract, and the cycles.
- `test/149` — the engine: "not fixed" first, layers as phases, engagement, and
  no layer sequenced by hand.
- `test/150`, `test/151` — the join prices only what the derivation stands on,
  and a hub's degree costs nothing.
