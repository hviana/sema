# Two Measures of Commonality

Sema needs "what is shared" in two different populations. One is corpus-global
(how widely a structure is reused), the other is weave-local (what a local
cohort of overlapping forms agrees on). They use different data and different
formulas and must not be conflated.

## Corpus-global — `reachOf` + `dominates`

_Defined in `src/mind/traverse.ts` + `src/geometry.ts`; used by climb,
containment, IDF pooling._

For a node id, `reachOf(id, N)` counts how many learnt contexts contain it
(ancestor reach via capped graph walks, memoised per response in
`sharedReachMemo`). `dominates(reach, N)` then asks whether that reach is above
the corpus-determined majority threshold (derived in `geometry.ts` over `N`).
Intuition: minority reach discriminates (a filler), majority reach is
scaffolding. Powers the consensus climb, edge following, and vote pooling.

## Weave-local — `depth[]` + `MIN_WEAVE` + `dominates`

_Defined in `src/mind/match.ts` (`depth[]`, `MIN_WEAVE`, `frame`) and gated in
`src/mind/match.ts:frame`; used by CAST._

For an alignment weave, `depth[i]` counts how many aligned structures cover byte
`i` of the query. `MIN_WEAVE = 2` requires agreement beyond a pair (pair columns
are ambiguous with insertions/deletions), and `dominates(depth[i], aligned)`
requires agreement by a majority of the aligned cohort:

```
frame(i) ⇔ depth[i] > MIN_WEAVE ∧ dominates(depth[i], aligned)
```

This powers CAST's frame gate: what the local cohort shares vs what
differentiates one member. It never consults corpus reach.

The two measures answer different questions over different populations; CAST's
frame must not be replaced by a reach check and the climb must not be driven by
weave depth.

## Pins

- `test/17` — weave-local frame / `MIN_WEAVE` / `dominates` vs corpus-global
  reach.
- `test/34` — containment and reach-driven disambiguation.
