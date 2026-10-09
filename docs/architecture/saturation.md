# Saturation — A Named Stop, Not a Cap

> **Law:** every walk names the saturation that decides when it stops, beside
> its cap. The cap (`bounded-reads.md`) is a safety net. The saturation is a
> derived proof that continuing cannot discriminate, and it is recorded in the
> trace.

**Why.** A walk with only a cap drifts to the cap: it spends the whole budget
and stops at an arbitrary place. A walk with a saturation stops the moment the
outcome is known, is exact below every stop, and says why it stopped. Deflate's
match finder truncates long chains arbitrarily. Sema may cap, but it must still
justify every stop.

The trace records the first stop that decides as
`SaturationStop { reason, node, observed, limit }`, together with `visited` and
`maxDepth`.

## `edgeAncestors` — expand until decided (`mind/traverse.ts`)

This is the model walk. It climbs parents and containers from a node to the
learnt contexts it reaches, and stops at the first of five saturations. Each is
exact below its threshold (`bound = √N`):

1. **Predecessor fan-in.** `prevCount(node) > bound`: one indexed count proves
   more than `bound` contexts.
2. **Distinct contexts.** `ctxSeen.size > bound` after `prevFirst(node, bound)`.
3. **Parent fan-out.** `parentsFirst(node, bound + 1)` returns more than
   `bound`, and the node is not expanded.
4. **Lateral cone.** The extra parents summed over every expanded node exceed
   `bound`. Commonness spread across the cone is caught as surely as commonness
   concentrated at one node, while a deep chain inside one structure accrues no
   laterals and reaches its root at any depth.
5. **Byte atoms.** Atoms carry no containment rows, so their reach is
   unmeasurable, and the uniform expectation `atomReach(N, W)` replaces it. Past
   `bound`, an atom abstains as a voter (`atomIsHub`), though its edges remain
   traversable.

Below every stop, the walk equals the unbounded climb, and its work is
`O(bound)` contexts. Container seeds are streamed in `bound`-sized pages.

**Refuted:** treating container fan-out as a hub. It confuses the _places_ a
window occurs with the _contexts_ it reaches, and saturation is defined over
contexts. On `test/49`, `fran` sits in 4 containers yet reaches 2 contexts, and
the rule called it saturated.

## `pivotInto` — the longest wins (`mind/resonance.ts`)

Candidates rank by `contentLen(id, answerLen + 1)`, descending, with
first-inserted breaking ties. The score is length itself, so the first candidate
that passes every filter wins, and no shorter candidate's bytes are ever read. A
candidate must be a learnt whole: a span with parents or containers and no halo
is a piece of bigger forms (`s=70`). Structure alone over-reads, because the
content-defined cuts can reuse a name's subtree inside its own contexts
(`William Henry Fellowes`: parents 2, halo 2), and refusing such a name stopped
the walk one hop short (`test/157`).

## Junction ascent — guards against a budget (`mind/junction.ts`)

`junctionContainersFrom` keeps three disciplines apart:

- **Phrase-scale reads.** `bytesPrefix(maxContainer + 1)` per visit; a node past
  the cap prunes its branch.
- **Hub guards, which are true saturations.** A node is not expanded when
  `parentsFirst(bound + 1)` or one `containersSlice` page exceeds `bound`.
- **The expansion budget, a net.** At most `bound · W` pops, shared across a
  tier's walks. Running out is an abstention (`junctionBudgetExhausted`), and
  the search falls through to the resonance tier.

Two tightenings were refuted:

- **The lateral-cone limit from `edgeAncestors`** would discard half the
  successful junctions (lateral 1425 of 1426 at `bound` ≈ 570).
- **Stopping when one side's cone is exhausted** is wrong. A junction can be
  reachable from only one side when that side's seed is a fold sub-node of the
  container. In `test/16`, `cold or hot` is reached from `cold` while the cone
  of `hot` is empty. Exhausting one cone never proves that no junction remains.

## Pins

- `test/16`, `test/34` — refute stopping when one cone is exhausted, in the
  bridge junction and in n-ary cross-region binding.
- `test/27` — dropping saturated leading and trailing intervals from the climb.
- `test/49` — refutes treating container fan-out as a hub.
