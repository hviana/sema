import { Vec } from "./vec.js";
import { type StoreConfig } from "./config.js";
/** A node id: a dense, non-negative integer assigned in creation order. */
export type NodeId = number;
/** A node in the graph. Exactly one of `leaf` / `kids` is set. */
export interface NodeRec {
  id: NodeId;
  leaf: Uint8Array | null;
  kids: NodeId[] | null;
}
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
export declare class BoundedMap<K, V> {
  readonly maxBytes: number;
  private readonly sizeOf;
  private readonly evict;
  private m;
  private _bytes;
  private _cursor;
  private _candidates;
  constructor(maxBytes: number, sizeOf?: (v: V) => number, evict?: Evict);
  /** Next key in insertion (≈ LRU) order, resuming where the last call left
   *  off; wraps to the front when exhausted. Undefined only when empty. */
  private nextOldest;
  get(k: K): V | undefined;
  /** Membership without touching LRU order — a pure peek, for callers that only
   *  need "is this key present?" and must not promote it to most-recent. */
  has(k: K): boolean;
  set(k: K, v: V): void;
  get size(): number;
  get bytes(): number;
  /** Remove one entry (point invalidation), with byte accounting. */
  delete(k: K): void;
  /** Drop every entry (bulk invalidation) — O(1) amortised via fresh maps. */
  clear(): void;
}
export interface Store {
  readonly D: number;
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
/** The implicit kid list of a flat branch — the inverse of
 *  {@link flatKidsBytes}. */
export declare function flatBytesKids(bytes: Uint8Array): NodeId[];
/** Pack a child-id list as little-endian int32s — 4 bytes per child, far more
 *  compact than a space-joined decimal string and trivial to read back. */
export declare function packKids(kids: NodeId[]): Uint8Array;
export declare function unpackKids(blob: Uint8Array): NodeId[];
/**
 * Template-method base class that contains ALL domain logic for the content-
 * addressed DAG store — caching, dedup/merge decisions, structural-compaction
 * geometric halo scheduling, buffer management.  A concrete persistence adapter
 * (e.g. {@link SQliteStore}) extends it and implements only the ~35 one-liner
 * protected abstract methods that talk to the actual storage backend.
 */
export declare abstract class AbstractStore implements Store {
  /** Open the storage backend.  Must set `this._nextId`, `this._D`, and
   *  `this._maxGroup` from the stored state (or defaults for a fresh store). */
  protected abstract _dbOpen(): Promise<void>;
  /** Close the storage backend and release all resources. */
  protected abstract _dbClose(): void;
  protected abstract _dbBeginTx(): void;
  protected abstract _dbCommitTx(): void;
  protected abstract _dbInsertNode(
    id: NodeId,
    leaf: Uint8Array | null,
    kids: Uint8Array | null,
    h: number,
  ): void;
  protected abstract _dbGetNode(id: NodeId): NodeRec | null;
  protected abstract _dbFindLeaf(h: number, bytes: Uint8Array): NodeId | null;
  protected abstract _dbFindBranchByLeaf(
    h: number,
    bytes: Uint8Array,
  ): NodeId | null;
  protected abstract _dbFindBranchByKids(
    h: number,
    packed: Uint8Array,
  ): NodeId | null;
  protected abstract _dbInsertKid(child: NodeId, parent: NodeId): void;
  protected abstract _dbGetParents(id: NodeId): NodeId[];
  /** LIMITed variant of the parent read — same statement, `LIMIT ?`.  Must
   *  NOT be implemented by materialising and slicing. */
  protected abstract _dbGetParentsFirst(id: NodeId, limit: number): NodeId[];
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
  protected abstract _dbAppendContain(child: NodeId, parents: NodeId[]): void;
  protected abstract _dbInsertEdge(src: NodeId, dst: NodeId): void;
  protected abstract _dbGetNextEdges(id: NodeId): NodeId[];
  protected abstract _dbGetPrevEdges(id: NodeId): NodeId[];
  /** LIMITed variants of the two edge reads — same ORDER BY, `LIMIT ?`.
   *  These exist so a capped consumer's cost is bounded by the cap, not by
   *  the fan-out; an adapter must NOT implement them by materialising and
   *  slicing. */
  protected abstract _dbGetNextEdgesFirst(id: NodeId, limit: number): NodeId[];
  protected abstract _dbGetPrevEdgesFirst(id: NodeId, limit: number): NodeId[];
  /** Whether ANY edge already leaves `src` — one indexed point probe, used to
   *  maintain the distinct-source count incrementally. */
  protected abstract _dbEdgeSrcExists(src: NodeId): boolean;
  protected abstract _dbEdgeDistinctSrcCount(): number;
  protected abstract _dbGetHalo(id: NodeId): {
    vec: Uint8Array;
    mass: number;
  } | null;
  protected abstract _dbUpsertHalo(
    id: NodeId,
    encodedVec: Uint8Array,
    mass: number,
  ): void;
  protected abstract _dbGetMeta(key: string): string | null;
  protected abstract _dbSetMeta(key: string, val: string): void;
  protected abstract _dbDeleteMeta(key: string): void;
  protected abstract _dbSaveSnapshot(bytes: Uint8Array): void;
  protected abstract _dbLoadSnapshot(): Uint8Array | null;
  protected abstract _vecContentUpsert(
    entries: Array<{
      id: NodeId;
      vector: Float32Array;
      ef?: number;
    }>,
  ): void;
  protected abstract _vecContentQuery(
    v: Float32Array,
    k: number,
    ef: number,
  ): Array<{
    id: number;
    distance: number;
  }>;
  /** Whether `id` is already a live entry of the content index — one point
   *  query, used to recognise durably-indexed nodes across sessions (the
   *  in-memory `_indexedIds` cache starts empty on every open). */
  protected abstract _vecContentHas(id: NodeId): boolean;
  protected abstract _vecContentSize(): number;
  protected abstract _vecContentLastReads(): number;
  protected abstract _vecContentPhysicalSize(): number;
  protected abstract _vecContentCompact(): void;
  /** Live content-index entries whose INTERNAL id is > `after`, as
   *  {ext, internal} pairs in internal-id order.  Internal ids are monotone
   *  at insert and preserved by the index's tombstone-splice compaction, so
   *  the largest internal id a scan has seen is a durable watermark for
   *  incremental maintenance ({@link compactContentIndex}). */
  protected abstract _vecContentEntriesSince(after: number): IterableIterator<{
    ext: NodeId;
    internal: number;
  }>;
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
  protected abstract _vecHaloUpsert(
    entries: Array<{
      id: NodeId;
      vector: Float32Array;
    }>,
  ): void;
  protected abstract _vecHaloQuery(
    v: Float32Array,
    k: number,
    ef: number,
  ): Array<{
    id: number;
    distance: number;
  }>;
  /** Live (non-tombstoned) entry count of the halo index — the denominator
   *  the tombstone-ratio compaction trigger compares physical size against. */
  protected abstract _vecHaloSize(): number;
  protected abstract _vecHaloPhysicalSize(): number;
  protected abstract _vecHaloCompact(): void;
  protected _D: number;
  protected _maxGroup: number;
  protected readonly minHaloMass: number;
  protected readonly efSearch: number;
  protected readonly m: number;
  protected readonly efConstruction: number;
  protected readonly efConstructionInterior: number;
  protected readonly overfetch: number;
  protected readonly batchSize: number;
  protected readonly compactEveryNWrites: number;
  /** Branch node ids are a dense, monotonically-increasing integer sequence
   *  (0,1,2,…). Single-byte leaves occupy the implicit negative range −256…−1.
   *  They are NEVER deleted, so the count of minted branch ids IS the next id —
   *  which doubles as the branch-node count and lets has() be an O(1) check.
   *  Set by `_dbOpen()` from the stored node count; incremented by `mintId()`. */
  protected _nextId: number;
  protected _writtenSinceCompact: number;
  protected closed: boolean;
  /** Lifecycle guard — resolved once `_dbOpen()` completes. */
  protected _ready: Promise<void> | null;
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
  protected _pendingGist: BoundedMap<NodeId, Vec>;
  /** EXACT halo accumulators for the session's live pours: full-precision in
   *  memory, 2-bit on disk, so within-session accumulate-then-compare never
   *  round-trips through the quantizer. Regenerable — a miss reads the durable
   *  2-bit row. */
  protected _haloExact: BoundedMap<NodeId, Vec>;
  /** NORMALIZED halo read cache — the decoded, normalized vector {@link halo}
   *  returns, cached by id so repeat reads skip the per-call 2-bit decode and
   *  normalize of a full D-element row (measured on a trained store: ~15K
   *  halo() calls per deep query over ~50 distinct ids — all but the first
   *  per id pure re-decode).  Point-invalidated by {@link pourHalo}, the one
   *  halo mutation site.  Callers receive a COPY, so the cached vector is
   *  never aliased.  Regenerable — a miss re-decodes the durable row. */
  protected _haloNorm: BoundedMap<NodeId, Vec>;
  /** Interiors deliberately SKIPPED by indexSubtree (unique nodes with 1 parent
   *  that bridge nothing).  Remembered so subsequent visits prune the subtree
   *  without re-checking parent count.  LRU-bounded: an evicted entry is
   *  re-checked on next visit — if it gained parents in the meantime, it will
   *  be promoted to the index. */
  protected _coveredIds: BoundedMap<NodeId, true>;
  /** Live content-index id set, LRU-bounded so a massive ingest never leaks
   *  memory; an evicted entry is still indexed (the row is durable), so the
   *  only cost of an eviction is a duplicate HNSW probe on next visit. */
  protected _indexedIds: BoundedMap<NodeId, true>;
  /** ANN read cache for {@link resonate} — keyed by vecKey(v) + ":" + k;
   *  lazily initialised, dropped on any index mutation. */
  protected _resonateCache: Map<string, Hit[]> | null;
  /** ANN read cache for {@link resonateHalo} — same scheme. */
  protected _resonateHaloCache: Map<string, Hit[]> | null;
  /** Content (gist) index write buffer.  `ef` is the per-entry HNSW
   *  construction budget: reach-only interiors carry the reduced
   *  `efConstructionInterior`; dedup targets omit it (full budget). */
  protected _contentBuffer: Array<{
    id: NodeId;
    vector: Float32Array;
    ef?: number;
  }>;
  /** Halo index write buffer — keyed by id so repeats within a batch coalesce. */
  protected _haloBuffer: Map<number, Float32Array<ArrayBufferLike>>;
  /** Containment write buffer: child → new parents, merged on flush cadence. */
  protected _containBuf: Map<number, Set<number>>;
  /** Dedup-target candidates still in the write buffer (keyed by id).  Only
   *  roots that have gained an edge/halo are targets; a fresh intermediate
   *  branch is never folded onto. */
  protected _nearDedupBuf: Map<number, Float32Array<ArrayBufferLike>>;
  /** Ids currently in `_contentBuffer` (not yet flushed) — O(1) membership. */
  protected _bufferedIds: Set<number>;
  /** {@link Store.chainRun} results, valid for the store's lifetime BETWEEN
   *  writes: a chain is a pure function of the kid and edge tables, so any
   *  write that could break a node's transparency (a fresh mint inserting kid
   *  rows, a link inserting an edge) drops the whole cache — see the two
   *  invalidation sites.  Regenerable; a miss re-walks. */
  protected _chainMemo: BoundedMap<NodeId, NodeId[]>;
  /** Distinct edge-source count — the store's DOCUMENT COUNT (how many
   *  learnt contexts predict a continuation), the N of every
   *  inverse-document-frequency read.  −1 until first asked for; from then
   *  on maintained INCREMENTALLY by {@link link} (edges are never deleted),
   *  so a read is O(1) — never a table scan on the recall path. */
  protected _edgeSrcCount: number;
  constructor(config: StoreConfig, D: number, maxGroup: number);
  get D(): number;
  /** Await the async initialisation performed by the concrete constructor. */
  protected _ensureReady(): Promise<void>;
  has(id: NodeId): boolean;
  protected mintId(): NodeId;
  nodeCount(): number;
  size(): Promise<number>;
  get(id: NodeId): NodeRec | null;
  /** Reconstruct the bytes a node spans by traversing the DAG bottom-up.
   *  Iterative post-order on an explicit stack — the call stack never sees the
   *  tree depth, so even an adversarial chain of nodes stays safe. */
  /** How many reads hit a MISSING node record this session (a dangling edge
   *  or kid id).  Zero in a healthy store; a growing count means references
   *  outlive their records — the read degrades safely to empty bytes, this
   *  counter is what keeps that degradation observable. */
  danglingReads: number;
  bytes(id: NodeId): Uint8Array;
  /** First `maxLen` bytes of a node.  Walks only the leftmost branch,
   *  stopping at `maxLen` — so a 1 MB document root costs the same as a
   *  4-byte leaf.  Recursive, but tree depth is logarithmic.
   *
   *  IMMUTABILITY CONTRACT (applies to {@link bytes} too): returned arrays
   *  may be shared with the byte cache and with other callers — treat them
   *  as read-only.  Mutating one would corrupt every subsequent read. */
  bytesPrefix(id: NodeId, maxLen: number): Uint8Array;
  contentLen(id: NodeId, cap?: number): number;
  findLeaf(bytes: Uint8Array): NodeId | null;
  findBranch(kids: NodeId[]): NodeId | null;
  parents(id: NodeId): NodeId[];
  parentsFirst(id: NodeId, limit: number): NodeId[];
  hasParents(id: NodeId): boolean;
  chainRun(id: NodeId): readonly NodeId[];
  /** {@link Store.chainRun}'s walk, node at a time through the existing
   *  probes.  Adapters with a set-based query engine should override with a
   *  single server-side descent (the SQLite adapter uses a recursive CTE). */
  protected _chainWalk(id: NodeId, cap: number): NodeId[];
  addContainer(child: NodeId, parent: NodeId): void;
  hasContainers(child: NodeId): boolean;
  containersSlice(child: NodeId, offset: number, limit: number): NodeId[];
  containers(child: NodeId): NodeId[];
  private flatLeafIds;
  /** On a dedup HIT, keep the node's gist available for lazy indexing —
   *  EXACTLY when it is not already indexed.  Replaces the old id-range
   *  "recency" heuristic (id ≥ nextId − cacheWindow), which conflated an LRU
   *  entry COUNT with an id RANGE and permanently refused to index any node
   *  that first became a resonance target long after it was minted (an early
   *  interior later reused as an edge/halo-bearing deposit root was silently
   *  unreachable by resonance).  The durable index itself is the arbiter:
   *  one point query, cached in `_indexedIds` on a hit so repeats are O(1). */
  private captureIfUnindexed;
  /** If `id` structurally bridges ≥2 experiences (the post-hoc compaction
   *  criterion), promote its gist into the content index NOW — the exact
   *  moment it becomes useful for multi-experience recall.  The 1→2 parent
   *  transition fires on {@link _dbInsertKid} during mint, and nodes that
   *  were already bridges but missed indexing (gist evicted, pre-transition
   *  store) are recaptured in {@link captureIfUnindexed}.
   *
   *  A no-op when the node is already indexed or its gist is evicted from
   *  the pending cache — a future re-encounter will retry. */
  private promoteBridge;
  private intern;
  /** Whether the byte content under `kids` and the byte content of `targetId`
   *  are identical except for ONE local span of at most `W` bytes on each side
   *  — the near dedup's byte-grain definition of a near-duplicate.  A
   *  common-prefix / common-suffix trim: whatever remains after both trims is
   *  the single differing span (substitution, insertion or deletion), and both
   *  remainders must fit the budget.  Scattered differences leave a wide
   *  middle and are rejected. */
  private differsByOneWindow;
  putLeaf(bytes: Uint8Array, gist: Vec): Promise<NodeId>;
  putBranch(kids: NodeId[], gist: Vec): Promise<NodeId>;
  /** Promote a node's captured gist into the content (resonance) index, once.
   *  Called the first time a node becomes a target — i.e. from `link` (it bears
   *  or receives a continuation edge) or `pourHalo` (it gains distributional
   *  company). Idempotent: a node already indexed, or whose gist has been evicted
   *  from the bounded pending map, is a no-op.
   *
   *  `dedupTarget` marks the node a candidate the near dedup may fold a fresh
   *  near-gist branch ONTO. Only a genuine target — an edge/halo-bearing ROOT —
   *  is one; a climb-only interior is reach-indexed but never a dedup sink. */
  protected indexGist(id: NodeId, dedupTarget: boolean): void;
  /** {@link Store.indexTarget} — the public hook for marking a deposit root a
   *  resonance target, the one target `link`/`pourHalo` do not cover. A deposit
   *  root is a genuine target (a whole experience), so it is a dedup target
   *  too. */
  indexTarget(id: NodeId): void;
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
  protected indexSubtree(root: NodeId): void;
  resonate(v: Vec, k: number): Promise<Hit[]>;
  indexedVectorCount(): number;
  lastResonateReads(): number;
  /** How many physical compaction attempts have failed this session.  Zero in
   *  a healthy store; a growing count means tombstones are accumulating and
   *  index query cost is drifting up (the first failure also warns once). */
  compactFailures: number;
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
  compactContentIndex(minParents?: number): Promise<number>;
  /** {@link Store.repairContentIndex} */
  repairContentIndex(
    regenerateGist: (id: NodeId) => Promise<Vec | null>,
    minParents?: number,
  ): Promise<number>;
  link(from: NodeId, to: NodeId): Promise<void>;
  next(id: NodeId): NodeId[];
  /** {@link Store.hasNext} — one indexed point probe, never a range read. */
  hasNext(id: NodeId): boolean;
  prev(id: NodeId): NodeId[];
  nextFirst(id: NodeId, limit: number): NodeId[];
  prevFirst(id: NodeId, limit: number): NodeId[];
  /** {@link Store.prevCount}.  Subclasses with an indexed reverse-edge count
   *  should override; this default materialises (correct, not optimal). */
  prevCount(id: NodeId): number;
  edgeSourceCount(): number;
  haloMass(id: NodeId): number;
  halo(id: NodeId): Vec | null;
  /** {@link Store.hasHalo} — MUST mirror {@link halo}'s null condition
   *  exactly (row present AND mass ≥ minHaloMass), minus the decode. */
  hasHalo(id: NodeId): boolean;
  pourHalo(id: NodeId, add: Vec): Promise<void>;
  resonateHalo(v: Vec, k: number): Promise<Hit[]>;
  private pending;
  protected flushContent(): number;
  protected flushHalos(): number;
  /** Append the buffered containment pairs, inside the deferred transaction.
   *  Pure appends: durable dedup lives in the adapter (the pair PK), so a
   *  flush never reads a child's stored list back — the old packed-blob
   *  read-merge-rewrite was O(fan-in) per touched child per flush, quadratic
   *  over a long training run on a hot window. */
  protected flushContain(): void;
  /** Flush all three buffers; compact vector indices on a write-volume cadence. */
  protected flush(): void;
  protected maybeFlush(): Promise<void>;
  setMeta(key: string, val: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  deleteMeta(key: string): Promise<void>;
  saveSnapshot(bytes: Uint8Array): Promise<void>;
  loadSnapshot(): Promise<Uint8Array | null>;
  commit(): void;
  close(): Promise<void>;
}
