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
   through them (`test/35-attention-confidence`).

Below every stop, the walk equals the unbounded climb, and its work is
`O(bound)` contexts, seeds streamed in `bound`-sized pages. A stop ends a VOTE;
an enumerator whose members are checked exactly reads a sample past it (a
frame's instances, `evidence.md`).

**Refuted:** treating container fan-out as a hub, which confuses the _places_ a
window occurs with the _contexts_ it reaches (`test/49`: `fran`, 4 containers, 2
contexts); and counting holders only, which loses answers on every 2Wiki fixture
as the neighbourhood silences frame windows. Holders are read by bytes
(`heldElsewhere`: `held`, `apart`, or `saturated`, on which the caller
abstains).

## `pivotInto` — the longest wins (`mind/resonance.ts`)

Candidates are the things the answer holds (`thingsIn`, `mind/recognition.ts`),
exact or canonical, learnt whole and leading on: the set the cover's
derive-through reads (`entityProposals`). They rank by span length, descending,
recognition's order breaking ties, so the first one passing the filters wins. A
thing is a learnt whole (`s=70`, learnt only inside `latency_ms=70`, is none),
not a structural top: the fold reuses a name's subtree inside its own contexts
(`William Henry Fellowes`: parents 2), and refusing it stops the walk a hop
short (`test/157`).

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
- **Stopping when one side's cone is exhausted**, since a seed that is a fold
  sub-node of the container reaches it alone (`cold or hot` from `cold`).

## A shared opening is nobody's evidence

A preamble every deposit carries (a system prompt) is hash-consed into one
structure, so structural counts miss it, but the climb sees it: bytes every
ranked anchor begins with distinguish none. A further point focused there is no
root (`leading-scaffolding`; the dominant is exempt, `test/17`), the votes of
regions inside it are dropped, and fusion skips a point whose strongest evidence
is under a window (`reasoning.ts`).

## The ranking is an estimate

A region votes through its nearest resonance hit. An orphan top hit hands the
vote to the nearest hit that climbs, and a saturated one abstains for the region
only when nearest beyond `estimatorNoise` (`anchorFallback`, `test/52`).

## Pins

- `test/16`, `test/34` — refute stopping when one cone is exhausted, in the
  bridge junction and in n-ary cross-region binding.
- `test/27` — a shared saturated opening does not take the climb's focus; the
  identity layer alone keeps it past the opening.
- `test/49` — refutes treating container fan-out as a hub.
