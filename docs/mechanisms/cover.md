# Cover — Lightest Derivation over the Query

Cover is graph search. Its axioms are the query's own decomposition and its goal
is the cheapest cover of the query's bytes. It runs first so a computed-backed
cover becomes a near-zero-cost incumbent.

## Matcher — `locate` / recognition sites (`src/mind/recognition.ts`)

Sites are spans of the query that name a node already in the store. Cover
consumes them directly; any site whose bytes overlap a computed span is masked
(computation always wins).

## Projection — edges + conceptHop (`src/mind/match.ts`, `src/mind/graph-search.ts`)

- `formRules` follow continuation edges (`GraphSearch.formRules`): each hop
  costs `STEP` (1). Forks across all continuations up to the hub bound;
  disambiguation is distributional, not heuristic.
- Edge-less forms may hop via a halo sibling (`conceptHop` / `offerConcepts`) at
  `CONCEPT` (10), borrowing a synonym's continuation.
- A span's cheapest completion DOMINATES the rest (`buildSearch`): a form or
  completion of `[i, j)` whose cost has reached that of a completion of `[i, j)`
  already yielded fires no rule (`searchDominated`). Coverage is positional, so
  only the cheapest matters to the goal; the byte rules (fuse, splice, join)
  fire from the completion the search would stand on, never from every
  alternative it reached. It also makes the first hop's stop-here
  (`STEP + CONCEPT`) a real horizon for the chain.

## Gate — `leadsSomewhere` (`src/mind/traverse.ts`)

A site participates only if it leads somewhere: it bears an edge (`hasNext`) or
a halo (`hasHalo`). Forms that lead nowhere contribute nothing to any derivation
and are filtered during recognition.

## Cost (`src/mind/graph-search.ts`)

| Symbol    | Value       | Rule                                            |
| --------- | ----------- | ----------------------------------------------- |
| `STEP`    | 1           | per edge hop                                    |
| `CONCEPT` | 10          | abandoning a chain / synonym hop                |
| `PASS`    | 1000 / byte | each unaccounted byte                           |
| `MICRO`   | 1e-3        | per-byte A* heuristic (`h = (len-right)*MICRO`) |

The cover reports `moves` (its derivation's discrete work) and `accounted`; the
ladder prices both.

## Licensed premises (`src/mind/mechanisms/cover.ts`, `Licence` in `graph-search.ts`)

The synchronous search cannot run the async reads two of its rules need — a
concept target (a halo lookup) and a learnt connector between two answers (a
`bridge`). `offerConcepts` and `offerConnectors` OFFER the keys up front (cheap:
`hasNext`, the touching-site pairs and the N-ary allowances); the search ASKS
for an offered key only where it reaches it — a connector when its splice's two
premises meet, a concept target when the hop's asking form (held at the hop's
own cost) is popped. A cover that asked is provisional: `cover.run` grants the
asked keys and covers again, until a cover asks nothing — which is then the
cover every key resolved in advance would have made. The joins licensed by
ask-free rounds are kept across the re-covers.

## Provenance

`cover` for every cover derivation — including the fusion/recomposition steps
(`fuse`/`recompose`) that name a deeper learned form. (`join` is NOT cover's:
that provenance belongs to the CONFLUENCE mechanism, which reports it when
independent evidence streams meet at one anchor — see
`docs/mechanisms/confluence.md`.)

## Pins

- `test/09-edges.test.mjs` — edge following and hop semantics
- `test/19-nd.test.mjs` — form rules and multi-hop chains
- `test/151` — connectors and concept hops resolved where the search reaches
  them; a span's cheapest completion dominates (a hub's degree generates no
  work)
