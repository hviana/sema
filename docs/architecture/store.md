# Store — A Content-Addressed DAG, One Owner of Its Logic

> **Law:** a node is named by its content, and equal content is stored once.
> `AbstractStore` (`src/store.ts`) owns every domain decision: dedup, merge,
> indexing, containment, batching, caching and maintenance. A backend
> (`store-sqlite.ts`) implements only thin `_db*`/`_vec*` wrappers.

## Nodes

| Kind        | Id                                              | Stored as                                                |
| ----------- | ----------------------------------------------- | -------------------------------------------------------- |
| byte leaf   | implicit, `-(byte+1)` in `−256…−1`              | nothing — it always exists                               |
| branch      | dense `0,1,2,…`, minted in order, never deleted | its ordered child ids                                    |
| flat branch | as a branch                                     | raw bytes, with an empty `kids` marker (`flatKidsBytes`) |

An id is an arbitrary mark; content decides which mark a thing gets. A subtree
shared by a thousand deposits is one node with a thousand parents, so storage
grows with distinct content, not with volume, and every span the fold produced
can be addressed.

## Interning — dedup, then same bytes, then near, then mint

`intern` runs four steps, in order:

1. **Exact dedup.** `findLeaf` or `findBranch` looks for equal content: a cache
   first, then a durable probe, so dedup survives a cold cache or a resumed run.
2. **Same bytes, same node.** A branch whose children name nothing reuses the
   flat node over the same bytes. Its gist is re-captured, because the same
   bytes fold differently standing alone and embedded, and the index must hold
   the gist that a direct query will present (`fold-contract.md`).
3. **Near dedup.** This applies to branches only, and only against whole
   experiences still in the write buffer. The gist proposes a candidate, which
   must reach the branch's own `identityBar`. The bytes then decide: the two
   must be identical except for one span of at most `W` bytes
   (`differsByOneWindow`). This is the only place two different contents share
   an id.
4. **Mint** a new id.

A refuted alternative: probing the flushed ANN index for near targets. It was
the dominant training cost, and it was wrong. The 1-bit code ranked a
byte-distinct branch as nearest and collapsed two different subtrees onto one id
(`test/02`).

## Relations on the nodes

- **Continuation edges.** An edge is a unique `(src, dst)` pair, so
  `prevCount(dst)` counts distinct establishing contexts, never repetitions.
- **Containment.** `addContainer(child, parent)` buffers per child, and the
  flush appends packed pages (`_dbAppendContain`) without rewriting the list.
  `containersSlice` pages through it.
- **Gist index** (content) and **halo index** (company). Both are RaBitQ-IVF ANN
  over node ids. Gists wait in `_pendingGist` until `indexSubtree` promotes them
  in batches. Halos accumulate exactly in session and persist 2-bit quantized
  (`halo-sketch.md`).
- **Sketches.** `sketchGet`/`sketchPut` hold durable derived state: a miss costs
  time, never correctness.

`leadsSomewhere(id) = hasNext || hasHalo` is the one raw admission predicate: a
form is knowledge only if it continues somewhere or keeps company.

## Probes that do not grow with N

Hot paths read through `LIMIT` variants, point probes and capped byte reads, and
full scans are for maintenance only (`bounded-reads.md`). Flat lookups are
hashed, then verified:

- `flatBranchMayExist` is a negative filter, so its `false` is exact.
- `findFlatBranch` memoizes hits only, and a miss builds no key.
- `flatSpans(bytes)` extends one FNV-1a hash per start position, so sweeping a
  span's ends costs O(1) per probe instead of O(span). Recognition's interior
  pass once hashed 251,660,406 bytes for a single response (`test/153.4`).

`bytes(id)` and `bytesPrefix(id, cap)` return buffers shared with the caches.
Callers must never mutate them.

## The canonical index — optional, injected, verified

`canonAdd`, `canonFind`, `canonCount` and `eachContent` are an optional backend
capability. Without it, `resolve` has no equivalence fallback.

- **The store never learns the equivalence.** The caller injects the
  canonicalizer (`Canon`, for example `textCanon`).
- **Every candidate is hash-then-verified:** the stored bytes are
  re-canonicalized and compared, so a collision costs a read, never a wrong id.
- **`buildCanonIndex` runs after training** and is incremental from a watermark.
  A fixture store that skips it under-reports every case variant.
- **SQLite keeps a negative filter over the canonical hashes** (`canon_bloom`).
  It is persisted in the same transaction as the rows it covers and stamped with
  `canon.upto`. An open whose stamp disagrees rebuilds the filter once
  (`test/36-bloom`).

## Caches and maintenance

Every in-memory cache is a byte-budgeted `BoundedMap` (`caches.md`). ANN read
caches are keyed by content (`vecKey`), dropped on any index mutation, and
cleared at `RESONATE_CACHE_MAX`.

Maintenance is incremental:

- `compactContentIndex` removes isolated index entries written since its last
  watermark.
- `repairContentIndex` re-inserts bridge nodes whose gists were evicted before
  they were indexed.
- `buildCanonIndex` extends the canonical index from a given id.

## Adding a backend

1. Subclass `AbstractStore` and implement every
   `protected abstract _db*`/`_vec*` method as a thin wrapper. Never
   re-implement dedup or batching.
2. Keep the `*First`/`*Slice` methods as real `LIMIT ?` queries, and keep `has*`
   and counts as point probes. Never materialise a list and then slice it.
3. Run the whole suite with your store substituted.

## Pins

- `test/08` — storage: the node layout, halo persistence and 2-bit round trip,
  the `haloMass`/`hasHalo` contract, and survival across a reopen.
- `test/02` — exact round trip: near dedup never merges distinct bytes.
- `test/36-bloom` — the filters' exactness and persistence.
- `test/153.4` — the span prober answers exactly what `findFlatBranch` answers.
