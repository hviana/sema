// store.ts — the memory as a content-addressed node graph (a Merkle DAG).
//
// There is no "whole", no "leaf vs interior" privilege. There is one kind of
// thing — a NODE — named by its content. A node is either a leaf (a single
// byte, with an implicit negative id) or a branch (an ordered list of child
// node ids). Identical nodes are stored once (hash-consing); a node that was the
// root of one deposit becomes, by reference, an interior child of a larger
// deposit that contains it. Storage is therefore O(distinct subtrees), and every
// span the encoder ever produced is individually addressable.
//
// Node ids are signed integers. Single-byte leaves occupy the negative range
// −256…−1 (derived from the byte value, never stored in a DB row). Branches
// are dense, monotonically-increasing positive integers (0,1,2,…), never
// deleted, so the count of minted branch ids is the next id. Integer ids are the
// most compact key possible: SQLite stores them inline in the rowid B-tree (no
// secondary index), child lists pack to 4-byte signed integers, and the vector
// index keys on them as a 4-byte int32.
//
// On top of the DAG sit two relations:
//   • the gist index — each node's fold vector, for SOFT (resonant) lookup;
//   • continuation edges — learned "what follows what", the associations recall
//     traverses. Both are keyed by node id, so both deduplicate for free.
//
// AbstractStore is the template-method base class that contains ALL domain
// logic — caching, dedup/merge decisions, geometric
// halo scheduling, buffer management — and calls down to a handful of
// protected abstract methods that a concrete persistence adapter implements.
// SQliteStore (in store-sqlite.ts) extends it and provides only the bare
// essentials required for SQLite + VectorDatabase communication.

import { addInto, copy, dot, normalize, Vec } from "./vec.js";
import { DEFAULT_CONFIG, type StoreConfig } from "./config.js";
import { identityBar } from "./geometry.js";

/** A node id: a dense, non-negative integer assigned in creation order. */
export type NodeId = number;

/** A node in the graph. Exactly one of `leaf` / `kids` is set. */
export interface NodeRec {
  id: NodeId;
  leaf: Uint8Array | null;
  kids: NodeId[] | null;
}

/** Entry cap for the two ANN read caches ({@link AbstractStore._resonateCache}
 *  / `_resonateHaloCache`).  They are only dropped on index writes, so a long
 *  query-only session otherwise grows them without bound — a slow memory/GC
 *  degradation that takes hours to manifest.  At the cap the cache is cleared
 *  wholesale (repeat-query hits re-warm it; a miss only re-runs the ANN). */
const RESONATE_CACHE_MAX = 4096;

/** Longest dedup-cache KEY worth retaining, in string length.  Branch keys
 *  are `kids.join(",")`; structural branches stay tiny (≤ maxGroup kids), but
 *  the whole-stream flat branches deposit interns (one leaf id PER INPUT
 *  BYTE) produce keys of ~4–5 chars per content byte — one per deposit.  The
 *  dedup caches are bounded by ENTRY count, so retaining those keys grows
 *  memory with total ingested content.  Past this bound the cache is
 *  bypassed: the durable content-addressed probe still answers (dedup never
 *  depends on the cache), at one indexed SQLite lookup per re-encounter —
 *  and true input-level repeats are already absorbed by the ingest cache. */
const DEDUP_KEY_MAX = 4096;

/** Safety depth bound for one {@link Store.chainRun} read.  Semantics never
 *  depend on it (a truncated run ends on a still-transparent node and the
 *  climber continues from there); it only bounds a single read's size. */
const CHAIN_DEPTH_CAP = 65_536;

/** A soft-resonance hit. */
export interface Hit {
  id: NodeId;
  /** Estimated cosine (1 − RaBitQ estimated distance) — an APPROXIMATION,
   *  never an exact rerank.  Identity decisions must use content-addressed
   *  resolve(), never `score >= 1`. */
  score: number;
  /** This node's halo, when a producer chooses to attach it.  NOT populated
   *  by {@link Store.resonate}/{@link Store.resonateHalo}: no consumer read
   *  it there, and eagerly fetching k halo rows per query was pure waste.
   *  Call {@link Store.halo} on the hits that actually need it. */
  halo?: Vec;
}

/** The content key of a Float32Array — one latin1 char per byte, an exact
 *  encoding of the 32-bit floats.  Content-addressed, not object-identity,
 *  so a fresh Float32Array carrying the same values still hits.  Vectors are
 *  D·4 bytes (max ~4096), well under the argument limit; the key is far
 *  cheaper than the ANN query it deduplicates. */
function vecKey(v: Vec): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  // Chunked fromCharCode: one spread of D·4 args (16K at D=4096) flirts with
  // engine argument limits and is slower than a few bounded calls.
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return s;
}

/** Eviction strategy for a {@link BoundedMap}.
 *
 *  - `"lru"`: evict the least-recently-used entry.  Best when every entry
 *    saves roughly the same work (dedup, leaf vectors, node records).
 *  - `"smallest"`: among the oldest few LRU candidates, evict the smallest.
 *    This protects expensive-to-reconstruct entries (large branches) at the
 *    expense of cheap ones (small leaves) — useful for reconstruction caches
 *    where rebuild cost varies by orders of magnitude. */
export type Evict = "lru" | "smallest";

/** Bounded map with LRU eviction and byte accounting.  On get the entry
 *  moves to the most-recent end; on set the least-recently-used entries are
 *  evicted until total bytes ≤ `maxBytes`.  The optional `sizeOf` callback
 *  measures each value in bytes (defaults to 1, so `maxBytes` = max entries
 *  for uniform caches).  A miss only costs a little extra work later, never
 *  correctness. */
export class BoundedMap<K, V> {
  private m = new Map<K, V>();
  private _bytes = 0;
  // Persistent eviction cursor over the Map's insertion order. A fresh
  // `keys()` iterator per eviction re-skips the growing prefix of holes that
  // deletions leave in V8's ordered backing store (compacted only on rehash),
  // making each eviction O(size) once the map first fills — the training-rate
  // cliff at scale. A persistent iterator passes each hole exactly once
  // (V8 map iterators stay valid under mutation): amortized O(1).
  private _cursor: IterableIterator<K> | null = null;
  // "smallest" mode: oldest-entry candidates carried between evictions, fed
  // from the cursor, so the LRU window never rescans from the front.
  private _candidates: K[] = [];
  constructor(
    readonly maxBytes: number,
    private readonly sizeOf: (v: V) => number = () => 1,
    private readonly evict: Evict = "lru",
  ) {}
  /** Next key in insertion (≈ LRU) order, resuming where the last call left
   *  off; wraps to the front when exhausted. Undefined only when empty. */
  private nextOldest(): K | undefined {
    for (let wrapped = false;;) {
      if (this._cursor === null) this._cursor = this.m.keys();
      const n = this._cursor.next();
      if (!n.done) return n.value;
      this._cursor = null;
      if (this.m.size === 0 || wrapped) return undefined;
      wrapped = true;
    }
  }
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  /** Membership without touching LRU order — a pure peek, for callers that only
   *  need "is this key present?" and must not promote it to most-recent. */
  has(k: K): boolean {
    return this.m.has(k);
  }
  set(k: K, v: V): void {
    const old = this.m.get(k);
    if (old !== undefined) {
      this._bytes -= this.sizeOf(old);
      this.m.delete(k);
    }
    this.m.set(k, v);
    this._bytes += this.sizeOf(v);
    while (this._bytes > this.maxBytes && this.m.size > 0) {
      if (this.evict === "smallest") {
        // Among the oldest LRU candidates, evict the cheapest to rebuild.
        // Window grows logarithmically with cache size — wide enough to
        // find a cheap victim without scanning the whole map. Candidates
        // are pulled from the persistent cursor and carried between
        // evictions, so the window never rescans the map from the front.
        const WINDOW = Math.ceil(Math.log2(this.m.size + 1));
        this._candidates = this._candidates.filter((k) => this.m.has(k));
        while (this._candidates.length < WINDOW) {
          const k = this.nextOldest();
          if (k === undefined) break;
          if (!this._candidates.includes(k)) this._candidates.push(k);
        }
        let bestI = -1;
        let bestSz = Infinity;
        for (let i = 0; i < this._candidates.length; i++) {
          const sz = this.sizeOf(this.m.get(this._candidates[i])!);
          if (sz < bestSz) {
            bestSz = sz;
            bestI = i;
          }
        }
        if (bestI < 0) break;
        const bestK = this._candidates[bestI];
        this._candidates.splice(bestI, 1);
        this._bytes -= bestSz;
        this.m.delete(bestK);
      } else {
        const lru = this.nextOldest();
        if (lru === undefined) break;
        const lruv = this.m.get(lru);
        if (lruv === undefined) continue;
        this._bytes -= this.sizeOf(lruv);
        this.m.delete(lru);
      }
    }
  }
  get size(): number {
    return this.m.size;
  }
  get bytes(): number {
    return this._bytes;
  }
  /** Remove one entry (point invalidation), with byte accounting. */
  delete(k: K): void {
    const v = this.m.get(k);
    if (v === undefined) return;
    this._bytes -= this.sizeOf(v);
    this.m.delete(k);
  }
  /** Drop every entry (bulk invalidation) — O(1) amortised via fresh maps. */
  clear(): void {
    if (this.m.size === 0) return;
    this.m = new Map();
    this._bytes = 0;
    this._cursor = null;
    this._candidates = [];
  }
}

export interface Store {
  readonly D: number;

