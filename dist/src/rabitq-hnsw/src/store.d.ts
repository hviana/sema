import { DatabaseSync } from "node:sqlite";
/**
 * The on-disk structure of the index, in SQLite. This is NOT a serialization of
 * an in-memory graph: it IS the graph. Every code and every adjacency list lives
 * in these tables and is read/written on demand, so process memory stays flat as
 * the collection grows -- only the working set of the current operation, plus
 * SQLite's fixed-size page cache, is ever resident.
 *
 * Tables
 *   meta   one row of configuration + mutable global state (entry point, counts,
 *          level-RNG state). The quantizer's rotation is fully determined by
 *          {dim, rounds, seed, centroid}, so reopening a database reproduces it
 *          exactly without storing any matrix.
 *   nodes  one row per inserted vector: id (rowid), external id, top level,
 *          tombstone flag, and the 1-bit code as a BLOB. Indexed by rowid (code
 *          lookup) and by a partial unique index on the external id (live nodes).
 *   links  one row per (node, layer) holding that node's neighbour ids packed as
 *          a BLOB. WITHOUT ROWID makes (node, layer) the clustering key, so a
 *          neighbour-list fetch -- the hot path of search -- is a single B-tree
 *          descent landing on the inline BLOB.
 */
export interface StoreConfig {
    dim: number;
    m: number;
    efConstruction: number;
    efSearch: number;
    queryBits: number;
    rotationRounds: number;
    seed: number;
    centroid: Float64Array | null;
    codeWords: number;
    paddedDim: number;
}
export interface GlobalState {
    entryPoint: number;
    maxLevel: number;
    live: number;
    total: number;
    rng: number;
}
/** A node as the graph algorithms need it: code bytes, tombstone, external id. */
export interface NodeRec {
    code: Uint8Array;
    deleted: number;
    ext: number | null;
}
export declare class Store {
    readonly db: DatabaseSync;
    /**
     * Number of row reads served from the database (node and neighbour-list
     * fetches). This counts *storage* accesses only, so it is unaffected by any
     * caching layer above it -- the honest measure of how the engine scales.
     */
    reads: number;
    private sInsNode;
    private sNode;
    private sIdByExt;
    private sTombstone;
    private sNbrs;
    private sSetNbrs;
    private sState;
    private readonly cacheBudgetBytes;
    /** Whether the shared memory budget is non-zero — consumers that trade RAM
     *  for speed (the graph's visited-tag array) key off this so the
     *  `cacheSizeMb: 0` flat-memory mode stays exactly flat. */
    get cacheEnabled(): boolean;
    private slab;
    private slabHot;
    private nbrSlab;
    private slabsDerived;
    /**
     * @param dbPath      path to the SQLite file (":memory:" for transient).
     * @param cacheSizeMb the ONE memory knob (MiB). It sizes BOTH SQLite's page
     *        cache AND the immutable-code LRU above (whose entry-capacity is derived
     *        from this budget and the code size — no second knob). Both are pure
     *        speed enhancements: correctness and the per-operation storage-read
     *        count do not depend on them. Pass 0 to run with essentially no cache,
     *        which is how the tests run so a poor access pattern can never hide
     *        behind a warm cache.
     */
    constructor(dbPath: string, cacheSizeMb?: number);
    private tableExists;
    /** (Re)compile the hot statements against the current schema. */
    private prepareAll;
    /** Load the persisted configuration, or null for a fresh database. */
    loadConfig(): StoreConfig | null;
    /** Initialise the meta row for a new database. */
    initConfig(c: StoreConfig): void;
    loadState(): GlobalState;
    saveState(s: GlobalState): void;
    setEfSearch(ef: number): void;
    setQueryBits(bits: number): void;
    resetReads(): void;
    /** Stream every live external id in id order, in bounded-memory batches. */
    liveExts(batch?: number): IterableIterator<number>;
    /** Size the two slabs from the shared memory budget and the actual code
     *  size (known on the first record cached): total slots = budget / bytes
     *  per slot, the upper-layer slab taking half.  A slot is the code bytes
     *  plus 17 B of typed-array bookkeeping (key + ext + deleted). */
    private deriveSlabs;
    /** Record a node in the slab cache.  Upper-layer nodes (level ≥ 1) go to
     *  the pinned section layer-0 traffic never touches; a colliding slot is
     *  simply overwritten (direct-mapped eviction — no bookkeeping). */
    private cacheRec;
    /** Insert a node, returning its assigned id (rowid). */
    addNode(ext: number | null, level: number, code: Uint8Array): number;
    /** Fetch a node's code (copied), tombstone flag and external id, or null.
     *  Served from the slab cache when present; a miss reads SQLite, counts
     *  one `reads` (the cache-independent scalability witness), and caches the
     *  result. The cache is a latency layer ONLY — `reads` does not count hits, so
     *  the index's storage-read scaling is identical with the cache off. */
    getNode(id: number): NodeRec | null;
    idByExt(ext: number): number | null;
    private readonly batchStmts;
    private static readonly BATCH_MAX;
    private batchStmt;
    /** Fetch several nodes into `out` (skipping ids already present).  Serves
     *  from the code LRU first; the misses are read with one IN query per
     *  chunk.  Ids with no row are simply absent from `out`.  Each id that
     *  reaches SQLite counts one `reads`, exactly like a getNode miss. */
    getNodesInto(ids: number[], out: Map<number, NodeRec>, count?: number): void;
    /** Pre-fill the code and neighbour-list caches with ONE sequential table
     *  scan each, up to their existing budget-derived caps.  A cold session
     *  otherwise warms the caches through hundreds of thousands of RANDOM point
     *  reads spread across its first minutes of inserts/queries; a sequential
     *  scan streams the same rows at C speed in seconds.  A pure latency
     *  optimisation with the exact same caps and coherence rules as demand
     *  filling — nothing about results, `reads` discipline, or memory ceilings
     *  changes.  Two passes over `nodes` so the upper-layer pinned section is
     *  filled before layer-0 rows compete for the LRU.  Returns rows warmed. */
    warmCache(): number;
    tombstone(id: number): void;
    /** A node's neighbour ids at a layer, or null if it has no list there. */
    getNeighbors(node: number, layer: number): Uint32Array | null;
    setNeighbors(node: number, layer: number, ids: number[]): void;
    begin(): void;
    commit(): void;
    rollback(): void;
    /** Encode a neighbour id list to the delta-varint blob format. */
    private encodeNbrs;
    /** Decode a delta-varint neighbour blob into a number[]. */
    private decodeNbrs;
    /** Tombstone-splice compaction.  `M`/`Mmax0` cap a rewritten list on upper
     *  layers / layer 0.  Returns the new global state scalars (internal ids are
     *  preserved, so `entry` survives unless it was itself dead).  The caller
     *  persists state and vacuums. */
    spliceCompact(M: number, Mmax0: number, entry: number): {
        entry: number;
        maxLevel: number;
        live: number;
    };
    /** Stream live external ids with internal id > `after`, in internal-id
     *  order, in bounded batches.  Internal ids are assigned monotonically and
     *  PRESERVED by {@link spliceCompact}, so a caller can use the largest
     *  internal id it has seen as a durable incremental watermark. */
    liveExtsSince(after: number, batch?: number): IterableIterator<{
        ext: number;
        internal: number;
    }>;
    vacuum(): void;
    close(): void;
}
