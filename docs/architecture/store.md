# Store — AbstractStore Owns the Domain, Adapters Own the Wires

> **Law:** `AbstractStore` (`src/store.ts`) owns every domain decision — dedup,
> near-dedup, gist/halo indexing, containment, batching, LRU, compaction.
> `SQliteStore` (`src/store-sqlite.ts`) implements only `_db*`/`_vec*` thin
> wrappers.

## Template method

```
AbstractStore          all logic: caches, merge gates, halo schedule,
                       buffers, chain transparency, length walks
  └─ SQliteStore       SQL + VectorDatabase glue — one statement per method
  └─ <NewBackend>      same contract — subclass AbstractStore only
```

A new backend subclasses `AbstractStore`; never re-implements dedup or batching.

## IDs and leaves

Branch ids are dense non-negative `0,1,2,…` (`_nextId`, never deleted).
Single-byte leaves are **implicit** negative ids `-256..-1` (`-(byte+1)`), never
a row. `has(id)` is `id < 0 || id < _nextId`.

## Flat branches and bytes

A branch whose kids are all leaves is **flat** — stored as raw bytes in `leaf`
with an empty `kids` blob as marker (`flatKidsBytes`/`flatBytesKids`). Dedup
probes hash then verify: `hashOf`→`h`→`LIMIT 1` fetch→byte compare (bloom
negative filter first).

`bytes(id)`/`bytesPrefix(id, cap)` are shared with `BoundedMap` caches — callers
must **never mutate** the returned buffer. `contentLen(id, cap)` walks with
memo; when `cap` is given it saturates (`>= cap` without finishing) so one huge
root never costs a full walk.

## Gist, halo, dedup

On `put*`, content dedup (`hashOf`→probe→mint) gates first. `DedupKey` caches
short keys (`DEDUP_KEY_MAX` bypass). Near-dedup merges by `mergeThreshold(D)` on
unit gist cosine. Gists sit in `_pendingGist` (byte-budgeted `BoundedMap`);
`indexSubtree` & `pourHalo` promote via `_vecContentUpsert`/`_vecHaloUpsert` in
`batchSize` batches. Buffers flush on cadence, `commit()`, and close. Halo mass
re-indexes geometrically (`mass<=4 || powerOfTwo`) and encodes 2-bit quantized.
Canon index is optional: `canonAdd`/ `canonFind`/`canonCount` over 32-bit
canonical hashes, caller verifies bytes.

## Containment, batching, LRU

`addContainer(child,parent)` buffers per child; flush appends via
`_dbAppendContain` (packed pages, geometric merge) — never rewrite the whole
list. `containersSlice` pages through it. Edges and kids write through the same
deferred transaction.

Every in-memory cache is a `BoundedMap` with byte accounting and eviction (`lru`
vs `smallest` + `clock`/`reorder` recency). ANN reads
(`resonate`/`resonateHalo`) are content-addressed (`vecKey`) and dropped on any
index mutation; `RESONATE_CACHE_MAX=4096`.

## Maintenance (incremental)

- `compactContentIndex(minParents)` — scans only entries since last watermark
  (`_vecContentEntriesSince`), removes indexed-but-isolated nodes (`<minParents`
  parents, no edges/halos), compacts the vector DB.
- `repairContentIndex(regenerateGist)` — walks `_dbEdgeOrHaloIds()` candidates
  only, re-inserts missing bridge nodes whose gists were evicted before
  indexing.
- `buildCanonIndex` (`_buildCanonIndex`) — iterates `eachContent(fromId)` and
  `canonAdd`s; `fromId` makes refresh incremental.

Full scans (`parents()`, `next()`, `containers()`) are maintenance-only — hot
paths use `LIMIT`ed probes (`parentsFirst`/`nextFirst`/`prevFirst`), `has*`,
`prevCount`.

## Adding a backend

Implement every `protected abstract _db*`/`_vec*` in `src/store.ts` as a thin
wrapper around your storage. Keep `_dbGet*First`/`Slice` as real `LIMIT` queries
and `has*`/`COUNT` as point probes — never materialise-then-slice.
