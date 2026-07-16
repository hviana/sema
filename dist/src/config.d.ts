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
    m: number;
    efConstruction: number;
    /** Construction budget for REACH-ONLY interior gists — the ~90% of content
     *  index inserts that exist so a partial query can resonate a sub-region
     *  and climb, never as dedup targets.  Deposit roots and halo-bearing
     *  targets always build with the full `efConstruction`.  A smaller budget
     *  here is the one deliberate speed-for-quality trade in ingestion (an
     *  interior's layer-0 wiring is built from a narrower candidate beam);
     *  the recall suite (partial recall, multi-topic attention, counterfactual
     *  anchoring) is the gate for its value.  Set equal to `efConstruction`
     *  to disable the trade. */
    efConstructionInterior: number;
    efSearch: number;
    /** Compact the in-memory vector indices after this many vectors are written.
     *  Compaction rebuilds an index from its live codes to reclaim the slots left
     *  by tombstoned (updated/deleted) halo entries; pacing it on write VOLUME
     *  (not on a flush count that goes quiet during repeat-heavy training) keeps
     *  the index dense and query cost bounded. */
    compactEveryNWrites: number;
    /** Over-fetch factor for HNSW queries (ANN recall cushion). */
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
    /** Size, in MiB, of each `rabitq-hnsw` `VectorDatabase`'s memory budget
     *  (forwarded as its `cacheSizeMb`).  It is the index's SINGLE memory knob: it
     *  sizes both SQLite's page cache and the derived immutable-code LRU.  A PURE
     *  latency optimisation — the index reads codes from SQLite on demand, so its
     *  correctness and its asymptotic per-operation storage-read count are identical
     *  with the budget at 0.  Exposed so a scaling test can set it to 0 and measure
     *  the honest, cache-independent cost. */
    vectorCacheMb: number;
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
export declare const DEFAULT_CONFIG: MindConfig;
export declare function resolveConfig(opts?: Partial<MindConfig>): MindConfig;
