// config.ts — the single configuration interface for Sema.
// Every tunable parameter lives here. Subsystems receive their subset.

// ── Sub-interfaces (grouped by subsystem) ──

// NOTE: there is deliberately no resonance-threshold config.  The concept
// threshold is DERIVED from the geometry (see conceptThreshold(D) in
// geometry.ts) and every consumer reads it from there; a config knob for it
// existed once but was never read — a dead setting that silently did nothing.

export interface AluConfig {
  /** Whether the ALU sub-lib contributes computation rules to the graph search.
   *  When false, no operator/operand pre-resolution runs and no ALU rule fires —
   *  thinking behaves exactly as it did before ALU existed. */
  enabled: boolean;
  /** Convergence tolerance ε for the numerical limit layer (diff/solve/exp/…). */
  tol: number;
  /** Hard iteration ceiling for any convergence loop, so a non-converging
   *  refinement still terminates. */
  maxIter: number;
  /** Decimal places a real result is rounded to before it is encoded to bytes.
   *  Determinism here is load-bearing: the search keys an output span by its
   *  bytes, so two derivations of the same value must spell it identically. */
  precision: number;
}

export interface GeometryConfig {
  /** Maximum siblings per tree fold. */
  maxGroup: number;
}

export interface AlphabetConfig {
  /** How different neighbouring byte vectors are from their coarse ancestors
   *  (0 = identical, 1 = independent). */
  roughness: number;
  /** Seed XOR mask for the alphabet's PRNG derivation. */
  seedMask: number;
}

export interface StoreConfig {
  minHaloMass: number;
  /** Query breadth of the IVF vector indices: clusters probed per query =
   *  ceil(efSearch / 4).  Inserts have no quality knob — the partitioned
   *  index routes and appends, so ingestion cost is flat by construction. */
  efSearch: number;
  /** Compact the in-memory vector indices after this many vectors are written.
   *  Compaction rebuilds an index from its live codes to reclaim the slots left
   *  by tombstoned (updated/deleted) halo entries; pacing it on write VOLUME
   *  (not on a flush count that goes quiet during repeat-heavy training) keeps
   *  the index dense and query cost bounded. */
  compactEveryNWrites: number;
  /** Over-fetch factor for vector-index queries (ANN recall cushion). */
  overfetch: number;
  /** Combined buffered-write ceiling before a flush of both vector indices
   *  (content + halo). Higher ⇒ fewer, larger flushes into the in-memory
   *  indices and fewer write-transaction commits. */
  batchSize: number;
  /** Max entries in the store's exact-content dedup map (bounds RAM on huge
   *  corpora; a miss only risks a duplicate node, never incorrectness). */
  dedupCacheMax: number;
  /** Max bytes of reconstructed content cached in memory (regenerable).
   *  Large branch nodes cost more budget than small leaves, so the cache
   *  naturally favours cheap, frequently-hit entries. */
  bytesCacheMax: number;
  /** Max bytes of node-record cache (avoids repeated SQLite lookups for
   *  shared DAG nodes).  Each record is ~30-50 bytes. */
  recCacheBytes: number;
  /** Max bytes of ingest-result cache used by {@link CachedIngest}. */
  ingestCacheBytes: number;
  /** Max bytes of captured-but-not-yet-indexed node gists (D·4 each). A node's
   *  gist enters the content index lazily, only when it first becomes a
   *  resonance target (gains a continuation edge or a halo); until then its gist
   *  waits here. A deposit links/pours a node right after interning it, so the
   *  working set is one deposit's nodes — a modest budget captures ~all of it.
   *  An eviction only means a node is reached by the structural DAG climb instead
   *  of by direct resonance — a little recall reach, never correctness. */
  pendingGistBytes: number;
  /** Max bytes of EXACT halo accumulators kept in memory (D·4 each). The
   *  durable halo row is 2-bit quantized; this cache keeps the accumulators a
   *  session is actively pouring into at full precision, so within-session
   *  accumulate-then-compare (concept formation as it happens) never
   *  round-trips through the quantizer. An eviction or a reopen reads the
   *  2-bit row — the fidelity every cross-session consumer already gets. */
  haloCacheBytes: number;
  /** Size, in MiB, of each `rabitq-ivf` `VectorDatabase`'s memory budget
   *  (forwarded as its `cacheSizeMb` — its SQLite page cache).  A PURE latency
   *  optimisation — the index reads chunk blobs from SQLite on demand, so its
   *  correctness and its per-operation storage-read count are identical with
   *  the budget at 0.  Exposed so a scaling test can set it to 0 and measure
   *  the honest, cache-independent cost. */
  vectorCacheMb: number;
  /** Size, in MiB, of the MAIN DAG database's SQLite page cache.  The node /
   *  kid / edge / contain tables serve millions of point probes per training
   *  session (content-addressed findLeaf/findBranch, parent probes, contain
   *  appends); SQLite's default cache (~2 MiB) thrashes once the DB outgrows
   *  it, so every probe pays a file read.  A PURE latency knob — correctness
   *  and result identical at any value. */
  sqliteCacheMb: number;
  /** Max entries in the skipped-interior LRU set.  Interiors that
   *  {@link Store.indexSubtree} has already visited (indexed or skipped) are
   *  remembered here so subsequent calls prune their subtrees.  Session-local
   *  (regenerable). */
  coveredIdsMax: number;
  /** Max bytes of transparent-chain runs ({@link Store.chainRun}) cached for
   *  the store's lifetime (~4 bytes per chain node).  Valid until any write
   *  could break a node's transparency (a new structural parent or a new
   *  continuation edge), when the whole cache is dropped — writes happen in
   *  training bursts, reads in read-only query phases, so the cache pays for
   *  itself exactly where it matters.  Regenerable; a miss re-walks. */
  chainCacheBytes: number;
}

