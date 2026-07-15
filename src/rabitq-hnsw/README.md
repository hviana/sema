# rabitq-hnsw

A small, well-organised TypeScript library for **approximate nearest-neighbour
search** using **HNSW** (Hierarchical Navigable Small World graphs) over **1-bit
RaBitQ codes**, with **cosine** distance. The entire index lives in **SQLite** —
the durable copy of every code and link is on disk, resident memory is bounded
by one capped memory budget (never the whole collection), and the index survives
process restarts.

The vectors are stored **only** as 1-bit RaBitQ codes — the original vectors are
never kept — so the index is both fast _and_ tiny on disk:

```
a 256-d vector:
  Float32             : 256 × 4 bytes = 1024 bytes
  RaBitQ 1-bit (code) : 256 × 1 bit   = 32 bytes      (32× smaller)
```

The code _is_ the entire per-vector representation — no norms, multipliers, or
popcounts are stored alongside it. A 1-bit code is therefore a first-class
value: `get` returns the bare code, and `insert`, `update`, and `query` all
accept either a raw vector or a code — detected by length, so the same call
works for a `Uint32Array` or a plain `number[]`.

Highlights:

- Faithful HNSW: probabilistic level assignment, greedy layer descent, the
  `SEARCH-LAYER` routine and the neighbour-selection **heuristic** (Algorithm
  4), bidirectional edges with pruning, dynamic entry point.
- **Quantize-first build**: a vector is encoded to its 1-bit code immediately,
  and the graph is built entirely from codes (`XOR` + `popcount`). Queries still
  use the accurate full-precision estimator. There is **no exact re-ranking step
  and no original-vector storage**.
- `compact()` reclaims deleted/updated space with a **graph-preserving splice**:
  live nodes keep their internal ids and wiring, and each dead neighbour is
  replaced by its own live neighbours (a 1-hop bridge). Codes are copied
  verbatim — nothing is re-quantised — so compaction never loses precision, and
  it runs as one streaming pass instead of a full O(N·ef·log N) rebuild.
- At query time each distance is a handful of byte lookups in a small per-query
  table (no popcounts).
- **Truly sub-linear** query work (≈ `O(log N)`), demonstrated by the
  test/benchmark.
- Vector **CRUD** keyed by integer external ids. `get` returns the stored 1-bit
  code, which can be fed straight back into `insert`, `update`, or `query`.
- **Bounded RAM footprint**: codes and adjacency lists live in SQLite tables and
  are read/written on demand. The only resident state is one BOUNDED budget,
  `cacheSizeMb`, shared by SQLite's page cache and a derived immutable-code LRU
  — both capped, so the index can grow to millions of vectors without resident
  memory growing with it.
- **Scalability is cache-independent**: the caches are pure speed layers.
  Correctness and the per-operation _storage-read_ count are identical with the
  budget off (`cacheSizeMb: 0`). `lastQueryStorageReads` exposes that honest,
  cache-independent cost — it is set by the work a query does (the nodes it
  visits, ~log N), never by the collection size — so a poor access pattern can
  never hide behind a warm cache.
- Reopening the same `dbPath` restores the exact configuration (the rotation is
  regenerated from the persisted seed), so codes already on disk remain valid
  across process restarts.
- **`node:sqlite`** is the only runtime dependency — no native add-ons.

## Install / run

```bash
npm install          # installs dev tooling (typescript, tsx, @types/node)
npm test             # the single test file: CRUD, memory, recall + sub-linearity benchmark
npm run example      # runs examples/quickstart.ts
npm run typecheck    # tsc --noEmit
```

No build step is required to use or test the library — `tsx` runs the TypeScript
directly. Requires Node.js ≥ 22.5 (for `node:sqlite`).

## Usage

