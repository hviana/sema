import { IvfHit, IvfIndex } from "./ivf.js";

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
export class VectorDatabase {
  private readonly index: IvfIndex;

  constructor(options: DatabaseOptions) {
    if (
      !options || typeof options.dbPath !== "string" ||
      options.dbPath.length === 0
    ) {
      throw new Error("DatabaseOptions.dbPath (string) is required");
    }
    this.index = new IvfIndex(options.dbPath, options);
  }

  get dim(): number {
    return this.index.dim;
  }

  /** Number of live (non-deleted) vectors. */
  get size(): number {
    return this.index.size;
  }

  /** Physical slot count including tombstones from deletes/updates. */
  get physicalSize(): number {
    return this.index.physicalSize;
  }

  /** Number of clusters (partitions) currently in the index. */
  get clusterCount(): number {
    return this.index.clusterCount;
  }

  get efSearch(): number {
    return this.index.efSearch;
  }
  set efSearch(value: number) {
    this.index.efSearch = value;
  }

  /** Distance computations performed during the most recent query. */
  get lastQueryDistanceComputations(): number {
    return this.index.lastQueryDistComps;
  }

  /** Storage row reads issued by the most recent query — the honest,
   *  cache-independent scalability metric. */
  get lastQueryStorageReads(): number {
    return this.index.lastQueryStorageReads;
  }

  get storage(): StorageStats {
    const f32 = this.dim * 4;
    const bpv = this.index.bytesPerVector;
    return {
      float32BytesPerVector: f32,
      codeBytesPerVector: bpv,
      bytesPerVector: bpv,
      compressionRatio: f32 / bpv,
    };
  }

  private checkId(id: ExternalId): number {
    // 32-bit signed range: chunk blobs store exts as int32 — a wider id
    // would silently truncate, so it is rejected at the door instead.
    if (!Number.isInteger(id) || id > 0x7fffffff || id < -0x80000000) {
      throw new Error(`External id must be a 32-bit integer, got ${id}`);
    }
    return id;
  }

  /** Convert a value to code bytes, selecting by length: `codeWords`
   *  elements → an existing 1-bit code; otherwise a raw `dim`-vector. */
  private toCodeBytes(value: ArrayLike<number>): Uint8Array {
    if (value.length === this.index.codeWords) {
      return this.index.codeToBytes(value);
    }
    if (value.length !== this.dim) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dim}, got ${value.length}`,
      );
    }
    return this.index.encodeToBytes(value);
  }

  has(id: ExternalId): boolean {
    return this.index.has(this.checkId(id));
  }

  /** Stream every live external id (bounded memory). */
  *keys(): IterableIterator<ExternalId> {
    yield* this.index.keys();
  }

  /** Stream live entries whose INTERNAL id is > `after` — a durable
   *  incremental watermark (internal ids are monotone at insert and preserved
   *  by update and compact). */
  *keysSince(
    after: number,
  ): IterableIterator<{ ext: ExternalId; internal: number }> {
    yield* this.index.keysSince(after);
  }

  /** Read the stored 1-bit code for an id (a copy as a Uint32Array), or null. */
  get(id: ExternalId): Uint32Array | null {
    const bytes = this.index.codeOf(this.checkId(id));
    return bytes ? this.index.bytesToCode(bytes) : null;
  }

  insert(id: ExternalId, value: ArrayLike<number>): void {
    this.index.begin();
    try {
      this.index.insert(this.checkId(id), this.toCodeBytes(value));
      this.index.commit();
    } catch (e) {
      this.index.rollback();
      throw e;
    }
  }

  update(id: ExternalId, value: ArrayLike<number>): void {
    this.index.begin();
    try {
      this.index.update(this.checkId(id), this.toCodeBytes(value));
      this.index.commit();
    } catch (e) {
      this.index.rollback();
      throw e;
    }
  }

  upsert(id: ExternalId, value: ArrayLike<number>): void {
    this.upsertMany([{ id, vector: value }]);
  }

  /**
   * Upsert many vectors under ONE transaction — one WAL commit for the whole
   * batch instead of one per vector, with chunk appends to the same cluster
   * coalesced in the index's write-back buffer.
   */
  upsertMany(
    entries: Array<{ id: ExternalId; vector: ArrayLike<number> }>,
  ): void {
    if (entries.length === 0) return;
    this.index.begin();
    try {
      for (const e of entries) {
        // One shared vmap probe decides insert vs update — the per-row point
        // query is the dominant bulk-load cost, so it is never duplicated.
        this.index.upsert(this.checkId(e.id), this.toCodeBytes(e.vector));
      }
      this.index.commit();
    } catch (e) {
      this.index.rollback();
      throw e;
    }
  }

  /** Delete many ids under ONE transaction. Absent ids are skipped.
   *  Returns the number of vectors actually removed. */
  deleteMany(ids: ExternalId[]): number {
    if (ids.length === 0) return 0;
    let removed = 0;
    this.index.begin();
    try {
      for (const id of ids) {
        if (this.index.remove(this.checkId(id))) removed++;
      }
      this.index.commit();
    } catch (e) {
      this.index.rollback();
      throw e;
    }
    return removed;
  }

  /** Delete the vector bound to an id. Returns false if absent. */
  delete(id: ExternalId): boolean {
    return this.deleteMany([id]) === 1;
  }

  /** Heat the SQLite page cache with sequential scans (latency only). */
  warmCache(): number {
    return this.index.warmCache();
  }

  /** Reclaim tombstoned slots by rewriting the clusters that carry any, then
   *  VACUUM.  Internal ids and cluster assignment are preserved. */
  compact(): void {
    this.index.compact();
  }

  /**
   * k-NN search. The argument's length selects the mode:
   *  - `dim` elements       → a raw vector (accurate estimator)
   *  - `codeWords` elements → a 1-bit code, by sign-bit Hamming
   */
  query(
    query: ArrayLike<number>,
    k = 10,
    opts?: { ef?: number },
  ): QueryResult[] {
    let hits: IvfHit[];
    if (query.length === this.index.codeWords) {
      hits = this.index.searchKnnByCode(
        this.index.codeToBytes(query),
        k,
        opts?.ef,
      );
    } else {
      if (query.length !== this.dim) {
        throw new Error(
          `Vector dimension mismatch: expected ${this.dim}, got ${query.length}`,
        );
      }
      hits = this.index.searchKnn(query, k, opts?.ef);
    }
    return hits;
  }

  /** Close the underlying database. The instance must not be used afterwards. */
  close(): void {
    this.index.close();
  }
}
