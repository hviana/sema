# rabitq-ivf

A small TypeScript library for **approximate nearest-neighbour search** using an
**adaptive partitioned (IVF) index** over **1-bit RaBitQ codes**, with
**cosine** distance. The entire index lives in **SQLite** — the durable copy of
every code is on disk, resident memory is bounded (the pivot table plus a capped
page cache, never the whole collection), and the index survives process
restarts.

The vectors are stored **only** as 1-bit RaBitQ codes — the original vectors are
never kept — so the index is both fast _and_ tiny on disk:

```
a 1024-d vector:
  Float32             : 1024 × 4 bytes = 4096 bytes
  RaBitQ 1-bit (code) : 1024 × 1 bit   = 128 bytes    (32× smaller)
```

The code _is_ the entire per-vector representation. `get` returns the bare code,
and `insert`, `update`, and `query` all accept either a raw vector or a code —
detected by length.

## The index

- **Clusters, not a graph.** The collection is partitioned into clusters, each
  with a binary pivot code and its member codes packed in fixed-size chunk
  blobs.
- **Insert = route + append.** Find the nearest pivot (one linear Hamming scan
  of the RAM-resident pivot table) and append to that cluster's tail chunk. No
  beam search, no neighbour rewiring — per-insert cost is essentially flat in
  collection size.
- **Query = probe + scan.** Rank all pivots with the accurate RaBitQ estimator,
  scan the `ceil(efSearch/4)` nearest clusters with the same estimator, keep the
  top k. Per-query storage reads are bounded by nprobe × chunks-per-cluster —
  constant once the collection has split.
- **Adaptive, deterministic splits.** A cluster reaching 4096 entries is
  median-split on the margin between two farthest-point seeds (two exact halves,
  cascade-proof), and both halves get fresh majority-bit pivots. There is no
  RNG: the index is a pure function of the insertion sequence.
- **Same durability discipline as the rest of Sema**: WAL, batched caller-owned
  transactions (`upsertMany`), 1 KiB pages, 64 MiB WAL autocheckpoint.

## Usage

```ts
import { VectorDatabase } from "./src/index.js";

const db = new VectorDatabase({ dbPath: "vectors.db", dim: 1024 });
db.upsertMany([{ id: 1, vector: v1 }, { id: 2, vector: v2 }]);
const hits = db.query(q, 10); // [{ id, distance }]
db.close();
```

`lastQueryStorageReads` reports the cache-independent storage-read count of the
most recent query — the honest scalability witness the test suite asserts on
(`test/35-ivf.test.mjs` at the repo root).
