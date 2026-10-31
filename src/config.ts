// config.ts — the single configuration interface for Sema.
// Every tunable parameter lives here. Subsystems receive their subset.

// ── Sub-interfaces (grouped by subsystem) ──

// NOTE: there is deliberately no resonance-threshold config.  The concept
// threshold is DERIVED from the geometry (see conceptThreshold(D) in
// geometry.ts) and every consumer reads it from there; a config knob for it
// existed once but was never read — a dead setting that silently did nothing.

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
  /** Near dedup at intern: a fresh branch whose bytes differ from a form a
   *  deposit learnt whole by ONE span of at most W bytes, and whose gist clears
   *  the length-aware identity bar against it, reuses that form's id — a
   *  byte-losing compression, decided the same way whatever the batch size,
   *  flush schedule or session.  On by default; `false` keeps every distinct
   *  byte sequence its own node. */
  nearDedup: boolean;
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
   *  A miss re-derives the gist from the node's stored structure, so the
   *  budget costs time only. */
  pendingGistBytes: number;
  /** Max bytes of halos kept in memory for reads (D·4 each).  A miss reads
   *  the stored halo again. */
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
  /** Max entries of the indexed-id and walked-subtree records: an indexed id
   *  skips a durable index probe, a walked subtree (one a completed
   *  `indexSubtree` walk indexed whole) is pruned.  A miss re-probes or
   *  re-walks. */
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
  /** Corpus reading (see src/mind/corpus.ts): results per call, resolved
   *  nodes climbed from, contexts requested per climb, probes used to stride
   *  the id space when browsing, bytes of each side a preview keeps, and the
   *  smallest deposited note browsing will show.  Capacities and budgets only —
   *  the one material floor (a resolved node must account for W bytes) is
   *  derived from the geometry, not declared here. */
  corpusLimitMax: number;
  corpusClimbs: number;
  corpusContextsPerClimb: number;
  corpusSampleProbes: number;
  corpusPreviewBytes: number;
  corpusSampleFloorBytes: number;
  /** Items one rationale step may ITEMISE (the whole field is still counted in
   *  the step's note).  A capacity of the rationale, not of recall: sharing
   *  `recallQueryK` meant `new Mind({recallQueryK: 100000})` un-bounded the very
   *  payload the bound exists for (found by an adversarial review). */
  rationaleSampleK: number;
  normalizeEpsilon: number;
  cosineEpsilon: number;

  geometry: GeometryConfig;
  alphabet: AlphabetConfig;
  store: StoreConfig;
}

// ── Defaults ──

export const DEFAULT_CONFIG: MindConfig = {
  seed: 42,
  recallQueryK: 12,
  haloQueryK: 12,
  rationaleSampleK: 12,
  corpusLimitMax: 24,
  corpusClimbs: 24,
  corpusContextsPerClimb: 6,
  corpusSampleProbes: 6000,
  corpusPreviewBytes: 220,
  corpusSampleFloorBytes: 12,
  normalizeEpsilon: 1e-12,
  cosineEpsilon: 1e-12,
  geometry: {
    maxGroup: 4,
  },
  alphabet: {
    roughness: 0.65,
    seedMask: 0xa1fa17,
  },
  store: {
    efSearch: 64,
    compactEveryNWrites: 50_000,
    overfetch: 4,
    batchSize: 256,
    nearDedup: true,
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
    rationaleSampleK: opts.rationaleSampleK ?? DEFAULT_CONFIG.rationaleSampleK,
    corpusLimitMax: opts.corpusLimitMax ?? DEFAULT_CONFIG.corpusLimitMax,
    corpusClimbs: opts.corpusClimbs ?? DEFAULT_CONFIG.corpusClimbs,
    corpusContextsPerClimb: opts.corpusContextsPerClimb ??
      DEFAULT_CONFIG.corpusContextsPerClimb,
    corpusSampleProbes: opts.corpusSampleProbes ??
      DEFAULT_CONFIG.corpusSampleProbes,
    corpusPreviewBytes: opts.corpusPreviewBytes ??
      DEFAULT_CONFIG.corpusPreviewBytes,
    corpusSampleFloorBytes: opts.corpusSampleFloorBytes ??
      DEFAULT_CONFIG.corpusSampleFloorBytes,
    normalizeEpsilon: opts.normalizeEpsilon ?? DEFAULT_CONFIG.normalizeEpsilon,
    cosineEpsilon: opts.cosineEpsilon ?? DEFAULT_CONFIG.cosineEpsilon,
    geometry: {
      maxGroup: opts.geometry?.maxGroup ?? DEFAULT_CONFIG.geometry.maxGroup,
    },
    alphabet: {
      roughness: opts.alphabet?.roughness ?? DEFAULT_CONFIG.alphabet.roughness,
      seedMask: opts.alphabet?.seedMask ?? DEFAULT_CONFIG.alphabet.seedMask,
    },
    store: {
      efSearch: opts.store?.efSearch ?? DEFAULT_CONFIG.store.efSearch,
      compactEveryNWrites: opts.store?.compactEveryNWrites ??
        DEFAULT_CONFIG.store.compactEveryNWrites,
      overfetch: opts.store?.overfetch ?? DEFAULT_CONFIG.store.overfetch,
      batchSize: opts.store?.batchSize ?? DEFAULT_CONFIG.store.batchSize,
      nearDedup: opts.store?.nearDedup ?? DEFAULT_CONFIG.store.nearDedup,
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