```ts
import { VectorDatabase } from "./src/index";

// dbPath is required — use ":memory:" for a transient index
const db = new VectorDatabase({
  dbPath: ":memory:",
  dim: 256,
  M: 16,
  efConstruction: 200,
});

// CREATE — associate a vector with an integer id (encoded to 1-bit code immediately)
db.insert(42, embedding); // embedding: number[] | Float32Array of length dim

// BULK CREATE/UPDATE — one transaction around the whole batch (far fewer fsyncs
// on disk; the graph and its result are identical to the per-item path).
db.upsertMany([{ id: 1, vector: v1 }, { id: 2, vector: v2 }]);

// READ — returns the stored 1-bit code (NOT the original vector)
const code = db.get(42); // -> Uint32Array (codeWords words) | null

// A code is the whole representation: insert / update / query all accept one too,
// detected by length (codeWords vs dim) — works for Uint32Array or a number[].
db.insert(999, code!); // store an existing code under a new id
db.query(code!, 10); // search by code (sign-bit / cosine distance)
db.update(7, db.get(9)!); // move id-7 onto id-9's code

// UPDATE / DELETE with raw vectors
db.update(42, newEmbedding);
db.delete(42); // -> boolean

// COMPACT — reclaim space from deleted/updated vectors (lossless rebuild)
db.physicalSize; // physical nodes incl. tombstones
if (db.physicalSize > db.size * 1.5) db.compact();

// SEARCH — k nearest neighbours (ids + estimated cosine distances)
const hits = db.query(queryVector, 10); // -> [{ id, distance }, ...]
db.query(queryVector, 10, { ef: 200 }); // override efSearch per query

// MEMORY — per-vector storage footprint vs a Float32 baseline
db.storage; // { float32BytesPerVector, codeBytesPerVector, bytesPerVector, compressionRatio }

// PERSIST — just reference the same path again; the SQLite file IS the database
db.close();
const db2 = new VectorDatabase({ dbPath: "vectors.db" }); // reopens, exact same state

// Transient in-memory index
const mem = new VectorDatabase({ dbPath: ":memory:", dim: 256 });
// ... use, then close — data is discarded
mem.close();
```

Distance is **cosine**. Options: `efSearch`, `queryBits` (query
scalar-quantisation bits, default 4), `rotationRounds` (default 3), `seed`, an
optional `centroid` the vectors are centered by before quantisation, and the one
bounded memory knob `cacheSizeMb` (default 64) — it sizes SQLite's page cache
and the derived immutable-code LRU together. A pure speed enhancement: pass 0 to
disable all caching, which changes neither results nor the per-operation
storage-read count.

## How it works

**RaBitQ (1-bit).** Each vector is centered by an optional centroid, normalised,
rotated by a fast random orthogonal transform (random sign flips +
Walsh–Hadamard, `O(D log D)`), and reduced to one sign bit per padded dimension.
The packed sign bits are the **only** thing kept per vector. The random rotation
makes the quantisation error essentially uniform across vectors, so the cosine
estimate needs only a single fixed scale rather than any per-vector correction.

**Two estimators, both on codes.**

- _query → code_ (accurate): RaBitQ's inner-product estimator between a
  **full-precision** vector and a stored 1-bit code. The query is
  scalar-quantised to `queryBits` bits, and the only data-dependent quantity in
  the estimate is the dot product of the code's sign bits with the quantised
  query — which is exactly **the sum of the quantised query values at the
  coordinates where the code bit is 1**. So at query time we build one small
  per-query **byte lookup table** (`paddedDim/8 × 256`, ≈8 KB, L1-resident) and
  each distance is just `paddedDim/8` table lookups over the code's bytes — e.g.
  32 lookups for a 256-d vector, no popcounts at all.
- _code → code_ (coarse): the distance between two stored codes from their
  Hamming distance, `cos ≈ 1 − 2·hamming/D` (`XOR` + `popcount`). Both sides are
  1-bit. **The entire build runs on this estimator** — finding a new node's
  neighbours and pruning lists — so insertion needs nothing but the code (one
  rotation at encode time, then cheap popcounts), and a rebuild from codes is a
  faithful HNSW construction.

