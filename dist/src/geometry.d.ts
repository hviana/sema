import { Vec } from "./vec.js";
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
 *  This is an EQUAL-ARITY replacement law.  The two-ended coordinate frame is
 *  a bijective relabelling of the seats inside that node, so it does not change
 *  the one-child overlap or this bar.  Stability under a leading/trailing
 *  insertion comes from preserving content-defined subtrees and their anchored
 *  coordinates — never from lowering the confidence floor.
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
/** SUPERPOSITION CAPACITY — how many quasi-orthogonal terms one vector can
 *  carry before an individual term stops being readable.  `√D`.
 *
 *  A superposition of m unit signatures has ‖acc‖² ≈ m, so one term's
 *  contribution to any cosine taken against that vector is ≈ 1/m.  Setting
 *  that against the representation's own floor {@link estimatorNoise} = 1/√D:
 *
 *      1/m < 1/√D   ⟺   m > √D
 *
 *  Past √D terms a single shared constituent can no longer move a halo cosine
 *  above quantisation noise — and because the result is normalized, each extra
 *  term also shrinks every ALREADY-accepted term toward that floor.  So this is
 *  not a budget that trades accuracy for time: beyond capacity, more evidence
 *  makes the representation strictly worse.  It composes with
 *  {@link significanceBar} (3/√D) as it should — three shared units of √D is
 *  exactly the significance bar.
 *
 *  Consumer: `companyProfile` (mind/learning.ts), which sizes its constituent
 *  sketch at this capacity instead of a visit budget. */
export declare function profileCapacity(D: number): number;
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
export interface Folded {
    tree: Sema;
    /** Byte length of the subtree — carried incrementally so the stable-prefix
     *  boundary scan never re-walks subtrees (the old per-level walk was
     *  O(n log n) over the whole input). */
    len: number;
}
export interface Grid {
    width: number;
    height: number;
    channels: number;
    data: Uint8Array;
    dims?: number[];
}
export declare function contentBoundaries(space: Space, bytes: Uint8Array): number[];
/** Find the longest prefix of `bytes` whose leaf-id signature matches a
 *  known branch via `lookup`.  Returns the byte-length of that prefix, or 0. */
export declare function knownPrefixLength(bytes: Uint8Array, leafAt: (i: number) => number | null, lookup: (leafIds: number[]) => number | null): number;
/** Bytes → Sema tree.  `leafAt` and `lookup` are store capabilities for
 *  detecting previously-stored prefixes so the river can split at the
 *  correct boundary.  Pass them through from `perceive`; the geometry
 *  computes the stable prefix internally.
 *
 *  `boundaries` is the CALLER-computed stable-prefix boundary set (§10.3):
 *  strictly-increasing proper byte offsets, each the length of a prefix that
 *  is already a stored whole-stream form.  When given, the fold splits into
 *  the segments between consecutive boundaries — each folded independently,
 *  exactly as it folded when it was learned — and the segment roots join
 *  LEFT-NESTED (((s₀·s₁)·s₂)…), so every learnt cumulative-context root
 *  reappears as an identical subtree (and, by hash-consing, the very same
 *  node) inside the grown stream.  This is what lets a conversation's next
 *  turn extend perception instead of refolding it: identical prefixes
 *  produce identical subtrees regardless of what follows them. */
export declare function bytesToTree(space: Space, alphabet: Alphabet, bytes: Uint8Array, leafAt?: (i: number) => number | null, lookup?: (leafIds: number[]) => number | null, boundaries?: readonly number[]): Sema;
/** A plain content fold's reusable state: the level-0 cut edges over the whole
 *  stream and each segment's independently-folded root.  See
 *  {@link contentFoldIncremental}. */
