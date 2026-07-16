// ivf.ts — an adaptive PARTITIONED (IVF-style) index over 1-bit RaBitQ codes,
// persisted in SQLite.
//
// The collection is a flat set of CLUSTERS.  Each cluster has a binary PIVOT
// code and holds its member codes in fixed-size CHUNK blobs.  Inserting is
// "route + append": Hamming-scan the pivot table (RAM-resident, tiny) for the
// nearest cluster, then append the code to that cluster's tail chunk — no
// graph walk, no neighbour rewiring, so insert cost is essentially FLAT in
// collection size (the pivot scan is K = N/⌀cluster comparisons of a few
// dozen machine words; at 10M vectors that is ~0.1 ms of pure arithmetic).
// A graph-based index pays a beam search of dozens of random storage reads
// per insert here — route + append pays none.
//
// Querying ranks every pivot with the accurate RaBitQ estimator (one LUT pass
// per pivot), then linearly scans the NPROBE nearest clusters' chunks with
// the same estimator, keeping the top k in a bounded heap.  Per-query storage
// reads are bounded by nprobe × (chunks per cluster) — a CONSTANT once the
// collection is large enough to split, independent of N.
//
// A cluster that reaches SPLIT_MAX entries is SPLIT in place: two seed codes
// are chosen deterministically (farthest from the old pivot, then farthest
// from the first), members are MEDIAN-split on the two-seed margin (two exact
// halves — nearer-seed assignment degenerates on tie-heavy distributions and
// cascades cluster count), and both halves get fresh majority-bit pivots.
// No RNG anywhere — the index is a pure function of the insertion sequence.
//
// Durability follows the store discipline used across Sema: WAL journal,
// batched caller-owned transactions (upsertMany), 1 KiB pages, and a 64 MiB
// autocheckpoint so hot pages coalesce in the WAL instead of being copied out
// per commit.
//
// Layout (all in one SQLite file):
//   meta   one row: quantizer geometry + efSearch + counters.
//   cent   one row per cluster: pivot code + chunk/entry counts.
//   chunk  one row per fixed-capacity chunk of a cluster, keyed by
//          cid·2^16 + seq: a packed blob of [n | dead bitmap | ids | exts |
//          codes].  Fixed-size blobs keep B-tree pages stable under the
//          read-modify-write tail append.
//   vmap   one row per live vector: ext → (monotone internal id, cid, seq,
//          slot).  The internal id survives compaction, so the largest id a
//          scan has seen is a durable incremental watermark (keysSince).

import { DatabaseSync, StatementSync } from "node:sqlite";
import { QueryContext, RaBitQuantizer } from "./rabitq.js";

/** Entries per chunk blob.  64 keeps the tail read-modify-write ≤ ~9 KiB at
 *  D=1024 while a full cluster is only SPLIT_MAX/64 blob reads per probe. */
const CHUNK_CAP = 64;
/** Entries (live + dead) at which a cluster splits in two. */
const SPLIT_MAX = 4096;
/** chunk rowid key = cid·SEQ_SPAN + seq.  Chunks per cluster ≤ SPLIT_MAX /
 *  CHUNK_CAP = 64 ≪ 2^16, and cid·2^16 stays exact in a double for every
 *  reachable cid. */
const SEQ_SPAN = 1 << 16;

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

// ── chunk blob layout (fixed size) ─────────────────────────────────────────
// [0]        u32  n            entries used (live + dead)
// [4..12)    u64  dead bitmap  bit s set = slot s tombstoned
// [12..16)        pad
// [16..)     CHUNK_CAP × f64   internal ids
// [+..)      CHUNK_CAP × i32   external ids
// [+..)      CHUNK_CAP × codeBytes  codes
const IDS_OFF = 16;
const EXTS_OFF = IDS_OFF + CHUNK_CAP * 8;
const CODES_OFF = EXTS_OFF + CHUNK_CAP * 4;

function chunkSize(codeBytes: number): number {
  return CODES_OFF + CHUNK_CAP * codeBytes;
}

/** Typed-array views over one chunk blob.  The blob is allocated aligned
 *  (fresh Uint8Array), so the f64/i32 views are always valid. */
class Chunk {
  readonly buf: Uint8Array;
  readonly n32: Uint32Array; // [0] = n
  readonly dead: Uint8Array; // 8 bytes at offset 4
  readonly ids: Float64Array;
  readonly exts: Int32Array;
  constructor(buf: Uint8Array) {
    // A blob straight from SQLite may sit at an arbitrary byteOffset; copy to
    // an aligned buffer only when needed.
    if (buf.byteOffset % 8 !== 0) buf = new Uint8Array(buf);
    this.buf = buf;
    this.n32 = new Uint32Array(buf.buffer, buf.byteOffset, 4);
    this.dead = buf.subarray(4, 12);
    this.ids = new Float64Array(
      buf.buffer,
      buf.byteOffset + IDS_OFF,
      CHUNK_CAP,
    );
    this.exts = new Int32Array(
      buf.buffer,
      buf.byteOffset + EXTS_OFF,
      CHUNK_CAP,
    );
  }
  get n(): number {
    return this.n32[0];
  }
  set n(v: number) {
    this.n32[0] = v;
  }
  isDead(slot: number): boolean {
    return (this.dead[slot >> 3] & (1 << (slot & 7))) !== 0;
  }
  markDead(slot: number): void {
    this.dead[slot >> 3] |= 1 << (slot & 7);
  }
  codeAt(slot: number, codeBytes: number): number {
    return CODES_OFF + slot * codeBytes; // byte offset into buf
  }
}