**HNSW.** A multi-layer navigable graph. Levels are drawn from
`⌊-ln(U)·(1/ln M)⌋`; the search descends greedily through the upper layers and
runs an `ef`-bounded best-first search at layer 0. New nodes connect to `M`
neighbours chosen by the diversity heuristic, with neighbour lists pruned back
to `2M` at layer 0. Insertion searches the graph with the new node's **code**;
queries search it with the **full-precision** estimator. There is no exact
re-ranking — the top-k is taken directly from the codes, which keeps query work
tiny and sub-linear.

**SQLite-native graph.** Codes live in the `nodes` table (one BLOB per row,
indexed by integer primary key); adjacency lists live in the `links` table
(`WITHOUT ROWID`, clustered on `(node, layer)`) so a neighbour-list fetch — the
hot path of search — is a single B-tree descent landing on an inline BLOB.
Global state (entry point, max level, counts, RNG state) and the quantizer
configuration (dim, seed, centroid, etc.) are in a single-row `meta` table.
There is no separate load/save step: the SQLite file **is** the database.

**Performance details.** WAL journal mode with NORMAL synchronous for
crash-safe, fast writes; a page cache sized by `cacheSizeMb` (with mmap tied to
it) for zero-copy reads of hot pages; a per-_operation_ working set (the records
the current insert/query is actively comparing, bounded by `efConstruction` /
`efSearch`, cleared between operations and never the collection size) so within
one op each touched node is read once; visited tracking and binary heaps on
parallel arrays with no per-candidate object allocation in the build/search hot
paths. The `compact()` operation streams the live rows into fresh tables
(preserving internal ids, splicing dead neighbours out of the adjacency lists)
in batched transactions — the WAL stays bounded by the batch, never the table —
then swaps the tables atomically and `VACUUM`s the freed pages back to the
filesystem.

**The immutable-code LRU.** A node's 1-bit code never changes once written, yet
building and searching the graph re-read the same hub nodes across operations —
and on clustered data consecutive inserts touch overlapping neighbourhoods, so a
code is fetched again and again. Each fetch is a SQLite point-query that decodes
the row and copies the BLOB (≈1.4 µs even when the page is already cached — the
cost is the statement, not disk I/O), while the distance it feeds is ≈0.04 µs.
So a **bounded LRU of decoded `NodeRec`s** (keyed by internal id) serves a
repeatedly-touched code from RAM and skips both the query and the copy. Two
properties keep it honest:

- It is a **latency layer only.** `lastQueryStorageReads` (and the underlying
  `Store.reads`) counts SQLite fall-throughs — cache MISSES — so the
  per-operation storage-read count, the cache-independent scalability witness,
  is identical whether the cache is full or off. The index's _scaling_ never
  depends on it; only the wall-clock constant does.
- It has **no separate knob.** Its entry capacity is DERIVED from the one memory
  budget, `cacheSizeMb`, and the actual per-`NodeRec` byte cost (code + fixed
  fields + Map overhead), so it shares that budget and resident memory is capped
  regardless of collection size — it never grows into "the whole index in RAM".
  On a clustered build even a modest budget captures essentially all the
  locality, so it buys the speed-up without scaling with N.

Two refinements share the same budget and the same honesty rules (hits are never
counted as reads; correctness never depends on them):

- **Upper-layer pinning.** Every insert and query descends from the entry point
  through the upper layers before fanning out on layer 0, so level ≥ 1 nodes (a
  1/M fraction of the collection) are touched by every operation — yet layer-0
  fan-out traffic keeps evicting them from a plain LRU. Their codes pin into a
  section capped at half the budget that layer-0 traffic cannot evict, keeping
  the descent RAM-resident however far the collection outgrows the budget.
- **A decoded neighbour-list LRU.** Hub adjacency lists are re-read across
  consecutive operations just like hub codes; a bounded LRU (a quarter of the
  budget) serves the decoded list, written through on every `setNeighbors` so a
  hit always equals a fresh row read, and dropped at compaction.

