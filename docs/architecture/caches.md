# Caches — Every Acceleration Is a Budget

> **Law:** a cache holds only a copy of what durable state already says, under a
> byte budget, and a miss reads it from there again. Hit or miss, warm or cold,
> at any budget, every answer is the same: only time changes.

**Why.** Resident memory is capped by configuration, not by how much was learnt,
so a large store does not need a large machine. That holds only if every cache
can forget without being wrong.

## `BoundedMap` — the cache primitive (`src/store.ts`)

An LRU with byte accounting (`maxBytes`, `sizeOf`), whose eviction is amortised
O(1) over a persistent cursor. It has two settings:

**`evict`, which entry goes:**

- `"lru"` — for entries of uniform cost.
- `"smallest"` — for variable-cost reconstructions (`_bytesCache`). It protects
  expensive large branches over cheap leaves.

**`recency`, how use is recorded:**

- `"reorder"`, the default — exact LRU.
- `"clock"` — a use bit, a fraction of the hot-path time (`_bytesCache`,
  `_recCache`); a worse victim only costs a re-read.

## Store caches — budgets in `StoreConfig` (`src/config.ts`)

| Cache                        | Field                        | Default budget              | Eviction         | A miss costs                            |
| ---------------------------- | ---------------------------- | --------------------------- | ---------------- | --------------------------------------- |
| dedup keys                   | `_leafKey` / `_branchKey`    | `dedupCacheMax`, 1M entries | lru              | a durable content probe                 |
| flat-branch hits             | `_flatKey`                   | `dedupCacheMax`             | lru + clock      | a hashed probe                          |
| reconstructed bytes          | `_bytesCache`                | `bytesCacheMax`, 20 MB      | smallest + clock | a subtree walk                          |
| content length               | `_lenCache`                  | `bytesCacheMax`             | lru              | a capped walk                           |
| node records                 | `_recCache`                  | `recCacheBytes`, 10 MB      | lru + clock      | a row read                              |
| pending gists                | `_pendingGist`               | `pendingGistBytes`, 16 MB   | lru              | a re-fold of the stored node            |
| halos read                   | `_haloNorm`                  | `haloCacheBytes`, 16 MB     | lru              | reading the stored halo                 |
| indexed ids, walked subtrees | `_indexedIds` / `_walkedIds` | `coveredIdsMax`, 100K       | lru              | a re-probe, a re-walk                   |
| transparent chains           | `_chainMemo`                 | `chainCacheBytes`, 16 MB    | lru              | one CTE; dropped when a write breaks it |
| ingest memo                  | `CachedIngest._memo`         | `ingestCacheBytes`, 50 MB   | lru              | a re-fold (the ids are hash-consed)     |

- `_bytesCache` never caches a truncated prefix.
- The ANN read caches (`_resonateCache`, `_resonateHaloCache`) are keyed by
  `vecKey(v):k`, dropped on any index mutation, and cleared at
  `RESONATE_CACHE_MAX`.
- `vectorCacheMb` and `sqliteCacheMb` only tune page-cache latency.

## Mind caches — the session

- **`_gistCache`** (32 MB): node gists, kept for the session, never invalidated
  (perception is pure). Company signatures (64 MB, `sema.ts`): re-drawn from the
  id on a miss. The store's re-derived gists (16 MB): folded from stored kids.
- **`_depositTrees` / `_depositLens`**: up to 8 folds, keyed by their bytes,
  written only by conversational deposits, so a growing context re-folds only
  its suffix (`fold-contract.md`). Both reset past 64 lengths.
- **`_internIds`** (a `WeakMap`, tree node → id): skips re-interning a shared
  subtree; its ids are permanent.
- **Structural memos** (`traverse.ts`, `junction.ts`): the climb's reach (32 MB)
  and what is read off instances (16 MB) charge an entry when set and drop whole
  at the budget; a hit costs a `Map`'s. Probe entries and the junction walk's
  reads (`walkCache`) drop whole at 100K entries.

Per-response memos are in `memoization.md`.

## Pins

- `test/91` — a branch's bytes are cached, so rebuilding it twice does not
  re-walk its subtree.
- `test/96` — `bytes()` terminates even when `_bytesCache` evicts its working
  set: a miss re-derives.
