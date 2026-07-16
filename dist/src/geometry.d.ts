import { Sema, Space } from "./sema.js";
import { Alphabet } from "./alphabet.js";
/** The store's geometric identity bar: cosine ≥ 1 − 1/√D is the similarity at
 *  which `intern` already treats two gists as the SAME node.  Recall reuses it
 *  to accept a near-identical query, and the climb to accept a containing form —
 *  one derived constant, never a tuned threshold.  NOTE: this fixed bar is
 *  the ESTIMATOR floor of an identity claim; a whole-span claim over a span
 *  longer than the perception quantum must use the scale-aware
 *  {@link identityBar}, which converts the tolerated fraction into bytes. */
export declare function mergeThreshold(D: number): number;
/** The scale-aware IDENTITY bar for a whole-span resonance claim over a span
 *  of `len` bytes.  Under the linear fold a cosine reads "fraction of aligned
 *  shared bytes", so a FIXED cosine bar admits a byte budget that grows with
 *  the span: 1 − 1/√D over a 4·√D-byte span tolerates four whole river
 *  windows of foreign content while still claiming "near-identical".  An
 *  identity claim may tolerate at most ONE river window W — the perception
 *  quantum, the same single-window budget near-dedup's differsByOneWindow
 *  grants — so the bar is 1 − W/len, floored at mergeThreshold(D), below
 *  which the RaBitQ estimator cannot certify identity anyway.  This is the
 *  angle+magnitude form of the identity test: the ANGLE carries the shared
 *  fraction, the span's MAGNITUDE (√len, the linear fold's own norm) converts
 *  the tolerated fraction into tolerated bytes.  Derived from W, D and the
 *  span; never tuned. */
export declare function identityBar(D: number, maxGroup: number, len: number): number;
/** The reach bar: half a river quantum, derived from the fold's own geometry.
 *  A branch folds up to `maxGroup` children, so two forms that differ in ONE
 *  whole child — the smallest distinction perception can mean — sit at cosine
 *  ≈ 1 − 1/maxGroup.  Half that quantum, 1 − 1/(2·maxGroup), is closer than any
 *  single-child difference can be: a positional echo of the same content.
 *
 *  Recall uses this as its confidence floor: a query whose nearest resonant
 *  form sits below this bar is structurally unrelated to everything in the store
 *  — further than any single-child variant — and the system returns null rather
 *  than fabricate an answer from an unrelated form.  Derived, never tuned. */
export declare function reachThreshold(maxGroup: number): number;
/** The estimator's own noise floor: 1/√D — ONE standard deviation of the
 *  cosine between two independent random vectors in D dimensions (the same σ
 *  {@link significanceBar} takes three of).  It is the smallest difference in
 *  cosine that is distinguishable from the rotation-uniformised RaBitQ
 *  estimation error (see the MEASUREMENT CAVEAT above): a contrastive margin
 *  below it is quantisation noise, not evidence.  The consensus climb gates a
 *  region's vote on its discriminative margin clearing this floor — the
 *  minimal "above noise" bar, one σ, not the stricter 3σ relatedness bar.
 *  Derived, never tuned. */
export declare function estimatorNoise(D: number): number;
/** The statistical-significance bar for whole-query resonance: 3/√D.
 *  In D dimensions the expected cosine of two independent random vectors is 0
 *  with standard deviation 1/√D.  A cosine ≥ 3/√D is three standard deviations
 *  above chance — the query is statistically related to the store, not merely
 *  sharing random byte noise.  Below this bar the consensus climb (which trusts
 *  sub-region resonance) is skipped: there is no evidence the query belongs to
 *  the same distribution as the stored content.  Derived, never tuned. */
export declare function significanceBar(D: number): number;
/** The concept (halo) threshold: the cosine above which two nodes share a
 *  distributional concept.  A halo is a superposition of episode signatures in
 *  D-dimensional space, so the expected cosine between two unrelated halos is 0
 *  with standard deviation 1/√D.  The structural midpoint 0.5 separates "more
 *  similar than not" from noise; the +0.5/√D term adds one half-sigma margin
 *  that vanishes as D → ∞, accounting for the wider noise band at lower D
 *  without inventing a tuned constant.  At D=1024 this gives 0.516, within
 *  3% of 0.5 — existing behavior is preserved while threshold and D move
 *  together.  Derived, never tuned. */
