import { IvfIndex } from "./ivf.js";
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
export class VectorDatabase {
    index;
    constructor(options) {
        if (!options || typeof options.dbPath !== "string" ||
            options.dbPath.length === 0) {
            throw new Error("DatabaseOptions.dbPath (string) is required");
        }
        this.index = new IvfIndex(options.dbPath, options);
    }
    get dim() {
        return this.index.dim;
    }
    /** Number of live (non-deleted) vectors. */
    get size() {
        return this.index.size;
    }
    /** Physical slot count including tombstones from deletes/updates. */
    get physicalSize() {
        return this.index.physicalSize;
    }
    /** Number of clusters (partitions) currently in the index. */
    get clusterCount() {
        return this.index.clusterCount;
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
    /** Storage row reads issued by the most recent query — the honest,
     *  cache-independent scalability metric. */
    get lastQueryStorageReads() {
        return this.index.lastQueryStorageReads;
    }
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
    checkId(id) {
        // 32-bit signed range: chunk blobs store exts as int32 — a wider id
        // would silently truncate, so it is rejected at the door instead.
        if (!Number.isInteger(id) || id > 0x7fffffff || id < -0x80000000) {
            throw new Error(`External id must be a 32-bit integer, got ${id}`);
        }
        return id;
    }
    /** Convert a value to code bytes, selecting by length: `codeWords`
     *  elements → an existing 1-bit code; otherwise a raw `dim`-vector. */
    toCodeBytes(value) {
        if (value.length === this.index.codeWords) {
            return this.index.codeToBytes(value);
        }
        if (value.length !== this.dim) {
            throw new Error(`Vector dimension mismatch: expected ${this.dim}, got ${value.length}`);
        }
        return this.index.encodeToBytes(value);
    }
    has(id) {
        return this.index.has(this.checkId(id));
    }
    /** Stream every live external id (bounded memory). */
    *keys() {
        yield* this.index.keys();
    }
    /** Stream live entries whose INTERNAL id is > `after` — a durable
     *  incremental watermark (internal ids are monotone at insert and preserved
     *  by update and compact). */
    *keysSince(after) {
        yield* this.index.keysSince(after);
    }
    /** Read the stored 1-bit code for an id (a copy as a Uint32Array), or null. */
    get(id) {
        const bytes = this.index.codeOf(this.checkId(id));
        return bytes ? this.index.bytesToCode(bytes) : null;
    }
    insert(id, value) {
        this.index.begin();
        try {
            this.index.insert(this.checkId(id), this.toCodeBytes(value));
            this.index.commit();
        }
        catch (e) {
            this.index.rollback();
            throw e;
        }
    }
    update(id, value) {
        this.index.begin();
        try {
            this.index.update(this.checkId(id), this.toCodeBytes(value));
            this.index.commit();
        }
        catch (e) {
            this.index.rollback();
            throw e;
        }
    }
    upsert(id, value) {
        this.upsertMany([{ id, vector: value }]);
    }
    /**
     * Upsert many vectors under ONE transaction — one WAL commit for the whole
     * batch instead of one per vector, with chunk appends to the same cluster
     * coalesced in the index's write-back buffer.
     */
    upsertMany(entries) {
        if (entries.length === 0)
            return;
        this.index.begin();
        try {
            for (const e of entries) {
                // One shared vmap probe decides insert vs update — the per-row point
                // query is the dominant bulk-load cost, so it is never duplicated.
                this.index.upsert(this.checkId(e.id), this.toCodeBytes(e.vector));
            }
            this.index.commit();
        }
        catch (e) {
            this.index.rollback();
            throw e;
        }
    }
    /** Delete many ids under ONE transaction. Absent ids are skipped.
     *  Returns the number of vectors actually removed. */
    deleteMany(ids) {
        if (ids.length === 0)
            return 0;
        let removed = 0;
        this.index.begin();
        try {
            for (const id of ids) {
                if (this.index.remove(this.checkId(id)))
                    removed++;
            }
            this.index.commit();
        }
        catch (e) {
            this.index.rollback();
            throw e;
        }
        return removed;
    }
    /** Delete the vector bound to an id. Returns false if absent. */
    delete(id) {
        return this.deleteMany([id]) === 1;
    }
    /** Heat the SQLite page cache with sequential scans (latency only). */
    warmCache() {
        return this.index.warmCache();
    }
    /** Reclaim tombstoned slots by rewriting the clusters that carry any, then
     *  VACUUM.  Internal ids and cluster assignment are preserved. */
    compact() {
        this.index.compact();
    }
    /**
     * k-NN search. The argument's length selects the mode:
     *  - `dim` elements       → a raw vector (accurate estimator)
     *  - `codeWords` elements → a 1-bit code, by sign-bit Hamming
     */
    query(query, k = 10, opts) {
        let hits;
        if (query.length === this.index.codeWords) {
            hits = this.index.searchKnnByCode(this.index.codeToBytes(query), k, opts?.ef);
        }
        else {
            if (query.length !== this.dim) {
                throw new Error(`Vector dimension mismatch: expected ${this.dim}, got ${query.length}`);
            }
            hits = this.index.searchKnn(query, k, opts?.ef);
        }
        return hits;
    }
    /** Close the underlying database. The instance must not be used afterwards. */
    close() {
        this.index.close();
    }
}