/** Bounded max-heap of (distance, ext) — keeps the k SMALLEST distances. */
class TopK {
  readonly ds: Float64Array;
  readonly ids: Float64Array;
  size = 0;
  constructor(readonly k: number) {
    this.ds = new Float64Array(k);
    this.ids = new Float64Array(k);
  }
  get worst(): number {
    return this.size < this.k ? Infinity : this.ds[0];
  }
  push(d: number, id: number): void {
    const { ds, ids } = this;
    if (this.size < this.k) {
      let i = this.size++;
      ds[i] = d;
      ids[i] = id;
      for (;;) { // sift up
        if (i === 0) break;
        const p = (i - 1) >> 1;
        if (ds[p] >= ds[i]) break;
        const td = ds[p], ti = ids[p];
        ds[p] = ds[i];
        ids[p] = ids[i];
        ds[i] = td;
        ids[i] = ti;
        i = p;
      }
      return;
    }
    if (d >= ds[0]) return;
    ds[0] = d;
    ids[0] = id;
    let i = 0;
    for (;;) { // sift down
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.size && ds[l] > ds[m]) m = l;
      if (r < this.size && ds[r] > ds[m]) m = r;
      if (m === i) break;
      const td = ds[m], ti = ids[m];
      ds[m] = ds[i];
      ids[m] = ids[i];
      ds[i] = td;
      ids[i] = ti;
      i = m;
    }
  }
  drain(): IvfHit[] {
    const out: IvfHit[] = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      out[i] = { id: this.ids[i], distance: this.ds[i] < 0 ? 0 : this.ds[i] };
    }
    out.sort((a, b) => a.distance - b.distance);
    return out;
  }
}

export class IvfIndex {
  readonly db: DatabaseSync;
  private readonly quantizer: RaBitQuantizer;
  private readonly codeBytes: number;
  private readonly chunkBytes: number;
  private _efSearch: number;

  // ── RAM-resident routing state (O(K); K = clusters ≈ N / 2048) ──────────
  /** Pivot codes, K × codeBytes, contiguous — the insert/query routing scan
   *  is one linear pass over this array. */
  private centCodes = new Uint8Array(0);
  /** Aligned 32-bit word view of {@link centCodes} — the routing scan's
   *  operand (4 bytes per XOR+popcount instead of byte re-composition). */
  private centWords = new Uint32Array(0);
  /** Per-cluster entry count (live + dead) — the split trigger. */
  private centEntries = new Int32Array(0);
  /** Per-cluster chunk count (tail seq = count − 1). */
  private centChunks = new Int32Array(0);
  private K = 0;

  // global counters (persisted in meta at commit)
  private live = 0;
  private totalSlots = 0;
  private nextId = 1;

  /** Storage row reads (chunk blob fetches) — the cache-independent
   *  scalability witness, same discipline as the graph index it replaces. */
  reads = 0;
  lastQueryDistComps = 0;
  lastQueryStorageReads = 0;

  // Per-transaction write-back buffer of dirty chunks, doubling as a CLEAN
  // read cache when a memory budget was granted.  The `reads` counter counts
  // SQLite fall-throughs only, so with `cacheSizeMb: 0` clean retention is
  // DISABLED (dirty chunks must still buffer within a transaction — that is
  // write coalescing, not read caching) and every re-fetch is an honest
  // storage read.  Budget-derived cap; flushed entries stay readable from
  // SQLite, so eviction is safe anywhere outside the dirty set.
  private readonly chunkCache = new Map<number, Chunk>();
  private readonly dirtyChunks = new Set<number>();
  private readonly dirtyCents = new Set<number>();
  private metaDirty = false;
  private readonly cacheEnabled: boolean;
  private readonly chunkCacheMax: number;

  private sSelChunk!: StatementSync;
  private sUpsChunk!: StatementSync;
  private sDelChunk!: StatementSync;
  private sSelVmap!: StatementSync;
  private sInsVmap!: StatementSync;
  private sUpdVmap!: StatementSync;
  private sDelVmap!: StatementSync;
  private sUpsCent!: StatementSync;
  private sMeta!: StatementSync;

