# Caches — Every Acceleration Is a BoundedMap

> **Law:** every acceleration is a `BoundedMap` with a byte budget. A miss
> re-derives from durable state. Degradation order is speed/reach lost, never
> identity.

No cache may change what is stored, what is resolved, or what tree is folded.
Eviction costs a re-read, a re-walk, or a narrower reach — never a wrong answer
or a wrong tree.

## `BoundedMap` — the one cache primitive

`src/store.ts:BoundedMap<K,V>` — LRU with byte accounting (`maxBytes`, `sizeOf`,
`evict`, `recency`).

- `evict: "lru"` — uniform-cost entries (dedup, vectors, records).
- `evict: "smallest"` — variable-cost reconstruction (`_bytesCache`): protects
  expensive large branches over cheap leaves.
- `recency: "reorder"` (default) — exact LRU via `delete+set`; required when
  eviction choice is load-bearing (`_depositTrees` — 8 entries, victim changes
  fold).
- `recency: "clock"` — bit instead of reorder; only for transparent caches where
  wrong victim costs a re-read (`_bytesCache`, `_recCache`). Measured: same
  entries cached, hot-path time 55% → bit.

Persistent cursor over V8 insertion order makes eviction amortised O(1);
candidate window for `"smallest"` never rescans from front.

## Store caches — budgets in `src/config.ts:StoreConfig`

| Cache               | Field                      | Budget                       | `sizeOf`            | Eviction       |
| ------------------- | -------------------------- | ---------------------------- | ------------------- | -------------- |
| dedup leaf/branch   | `_leafKey` / `_branchKey`  | `dedupCacheMax` 1M entries   | 1                   | lru            |
| reconstructed bytes | `_bytesCache`              | `bytesCacheMax` 20 MB        | `byteLength`        | smallest+clock |
| content length      | `_lenCache`                | `bytesCacheMax`              | 16                  | lru            |
| node records        | `_recCache`                | `recCacheBytes` 10 MB        | leaf+4·kids+12      | lru+clock      |
| pending gists       | `_pendingGist`             | `pendingGistBytes` 16 MB     | `byteLength` (D·4)  | lru            |
| halo exact / norm   | `_haloExact` / `_haloNorm` | `haloCacheBytes` 16 MB each  | `byteLength`        | lru            |
| skipped interiors   | `_coveredIds`              | `coveredIdsMax` 100K entries | 1                   | lru            |
| indexed ids         | `_indexedIds`              | `coveredIdsMax`              | 1                   | lru            |
| transparent chains  | `_chainMemo`               | `chainCacheBytes` 16 MB      | 4·len+32            | lru            |
| ingest memo         | `CachedIngest._memo`       | `ingestCacheBytes` 50 MB     | vector+ids+keyBytes | lru            |

ANN read caches (`_resonateCache`, `_resonateHaloCache`) are `Map<string,Hit[]>`
keyed by `vecKey(v)+":"+k`, dropped on any index mutation.
`vectorCacheMb`/`sqliteCacheMb` are pure page-cache latency knobs.

`_bytesCache` only caches complete reconstructions — `bytesPrefix(id,cap)` with
`got < cap`; a truncated prefix is never stored. `_chainMemo` is dropped on any
write that could break transparency; `_pendingGist` eviction falls back to DAG
climb; halo eviction re-decodes the durable 2-bit row.

## Mind caches — session and per-response

| Cache               | Location                                         | Budget    | Scope / invalidation                                               |
| ------------------- | ------------------------------------------------ | --------- | ------------------------------------------------------------------ |
| `_gistCache`        | `Mind._gistCache`                                | 32 MB     | session-lifetime, never invalidated (perception pure)              |
| `_depositTrees`     | `Mind._depositTrees`                             | 8 entries | session; `perceiveDeposit` only when `conversational`              |
| `_depositLens`      | `Mind._depositLens`                              | —         | byte lengths for prefix probes; cleared with map when >64          |
| `_internIds`        | `Mind._internIds: WeakMap<Sema,number>`          | —         | Mind lifetime; ids permanent                                       |
| `_resolvedSubtrees` | `Mind._resolvedSubtrees: WeakMap<Sema,{id,len}>` | —         | per-response/conversation; fast path only when `visit===undefined` |

`REACH_MEMO_MAX` / `STRUCT_MEMO_MAX` 100K (`src/mind/traverse.ts`) — whole-climb
and per-node structural probes (`hasNext`/`prevCount`/`hasParents`); cleared on
write or when cap reached. `reachMemo`/`structCaches` keyed by `_structMemoKey`,
bypassed under trace.

## Deposit caches — offset-keyed, caller-discharged

`_depositTrees`/`_depositLens`/`_internIds`/`_resolvedSubtrees` key **offsets**,
not bytes, for O(1) reuse. Offsets alone cannot witness byte agreement — caller
must discharge it.

- Correct: conversation append — each turn extends the prior cumulative context
  by its own bytes; longest cached proper prefix hit (`L < bytes.length`) reuses
  `contentFoldIncremental` segments bit-identically.
- Wrong: mismatched `prev` reused by offset produced wrong tree (336 vs 400
  bytes) — a coincidental prefix length aliased unrelated content.
- Now: `perceiveDeposit` keys by `latin1Key(bytes.subarray(0,L))` (prefix
  bytes), probes longest cached proper prefix first; `_depositTrees` populated
  only for conversational deposits (budget discipline), otherwise cold path
  always correct.

## Pins

- `test/91` — `chainRun` via capped `_prefix`: bounded transparent-chain hop,
  not per-node probes.
- `test/96` — `_bytesCache` is byte-accounted `BoundedMap` that evicts; miss
  re-derives.
