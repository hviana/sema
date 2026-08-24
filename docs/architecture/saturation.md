# Saturation — Named Stop, Not Cap

> **Law:** every walk names a deciding saturation beside its cap. The cap is a
> safety net; saturation is the derived stop that decides and terminates.

A walk with only a cap drifts to the cap. A walk with a saturation stops the
moment the answer (saturated vs. decided) is known — bounded, exact below the
bound, and named in the trace.

## Cap vs. saturation

| Role       | Value                                                        | Nature                                           |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------ |
| Cap        | `hubBound = ceil(sqrt(N))` per read; `hubBound * W` per walk | Safety net — prevents corpus-proportional work   |
| Saturation | Named derived stop (`SaturationReason`)                      | Decision — proves continuing cannot discriminate |

`N = corpusN = max(2, edgeSourceCount())`, `W = maxGroup`. Defined once in
`mind/traverse.ts` (`corpusN`, `hubBound`, `boundFor`); never spelled inline.

## edgeAncestors — EXPAND-UNTIL-DECIDED

`mind/traverse.ts:edgeAncestors` is the model: it climbs the structural DAG
(parents + containment) until one of five saturations decides, and is exact
below every one of them.

1. **Predecessor fan-in** — `prevCount(node) > bound` via `store.prevCount`. One
   indexed count; no read. Proves `> bound` distinct contexts on its own.
2. **Distinct-context limit** — `ctxSeen.size > bound` after
   `prevFirst(node, bound)`. The accumulated set of distinct contexts reachable
   from roots visited so far exceeds `sqrt(N)`.
3. **Parent fan-out** — `parentsFirst(node, bound+1).length > bound`. One
   `LIMIT bound+1` read distinguishes "exactly bound parents" from "hub". The
   node itself is not expanded; saturated reaches are never voted.
4. **Lateral-cone cumulative** — `lateral > bound`, where `lateral` sums
   `fresh-1` over every expanded node's extra parents beyond its first. The
   per-node guard catches concentration at one node; this catches the same
   commonness distributed across the cone. A deep chain in one structure accrues
   zero laterals and still reaches its root at any depth.
5. **Byte-atom commonality** — `atomIsHub(N,W)` when
   `atomReach(N,W) = max(1, ceil(N*W/256)) > bound`. Atoms carry no kid/contain
   rows, so containment is unmeasurable; the uniform-expectation floor replaces
   it. Above the scale the atom abstains as voter (edges remain traversable for
   tier-0 recall).

Below every threshold the walk is exact — `prevFirst(bound)` is the full list,
`parentsFirst(bound+1)` is the full list, `containersSlice` pages are walked in
full — identical to the unbounded climb. Work is `O(bound)` contexts times local
structure, never `O(N)`. Container seeding is streamed in `bound`-sized pages
for the same reason.

Trace records the first deciding stop as
`SaturationStop { reason, node, observed, limit }` plus `visited`/`maxDepth`;
absent when unsaturated or untraced.

## pivotInto — longest-wins

`mind/resonance.ts:pivotInto` ranks candidates by `contentLen(id, answerLen+1)`
descending (first-inserted tie-break). The byte score is length itself, so the
scan is decided at the first candidate that passes every filter — a shorter
candidate can never outscore it. At most one winner's bytes are reconstructed;
every shorter proposal is skipped without a read. Saturation, not cap.

## Junction — hub guards vs. budget

`mind/junction.ts:junctionContainersFrom` has three disciplines:

- **Phrase-scale reads** — `bytesPrefix(maxContainer+1)` per visit; a node
  beyond the cap prunes its branch.
- **Per-node hub guards** (real saturations) — `parentsFirst(bound+1) > bound`
  not expanded; one `containersSlice(bound+1)` page beyond `bound` not expanded.
  Each is exact below `bound`.
- **Expansion budget** — at most `bound * W` pops total (shared across a tier's
  walks). Budget exhaustion is an abstention (`junctionBudgetExhausted`) that
  falls through to the resonance tier — a net, not a saturation.

Refuted tightening: applying `edgeAncestors`' cumulative lateral-cone limit here
would discard half the successful junctions (measured lateral 1425/1426 at
`bound` ~ 570).

Refuted early-stop: **one-cone-exhausted** — stopping when one side's upward
cone empties — is wrong in both hub-guarded and hub-flagged forms. A junction
can be reachable from only one side when that side's seed is a fold sub-node of
the container (`test/16`: "cold or hot" reached from window "cold" while 3-byte
"hot" cone is empty; `test/34` n-ary binding fails the same way). Exhausting one
cone never proves no junction remains; the walk must keep the `bound*W` net
after per-node saturations.

## Pins

- `test/16` — one-cone-exhausted refutation (bridge junction).
- `test/34` — one-cone-exhausted refutation (n-ary cross-region binding).
- `test/27` — saturation-drop gate (leading/trailing saturated intervals).
