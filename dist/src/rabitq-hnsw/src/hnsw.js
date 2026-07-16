import { Heap } from "./heap.js";
import { Prng } from "./prng.js";
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
export class HnswIndex {
  M;
  Mmax0;
  efConstruction;
  mL;
  quantizer;
  store;
  seed;
  levelRng;
  // tiny global scalars, cached from meta and written through on change
  entry;
  maxLevel;
  live;
  total;
  _efSearch;
  // Per-operation working set: the records the current insert/query is actively
  // comparing. Cleared at the start of every op and bounded by efConstruction /
  // efSearch (the nodes one operation can touch), never by the collection size.
  // This is the algorithm's working memory -- it makes each touched node cost one
  // storage read per op -- not a tunable cache. The only cache is SQLite's page
  // cache (see Store), sized in MB.
  working = new Map();
  visited = new Set();
  // Epoch-tagged visited marks — the Set above without per-candidate hashing:
  // visitedTag[id] === visitedEpoch means "seen this operation", and bumping
  // the epoch clears the whole set in O(1).  Semantically IDENTICAL to the
  // Set (results never differ); used only when the store has a cache budget,
  // because the array is 4 B per internal id — amortized working memory that
  // grows with the collection, which the cacheSizeMb:0 flat-memory mode must
  // not pay.  The epoch wrap (2³²−1 ops) refills the array once.
  visitedTag = new Uint32Array(1024);
  visitedEpoch = 0;
  seenTag(id, epoch) {
    return id < this.visitedTag.length && this.visitedTag[id] === epoch;
  }
  markVisited(id, epoch) {
    if (id >= this.visitedTag.length) {
      const grown = new Uint32Array(
        Math.max(id + 1, this.visitedTag.length * 2),
      );
      grown.set(this.visitedTag);
      this.visitedTag = grown;
    }
    this.visitedTag[id] = epoch;
  }
  candHeap = new Heap(true); // min-heap: nearest first
  resHeap = new Heap(false); // max-heap: farthest first
  singleEp = [0];
  idxScratch = [];
  distScratch = [];
  freshScratch = [];
  // distance dispatch: a full-precision query sets qCtx; building or a code
  // query sets refBytes (code<->code). `building` only suppresses the counter.
  qCtx = null;
  refBytes = null;
  building = false;
  lastQueryDistComps = 0;
  /** Storage row reads issued by the most recent query (cache-independent). */
  lastQueryStorageReads = 0;
  constructor(quantizer, store, params) {
    this.quantizer = quantizer;
    this.store = store;
    this.M = params.M;
    this.Mmax0 = this.M * 2;
    this.efConstruction = params.efConstruction;
    this._efSearch = params.efSearch;
    this.mL = 1 / Math.log(this.M);
    this.seed = params.seed >>> 0;
    const s = store.loadState();
    this.entry = s.entryPoint;
    this.maxLevel = s.maxLevel;
    this.live = s.live;
    this.total = s.total;
    this.levelRng = new Prng(this.seed);
    this.levelRng.restore(s.rng);
  }
  get size() {
    return this.live;
  }
  get physicalSize() {
    return this.total;
  }
  get bytesPerVector() {
    return this.quantizer.codeWords * 4;
  }
  get efSearch() {
    return this._efSearch;
  }
  set efSearch(v) {
    this._efSearch = Math.max(1, v | 0);
    this.store.setEfSearch(this._efSearch);
  }
  persistState() {
    this.store.saveState({
      entryPoint: this.entry,
      maxLevel: this.maxLevel,
      live: this.live,
      total: this.total,
      rng: this.levelRng.snapshot(),
    });
  }
  randomLevel() {
    let u = this.levelRng.next();
    if (u < 1e-12) {
      u = 1e-12;
    }
    return Math.floor(-Math.log(u) * this.mL);
  }
  /**
   * Fetch a node record into the operation's working set. The first touch in an
   * op is a storage read; later touches in the same op reuse it. The set is
   * cleared per op and bounded by efConstruction / efSearch, so storage reads
   * per op equal the number of *distinct* nodes the op visits -- minimal, and
   * independent of any cache.
   */
  node(id) {
    const hit = this.working.get(id);
    if (hit !== undefined) {
      return hit;
    }
    const rec = this.store.getNode(id);
    if (rec === null) {
      throw new Error(`node ${id} not found`);
    }
    this.working.set(id, rec);
    return rec;
  }
  /** Prefetch several nodes into the working set with ONE batched storage
   *  read for the misses.  Point queries per neighbour made statement
   *  dispatch — not distance arithmetic — the dominant cost of a large
   *  build; the batch keeps `reads` accounting identical per row. */
  fetchNodes(ids, count = ids.length) {
    // getNodesInto skips ids already present in `working` itself — no
    // second pre-filter pass over the same map here.
    this.store.getNodesInto(ids, this.working, count);
  }
  /** Distance from the current source (query vector or reference code) to a node. */
  distOf(rec) {
    if (this.qCtx !== null) {
      this.lastQueryDistComps++;
      return this.quantizer.estimate(rec.code, 0, this.qCtx);
    }
    if (!this.building) {
      this.lastQueryDistComps++;
    }
    return this.quantizer.codeDistanceBytes(this.refBytes, rec.code);
  }
  /** Code-to-code distance between two stored nodes (graph wiring only). */
  codeDist(a, b) {
    return this.quantizer.codeDistanceBytes(
      this.node(a).code,
      this.node(b).code,
    );
  }
  /**
   * SEARCH-LAYER (Algorithm 2). Frontier in `candHeap`, bounded result set in
   * `resHeap` (non-deleted only). Deleted nodes are traversed for routing but
   * never returned. `visited` is a per-call set sized by the nodes seen here.
   */
  searchLayer(entryPoints, ef, layer) {
    const cand = this.candHeap;
    const res = this.resHeap;
    cand.clear();
    res.clear();
    // Visited marks: epoch tags when RAM-for-speed is allowed, the plain Set
    // in flat-memory mode.  Identical semantics either way.
    const useTags = this.store.cacheEnabled;
    let epoch = 0;
    const visited = this.visited;
    if (useTags) {
      epoch = ++this.visitedEpoch;
      if (epoch === 0xffffffff) {
        this.visitedTag.fill(0);
        epoch = this.visitedEpoch = 1;
      }
    } else {
      visited.clear();
    }
    for (let k = 0; k < entryPoints.length; k++) {
      const ep = entryPoints[k];
      if (useTags) {
        if (this.seenTag(ep, epoch)) {
          continue;
        }
        this.markVisited(ep, epoch);
      } else {
        if (visited.has(ep)) {
          continue;
        }
        visited.add(ep);
      }
      const rec = this.node(ep);
      const d = this.distOf(rec);
      cand.push(d, ep);
      if (rec.deleted === 0) {
        res.push(d, ep);
        if (res.size > ef) {
          res.pop();
        }
      }
    }
    while (cand.size > 0) {
      const cd = cand.topKey();
      if (res.size >= ef && cd > res.topKey()) {
        break;
      }
      const c = cand.topVal();
      cand.pop();
      const nbrs = this.store.getNeighbors(c, layer);
      if (nbrs === null) {
        continue;
      }
      // Batch: mark the unvisited neighbours, fetch their codes in one
      // storage read, then score them in the original order.
      const fresh = this.freshScratch;
      fresh.length = 0;
      for (let i = 0; i < nbrs.length; i++) {
        const e = nbrs[i];
        if (useTags) {
          if (this.seenTag(e, epoch)) {
            continue;
          }
          this.markVisited(e, epoch);
        } else {
          if (visited.has(e)) {
            continue;
          }
          visited.add(e);
        }
        fresh.push(e);
      }
      if (fresh.length > 1) {
        this.fetchNodes(fresh);
      }
      for (let i = 0; i < fresh.length; i++) {
        const e = fresh[i];
        const rec = this.node(e);
        const d = this.distOf(rec);
        const worst = res.size > 0 ? res.topKey() : Infinity;
        if (res.size < ef || d < worst) {
          cand.push(d, e);
          if (rec.deleted === 0) {
            res.push(d, e);
            if (res.size > ef) {
              res.pop();
            }
          }
        }
      }
    }
  }
  /** Greedy single-best descent from `fromLayer` down to (but not into) `toLayer`. */
  greedyDescend(entry, fromLayer, toLayer) {
    let cur = entry;
    const ep = this.singleEp;
    for (let layer = fromLayer; layer > toLayer; layer--) {
      ep[0] = cur;
      this.searchLayer(ep, 1, layer);
      if (this.resHeap.size > 0) {
        cur = this.resHeap.vals[0];
      }
    }
    return cur;
  }
  /**
   * SELECT-NEIGHBORS-HEURISTIC (Algorithm 4) on codes. Picks up to `M` diverse
   * neighbours from `candIds`, preferring those closer to `base` than to any
   * already-chosen neighbour, then fills remaining slots with the closest
   * leftovers (keep-pruned connections). Appends to `out`.
   */
  selectNeighbors(base, candIds, count, M, out) {
    const idx = this.idxScratch;
    const ds = this.distScratch;
    this.fetchNodes(candIds, count); // one batched read for the misses
    idx.length = count;
    ds.length = count;
    for (let i = 0; i < count; i++) {
      idx[i] = i;
      ds[i] = this.codeDist(base, candIds[i]);
    }
    idx.sort((a, b) => ds[a] - ds[b]);
    for (let s = 0; s < count; s++) {
      if (out.length >= M) {
        break;
      }
      const i = idx[s];
      const cid = candIds[i];
      if (cid === base) {
        continue;
      }
      const cd = ds[i];
      let keep = true;
      for (let j = 0; j < out.length; j++) {
        if (this.codeDist(cid, out[j]) < cd) {
          keep = false;
          break;
        }
      }
      if (keep) {
        out.push(cid);
      }
    }
    if (out.length < M) {
      for (let s = 0; s < count && out.length < M; s++) {
        const cid = candIds[idx[s]];
        if (cid === base) {
          continue;
        }
        let dup = false;
        for (let j = 0; j < out.length; j++) {
          if (out[j] === cid) {
            dup = true;
            break;
          }
        }
        if (!dup) {
          out.push(cid);
        }
      }
    }
  }
  /**
   * Insert a vector's code under external id `ext`; returns the internal node id.
   * All graph reads/writes go through the store; the caller owns the transaction.
   */
  insert(ext, code, efC) {
    const ef = efC !== undefined && efC >= 1
      ? Math.min(efC, this.efConstruction)
      : this.efConstruction;
    this.working.clear();
    const level = this.randomLevel();
    const id = this.store.addNode(ext, level, code);
    this.total++;
    this.working.set(id, { code, deleted: 0, ext });
    if (this.entry === -1) {
      this.entry = id;
      this.maxLevel = level;
      this.live++;
      this.persistState();
      return id;
    }
    this.qCtx = null;
    this.refBytes = code;
    this.building = true;
    let entry = this.entry;
    const topLayer = this.maxLevel;
    if (topLayer > level) {
      entry = this.greedyDescend(entry, topLayer, level);
    }
    let entryPoints = [entry];
    const startLayer = Math.min(topLayer, level);
    for (let layer = startLayer; layer >= 0; layer--) {
      this.searchLayer(entryPoints, ef, layer);
      const res = this.resHeap;
      const wCount = res.size;
      const selected = [];
      this.selectNeighbors(id, res.vals, wCount, this.M, selected);
      if (selected.length > 0) {
        this.store.setNeighbors(id, layer, selected);
      }
      const cap = layer === 0 ? this.Mmax0 : this.M;
      for (let s = 0; s < selected.length; s++) {
        const nb = selected[s];
        const cur = this.store.getNeighbors(nb, layer);
        const list = cur ? Array.from(cur) : [];
        list.push(id);
        if (list.length > cap) {
          const pruned = [];
          this.selectNeighbors(nb, list, list.length, cap, pruned);
          this.store.setNeighbors(nb, layer, pruned);
        } else {
          this.store.setNeighbors(nb, layer, list);
        }
      }
      if (wCount > 0) {
        const next = new Array(wCount);
        for (let i = 0; i < wCount; i++) {
          next[i] = res.vals[i];
        }
        entryPoints = next;
      } else {
        entryPoints = [entry];
      }
    }
    this.building = false;
    this.refBytes = null;
    this.live++;
    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entry = id;
    }
    this.persistState();
    return id;
  }
  /** k-NN with a full-precision query vector (accurate estimator). */
  searchKnn(vec, k, ef) {
    this.lastQueryDistComps = 0;
    this.store.resetReads();
    this.working.clear();
    this.building = false;
    this.refBytes = null;
    if (this.entry === -1 || k <= 0) {
      this.lastQueryStorageReads = 0;
      return [];
    }
    this.qCtx = this.quantizer.prepareQuery(vec);
    const hits = this.collectKnn(k, Math.max(ef ?? this._efSearch, k));
    this.qCtx = null;
    this.lastQueryStorageReads = this.store.reads;
    return hits;
  }
  /** k-NN with an already-quantized code (sign-bit Hamming / angular distance). */
  searchKnnByCode(codeBytes, k, ef) {
    this.lastQueryDistComps = 0;
    this.store.resetReads();
    this.working.clear();
    this.building = false;
    this.qCtx = null;
    if (this.entry === -1 || k <= 0) {
      this.lastQueryStorageReads = 0;
      return [];
    }
    this.refBytes = codeBytes;
    const hits = this.collectKnn(k, Math.max(ef ?? this._efSearch, k));
    this.refBytes = null;
    this.lastQueryStorageReads = this.store.reads;
    return hits;
  }
  collectKnn(k, efs) {
    let entry = this.entry;
    if (this.maxLevel > 0) {
      entry = this.greedyDescend(entry, this.maxLevel, 0);
    }
    this.singleEp[0] = entry;
    this.searchLayer(this.singleEp, efs, 0);
    const res = this.resHeap;
    const n = res.size;
    const hits = new Array(n);
    for (let i = 0; i < n; i++) {
      let d = res.keys[i];
      if (d < 0) {
        d = 0;
      }
      hits[i] = { id: this.node(res.vals[i]).ext, distance: d };
    }
    hits.sort((a, b) => a.distance - b.distance);
    if (hits.length > k) {
      hits.length = k;
    }
    return hits;
  }
  /** Tombstone a live node by internal id. Caller owns the transaction. */
  remove(id) {
    const rec = this.store.getNode(id);
    if (rec === null || rec.deleted === 1) {
      return false;
    }
    this.store.tombstone(id);
    this.live--;
    this.persistState();
    return true;
  }
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
  compact() {
    const r = this.store.spliceCompact(this.M, this.Mmax0, this.entry);
    this.entry = r.entry;
    this.maxLevel = r.maxLevel;
    this.live = r.live;
    this.total = r.live;
    this.persistState();
    this.working.clear();
    this.store.vacuum();
  }
}