  // ── the DAG (hash-consed) ──────────────────────────────────────────────
  /** Insert a leaf, returning its content id. Idempotent. */
  putLeaf(bytes: Uint8Array, gist: Vec): Promise<NodeId>;
  /** Insert a branch over child ids, returning its content id. Idempotent. */
  putBranch(kids: NodeId[], gist: Vec): Promise<NodeId>;
  /** Whether a node with this id already exists. O(1). */
  has(id: NodeId): boolean;
  /** The node record, or null. */
  get(id: NodeId): NodeRec | null;
  /** The bytes a node spans, reconstructed by traversal (cached). */
  bytes(id: NodeId): Uint8Array;
  /** First `maxLen` bytes of a node, stopping early — far cheaper than
   *  `bytes()` for large branches when only a prefix is needed. */
  bytesPrefix(id: NodeId, maxLen: number): Uint8Array;
  /** The CONTENT LENGTH of a node in bytes — under the linear river fold
   *  this IS the node's gist magnitude, squared: seat permutations
   *  decorrelate siblings, so ‖gist‖ = √(content bytes) up to decorrelation
   *  noise.  The magnitude is therefore never persisted beside the vector
   *  (that would duplicate what the content already determines; the ANN
   *  index keeps unit directions), it is READ here in O(1) amortized — the
   *  store-side half of angle+magnitude semantics.  Mechanisms use it to
   *  convert a scale-free cosine into the absolute quantities the linear
   *  geometry carries: shared bytes ≈ cos·√(lenA·lenB), fraction of A
   *  explained ≈ cos·√(lenB/lenA).  `cap`, when given, SATURATES the walk:
   *  the return value is exact below the cap and merely ≥ cap otherwise —
   *  for decisions that stop caring past a bound (a fraction that caps at 1,
   *  a weight that is sub-noise beyond a ratio), so one huge conversation
   *  root never costs a full subtree walk.  Only complete walks are
   *  memoized. */
  contentLen(id: NodeId, cap?: number): number;
  findLeaf(bytes: Uint8Array): NodeId | null;
  findBranch(kids: NodeId[]): NodeId | null;
  /** The branch nodes that list `id` among their children — the reverse of
   *  `get(id).kids`. Lets the structural DAG be climbed upward, from a
   *  recognised fragment to the larger learned forms that contain it. */
  parents(id: NodeId): NodeId[];
  /** The first `limit` structural parents of `id` — the CAPPED read for the
   *  climb.  A heavily shared subtree's parent set grows with the corpus;
   *  reading `bound + 1` decides "hub or not" exactly (a result of length
   *  bound + 1 means MORE than bound) while the read stays bounded by the
   *  bound, never by the fan-in. */
  parentsFirst(id: NodeId, limit: number): NodeId[];
  /** Whether `id` has ANY structural parent — one LIMITed point probe. */
  hasParents(id: NodeId): boolean;
  /** The TRANSPARENT CHAIN from `id` upward: `run[0] === id`, and while the
   *  current node is transparent — no continuation edge in or out and exactly
   *  ONE structural parent — the run steps to that parent.  The last element
   *  is the first NON-transparent ancestor (or a parentless top).  Transparent
   *  nodes are invisible to the edge climb (they contribute no roots, no
   *  contexts and no lateral branching), so a climber may hop a whole run in
   *  one read where a node-at-a-time ascent pays three probes per node — the
   *  dominant cost of climbing deep single-structure scaffolding.  Results
   *  are cached for the store's LIFETIME (reads are pure between writes) and
   *  the cache is dropped whenever a write could break transparency: a node
   *  gaining a structural parent (fresh mint) or a continuation edge (link).
   *  The run may be truncated at an internal safety depth; a truncated run's
   *  last element is then still transparent, and a climber that treats the
   *  terminal generically simply continues from it — semantics never depend
   *  on completeness. */
  chainRun(id: NodeId): readonly NodeId[];
  /** Record a CONTAINMENT edge: `parent`'s byte content contains `child`'s,
   *  even though `child` is not among `parent`'s kids (a sub-span flat branch
   *  inside a leaf-parent chunk).  Kept apart from {@link parents} — the
   *  structural climb is untouched; {@link containers} serves the climbing
   *  surface of orphan flat branches durably, where a session-local side
   *  table would be lost on restart or an ingest-cache replay.  Idempotent. */
  addContainer(child: NodeId, parent: NodeId): void;
  /** The chunks recorded by {@link addContainer} as containing `child`. */
  containers(child: NodeId): NodeId[];
  /** Whether `child` has ANY containment parent — an EXISTS probe that never
   *  unpacks the (occurrence-proportional) packed parents blob. */
  hasContainers(child: NodeId): boolean;
  /** A PAGE of containment parents — `limit` entries starting at `offset`
   *  (the buffered adds follow the stored ones), so a consumer can STREAM a
   *  common window's corpus-sized parent list and stop the moment its
   *  question is decided, with per-page work bounded by `limit`. */
  containersSlice(child: NodeId, offset: number, limit: number): NodeId[];
  nodeCount(): number;

  // ── soft resonance over node gists ─────────────────────────────────────
  /** The k nodes whose gist resonates most with v. */
  resonate(v: Vec, k: number): Promise<Hit[]>;
  /** Mark a node as a RESONANCE TARGET — promote its gist into the content
   *  index so {@link resonate} can find it.  A node's gist is captured at intern
   *  but indexed LAZILY (only targets are indexed; the ~99.5% intermediate DAG
   *  is not — that is the store's compression).  A node becomes a target
   *  implicitly via {@link link}/{@link pourHalo}; this is the EXPLICIT hook for
   *  the one target those do not cover — a DEPOSIT ROOT, the node `express`,
   *  `bridge`, and whole-query recall resonate the input to.  Idempotent; a
   *  no-op once a node is indexed or if its captured gist has been evicted. */
  indexTarget(id: NodeId): void;

  /** Remove content-index entries for nodes that are structurally isolated
   *  (fewer than `minParents` structural parents) and are not roots of any
   *  experience (no edges, no halo).  These nodes are unique to one tree and
   *  bridge nothing between experiences — their index slots are wasted.
   *
   *  This is a POST-HOC batch operation, not on the training hot path.  Run it
   *  at checkpoints or after training to reclaim index space.  The underlying
   *  vector DB is compacted after deletion to physically free the space.
   *
   *  INCREMENTAL: keep decisions are monotone (parents, edges and halos only
   *  ever grow), so entries examined by a previous pass are settled; each
   *  pass scans only entries indexed since the last one (a durable watermark
   *  over the index's monotone internal ids), making the checkpoint-cadence
   *  call cheap on a large trained store.
   *
   *  @param minParents  keep only nodes with ≥ this many structural parents
   *                     (default 2 — keep nodes that bridge ≥2 experiences)
   *  @returns number of entries removed */
  compactContentIndex(minParents?: number): Promise<number>;

  /** Re-index structurally-important nodes whose gists were evicted from the
   *  pending cache before they could be indexed — the inverse of {@link
   *  compactContentIndex}.  Walks the edge/halo-bearing id set (a repairable
   *  node must carry edges or a halo, so that set IS the candidate set —
   *  corpus-of-experiences-sized, not node-count-sized); for each candidate
   *  that (a) has ≥ `minParents` structural parents and (b) is NOT already
   *  in the content index, regenerates its gist via `regenerateGist` and adds
   *  it.  Intended as a post-training batch operation, not on the hot path.
   *
   *  `regenerateGist` receives a node id and must return its perceived gist
   *  vector (or `null` to skip).  The store has no access to the
   *  {@link Space}/{@link Alphabet} needed for perception — the caller (the
   *  {@link Mind}) wires those in.
   *
   *  @param regenerateGist  async callback that regenerates a node's gist
   *  @param minParents      only repair nodes with ≥ this many parents
   *                         (default 2 — structural bridges)
   *  @returns number of nodes added to the index */
  repairContentIndex(
    regenerateGist: (id: NodeId) => Promise<Vec | null>,
    minParents?: number,
  ): Promise<number>;

  // ── continuation edges (associations) ──────────────────────────────────
  /** Learn that `to` follows `from`. Idempotent. */
  link(from: NodeId, to: NodeId): Promise<void>;
  /** What follows `id` (in insertion order). */
  next(id: NodeId): NodeId[];
  /** Whether ANY edge leaves `id` — the EXISTENCE probe for the forward
   *  relation.  Decision points that only ask "does this lead anywhere?"
   *  must use this instead of materialising {@link next} (a context's edge
   *  list is a range read; a hub's is large) — the same
   *  count-instead-of-materialise principle {@link prevCount} serves for the
   *  reverse relation.  One indexed point probe. */
  hasNext(id: NodeId): boolean;
  /** What `id` follows (for reverse recall). */
  prev(id: NodeId): NodeId[];
  /** The first `limit` continuations of `id`, in the SAME order {@link next}
   *  returns (insertion order) — the CAPPED read for consumers bounded by the
   *  hub convention.  A LIMITed statement, never a full materialisation: no
   *  read through this may grow with the corpus. */
  nextFirst(id: NodeId, limit: number): NodeId[];
  /** The first `limit` predecessors of `id`, in the SAME order {@link prev}
   *  returns (NEWEST-first — prev is seq-descending; see the adapter) — the
   *  capped read for reverse fan-ins, which are corpus-sized on a common
   *  continuation. */
  prevFirst(id: NodeId, limit: number): NodeId[];
  /** How many nodes `id` follows — the reverse-edge SUPPORT count.  Decision
   *  points that only weigh evidence (chooseNext) must use this instead of
   *  materialising {@link prev}, whose list is corpus-sized for a common
   *  continuation ("Yes.").  One indexed COUNT, never a row materialisation. */
  prevCount(id: NodeId): number;
  /** How many DISTINCT nodes bear a continuation edge — the number of learnt
   *  contexts (the document count for inverse-document-frequency weighting in
   *  the consensus climb).  O(1) from an index; a coarse count is fine. */
  edgeSourceCount(): number;

  // ── company / concept halos (distributional synonymy) ──────────────────
  /** Pour a partner's signature into a node's halo. */
  pourHalo(id: NodeId, add: Vec): Promise<void>;
  /** Nodes whose halo resonates with `v` (the concept's siblings). */
  resonateHalo(v: Vec, k: number): Promise<Hit[]>;
  /** A node's halo, or null if it has none / too little mass. */
  halo(id: NodeId): Vec | null;
  /** Whether {@link halo} would return non-null — the EXISTENCE probe.
   *  {@link halo} decodes and normalizes the full D-element quantized row on
   *  every call; existence-only consumers (recognition's admission predicate,
   *  the search's fuse guard) must ask this instead: one row read, a mass
   *  compare, no decode. */
  hasHalo(id: NodeId): boolean;
  /** How many episode signatures were poured into `id`'s halo — the DIRECT
   *  measure of distributional evidence (each training pair pours once, so
   *  repetition counts, unlike {@link prevCount}, which counts DISTINCT
   *  contexts).  Consulted at disambiguation decision points as the tie-break
   *  behind distinct-context support: diversity of evidence outranks sheer
   *  repetition, but repetition outranks insertion-order accident.  0 when
   *  the node has no halo row. */
  haloMass(id: NodeId): number;

  // ── lifecycle ──────────────────────────────────────────────────────────
  size(): Promise<number>;
  saveSnapshot(bytes: Uint8Array): Promise<void>;
  loadSnapshot(): Promise<Uint8Array | null>;
  /** Free-form provenance metadata (e.g. training dataset name). */
  setMeta(key: string, val: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  deleteMeta(key: string): Promise<void>;
  /** Commit any deferred writes — makes metadata, edges, and node writes
   *  durable immediately.  Safe to call frequently; a no-op if nothing is
   *  pending. */
  commit(): void;

  close(): Promise<void>;
}

// ── Serialisation utilities (pure functions, no DB dependency) ───────────

const _ZERO = new Uint8Array(0);

/** Hand control back to the event loop for exactly one turn.
 *
 *  `await` on an already-resolved promise only queues a MICROTASK, and the engine
 *  drains the entire microtask queue before it runs a single MACROTASK — so
 *  micro-awaiting alone never lets a timer, an I/O completion, or any other queued
 *  macrotask run. A macrotask primitive (`setImmediate`, else `setTimeout`) does:
 *  it parks the continuation behind the loop's next iteration, after pending I/O.
 *
 *  Deliberately NOT unref'd: a caller is awaiting this promise, so the one
 *  scheduling turn is real pending work.  An unref'd wake-up let the process
 *  exit mid-`ingest` whenever the event loop had nothing else alive (a bare
 *  top-level deposit loop) — the await simply never resolved. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    const g = globalThis as unknown as {
      setImmediate?: (cb: () => void) => unknown;
      setTimeout: (cb: () => void, ms: number) => unknown;
    };
    if (g.setImmediate) g.setImmediate(resolve);
    else g.setTimeout(resolve, 0);
  });
}

/** Concatenate an array of byte arrays. */
function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The byte string a FLAT branch spans — a branch whose kids are ALL implicit
 *  single-byte leaves (ids −256…−1) is fully determined by its bytes, one per
 *  kid. Returns null when any kid is a real node. Such branches (the sliding
 *  sub-span windows, the leaf-parent chunks, the per-deposit flat root spans —
 *  the bulk of what perception explodes text into) are stored as their BYTES
 *  (1 byte per kid) in the leaf column, with a zero-length kids blob marking
 *  "derive the kid list from the bytes" — 4× smaller than int32-packed ids,
 *  and content-addressed through the same leaf index instead of a second
 *  blob-duplicating kids index. */
function flatKidsBytes(kids: NodeId[]): Uint8Array | null {
  const out = new Uint8Array(kids.length);
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k < -256 || k >= 0) return null;
    out[i] = -(k + 1);
  }
  return out;
}

