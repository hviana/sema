import { DatabaseSync } from "node:sqlite";
export interface IvfConfig {
    dim: number;
    efSearch: number;
    queryBits: number;
    rotationRounds: number;
    seed: number;
    centroid: Float64Array | null;
    codeWords: number;
    paddedDim: number;
}
export interface IvfHit {
    /** external (user) id */
    id: number;
    /** estimated cosine distance (1 - cosine) */
    distance: number;
}
export declare class IvfIndex {
    readonly db: DatabaseSync;
    private readonly quantizer;
    private readonly codeBytes;
    private readonly chunkBytes;
    private _efSearch;
    /** Pivot codes, K × codeBytes, contiguous — the insert/query routing scan
     *  is one linear pass over this array. */
    private centCodes;
    /** Aligned 32-bit word view of {@link centCodes} — the routing scan's
     *  operand (4 bytes per XOR+popcount instead of byte re-composition). */
    private centWords;
    /** Per-cluster entry count (live + dead) — the split trigger. */
    private centEntries;
    /** Per-cluster chunk count (tail seq = count − 1). */
    private centChunks;
    private K;
    private live;
    private totalSlots;
    private nextId;
    /** Storage row reads (chunk blob fetches) — the cache-independent
     *  scalability witness, same discipline as the graph index it replaces. */
    reads: number;
    lastQueryDistComps: number;
    lastQueryStorageReads: number;
    private readonly chunkCache;
    private readonly dirtyChunks;
    private readonly dirtyCents;
    private metaDirty;
    private readonly cacheEnabled;
    private readonly chunkCacheMax;
    private sSelChunk;
    private sUpsChunk;
    private sDelChunk;
    private sSelVmap;
    private sInsVmap;
    private sUpdVmap;
    private sDelVmap;
    private sUpsCent;
    private sMeta;
    constructor(dbPath: string, options: {
        dim?: number;
        efSearch?: number;
        queryBits?: number;
        rotationRounds?: number;
        seed?: number;
        centroid?: ArrayLike<number>;
        cacheSizeMb?: number;
    });
    readonly dim: number;
    private prepareAll;
    /** Load the pivot table into RAM — K rows, ~(codeBytes + 8) bytes each. */
    private loadCents;
    private growCents;
    get size(): number;
    get physicalSize(): number;
    get clusterCount(): number;
    get bytesPerVector(): number;
    get efSearch(): number;
    set efSearch(v: number);
    resetReads(): void;
    /** Fetch a chunk, serving dirty/cached copies first.  `retain` controls
     *  whether a clean fetch enters the cache — read-only consumers pass the
     *  cacheEnabled flag so the `cacheSizeMb: 0` mode stays honestly uncached;
     *  writers always retain (the copy is about to become dirty). */
    private chunkAt;
    private cacheChunk;
    private markDirty;
    /** Write every dirty chunk row; drop the clean cache only when retention
     *  is off (no budget) — under a budget the warm set survives the flush.
     *  Runs inside the caller's transaction. */
    private flushChunks;
    private flushCents;
    /** Persist all buffered state.  MUST be called before the enclosing
     *  transaction commits (upsertMany/deleteMany do; single-op paths too). */
    private flushAll;
    private static readonly SUPER_G;
    private static readonly SUPER_TOP;
    /** Majority super-pivot codes, one per group of SUPER_G clusters. */
    private superWords;
    /** Group ids whose super-pivot is stale (member pivot changed). */
    private readonly superStale;
    /** Scratch word view of the code being routed (avoids per-call copies). */
    private routeScratch;
    private markSuperStale;
    /** Recompute stale super-pivots (majority bit over member pivots). */
    private freshenSupers;
    /** Word-popcount Hamming between the routing scratch and a words-row. */
    private hamAt;
    /** Nearest cluster to a code — exact over member pivots of the SUPER_TOP
     *  nearest super-groups (or over everything while K is small).  Pure RAM,
     *  no allocation, no storage reads. */
    private nearestCid;
    /** The nprobe nearest clusters to a QUERY (accurate estimator on pivots),
     *  as cids ordered nearest-first. */
    private probeOrder;
    private probeOrderByCode;
    /** Whether an external id is present (live). */
    has(ext: number): boolean;
    /** The stored code for an ext (a copy), or null. */
    codeOf(ext: number): Uint8Array | null;
    /** Insert a code under `ext`.  Caller owns the transaction; buffered rows
     *  are flushed by {@link commitFlush}.  Throws if ext is already live. */
    insert(ext: number, code: Uint8Array): void;
    /** Insert-or-update with ONE vmap probe.  The point probe is a real cost
     *  at bulk-load rates (statement dispatch + a B-tree descent per row —
     *  profiled as the single largest insert-path term), so the presence check
     *  and the update lookup share it. */
    upsert(ext: number, code: Uint8Array): void;
    /** The insert core — presence already established by the caller. */
    private insertNew;
    private newCluster;
    private appendToCluster;
    /** Tombstone a live ext.  Returns false when absent. */
    remove(ext: number): boolean;
    /** Update the code bound to a live ext.  A byte-identical code is a no-op
     *  (content-addressed callers re-upsert unchanged vectors wholesale after a
     *  restart; each no-op otherwise costs a tombstone + reinsert). */
    update(ext: number, code: Uint8Array): void;
    private updateAt;
    /** Flush buffered chunk/cent/meta rows.  Call before COMMIT. */
    commitFlush(): void;
    /** Split a full cluster in two, deterministically.  Dead slots are dropped
     *  (splits double as incremental compaction).  Both halves get fresh
     *  majority-bit pivots, so routing sharpens as the corpus grows. */
    private split;
    /** Bit-majority sample size per split side.  A pivot is a routing aid, not
     *  a stored value: the majority bit of a 512-member deterministic sample
     *  agrees with the full-population majority except on near-tied bits,
     *  where either choice routes equally well — and counting every member of
     *  a 4096-entry cluster was 25% of bulk-load CPU (profiled). */
    private static readonly MAJORITY_SAMPLE;
    /** Majority-bit code of the side's members (the binary centroid), or null
     *  when the side is empty.  Members are sampled on a deterministic stride
     *  when the side exceeds {@link MAJORITY_SAMPLE}. */
    private majorityCode;
    /** Rewrite a cluster's chunks from a member list (one side of a split or a
     *  compaction survivor set), updating vmap rows.  `dropFrom` deletes any
     *  leftover chunk rows beyond the new count. */
    private rebuildCluster;
    /** Multi-row vmap statements, prepared per row count (powers of a fixed
     *  batch width) — REPLACE semantics on the ext primary key. */
    private readonly vmapBatchStmts;
    private static readonly VMAP_BATCH;
    private vmapBatchStmt;
    /** Write flat (ext, id, cid, seq, slot) tuples in wide batches. */
    private flushVmapRows;
    /** ef → clusters probed.  ef is the familiar "candidate breadth" knob; a
     *  probe scans one whole cluster, so nprobe = ef/4 keeps the default
     *  (ef 64 → 16 probes) both accurate on trained stores and bounded. */
    private nprobeOf;
    /** k-NN with a full-precision query (accurate RaBitQ estimator). */
    searchKnn(vec: ArrayLike<number>, k: number, ef?: number): IvfHit[];
    /** k-NN with an already-quantized code (sign-bit Hamming distance). */
    searchKnnByCode(code: Uint8Array, k: number, ef?: number): IvfHit[];
    private scanClusters;
    /** Stream live entries whose internal id is > `after`, in id order.
     *  Internal ids are monotone at insert and PRESERVED by update/compact, so
     *  the largest id a caller has seen is a durable incremental watermark. */
    keysSince(after: number, batch?: number): IterableIterator<{
        ext: number;
        internal: number;
    }>;
    /** Stream every live external id. */
    keys(): IterableIterator<number>;
    /** Drop tombstoned slots by rewriting each cluster that carries any, then
     *  VACUUM.  Internal ids and cluster assignment are preserved — routing
     *  quality is untouched, only dead space is reclaimed. */
    compact(): void;
    /** Heat SQLite's page cache with sequential scans of the chunk and vmap
     *  tables — a cold session otherwise warms it through random point reads.
     *  Purely a latency optimisation; returns rows touched. */
    warmCache(): number;
    begin(): void;
    commit(): void;
    rollback(): void;
    /** Encode a raw vector to its 1-bit code bytes. */
    encodeToBytes(vec: ArrayLike<number>): Uint8Array;
    codeToBytes(code: ArrayLike<number>): Uint8Array;
    bytesToCode(bytes: Uint8Array): Uint32Array;
    get codeWords(): number;
    close(): void;
}
