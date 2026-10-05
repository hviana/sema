# Caches — Every Acceleration Is a Budget

> **Law:** every acceleration is a byte-budgeted `BoundedMap`, and a miss
> re-derives from durable state. Eviction may cost speed or reach. It never
> changes what is stored, what is resolved or what tree is folded.

**Why.** Resident memory is capped by configuration, not by how much was learnt,
so a large store does not need a large machine. That holds only if every cache
can forget without being wrong.

## `BoundedMap` — the one cache primitive (`src/store.ts`)

An LRU with byte accounting (`maxBytes`, `sizeOf`), whose eviction is amortised
O(1) over a persistent cursor. It has two settings:

**`evict`, which entry goes:**

- `"lru"` — for entries of uniform cost.
- `"smallest"` — for variable-cost reconstructions (`_bytesCache`). It protects
  expensive large branches over cheap leaves.

**`recency`, how use is recorded:**

- `"reorder"`, the default — exact LRU. It is required wherever the choice of
  victim is load-bearing.
- `"clock"` — a use bit. It is only for transparent caches, where a wrong victim
  costs a re-read: `_bytesCache` and `_recCache`. It caches the same entries as
  `"reorder"`, at a fraction of the hot-path time.

## Store caches — budgets in `StoreConfig` (`src/config.ts`)

| Cache                          | Field                         | Default budget               | Eviction         | A miss costs                                       |
| ------------------------------ | ----------------------------- | ---------------------------- | ---------------- | -------------------------------------------------- |
| dedup keys                     | `_leafKey` / `_branchKey`     | `dedupCacheMax`, 1M entries  | lru              | a durable content probe                            |
| flat-branch hits               | `_flatKey`                    | `dedupCacheMax`              | lru + clock      | a hashed probe                                     |
| reconstructed bytes            | `_bytesCache`                 | `bytesCacheMax`, 20 MB       | smallest + clock | a subtree walk                                     |
| content length                 | `_lenCache`                   | `bytesCacheMax`              | lru              | a capped walk                                      |
| node records                   | `_recCache`                   | `recCacheBytes`, 10 MB       | lru + clock      | a row read                                         |
| pending gists                  | `_pendingGist`                | `pendingGistBytes`, 16 MB    | lru              | a DAG climb                                        |
| exact halos / norms            | `_haloExact` / `_haloNorm`    | `haloCacheBytes`, 16 MB each | lru              | decoding the 2-bit row                             |
| skipped interiors, indexed ids | `_coveredIds` / `_indexedIds` | `coveredIdsMax`, 100K        | lru              | a re-check                                         |
| transparent chains             | `_chainMemo`                  | `chainCacheBytes`, 16 MB     | lru              | one CTE; dropped on writes that break transparency |
| ingest memo                    | `CachedIngest._memo`          | `ingestCacheBytes`, 50 MB    | lru              | a re-fold (the ids are hash-consed)                |

- `_bytesCache` stores only complete reconstructions. A truncated prefix is
  never cached.
- The ANN read caches (`_resonateCache`, `_resonateHaloCache`) are keyed by
  `vecKey(v):k`, dropped on any index mutation, and cleared at
  `RESONATE_CACHE_MAX`.
- `vectorCacheMb` and `sqliteCacheMb` only tune page-cache latency.

## Mind caches — the session

- **`_gistCache`** (32 MB): node gists, kept for the session's lifetime and
  never invalidated, since perception is pure.
- **`_depositTrees` / `_depositLens`**: up to 8 folds, keyed by their bytes,
  written only by conversational deposits, so that a growing context re-folds
  only its suffix (`fold-contract.md`). Both reset together when the length set
  exceeds 64.
- **`_internIds`** (a `WeakMap` from tree node to id): skips re-interning a
  shared subtree. The ids it holds are permanent.

Per-response memos are in `memoization.md`.

## Pins

- `test/96` — `_bytesCache` is a byte-accounted `BoundedMap` that evicts, and a
  miss re-derives.
- `test/91` — `chainRun` hops a transparent chain in one bounded read, not with
  probes per node.
