# Three Measures of Commonality

Sema needs "what is shared" in three populations: corpus-global (how widely a
structure is reused), weave-local (what a local cohort of overlapping forms
agrees on), and container-local (how many containers hold a byte window).
Different data, different formulas, never conflated.

## Corpus-global — `reachOf` + `dominates`

_Defined in `src/mind/traverse.ts` + `src/geometry.ts`; used by climb,
containment, IDF pooling._

For a node id, `reachOf(id, N)` counts how many learnt contexts contain it
(capped graph walks, memoised per response in `sharedReachMemo`).
`dominates(reach, N)` asks whether that reach is above the corpus-determined
majority threshold (`geometry.ts`, over `N`). Minority reach discriminates (a
filler), majority reach is scaffolding. Powers the climb, edge following and
vote pooling.

## Weave-local — `depth[]` + `MIN_WEAVE` + `dominates`

_Defined and gated in `src/mind/mechanisms/cast.ts` (`depth[]` from the shared
weave, `MIN_WEAVE`); used by CAST._

For an alignment weave, `depth[i]` counts how many aligned structures cover byte
`i` of the query; `MIN_WEAVE = 2` requires agreement beyond a pair (pairs are
ambiguous with insertions), and `dominates(depth[i], aligned)` a majority of the
cohort:

```
frame(i) ⇔ depth[i] > MIN_WEAVE ∧ dominates(depth[i], aligned)
```

This powers CAST's frame gate — what the cohort shares vs what differentiates
one member — and never consults corpus reach.

The three answer different questions over different populations; CAST's frame
must not be replaced by a reach check, and the climb must not be driven by weave
depth.

## Container-local — the window's rarity

_Defined in `src/mind/bridge.ts` (`containersSlice(id, 0, bound + 1).length`);
used by the bridge, and by attention's anchoring._

`rarity` counts how many containers hold a byte window: zero anchors nothing,
two or more marks it REUSED (`winReused`), and the bridge sorts its anchors by
it, so the rarest leads. Purpose: choosing what to anchor on.

## Pins

- `test/17` — weave-local frame / `MIN_WEAVE` / `dominates` vs corpus-global
  reach.
- `test/34` — containment and reach-driven disambiguation.