/** The implicit kid list of a flat branch — the inverse of
 *  {@link flatKidsBytes}. */
export function flatBytesKids(bytes: Uint8Array): NodeId[] {
  const out = new Array<NodeId>(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = -(bytes[i] + 1);
  return out;
}

/** Pack a child-id list as little-endian int32s — 4 bytes per child, far more
 *  compact than a space-joined decimal string and trivial to read back. */
export function packKids(kids: NodeId[]): Uint8Array {
  const out = new Int32Array(kids.length);
  for (let i = 0; i < kids.length; i++) out[i] = kids[i];
  return new Uint8Array(out.buffer);
}
export function unpackKids(blob: Uint8Array): NodeId[] {
  // The BLOB may be a view at a non-multiple-of-4 byteOffset, so copy before
  // reinterpreting as int32.
  const i32 = new Int32Array(blob.slice().buffer);
  return Array.from(i32);
}

/** 32-bit FNV-1a of a byte blob — the integer content hash `idx_node_h` keys
 *  on. Collisions are resolved by verifying the stored blob, never trusted. */
function hashOf(bytes: Uint8Array): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Fast content key (FNV-1a + length). No array spread onto the call stack. */
function keyOf(bytes: Uint8Array): string {
  return hashOf(bytes).toString(16) + ":" + bytes.length;
}

/** Re-index a halo only when its mass is small or a power of two — O(log mass)
 *  writes per node instead of O(mass). */
function geometricMass(mass: number): boolean {
  return mass <= 4 || (mass & (mass - 1)) === 0;
}

// Halo accumulators are stored 2-bit quantized: the exact float32 L2 norm
// followed by D two-bit codes (sign + magnitude class) — 4 + D/4 bytes, 16×
// smaller than float32 and 4× smaller than int8, which made halo rows the
// single largest table in an episodically-trained store.
//
// Two bits is the COARSEST grain that preserves what halos are read for. A
// halo is a superposition of high-dimensional random signatures, so its
// elements are Gaussian; the four levels below are the Lloyd-Max optimal
// quantizer for a unit Gaussian (decision threshold ±0.9816σ, reconstruction
// ±0.4528σ / ±1.5104σ), whose output keeps ≥0.88 correlation with the exact
// accumulator. Every consumer is a thresholded resonance — direct cosines
// against the concept midpoint, or queries into the halo VectorDatabase whose
// stored codes are 1-bit RaBitQ anyway — and a 0.88-correlated direction moves
// none of those comparisons across the midpoint. One bit is NOT enough: a pure
// sign grid compresses cosine c to (2/π)·asin(c), which drags mid-band concept
// resonance below the midpoint and severs legitimate cross-name transfer.
// σ is derived from the stored norm (σ = norm/√D), so the codec carries no
// per-corpus state; the decoded vector is rescaled to the exact norm, keeping
// incremental pours magnitude-true.
const HALO_Q_THRESHOLD = 0.9816; // Lloyd-Max decision point, unit Gaussian
const HALO_Q_LO = 0.4528; //          reconstruction level, inner cell
const HALO_Q_HI = 1.5104; //          reconstruction level, outer cell
function haloEncode(v: Vec): Uint8Array {
  const D = v.length;
  const out = new Uint8Array(4 + ((D + 3) >> 2));
  let n2 = 0;
  for (let i = 0; i < D; i++) n2 += v[i] * v[i];
  const norm = Math.sqrt(n2);
  new DataView(out.buffer).setFloat32(0, norm, true);
  const bar = HALO_Q_THRESHOLD * (norm / Math.sqrt(D));
  for (let i = 0; i < D; i++) {
    const x = v[i];
    // bit0: sign, bit1: |x| beyond the Gaussian decision threshold.
    const code = (x > 0 ? 1 : 0) | ((x > bar || -x > bar) ? 2 : 0);
    out[4 + (i >> 2)] |= code << ((i & 3) << 1);
  }
  return out;
}
function haloDecode(blob: Uint8Array, D: number): Vec {
  const norm = new DataView(blob.buffer, blob.byteOffset, 4).getFloat32(
    0,
    true,
  );
  const out = new Float32Array(D);
  if (norm === 0) return out;
  const sigma = norm / Math.sqrt(D);
  let n2 = 0;
  for (let i = 0; i < D; i++) {
    const code = (blob[4 + (i >> 2)] >> ((i & 3) << 1)) & 3;
    const mag = (code & 2 ? HALO_Q_HI : HALO_Q_LO) * sigma;
    const x = code & 1 ? mag : -mag;
    out[i] = x;
    n2 += x * x;
  }
  // Rescale to the exact stored norm so accumulation stays magnitude-true.
  const s = norm / Math.sqrt(n2);
  for (let i = 0; i < D; i++) out[i] *= s;
  return out;
}

// ── AbstractStore: template-method base with all domain logic ────────────

/**
 * Template-method base class that contains ALL domain logic for the content-
 * addressed DAG store — caching, dedup/merge decisions, structural-compaction
 * geometric halo scheduling, buffer management.  A concrete persistence adapter
 * (e.g. {@link SQliteStore}) extends it and implements only the ~35 one-liner
 * protected abstract methods that talk to the actual storage backend.
 */
export abstract class AbstractStore implements Store {
  // ── Abstract methods — the persistence-adapter contract ────────────────

  /** Open the storage backend.  Must set `this._nextId`, `this._D`, and
   *  `this._maxGroup` from the stored state (or defaults for a fresh store). */
  protected abstract _dbOpen(): Promise<void>;
  /** Close the storage backend and release all resources. */
  protected abstract _dbClose(): void;

  // -- Transaction --
  protected abstract _dbBeginTx(): void;
  protected abstract _dbCommitTx(): void;

  // -- Node CRUD --
  protected abstract _dbInsertNode(
    id: NodeId,
    leaf: Uint8Array | null,
    kids: Uint8Array | null,
    h: number,
  ): void;
  protected abstract _dbGetNode(id: NodeId): NodeRec | null;
  protected abstract _dbFindLeaf(
    h: number,
    bytes: Uint8Array,
  ): NodeId | null;
  protected abstract _dbFindBranchByLeaf(
    h: number,
    bytes: Uint8Array,
  ): NodeId | null;
  protected abstract _dbFindBranchByKids(
    h: number,
    packed: Uint8Array,
  ): NodeId | null;

  // -- Kid (structural parent) edges --
  protected abstract _dbInsertKid(child: NodeId, parent: NodeId): void;
  protected abstract _dbGetParents(id: NodeId): NodeId[];
  /** LIMITed variant of the parent read — same statement, `LIMIT ?`.  Must
   *  NOT be implemented by materialising and slicing. */
  protected abstract _dbGetParentsFirst(id: NodeId, limit: number): NodeId[];

  // -- Containment --
  protected abstract _dbGetContainParents(child: NodeId): NodeId[];
  /** Whether a containment row exists for `child` — no blob unpack. */
  protected abstract _dbContainExists(child: NodeId): boolean;
  /** A page of stored containment parents — partial blob unpack. */
  protected abstract _dbGetContainParentsSlice(
    child: NodeId,
    offset: number,
    limit: number,
  ): NodeId[];
  /** The stored containment-parent COUNT — blob length / 4, no unpack. */
  protected abstract _dbGetContainCount(child: NodeId): number;
  /** Append containment parents for `child`.  MUST NOT re-write the child's
   *  whole stored list per call — a hot child's fan-in is corpus-sized, and a
   *  full read-modify-write per flush is quadratic over training.  Durable
   *  dedup may be DEFERRED (e.g. to a geometric merge schedule); readers
   *  dedup, so transient duplicates only cost bytes, never correctness. */
  protected abstract _dbAppendContain(
    child: NodeId,
    parents: NodeId[],
  ): void;

  // -- Continuation edges --
  protected abstract _dbInsertEdge(src: NodeId, dst: NodeId): void;
  protected abstract _dbGetNextEdges(id: NodeId): NodeId[];
  protected abstract _dbGetPrevEdges(id: NodeId): NodeId[];
  /** LIMITed variants of the two edge reads — same ORDER BY, `LIMIT ?`.
   *  These exist so a capped consumer's cost is bounded by the cap, not by
   *  the fan-out; an adapter must NOT implement them by materialising and
   *  slicing. */
  protected abstract _dbGetNextEdgesFirst(
    id: NodeId,
    limit: number,
  ): NodeId[];
  protected abstract _dbGetPrevEdgesFirst(
    id: NodeId,
    limit: number,
  ): NodeId[];
  /** Whether ANY edge already leaves `src` — one indexed point probe, used to
   *  maintain the distinct-source count incrementally. */
  protected abstract _dbEdgeSrcExists(src: NodeId): boolean;
  protected abstract _dbEdgeDistinctSrcCount(): number;

  // -- Halos (durable 2-bit quantized rows) --
  protected abstract _dbGetHalo(
    id: NodeId,
  ): { vec: Uint8Array; mass: number } | null;
  protected abstract _dbUpsertHalo(
    id: NodeId,
    encodedVec: Uint8Array,
    mass: number,
  ): void;

  // -- Meta --
  protected abstract _dbGetMeta(key: string): string | null;
  protected abstract _dbSetMeta(key: string, val: string): void;
  protected abstract _dbDeleteMeta(key: string): void;

  // -- Snapshot --
  protected abstract _dbSaveSnapshot(bytes: Uint8Array): void;
  protected abstract _dbLoadSnapshot(): Uint8Array | null;

  // -- Vector DB: content (gist) index --
  protected abstract _vecContentUpsert(
    entries: Array<{ id: NodeId; vector: Float32Array }>,
  ): void;
  protected abstract _vecContentQuery(
    v: Float32Array,
    k: number,
    ef: number,
  ): Array<{ id: number; distance: number }>;
  /** Whether `id` is already a live entry of the content index — one point
   *  query, used to recognise durably-indexed nodes across sessions (the
   *  in-memory `_indexedIds` cache starts empty on every open). */
  protected abstract _vecContentHas(id: NodeId): boolean;
  protected abstract _vecContentSize(): number;
  protected abstract _vecContentLastReads(): number;
  protected abstract _vecContentPhysicalSize(): number;
  protected abstract _vecContentClusterCount(): number;
  protected abstract _vecContentCompact(): void;
  /** Live content-index entries whose INTERNAL id is > `after`, as
   *  {ext, internal} pairs in internal-id order.  Internal ids are monotone
   *  at insert and preserved by the index's tombstone-splice compaction, so
   *  the largest internal id a scan has seen is a durable watermark for
   *  incremental maintenance ({@link compactContentIndex}). */
  protected abstract _vecContentEntriesSince(
    after: number,
  ): IterableIterator<{ ext: NodeId; internal: number }>;
  /** Every node id that carries a continuation edge (as source OR target) or
   *  a halo row — the RESONANCE-TARGET id set, sorted ascending and deduped.
   *  This is the exact keep/repair criterion of index maintenance; driving
   *  the maintenance loops from this (corpus-of-experiences-sized) set
   *  instead of probing per node turned repair from an every-node walk into
   *  a candidates-only walk. */
  protected abstract _dbEdgeOrHaloIds(): NodeId[];
  /** Remove a batch of entries from the content index by external id, under
   *  ONE storage transaction (a tombstone per implicit transaction is one WAL
   *  commit per id — the dominant cost of a bulk prune).  Idempotent per id —
   *  already-deleted or non-existent ids are skipped. */
  protected abstract _vecContentDeleteMany(ids: NodeId[]): void;

  // -- Vector DB: halo index --
  protected abstract _vecHaloUpsert(
    entries: Array<{ id: NodeId; vector: Float32Array }>,
  ): void;
  protected abstract _vecHaloQuery(
    v: Float32Array,
    k: number,
    ef: number,
  ): Array<{ id: number; distance: number }>;
  /** Live (non-tombstoned) entry count of the halo index — the denominator
   *  the tombstone-ratio compaction trigger compares physical size against. */
  protected abstract _vecHaloSize(): number;
  protected abstract _vecHaloPhysicalSize(): number;
  protected abstract _vecHaloClusterCount(): number;
  protected abstract _vecHaloCompact(): void;

  /** Derived query breadth for a partitioned index of C clusters: probe √C
   *  of them (the same √-of-the-population convention as the hub bound √N).
   *  The IVF maps ef → nprobe as ceil(ef/4), so ef = 4·⌈√C⌉ probes exactly
   *  ⌈√C⌉ clusters.  A FIXED efSearch stops scaling the moment the
   *  collection outgrows it: at 4,270 clusters the default 64 probed 16
   *  clusters (0.4%), and an exact stored match of a query routinely sat in
   *  an unprobed cluster — recall silently degraded as the store grew.  The
   *  configured efSearch remains the floor for small collections. */
  protected efFor(clusterCount: number): number {
    return Math.max(
      this.efSearch,
      4 * Math.ceil(Math.sqrt(Math.max(1, clusterCount))),
    );
  }

  // ── Config ─────────────────────────────────────────────────────────────

  protected _D: number;
  protected _maxGroup: number;
  protected readonly minHaloMass: number;
  protected readonly efSearch: number;
  protected readonly overfetch: number;
  protected readonly batchSize: number;
  protected readonly compactEveryNWrites: number;

  // ── State ──────────────────────────────────────────────────────────────

  /** Branch node ids are a dense, monotonically-increasing integer sequence
   *  (0,1,2,…). Single-byte leaves occupy the implicit negative range −256…−1.
   *  They are NEVER deleted, so the count of minted branch ids IS the next id —
   *  which doubles as the branch-node count and lets has() be an O(1) check.
   *  Set by `_dbOpen()` from the stored node count; incremented by `mintId()`. */
  protected _nextId = 0;
  protected _writtenSinceCompact = 0;
  protected closed = false;

  /** Lifecycle guard — resolved once `_dbOpen()` completes. */
  protected _ready: Promise<void> | null = null;

  // ── Caches ─────────────────────────────────────────────────────────────

  /** Exact-content dedup: content-key → node id. Intrinsic compression. */
  protected readonly _leafKey: BoundedMap<string, NodeId>;
  protected readonly _branchKey: BoundedMap<string, NodeId>;
  /** Reconstructed-bytes read cache (regenerable), keyed by node id. */
  protected readonly _bytesCache: BoundedMap<NodeId, Uint8Array>;
  /** contentLen memo — content is immutable, so entries never invalidate. */
  protected readonly _lenCache: BoundedMap<NodeId, number>;
  /** Node-record cache — avoids repeated persistence queries for shared DAG
   *  nodes.  Each record is small (a few ints + short leaf buffer). */
  protected readonly _recCache: BoundedMap<NodeId, NodeRec>;

  /** Captured-but-not-yet-indexed gists. Sized in bytes (each is D·4); a deposit
   *  links/pours a node right after interning it, so the working set is one
   *  deposit's nodes — a small budget captures ~all of it, and an eviction only
   *  means that node is reached by the DAG climb instead of by direct
   *  resonance. */
  protected _pendingGist!: BoundedMap<NodeId, Vec>;
  /** EXACT halo accumulators for the session's live pours: full-precision in
   *  memory, 2-bit on disk, so within-session accumulate-then-compare never
   *  round-trips through the quantizer. Regenerable — a miss reads the durable
   *  2-bit row. */
  protected _haloExact!: BoundedMap<NodeId, Vec>;
  /** NORMALIZED halo read cache — the decoded, normalized vector {@link halo}
   *  returns, cached by id so repeat reads skip the per-call 2-bit decode and
   *  normalize of a full D-element row (measured on a trained store: ~15K
   *  halo() calls per deep query over ~50 distinct ids — all but the first
   *  per id pure re-decode).  Point-invalidated by {@link pourHalo}, the one
   *  halo mutation site.  Callers receive a COPY, so the cached vector is
   *  never aliased.  Regenerable — a miss re-decodes the durable row. */
  protected _haloNorm!: BoundedMap<NodeId, Vec>;

  /** Interiors deliberately SKIPPED by indexSubtree (unique nodes with 1 parent
   *  that bridge nothing).  Remembered so subsequent visits prune the subtree
   *  without re-checking parent count.  LRU-bounded: an evicted entry is
   *  re-checked on next visit — if it gained parents in the meantime, it will
   *  be promoted to the index. */
  protected _coveredIds!: BoundedMap<NodeId, true>;
  /** Live content-index id set, LRU-bounded so a massive ingest never leaks
   *  memory; an evicted entry is still indexed (the row is durable), so the
   *  only cost of an eviction is a duplicate index probe on next visit. */
  protected _indexedIds!: BoundedMap<NodeId, true>;

  // ── ANN read cache ─────────────────────────────────────────────────────
  // The index is read-only between writes, so the same (v,k) always returns
  // the same neighbours.  Any index mutation (flush, delete, compact) drops
  // the cache; the next miss recreates it.  Content-addressed (vecKey), not
  // identity-addressed — same principle as perceiveMemo.

  /** ANN read cache for {@link resonate} — keyed by vecKey(v) + ":" + k;
   *  lazily initialised, dropped on any index mutation. */
  protected _resonateCache: Map<string, Hit[]> | null = null;
  /** ANN read cache for {@link resonateHalo} — same scheme. */
  protected _resonateHaloCache: Map<string, Hit[]> | null = null;

  // ── Write buffers ──────────────────────────────────────────────────────

  /** Content (gist) index write buffer. */
  protected _contentBuffer: Array<{ id: NodeId; vector: Float32Array }> = [];
  /** Halo index write buffer — keyed by id so repeats within a batch coalesce. */
  protected _haloBuffer = new Map<NodeId, Float32Array>();
  /** Containment write buffer: child → new parents, merged on flush cadence. */
  protected _containBuf = new Map<NodeId, Set<NodeId>>();

  /** Dedup-target candidates still in the write buffer (keyed by id).  Only
   *  roots that have gained an edge/halo are targets; a fresh intermediate
   *  branch is never folded onto. */
  protected _nearDedupBuf = new Map<NodeId, Float32Array>();
  /** Ids currently in `_contentBuffer` (not yet flushed) — O(1) membership. */
  protected _bufferedIds = new Set<NodeId>();

  // ── Transparent-chain cache ────────────────────────────────────────────

  /** {@link Store.chainRun} results, valid for the store's lifetime BETWEEN
   *  writes: a chain is a pure function of the kid and edge tables, so any
   *  write that could break a node's transparency (a fresh mint inserting kid
   *  rows, a link inserting an edge) drops the whole cache — see the two
   *  invalidation sites.  Regenerable; a miss re-walks. */
  protected _chainMemo!: BoundedMap<NodeId, NodeId[]>;

  // ── Edge-source-count cache ────────────────────────────────────────────

  /** Distinct edge-source count — the store's DOCUMENT COUNT (how many
   *  learnt contexts predict a continuation), the N of every
   *  inverse-document-frequency read.  −1 until first asked for; from then
   *  on maintained INCREMENTALLY by {@link link} (edges are never deleted),
   *  so a read is O(1) — never a table scan on the recall path. */
  protected _edgeSrcCount = -1;

  // ── Constructor ────────────────────────────────────────────────────────

  constructor(config: StoreConfig, D: number, maxGroup: number) {
    this._D = D;
    this._maxGroup = maxGroup;
    this.minHaloMass = config.minHaloMass;
    this.efSearch = config.efSearch;
    this.overfetch = config.overfetch;
    this.batchSize = config.batchSize;
    this.compactEveryNWrites = config.compactEveryNWrites;
    this._leafKey = new BoundedMap(config.dedupCacheMax);
    this._branchKey = new BoundedMap(config.dedupCacheMax);
    this._bytesCache = new BoundedMap(
      config.bytesCacheMax,
      (v) => v.byteLength,
      "smallest",
    );
    this._lenCache = new BoundedMap(config.bytesCacheMax, () => 16);
    this._recCache = new BoundedMap(
      config.recCacheBytes,
      (r) => (r.leaf?.byteLength ?? 0) + (r.kids?.length ?? 0) * 4 + 12,
    );
    this._pendingGist = new BoundedMap<NodeId, Vec>(
      config.pendingGistBytes,
      (v) => v.byteLength,
    );
    this._haloExact = new BoundedMap<NodeId, Vec>(
      config.haloCacheBytes,
      (v) => v.byteLength,
    );
    this._haloNorm = new BoundedMap<NodeId, Vec>(
      config.haloCacheBytes,
      (v) => v.byteLength,
    );
    this._coveredIds = new BoundedMap<NodeId, true>(
      config.coveredIdsMax,
    );
    this._indexedIds = new BoundedMap<NodeId, true>(
      config.coveredIdsMax,
    );
    this._chainMemo = new BoundedMap<NodeId, NodeId[]>(
      config.chainCacheBytes,
      (v) => v.length * 4 + 32,
    );
  }

  // ── Public accessors ───────────────────────────────────────────────────

  get D(): number {
    return this._D;
  }

  /** Await the async initialisation performed by the concrete constructor. */
  protected async _ensureReady(): Promise<void> {
    if (!this._ready) throw new Error("Store: not open");
    await this._ready;
  }

  // ── Id management ──────────────────────────────────────────────────────

  has(id: NodeId): boolean {
    // Byte leaves (negative ids) always exist.
    if (id < 0) return id >= -256;
    return Number.isInteger(id) && id >= 0 && id < this._nextId;
  }

  protected mintId(): NodeId {
    return this._nextId++;
  }

  nodeCount(): number {
    return this._nextId;
  }

  async size(): Promise<number> {
    await this._ensureReady();
    return this._nextId;
  }

  // ── DAG traversal ──────────────────────────────────────────────────────

  get(id: NodeId): NodeRec | null {
    // Byte leaves are implicit — fabricate from the id.
    if (id < 0) {
      return { id, leaf: new Uint8Array([-(id + 1)]), kids: null };
    }
    const hit = this._recCache.get(id);
    if (hit !== undefined) return hit;
    const rec = this._dbGetNode(id);
    if (rec) this._recCache.set(id, rec);
    return rec;
  }

  /** Reconstruct the bytes a node spans by traversing the DAG bottom-up.
   *  Iterative post-order on an explicit stack — the call stack never sees the
   *  tree depth, so even an adversarial chain of nodes stays safe. */
  /** How many reads hit a MISSING node record this session (a dangling edge
   *  or kid id).  Zero in a healthy store; a growing count means references
   *  outlive their records — the read degrades safely to empty bytes, this
   *  counter is what keeps that degradation observable. */
  danglingReads = 0;

  bytes(id: NodeId): Uint8Array {
    // Fast path.
    const hit = this._bytesCache.get(id);
    if (hit) return hit;

    const stack: NodeId[] = [id];
    const cache = this._bytesCache;

    while (stack.length > 0) {
      const nid = stack[stack.length - 1]; // peek

      // Already resolved by an earlier traversal.
      if (cache.get(nid)) {
        stack.pop();
        continue;
      }

      const rec = this.get(nid);
      if (!rec) {
        // A DANGLING id (an edge or kid pointing at no record) reads as
        // empty — safe (empty-bytes guards drop it from grounding) but a
        // symptom of store corruption, so count it rather than stay silent.
        // The cache makes the empty read permanent for the session; the
        // counter survives as the visible trace.
        this.danglingReads++;
        cache.set(nid, _ZERO);
        stack.pop();
        continue;
      }
      if (rec.leaf) {
        cache.set(nid, new Uint8Array(rec.leaf));
        stack.pop();
        continue;
      }

      // Branch — push any uncached children (reverse order so they resolve
      // left-to-right).  If every child is already cached, concatenate now.
      const kids = rec.kids ?? [];
      let ready = true;
      for (let i = kids.length - 1; i >= 0; i--) {
        if (!cache.get(kids[i])) {
          stack.push(kids[i]);
          ready = false;
        }
      }
      if (!ready) continue;

      stack.pop();
      const out = concat(kids.map((k) => cache.get(k)!));
      cache.set(nid, out);
    }

    return cache.get(id) ?? _ZERO;
  }

  /** First `maxLen` bytes of a node.  Walks only the leftmost branch,
   *  stopping at `maxLen` — so a 1 MB document root costs the same as a
   *  4-byte leaf.  Recursive, but tree depth is logarithmic.
   *
   *  IMMUTABILITY CONTRACT (applies to {@link bytes} too): returned arrays
   *  may be shared with the byte cache and with other callers — treat them
   *  as read-only.  Mutating one would corrupt every subsequent read. */
  bytesPrefix(id: NodeId, maxLen: number): Uint8Array {
    if (maxLen <= 0) return _ZERO;

    // A FULL read (the ALL sentinel) routes through bytes(), whose
    // reconstruction enters the byte-budget cache.  Without this, the mind's
    // read() — which always passes ALL — re-walked the DAG and re-concatenated
    // on EVERY repeated read of an uncached branch, bypassing the cache that
    // exists precisely for those reconstructions.
    if (maxLen >= 0x7fffffff) return this.bytes(id);

    // Full-cache hit: bytes() already reconstructed the whole node.
    const full = this._bytesCache.get(id);
    if (full) return full.length <= maxLen ? full : full.subarray(0, maxLen);

    const rec = this.get(id);
    if (!rec) return _ZERO;

    if (rec.leaf) {
      // Cache the (small) leaf bytes — cheap and reusable.  COPY before
      // caching: rec.leaf is the node record's own buffer, and handing it
      // out would let one mutating caller corrupt the record AND the cache
      // (bytes() makes the same copy for the same reason).
      const leaf = new Uint8Array(rec.leaf);
      this._bytesCache.set(id, leaf);
      return leaf.length <= maxLen ? leaf : leaf.subarray(0, maxLen);
    }

    // Branch — walk children left-to-right, stopping at maxLen.
    const kids = rec.kids ?? [];
    const parts: Uint8Array[] = [];
    let got = 0;
    for (const k of kids) {
      if (got >= maxLen) break;
      const child = this.bytesPrefix(k, maxLen - got);
      parts.push(child);
      got += child.length;
    }
    return concat(parts);
  }

  contentLen(id: NodeId, cap = Infinity): number {
    if (id < 0) return 1; // implicit single-byte leaf
    const hit = this._lenCache.get(id);
    if (hit !== undefined) return hit; // exact — valid under any cap
    if (cap <= 0) return 0;
    const rec = this.get(id);
    let n = 0;
    let clamped = false;
    if (rec) {
      if (rec.leaf) n = rec.leaf.length;
      else if (rec.kids) {
        for (const k of rec.kids) {
          n += this.contentLen(k, cap - n);
          if (n >= cap) {
            clamped = true; // partial sum — a lower bound, not the length
            break;
          }
        }
      }
    }
    if (!clamped) this._lenCache.set(id, n);
    return n;
  }

  // ── Content-addressed lookup ───────────────────────────────────────────

  findLeaf(bytes: Uint8Array): NodeId | null {
    if (bytes.length === 1) return -(bytes[0] + 1);
    const key = keyOf(bytes);
    const cached = this._leafKey.get(key);
    if (cached !== undefined) return cached;
    const id = this._dbFindLeaf(hashOf(bytes), bytes);
    if (id !== null) this._leafKey.set(key, id);
    return id;
  }

  findBranch(kids: NodeId[]): NodeId | null {
    const key = kids.join(",");
    const cached = this._branchKey.get(key);
    if (cached !== undefined) return cached;
    const flat = flatKidsBytes(kids);
    let id: NodeId | null;
    if (flat) {
      id = this._dbFindBranchByLeaf(hashOf(flat), flat);
    } else {
      const packed = packKids(kids);
      id = this._dbFindBranchByKids(hashOf(packed), packed);
    }
    if (id !== null && key.length <= DEDUP_KEY_MAX) {
      this._branchKey.set(key, id);
    }
    return id;
  }

  // ── Structural parents ─────────────────────────────────────────────────

  parents(id: NodeId): NodeId[] {
    return this._dbGetParents(id);
  }

  parentsFirst(id: NodeId, limit: number): NodeId[] {
    return this._dbGetParentsFirst(id, limit);
  }

  hasParents(id: NodeId): boolean {
    return this._dbGetParentsFirst(id, 1).length > 0;
  }

  chainRun(id: NodeId): readonly NodeId[] {
    const hit = this._chainMemo.get(id);
    if (hit !== undefined) return hit;
    const run = this._chainWalk(id, CHAIN_DEPTH_CAP);
    this._chainMemo.set(id, run);
    return run;
  }

  /** {@link Store.chainRun}'s walk, node at a time through the existing
   *  probes.  Adapters with a set-based query engine should override with a
   *  single server-side descent (the SQLite adapter uses a recursive CTE). */
  protected _chainWalk(id: NodeId, cap: number): NodeId[] {
    const run = [id];
    let n = id;
    while (run.length < cap) {
      if (this.hasNext(n) || this.prevCount(n) > 0) break;
      const ps = this._dbGetParentsFirst(n, 2);
      if (ps.length !== 1) break;
      n = ps[0];
      run.push(n);
    }
    return run;
  }

  // ── Containment ────────────────────────────────────────────────────────

  addContainer(child: NodeId, parent: NodeId): void {
    let set = this._containBuf.get(child);
    if (set === undefined) {
      set = new Set<NodeId>();
      this._containBuf.set(child, set);
    }
    set.add(parent);
  }

  hasContainers(child: NodeId): boolean {
    if (this._dbContainExists(child)) return true;
    const buf = this._containBuf.get(child);
    return buf !== undefined && buf.size > 0;
  }

  containersSlice(child: NodeId, offset: number, limit: number): NodeId[] {
    const out = this._dbGetContainParentsSlice(child, offset, limit);
    if (out.length >= limit) return out;
    // Buffered adds page in AFTER the stored ones.  A buffered parent that is
    // also stored may repeat across the seam; page consumers dedup by id
    // (they all carry seen-sets), so a repeat costs a skip, never an error.
    const buf = this._containBuf.get(child);
    if (!buf || buf.size === 0) return out;
    const storedCount = this._dbGetContainCount(child);
    const bufStart = Math.max(0, offset - storedCount) +
      Math.max(0, out.length - Math.max(0, storedCount - offset));
    let i = 0;
    for (const p of buf) {
      if (out.length >= limit) break;
      if (i++ < bufStart) continue;
      out.push(p);
    }
    return out;
  }

  containers(child: NodeId): NodeId[] {
    const stored = this._dbGetContainParents(child);
    const buf = this._containBuf.get(child);
    if (stored.length === 0) return buf ? [...buf] : [];
    if (!buf) return stored;
    const merged = new Set<NodeId>(stored);
    for (const p of buf) merged.add(p);
    return [...merged];
  }

  // ── Walk kids to collect implicit per-byte leaf ids ────────────────────

  private flatLeafIds(kids: NodeId[]): NodeId[] | null {
    const out: NodeId[] = [];
    const stack = [...kids].reverse();
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id < 0) {
        out.push(id);
        continue;
      }
      const rec = this.get(id);
      if (!rec) return null;
      if (rec.leaf !== null) {
        for (let i = 0; i < rec.leaf.length; i++) out.push(-(rec.leaf[i] + 1));
      } else if (rec.kids !== null) {
        for (let i = rec.kids.length - 1; i >= 0; i--) stack.push(rec.kids[i]);
      }
    }
    return out;
  }

  /** On a dedup HIT, keep the node's gist available for lazy indexing —
   *  EXACTLY when it is not already indexed.  Replaces the old id-range
   *  "recency" heuristic (id ≥ nextId − cacheWindow), which conflated an LRU
   *  entry COUNT with an id RANGE and permanently refused to index any node
   *  that first became a resonance target long after it was minted (an early
   *  interior later reused as an edge/halo-bearing deposit root was silently
   *  unreachable by resonance).  The durable index itself is the arbiter:
   *  one point query, cached in `_indexedIds` on a hit so repeats are O(1). */
  private captureIfUnindexed(id: NodeId, gist: Vec): void {
    if (this._indexedIds.has(id) || this._pendingGist.has(id)) return;
    if (this._vecContentHas(id)) {
      this._indexedIds.set(id, true);
      return;
    }
    this._pendingGist.set(id, normalize(copy(gist)));
    // A node that ALREADY bridges experiences but was never indexed (its 1→2
    // transition fired while its gist was evicted, or in a pre-transition
    // store) is promoted on this re-encounter — the recapture above is
    // exactly what makes its gist available again.  Byte leaves (negative
    // ids) never have kid rows, so skip their parent probe.
    if (id >= 0) this.promoteBridge(id);
  }

  /** If `id` structurally bridges ≥2 experiences (the post-hoc compaction
   *  criterion), promote its gist into the content index NOW — the exact
   *  moment it becomes useful for multi-experience recall.  The 1→2 parent
   *  transition fires on {@link _dbInsertKid} during mint, and nodes that
   *  were already bridges but missed indexing (gist evicted, pre-transition
   *  store) are recaptured in {@link captureIfUnindexed}.
   *
   *  A no-op when the node is already indexed or its gist is evicted from
   *  the pending cache — a future re-encounter will retry. */
  private promoteBridge(id: NodeId): void {
    // A LIMITed probe: this runs once per kid insert on the MINT hot path,
    // and a shared child's full parent set grows with the corpus.
    if (this._dbGetParentsFirst(id, 2).length < 2) return;
    this.indexGist(id, false);
  }

  // ── Core interning: dedup → near-dedup → mint ──────────────────────────

  private async intern(
    leaf: Uint8Array | null,
    kids: NodeId[] | null,
    gist: Vec,
  ): Promise<NodeId> {
    await this._ensureReady();

    // 1. Exact dedup — equal content → one id, no vector work. Primary
    //    compression mechanism, intrinsic to the store.
    //
    //    findLeaf/findBranch are the content-addressed lookups: in-memory cache
    //    first, then a durable probe that repopulates the cache on a hit.
    //    Using them here (rather than only the cache) makes dedup survive a cold
    //    cache — a resumed/checkpointed training run, or one whose dedup cache
    //    has evicted old keys, still recognises content already on disk and
    //    reuses its id instead of minting a duplicate.
    const hit = leaf !== null ? this.findLeaf(leaf) : this.findBranch(kids!);
    if (hit !== null) {
      this.captureIfUnindexed(hit, gist);
      return hit;
    }

    // 1b. Content-addressed lookup by leaf-id signature.  When the same byte
    //     sequence was stored as a flat branch (via putBranch during deposit),
    //     a branch node spanning those bytes reuses that id even when its tree
    //     structure differs — pure content addressing, same bytes → same node.
    if (kids !== null && kids.length >= 2) {
      const leafIds = this.flatLeafIds(kids);
      if (leafIds !== null) {
        const flatHit = this.findBranch(leafIds);
        if (flatHit !== null) {
          this.captureIfUnindexed(flatHit, gist);
          return flatHit;
        }
      }
    }

    const cache = leaf !== null ? this._leafKey : this._branchKey;
    const key = leaf !== null ? keyOf(leaf) : kids!.join(",");

    // 2. Near dedup — BRANCHES ONLY, against RESONANCE TARGETS only.
    //    Leaves are single bytes: exact dedup already collapses every identical
    //    leaf, and near-merging distinct leaves only corrupts bytes for no real
    //    saving. Real near-dedup compression lives in subtree (branch) fusion.
    //
    //    There is deliberately NO ANN probe of the FLUSHED index here. It used
    //    to fire for EVERY new branch that the buffer scan didn't settle — i.e.
    //    ~every interior branch, since interiors are never dedup targets —
    //    making one ANN query per branch the dominant training cost (it dwarfed
    //    perception and the index write). And it was not merely expensive but
    //    WRONG: the 1-bit RaBitQ code can rank a byte-DISTINCT branch as the
    //    nearest "target" of a fresh branch, so the fold collapsed two
    //    byte-different subtrees onto one id and corrupted exact reconstruction
    //    (02-roundtrip's random-byte streams). Real near-duplicate EXPERIENCES
    //    are caught two cheaper, exact ways instead: identical content by the
    //    exact-dedup hash-cons above, and a near-gist target still in the write
    //    buffer by the scan below.
    if (leaf === null) {
      // Near-dedup PREFILTER — the scale-aware identity bar
      // ({@link identityBar}) for THIS branch's own length, not the fixed
      // estimator floor: under the linear fold a long branch crosses
      // 1 − 1/√D while whole windows differ, and every such crossing paid a
      // full differsByOneWindow byte reconstruction.  Same final semantics
      // (the byte check below still decides identity); strictly fewer byte
      // reads.  The scan runs FIRST: the branch length (Σ kids' contentLen —
      // memoized bottom-up by the interning order itself, O(kids)) is only
      // computed once a nearest candidate actually exists, so the hot
      // no-candidate mint pays nothing.
      let best = -1;
      let bestId: NodeId | null = null;
      if (this._nearDedupBuf.size > 0) {
        const g = normalize(copy(gist));
        // Candidates are the buffered DEDUP TARGETS only — genuine whole
        // experiences (edge/halo-bearing roots) not yet flushed.
        for (const [id, vector] of this._nearDedupBuf) {
          const s = dot(g, vector);
          if (s > best) {
            best = s;
            bestId = id;
          }
        }
      }
      let blen = 0;
      if (bestId !== null) {
        for (const k of kids!) blen += this.contentLen(k);
      }
      if (
        bestId !== null &&
        best >= identityBar(this.D, this._maxGroup, blen)
      ) {
        // Scale-aware acceptance.  The cosine bar alone is scale-BLIND
        // against a scale-DEPENDENT quantity: the hierarchical fold dilutes
        // a localized difference faster than linearly in form size, so for
        // deep forms ANY fixed bar below 1 is crossed by exactly the one
        // span that distinguishes two experiences.  No inversion of the
        // deficit is trustworthy, so the bytes themselves decide: the two
        // forms must be identical except for ONE local span of at most W
        // bytes — the river window, the perception's own resolution quantum.
        const W = this._maxGroup;
        if (this.differsByOneWindow(kids!, bestId, W)) {
          if (key.length <= DEDUP_KEY_MAX) cache.set(key, bestId);
          return bestId;
        }
      }
    }

    // 3. Mint a fresh node. A FLAT branch (every kid an implicit single-byte
    //    leaf) stores its BYTES in the leaf column with a zero-length kids blob
    //    as the marker — the kid list is derived on read.
    const id = this.mintId();
    this._dbBeginTx();
    const flat = kids ? flatKidsBytes(kids) : null;
    const packed = kids && !flat ? packKids(kids) : null;
    this._dbInsertNode(
      id,
      leaf ?? flat,
      packed ?? (flat ? _ZERO : null),
      hashOf(leaf ?? flat ?? packed!),
    );
    // Reverse structural edge: each distinct child → this parent. Lets the graph
    // be climbed upward in index time, with no scan of the kids blobs.
    //
    // Populated NATURALLY here and only here — one write per child, in the SAME
    // mint that creates the node, inside the SAME deferred transaction as the
    // node row, so node and kid rows are always durable together.
    //
    // Implicit single-byte leaves get NO parent edge: a byte belongs to nearly
    // every branch, so its parent set is the corpus-sized hub the climb's
    // saturation guard discards unread.
    if (kids) {
      // Kid rows change parent counts — a child whose parent set grows from
      // one is no longer transparent, so every cached chain that hopped
      // through it is stale.  Which chains those are is unknowable without a
      // reverse index, so the WHOLE cache drops (writes come in training
      // bursts where the cache is cold anyway; queries rebuild it lazily).
      this._chainMemo.clear();
      for (const c of kids) {
        if (c < 0 && c >= -256) continue;
        this._dbInsertKid(c, id);
        // The 1→2 parent TRANSITION happens here and only here (hash-cons
        // means an existing branch never re-inserts kid rows, so parent sets
        // grow exclusively through fresh mints): the child just became a
        // structural bridge between experiences — the exact set post-hoc
        // compaction keeps — so its gist enters the reach index NOW.
        this.promoteBridge(c);
      }
    }
    if (key.length <= DEDUP_KEY_MAX) cache.set(key, id);
    if (leaf) this._bytesCache.set(id, new Uint8Array(leaf));
    else if (flat) this._bytesCache.set(id, flat);
    // Capture the gist; it is pushed into the content index lazily, the first
    // time this node becomes a resonance target (link / pourHalo). A node that
    // never does (a pure intermediate DAG node — ~99.5% of them) is never
    // indexed: it costs one persistence row, no vector-index slot and no merge probe.
    this._pendingGist.set(id, normalize(copy(gist)));
    await this.maybeFlush();
    return id;
  }

  /** Whether the byte content under `kids` and the byte content of `targetId`
   *  are identical except for ONE local span of at most `W` bytes on each side
   *  — the near dedup's byte-grain definition of a near-duplicate.  A
   *  common-prefix / common-suffix trim: whatever remains after both trims is
   *  the single differing span (substitution, insertion or deletion), and both
   *  remainders must fit the budget.  Scattered differences leave a wide
   *  middle and are rejected. */
  private differsByOneWindow(
    kids: NodeId[],
    targetId: NodeId,
    W: number,
  ): boolean {
    const a = concat(
      kids.map((k) => this.bytesPrefix(k, Number.MAX_SAFE_INTEGER)),
    );
    const b = this.bytesPrefix(targetId, a.length + W + 1);
    if (Math.abs(a.length - b.length) > W) return false;
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;
    let j = 0;
    while (j < n - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    return a.length - i - j <= W && b.length - i - j <= W;
  }

  async putLeaf(bytes: Uint8Array, gist: Vec): Promise<NodeId> {
    // Single bytes are implicit — no DB row and no eager index slot. The gist
    // is captured like any other node's and promoted into the content index
    // LAZILY, the first time the byte becomes a resonance target.
    if (bytes.length === 1) {
      const id = -(bytes[0] + 1);
      this.captureIfUnindexed(id, gist);
      return id;
    }
    return this.intern(new Uint8Array(bytes), null, gist);
  }

  async putBranch(kids: NodeId[], gist: Vec): Promise<NodeId> {
    return this.intern(null, kids, gist);
  }

  // ── Lazy content indexing ──────────────────────────────────────────────

  /** Promote a node's captured gist into the content (resonance) index, once.
   *  Called the first time a node becomes a target — i.e. from `link` (it bears
   *  or receives a continuation edge) or `pourHalo` (it gains distributional
   *  company). Idempotent: a node already indexed, or whose gist has been evicted
   *  from the bounded pending map, is a no-op.
   *
   *  `dedupTarget` marks the node a candidate the near dedup may fold a fresh
   *  near-gist branch ONTO. Only a genuine target — an edge/halo-bearing ROOT —
   *  is one; a climb-only interior is reach-indexed but never a dedup sink. */
  protected indexGist(id: NodeId, dedupTarget: boolean): void {
    if (dedupTarget && this._bufferedIds.has(id)) {
      // Still buffered (indexed this batch, not yet flushed) — a live dedup
      // candidate, recorded in O(1) with no scan of the content buffer.
      const v = this._pendingGist.get(id);
      if (v !== undefined) this._nearDedupBuf.set(id, v);
    }
    if (this._indexedIds.has(id)) return;
    const v = this._pendingGist.get(id);
    if (v === undefined) return;
    // Already durably indexed by a previous session?  A node id names its
    // content, and the gist is a pure function of the content, so the stored
    // vector can only be identical — re-buffering it would spend an encode
    // and an upsert on a guaranteed no-op.  One point query recognises this;
    // it costs ~nothing for genuinely new nodes (a miss on a covering index).
    // This is what makes a RESUMED training run replay already-deposited
    // content at read speed instead of re-upserting the recent-id window.
    if (this._vecContentHas(id)) {
      this._indexedIds.set(id, true);
      return;
    }
    this._indexedIds.set(id, true);
    this._contentBuffer.push({ id, vector: v });
    this._bufferedIds.add(id);
    // A node indexed AS a dedup target enters the candidate set immediately.
    if (dedupTarget) this._nearDedupBuf.set(id, v);
  }

  /** {@link Store.indexTarget} — the public hook for marking a deposit root a
   *  resonance target, the one target `link`/`pourHalo` do not cover. A deposit
   *  root is a genuine target (a whole experience), so it is a dedup target
   *  too. */
  indexTarget(id: NodeId): void {
    this.indexGist(id, true);
  }

  /** Index a node and its interior forms as resonance targets.  A node that
   *  gains an edge is a learnt EXPERIENCE, and the consensus climb
   *  ({@link Mind.climbAttention}) answers a query naming only a PORTION of it by
   *  resonating its SUB-REGIONS — branch nodes within the experience — and
   *  climbing their parents back to it.
   *
   *  EVERY interior branch is indexed unconditionally, and this is
   *  LOAD-BEARING: indexing only structural bridges (nodes with ≥2 parents,
   *  the post-hoc compaction criterion) was tried and REJECTED by the test
   *  suite — partial recall of an experience's interior slices, multi-topic
   *  attention, and counterfactual anchoring all resonate to SINGLE-parent
   *  interiors (13 tests fail without them).  Post-hoc structural compaction
   *  ({@link compactContentIndex}) may still remove them, but that is a
   *  storage/recall trade-off for archived stores, not a free optimisation.
   *  The store's hash-cons bounds the index by the number of DISTINCT byte
   *  patterns in the corpus — not by the number of deposits.
   *
   *  Only the ROOT is a DEDUP TARGET — the whole experience a fresh near-gist
   *  branch may legitimately fold onto.  Interior nodes are REACH-ONLY: they
   *  let a partial query resonate and climb, but a fresh branch must never
   *  merge onto an interior node of another experience.
   *
   *  Iterative explicit-queue walk: the call stack never sees tree depth. */
  protected indexSubtree(root: NodeId): void {
    // The root is the whole experience — always index as a merge target.
    this.indexGist(root, true);

    const seen = new Set<NodeId>([root]);
    const stack: NodeId[] = [root];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const kids = this.get(id)?.kids;
      if (!kids) continue; // leaf — never a resonance anchor
      const isRoot = id === root;
      // Already-indexed or already-skipped nodes PRUNE the walk — their
      // subtrees were classified in a prior call.
      if (!isRoot && (this._indexedIds.has(id) || this._coveredIds.has(id))) {
        continue;
      }
      for (const k of kids) {
        if (!seen.has(k)) {
          seen.add(k);
          stack.push(k);
        }
      }
      if (isRoot) continue;
      const g = this._pendingGist.get(id);
      if (g === undefined) {
        // Gist evicted from the bounded pending cache — the node can't be
        // indexed now.  Mark as covered so subsequent visits prune here
        // instead of re-walking the subtree (the gist won't return).
        this._coveredIds.set(id, true);
        continue;
      }
      // Index unconditionally — every interior node is a valid resonance
      // anchor for partial-query recall.  The _indexedIds cache and the
      // durable-index check in indexGist prevent duplicate indexing across
      // multiple encounters of the same shared subtree.
      this.indexGist(id, false);
    }
  }

  // ── Soft resonance ─────────────────────────────────────────────────────

  async resonate(v: Vec, k: number): Promise<Hit[]> {
    await this._ensureReady();
    // Synchronous flush of any buffered index writes: the FIRST resonance
    // after a large ingest pays that flush here, so it shows up in respond
    // latency, not ingest latency — correct behaviour, skewed attribution;
    // profile accordingly.
    this.flushContent();
    if (k <= 0) return [];

    // ANN read cache — content-addressed so a fresh Float32Array with the
    // same values still hits.  Lazy-init: null after any index write; the
    // first miss after a flush recreates it.  When voteRegions resonates
    // identical perceived sub-regions, only the first call descends the ANN.
    const rk = vecKey(v) + ":" + k;
    const cache = this._resonateCache;
    if (cache) {
      const hit = cache.get(rk);
      if (hit !== undefined) return hit;
    }

    const results = this._vecContentQuery(
      normalize(copy(v)),
      k * this.overfetch,
      this.efFor(this._vecContentClusterCount()),
    );
    const out: Hit[] = [];
    for (const r of results) {
      const id = r.id as NodeId;
      out.push({ id, score: 1 - r.distance });
      if (out.length >= k) break;
    }

    const rc = this._resonateCache ??= new Map();
    if (rc.size >= RESONATE_CACHE_MAX) rc.clear();
    rc.set(rk, out);
    return out;
  }

  indexedVectorCount(): number {
    this.flushContent();
    return this._vecContentSize();
  }

  lastResonateReads(): number {
    return this._vecContentLastReads();
  }

  // ── Content index compaction ────────────────────────────────────────────

  /** How many physical compaction attempts have failed this session.  Zero in
   *  a healthy store; a growing count means tombstones are accumulating and
   *  index query cost is drifting up (the first failure also warns once). */
  compactFailures = 0;

  /** Meta key holding the incremental scan watermark of
   *  {@link compactContentIndex}: "minParents:maxInternalIdScanned".  KEEP
   *  decisions are MONOTONE — parents, edges and halos only ever grow, so an
   *  entry once kept can never become removable — and removed entries are
   *  gone, so a pass only ever needs to examine entries indexed AFTER the
   *  previous pass.  Internal ids are monotone and survive the index's
   *  splice compaction; the watermark is reset whenever a PHYSICAL index
   *  compaction runs (id reuse after a dropped top row would otherwise hide
   *  new entries behind it). */
  protected static readonly COMPACT_WATERMARK_KEY = "contentCompact.watermark";

  /** {@link Store.compactContentIndex} */
  async compactContentIndex(minParents = 2): Promise<number> {
    await this._ensureReady();
    this.flush(); // commit any pending writes first

    // Incremental scan: resume from the last pass's watermark when its
    // minParents matches; a changed criterion forces a full rescan.
    let after = 0;
    {
      const raw = this._dbGetMeta(AbstractStore.COMPACT_WATERMARK_KEY);
      if (raw !== null) {
        const sep = raw.indexOf(":");
        const mp = Number(raw.slice(0, sep));
        const wm = Number(raw.slice(sep + 1));
        if (mp === minParents && Number.isFinite(wm) && wm > 0) after = wm;
      }
    }

    // The keep criterion "has edges or a halo" as ONE sorted id set (edge
    // sources ∪ edge targets ∪ halo rows), materialised by a single C-side
    // scan.  A binary-search membership probe replaces the three per-entry
    // point queries that made this stage minutes long on a trained store.
    const targets = this._dbEdgeOrHaloIds();
    const isTarget = (id: NodeId): boolean => {
      let lo = 0, hi = targets.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = targets[mid];
        if (v === id) return true;
        if (v < id) lo = mid + 1;
        else hi = mid - 1;
      }
      return false;
    };

    // Collect ids to remove: nodes that are structurally isolated (few
    // parents), not edge-bearing, and not halo-bearing.  These nodes are
    // unique to one experience tree — they bridge nothing and their index
    // slots are wasted.  Multi-parent nodes are the structural bridges
    // that let a partial query climb from one experience to another.
    const toRemove: NodeId[] = [];
    let scanned = 0;
    let watermark = after;
    for (const { ext: id, internal } of this._vecContentEntriesSince(after)) {
      // Yield a real event-loop turn on a fixed cadence: this scan runs over
      // every unexamined indexed entry, and point probes alone pin the
      // thread otherwise (the "frozen" symptom).
      if (++scanned % 8192 === 0) await yieldToEventLoop();
      watermark = internal;
      if (isTarget(id)) continue;
      if (this._dbGetParentsFirst(id, minParents).length >= minParents) {
        continue;
      }
      toRemove.push(id);
    }

    // Delete in batches — each batch is ONE vector-store transaction (one WAL
    // commit), with an event-loop turn between batches.
    const BATCH = 1000;
    for (let i = 0; i < toRemove.length; i += BATCH) {
      const batch = toRemove.slice(i, i + BATCH);
      this._vecContentDeleteMany(batch);
      // Purge the "already indexed" cache for removed ids: without this, a
      // node that LATER becomes a resonance target again (gains an edge or
      // halo) hits the stale cache entry in indexGist and is silently never
      // re-indexed for the rest of the session.
      for (const id of batch) this._indexedIds.delete(id);
      await yieldToEventLoop();
    }
    // Persist the scan watermark so the next pass starts where this one
    // ended (kept beside the criterion that produced it).
    this._dbBeginTx();
    this._dbSetMeta(
      AbstractStore.COMPACT_WATERMARK_KEY,
      minParents + ":" + watermark,
    );
    this._dbCommitTx();

    if (toRemove.length > 0) {
      // Compact to physically reclaim space from tombstones.
      try {
        if (this._vecContentPhysicalSize() > this._vecContentSize() * 1.5) {
          this._vecContentCompact();
          // Physical compaction may free the top internal id for reuse —
          // drop the watermark so the next pass rescans from the start.
          this._dbBeginTx();
          this._dbDeleteMeta(AbstractStore.COMPACT_WATERMARK_KEY);
          this._dbCommitTx();
        }
      } catch (e) {
        // Best-effort, but never SILENT: a persistently failing compaction
        // lets tombstones accumulate and query cost grow with no signal.
        this.compactFailures++;
        if (this.compactFailures === 1) {
          console.warn(
            "sema: content-index compaction failed (will keep " +
              "counting in store.compactFailures):",
            e,
          );
        }
      }
      // Index mutations (delete, compact) invalidate the ANN read cache.
      this._resonateCache = null;
    }

    return toRemove.length;
  }

  /** {@link Store.repairContentIndex} */
  async repairContentIndex(
    regenerateGist: (id: NodeId) => Promise<Vec | null>,
    minParents = 2,
  ): Promise<number> {
    await this._ensureReady();
    this.flush(); // commit any pending writes first

    if (this._nextId === 0) return 0;

    let added = 0;

    // A repairable node MUST carry edges or a halo, so the candidate set IS
    // the edge/halo id set — corpus-of-experiences-sized (hundreds of
    // thousands), not node-count-sized (tens of millions).  The old walk
    // visited EVERY branch id ever minted with a parent probe each; driving
    // from the target set visits only real candidates, in the same ascending
    // id order (the set is sorted), so the result and its ordering are
    // identical.  Byte leaves (negative ids) were never visited by the old
    // walk and are skipped here too.
    const targets = this._dbEdgeOrHaloIds();
    let scanned = 0;
    for (const id of targets) {
      // Yield a real event-loop turn on a fixed cadence so the scan never
      // pins the thread for its whole duration.
      if (++scanned % 8192 === 0) await yieldToEventLoop();

      if (id < 0) continue; // byte leaves: implicit, never repaired

      // Already indexed in memory — skip.
      if (this._indexedIds.has(id)) continue;

      // Must be a structural bridge: ≥ minParents parents in the DAG.
      // One LIMITed probe per candidate.
      if (this._dbGetParentsFirst(id, minParents).length < minParents) {
        continue;
      }

      // Already durably indexed by a previous session — record and skip.
      // Probed AFTER the structural filters: candidates are few, so this
      // point query runs rarely instead of once per node in the store.
      if (this._vecContentHas(id)) {
        this._indexedIds.set(id, true);
        continue;
      }

      // Regenerate the gist from bytes.  The callback is async (the Mind's
      // perception is synchronous, but the interface allows a disk-backed
      // regenerator that yields).
      const gist = await regenerateGist(id);
      if (!gist) continue;

      // Index it — same code path as indexGist, but the vector is injected
      // directly rather than read from the (empty) pending-gist cache.
      this._indexedIds.set(id, true);
      this._contentBuffer.push({ id, vector: gist });
      this._bufferedIds.add(id);
      // Repaired nodes are reach-indexed, never dedup targets: their gist is
      // regenerated (may differ numerically from the original) and they are
      // interiors, not deposit roots.
      added++;

      // Flush periodically to bound the write-transaction size and yield to
      // the event loop, same cadence compactContentIndex uses.
      if (added % 1000 === 0) await this.maybeFlush();
    }

    // Final flush for the last partial batch.
    if (added > 0) await this.maybeFlush();

    return added;
  }

  // ── Continuation edges ─────────────────────────────────────────────────

  async link(from: NodeId, to: NodeId): Promise<void> {
    await this._ensureReady();
    // Both endpoints become learnt EXPERIENCES whose whole subtree is REACH-
    // indexed, because the seat is symmetric — a query may name only a PORTION of
    // either side and must still resonate to its interior and climb to the whole.
    // Only each ROOT is a MERGE target; the interiors are reach-only.
    this.indexSubtree(from);
    this.indexSubtree(to);
    // Flush the vectors indexSubtree just added to the buffer.
    // This keeps the buffer bounded and yields to the event loop.
    await this.maybeFlush();
    this._dbBeginTx();
    // Keep the document count exact as it grows: a source gaining its FIRST
    // edge is one new learnt context.  One indexed point probe, and only once
    // the count has been materialised — before that, the lazy full count in
    // {@link edgeSourceCount} will see this edge anyway.
    if (this._edgeSrcCount >= 0 && !this._dbEdgeSrcExists(from)) {
      this._edgeSrcCount++;
    }
    // An edge breaks the transparency of both endpoints — drop cached chains
    // (same reasoning as the kid-row invalidation in put).
    this._chainMemo.clear();
    this._dbInsertEdge(from, to);
  }

  next(id: NodeId): NodeId[] {
    return this._dbGetNextEdges(id);
  }

  /** {@link Store.hasNext} — one indexed point probe, never a range read. */
  hasNext(id: NodeId): boolean {
    return this._dbEdgeSrcExists(id);
  }

  prev(id: NodeId): NodeId[] {
    return this._dbGetPrevEdges(id);
  }

  nextFirst(id: NodeId, limit: number): NodeId[] {
    return this._dbGetNextEdgesFirst(id, limit);
  }

  prevFirst(id: NodeId, limit: number): NodeId[] {
    return this._dbGetPrevEdgesFirst(id, limit);
  }

  /** {@link Store.prevCount}.  Subclasses with an indexed reverse-edge count
   *  should override; this default materialises (correct, not optimal). */
  prevCount(id: NodeId): number {
    return this._dbGetPrevEdges(id).length;
  }

  edgeSourceCount(): number {
    // Materialised once per session (edges written before this moment are
    // covered by the full count), then kept exact incrementally by link().
    // The old form re-ran a full COUNT(*) table scan on EVERY call just to
    // detect staleness — O(edges) on the recall hot path, at every IDF read.
    if (this._edgeSrcCount < 0) {
      this._edgeSrcCount = this._dbEdgeDistinctSrcCount();
    }
    return this._edgeSrcCount;
  }

  // ── Halos ──────────────────────────────────────────────────────────────

  haloMass(id: NodeId): number {
    const r = this._dbGetHalo(id);
    return r ? r.mass : 0;
  }

  halo(id: NodeId): Vec | null {
    const cached = this._haloNorm.get(id);
    if (cached !== undefined) return copy(cached);
    const r = this._dbGetHalo(id);
    if (!r || r.mass < this.minHaloMass) return null;
    const exact = this._haloExact.get(id);
    const v = normalize(exact ? copy(exact) : haloDecode(r.vec, this.D));
    this._haloNorm.set(id, v);
    return copy(v);
  }

  /** {@link Store.hasHalo} — MUST mirror {@link halo}'s null condition
   *  exactly (row present AND mass ≥ minHaloMass), minus the decode. */
  hasHalo(id: NodeId): boolean {
    const r = this._dbGetHalo(id);
    return r !== null && r.mass >= this.minHaloMass;
  }

  async pourHalo(id: NodeId, add: Vec): Promise<void> {
    await this._ensureReady();
    // A node with a halo is a genuine resonance target — the consensus climb
    // resonates a query region to it, and articulation reads its halo.
    this.indexGist(id, true);
    const r = this._dbGetHalo(id);
    const acc = this._haloExact.get(id) ??
      (r ? haloDecode(r.vec, this.D) : new Float32Array(this.D));
    addInto(acc, add);
    this._haloExact.set(id, acc);
    this._haloNorm.delete(id); // the normalized read cache is now stale
    const mass = (r?.mass ?? 0) + 1;
    this._dbBeginTx();
    this._dbUpsertHalo(id, haloEncode(acc), mass);

    // Re-index on a geometric schedule only (the exact halo is persisted).
    if (mass >= this.minHaloMass && geometricMass(mass)) {
      this._haloBuffer.set(id, normalize(copy(acc)));
      await this.maybeFlush();
    }
  }

  async resonateHalo(v: Vec, k: number): Promise<Hit[]> {
    await this._ensureReady();
    this.flushHalos();
    if (k <= 0) return [];

    // ANN read cache — same scheme as resonate's, but for the halo index.
    const rk = vecKey(v) + ":" + k;
    const cache = this._resonateHaloCache;
    if (cache) {
      const hit = cache.get(rk);
      if (hit !== undefined) return hit;
    }

    const results = this._vecHaloQuery(
      normalize(copy(v)),
      k * this.overfetch,
      this.efFor(this._vecHaloClusterCount()),
    );
    const out: Hit[] = [];
    for (const r of results) {
      const id = r.id as NodeId;
      out.push({ id, score: 1 - r.distance });
      if (out.length >= k) break;
    }

    const rhc = this._resonateHaloCache ??= new Map();
    if (rhc.size >= RESONATE_CACHE_MAX) rhc.clear();
    rhc.set(rk, out);
    return out;
  }

  // ── Buffering, flushing, compaction ────────────────────────────────────

  private pending(): number {
    return this._contentBuffer.length + this._haloBuffer.size;
  }

  protected flushContent(): number {
    if (this._contentBuffer.length === 0) return 0;
    const batch = this._contentBuffer.splice(0);
    // The merge scan only consults UNFLUSHED candidates, so clear them in
    // lockstep with the content buffer they mirror.
    this._nearDedupBuf.clear();
    this._bufferedIds.clear();
    this._vecContentUpsert(batch);
    this._resonateCache = null;
    return batch.length;
  }

  protected flushHalos(): number {
    if (this._haloBuffer.size === 0) return 0;
    const batch = [...this._haloBuffer.entries()];
    this._haloBuffer.clear();
    this._vecHaloUpsert(
      batch.map(([id, vector]) => ({ id, vector })),
    );
    this._resonateHaloCache = null;
    return batch.length;
  }

  /** Append the buffered containment pairs, inside the deferred transaction.
   *  Pure appends: durable dedup lives in the adapter (the pair PK), so a
   *  flush never reads a child's stored list back — the old packed-blob
   *  read-merge-rewrite was O(fan-in) per touched child per flush, quadratic
   *  over a long training run on a hot window. */
  protected flushContain(): void {
    if (this._containBuf.size === 0) return;
    this._dbBeginTx();
    for (const [child, set] of this._containBuf) {
      this._dbAppendContain(child, [...set]);
    }
    this._containBuf.clear();
  }

  /** Flush all three buffers; compact vector indices on a write-volume cadence. */
  protected flush(): void {
    this.flushContain();
    const written = this.flushContent() + this.flushHalos();
    // Commit the deferred write transaction on the same cadence as the vector
    // buffers, so node rows / edges / halos become durable in coalesced batches.
    this._dbCommitTx();
    if (written === 0) return;
    this._writtenSinceCompact += written;
    if (this._writtenSinceCompact >= this.compactEveryNWrites) {
      this._writtenSinceCompact = 0;
      try {
        if (this._vecContentPhysicalSize() > this._vecContentSize() * 2) {
          this._vecContentCompact();
          // Physical compaction may free the top internal id for reuse —
          // invalidate the incremental maintenance watermark.
          this._dbBeginTx();
          this._dbDeleteMeta(AbstractStore.COMPACT_WATERMARK_KEY);
          this._dbCommitTx();
        }
        if (this._vecHaloPhysicalSize() > this._vecHaloSize() * 2) {
          this._vecHaloCompact();
        }
      } catch (e) {
        // Best-effort, but never SILENT (same contract as the prune-path
        // compaction above): a persistently failing compaction lets
        // tombstones accumulate and query cost grow with no signal.
        this.compactFailures++;
        if (this.compactFailures === 1) {
          console.warn(
            "sema: vector-index compaction failed (will keep " +
              "counting in store.compactFailures):",
            e,
          );
        }
      }
    }
  }

  protected async maybeFlush(): Promise<void> {
    if (this.pending() >= this.batchSize) {
      this.flush();
      // A flush is the one HEAVY, fully-synchronous unit of the ingest path.
      // Every `await` elsewhere in ingestion resolves as a MICROTASK, which the
      // engine drains to empty before it ever services a MACROTASK — so a deposit
      // burst that only micro-awaits pins the single thread for its whole
      // duration, starving timers, pending I/O and any overlapped work. Here —
      // buffers empty, transaction committed, nothing mid-write — is the one
      // safe point to hand the event loop a real turn.
      await yieldToEventLoop();
    }
  }

  // ── Meta ───────────────────────────────────────────────────────────────

  async setMeta(key: string, val: string): Promise<void> {
    await this._ensureReady();
    this._dbBeginTx();
    this._dbSetMeta(key, val);
  }

  async getMeta(key: string): Promise<string | null> {
    await this._ensureReady();
    return this._dbGetMeta(key);
  }

  async deleteMeta(key: string): Promise<void> {
    await this._ensureReady();
    this._dbBeginTx();
    this._dbDeleteMeta(key);
  }

  // ── Snapshot ───────────────────────────────────────────────────────────

  async saveSnapshot(bytes: Uint8Array): Promise<void> {
    await this._ensureReady();
    this.flush(); // commits any open write transaction + vector buffers
    this._dbSaveSnapshot(bytes);
  }

  async loadSnapshot(): Promise<Uint8Array | null> {
    await this._ensureReady();
    return this._dbLoadSnapshot();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  commit(): void {
    this.flush();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.flush(); // commits any open write transaction + vector buffers
    this._dbClose();
  }
}
