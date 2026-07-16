import { DatabaseSync } from "node:sqlite";
const NODES = (name) => `
CREATE TABLE ${name} (
  id      INTEGER PRIMARY KEY,
  ext     INTEGER,
  level   INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  code    BLOB NOT NULL
)`;
const LINKS = (name) => `
CREATE TABLE ${name} (
  node  INTEGER NOT NULL,
  layer INTEGER NOT NULL,
  nbrs  BLOB NOT NULL,
  PRIMARY KEY (node, layer)
) WITHOUT ROWID`;
const EXT_INDEX =
  "CREATE UNIQUE INDEX idx_nodes_ext ON nodes(ext) WHERE ext IS NOT NULL";
/** Direct-mapped, typed-array-backed node cache: `slot = id % capacity`, a
 *  colliding insert overwrites.  No per-entry heap objects, no recency
 *  bookkeeping — see the cache commentary in {@link Store}. */
class CodeSlab {
  codeBytes;
  keys; // node id per slot; -1 = empty
  ext; // NaN = null ext
  deleted;
  codes; // capacity × codeBytes, flat
  capacity;
  constructor(capacity, codeBytes) {
    this.codeBytes = codeBytes;
    this.capacity = capacity;
    this.keys = new Float64Array(capacity).fill(-1);
    this.ext = new Float64Array(capacity);
    this.deleted = new Uint8Array(capacity);
    this.codes = new Uint8Array(capacity * codeBytes);
  }
  /** The cached record, or undefined.  The returned NodeRec is a fresh small
   *  object whose code is a read-only VIEW into the slab (callers never
   *  mutate codes; an overwrite of this slot only happens on a later insert,
   *  after the view's one-operation lifetime). */
  get(id) {
    const slot = id % this.capacity;
    if (this.keys[slot] !== id) {
      return undefined;
    }
    const e = this.ext[slot];
    return {
      code: this.codes.subarray(
        slot * this.codeBytes,
        (slot + 1) * this.codeBytes,
      ),
      deleted: this.deleted[slot],
      ext: Number.isNaN(e) ? null : e,
    };
  }
  has(id) {
    return this.keys[id % this.capacity] === id;
  }
  set(id, code, deleted, ext) {
    if (code.length !== this.codeBytes) {
      return; // foreign geometry — skip
    }
    const slot = id % this.capacity;
    this.keys[slot] = id;
    this.ext[slot] = ext === null ? NaN : ext;
    this.deleted[slot] = deleted;
    this.codes.set(code, slot * this.codeBytes);
  }
  /** Mark a cached id tombstoned in place (mirrors the row update). */
  markDeleted(id) {
    const slot = id % this.capacity;
    if (this.keys[slot] === id) {
      this.deleted[slot] = 1;
      this.ext[slot] = NaN;
    }
  }
  clear() {
    this.keys.fill(-1);
  }
}
/** Direct-mapped cache of decoded neighbour lists, same design as
 *  {@link CodeSlab}: `slot = (node·64+layer) % capacity`, fixed-width rows,
 *  a colliding insert overwrites, nothing heap-allocated per entry. */