export declare function conceptThreshold(D: number): number;
/** The HALF-DOMINANCE predicate: whether a part covering `partLen` of a
 *  whole of `wholeLen` covers STRICTLY more than half of it.  A span that
 *  dominates its whole can no longer discriminate the whole's own content —
 *  the one test behind liftAnswer's keep-the-frame rule, collectRegions'
 *  wrapper exclusion, and CAST's frame-depth majority (each cites this).
 *  CAST's frame-FRACTION gate is the deliberately CLOSED variant (≥ ½ is
 *  already unusable there) and stays inline where it is documented.
 *  Derived from the structural midpoint, never tuned. */
export declare function dominates(partLen: number, wholeLen: number): boolean;
/** The consensus-vote significance floor: ln(N) + 1/2, where N is the number
 *  of learnt contexts (edge sources).  A single region's IDF-weighted vote for
 *  an anchor reached through c contexts is at most ln(N/c) ≤ ln(N); the +1/2
 *  demands the pooled vote exceed what ONE maximally-specific region could
 *  contribute by half a unit — i.e. genuine corroboration beyond a lone
 *  region's echo at this corpus scale.  The ONE floor both consumers gate on:
 *  recallByResonance trusting a climb anchor, and commitVotes admitting a
 *  further point of attention.  Defined once here so the two can never
 *  drift apart.  Derived from N, never tuned. */
export declare function consensusFloor(N: number): number;
/** The coverage bar for the reach (interior) index, when vector-similarity
 *  gating is used.  Returns the concept threshold — the structural midpoint
 *  (~0.5 at D=1024) where two forms are "more similar than not."
 *
 *  Currently UNUSED in the hot training path: interior nodes are indexed
 *  unconditionally (hash-cons dedup bounds the index naturally).
 *  Post-hoc structural compaction ({@link Store.compactContentIndex})
 *  replaces runtime coverage gating with a batch pass that removes
 *  structurally-isolated entries.  Derived, never tuned. */
export declare function coverageBar(_maxGroup: number, D: number): number;
export interface Grid {
    width: number;
    height: number;
    channels: number;
    data: Uint8Array;
    dims?: number[];
}
/** Find the longest prefix of `bytes` whose leaf-id signature matches a
 *  known branch via `lookup`.  Returns the byte-length of that prefix, or 0. */
export declare function knownPrefixLength(bytes: Uint8Array, leafAt: (i: number) => number | null, lookup: (leafIds: number[]) => number | null): number;
/** Bytes → Sema tree.  `leafAt` and `lookup` are store capabilities for
 *  detecting previously-stored prefixes so the river can split at the
 *  correct boundary.  Pass them through from `perceive`; the geometry
 *  computes the stable prefix internally. */
export declare function bytesToTree(space: Space, alphabet: Alphabet, bytes: Uint8Array, leafAt?: (i: number) => number | null, lookup?: (leafIds: number[]) => number | null): Sema;
/** The PLAIN fold's full level pyramid — every level's item list, bottom
 *  (leaves) to top (root).  Left-grouped folding is RADIX-ALIGNED: the item
 *  at level L, index i, covers exactly bytes [i·mg^L, (i+1)·mg^L) whenever
 *  it is a FULL block, and a full block folds bit-identically in ANY byte
 *  string that contains it at that offset.  So a string extended by a
 *  suffix (a conversation's accumulated context) reuses every full block of
 *  its prefix's pyramid and refolds only the right edge of each level —
 *  O(suffix + depth·mg) per extension instead of O(whole), with the
 *  produced tree BIT-IDENTICAL to a from-scratch plain fold (same nodes,
 *  same FP ops; reused subtrees are shared objects, and Sema nodes are
 *  never mutated).  Purely an implementation cache: structure and numerics
 *  never depend on whether a pyramid was available. */
export interface FoldPyramid {
    levels: Array<Array<{
        tree: Sema;
        len: number;
    }>>;
    bytes: number;
}
/** Plain bytes→tree (identical to capability-less {@link bytesToTree}) that
 *  also RETURNS its pyramid, reusing `prev` — the pyramid of a PROPER
 *  prefix of `bytes` (caller guarantees content match and
 *  prev.bytes < bytes.length). */
export declare function bytesToTreePyramid(space: Space, alphabet: Alphabet, bytes: Uint8Array, prev?: FoldPyramid): {
    tree: Sema;
    pyramid: FoldPyramid;
};
export declare function hilbertBytes(grid: Grid): Uint8Array;
export declare function gridToTree(space: Space, alphabet: Alphabet, grid: Grid): Sema;
export declare function stackGrids(frames: Grid[]): Grid;