export interface ContentFold {
    edges: number[];
    segs: Folded[];
}
/** {@link contentFoldSpan} over a WHOLE stream, reusing the segments a previous
 *  fold of a byte-identical prefix already produced.
 *
 *  WHY THIS IS SOUND, AND WHY IT NEEDS NO BOUNDARIES.  A level-0 segment is a
 *  pure function of its own bytes ({@link flatFold} reads nothing else), so
 *  reusing one whose [start,end) is unchanged is bit-identical to refolding it
 *  — the cache can never change the tree, only skip work.  And the cuts
 *  themselves are stable under APPEND: {@link contentLevels} decides each cut
 *  from a rolling hash over a local window, so bytes added at the right edge
 *  cannot move a cut to their left (measured over a growing 12-turn context:
 *  100% of prior cuts survive every append, zero tail churn).  Together those
 *  two facts are the whole optimisation — a grown stream refolds only the
 *  segments at its right edge.
 *
 *  This is the reuse the conversation path wants, and it costs NOTHING in
 *  structure: the tree is exactly the tree {@link bytesToTree} builds for the
 *  same bytes with no boundary set at all.  Turn boundaries buy prefix-ROOT
 *  identity, which is a different property from incremental reuse; conflating
 *  the two is what put an imposed boundary set on the inference path and left
 *  it folding differently from the deposits it was querying.
 *
 *  `groupByLevel` above the segments is re-run whole.  It operates on segment
 *  ROOTS (a few dozen items for a several-hundred-byte context), not on bytes,
 *  and only its right edge actually changes shape — measured at ~40 rebuilt
 *  nodes per turn, flat as the context grows sevenfold.
 *
 *  PRECONDITION — `prev` MUST have been folded over a BYTE-IDENTICAL PREFIX of
 *  `bytes`.  Reuse is keyed on a segment's [start,end) OFFSETS, which is what
 *  makes it O(1) per segment; offsets alone cannot witness that the underlying
 *  bytes agree.  Hand it a fold of DIFFERENT bytes whose cuts happen to land
 *  in the same places and it will splice those foreign segments in — measured,
 *  a deliberately mismatched `prev` produced a wrong tree on 336 of 400 random
 *  streams.  Verifying the bytes here would cost O(prefix) and defeat the
 *  whole point, so the obligation sits with the caller, and every caller
 *  discharges it structurally rather than by care: `perceiveDeposit` looks the
 *  entry up under `latin1Key(bytes.subarray(0, L))` — the prefix's own bytes
 *  ARE the cache key — and a conversation's fold state advances only by
 *  append.  A new caller that cannot make the same structural argument must
 *  pass no `prev` at all; the cold path is always correct.
 *  ({@link stablePrefixFoldIncremental} carries the identical precondition for
 *  the identical reason.) */
export declare function contentFoldIncremental(space: Space, alphabet: Alphabet, bytes: Uint8Array, prev?: ContentFold): {
    tree: Sema;
    fold: ContentFold;
};
/** A stable-prefix fold's reusable state: the segment edge offsets and each
 *  segment's independently-folded root ({@link riverFoldRaw} output).  A
 *  grown stream whose boundary set EXTENDS a previous fold's reuses every
 *  matching segment's Folded unchanged (segments fold independently by
 *  construction, so reuse is bit-identical to refolding) and folds only the
 *  new right-edge segment — O(turn) per extension.  Purely a cache: the
 *  produced tree never depends on cache state. */
export interface StableFold {
    edges: number[];
    segs: Folded[];
}
/** {@link stablePrefixFold} with incremental segment reuse — same cuts, same
 *  segment folds, same left-nested join, same single root normalize; `prev`
 *  only elides recomputing segments whose [start,end) offsets it already
 *  folded over a byte-identical prefix (the caller keys the cache by
 *  content).  Requires a non-empty effective boundary set. */
export declare function stablePrefixFoldIncremental(space: Space, alphabet: Alphabet, bytes: Uint8Array, boundaries: readonly number[], prev?: StableFold): {
    tree: Sema;
    fold: StableFold;
};
/** Plain river fold WITHOUT the final root normalize — the segment-level
 *  building block of {@link stablePrefixFold} (interiors must keep their
 *  byte-proportional magnitude; only the whole perception's root is ever
 *  normalized).  Exported so callers that COMPOSE already-existing structural
 *  parts into a hypothetical synthetic root (see {@link composeStructuralGist})
 *  can feed the same raw primitive instead of duplicating its mathematics. */
export declare function riverFoldRaw(space: Space, row: Folded[]): Folded;
/** One already-existing structural vector to compose, paired with the byte
 *  span (query-slot) length it stands in for.  `len`, not the vector's own
 *  magnitude, is what {@link composeStructuralGist} restores — the composed
 *  slot's NATURAL span, exactly as the linear river fold would carry it. */
export interface StructuralPart {
    v: Vec;
    len: number;
}
/** Synthesize a hypothetical internal structure from already-existing
 *  structural vectors — NOT from bytes.  This is the raw positional
 *  composition the linear river fold already uses (see the folding header
 *  above): each part is positionally bound into its own seat, its natural
 *  span magnitude is preserved, the parts are linearly superposed, and only
 *  the final synthetic root is normalized.  It never calls {@link gistOf}
 *  (there is no `gistOf` here — geometry.ts has no store), never perceives a
 *  concatenated byte string, and never interns or stores a new node: the
 *  result is an opaque, ungrounded Vec for an ANN probe only. */
export declare function composeStructuralGist(space: Space, parts: readonly StructuralPart[]): Vec;
export declare function hilbertBytes(grid: Grid): Uint8Array;
export declare function gridToTree(space: Space, alphabet: Alphabet, grid: Grid): Sema;
export declare function stackGrids(frames: Grid[]): Grid;
