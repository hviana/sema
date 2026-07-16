// store-sqlite.ts — SQLite + rabitq-hnsw persistence adapter.
//
// SQliteStore extends AbstractStore and implements only the bare essentials
// required for database communication: SQL schema, prepared statements, and
// VectorDatabase management. All domain logic — caching, dedup/merge
// decisions, interior-node indexing, geometric halo scheduling, buffer
// management — lives in the AbstractStore base class (store.ts).
//
// Two clearly separated concerns, each with its OWN vector index:
//
//   • STORAGE  — the content-addressed DAG (nodes, edges, metadata) in SQLite,
//     plus a VectorDatabase for node gists (resonant lookup), in its OWN
//     SQLite file (`<path>.content.vec`).
//   • CACHE    — the distributional "company" of each node (its halo), a
//     derived/regenerable concept layer, in a SEPARATE VectorDatabase,
//     in its own SQLite file (`<path>.halo.vec`).
//
// Write discipline:
//
//   • Integer node ids: a dense 0,1,2,… counter. SQLite stores them inline in
//     the rowid B-tree (no secondary index), child lists pack to 4 bytes each,
//     and the vector index keys on them as a 4-byte int32.
//   • One deferred WRITE TRANSACTION: node rows, edges and halo updates are
//     committed in batches on the flush cadence (and on close/snapshot) rather
//     than one implicit transaction per node.
//   • Each of the three SQLite databases (main DAG, content vectors, halo
//     vectors) is an independent file. The vector databases persist to their
//     own files on every write — no separate serialisation step is needed.
import { DatabaseSync } from "node:sqlite";
import { AbstractStore, flatBytesKids, packKids, unpackKids, } from "./store.js";
import { DEFAULT_CONFIG } from "./config.js";
import { VectorDatabase } from "./rabitq-hnsw/src/index.js";
const SCHEMA = `
-- Content-addressed lookup goes through ONE small integer index: h is the
-- FNV-1a hash of the row's content key (leaf bytes, or the packed kid ids of a
-- mixed branch). Indexing the hash instead of the blob itself means the lookup
-- index stores ~9 bytes per node rather than a full copy of every leaf and kid
-- blob (which doubled the table); the point query fetches the h-candidates and
-- verifies the actual blob, so collisions cost a fetch, never a wrong id.
CREATE TABLE IF NOT EXISTS node (
  id   INTEGER PRIMARY KEY,
  leaf BLOB,
  kids BLOB,
  h    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_node_h ON node(h);
-- The reverse structural edge child→parent. A WITHOUT ROWID table clustered on
-- (child, parent) IS the lookup index: parents(child) is one B-tree descent to a
-- contiguous run, with no separate rowid heap and no secondary index to maintain
-- (~2x smaller than a heap table + idx_kid_child). The composite primary key also
-- gives free (child,parent) dedup, so a child repeated within one branch's kids
-- never writes a duplicate row.
CREATE TABLE IF NOT EXISTS kid (
  child  INTEGER NOT NULL,
  parent INTEGER NOT NULL,
  PRIMARY KEY (child, parent)
) WITHOUT ROWID;
-- seq is a plain INTEGER PRIMARY KEY: rowids are assigned max+1 and edges are
-- never deleted, so insertion order is preserved without AUTOINCREMENT's
-- sqlite_sequence bookkeeping table.
CREATE TABLE IF NOT EXISTS edge (
  src INTEGER NOT NULL,
  dst INTEGER NOT NULL,
  seq INTEGER PRIMARY KEY
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edge ON edge(src, dst);
CREATE INDEX IF NOT EXISTS idx_edge_dst ON edge(dst);
CREATE TABLE IF NOT EXISTS halo (
  id   INTEGER PRIMARY KEY,
  vec  BLOB NOT NULL,
  mass REAL NOT NULL DEFAULT 0
);
-- CONTAINMENT: parent's byte content contains child's, for children that are
-- not among any parent's kids list (sub-span flat branches inside leaf-parent
-- chunks). Kept SEPARATE from kid so parents() — the structural climb — is
-- untouched; containers() serves the climbing surface of orphan flat branches
-- durably (a session-local map would be lost on restart or ingest-cache replay).
-- LOG-STRUCTURED PACKED PAGES: a child's parents are int32-packed blobs split
-- across (child, seq) rows.  A flush APPENDS one page holding only the NEW
-- parents (never reading the list back), then geometrically merges adjacent
-- pages (byte concat; full dedup when a merge reaches the seq-0 base page), so
-- page count stays O(log fan-in) and total merge I/O is amortized linear.
-- This keeps the packed format's ~4 B/parent density (contain is ~11% of a
-- trained store; one B-tree cell per pair measured 2.3× larger) while fixing
-- the single-blob row's flaw: merging new parents into ONE row re-wrote the
-- child's WHOLE list per flush — quadratic in a hot window's corpus-sized
-- fan-in.  Transient duplicates may exist across pages until a base merge;
-- readers dedup (containers()) or tolerate repeats by contract (slices).
-- The (child, seq) key is packed into the INTEGER PRIMARY KEY (rowid) as
-- child·2^8 + seq — exact in a JS double for every valid id, and a child's
-- pages are one contiguous rowid range.  The geometric merge bounds live page
-- counts (and thus seq) to O(log fan-in) ≪ 2^8, and a narrow band keeps the
-- rowid varint within ~1 byte of the bare child id.  A rowid table, NOT a WITHOUT ROWID one: index B-tree cells cap at
-- ~¼ page, so at 1 KiB pages any child beyond ~55 parents would spill each
-- page row onto a mostly-empty overflow page (measured +26% table size).
CREATE TABLE IF NOT EXISTS contain (
  id      INTEGER PRIMARY KEY,
  parents BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  val TEXT NOT NULL
);
`;
export class SQliteStore extends AbstractStore {
    opts;
    vectorCacheMb;
    vectorSeed;
    // ── the two SEPARATE vector indices ───────────────────────────────────
    content = null; // STORAGE: node gists
    halos = null; // CACHE:   halo gists
    sqlite = null;
    // Deferred write transaction guard.
    _inTx = false;
    _insertNode = null;
    _insertKid = null;
    _selContain = null;
    _selParents = null;
    _selHalo = null;
    _upHalo = null;
    _selLeaf = null;
    _selFlat = null;
    _selKids = null;
    _selNode = null;
    _insertEdge = null;
    _selNext = null;
    _selPrev = null;
    _setMeta = null;
    _getMeta = null;
    _delMeta = null;
    _insSnapshot = null;
    _selSnapshot = null;
    constructor(opts = {}) {
        const d = DEFAULT_CONFIG.store;
        // Resolve config from opts, falling back to defaults.
        const config = {
            minHaloMass: opts.minHaloMass ?? d.minHaloMass,
            m: opts.m ?? d.m,
            efConstruction: opts.efConstruction ?? d.efConstruction,
            efConstructionInterior: opts.efConstructionInterior ??
                d.efConstructionInterior,
            efSearch: opts.efSearch ?? d.efSearch,
            compactEveryNWrites: opts.compactEveryNWrites ?? d.compactEveryNWrites,
            overfetch: opts.overfetch ?? d.overfetch,
            batchSize: opts.batchSize ?? d.batchSize,
            dedupCacheMax: opts.dedupCacheMax ?? d.dedupCacheMax,
            bytesCacheMax: opts.bytesCacheMax ?? d.bytesCacheMax,
            recCacheBytes: opts.recCacheBytes ?? d.recCacheBytes,
            ingestCacheBytes: opts.ingestCacheBytes ?? d.ingestCacheBytes,
            pendingGistBytes: opts.pendingGistBytes ?? d.pendingGistBytes,
            haloCacheBytes: opts.haloCacheBytes ?? d.haloCacheBytes,
            vectorCacheMb: opts.vectorCacheMb ?? d.vectorCacheMb,
            coveredIdsMax: opts.coveredIdsMax ?? d.coveredIdsMax,
            chainCacheBytes: opts.chainCacheBytes ?? d.chainCacheBytes,
        };
        const D = opts.D ?? 1024;
        const maxGroup = opts.maxGroup ?? DEFAULT_CONFIG.geometry.maxGroup;
        super(config, D, maxGroup);
        this.opts = opts;
        this.vectorCacheMb = opts.vectorCacheMb ?? d.vectorCacheMb;
        this.vectorSeed = (0x51f15e ^ 0x9e3779b9) >>> 0;
        this._ready = this._dbOpen();
    }
    // ── Vector-DB paths ───────────────────────────────────────────────────
    vectorDbPath(name) {
        const stem = this.opts.path ?? ":memory:";
        if (stem === ":memory:")
            return ":memory:";
        return `${stem}.${name}.vec`;
    }
    openVectorDB(name) {
        return new VectorDatabase({
            dbPath: this.vectorDbPath(name),
            dim: this.D,
            M: this.m,
            efConstruction: this.efConstruction,
            efSearch: this.efSearch,
            // Query-side estimator precision.  8 bits: 4 bits measurably misranks
            // tight gist clusters (mixture recall@10 37.5% vs 39.0%, self-recall
            // 69% vs 76%; rabitq test 2a), and the codes on disk are independent of
            // it, so existing stores adopt the sharper setting on reopen.  The one
            // decision the sharper ranking exposed — a saturated hub winning a
            // sub-noise rank tie and silencing its region — is handled by the
            // tie-band saturation fallback in attention.ts, which is derived from
            // the estimator's own margin noise rather than tuned to a bit width.
            queryBits: this.opts.queryBits ?? 8,
            seed: this.vectorSeed,
            cacheSizeMb: this.vectorCacheMb,
        });
    }
    // ── Abstract method implementations ───────────────────────────────────
    // -- Lifecycle --
    async _dbOpen() {
        const stem = this.opts.path ?? ":memory:";
        const sp = stem === ":memory:" ? ":memory:" : `${stem}.sqlite`;
        this.sqlite = new DatabaseSync(sp);
        // Page size matched to the store's row grain BEFORE any table exists (a
        // no-op on a non-empty database). Every table here holds small rows —
        // packed kid/contain pairs, byte-packed flat branches, quantized halos —
        // so SQLite's default 4 KiB pages carry mostly slack; 1 KiB pages keep
        // leaf-page fill high at a negligible extra tree depth.
        this.sqlite.exec("PRAGMA page_size = 1024;");
        // WAL + NORMAL sync: crash-safe (WAL commits are atomic) without a full
        // fsync per commit — the same discipline the vector databases use.
        this.sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
        this.sqlite.exec(SCHEMA);
        // Recover D from a previous run so loadFromStore() can bootstrap with any
        // default — the real value is read from meta before vector indices load.
        // The meta table always exists here (SCHEMA above creates it), so these
        // reads run bare: a throw is a genuine storage fault, and swallowing it
        // would let the store proceed with a default D/maxGroup that silently
        // disagrees with what training persisted.
        {
            const row = this.sqlite.prepare("SELECT val FROM meta WHERE key = 'train.D'").get();
            if (row) {
                const d = Number(row.val);
                if (Number.isInteger(d) && d > 0)
                    this._D = d;
            }
        }
        // Recover maxGroup from meta so indexSubtree uses the training-time value.
        {
            const row = this.sqlite.prepare("SELECT val FROM meta WHERE key = 'geometry.maxGroup'").get();
            if (row) {
                const g = Number(row.val);
                if (Number.isInteger(g) && g > 0)
                    this._maxGroup = g;
            }
        }
        // Persist maxGroup to meta when opening a FRESH store (no rows yet) so
        // indexSubtree always sees the training-time value even when the store is
        // accessed without a Mind / full snapshot.
        if (this._nextId === 0) {
            this.sqlite.prepare("INSERT OR IGNORE INTO meta (key, val) VALUES ('geometry.maxGroup', ?)").run(String(this._maxGroup));
        }
        this.content = this.openVectorDB("content");
        this.halos = this.openVectorDB("halo");
        // Ids are dense (0,1,2,…) and never deleted, so MAX(id)+1 IS the next id
        // — one rightmost B-tree descent on the rowid, O(log n).  (COUNT(*) gives
        // the same value but scans every leaf page, so open time grew linearly
        // with the store; a per-row scan into a Set was worse still.)
        this._nextId = (this.sqlite.prepare("SELECT MAX(id) AS m FROM node").get().m ?? -1) + 1;
    }
    _dbClose() {
        if (this.content) {
            this.content.close();
            this.content = null;
        }
        if (this.halos) {
            this.halos.close();
            this.halos = null;
        }
        if (this.sqlite) {
            this.sqlite.close();
            this.sqlite = null;
        }
    }
    // -- Transaction --
    _dbBeginTx() {
        if (this._inTx || !this.sqlite)
            return;
        this.sqlite.exec("BEGIN");
        this._inTx = true;
    }
    _dbCommitTx() {
        if (!this._inTx || !this.sqlite)
            return;
        this._inTx = false; // clear first so a throw can't wedge us mid-commit
        this.sqlite.exec("COMMIT");
    }
    // -- Node CRUD --
    _dbInsertNode(id, leaf, kids, h) {
        if (!this._insertNode) {
            this._insertNode = this.sqlite.prepare("INSERT INTO node (id, leaf, kids, h) VALUES (?, ?, ?, ?)");
        }
        this._insertNode.run(id, leaf, kids, h);
    }
    _dbGetNode(id) {
        if (!this._selNode) {
            this._selNode = this.sqlite.prepare("SELECT id, leaf, kids FROM node WHERE id = ?");
        }
        const r = this._selNode.get(id);
        if (!r)
            return null;
        // A zero-length kids blob marks a FLAT branch: the leaf column holds its
        // bytes and the kid list is derived, one implicit leaf per byte.
        const flat = r.kids !== null && r.kids.byteLength === 0;
        return {
            id: r.id,
            leaf: r.leaf && !flat ? new Uint8Array(r.leaf) : null,
            kids: flat
                ? flatBytesKids(r.leaf)
                : (r.kids ? unpackKids(r.kids) : null),
        };
    }
    _dbFindLeaf(h, bytes) {
        if (!this._selLeaf) {
            this._selLeaf = this.sqlite.prepare("SELECT id FROM node WHERE h = ? AND leaf = ? AND kids IS NULL LIMIT 1");
        }
        const row = this._selLeaf.get(h, bytes);
        return row ? row.id : null;
    }
    _dbFindBranchByLeaf(h, bytes) {
        if (!this._selFlat) {
            this._selFlat = this.sqlite.prepare("SELECT id FROM node WHERE h = ? AND leaf = ? AND kids IS NOT NULL LIMIT 1");
        }
        const row = this._selFlat.get(h, bytes);
        return row ? row.id : null;
    }
    _dbFindBranchByKids(h, packed) {
        if (!this._selKids) {
            this._selKids = this.sqlite.prepare("SELECT id FROM node WHERE h = ? AND kids = ? LIMIT 1");
        }
        const row = this._selKids.get(h, packed);
        return row ? row.id : null;
    }
    // -- Kid (structural parent) edges --
    _dbInsertKid(child, parent) {
        if (!this._insertKid) {
            this._insertKid = this.sqlite.prepare("INSERT OR IGNORE INTO kid (child, parent) VALUES (?, ?)");
        }
        this._insertKid.run(child, parent);
    }
    _dbGetParents(id) {
        if (!this._selParents) {
            this._selParents = this.sqlite.prepare("SELECT parent FROM kid WHERE child = ?");
        }
        return this._selParents.all(id).map((r) => r.parent);
    }
    // -- Containment --
    _selParentsFirst = null;
    _dbGetParentsFirst(id, limit) {
        if (!this._selParentsFirst) {
            this._selParentsFirst = this.sqlite.prepare("SELECT parent FROM kid WHERE child = ? LIMIT ?");
        }
        return this._selParentsFirst.all(id, limit)
            .map((r) => r.parent);
    }
    _selChain = null;
    /** {@link Store.chainRun}'s walk as ONE recursive CTE: the whole
     *  transparent chain (no edge in or out, exactly one parent) is descended
     *  inside SQLite — per-node work is the same three indexed probes as the
     *  base class's loop, but without a JS↔SQLite round trip per node, which
     *  dominates on the deep single-structure scaffolding this read exists
     *  for. */
    _chainWalk(id, cap) {
        if (!this._selChain) {
            this._selChain = this.sqlite.prepare(`WITH RECURSIVE chain(n, d) AS (
           SELECT ?, 0
           UNION ALL
           SELECT (SELECT parent FROM kid WHERE child = chain.n LIMIT 1),
                  chain.d + 1
           FROM chain
           WHERE chain.d < ?
             AND NOT EXISTS (SELECT 1 FROM edge WHERE src = chain.n)
             AND NOT EXISTS (SELECT 1 FROM edge WHERE dst = chain.n)
             AND (SELECT count(*)
                    FROM (SELECT 1 FROM kid WHERE child = chain.n LIMIT 2)
                 ) = 1
         )
         SELECT n FROM chain ORDER BY d`);
        }
        return this._selChain.all(id, cap - 1)
            .map((r) => r.n);
    }
    /** Width of the seq band inside the packed contain rowid: rowid =
     *  child·SEQ_SPAN + seq.  Page sizes are geometric, so a chain of k live
     *  pages needs a base of ≥ 2^k · 4 bytes — seq stays ≤ ~50 for any
     *  physically possible list; the append path guards the band anyway. */
    static SEQ_SPAN = 1 << 8;
    _selContainExists = null;
    _dbContainExists(child) {
        if (!this._selContainExists) {
            // A probe of the child's rowid range — one descent.
            this._selContainExists = this.sqlite.prepare("SELECT 1 AS one FROM contain WHERE id >= ? AND id < ? LIMIT 1");
        }
        const base = child * SQliteStore.SEQ_SPAN;
        return this._selContainExists.get(base, base + SQliteStore.SEQ_SPAN) !==
            undefined;
    }
    _selContainPages = null;
    /** The child's page directory — (seq, byte length) per page, O(log fan-in)
     *  rows, each read from the cell header without loading the blob. */
    containPages(child) {
        if (!this._selContainPages) {
            this._selContainPages = this.sqlite.prepare("SELECT id, length(parents) AS len FROM contain " +
                "WHERE id >= ? AND id < ? ORDER BY id");
        }
        const base = child * SQliteStore.SEQ_SPAN;
        return this._selContainPages.all(base, base + SQliteStore.SEQ_SPAN)
            .map((r) => ({ seq: r.id - base, len: r.len }));
    }
    _selContainPageSub = null;
    _selContainPage = null;
    containPage(child, seq) {
        if (!this._selContainPage) {
            this._selContainPage = this.sqlite.prepare("SELECT parents FROM contain WHERE id = ?");
        }
        return this._selContainPage.get(child * SQliteStore.SEQ_SPAN + seq).parents;
    }
    _dbGetContainParentsSlice(child, offset, limit) {
        if (!this._selContainPageSub) {
            // substr on a BLOB returns bytes: unpack only the requested span.
            this._selContainPageSub = this.sqlite.prepare("SELECT substr(parents, 1 + ? * 4, ? * 4) AS page " +
                "FROM contain WHERE id = ?");
        }
        const out = [];
        let skip = offset;
        for (const seg of this.containPages(child)) {
            const n = seg.len >>> 2;
            if (skip >= n) {
                skip -= n;
                continue;
            }
            const take = Math.min(limit - out.length, n - skip);
            const row = this._selContainPageSub.get(skip, take, child * SQliteStore.SEQ_SPAN + seg.seq);
            if (row && row.page.length > 0)
                out.push(...unpackKids(row.page));
            skip = 0;
            if (out.length >= limit)
                break;
        }
        return out;
    }
    _selContainCount = null;
    _dbGetContainCount(child) {
        if (!this._selContainCount) {
            // Stored ENTRY count (transient duplicates included) — consistent with
            // what the slice streams, which is all the seam math needs.
            this._selContainCount = this.sqlite.prepare("SELECT COALESCE(SUM(length(parents)), 0) / 4 AS n " +
                "FROM contain WHERE id >= ? AND id < ?");
        }
        const base = child * SQliteStore.SEQ_SPAN;
        return this._selContainCount.get(base, base + SQliteStore.SEQ_SPAN).n;
    }
    _dbGetContainParents(child) {
        if (!this._selContain) {
            this._selContain = this.sqlite.prepare("SELECT parents FROM contain WHERE id >= ? AND id < ? ORDER BY id");
        }
        const base = child * SQliteStore.SEQ_SPAN;
        const rows = this._selContain.all(base, base + SQliteStore.SEQ_SPAN);
        if (rows.length === 0)
            return [];
        // Dedup across pages (a pair re-added after its page merged into the base
        // may repeat in the tail until the next base merge), preserving order.
        const seen = new Set();
        const out = [];
        for (const r of rows) {
            for (const p of unpackKids(r.parents)) {
                if (!seen.has(p)) {
                    seen.add(p);
                    out.push(p);
                }
            }
        }
        return out;
    }
    _upsContainPage = null;
    _delContainPage = null;
    _dbAppendContain(child, parents) {
        if (parents.length === 0)
            return;
        if (!this._upsContainPage) {
            this._upsContainPage = this.sqlite.prepare("INSERT INTO contain (id, parents) VALUES (?, ?) " +
                "ON CONFLICT(id) DO UPDATE SET parents = excluded.parents");
            this._delContainPage = this.sqlite.prepare("DELETE FROM contain WHERE id = ?");
        }
        // Fold stored tail pages into the new page IN MEMORY, then write ONCE.
        // Merge rule per fold: below a 256-byte floor always merge (most children
        // have a handful of parents — two tiny rows would double their per-row
        // overhead for no amortization benefit); above it, merge only while the
        // stored page is ≤ 2× the accumulated one, which bounds total re-writing
        // to O(fan-in · log fan-in) bytes and keeps the page directory
        // logarithmic.  A fold that reaches the seq-0 base page dedups, squeezing
        // out duplicates on the same geometric schedule.  Writing the fold's
        // result as one upsert (an in-place row replace in the common
        // small-child case) rather than delete+insert churn keeps B-tree leaf
        // fill at the packed single-row format's level — measured: churn alone
        // cost ~26% extra pages on the same payload.
        const segs = this.containPages(child);
        let cur = packKids(parents);
        let seq = segs.length > 0 ? segs[segs.length - 1].seq + 1 : 0;
        if (seq >= SQliteStore.SEQ_SPAN) {
            throw new Error(`contain page seq overflow for child ${child}`);
        }
        const folded = [];
        while (segs.length > 0) {
            const a = segs[segs.length - 1];
            if (a.len + cur.byteLength > 256 && a.len > 2 * cur.byteLength)
                break;
            const pa = this.containPage(child, a.seq);
            if (a.seq === 0) {
                const seen = new Set();
                const ids = [];
                for (const p of unpackKids(pa)) {
                    if (!seen.has(p)) {
                        seen.add(p);
                        ids.push(p);
                    }
                }
                for (const p of unpackKids(cur)) {
                    if (!seen.has(p)) {
                        seen.add(p);
                        ids.push(p);
                    }
                }
                cur = packKids(ids);
            }
            else {
                const m = new Uint8Array(pa.byteLength + cur.byteLength);
                m.set(pa, 0);
                m.set(cur, pa.byteLength);
                cur = m;
            }
            folded.push(a.seq);
            seq = a.seq;
            segs.pop();
        }
        const base = child * SQliteStore.SEQ_SPAN;
        for (const s of folded) {
            if (s !== seq)
                this._delContainPage.run(base + s);
        }
        this._upsContainPage.run(base + seq, cur);
    }
    // -- Continuation edges --
    _dbInsertEdge(src, dst) {
        if (!this._insertEdge) {
            this._insertEdge = this.sqlite.prepare("INSERT OR IGNORE INTO edge (src, dst) VALUES (?, ?)");
        }
        this._insertEdge.run(src, dst);
    }
    _dbGetNextEdges(id) {
        if (!this._selNext) {
            this._selNext = this.sqlite.prepare("SELECT dst FROM edge WHERE src = ? ORDER BY seq ASC");
        }
        return this._selNext.all(id).map((r) => r.dst);
    }
    _dbGetPrevEdges(id) {
        if (!this._selPrev) {
            this._selPrev = this.sqlite.prepare("SELECT src FROM edge WHERE dst = ? ORDER BY seq DESC");
        }
        return this._selPrev.all(id).map((r) => r.src);
    }
    _selNextFirst = null;
    _dbGetNextEdgesFirst(id, limit) {
        if (!this._selNextFirst) {
            this._selNextFirst = this.sqlite.prepare("SELECT dst FROM edge WHERE src = ? ORDER BY seq ASC LIMIT ?");
        }
        return this._selNextFirst.all(id, limit)
            .map((r) => r.dst);
    }
    _selPrevFirst = null;
    _dbGetPrevEdgesFirst(id, limit) {
        if (!this._selPrevFirst) {
            this._selPrevFirst = this.sqlite.prepare("SELECT src FROM edge WHERE dst = ? ORDER BY seq DESC LIMIT ?");
        }
        return this._selPrevFirst.all(id, limit)
            .map((r) => r.src);
    }
    _selPrevCount = null;
    /** {@link Store.prevCount} — one indexed COUNT over idx_edge_dst, never a
     *  row materialisation (a common continuation's reverse fan-in is
     *  corpus-sized). */
    prevCount(id) {
        if (!this._selPrevCount) {
            this._selPrevCount = this.sqlite.prepare("SELECT COUNT(*) AS n FROM edge WHERE dst = ?");
        }
        return this._selPrevCount.get(id).n;
    }
    _selSrcExists = null;
    _dbEdgeSrcExists(src) {
        if (!this._selSrcExists) {
            // A prefix probe of idx_edge(src, dst) — one B-tree descent.
            this._selSrcExists = this.sqlite.prepare("SELECT 1 AS one FROM edge WHERE src = ? LIMIT 1");
        }
        return this._selSrcExists.get(src) !== undefined;
    }
    _dbEdgeDistinctSrcCount() {
        return this.sqlite.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT src FROM edge)").get().n;
    }
    // -- Halos (durable 2-bit quantized rows) --
    _dbGetHalo(id) {
        if (!this._selHalo) {
            this._selHalo = this.sqlite.prepare("SELECT vec, mass FROM halo WHERE id = ?");
        }
        const r = this._selHalo.get(id);
        return r ?? null;
    }
    _dbUpsertHalo(id, encodedVec, mass) {
        if (!this._upHalo) {
            this._upHalo = this.sqlite.prepare("INSERT INTO halo (id, vec, mass) VALUES (?, ?, ?) " +
                "ON CONFLICT(id) DO UPDATE SET vec = excluded.vec, mass = excluded.mass");
        }
        this._upHalo.run(id, encodedVec, mass);
    }
    // -- Meta --
    _dbGetMeta(key) {
        if (!this._getMeta) {
            this._getMeta = this.sqlite.prepare("SELECT val FROM meta WHERE key = ?");
        }
        const row = this._getMeta.get(key);
        return row ? row.val : null;
    }
    _dbSetMeta(key, val) {
        if (!this._setMeta) {
            this._setMeta = this.sqlite.prepare("INSERT INTO meta (key, val) VALUES (?, ?) " +
                "ON CONFLICT(key) DO UPDATE SET val = excluded.val");
        }
        this._setMeta.run(key, val);
    }
    _dbDeleteMeta(key) {
        if (!this._delMeta) {
            this._delMeta = this.sqlite.prepare("DELETE FROM meta WHERE key = ?");
        }
        this._delMeta.run(key);
    }
    // -- Snapshot --
    _dbSaveSnapshot(bytes) {
        if (!this._insSnapshot) {
            this._insSnapshot = this.sqlite.prepare("INSERT INTO snapshot (id, data) VALUES (1, ?) " +
                "ON CONFLICT(id) DO UPDATE SET data = excluded.data");
        }
        this._insSnapshot.run(bytes);
    }
    _dbLoadSnapshot() {
        if (!this._selSnapshot) {
            this._selSnapshot = this.sqlite.prepare("SELECT data FROM snapshot WHERE id = 1");
        }
        const r = this._selSnapshot.get();
        return r ? new Uint8Array(r.data) : null;
    }
    // -- Vector DB: content (gist) index --
    _vecContentUpsert(entries) {
        this.content.upsertMany(entries);
    }
    _vecContentQuery(v, k, ef) {
        return this.content.query(v, k, { ef });
    }
    _vecContentHas(id) {
        return this.content ? this.content.has(id) : false;
    }
    _vecContentSize() {
        return this.content ? this.content.size : 0;
    }
    _vecContentLastReads() {
        return this.content ? this.content.lastQueryStorageReads : 0;
    }
    _vecContentPhysicalSize() {
        return this.content ? this.content.physicalSize : 0;
    }
    _vecContentCompact() {
        this.content.compact();
    }
    _vecContentDeleteMany(ids) {
        this.content.deleteMany(ids);
    }
    *_vecContentEntriesSince(after) {
        if (this.content)
            yield* this.content.keysSince(after);
    }
    /** {@link AbstractStore._dbEdgeOrHaloIds} — one C-side scan; UNION dedups
     *  and (with the ORDER BY) sorts, so the result is ready for the binary-
     *  search membership probes and the ascending-id maintenance walks. */
    _dbEdgeOrHaloIds() {
        const rows = this.sqlite.prepare("SELECT src AS id FROM edge UNION SELECT dst FROM edge " +
            "UNION SELECT id FROM halo ORDER BY 1").all();
        const out = new Array(rows.length);
        for (let i = 0; i < rows.length; i++)
            out[i] = rows[i].id;
        return out;
    }
    // -- Vector DB: halo index --
    _vecHaloUpsert(entries) {
        this.halos.upsertMany(entries);
    }
    _vecHaloQuery(v, k, ef) {
        return this.halos.query(v, k, { ef });
    }
    _vecHaloSize() {
        return this.halos ? this.halos.size : 0;
    }
    _vecHaloPhysicalSize() {
        return this.halos ? this.halos.physicalSize : 0;
    }
    _vecHaloCompact() {
        this.halos.compact();
    }
    /** Pre-fill both vector indices' RAM caches with sequential scans (up to
     *  their budget caps) — seconds of streaming instead of the minutes of
     *  random point reads a cold training/query session otherwise pays while
     *  warming.  Optional; call once after open before sustained work.
     *  Returns rows warmed. */
    async warmVectorCaches() {
        await this._ensureReady();
        return (this.content?.warmCache() ?? 0) + (this.halos?.warmCache() ?? 0);
    }
}
