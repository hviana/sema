/** External ids are integers only. */
export type ExternalId = number;
export interface DatabaseOptions {
    /** Path to the SQLite database file (use ":memory:" for a transient store). */
    dbPath: string;
    /** Vector dimensionality. Required for a new database; ignored when reopening. */
    dim?: number;
    /** Query breadth: clusters probed per query = ceil(efSearch / 4).  Default
     *  64 (16 probes). Tunable at runtime and at reopen. */
    efSearch?: number;
    /** Bits used to scalar-quantise the query for the RaBitQ estimator.
     *  Query-side only (stored codes are independent of it), so it is tunable
     *  at reopen, like efSearch.  Default 8. */
    queryBits?: number;
    /** Number of sign-flip + Hadamard rounds in the random rotation. Default 3. */
    rotationRounds?: number;
    /** Seed for the rotation. Default fixed. */
    seed?: number;
    /** Optional centroid the vectors are centered by before quantisation. */
    centroid?: ArrayLike<number>;
    /** SQLite page-cache budget in MiB.  Purely a latency knob: correctness and
     *  the per-operation storage-read count are identical with it at 0. */
    cacheSizeMb?: number;
}
export interface QueryResult {
    id: ExternalId;
    /** Estimated cosine distance (1 - cosine). */
    distance: number;
}
export interface StorageStats {
    float32BytesPerVector: number;
    codeBytesPerVector: number;
    bytesPerVector: number;
    compressionRatio: number;
}
/**
 * A persistent vector database: an adaptive PARTITIONED (IVF) index over
 * 1-bit RaBitQ codes (cosine), stored entirely in SQLite at `dbPath`.  See
 * ivf.ts for the index design.  The original float vectors are never
 * retained — only the sign codes — so a 1024-d vector costs 128 bytes.
 *
 * Inserting is route-and-append: cost is essentially FLAT in collection size
 * (one RAM scan of the pivot table + one chunk append — no per-insert graph
 * walk).  Query cost is bounded by nprobe × cluster size — constant in N
 * once the collection is past its first splits.
 */
export declare class VectorDatabase {
    private readonly index;
    constructor(options: DatabaseOptions);
    get dim(): number;
    /** Number of live (non-deleted) vectors. */
    get size(): number;
    /** Physical slot count including tombstones from deletes/updates. */
    get physicalSize(): number;
    /** Number of clusters (partitions) currently in the index. */
    get clusterCount(): number;
    get efSearch(): number;
    set efSearch(value: number);
    /** Distance computations performed during the most recent query. */
    get lastQueryDistanceComputations(): number;
    /** Storage row reads issued by the most recent query — the honest,
     *  cache-independent scalability metric. */
    get lastQueryStorageReads(): number;
    get storage(): StorageStats;
    private checkId;
    /** Convert a value to code bytes, selecting by length: `codeWords`
     *  elements → an existing 1-bit code; otherwise a raw `dim`-vector. */
    private toCodeBytes;
    has(id: ExternalId): boolean;
    /** Stream every live external id (bounded memory). */
    keys(): IterableIterator<ExternalId>;
    /** Stream live entries whose INTERNAL id is > `after` — a durable
     *  incremental watermark (internal ids are monotone at insert and preserved
     *  by update and compact). */
    keysSince(after: number): IterableIterator<{
        ext: ExternalId;
        internal: number;
    }>;
    /** Read the stored 1-bit code for an id (a copy as a Uint32Array), or null. */
    get(id: ExternalId): Uint32Array | null;
    insert(id: ExternalId, value: ArrayLike<number>): void;
    update(id: ExternalId, value: ArrayLike<number>): void;
    upsert(id: ExternalId, value: ArrayLike<number>): void;
    /**
     * Upsert many vectors under ONE transaction — one WAL commit for the whole
     * batch instead of one per vector, with chunk appends to the same cluster
     * coalesced in the index's write-back buffer.
     */
    upsertMany(entries: Array<{
        id: ExternalId;
        vector: ArrayLike<number>;
    }>): void;
    /** Delete many ids under ONE transaction. Absent ids are skipped.
     *  Returns the number of vectors actually removed. */
    deleteMany(ids: ExternalId[]): number;
    /** Delete the vector bound to an id. Returns false if absent. */
    delete(id: ExternalId): boolean;
    /** Heat the SQLite page cache with sequential scans (latency only). */
    warmCache(): number;
    /** Reclaim tombstoned slots by rewriting the clusters that carry any, then
     *  VACUUM.  Internal ids and cluster assignment are preserved. */
    compact(): void;
    /**
     * k-NN search. The argument's length selects the mode:
     *  - `dim` elements       → a raw vector (accurate estimator)
     *  - `codeWords` elements → a 1-bit code, by sign-bit Hamming
     */
    query(query: ArrayLike<number>, k?: number, opts?: {
        ef?: number;
    }): QueryResult[];
    /** Close the underlying database. The instance must not be used afterwards. */
    close(): void;
}