The cache stays correct because the only mutable fields — the tombstone flag and
external id — are updated in place on the cached record by `tombstone()`, and
the whole cache is dropped at compaction (whose table swap invalidates any
cached row). A miss only repeats work, never changes a result. `cacheSizeMb: 0`
disables it (along with the page cache), which the tests use to measure the
honest read count.

Deletes (and the old version after an `update`) are tombstones: still routed
through for navigation, never returned. `compact()` splices them out of the
graph (each dead neighbour replaced by its own live neighbours) and drops their
rows; codes are copied untouched — no original vectors needed, no precision
lost.

## Accuracy trade-off

1-bit codes are extremely compact but lossy: the index reliably finds the right
_neighbourhood_, but it cannot perfectly resolve the order of points that are
all roughly equidistant from the query. So recall is high when the true
neighbours are **separable** (the regime where ANN is meaningful —
near-duplicate retrieval, clustered embeddings, etc.) and lower inside a dense,
ambiguous cluster. The classic way to recover exact ordering is to re-rank the
top candidates with the original vectors; this build intentionally omits that to
maximise speed and minimise memory.

## Benchmark (from `npm test`)

`dim = 256`, well-separated groups of 10 near-duplicates, 200 queries, `k = 10`,
`efSearch = 150`. Representative run (disk-backed, SQLite):

```
Per-vector storage (vector payload only, excludes the HNSW graph):
  Float32 baseline     : 1024 B
  1-bit RaBitQ code    : 32 B   (32.0x smaller)
  code (kept)          : 32 B   (32.0x smaller overall)
  payload at N=32000   : Float32 31.25 MB  vs  index 0.98 MB

     N | HNSW q (us) | dist comps | Brute q (us) | recall@10 | speedup
-------+-------------+------------+--------------+-----------+--------
  1000 |      1930.3 |        863 |        308.2 |    100.0% |    0.2x
  2000 |      3142.8 |       1298 |        549.6 |    100.0% |    0.2x
  4000 |      3763.7 |       1723 |       1073.3 |    100.0% |    0.3x
  8000 |      4603.3 |       2165 |       2186.0 |    100.0% |    0.5x
 16000 |      5315.8 |       2440 |       4398.0 |    100.0% |    0.8x
 32000 |      6058.2 |       2668 |       8886.4 |    100.0% |    1.5x

Empirical scaling over a 32x increase in N  (work ~ N^exponent):
  HNSW distance computations : N^0.320   <- sub-linear (target < 1)
  Brute-force query          : N^0.831   (linear reference ~ 1.0)
  Mean recall@10            : 100.00%
```

The distance-computation count is a deterministic, machine-independent measure
of work: it grows sub-linearly (≈ `N^0.32`, near-logarithmic) while the
brute-force baseline grows near-linearly. The per-query latency is higher than a
purely in-RAM index (the SQLite round-trips add ~constant overhead), but it
**scales** — at 32,000 vectors the disk-backed HNSW is already 1.5× faster than
brute force, and the gap widens as N grows (brute is `O(N)` per query; HNSW is
`O(log N)`). The test asserts the 32× storage compression, the sub-linear
exponent, perfect recall, and the speed-up over brute force.

## Layout

```
src/
  prng.ts       deterministic seedable RNG (mulberry32)
  heap.ts       binary heap on parallel arrays
  rabitq.ts     1-bit RaBitQ quantizer + fast rotation + query/code estimators
  store.ts      SQLite-backed graph storage: codes, adjacency, meta, compaction
  hnsw.ts       HNSW graph over codes (build, search, delete, compact)
  database.ts   VectorDatabase: CRUD, external ids, storage stats
  index.ts      public exports
test/
  hnsw.test.ts  the single test file (correctness + memory + benchmark)
examples/
  quickstart.ts
```