class NbrSlab {
  width;
  keys; // node·64+layer per slot; -1 = empty
  counts; // 0xff = cached "no list" (null)
  data; // capacity × width, flat
  capacity;
  constructor(capacity, width) {
    this.width = width;
    this.capacity = capacity;
    this.keys = new Float64Array(capacity).fill(-1);
    this.counts = new Uint8Array(capacity);
    this.data = new Uint32Array(capacity * width);
  }
  /** The cached list (a fresh copy — safe across later overwrites), null for
   *  a cached "no list here", undefined on a miss. */
  get(key) {
    const slot = key % this.capacity;
    if (this.keys[slot] !== key) {
      return undefined;
    }
    const n = this.counts[slot];
    if (n === 0xff) {
      return null;
    }
    const base = slot * this.width;
    return this.data.slice(base, base + n);
  }
  set(key, ids) {
    if (ids !== null && ids.length > this.width) {
      return; // oversize — skip
    }
    const slot = key % this.capacity;
    this.keys[slot] = key;
    if (ids === null) {
      this.counts[slot] = 0xff;
      return;
    }
    this.counts[slot] = ids.length;
    const base = slot * this.width;
    for (let i = 0; i < ids.length; i++) {
      this.data[base + i] = ids[i];
    }
  }
  delete(key) {
    const slot = key % this.capacity;
    if (this.keys[slot] === key) {
      this.keys[slot] = -1;
    }
  }
  clear() {
    this.keys.fill(-1);
  }
}
export class Store {
  db;
  /**
   * Number of row reads served from the database (node and neighbour-list
   * fetches). This counts *storage* accesses only, so it is unaffected by any
   * caching layer above it -- the honest measure of how the engine scales.
   */
  reads = 0;
  sInsNode;
  sNode;
  sIdByExt;
  sTombstone;
  sNbrs;
  sSetNbrs;
  sState;
  // A node's 1-bit code is IMMUTABLE once written, yet building and searching the
  // graph re-read the same hub nodes constantly: an insert touches ~ef distinct
  // nodes, and across consecutive inserts (especially clustered data) those sets
  // overlap heavily, so the same code is fetched again and again. Each fetch is a
  // SQLite point-query that decodes the row and copies the BLOB, while the
  // distance it feeds is ~0.04µs. So getNode, not arithmetic, dominates a build.
  //
  // A DIRECT-MAPPED SLAB CACHE removes it.  Earlier revisions used a Map-based
  // LRU of NodeRec objects; measured at trained-store scale (2.4M+ cached
  // entries) the Map itself became the bottleneck — per-op hash cost, the
  // delete+set recency churn, eviction bookkeeping, and millions of long-lived
  // heap objects for the GC to trace.  Filling the cache made ingest SLOWER
  // than leaving it cold.  The slab holds everything in a handful of typed
  // arrays (keys, ext, deleted flags, and one flat code slab), slot = id mod
  // capacity: a lookup is one modulo and one key compare; an insert on a
  // colliding slot simply overwrites it (dense monotone ids make modulo a
  // uniform spread, so collisions stay rare while occupancy < capacity); there
  // is NO recency bookkeeping and NOTHING for the GC to trace.  Two slabs:
  // the MAIN one, and an UPPER-LAYER one for level ≥ 1 nodes — the ~12% of
  // the collection every operation's descent touches — so layer-0 fan-out
  // traffic can never evict the descent's working set however far the
  // collection outgrows the budget.
  //
  // The honesty rules are unchanged from the LRU it replaces:
  //   • A LATENCY layer only — `reads` (the scalability witness) counts
  //     SQLite fall-throughs, so it is UNAFFECTED by the cache; the rabitq
  //     suite asserts scaling with the cache off.
  //   • BOUNDED BY THE SAME MEMORY BUDGET as the page cache: slot count is
  //     derived from `cacheSizeMb` and the code size (no second knob), the
  //     upper-layer slab takes at most half.  cacheSizeMb=0 disables both.
  //   • The only mutable fields (deleted/ext) are updated in place by
  //     tombstone(); both slabs are dropped at compaction.  A collision or a
  //     miss only repeats work, never changes a result.
  cacheBudgetBytes;
  /** Whether the shared memory budget is non-zero — consumers that trade RAM
   *  for speed (the graph's visited-tag array) key off this so the
   *  `cacheSizeMb: 0` flat-memory mode stays exactly flat. */
  get cacheEnabled() {
    return this.cacheBudgetBytes > 0;
  }
  slab = null; // main section (level 0)
  slabHot = null; // upper-layer section (level ≥ 1)
  nbrSlab = null; // neighbour-list cache
  slabsDerived = false; // false until the first cacheRec sizes them
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
  constructor(dbPath, cacheSizeMb = 64) {
    this.cacheBudgetBytes = Math.max(0, Math.floor(cacheSizeMb * 1024 * 1024));
    this.db = new DatabaseSync(dbPath);
    // WAL + NORMAL sync is crash-safe and fast; temp structures stay in memory.
    // The page cache is the single memory budget; mmap is tied to it so "off"
    // means every row read is an honest B-tree descent against the file.
    const kb = Math.max(0, Math.floor(cacheSizeMb * 1024));
    const cacheSize = kb > 0 ? `-${kb}` : "0";
    const mmap = kb > 0 ? cacheSizeMb * 1024 * 1024 : 0;
    // Rows here are one code (~dim/8 bytes) or one packed neighbour list —
    // small against SQLite's default 4 KiB page, which then carries mostly
    // slack. 1 KiB pages keep leaf-page fill high; must be set before the
    // first table is created (no-op on an existing database).
    this.db.exec("PRAGMA page_size = 1024;");
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = ${cacheSize};
      PRAGMA mmap_size = ${mmap};
      PRAGMA foreign_keys = OFF;
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        id              INTEGER PRIMARY KEY CHECK (id = 0),
        dim             INTEGER NOT NULL,
        m               INTEGER NOT NULL,
        ef_construction INTEGER NOT NULL,
        ef_search       INTEGER NOT NULL,
        query_bits      INTEGER NOT NULL,
        rotation_rounds INTEGER NOT NULL,
        seed            INTEGER NOT NULL,
        centroid        BLOB,
        code_words      INTEGER NOT NULL,
        padded_dim      INTEGER NOT NULL,
        entry_point     INTEGER NOT NULL DEFAULT -1,
        max_level       INTEGER NOT NULL DEFAULT -1,
        live            INTEGER NOT NULL DEFAULT 0,
        total           INTEGER NOT NULL DEFAULT 0,
        rng             INTEGER NOT NULL DEFAULT 0
      );
    `);
    if (!this.tableExists("nodes")) {
      this.db.exec(NODES("nodes"));
      this.db.exec(EXT_INDEX);
      this.db.exec(LINKS("links"));
    }
    this.prepareAll();
  }
  tableExists(name) {
    const row = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
    return row !== undefined;
  }
  /** (Re)compile the hot statements against the current schema. */
  prepareAll() {
    this.batchStmts.clear();
    // Recompiled statements mean a table swap (compaction) — every cached
    // decoded list may now describe a dropped table's rows.
    this.nbrSlab?.clear();
    this.sInsNode = this.db.prepare(
      "INSERT INTO nodes(ext, level, code) VALUES (?, ?, ?)",
    );
    this.sNode = this.db.prepare(
      "SELECT ext, level, deleted, code FROM nodes WHERE id = ?",
    );
    // Positional rows: the hot read path pays for a plain array instead of a
    // per-row object with named properties.
    this.sNode.setReturnArrays(true);
    this.sIdByExt = this.db.prepare("SELECT id FROM nodes WHERE ext = ?");
    this.sTombstone = this.db.prepare(
      "UPDATE nodes SET deleted = 1, ext = NULL WHERE id = ?",
    );
    this.sNbrs = this.db.prepare(
      "SELECT nbrs FROM links WHERE node = ? AND layer = ?",
    );
    this.sNbrs.setReturnArrays(true);
    this.sSetNbrs = this.db.prepare(
      "INSERT INTO links(node, layer, nbrs) VALUES (?, ?, ?) " +
        "ON CONFLICT(node, layer) DO UPDATE SET nbrs = excluded.nbrs",
    );
    this.sState = this.db.prepare(
      "UPDATE meta SET entry_point = ?, max_level = ?, live = ?, total = ?, rng = ? WHERE id = 0",
    );
  }
  // ----------------------------- config / state ----------------------------
  /** Load the persisted configuration, or null for a fresh database. */
  loadConfig() {
    const row = this.db.prepare("SELECT * FROM meta WHERE id = 0").get();
    if (!row) {
      return null;
    }
    const cb = row.centroid;
    let centroid = null;
    if (cb) {
      centroid = new Float64Array(row.dim);
      new Uint8Array(centroid.buffer).set(cb);
    }
    return {
      dim: row.dim,
      m: row.m,
      efConstruction: row.ef_construction,
      efSearch: row.ef_search,
      queryBits: row.query_bits,
      rotationRounds: row.rotation_rounds,
      seed: row.seed,
      centroid,
      codeWords: row.code_words,
      paddedDim: row.padded_dim,
    };
  }
  /** Initialise the meta row for a new database. */
  initConfig(c) {
    const centroidBlob = c.centroid
      ? new Uint8Array(
        c.centroid.buffer,
        c.centroid.byteOffset,
        c.centroid.byteLength,
      )
      : null;
    this.db
      .prepare(
        "INSERT INTO meta(id, dim, m, ef_construction, ef_search, query_bits, rotation_rounds, " +
          "seed, centroid, code_words, padded_dim, rng) VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        c.dim,
        c.m,
        c.efConstruction,
        c.efSearch,
        c.queryBits,
        c.rotationRounds,
        c.seed,
        centroidBlob,
        c.codeWords,
        c.paddedDim,
        c.seed >>> 0,
      );
  }
  loadState() {
    const row = this.db
      .prepare(
        "SELECT entry_point, max_level, live, total, rng FROM meta WHERE id = 0",
      )
      .get();
    return {
      entryPoint: row.entry_point,
      maxLevel: row.max_level,
      live: row.live,
      total: row.total,
      rng: row.rng >>> 0,
    };
  }
  saveState(s) {
    this.sState.run(s.entryPoint, s.maxLevel, s.live, s.total, s.rng | 0);
  }
  setEfSearch(ef) {
    this.db.prepare("UPDATE meta SET ef_search = ? WHERE id = 0").run(ef);
  }
  setQueryBits(bits) {
    this.db.prepare("UPDATE meta SET query_bits = ? WHERE id = 0").run(bits);
  }
  resetReads() {
    this.reads = 0;
  }
  /** Stream every live external id in id order, in bounded-memory batches. */
  *liveExts(batch = 1024) {
    const q = this.db.prepare(
      "SELECT id, ext FROM nodes WHERE deleted = 0 AND id > ? ORDER BY id LIMIT ?",
    );
    let cursor = 0;
    for (;;) {
      const rows = q.all(cursor, batch);
      if (rows.length === 0) {
        break;
      }
      for (const r of rows) {
        yield r.ext;
      }
      cursor = rows[rows.length - 1].id;
    }
  }
  // -------------------------------- nodes -----------------------------------
  /** Size the two slabs from the shared memory budget and the actual code
   *  size (known on the first record cached): total slots = budget / bytes
   *  per slot, the upper-layer slab taking half.  A slot is the code bytes
   *  plus 17 B of typed-array bookkeeping (key + ext + deleted). */
  deriveSlabs(codeBytes) {
    this.slabsDerived = true;
    if (this.cacheBudgetBytes === 0) {
      return; // flat-memory mode — no slabs
    }
    const perSlot = codeBytes + 17;
    const total = Math.max(2, Math.floor(this.cacheBudgetBytes / perSlot));
    this.slabHot = new CodeSlab(total >> 1, codeBytes);
    this.slab = new CodeSlab(total - (total >> 1), codeBytes);
    // One-quarter of the budget for neighbour lists (neighbour ids).
    // A layer-0 list is ~4·Mmax0 entries; we budget 4·16 ids per row.
    this.nbrSlab = new NbrSlab(Math.max(1, total >> 2), 64);
  }
  /** Record a node in the slab cache.  Upper-layer nodes (level ≥ 1) go to
   *  the pinned section layer-0 traffic never touches; a colliding slot is
   *  simply overwritten (direct-mapped eviction — no bookkeeping). */
  cacheRec(id, code, deleted, ext, level) {
    if (!this.slabsDerived) {
      this.deriveSlabs(code.byteLength);
    }
    const slab = level >= 1 ? this.slabHot : this.slab;
    slab?.set(id, code, deleted, ext);
  }
  /** Insert a node, returning its assigned id (rowid). */
  addNode(ext, level, code) {
    const info = this.sInsNode.run(ext, level, code);
    const id = Number(info.lastInsertRowid);
    // The new node is read back immediately and repeatedly while it is wired in;
    // seed its (immutable) code now so those reads hit the cache, not SQLite.
    this.cacheRec(id, code, 0, ext, level);
    return id;
  }
  /** Fetch a node's code (copied), tombstone flag and external id, or null.
   *  Served from the slab cache when present; a miss reads SQLite, counts
   *  one `reads` (the cache-independent scalability witness), and caches the
   *  result. The cache is a latency layer ONLY — `reads` does not count hits, so
   *  the index's storage-read scaling is identical with the cache off. */
  getNode(id) {
    // Pinned upper-layer section first, then the main slab.
    const cached = this.slabHot?.get(id) ?? this.slab?.get(id);
    if (cached !== undefined) {
      return cached;
    }
    this.reads++;
    // Positional row: [ext, level, deleted, code].  node:sqlite hands back an
    // OWNED Uint8Array per BLOB read (verified: mutating one read never shows
    // in another), so the code is kept as returned — no defensive copy.
    const row = this.sNode.get(id);
    if (!row) {
      return null;
    }
    this.cacheRec(id, row[3], row[2], row[0], row[1]);
    return { code: row[3], deleted: row[2], ext: row[0] };
  }
  idByExt(ext) {
    const row = this.sIdByExt.get(ext);
    return row ? row.id : null;
  }
  // Batched code fetch.  An insert's search layer expands a popped node's
  // whole neighbour list at once, and each cache-missing neighbour used to be
  // its own point query — the statement dispatch (not the B-tree descent)
  // dominated a trained-store build at ~50% of total CPU.  One IN(...) query
  // per expansion fetches all misses together; the per-row `reads` accounting
  // is unchanged, so the cache-independent scalability witness is identical.
  batchStmts = new Map();
  static BATCH_MAX = 64;
  batchStmt(n) {
    let s = this.batchStmts.get(n);
    if (s === undefined) {
      s = this.db.prepare(
        "SELECT id, ext, level, deleted, code FROM nodes WHERE id IN (" +
          "?,".repeat(n - 1) + "?)",
      );
      s.setReturnArrays(true);
      this.batchStmts.set(n, s);
    }
    return s;
  }
  /** Fetch several nodes into `out` (skipping ids already present).  Serves
   *  from the code LRU first; the misses are read with one IN query per
   *  chunk.  Ids with no row are simply absent from `out`.  Each id that
   *  reaches SQLite counts one `reads`, exactly like a getNode miss. */
  getNodesInto(ids, out, count = ids.length) {
    let miss = null;
    for (let i = 0; i < count; i++) {
      const id = ids[i];
      if (out.has(id)) {
        continue;
      }
      const cached = this.slabHot?.get(id) ?? this.slab?.get(id);
      if (cached !== undefined) {
        out.set(id, cached);
        continue;
      }
      (miss ??= []).push(id);
    }
    if (miss === null) {
      return;
    }
    for (let o = 0; o < miss.length; o += Store.BATCH_MAX) {
      const chunk = miss.slice(o, o + Store.BATCH_MAX);
      this.reads += chunk.length;
      // Positional rows: [id, ext, level, deleted, code]; the code BLOB is an
      // owned buffer (see getNode), kept without a defensive copy.
      const rows = this.batchStmt(chunk.length).all(...chunk);
      for (const row of rows) {
        this.cacheRec(row[0], row[4], row[3], row[1], row[2]);
        out.set(row[0], { code: row[4], deleted: row[3], ext: row[1] });
      }
    }
  }
  /** Pre-fill the code and neighbour-list caches with ONE sequential table
   *  scan each, up to their existing budget-derived caps.  A cold session
   *  otherwise warms the caches through hundreds of thousands of RANDOM point
   *  reads spread across its first minutes of inserts/queries; a sequential
   *  scan streams the same rows at C speed in seconds.  A pure latency
   *  optimisation with the exact same caps and coherence rules as demand
   *  filling — nothing about results, `reads` discipline, or memory ceilings
   *  changes.  Two passes over `nodes` so the upper-layer pinned section is
   *  filled before layer-0 rows compete for the LRU.  Returns rows warmed. */
  warmCache() {
    if (this.cacheBudgetBytes === 0) {
      return 0;
    }
    let warmed = 0;
    // One scan over the node rows; cacheRec routes each to its slab (the
    // sections are direct-mapped, so there is no fill-order competition).
    {
      const scan = this.db.prepare(
        "SELECT id, ext, level, deleted, code FROM nodes",
      );
      scan.setReturnArrays(true);
      for (const row of scan.iterate()) {
        this.cacheRec(row[0], row[4], row[3], row[1], row[2]);
        warmed++;
      }
    }
    // Neighbour lists: one pass; nbrSlab is direct-mapped so fill order
    // doesn't matter (later entries simply overwrite earlier collisions).
    {
      const scan = this.db.prepare("SELECT node, layer, nbrs FROM links");
      scan.setReturnArrays(true);
      for (const row of scan.iterate()) {
        if (row[1] >= 64) {
          continue;
        }
        this.nbrSlab?.set(
          row[0] * 64 + row[1],
          Uint32Array.from(this.decodeNbrs(row[2])),
        );
        warmed++;
      }
    }
    return warmed;
  }
  tombstone(id) {
    this.sTombstone.run(id);
    // Keep any cached record coherent with the row: a later hit must show the
    // same deleted/ext a fresh SQLite read would (search routes through but never
    // returns tombstoned nodes).
    this.slab?.markDeleted(id);
    this.slabHot?.markDeleted(id);
  }
  // -------------------------------- links -----------------------------------
  // Neighbour lists are SETS to the graph algorithms: search visits every
  // member and pruning recomputes distances from the codes, so storage order
  // carries no information. That freedom pays for compression: the list is
  // stored sorted as delta-VARINTS — consecutive graph ids are small deltas, so
  // a neighbour costs ~1–2 bytes instead of a fixed 4, and the cost scales with
  // log(collection) instead of a fixed word width. Links are written once per
  // wiring update and read on every hop, and decoding is a linear byte scan —
  // noise against the row fetch it rides on.
  // DECODED NEIGHBOUR-LIST CACHE.  A direct-mapped NbrSlab (same design as
  // the code slab).  Budget: one quarter of the shared cacheSizeMb, sized in
  // deriveSlabs alongside the code slabs.  Each list is a fresh copy from the
  // slab, so callers are safe across later overwrites.  `setNeighbors` writes
  // through, so a hit always equals a fresh row read.
  /** A node's neighbour ids at a layer, or null if it has no list there. */
  getNeighbors(node, layer) {
    if (layer < 64) {
      const hit = this.nbrSlab?.get(node * 64 + layer);
      if (hit !== undefined) {
        return hit;
      }
    }
    this.reads++;
    const row = this.sNbrs.get(node, layer);
    if (!row) {
      this.nbrSlab?.set(node * 64 + layer, null);
      return null;
    }
    const blob = row[0];
    // Entry count = terminator bytes (high bit clear): one cheap scan sizes
    // the result exactly, so the hot path pays ONE allocation instead of a
    // growable number[] plus a Uint32Array copy per graph hop.
    let count = 0;
    for (let i = 0; i < blob.length; i++) {
      if ((blob[i] & 0x80) === 0) {
        count++;
      }
    }
    const ids = new Uint32Array(count);
    let acc = 0, shift = 0, prev = 0, n = 0;
    for (let i = 0; i < blob.length; i++) {
      const b = blob[i];
      acc |= (b & 0x7f) << shift;
      if (b & 0x80) {
        shift += 7;
      } else {
        prev += acc;
        ids[n++] = prev;
        acc = 0;
        shift = 0;
      }
    }
    this.nbrSlab?.set(node * 64 + layer, ids);
    return ids;
  }
  setNeighbors(node, layer, ids) {
    const s = ids.slice().sort((a, b) => a - b);
    const buf = new Uint8Array(s.length * 5);
    let o = 0, prev = 0;
    for (let i = 0; i < s.length; i++) {
      let d = s[i] - prev;
      prev = s[i];
      while (d >= 0x80) {
        buf[o++] = (d & 0x7f) | 0x80;
        d >>>= 7;
      }
      buf[o++] = d;
    }
    this.sSetNbrs.run(node, layer, buf.subarray(0, o));
    // Write through the decoded-list cache: a later hit must equal what a
    // fresh row read would decode (same sorted order).
    // Write through the decoded-list cache: a later hit must equal what a
    // fresh row read would decode (same sorted order).
    if (layer < 64) {
      this.nbrSlab?.set(node * 64 + layer, Uint32Array.from(s));
    }
  }
  // ----------------------------- transactions -------------------------------
  begin() {
    this.db.exec("BEGIN");
  }
  commit() {
    this.db.exec("COMMIT");
  }
  rollback() {
    this.db.exec("ROLLBACK");
  }
  // ------------------------------- compaction -------------------------------
  // spliceCompact() reclaims tombstones by a GRAPH-PRESERVING structural copy:
  // live node rows are copied verbatim (SAME internal ids — nothing external
  // ever remaps), and each live neighbour list is rewritten with its dead
  // members replaced by those members' own live neighbours (a 1-hop bridge, the
  // standard tombstone splice).  Codes are untouched — the index stays exactly
  // as lossy as RaBitQ made it, never more — and the graph keeps the wiring the
  // original inserts built, minus the dead routing.  The previous compact
  // replayed every live code through a full HNSW insert: O(live · ef · log N)
  // storage reads — HOURS on a multi-million-node trained store, inside ONE
  // transaction whose WAL grew by the whole rebuild.  The splice is one
  // streaming pass over the node and link rows (batched commits, bounded WAL).
  /** Encode a neighbour id list to the delta-varint blob format. */
  encodeNbrs(ids) {
    const s = ids.slice().sort((a, b) => a - b);
    const buf = new Uint8Array(s.length * 5);
    let o = 0, prev = 0;
    for (let i = 0; i < s.length; i++) {
      let d = s[i] - prev;
      prev = s[i];
      while (d >= 0x80) {
        buf[o++] = (d & 0x7f) | 0x80;
        d >>>= 7;
      }
      buf[o++] = d;
    }
    return buf.subarray(0, o);
  }
  /** Decode a delta-varint neighbour blob into a number[]. */
  decodeNbrs(blob) {
    const ids = [];
    let acc = 0, shift = 0, prev = 0;
    for (let i = 0; i < blob.length; i++) {
      const b = blob[i];
      acc |= (b & 0x7f) << shift;
      if (b & 0x80) {
        shift += 7;
      } else {
        prev += acc;
        ids.push(prev);
        acc = 0;
        shift = 0;
      }
    }
    return ids;
  }
  /** Tombstone-splice compaction.  `M`/`Mmax0` cap a rewritten list on upper
   *  layers / layer 0.  Returns the new global state scalars (internal ids are
   *  preserved, so `entry` survives unless it was itself dead).  The caller
   *  persists state and vacuums. */
  spliceCompact(M, Mmax0, entry) {
    const db = this.db;
    this.slab?.clear();
    this.slabHot?.clear();
    this.nbrSlab?.clear();
    // Fresh target tables (leftovers from an interrupted compact are dropped).
    db.exec(`
      DROP TABLE IF EXISTS nodes_new;
      DROP TABLE IF EXISTS links_new;
      ${NODES("nodes_new")};
      ${LINKS("links_new")};
    `);
    // Dead internal ids, sorted, for O(log n) membership.  A neighbour id
    // always references an existing row, so "not dead" ⇔ live.
    const deadCount =
      db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE deleted = 1").get().n;
    const dead = new Float64Array(deadCount);
    {
      let i = 0;
      for (
        const row of db.prepare(
          "SELECT id FROM nodes WHERE deleted = 1 ORDER BY id",
        ).iterate()
      ) {
        dead[i++] = row.id;
      }
    }
    const isDead = (id) => {
      let lo = 0, hi = deadCount - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = dead[mid];
        if (v === id) {
          return true;
        }
        if (v < id) {
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return false;
    };
    // 1. Copy live node rows verbatim (same ids), in batched transactions so
    //    the WAL stays bounded by the batch, not the table.
    const copy = db.prepare(
      "INSERT INTO nodes_new (id, ext, level, deleted, code) " +
        "SELECT id, ext, level, 0, code FROM nodes " +
        "WHERE deleted = 0 AND id > ? ORDER BY id LIMIT ?",
    );
    const maxCopied = db.prepare("SELECT MAX(id) AS m FROM nodes_new");
    const COPY_BATCH = 50_000;
    let cursor = 0;
    for (;;) {
      db.exec("BEGIN");
      const n = Number(copy.run(cursor, COPY_BATCH).changes);
      db.exec("COMMIT");
      if (n === 0) {
        break;
      }
      cursor = maxCopied.get().m ?? cursor;
      if (n < COPY_BATCH) {
        break;
      }
    }
    // 2. Rewrite live neighbour lists.  A list with no dead member is copied
    //    blob-verbatim (the common case).  A dead member is replaced by its own
    //    live neighbours at the same layer (1-hop splice), appended after the
    //    surviving originals in ascending-id order and truncated at the layer
    //    cap — deterministic, and the originals (chosen by the build heuristic)
    //    always take precedence.
    const scan = db.prepare(
      "SELECT node, layer, nbrs FROM links " +
        "WHERE node > ? OR (node = ? AND layer > ?) " +
        "ORDER BY node, layer LIMIT ?",
    );
    const insNew = db.prepare(
      "INSERT INTO links_new (node, layer, nbrs) VALUES (?, ?, ?)",
    );
    // Small cache of dead nodes' lists — a dead hub is spliced by many of its
    // former neighbours in a row.
    const deadLists = new Map();
    const DEAD_CACHE_MAX = 65_536;
    const deadListOf = (id, layer) => {
      const key = id + ":" + layer;
      const hit = deadLists.get(key);
      if (hit !== undefined) {
        return hit;
      }
      const row = this.sNbrs.get(id, layer);
      const ids = row ? this.decodeNbrs(row[0]) : [];
      if (deadLists.size >= DEAD_CACHE_MAX) {
        deadLists.clear();
      }
      deadLists.set(key, ids);
      return ids;
    };
    const SCAN_BATCH = 20_000;
    let curNode = -1, curLayer = -1;
    for (;;) {
      const rows = scan.all(curNode, curNode, curLayer, SCAN_BATCH);
      if (rows.length === 0) {
        break;
      }
      db.exec("BEGIN");
      for (const row of rows) {
        curNode = row.node;
        curLayer = row.layer;
        if (isDead(row.node)) {
          continue; // dead nodes leave no list behind
        }
        const ids = this.decodeNbrs(row.nbrs);
        let hasDead = false;
        for (let i = 0; i < ids.length; i++) {
          if (isDead(ids[i])) {
            hasDead = true;
            break;
          }
        }
        if (!hasDead) {
          insNew.run(row.node, row.layer, row.nbrs);
          continue;
        }
        const cap = row.layer === 0 ? Mmax0 : M;
        const keep = [];
        const seen = new Set([row.node]);
        const deadHere = [];
        for (const id of ids) {
          if (isDead(id)) {
            deadHere.push(id);
          } else if (!seen.has(id)) {
            seen.add(id);
            keep.push(id);
          }
        }
        if (keep.length < cap) {
          // Bridge candidates: the dead members' own live neighbours, in
          // ascending id order for determinism.
          const bridge = [];
          for (const d of deadHere) {
            for (const n of deadListOf(d, row.layer)) {
              if (!isDead(n) && !seen.has(n)) {
                seen.add(n);
                bridge.push(n);
              }
            }
          }
          bridge.sort((a, b) => a - b);
          for (const b of bridge) {
            if (keep.length >= cap) {
              break;
            }
            keep.push(b);
          }
        }
        if (keep.length > 0) {
          insNew.run(row.node, row.layer, this.encodeNbrs(keep));
        }
      }
      db.exec("COMMIT");
      if (rows.length < SCAN_BATCH) {
        break;
      }
    }
    // 3. Atomic swap: the real tables flip to the compacted copies in one
    //    transaction (the partial-index name frees up when the old table
    //    drops, so it is recreated on the renamed table here).
    db.exec(`
      BEGIN;
      DROP TABLE nodes;
      DROP TABLE links;
      ALTER TABLE nodes_new RENAME TO nodes;
      ALTER TABLE links_new RENAME TO links;
      ${EXT_INDEX};
      COMMIT;
    `);
    this.prepareAll();
    const live = db.prepare("SELECT COUNT(*) AS n FROM nodes").get().n;
    let newEntry = entry;
    let maxLevel = -1;
    if (live === 0) {
      newEntry = -1;
    } else if (entry === -1 || isDead(entry)) {
      // The entry point died: promote the lowest-id node of the top level —
      // deterministic, corpus-determined.
      const top = db.prepare(
        "SELECT id, level FROM nodes ORDER BY level DESC, id ASC LIMIT 1",
      ).get();
      newEntry = top.id;
      maxLevel = top.level;
    } else {
      maxLevel =
        db.prepare("SELECT level FROM nodes WHERE id = ?").get(entry).level;
    }
    return { entry: newEntry, maxLevel, live };
  }
  /** Stream live external ids with internal id > `after`, in internal-id
   *  order, in bounded batches.  Internal ids are assigned monotonically and
   *  PRESERVED by {@link spliceCompact}, so a caller can use the largest
   *  internal id it has seen as a durable incremental watermark. */
  *liveExtsSince(after, batch = 1024) {
    const q = this.db.prepare(
      "SELECT id, ext FROM nodes WHERE deleted = 0 AND id > ? ORDER BY id LIMIT ?",
    );
    let cursor = after;
    for (;;) {
      const rows = q.all(cursor, batch);
      if (rows.length === 0) {
        break;
      }
      for (const r of rows) {
        yield { ext: r.ext, internal: r.id };
      }
      cursor = rows[rows.length - 1].id;
    }
  }
  vacuum() {
    this.db.exec("VACUUM");
  }
  close() {
    this.db.close();
  }
}
