# Saturation — A Named Stop, Not a Cap

> **Law:** every walk names the saturation that decides when it stops, beside
> its cap. The cap (`bounded-reads.md`) is a safety net. The saturation is a
> derived proof that continuing cannot discriminate, and it is recorded in the
> trace.

**Why.** A walk with only a cap drifts to the cap and stops at an arbitrary
place. A walk with a saturation stops the moment the outcome is known, is exact
below every stop, and says why it stopped. Sema may cap, but it must justify
every stop.

The trace records the first stop that decides as
`SaturationStop { reason, node, observed, limit }`, together with `visited` and
`maxDepth`.

## `edgeAncestors` — expand until decided (`mind/traverse.ts`)

The model walk climbs parents, and the chunks a window overlaps (its
neighbourhood), to the contexts it reaches, and stops at the first of five
saturations, each exact below its threshold (`bound = √N`):

1. **Predecessor fan-in.** `prevCount(node) > bound`: one indexed count proves
   more than `bound` contexts.
2. **Distinct contexts.** `ctxSeen.size > bound` after `prevFirst(node, bound)`.
3. **Parent fan-out.** `parentsFirst(node, bound + 1)` returns more than
   `bound`, and the node is not expanded.
4. **Lateral cone.** The extra parents summed over every expanded node exceed
   `bound`. Commonness spread across the cone is caught as surely as commonness
   concentrated at one node, while a deep chain inside one structure accrues no
   laterals and reaches its root at any depth.
5. **Byte atoms.** Atoms carry no parent or containment rows, so their reach is
   UNKNOWN, and unknown is neither rare nor common: an atom never votes, at any
   corpus size (`byte-atom-unobservable`), though its edges remain traversable.
   A query whose only regions are single bytes commits no point of attention
   through them (`test/35`). (It used to abstain only past
   `atomReach(N, W) = ⌈N·W/256⌉ > bound` — a uniform expectation that called a
   byte occurring nowhere common and let the same byte vote on a smaller store.)

Below every stop, the walk equals the unbounded climb, and its work is
`O(bound)` contexts, seeds streamed in `bound`-sized pages. A stop ends a VOTE;
an enumerator whose members are checked exactly reads a sample past it (a
frame's instances, `evidence.md`).

**Refuted:** treating container fan-out as a hub. It confuses the _places_ a
window occurs with the _contexts_ it reaches (`test/49`: `fran`, 4 containers, 2
contexts). So is counting holders only: it lost answers on every 2Wiki fixture,
held-out too, as the neighbourhood silences frame windows; holders are read by
bytes (`heldElsewhere`). It answers `held`, `apart` or `saturated`: a net the
budget cut off is not a holder found, and its caller abstains on it explicitly.

## `pivotInto` — the longest wins (`mind/resonance.ts`)

Candidates are the THINGS the answer holds (`thingsIn`, `mind/recognition.ts`):
the stored forms recognition reads in the answer and in its canonical spelling
(the canonical class without an index), each learnt whole and leading on — the
same set the cover's derive-through reads (`entityProposals`). A resonance sweep
of the answer's sub-regions and a `canonResolve` scan of every span proposed
nothing more (suite, 900 fresh queries). Candidates rank by span length,
descending, recognition's order breaking ties, so the first one passing the
filters wins; containment is the span itself. A thing is a learnt whole: `s=70`
was learnt only as a piece of `latency_ms=70`. Structure is not the test: the
content-defined cuts reuse a name's subtree inside its own contexts
(`William Henry Fellowes`: parents 2), and refusing such a name stopped the walk
a hop short (`test/157`).

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
- **Stopping when one side's cone is exhausted.** A junction can be reachable
  from one side only, when that seed is a fold sub-node of the container: in
  `test/16`, `cold or hot` is reached from `cold` while `hot`'s cone is empty.

## Pins

- `test/16`, `test/34` — refute stopping when one cone is exhausted, in the
  bridge junction and in n-ary cross-region binding.
- `test/27` — a shared saturated opening does not take the climb's focus; the
  identity layer alone keeps it past the opening (a separate drop of saturated
  intervals was measured redundant and removed).
- `test/49` — refutes treating container fan-out as a hub.

## A shared opening is nobody's evidence

A preamble every deposit carries (a system prompt) is hash-consed into one
structure, so no structural count sees it as common: its windows have few
containers. The climb's own proposals do: the bytes the question begins with
that every ranked anchor begins with too distinguish none of them. A further
point of attention whose focus starts inside that opening is refused as a root
(`leading-scaffolding`); the dominant is exempt, as it is from the vote gates
(`commitVotes`, `test/17`). The votes of regions lying in it are dropped before
pooling.

Fusion does not fuse a point whose strongest evidence is shorter than a window,
however many places it is read in. If the strongest place is under a window,
every place is. Two 3-byte scraps of a preamble name no further topic
(`reasoning.ts`, `test/17`).

## The ranking is an estimate

A region votes through its nearest resonance hit, and that order is an estimate.
A top hit that climbs to no context (an orphan) hands the vote to the nearest
hit that climbs; a saturated top hit claims the region's abstention only when it
is distinguishably nearest — within the estimator's noise (`estimatorNoise`) the
nearest tied hit that climbs somewhere unsaturated votes instead. Both are
traced as `anchorFallback` (`test/52`).
