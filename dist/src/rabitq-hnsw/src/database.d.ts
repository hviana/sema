/** External ids are integers only. */
export type ExternalId = number;
export interface DatabaseOptions {
  /** Path to the SQLite database file (use ":memory:" for a transient store). */
  dbPath: string;
  /** Vector dimensionality. Required for a new database; ignored when reopening. */
  dim?: number;
  /** Max neighbours per node on layers >= 1 (layer 0 uses 2*M). Default 16. */
  M?: number;
  /** Candidate list size during construction. Default 200. */
  efConstruction?: number;
  /** Candidate list size during search. Default 100. Tunable at runtime. */
  efSearch?: number;
  /** Bits used to scalar-quantise the query for the RaBitQ estimator.
   *  Query-side only (stored codes and the graph are independent of it), so it
   *  is tunable at reopen, like efSearch.  Default 8: 4 bits cannot resolve a
   *  tight cluster's residual and costs ~18% self-recall there (test 2a); 8
   *  bits restores it for the price of a Uint16 per-query LUT. */
  queryBits?: number;
  /** Number of sign-flip + Hadamard rounds in the random rotation. Default 3. */
  rotationRounds?: number;
  /** Seed for the rotation and graph levels. Default fixed. */
  seed?: number;
  /** Optional centroid the vectors are centered by before quantisation. */
  centroid?: ArrayLike<number>;
  /**
   * RAM cache size in MiB -- the single memory knob. It sizes SQLite's page
   * cache AND the immutable-code LRU (whose entry-capacity is derived from this
   * budget and the code size — there is no second knob). Both are purely speed
   * enhancements: correctness and the per-operation storage-read count are
   * identical with it off. Pass 0 to run with essentially no cache. Default 64.
   * Not persisted; set per open.
   */
  cacheSizeMb?: number;
}
export interface QueryResult {
  id: ExternalId;
  /** Estimated cosine distance (1 - cosine). */
  distance: number;
}
export interface StorageStats {
  /** Bytes a single Float32 copy of the vector would take. */
  float32BytesPerVector: number;
  /** Bytes of 1-bit code kept per vector (on disk). */
  codeBytesPerVector: number;
  /** Bytes kept per vector (just the code; excludes the graph adjacency). */
  bytesPerVector: number;
  /** float32BytesPerVector / bytesPerVector. */
  compressionRatio: number;
}
/**
 * A persistent vector database: an HNSW graph over 1-bit RaBitQ codes (cosine),
 * stored entirely in SQLite at `dbPath`. The graph IS the database -- there is no
 * load/save step and no in-RAM copy of the data, so resident memory stays flat as
 * the collection grows and the store survives process restarts. Reopening the
 * same path restores the exact configuration (the rotation is regenerated from
 * the persisted seed), so the codes already on disk remain valid.
 *
 * External ids are integers. The original float vectors are never retained --
 * only the sign codes -- so a 256-d vector costs 32 bytes instead of 1024. `get`
 * returns the stored code, which can be fed straight back into
 * `insert`/`update`/`query`.
 */
