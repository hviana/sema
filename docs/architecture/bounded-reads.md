# Bounded Reads — No Per-Query Read Grows With the Corpus

> **Law:** the cost of one query is proportional to the query, not to how much
> was learned. No per-query read may grow with corpus size N.

Every fan-out, walk, and disambiguation reads at most the OLDEST `hubBound` —
`ceil(sqrt(N))`, floored at 2 for a near-empty store. A better-supported
candidate beyond that prefix is invisible: a trade, and there is no second
convention.

## Scale

```
corpusN(ctx) = max(2, store.edgeSourceCount())   // distinct learnt contexts
hubBound(ctx) = ceil(sqrt(corpusN(ctx)))          // >= 2, the store cap
hubCap(ctx, ids) = ids.slice(0, hubBound(ctx))    // list-side reading
boundFor(n) = ceil(sqrt(max(2, n)))               // ctx-free reading
```

Defined once in `mind/traverse.ts` (`corpusN`, `hubBound`, `hubCap`,
`boundFor`). Every consumer imports them; never re-derive them inline.

## Enforcement at the store level

The cap is not advisory — adapters must make bounded reads bounded in SQL.

### 1. LIMITed reads — real `LIMIT ?`

`nextFirst(id, limit)`, `prevFirst(id, limit)`, `parentsFirst(id, limit)`,
`containersSlice(child, offset, limit)`.

Same statement and `ORDER BY` as the full read, with `LIMIT ?`. Never
"materialise then slice". Reading `hubBound + 1` parents decides "hub or not"
exactly without reading the rest. Implemented as thin wrappers in
`store-sqlite.ts` over `AbstractStore` in `store.ts`.

### 2. Existence probes — indexed point probes

`hasNext(id)`, `hasParents(id)`, `hasContainers(child)`, `hasHalo(id)`,
`prevCount(id)`.

One indexed `EXISTS` / `COUNT` probe that never decodes vectors or unpacks
blobs. Use them for every "does this lead anywhere?" question instead of
`next(id).length > 0` or `prev(id).length`. `prevCount` is the reverse-edge
support count for `chooseNext`/`chooseAmong`; `hasNext`/`hasHalo` gate the
`leadsSomewhere` admission predicate in `mind/traverse.ts`.

### 3. Prefix-capped reads — reject without reconstruction

`bytesPrefix(id, cap)` and `contentLen(id, cap)`.

`contentLen` under a cap returns an exact length below the cap and `>= cap`
otherwise — an indexed memo walk that stops early, never a full subtree walk.
`bytesPrefix` stops after `cap` bytes. A candidate exceeding the cap is rejected
on the length probe alone; the weave, junction walks, and bridge all read this
way. Uncapped reads there cost seconds per query on a large store.

### 4. Transparent scaffolding — one bounded read

`chainRun(id)` climbs a run of transparent nodes (exactly one parent, no edges)
in a single recursive CTE, cached for the store lifetime and dropped on writes
that break transparency. The climber hops the whole run where a node-at-a-time
ascent would pay three probes per node.

## Maintenance only

The full materialising reads — `next(id)`, `prev(id)`, `parents(id)`,
`containers(child)` — exist for inspection, repair, and compaction only
(`compactContentIndex`, `repairContentIndex`). Keep them off hot paths.

## Adding a walk

Any new fan-out walk uses `hubBound`/`hubCap`. Do not call `edgeSourceCount()`
or `Math.ceil(Math.sqrt(...))` inline, and do not invent a per-walk limit. The
walk's saturation decision (when to stop) is separate from the cap (the safety
net); a walk with only a cap drifts to the cap.

## Pins

- `test/14` — sublinear inference in corpus size and constant-rate in input
  length; training throughput floor; exact recall at scale.
- `test/89` — completion recursion stays output-sensitive (nested searches/pops
  sublinear); guards the count of reads, not just per-read size.
- `test/90` — connector probe (`resolveConnectors`) reads by the query length
  (`QUERY.length + 1`), not by the learnt continuation; per-read size bound.
