# Confluence — Where Independent Conditions Meet

Some questions state several conditions, and their answer lives in no single
fact, only where the conditions intersect. Each condition reaches its own stored
contexts, and the thing that satisfies all of them sits at their meeting point
(`src/mind/mechanisms/confluence.ts`, `confluenceJoin`).

## Matcher — streams from the climb

The streams are the consensus climb's ranked anchors (`pre.attention()`,
`crossRegionVotes`), each bound by identity to a discriminating span of the
question. Two streams are independent when their spans are disjoint. The meet is
a set intersection by content-addressed window identity (`windowsOf`): a window
present in both anchors and absent from the question.

## Gate — corpus-global commonality

A window's `reachOf` is gated by `dominates(reach, N)` (`commonality.md`). A
window reached by a majority of contexts is scaffolding: it never binds a
condition and never survives the meet. A minority reach is a filler, an entity.
A meet on a single window, or a span shorter than `2W`, is refused.

## Cost

`3·STEP`: two conditions and the meet. That is also its floor, so the climb is
never touched unless `worthRunning(3·STEP)` holds (`mechanism-market.md`).

## Provenance

`join`, which belongs to this mechanism alone.

## Pins

- `test/32` — two-condition intersection, invariance to the order of the
  conditions, honest silence on an empty intersection, and relational joins
  across domains.
