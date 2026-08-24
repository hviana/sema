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
- Edge-less forms may hop via a halo sibling (`conceptHop` / `resolveConcepts`
  in `src/mind/mechanisms/cover.ts`) at `CONCEPT` (10), borrowing a synonym's
  continuation.

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

Mechanism weight is `moves + PASS * unaccounted_bytes`; comparison is at `STEP`
grade, then by `scaffolding` bytes, then list order.

## Pre-resolution (`src/mind/mechanisms/cover.ts`)

`resolveConcepts` and `resolveConnectors` pre-resolve the async maps the
synchronous search cannot gather: concept targets and learnt connectors, keyed
by node pair. Bridges (`bridge`) splice connectors between rewrites.

## Provenance

`cover` for the query's own cover; `join` when fusing fragments into a deeper
learned form.

## Pins

- `test/09-edges.test.mjs` — edge following and hop semantics
- `test/19-nd.test.mjs` — form rules and multi-hop chains