// ── The one configuration interface ──

export interface MindConfig {
  seed: number;
  recallQueryK: number;
  haloQueryK: number;
  normalizeEpsilon: number;
  cosineEpsilon: number;

  alu: AluConfig;
  geometry: GeometryConfig;
  alphabet: AlphabetConfig;
  store: StoreConfig;
}

// ── Defaults ──

export const DEFAULT_CONFIG: MindConfig = {
  seed: 42,
  recallQueryK: 12,
  haloQueryK: 12,
  normalizeEpsilon: 1e-12,
  cosineEpsilon: 1e-12,
  alu: {
    enabled: true,
    tol: 1e-10,
    maxIter: 1000,
    precision: 6,
  },
  geometry: {
    maxGroup: 4,
  },
  alphabet: {
    roughness: 0.65,
    seedMask: 0xa1fa17,
  },
  store: {
    minHaloMass: 1,
    efSearch: 64,
    compactEveryNWrites: 50_000,
    overfetch: 4,
    batchSize: 256,
    dedupCacheMax: 1_000_000,
    bytesCacheMax: 20_000_000,
    recCacheBytes: 10_000_000,
    ingestCacheBytes: 50_000_000,
    pendingGistBytes: 16_000_000,
    haloCacheBytes: 16_000_000,
    vectorCacheMb: 64,
    sqliteCacheMb: 64,
    coveredIdsMax: 100_000,
    chainCacheBytes: 16_000_000,
  },
};

// ── Config resolver: partial input + defaults = full config ──

export function resolveConfig(opts: Partial<MindConfig> = {}): MindConfig {
  return {
    seed: opts.seed ?? DEFAULT_CONFIG.seed,
    recallQueryK: opts.recallQueryK ?? DEFAULT_CONFIG.recallQueryK,
    haloQueryK: opts.haloQueryK ?? DEFAULT_CONFIG.haloQueryK,
    normalizeEpsilon: opts.normalizeEpsilon ?? DEFAULT_CONFIG.normalizeEpsilon,
    cosineEpsilon: opts.cosineEpsilon ?? DEFAULT_CONFIG.cosineEpsilon,
    alu: {
      enabled: opts.alu?.enabled ?? DEFAULT_CONFIG.alu.enabled,
      tol: opts.alu?.tol ?? DEFAULT_CONFIG.alu.tol,
      maxIter: opts.alu?.maxIter ?? DEFAULT_CONFIG.alu.maxIter,
      precision: opts.alu?.precision ?? DEFAULT_CONFIG.alu.precision,
    },
    geometry: {
      maxGroup: opts.geometry?.maxGroup ?? DEFAULT_CONFIG.geometry.maxGroup,
    },
    alphabet: {
      roughness: opts.alphabet?.roughness ?? DEFAULT_CONFIG.alphabet.roughness,
      seedMask: opts.alphabet?.seedMask ?? DEFAULT_CONFIG.alphabet.seedMask,
    },
    store: {
      minHaloMass: opts.store?.minHaloMass ?? DEFAULT_CONFIG.store.minHaloMass,
      efSearch: opts.store?.efSearch ?? DEFAULT_CONFIG.store.efSearch,
      compactEveryNWrites: opts.store?.compactEveryNWrites ??
        DEFAULT_CONFIG.store.compactEveryNWrites,
      overfetch: opts.store?.overfetch ?? DEFAULT_CONFIG.store.overfetch,
      batchSize: opts.store?.batchSize ?? DEFAULT_CONFIG.store.batchSize,
      dedupCacheMax: opts.store?.dedupCacheMax ??
        DEFAULT_CONFIG.store.dedupCacheMax,
      bytesCacheMax: opts.store?.bytesCacheMax ??
        DEFAULT_CONFIG.store.bytesCacheMax,
      recCacheBytes: opts.store?.recCacheBytes ??
        DEFAULT_CONFIG.store.recCacheBytes,
      ingestCacheBytes: opts.store?.ingestCacheBytes ??
        DEFAULT_CONFIG.store.ingestCacheBytes,
      pendingGistBytes: opts.store?.pendingGistBytes ??
        DEFAULT_CONFIG.store.pendingGistBytes,
      haloCacheBytes: opts.store?.haloCacheBytes ??
        DEFAULT_CONFIG.store.haloCacheBytes,
      vectorCacheMb: opts.store?.vectorCacheMb ??
        DEFAULT_CONFIG.store.vectorCacheMb,
      sqliteCacheMb: opts.store?.sqliteCacheMb ??
        DEFAULT_CONFIG.store.sqliteCacheMb,
      coveredIdsMax: opts.store?.coveredIdsMax ??
        DEFAULT_CONFIG.store.coveredIdsMax,
      chainCacheBytes: opts.store?.chainCacheBytes ??
        DEFAULT_CONFIG.store.chainCacheBytes,
    },
  };
}
