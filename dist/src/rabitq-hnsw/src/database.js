import { HnswIndex } from "./hnsw.js";
import { RaBitQuantizer } from "./rabitq.js";
import { Store } from "./store.js";
const DEFAULTS = {
    M: 16,
    efConstruction: 200,
    efSearch: 100,
    queryBits: 8,
    rotationRounds: 3,
    seed: 0x1234abcd,
};
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
export class VectorDatabase {
    dim;
    store;
    quantizer;
    index;
    codeWords;
    constructor(options) {
        if (!options || typeof options.dbPath !== "string" ||
            options.dbPath.length === 0) {
            throw new Error("DatabaseOptions.dbPath (string) is required");
        }
        this.store = new Store(options.dbPath, options.cacheSizeMb ?? 64);
        let cfg = this.store.loadConfig();
        if (cfg === null) {
            // Fresh database: derive the configuration from the options and persist it.
            if (!Number.isInteger(options.dim) || options.dim <= 0) {
                throw new Error("DatabaseOptions.dim must be a positive integer for a new database");
            }
            const dim = options.dim;
            const centroid = options.centroid
                ? Float64Array.from(options.centroid)
                : null;
            const probe = new RaBitQuantizer(dim, { rounds: 1, seed: 0 });
            cfg = {
                dim,
                m: options.M ?? DEFAULTS.M,
                efConstruction: options.efConstruction ?? DEFAULTS.efConstruction,
                efSearch: options.efSearch ?? DEFAULTS.efSearch,
                queryBits: options.queryBits ?? DEFAULTS.queryBits,
                rotationRounds: options.rotationRounds ?? DEFAULTS.rotationRounds,
                seed: (options.seed ?? DEFAULTS.seed) >>> 0,
                centroid,
                codeWords: probe.codeWords,
                paddedDim: probe.paddedDim,
            };
            this.store.initConfig(cfg);
        }
        else {
            // Reopened: keep the stored STRUCTURAL config, but allow tuning the two
            // query-side knobs — efSearch and queryBits shape only how a query is
            // executed, never what is stored, so honouring an explicit option here
            // is safe and lets an existing database adopt better query settings.
            if (options.efSearch !== undefined) {
                cfg.efSearch = options.efSearch;
                this.store.setEfSearch(options.efSearch);
            }
            if (options.queryBits !== undefined && options.queryBits !== cfg.queryBits) {
                cfg.queryBits = options.queryBits;
                this.store.setQueryBits(options.queryBits);
            }
        }
        this.dim = cfg.dim;
        this.quantizer = new RaBitQuantizer(cfg.dim, {
            queryBits: cfg.queryBits,
            rounds: cfg.rotationRounds,
            seed: cfg.seed,
            centroid: cfg.centroid ?? undefined,
        });
        if (this.quantizer.codeWords !== cfg.codeWords) {
            throw new Error("Stored code geometry does not match the quantizer (corrupt database?)");
        }
        this.codeWords = this.quantizer.codeWords;
        this.index = new HnswIndex(this.quantizer, this.store, {
            M: cfg.m,
            efConstruction: cfg.efConstruction,
            efSearch: cfg.efSearch,
            seed: cfg.seed,
        });
    }
    /** Number of live (non-deleted) vectors. */
    get size() {
        return this.index.size;
    }
    /**
     * Physical node count including tombstones from deletes/updates. When it grows
     * well beyond `size`, call `compact()` to reclaim the space on disk.
     */
    get physicalSize() {
        return this.index.physicalSize;
    }
    get efSearch() {
        return this.index.efSearch;
    }
    set efSearch(value) {
        this.index.efSearch = value;
    }
    /** Distance computations performed during the most recent query. */
    get lastQueryDistanceComputations() {
        return this.index.lastQueryDistComps;
    }
    /**
     * Storage row reads issued by the most recent query. This is the honest,
     * cache-independent scalability metric: it counts every node/neighbour fetch
     * that hit the database, so disabling the cache cannot hide a bad access pattern.
     */
    get lastQueryStorageReads() {
        return this.index.lastQueryStorageReads;
    }
    /** Per-vector storage cost of the index versus a Float32 baseline. */
    get storage() {
        const f32 = this.dim * 4;
        const bpv = this.index.bytesPerVector;
        return {
            float32BytesPerVector: f32,
            codeBytesPerVector: bpv,
            bytesPerVector: bpv,
            compressionRatio: f32 / bpv,
        };
    }
    has(id) {
        return this.store.idByExt(this.checkId(id)) !== null;
    }
    /** Stream every live external id (bounded memory). */
    *keys() {
        yield* this.store.liveExts();
    }
    /**
     * Stream live entries whose INTERNAL id is > `after`, as
     * {ext, internal} pairs in internal-id order.  Internal ids are assigned
     * monotonically at insert and preserved by {@link compact}, so the largest
     * internal id a caller has seen is a durable incremental watermark: a later
     * call with it yields exactly the entries added since.
     */
    *keysSince(after) {
        yield* this.store.liveExtsSince(after);
    }
    checkId(id) {
        if (!Number.isInteger(id)) {
            throw new Error(`External id must be an integer, got ${id}`);
        }
        return id;
    }
    /**
     * Convert a value to code bytes, selecting by length:
     *  - `codeWords` elements -> an existing 1-bit code (e.g. from `get()`)
     *  - otherwise            -> a raw `dim`-vector, encoded first
     * `codeWords < dim` for any dim >= 2, so the two never collide.
     */
    toCodeBytes(value) {
        if (value.length === this.codeWords) {
            return this.quantizer.codeToBytes(value);
        }
        if (value.length !== this.dim) {
            throw new Error(`Vector dimension mismatch: expected ${this.dim}, got ${value.length}`);
        }
        return this.quantizer.codeToBytes(this.quantizer.encode(value));
    }
    // ------------------------------- CRUD ------------------------------------
    /**
     * Create. Accepts a raw `dim`-vector or a 1-bit code (`codeWords` words),
     * detected by length. Throws if the id already exists (use `update`/`upsert`).
     */
    insert(id, value) {
        this.store.begin();
        try {
            this.insertCore(id, value);
            this.store.commit();
        }
        catch (e) {
            this.store.rollback();
            throw e;
        }
    }
    /** Insert with the caller owning the transaction (used by {@link upsertMany}).
     *  `ef` optionally narrows the construction beam for this one vector (a
     *  caller-declared cheap entry, e.g. a reach-only interior); omitted means
     *  the index's configured efConstruction. */
    insertCore(id, value, ef) {
        this.checkId(id);
        if (this.store.idByExt(id) !== null) {
            throw new Error(`External id already exists: ${id} (use update())`);
        }
        this.index.insert(id, this.toCodeBytes(value), ef);
    }
    upsert(id, value) {
        const nodeId = this.store.idByExt(this.checkId(id));
        if (nodeId === null) {
            this.insert(id, value);
            return;
        }
        this.store.begin();
        try {
            this.updateAt(nodeId, id, value);
            this.store.commit();
        }
        catch (e) {
            this.store.rollback();
            throw e;
        }
    }
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
    upsertMany(entries) {
        if (entries.length === 0)
            return;
        this.store.begin();
        try {
            for (const e of entries) {
                const nodeId = this.store.idByExt(this.checkId(e.id));
                if (nodeId !== null)
                    this.updateAt(nodeId, e.id, e.vector, e.ef);
                else
                    this.insertCore(e.id, e.vector, e.ef);
            }
            this.store.commit();
        }
        catch (e) {
            this.store.rollback();
            throw e;
        }
    }
    /**
     * Read the stored 1-bit code for an id (a copy as a Uint32Array), or null. The
     * original vector is not retained; the code round-trips into insert/update/query.
     */
    get(id) {
        const nodeId = this.store.idByExt(this.checkId(id));
        if (nodeId === null)
            return null;
        const rec = this.store.getNode(nodeId);
        return rec ? this.quantizer.bytesToCode(rec.code) : null;
    }
    /**
     * Update the vector bound to an id (raw vector or code, detected by length).
     * The previous node is tombstoned and a fresh one inserted. Throws if absent.
     */
    update(id, value) {
        this.store.begin();
        try {
            this.updateCore(id, value);
            this.store.commit();
        }
        catch (e) {
            this.store.rollback();
            throw e;
        }
    }
    /** Update with the caller owning the transaction (used by {@link upsertMany}). */
    updateCore(id, value) {
        const oldId = this.store.idByExt(this.checkId(id));
        if (oldId === null)
            throw new Error(`Unknown external id: ${id}`);
        this.updateAt(oldId, id, value);
    }
    /** Update when the live internal node id is already known.
     *
     *  Skips the write entirely when the new code equals the stored one — the
     *  update would tombstone the node and replay a full graph insert for a
     *  byte-identical result. This is not a corner case: content-addressed
     *  callers re-upsert unchanged vectors wholesale after a restart (the same
     *  content always encodes to the same code), and each such no-op otherwise
     *  costs a tombstone (permanent routing/disk overhead until compaction)
     *  plus an O(ef·log N) reinsert. */
    updateAt(nodeId, ext, value, ef) {
        const bytes = this.toCodeBytes(value);
        const rec = this.store.getNode(nodeId);
        if (rec !== null && rec.code.length === bytes.length) {
            let same = true;
            for (let i = 0; i < bytes.length; i++) {
                if (rec.code[i] !== bytes[i]) {
                    same = false;
                    break;
                }
            }
            if (same)
                return; // identical code — the update is a no-op
        }
        this.index.remove(nodeId); // frees the ext id, then re-insert under it
        this.index.insert(ext, bytes, ef);
    }
    /**
     * Delete many ids under ONE transaction — same commit-coalescing rationale
     * as {@link upsertMany}: a tombstone per implicit transaction is one WAL
     * commit per id, which dominates a bulk prune. Absent ids are skipped.
     * Returns the number of vectors actually removed.
     */
    deleteMany(ids) {
        if (ids.length === 0)
            return 0;
        let removed = 0;
        this.store.begin();
        try {
            for (const id of ids) {
                const nodeId = this.store.idByExt(this.checkId(id));
                if (nodeId !== null && this.index.remove(nodeId))
                    removed++;
            }
            this.store.commit();
        }
        catch (e) {
            this.store.rollback();
            throw e;
        }
        return removed;
    }
    /** Delete the vector bound to an id. Returns false if absent. */
    delete(id) {
        const nodeId = this.store.idByExt(this.checkId(id));
        if (nodeId === null)
            return false;
        this.store.begin();
        try {
            this.index.remove(nodeId);
            this.store.commit();
        }
        catch (e) {
            this.store.rollback();
            throw e;
        }
        return true;
    }
    /**
     * Pre-fill the RAM caches (codes + neighbour lists) with sequential table
     * scans, up to their budget-derived caps.  Optional and purely a latency
     * optimisation: a cold session otherwise pays the same warming through
     * random point reads over its first minutes.  Call once after open on a
     * session that will do sustained inserts/queries.  Returns rows warmed;
     * a 0-budget database returns 0 immediately.
     */
    warmCache() {
        return this.store.warmCache();
    }
    /**
     * Rebuild the graph from the live codes only, dropping tombstones and returning
     * the freed pages to the filesystem. Lossless -- equivalent to the original
     * build -- and needs no original vectors.
     */
    compact() {
        this.index.compact();
    }
    // ------------------------------ search -----------------------------------
    /**
     * k-NN search. The argument's length selects the mode:
     *  - `dim` elements       -> a raw vector (accurate 4-bit-query estimator)
     *  - `codeWords` elements -> a 1-bit code (e.g. `get(id)`), by sign-bit Hamming
     * Detection is by length, so a code is recognised whether it is a Uint32Array
     * or a plain number[]. `codeWords < dim` for any dim >= 2, so they never collide.
     */
    query(query, k = 10, opts) {
        if (query.length === this.codeWords) {
            return this.index.searchKnnByCode(this.quantizer.codeToBytes(query), k, opts?.ef);
        }
        if (query.length !== this.dim) {
            throw new Error(`Vector dimension mismatch: expected ${this.dim}, got ${query.length}`);
        }
        return this.index.searchKnn(query, k, opts?.ef);
    }
    /** Close the underlying database. The instance must not be used afterwards. */
    close() {
        this.store.close();
    }
}
