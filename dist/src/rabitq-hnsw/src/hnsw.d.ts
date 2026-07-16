import { RaBitQuantizer } from "./rabitq.js";
import { Store } from "./store.js";
export interface HnswParams {
    M: number;
    efConstruction: number;
    efSearch: number;
    seed: number;
}
export interface KnnHit {
    /** external (user) id */
    id: number;
    /** estimated cosine distance (1 - cosine) */
    distance: number;
}
/**
 * Hierarchical Navigable Small World graph (Malkov & Yashunin, 2018) backed by
 * 1-bit RaBitQ codes that live in SQLite (see Store) rather than in RAM. The
 * algorithm is the textbook one; the only difference is that codes and adjacency
 * lists are read and written through the store on demand, so the resident set is
 * the working set of the current operation -- never the whole graph.
 *
 * Distances use the codes throughout:
 *   - searching with a full-precision query uses RaBitQ's accurate estimator;
 *   - building the graph and searching by code compare two codes by sign-bit
 *     Hamming distance.
 * Building on codes alone is what lets `compact` rebuild an honest index with no
 * access to the original vectors.
 */
export declare class HnswIndex {
    readonly M: number;
    readonly Mmax0: number;
    readonly efConstruction: number;
    private readonly mL;
    private readonly quantizer;
    private readonly store;
    private readonly seed;
    private readonly levelRng;
    private entry;
    private maxLevel;
    private live;
    private total;
    private _efSearch;
    private readonly working;
    private readonly visited;
    private visitedTag;
    private visitedEpoch;
    private seenTag;
    private markVisited;
    private readonly candHeap;
    private readonly resHeap;
    private readonly singleEp;
    private readonly idxScratch;
    private readonly distScratch;
    private readonly freshScratch;
    private qCtx;
    private refBytes;
    private building;
    lastQueryDistComps: number;
    /** Storage row reads issued by the most recent query (cache-independent). */
    lastQueryStorageReads: number;
    constructor(quantizer: RaBitQuantizer, store: Store, params: HnswParams);
    get size(): number;
    get physicalSize(): number;
    get bytesPerVector(): number;
    get efSearch(): number;
    set efSearch(v: number);
    private persistState;
    private randomLevel;
    /**
     * Fetch a node record into the operation's working set. The first touch in an
     * op is a storage read; later touches in the same op reuse it. The set is
     * cleared per op and bounded by efConstruction / efSearch, so storage reads
     * per op equal the number of *distinct* nodes the op visits -- minimal, and
     * independent of any cache.
     */
    private node;
    /** Prefetch several nodes into the working set with ONE batched storage
     *  read for the misses.  Point queries per neighbour made statement
     *  dispatch — not distance arithmetic — the dominant cost of a large
     *  build; the batch keeps `reads` accounting identical per row. */
    private fetchNodes;
    /** Distance from the current source (query vector or reference code) to a node. */
    private distOf;
    /** Code-to-code distance between two stored nodes (graph wiring only). */
    private codeDist;
    /**
     * SEARCH-LAYER (Algorithm 2). Frontier in `candHeap`, bounded result set in
     * `resHeap` (non-deleted only). Deleted nodes are traversed for routing but
     * never returned. `visited` is a per-call set sized by the nodes seen here.
     */
    private searchLayer;
    /** Greedy single-best descent from `fromLayer` down to (but not into) `toLayer`. */
    private greedyDescend;
    /**
     * SELECT-NEIGHBORS-HEURISTIC (Algorithm 4) on codes. Picks up to `M` diverse
     * neighbours from `candIds`, preferring those closer to `base` than to any
     * already-chosen neighbour, then fills remaining slots with the closest
     * leftovers (keep-pruned connections). Appends to `out`.
     */
    private selectNeighbors;
    /**
     * Insert a vector's code under external id `ext`; returns the internal node id.
     * All graph reads/writes go through the store; the caller owns the transaction.
     */
    insert(ext: number, code: Uint8Array, efC?: number): number;
    /** k-NN with a full-precision query vector (accurate estimator). */
    searchKnn(vec: ArrayLike<number>, k: number, ef?: number): KnnHit[];
    /** k-NN with an already-quantized code (sign-bit Hamming / angular distance). */
    searchKnnByCode(codeBytes: Uint8Array, k: number, ef?: number): KnnHit[];
    private collectKnn;
    /** Tombstone a live node by internal id. Caller owns the transaction. */
    remove(id: number): boolean;
    /**
     * Reclaim tombstones with a graph-preserving splice (see
     * {@link Store.spliceCompact}): live nodes keep their internal ids and their
     * wiring; each dead neighbour is replaced by its own live neighbours.  Codes
     * are untouched, so the index loses nothing beyond what deletion itself
     * removes.  The previous implementation replayed every live code through a
     * full HNSW insert — O(live · ef · log N) storage reads, HOURS on a trained
     * multi-million-node store, inside one WAL-bloating transaction.  The splice
     * is a streaming pass with batched commits, then a VACUUM to return the
     * freed pages.
     */
    compact(): void;
}
