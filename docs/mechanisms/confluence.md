# Confluence — Multi-Condition Meeting Point

Conjunctive queries whose answer lives in no single fact, only where independent
evidence streams intersect. Each condition reaches its own exemplar set; the
entity satisfying all lives at their meeting point.

Source: `src/mind/mechanisms/confluence.ts` (`confluenceJoin`,
`confluenceMechanism`).

## Matcher

`crossRegionVotes` tiers over the consensus climb (`pre.attention()` ranked
anchors). Streams are anchors bound by identity to disjoint discriminative query
spans; two streams are independent when their `cover` spans are disjoint. The
meet is set intersection by content-addressed identity (`windowsOf` /
`findBranch` window ids): present in both anchors, absent from the query.

## Gate

Corpus-global IDF, not weave-local. A window's `reachOf(ctx, wid, N, memo)`
(`edgeAncestors` contexts-reached via `sharedReachMemo`) is gated by
`dominates(reach, N)` (`geometry.ts` half-dominance, `reach*2 > N`). Majority
reach is scaffolding and never binds a constraint nor survives the meet;
minority reach is filler/entity. Single-window meets and sub-`2W` spans are
refused.

## Cost

One currency (`mind/graph-search.ts`): `STEP=1`, `CONCEPT=10`, `PASS=1000`/byte.
`moves = STEP·slots + CONCEPT` (floor `3·STEP`: two constraints + meet). Weight
`moves + PASS·unaccounted` compared at `STEP` grade (`pipeline.ts:think`).

## Pins

`test/32-confluence.test.mjs` — two-constraint intersection, order invariance,
empty-intersection honesty, cross-domain relational joins.