  constructor(
    dbPath: string,
    options: {
      dim?: number;
      efSearch?: number;
      queryBits?: number;
      rotationRounds?: number;
      seed?: number;
      centroid?: ArrayLike<number>;
      cacheSizeMb?: number;
    },
  ) {
    this.db = new DatabaseSync(dbPath);
    const kb = Math.max(0, Math.floor((options.cacheSizeMb ?? 64) * 1024));
    this.cacheEnabled = kb > 0;
    // 1 KiB pages (chunk blobs span ~9 pages; cent/vmap rows are small), WAL
    // with a 64 MiB autocheckpoint (see store-sqlite.ts for the rationale —
    // the 1000-page default forced a synchronous checkpoint per batch).
    this.db.exec("PRAGMA page_size = 1024;");
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = ${kb > 0 ? `-${kb}` : "0"};
      PRAGMA wal_autocheckpoint = 65536;
      PRAGMA foreign_keys = OFF;
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        id              INTEGER PRIMARY KEY CHECK (id = 0),
        format          TEXT NOT NULL,
        dim             INTEGER NOT NULL,
        query_bits      INTEGER NOT NULL,
        rotation_rounds INTEGER NOT NULL,
        seed            INTEGER NOT NULL,
        centroid        BLOB,
        code_words      INTEGER NOT NULL,
        padded_dim      INTEGER NOT NULL,
        ef_search       INTEGER NOT NULL,
        live            INTEGER NOT NULL DEFAULT 0,
        total           INTEGER NOT NULL DEFAULT 0,
        next_id         INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS cent (
        cid     INTEGER PRIMARY KEY,
        code    BLOB NOT NULL,
        chunks  INTEGER NOT NULL,
        entries INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunk (
        key  INTEGER PRIMARY KEY,
        blob BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vmap (
        ext  INTEGER PRIMARY KEY,
        id   INTEGER NOT NULL,
        cid  INTEGER NOT NULL,
        seq  INTEGER NOT NULL,
        slot INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vmap_id ON vmap(id);
    `);

    // ── config: load stored, or initialise from options ──
    const row = this.db.prepare("SELECT * FROM meta WHERE id = 0").get() as
      | Record<string, unknown>
      | undefined;
    let cfg: IvfConfig;
    if (row) {
      if (row.format !== "ivf1") {
        throw new Error(
          `vector index at ${dbPath} has format '${String(row.format)}', ` +
            `expected 'ivf1' — delete the .vec files and rebuild ` +
            `(Store.repairContentIndex regenerates the content index)`,
        );
      }
      let centroid: Float64Array | null = null;
      const cb = row.centroid as Uint8Array | null;
      if (cb) {
        centroid = new Float64Array(row.dim as number);
        new Uint8Array(centroid.buffer).set(cb);
      }
      cfg = {
        dim: row.dim as number,
        efSearch: options.efSearch ?? (row.ef_search as number),
        queryBits: options.queryBits ?? (row.query_bits as number),
        rotationRounds: row.rotation_rounds as number,
        seed: row.seed as number,
        centroid,
        codeWords: row.code_words as number,
        paddedDim: row.padded_dim as number,
      };
      if (
        options.efSearch !== undefined &&
        options.efSearch !== (row.ef_search as number)
      ) {
        this.db.prepare("UPDATE meta SET ef_search = ? WHERE id = 0")
          .run(options.efSearch);
      }
      if (
        options.queryBits !== undefined &&
        options.queryBits !== (row.query_bits as number)
      ) {
        this.db.prepare("UPDATE meta SET query_bits = ? WHERE id = 0")
          .run(options.queryBits);
      }
      this.live = row.live as number;
      this.totalSlots = row.total as number;
      this.nextId = row.next_id as number;
    } else {
      if (!Number.isInteger(options.dim) || (options.dim as number) <= 0) {
        throw new Error("dim must be a positive integer for a new database");
      }
      const dim = options.dim as number;
      const probe = new RaBitQuantizer(dim, { rounds: 1, seed: 0 });
      cfg = {
        dim,
        efSearch: options.efSearch ?? 64,
        queryBits: options.queryBits ?? 8,
        rotationRounds: options.rotationRounds ?? 3,
        seed: (options.seed ?? 0x1234abcd) >>> 0,
        centroid: options.centroid ? Float64Array.from(options.centroid) : null,
        codeWords: probe.codeWords,
        paddedDim: probe.paddedDim,
      };
      const centroidBlob = cfg.centroid
        ? new Uint8Array(cfg.centroid.buffer, 0, cfg.centroid.byteLength)
        : null;
      this.db.prepare(
        "INSERT INTO meta (id, format, dim, query_bits, rotation_rounds, " +
          "seed, centroid, code_words, padded_dim, ef_search) " +
          "VALUES (0, 'ivf1', ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        cfg.dim,
        cfg.queryBits,
        cfg.rotationRounds,
        cfg.seed,
        centroidBlob,
        cfg.codeWords,
        cfg.paddedDim,
        cfg.efSearch,
      );
    }

    this.quantizer = new RaBitQuantizer(cfg.dim, {
      queryBits: cfg.queryBits,
      rounds: cfg.rotationRounds,
      seed: cfg.seed,
      centroid: cfg.centroid ?? undefined,
    });
    if (this.quantizer.codeWords !== cfg.codeWords) {
      throw new Error(
        "Stored code geometry does not match the quantizer (corrupt database?)",
      );
    }
    this.codeBytes = cfg.codeWords * 4;
    this.chunkBytes = chunkSize(this.codeBytes);
    // Clean-chunk retention cap, derived from the memory budget (~9 KiB per
    // chunk at D=1024).  With the budget at 0 only dirty chunks are held.
    this.chunkCacheMax = this.cacheEnabled
      ? Math.max(64, Math.min(Math.floor((kb * 1024) / this.chunkBytes), 65536))
      : 64;
    this._efSearch = cfg.efSearch;
    this.dim = cfg.dim;

    this.prepareAll();
    this.loadCents();
  }

  readonly dim: number;

  private prepareAll(): void {
    this.sSelChunk = this.db.prepare("SELECT blob FROM chunk WHERE key = ?");
    this.sSelChunk.setReturnArrays(true);
    this.sUpsChunk = this.db.prepare(
      "INSERT INTO chunk (key, blob) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET blob = excluded.blob",
    );
    this.sDelChunk = this.db.prepare("DELETE FROM chunk WHERE key = ?");
    this.sSelVmap = this.db.prepare(
      "SELECT id, cid, seq, slot FROM vmap WHERE ext = ?",
    );
    this.sSelVmap.setReturnArrays(true);
    this.sInsVmap = this.db.prepare(
      "INSERT INTO vmap (ext, id, cid, seq, slot) VALUES (?, ?, ?, ?, ?)",
    );
    this.sUpdVmap = this.db.prepare(
      "UPDATE vmap SET cid = ?, seq = ?, slot = ? WHERE ext = ?",
    );
    this.sDelVmap = this.db.prepare("DELETE FROM vmap WHERE ext = ?");
    this.sUpsCent = this.db.prepare(
      "INSERT INTO cent (cid, code, chunks, entries) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(cid) DO UPDATE SET code = excluded.code, " +
        "chunks = excluded.chunks, entries = excluded.entries",
    );
    this.sMeta = this.db.prepare(
      "UPDATE meta SET live = ?, total = ?, next_id = ? WHERE id = 0",
    );
  }

  /** Load the pivot table into RAM — K rows, ~(codeBytes + 8) bytes each. */
  private loadCents(): void {
    const rows = this.db.prepare(
      "SELECT cid, code, chunks, entries FROM cent ORDER BY cid",
    ).all() as Array<
      { cid: number; code: Uint8Array; chunks: number; entries: number }
    >;
    this.K = rows.length === 0 ? 0 : rows[rows.length - 1].cid + 1;
    const cap = Math.max(16, this.K);
    this.centCodes = new Uint8Array(cap * this.codeBytes);
    this.centWords = new Uint32Array(this.centCodes.buffer);
    this.centEntries = new Int32Array(cap);
    this.centChunks = new Int32Array(cap);
    for (const r of rows) {
      this.centCodes.set(r.code, r.cid * this.codeBytes);
      this.centEntries[r.cid] = r.entries;
      this.centChunks[r.cid] = r.chunks;
    }
    // Super-pivots are derived state — rebuild lazily from scratch.
    this.superWords = new Uint32Array(0);
    this.superStale.clear();
    const G = IvfIndex.SUPER_G;
    for (let g = 0; g * G < this.K; g++) this.superStale.add(g);
  }

  private growCents(): void {
    const cap = this.centEntries.length;
    if (this.K < cap) return;
    const ncap = cap * 2;
    const codes = new Uint8Array(ncap * this.codeBytes);
    codes.set(this.centCodes);
    this.centCodes = codes;
    this.centWords = new Uint32Array(codes.buffer);
    const e = new Int32Array(ncap);
    e.set(this.centEntries);
    this.centEntries = e;
    const c = new Int32Array(ncap);
    c.set(this.centChunks);
    this.centChunks = c;
  }

  // ── counters ────────────────────────────────────────────────────────────

  get size(): number {
    return this.live;
  }
  get physicalSize(): number {
    return this.totalSlots;
  }
  get clusterCount(): number {
    return this.K;
  }
  get bytesPerVector(): number {
    return this.codeBytes;
  }
  get efSearch(): number {
    return this._efSearch;
  }
  set efSearch(v: number) {
    this._efSearch = Math.max(1, v | 0);
    this.db.prepare("UPDATE meta SET ef_search = ? WHERE id = 0")
      .run(this._efSearch);
  }
  resetReads(): void {
    this.reads = 0;
  }

  // ── chunk IO (write-back cached within a transaction) ───────────────────

  /** Fetch a chunk, serving dirty/cached copies first.  `retain` controls
   *  whether a clean fetch enters the cache — read-only consumers pass the
   *  cacheEnabled flag so the `cacheSizeMb: 0` mode stays honestly uncached;
   *  writers always retain (the copy is about to become dirty). */
  private chunkAt(cid: number, seq: number, retain = true): Chunk {
    const key = cid * SEQ_SPAN + seq;
    const hit = this.chunkCache.get(key);
    if (hit !== undefined) return hit;
    this.reads++;
    const row = this.sSelChunk.get(key) as [Uint8Array] | undefined;
    const c = new Chunk(row ? row[0] : new Uint8Array(this.chunkBytes));
    if (retain) this.cacheChunk(key, c);
    return c;
  }

  private cacheChunk(key: number, c: Chunk): void {
    if (this.chunkCache.size >= this.chunkCacheMax) this.flushChunks();
    this.chunkCache.set(key, c);
  }

  private markDirty(cid: number, seq: number, c: Chunk): void {
    const key = cid * SEQ_SPAN + seq;
    if (!this.chunkCache.has(key)) this.chunkCache.set(key, c);
    this.dirtyChunks.add(key);
  }

  /** Write every dirty chunk row; drop the clean cache only when retention
   *  is off (no budget) — under a budget the warm set survives the flush.
   *  Runs inside the caller's transaction. */
  private flushChunks(): void {
    for (const key of this.dirtyChunks) {
      const c = this.chunkCache.get(key)!;
      this.sUpsChunk.run(key, c.buf);
    }
    this.dirtyChunks.clear();
    if (!this.cacheEnabled || this.chunkCache.size >= this.chunkCacheMax) {
      this.chunkCache.clear();
    }
  }

  private flushCents(): void {
    for (const cid of this.dirtyCents) {
      this.sUpsCent.run(
        cid,
        this.centCodes.subarray(
          cid * this.codeBytes,
          (cid + 1) * this.codeBytes,
        ),
        this.centChunks[cid],
        this.centEntries[cid],
      );
    }
    this.dirtyCents.clear();
    if (this.metaDirty) {
      this.sMeta.run(this.live, this.totalSlots, this.nextId);
      this.metaDirty = false;
    }
  }

  /** Persist all buffered state.  MUST be called before the enclosing
   *  transaction commits (upsertMany/deleteMany do; single-op paths too). */
  private flushAll(): void {
    this.flushChunks();
    this.flushCents();
  }

  // ── routing ─────────────────────────────────────────────────────────────
  //
  // TWO-LEVEL: a flat pivot scan is O(K) per insert with K growing as N/2048,
  // which quietly becomes the dominant insert cost at millions of vectors
  // (profiled: 33% of a 400k bulk load, and rising).  Pivots are therefore
  // grouped into SUPER-GROUPS of SUPER_G consecutive cids; each group carries
  // a majority-bit super-pivot (pure RAM, derived — rebuilt from centCodes on
  // open, marked stale when any member pivot changes).  Routing scans the
  // K/SUPER_G super-pivots, takes the SUPER_TOP nearest groups, and scans
  // only their members exactly: O(K/64 + 256) word-Hamming rows per insert.
  // Deterministic (majority + fixed tie order).  Routing is a placement
  // heuristic — a near-best cluster is as good as the best for recall, since
  // queries probe many clusters — so the approximation never affects results
  // beyond which (equally valid) cluster holds a code.

  private static readonly SUPER_G = 64;
  private static readonly SUPER_TOP = 4;
  /** Majority super-pivot codes, one per group of SUPER_G clusters. */
  private superWords = new Uint32Array(0);
  /** Group ids whose super-pivot is stale (member pivot changed). */
  private readonly superStale = new Set<number>();

  /** Scratch word view of the code being routed (avoids per-call copies). */
  private routeScratch = new Uint32Array(0);

  private markSuperStale(cid: number): void {
    this.superStale.add(Math.floor(cid / IvfIndex.SUPER_G));
  }

  /** Recompute stale super-pivots (majority bit over member pivots). */
  private freshenSupers(): void {
    if (this.superStale.size === 0) return;
    const words = this.codeBytes >> 2;
    const G = IvfIndex.SUPER_G;
    const groups = Math.ceil(this.K / G);
    if (this.superWords.length < groups * words) {
      const grown = new Uint32Array(
        Math.max(groups, 16) * 2 * words,
      );
      grown.set(this.superWords);
      this.superWords = grown;
    }
    const cw = this.centWords;
    for (const g of this.superStale) {
      const lo = g * G;
      const hi = Math.min(lo + G, this.K);
      if (hi <= lo) continue;
      const m = hi - lo;
      const half = m / 2;
      const out = g * words;
      for (let w = 0; w < words; w++) {
        let word = 0;
        for (let bit = 0; bit < 32; bit++) {
          const mask = 1 << bit;
          let ones = 0;
          for (let cid = lo; cid < hi; cid++) {
            if (cw[cid * words + w] & mask) ones++;
          }
          if (ones > half) word |= mask;
        }
        this.superWords[out + w] = word;
      }
    }
    this.superStale.clear();
  }

  /** Word-popcount Hamming between the routing scratch and a words-row. */
  private hamAt(q: Uint32Array, arr: Uint32Array, base: number): number {
    const words = this.codeBytes >> 2;
    let ham = 0;
    for (let w = 0; w < words; w++) {
      let x = q[w] ^ arr[base + w];
      x -= (x >>> 1) & 0x55555555;
      x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
      x = (x + (x >>> 4)) & 0x0f0f0f0f;
      ham += Math.imul(x, 0x01010101) >>> 24;
    }
    return ham;
  }

  /** Nearest cluster to a code — exact over member pivots of the SUPER_TOP
   *  nearest super-groups (or over everything while K is small).  Pure RAM,
   *  no allocation, no storage reads. */
  private nearestCid(code: Uint8Array): number {
    const words = this.codeBytes >> 2;
    if (this.routeScratch.length < words) {
      this.routeScratch = new Uint32Array(words);
    }
    const q = this.routeScratch;
    new Uint8Array(q.buffer, 0, this.codeBytes).set(code);
    const cw = this.centWords;
    const G = IvfIndex.SUPER_G;

    let best = -1;
    let bestD = Infinity;
    const scanGroup = (lo: number, hi: number): void => {
      for (let cid = lo; cid < hi; cid++) {
        const d = this.hamAt(q, cw, cid * words);
        if (d < bestD) {
          bestD = d;
          best = cid;
        }
      }
    };

    if (this.K <= 2 * G * IvfIndex.SUPER_TOP) {
      scanGroup(0, this.K); // small collection — exact flat scan
      return best;
    }

    this.freshenSupers();
    const groups = Math.ceil(this.K / G);
    // Top SUPER_TOP groups by super-pivot Hamming (tiny insertion "heap").
    const T = IvfIndex.SUPER_TOP;
    const gIds = new Int32Array(T).fill(-1);
    const gDs = new Float64Array(T).fill(Infinity);
    for (let g = 0; g < groups; g++) {
      const d = this.hamAt(q, this.superWords, g * words);
      if (d >= gDs[T - 1]) continue;
      let i = T - 1;
      while (i > 0 && gDs[i - 1] > d) {
        gDs[i] = gDs[i - 1];
        gIds[i] = gIds[i - 1];
        i--;
      }
      gDs[i] = d;
      gIds[i] = g;
    }
    for (let t = 0; t < T; t++) {
      const g = gIds[t];
      if (g < 0) continue;
      scanGroup(g * G, Math.min((g + 1) * G, this.K));
    }
    return best;
  }

  /** The nprobe nearest clusters to a QUERY (accurate estimator on pivots),
   *  as cids ordered nearest-first. */
  private probeOrder(q: QueryContext, nprobe: number): number[] {
    const top = new TopK(Math.min(nprobe, this.K));
    const cb = this.codeBytes;
    for (let cid = 0; cid < this.K; cid++) {
      // Empty clusters can exist transiently after a compact; skip.
      if (this.centEntries[cid] === 0) continue;
      const d = this.quantizer.estimate(this.centCodes, cid * cb, q);
      top.push(d, cid);
    }
    return top.drain().map((h) => h.id);
  }

  private probeOrderByCode(code: Uint8Array, nprobe: number): number[] {
    const top = new TopK(Math.min(nprobe, this.K));
    const cb = this.codeBytes;
    const cc = this.centCodes;
    for (let cid = 0; cid < this.K; cid++) {
      if (this.centEntries[cid] === 0) continue;
      top.push(
        this.quantizer.codeDistanceBytes(
          code,
          cc.subarray(cid * cb, cid * cb + cb),
        ),
        cid,
      );
    }
    return top.drain().map((h) => h.id);
  }

  // ── insert / update / delete ────────────────────────────────────────────

  /** Whether an external id is present (live). */
  has(ext: number): boolean {
    return this.sSelVmap.get(ext) !== undefined;
  }

  /** The stored code for an ext (a copy), or null. */
  codeOf(ext: number): Uint8Array | null {
    const row = this.sSelVmap.get(ext) as
      | [number, number, number, number]
      | undefined;
    if (!row) return null;
    const c = this.chunkAt(row[1], row[2], this.cacheEnabled);
    const off = c.codeAt(row[3], this.codeBytes);
    return c.buf.slice(off, off + this.codeBytes);
  }

  /** Insert a code under `ext`.  Caller owns the transaction; buffered rows
   *  are flushed by {@link commitFlush}.  Throws if ext is already live. */
  insert(ext: number, code: Uint8Array): void {
    if (this.sSelVmap.get(ext) !== undefined) {
      throw new Error(`External id already exists: ${ext} (use update())`);
    }
    this.insertNew(ext, code);
  }

  /** Insert-or-update with ONE vmap probe.  The point probe is a real cost
   *  at bulk-load rates (statement dispatch + a B-tree descent per row —
   *  profiled as the single largest insert-path term), so the presence check
   *  and the update lookup share it. */
  upsert(ext: number, code: Uint8Array): void {
    const row = this.sSelVmap.get(ext) as
      | [number, number, number, number]
      | undefined;
    if (row === undefined) this.insertNew(ext, code);
    else this.updateAt(row, ext, code);
  }

  /** The insert core — presence already established by the caller. */
  private insertNew(ext: number, code: Uint8Array): void {
    const cid = this.K === 0 ? this.newCluster(code) : this.nearestCid(code);
    this.appendToCluster(cid, ext, code, this.nextId++);
    this.live++;
    this.totalSlots++;
    this.metaDirty = true;
    if (this.centEntries[cid] >= SPLIT_MAX) this.split(cid);
  }

  private newCluster(pivot: Uint8Array): number {
    const cid = this.K++;
    this.growCents();
    this.centCodes.set(pivot, cid * this.codeBytes);
    this.centEntries[cid] = 0;
    this.centChunks[cid] = 0;
    this.dirtyCents.add(cid);
    this.markSuperStale(cid);
    return cid;
  }

  private appendToCluster(
    cid: number,
    ext: number,
    code: Uint8Array,
    id: number,
  ): void {
    let seq = this.centChunks[cid] - 1;
    let c: Chunk;
    if (seq < 0 || (c = this.chunkAt(cid, seq)).n >= CHUNK_CAP) {
      seq = this.centChunks[cid]++;
      c = new Chunk(new Uint8Array(this.chunkBytes));
      this.cacheChunk(cid * SEQ_SPAN + seq, c);
    }
    const slot = c.n;
    c.ids[slot] = id;
    c.exts[slot] = ext;
    c.buf.set(code, c.codeAt(slot, this.codeBytes));
    c.n = slot + 1;
    this.markDirty(cid, seq, c);
    this.centEntries[cid]++;
    this.dirtyCents.add(cid);
    this.sInsVmap.run(ext, id, cid, seq, slot);
  }

  /** Tombstone a live ext.  Returns false when absent. */
  remove(ext: number): boolean {
    const row = this.sSelVmap.get(ext) as
      | [number, number, number, number]
      | undefined;
    if (!row) return false;
    const [, cid, seq, slot] = row;
    const c = this.chunkAt(cid, seq);
    c.markDead(slot);
    this.markDirty(cid, seq, c);
    this.sDelVmap.run(ext);
    this.live--;
    this.metaDirty = true;
    return true;
  }

  /** Update the code bound to a live ext.  A byte-identical code is a no-op
   *  (content-addressed callers re-upsert unchanged vectors wholesale after a
   *  restart; each no-op otherwise costs a tombstone + reinsert). */
  update(ext: number, code: Uint8Array): void {
    const row = this.sSelVmap.get(ext) as
      | [number, number, number, number]
      | undefined;
    if (!row) throw new Error(`Unknown external id: ${ext}`);
    this.updateAt(row, ext, code);
  }

  private updateAt(
    row: [number, number, number, number],
    ext: number,
    code: Uint8Array,
  ): void {
    const [id, cid, seq, slot] = row;
    const c = this.chunkAt(cid, seq);
    const off = c.codeAt(slot, this.codeBytes);
    let same = true;
    for (let i = 0; i < this.codeBytes; i++) {
      if (c.buf[off + i] !== code[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
    c.markDead(slot);
    this.markDirty(cid, seq, c);
    const ncid = this.nearestCid(code);
    this.sDelVmap.run(ext);
    this.appendToCluster(ncid, ext, code, id); // internal id is preserved
    this.totalSlots++;
    this.metaDirty = true;
    if (this.centEntries[ncid] >= SPLIT_MAX) this.split(ncid);
  }

  /** Flush buffered chunk/cent/meta rows.  Call before COMMIT. */
  commitFlush(): void {
    this.flushAll();
  }

  // ── split ───────────────────────────────────────────────────────────────

  /** Split a full cluster in two, deterministically.  Dead slots are dropped
   *  (splits double as incremental compaction).  Both halves get fresh
   *  majority-bit pivots, so routing sharpens as the corpus grows. */
  private split(cid: number): void {
    const cb = this.codeBytes;
    // Slots (live + dead) this cluster held before the rewrite — the exact
    // amount the rewrite's dead-drop reclaims from the physical count.
    const slotsBefore = this.centEntries[cid];
    // 1. Gather live members.
    const chunks = this.centChunks[cid];
    const exts: number[] = [];
    const ids: number[] = [];
    const codes: Uint8Array[] = [];
    for (let seq = 0; seq < chunks; seq++) {
      const c = this.chunkAt(cid, seq);
      for (let s = 0; s < c.n; s++) {
        if (c.isDead(s)) continue;
        exts.push(c.exts[s]);
        ids.push(c.ids[s]);
        const off = c.codeAt(s, cb);
        codes.push(c.buf.slice(off, off + cb));
      }
    }
    const n = codes.length;
    if (n < 2) {
      // Degenerate (a cluster emptied by removes): rewrite in place, dropping
      // dead slots; no second cluster is minted.
      const oc = this.centChunks[cid];
      this.rebuildCluster(cid, oc, codes, exts, ids, null, 0);
      this.totalSlots -= slotsBefore - n;
      this.metaDirty = true;
      return;
    }
    const pivot = this.centCodes.subarray(cid * cb, cid * cb + cb);

    // 2. Deterministic 2-seed choice: farthest from the old pivot, then
    //    farthest from the first seed (ties → lowest index).
    const dist = (a: Uint8Array, b: Uint8Array) =>
      this.quantizer.codeDistanceBytes(a, b);
    let ai = 0, bd = -1;
    for (let i = 0; i < n; i++) {
      const d = dist(codes[i], pivot);
      if (d > bd) {
        bd = d;
        ai = i;
      }
    }
    let bi = ai === 0 ? 1 % Math.max(n, 1) : 0;
    bd = -1;
    for (let i = 0; i < n; i++) {
      if (i === ai) continue;
      const d = dist(codes[i], codes[ai]);
      if (d > bd) {
        bd = d;
        bi = i;
      }
    }

    // 3. MEDIAN split on the two-seed margin.  Assigning each member to its
    //    nearer seed degenerates on tie-heavy code distributions (everything
    //    lands on one side, the full side immediately re-splits, and cluster
    //    count cascades) — the median cut guarantees two n/2 halves whatever
    //    the geometry, so a split always halves the cluster.  Ties break by
    //    insertion index: deterministic.
    const seedA0 = codes[ai], seedB0 = codes[bi];
    const margin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      margin[i] = dist(codes[i], seedA0) - dist(codes[i], seedB0);
    }
    const order = new Array<number>(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((x, y) => margin[x] - margin[y] || x - y);
    const side = new Uint8Array(n);
    for (let s = n >> 1; s < n; s++) side[order[s]] = 1;
    // Fresh majority pivots for both halves — routing sharpens with the data.
    const seedA = this.majorityCode(codes, side, 0) ?? seedA0;
    const seedB = this.majorityCode(codes, side, 1) ?? seedB0;

    // 4. Rewrite: side-0 stays in cid, side-1 becomes a fresh cluster.
    const oldChunks = this.centChunks[cid];
    const ncid = this.newCluster(seedB);
    this.centCodes.set(seedA, cid * cb);
    this.markSuperStale(cid);
    this.rebuildCluster(cid, oldChunks, codes, exts, ids, side, 0);
    this.rebuildCluster(ncid, 0, codes, exts, ids, side, 1);
    // Dead slots vanished in the rewrite.
    this.totalSlots -= slotsBefore - n;
    this.metaDirty = true;
    this.dirtyCents.add(cid);
    this.dirtyCents.add(ncid);
  }

  /** Bit-majority sample size per split side.  A pivot is a routing aid, not
   *  a stored value: the majority bit of a 512-member deterministic sample
   *  agrees with the full-population majority except on near-tied bits,
   *  where either choice routes equally well — and counting every member of
   *  a 4096-entry cluster was 25% of bulk-load CPU (profiled). */
  private static readonly MAJORITY_SAMPLE = 512;

  /** Majority-bit code of the side's members (the binary centroid), or null
   *  when the side is empty.  Members are sampled on a deterministic stride
   *  when the side exceeds {@link MAJORITY_SAMPLE}. */
  private majorityCode(
    codes: Uint8Array[],
    side: Uint8Array,
    which: number,
  ): Uint8Array | null {
    const cb = this.codeBytes;
    let total = 0;
    for (let i = 0; i < codes.length; i++) if (side[i] === which) total++;
    if (total === 0) return null;
    const stride = Math.max(1, Math.ceil(total / IvfIndex.MAJORITY_SAMPLE));
    const counts = new Int32Array(cb * 8);
    let m = 0;
    let seen = 0;
    for (let i = 0; i < codes.length; i++) {
      if (side[i] !== which) continue;
      if (seen++ % stride !== 0) continue;
      m++;
      const c = codes[i];
      for (let p = 0; p < cb; p++) {
        const byte = c[p];
        if (byte === 0) continue;
        const base = p * 8;
        for (let k = 0; k < 8; k++) if (byte & (1 << k)) counts[base + k]++;
      }
    }
    const out = new Uint8Array(cb);
    const half = m / 2;
    for (let p = 0; p < cb; p++) {
      let byte = 0;
      const base = p * 8;
      for (let k = 0; k < 8; k++) if (counts[base + k] > half) byte |= 1 << k;
      out[p] = byte;
    }
    return out;
  }

  /** Rewrite a cluster's chunks from a member list (one side of a split or a
   *  compaction survivor set), updating vmap rows.  `dropFrom` deletes any
   *  leftover chunk rows beyond the new count. */
  private rebuildCluster(
    cid: number,
    dropFrom: number,
    codes: Uint8Array[],
    exts: number[],
    ids: number[],
    side: Uint8Array | null,
    which: number,
  ): void {
    const cb = this.codeBytes;
    let seq = 0;
    let c = new Chunk(new Uint8Array(this.chunkBytes));
    let slot = 0;
    let entries = 0;
    const vrows: number[] = []; // flat (ext, id, cid, seq, slot) tuples
    for (let i = 0; i < codes.length; i++) {
      if (side !== null && side[i] !== which) continue;
      if (slot === CHUNK_CAP) {
        this.sUpsChunk.run(cid * SEQ_SPAN + seq, c.buf);
        this.chunkCache.delete(cid * SEQ_SPAN + seq);
        this.dirtyChunks.delete(cid * SEQ_SPAN + seq);
        seq++;
        c = new Chunk(new Uint8Array(this.chunkBytes));
        slot = 0;
      }
      c.ids[slot] = ids[i];
      c.exts[slot] = exts[i];
      c.buf.set(codes[i], c.codeAt(slot, cb));
      c.n = slot + 1;
      // (ext, id, cid, seq, slot) — flushed below as multi-row replaces; one
      // statement dispatch per member made vmap rewriting the dominant split
      // cost (an entry is rewritten at every split it lives through).
      vrows.push(exts[i], ids[i], cid, seq, slot);
      slot++;
      entries++;
    }
    this.flushVmapRows(vrows);
    const usedChunks = entries === 0 ? 0 : seq + 1;
    if (entries > 0) {
      this.sUpsChunk.run(cid * SEQ_SPAN + seq, c.buf);
      this.chunkCache.delete(cid * SEQ_SPAN + seq);
      this.dirtyChunks.delete(cid * SEQ_SPAN + seq);
    }
    for (let s = usedChunks; s < dropFrom; s++) {
      this.sDelChunk.run(cid * SEQ_SPAN + s);
      this.chunkCache.delete(cid * SEQ_SPAN + s);
      this.dirtyChunks.delete(cid * SEQ_SPAN + s);
    }
    this.centChunks[cid] = usedChunks;
    this.centEntries[cid] = entries;
    this.dirtyCents.add(cid);
  }

  /** Multi-row vmap statements, prepared per row count (powers of a fixed
   *  batch width) — REPLACE semantics on the ext primary key. */
  private readonly vmapBatchStmts = new Map<number, StatementSync>();
  // 5 params/row → 320 params per dispatch.  Wider batches lose more to the
  // per-argument spread/bind overhead than they save in dispatches (measured
  // at 256 rows: the spread itself became 15% of a bulk load).
  private static readonly VMAP_BATCH = 64;

  private vmapBatchStmt(rows: number): StatementSync {
    let s = this.vmapBatchStmts.get(rows);
    if (s === undefined) {
      s = this.db.prepare(
        "INSERT OR REPLACE INTO vmap (ext, id, cid, seq, slot) VALUES " +
          "(?,?,?,?,?),".repeat(rows - 1) + "(?,?,?,?,?)",
      );
      this.vmapBatchStmts.set(rows, s);
    }
    return s;
  }

  /** Write flat (ext, id, cid, seq, slot) tuples in wide batches. */
  private flushVmapRows(vrows: number[]): void {
    const W = IvfIndex.VMAP_BATCH * 5;
    let o = 0;
    for (; o + W <= vrows.length; o += W) {
      this.vmapBatchStmt(IvfIndex.VMAP_BATCH).run(...vrows.slice(o, o + W));
    }
    const rest = (vrows.length - o) / 5;
    if (rest > 0) this.vmapBatchStmt(rest).run(...vrows.slice(o));
  }

  // ── query ───────────────────────────────────────────────────────────────

  /** ef → clusters probed.  ef is the familiar "candidate breadth" knob; a
   *  probe scans one whole cluster, so nprobe = ef/4 keeps the default
   *  (ef 64 → 16 probes) both accurate on trained stores and bounded. */
  private nprobeOf(ef: number): number {
    return Math.max(1, Math.ceil(ef / 4));
  }

  /** k-NN with a full-precision query (accurate RaBitQ estimator). */
  searchKnn(vec: ArrayLike<number>, k: number, ef?: number): IvfHit[] {
    this.lastQueryDistComps = 0;
    this.resetReads();
    if (this.live === 0 || k <= 0) {
      this.lastQueryStorageReads = 0;
      return [];
    }
    const q = this.quantizer.prepareQuery(vec);
    const hits = this.scanClusters(
      this.probeOrder(q, this.nprobeOf(ef ?? this._efSearch)),
      k,
      (buf, off) => {
        this.lastQueryDistComps++;
        return this.quantizer.estimate(buf, off, q);
      },
    );
    this.lastQueryStorageReads = this.reads;
    return hits;
  }

  /** k-NN with an already-quantized code (sign-bit Hamming distance). */
  searchKnnByCode(code: Uint8Array, k: number, ef?: number): IvfHit[] {
    this.lastQueryDistComps = 0;
    this.resetReads();
    if (this.live === 0 || k <= 0) {
      this.lastQueryStorageReads = 0;
      return [];
    }
    const cb = this.codeBytes;
    const hits = this.scanClusters(
      this.probeOrderByCode(code, this.nprobeOf(ef ?? this._efSearch)),
      k,
      (buf, off) => {
        this.lastQueryDistComps++;
        return this.quantizer.codeDistanceBytes(
          code,
          buf.subarray(off, off + cb),
        );
      },
    );
    this.lastQueryStorageReads = this.reads;
    return hits;
  }

  private scanClusters(
    cids: number[],
    k: number,
    distAt: (buf: Uint8Array, off: number) => number,
  ): IvfHit[] {
    const cb = this.codeBytes;
    const top = new TopK(k);
    const retain = this.cacheEnabled; // reads stay honest with the budget off
    for (const cid of cids) {
      const chunks = this.centChunks[cid];
      for (let seq = 0; seq < chunks; seq++) {
        const c = this.chunkAt(cid, seq, retain);
        const n = c.n;
        // Tombstones are rare (updates/deletes only); when the bitmap is
        // clear the whole chunk scans without a per-slot dead test.
        const anyDead = c.dead[0] | c.dead[1] | c.dead[2] | c.dead[3] |
          c.dead[4] | c.dead[5] | c.dead[6] | c.dead[7];
        let off = CODES_OFF;
        if (anyDead === 0) {
          for (let s = 0; s < n; s++, off += cb) {
            const d = distAt(c.buf, off);
            if (d < top.worst) top.push(d, c.exts[s]);
          }
        } else {
          for (let s = 0; s < n; s++, off += cb) {
            if (c.isDead(s)) continue;
            const d = distAt(c.buf, off);
            if (d < top.worst) top.push(d, c.exts[s]);
          }
        }
      }
    }
    return top.drain();
  }

  // ── maintenance ─────────────────────────────────────────────────────────

  /** Stream live entries whose internal id is > `after`, in id order.
   *  Internal ids are monotone at insert and PRESERVED by update/compact, so
   *  the largest id a caller has seen is a durable incremental watermark. */
  *keysSince(
    after: number,
    batch = 1024,
  ): IterableIterator<{ ext: number; internal: number }> {
    const q = this.db.prepare(
      "SELECT ext, id FROM vmap WHERE id > ? ORDER BY id LIMIT ?",
    );
    let cursor = after;
    for (;;) {
      const rows = q.all(cursor, batch) as Array<{ ext: number; id: number }>;
      if (rows.length === 0) break;
      for (const r of rows) yield { ext: r.ext, internal: r.id };
      cursor = rows[rows.length - 1].id;
    }
  }

  /** Stream every live external id. */
  *keys(): IterableIterator<number> {
    for (const { ext } of this.keysSince(0)) yield ext;
  }

  /** Drop tombstoned slots by rewriting each cluster that carries any, then
   *  VACUUM.  Internal ids and cluster assignment are preserved — routing
   *  quality is untouched, only dead space is reclaimed. */
  compact(): void {
    this.db.exec("BEGIN");
    try {
      const cb = this.codeBytes;
      for (let cid = 0; cid < this.K; cid++) {
        const chunks = this.centChunks[cid];
        if (chunks === 0) continue;
        let hasDead = false;
        const exts: number[] = [];
        const ids: number[] = [];
        const codes: Uint8Array[] = [];
        for (let seq = 0; seq < chunks; seq++) {
          const c = this.chunkAt(cid, seq);
          for (let s = 0; s < c.n; s++) {
            if (c.isDead(s)) {
              hasDead = true;
              continue;
            }
            exts.push(c.exts[s]);
            ids.push(c.ids[s]);
            const off = c.codeAt(s, cb);
            codes.push(c.buf.slice(off, off + cb));
          }
        }
        if (!hasDead) continue;
        this.rebuildCluster(cid, chunks, codes, exts, ids, null, 0);
      }
      this.totalSlots = this.live;
      this.metaDirty = true;
      this.flushAll();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.chunkCache.clear();
    this.db.exec("VACUUM");
  }

  /** Heat SQLite's page cache with sequential scans of the chunk and vmap
   *  tables — a cold session otherwise warms it through random point reads.
   *  Purely a latency optimisation; returns rows touched. */
  warmCache(): number {
    let n = 0;
    // Selecting the blob itself (not just the key) pulls the overflow pages
    // through the page cache — a key-only scan touches only the B-tree.
    for (
      const _ of this.db.prepare("SELECT blob FROM chunk").iterate()
    ) n++;
    for (
      const _ of this.db.prepare("SELECT ext, id FROM vmap").iterate()
    ) n++;
    return n;
  }

  begin(): void {
    this.db.exec("BEGIN");
  }
  commit(): void {
    this.flushAll();
    this.db.exec("COMMIT");
  }
  rollback(): void {
    // Buffered state may be ahead of the rolled-back rows — reload from disk.
    this.chunkCache.clear();
    this.dirtyChunks.clear();
    this.dirtyCents.clear();
    this.metaDirty = false;
    this.db.exec("ROLLBACK");
    const row = this.db.prepare(
      "SELECT live, total, next_id FROM meta WHERE id = 0",
    ).get() as { live: number; total: number; next_id: number };
    this.live = row.live;
    this.totalSlots = row.total;
    this.nextId = row.next_id;
    this.loadCents();
  }

  /** Encode a raw vector to its 1-bit code bytes. */
  encodeToBytes(vec: ArrayLike<number>): Uint8Array {
    return this.quantizer.codeToBytes(this.quantizer.encode(vec));
  }
  codeToBytes(code: ArrayLike<number>): Uint8Array {
    return this.quantizer.codeToBytes(code);
  }
  bytesToCode(bytes: Uint8Array): Uint32Array {
    return this.quantizer.bytesToCode(bytes);
  }
  get codeWords(): number {
    return this.quantizer.codeWords;
  }

  close(): void {
    this.db.close();
  }
}