export declare class VectorDatabase {
  readonly dim: number;
  private readonly store;
  private readonly quantizer;
  private readonly index;
  private readonly codeWords;
  constructor(options: DatabaseOptions);
  /** Number of live (non-deleted) vectors. */
  get size(): number;
  /**
   * Physical node count including tombstones from deletes/updates. When it grows
   * well beyond `size`, call `compact()` to reclaim the space on disk.
   */
  get physicalSize(): number;
  get efSearch(): number;
  set efSearch(value: number);
  /** Distance computations performed during the most recent query. */
  get lastQueryDistanceComputations(): number;
  /**
   * Storage row reads issued by the most recent query. This is the honest,
   * cache-independent scalability metric: it counts every node/neighbour fetch
   * that hit the database, so disabling the cache cannot hide a bad access pattern.
   */
  get lastQueryStorageReads(): number;
  /** Per-vector storage cost of the index versus a Float32 baseline. */
  get storage(): StorageStats;
  has(id: ExternalId): boolean;
  /** Stream every live external id (bounded memory). */
  keys(): IterableIterator<ExternalId>;
  /**
   * Stream live entries whose INTERNAL id is > `after`, as
   * {ext, internal} pairs in internal-id order.  Internal ids are assigned
   * monotonically at insert and preserved by {@link compact}, so the largest
   * internal id a caller has seen is a durable incremental watermark: a later
   * call with it yields exactly the entries added since.
   */
  keysSince(after: number): IterableIterator<{
    ext: ExternalId;
    internal: number;
  }>;
  private checkId;
  /**
   * Convert a value to code bytes, selecting by length:
   *  - `codeWords` elements -> an existing 1-bit code (e.g. from `get()`)
   *  - otherwise            -> a raw `dim`-vector, encoded first
   * `codeWords < dim` for any dim >= 2, so the two never collide.
   */
  private toCodeBytes;
  /**
   * Create. Accepts a raw `dim`-vector or a 1-bit code (`codeWords` words),
   * detected by length. Throws if the id already exists (use `update`/`upsert`).
   */
  insert(id: ExternalId, value: ArrayLike<number>): void;
  /** Insert with the caller owning the transaction (used by {@link upsertMany}).
   *  `ef` optionally narrows the construction beam for this one vector (a
   *  caller-declared cheap entry, e.g. a reach-only interior); omitted means
   *  the index's configured efConstruction. */
  private insertCore;
  upsert(id: ExternalId, value: ArrayLike<number>): void;
  /**
   * Upsert many vectors under ONE transaction. The HNSW build touches the store
   * on every wired edge, so a transaction per vector is one WAL commit per vector
   * — which dominates a bulk load on disk. Wrapping the whole batch in a single
   * transaction coalesces those commits into one while leaving the graph and its
   * result identical (reads on the connection still see the uncommitted rows).
   *
   * This is purely about commit batching; it changes nothing about the storage
   * model. Codes still live only in SQLite and are read on demand — the
   * cache-independent per-operation read count is unchanged — so a batched load
   * scales exactly as the per-item path does, just with far fewer fsyncs. A throw
   * rolls the whole batch back, so the caller treats it as the per-item path on
   * failure.
   */
  upsertMany(
    entries: Array<{
      id: ExternalId;
      vector: ArrayLike<number>;
      ef?: number;
    }>,
  ): void;
  /**
   * Read the stored 1-bit code for an id (a copy as a Uint32Array), or null. The
   * original vector is not retained; the code round-trips into insert/update/query.
   */
  get(id: ExternalId): Uint32Array | null;
  /**
   * Update the vector bound to an id (raw vector or code, detected by length).
   * The previous node is tombstoned and a fresh one inserted. Throws if absent.
   */
  update(id: ExternalId, value: ArrayLike<number>): void;
  /** Update with the caller owning the transaction (used by {@link upsertMany}). */
  private updateCore;
  /** Update when the live internal node id is already known.
   *
   *  Skips the write entirely when the new code equals the stored one — the
   *  update would tombstone the node and replay a full graph insert for a
   *  byte-identical result. This is not a corner case: content-addressed
   *  callers re-upsert unchanged vectors wholesale after a restart (the same
   *  content always encodes to the same code), and each such no-op otherwise
   *  costs a tombstone (permanent routing/disk overhead until compaction)
   *  plus an O(ef·log N) reinsert. */
  private updateAt;
  /**
   * Delete many ids under ONE transaction — same commit-coalescing rationale
   * as {@link upsertMany}: a tombstone per implicit transaction is one WAL
   * commit per id, which dominates a bulk prune. Absent ids are skipped.
   * Returns the number of vectors actually removed.
   */
  deleteMany(ids: ExternalId[]): number;
  /** Delete the vector bound to an id. Returns false if absent. */
  delete(id: ExternalId): boolean;
  /**
   * Pre-fill the RAM caches (codes + neighbour lists) with sequential table
   * scans, up to their budget-derived caps.  Optional and purely a latency
   * optimisation: a cold session otherwise pays the same warming through
   * random point reads over its first minutes.  Call once after open on a
   * session that will do sustained inserts/queries.  Returns rows warmed;
   * a 0-budget database returns 0 immediately.
   */
  warmCache(): number;
  /**
   * Rebuild the graph from the live codes only, dropping tombstones and returning
   * the freed pages to the filesystem. Lossless -- equivalent to the original
   * build -- and needs no original vectors.
   */
  compact(): void;
  /**
   * k-NN search. The argument's length selects the mode:
   *  - `dim` elements       -> a raw vector (accurate 4-bit-query estimator)
   *  - `codeWords` elements -> a 1-bit code (e.g. `get(id)`), by sign-bit Hamming
   * Detection is by length, so a code is recognised whether it is a Uint32Array
   * or a plain number[]. `codeWords < dim` for any dim >= 2, so they never collide.
   */
  query(query: ArrayLike<number>, k?: number, opts?: {
    ef?: number;
  }): QueryResult[];
  /** Close the underlying database. The instance must not be used afterwards. */
  close(): void;
}
