// geometry.ts — every modality is a stream; geometry is only a reading order.
//
//   1. Each byte is a leaf — an atom carrying its own vector straight from
//      the alphabet.
//   2. The river folds leaves upward in fixed-size groups (maxGroup).  Items
//      that cross the stable-prefix boundary are split so the prefix folds
//      identically regardless of what follows — pure structural stability.
//   3. The same rule recurses level after level until one root remains.

import { addInto, copy, normalize, Vec, zeros } from "./vec.js";
import { Sema, sema, Space } from "./sema.js";
import { Alphabet } from "./alphabet.js";

// ---- geometric constants ----
//
// Every threshold below is a derived function of the fold's own geometry —
// dimension D, maxGroup, etc. — never a tuned magic number.  They live here
// (not in a config file) because they follow from the structure itself.
//
// MEASUREMENT CAVEAT: these thresholds are compared against RaBitQ-ESTIMATED
// cosines (1-bit stored codes scored against a 4-bit-quantized query; the
// index never reranks with exact vectors).  The derivations assume an exact
// cosine; the estimator adds a small, rotation-uniformised error the bars do
// not model.  This is benign for the inequality thresholds (they gate broad
// regions), but it means NO decision may treat an estimated score as exact —
// identity in particular is decided by content-addressed resolve(), never by
// `score >= 1` (see recallByResonance tier 0).

/** The store's geometric identity bar: cosine ≥ 1 − 1/√D is the similarity at
 *  which `intern` already treats two gists as the SAME node.  Recall reuses it
 *  to accept a near-identical query, and the climb to accept a containing form —
 *  one derived constant, never a tuned threshold.  NOTE: this fixed bar is
 *  the ESTIMATOR floor of an identity claim; a whole-span claim over a span
 *  longer than the perception quantum must use the scale-aware
 *  {@link identityBar}, which converts the tolerated fraction into bytes. */
export function mergeThreshold(D: number): number {
  return 1 - 1 / Math.sqrt(D);
}

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
export function identityBar(D: number, maxGroup: number, len: number): number {
  return Math.max(mergeThreshold(D), 1 - maxGroup / Math.max(1, len));
}

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
export function reachThreshold(maxGroup: number): number {
  return 1 - 1 / (2 * maxGroup);
}

/** The estimator's own noise floor: 1/√D — ONE standard deviation of the
 *  cosine between two independent random vectors in D dimensions (the same σ
 *  {@link significanceBar} takes three of).  It is the smallest difference in
 *  cosine that is distinguishable from the rotation-uniformised RaBitQ
 *  estimation error (see the MEASUREMENT CAVEAT above): a contrastive margin
 *  below it is quantisation noise, not evidence.  The consensus climb gates a
 *  region's vote on its discriminative margin clearing this floor — the
 *  minimal "above noise" bar, one σ, not the stricter 3σ relatedness bar.
 *  Derived, never tuned. */
export function estimatorNoise(D: number): number {
  return 1 / Math.sqrt(D);
}

/** The statistical-significance bar for whole-query resonance: 3/√D.
 *  In D dimensions the expected cosine of two independent random vectors is 0
 *  with standard deviation 1/√D.  A cosine ≥ 3/√D is three standard deviations
 *  above chance — the query is statistically related to the store, not merely
 *  sharing random byte noise.  Below this bar the consensus climb (which trusts
 *  sub-region resonance) is skipped: there is no evidence the query belongs to
 *  the same distribution as the stored content.  Derived, never tuned. */
export function significanceBar(D: number): number {
  return 3 / Math.sqrt(D);
}

/** The concept (halo) threshold: the cosine above which two nodes share a
 *  distributional concept.  A halo is a superposition of episode signatures in
 *  D-dimensional space, so the expected cosine between two unrelated halos is 0
 *  with standard deviation 1/√D.  The structural midpoint 0.5 separates "more
 *  similar than not" from noise; the +0.5/√D term adds one half-sigma margin
 *  that vanishes as D → ∞, accounting for the wider noise band at lower D
 *  without inventing a tuned constant.  At D=1024 this gives 0.516, within
 *  3% of 0.5 — existing behavior is preserved while threshold and D move
 *  together.  Derived, never tuned. */
export function conceptThreshold(D: number): number {
  return 0.5 + 0.5 / Math.sqrt(D);
}

/** The HALF-DOMINANCE predicate: whether a part covering `partLen` of a
 *  whole of `wholeLen` covers STRICTLY more than half of it.  A span that
 *  dominates its whole can no longer discriminate the whole's own content —
 *  the one test behind liftAnswer's keep-the-frame rule, collectRegions'
 *  wrapper exclusion, and CAST's frame-depth majority (each cites this).
 *  CAST's frame-FRACTION gate is the deliberately CLOSED variant (≥ ½ is
 *  already unusable there) and stays inline where it is documented.
 *  Derived from the structural midpoint, never tuned. */
export function dominates(partLen: number, wholeLen: number): boolean {
  return partLen * 2 > wholeLen;
}

/** The consensus-vote significance floor: ln(N) + 1/2, where N is the number
 *  of learnt contexts (edge sources).  A single region's IDF-weighted vote for
 *  an anchor reached through c contexts is at most ln(N/c) ≤ ln(N); the +1/2
 *  demands the pooled vote exceed what ONE maximally-specific region could
 *  contribute by half a unit — i.e. genuine corroboration beyond a lone
 *  region's echo at this corpus scale.  The ONE floor both consumers gate on:
 *  recallByResonance trusting a climb anchor, and commitVotes admitting a
 *  further point of attention.  Defined once here so the two can never
 *  drift apart.  Derived from N, never tuned. */
export function consensusFloor(N: number): number {
  return Math.log(N) + 1 / 2;
}

/** The coverage bar for the reach (interior) index, when vector-similarity
 *  gating is used.  Returns the concept threshold — the structural midpoint
 *  (~0.5 at D=1024) where two forms are "more similar than not."
 *
 *  Currently UNUSED in the hot training path: interior nodes are indexed
 *  unconditionally (hash-cons dedup bounds the index naturally).
 *  Post-hoc structural compaction ({@link Store.compactContentIndex})
 *  replaces runtime coverage gating with a batch pass that removes
 *  structurally-isolated entries.  Derived, never tuned. */
export function coverageBar(_maxGroup: number, D: number): number {
  return conceptThreshold(D);
}

// ---- types ----

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

// ---- folding ----
//
// The river fold is a hierarchical prefix network: each level contracts
// groups of `maxGroup` adjacent items into one via permute-then-add
// (positional seat binding), recursing until one root remains.
//
// FLAT per-level fold — one inline loop per level (foldSlice): no per-group
// function calls, no Array.slice per group, the permute and add FUSED
// (`gist[d] += v[seat[d]]`, no scratch buffer), and subtree byte lengths
// carried incrementally on Folded (the old boundary scan re-walked subtrees
// every level — O(n log n)).  The per-level SUPERPOSITION is byte-identical
// to the original recursive foldGroup: the same FP additions in the same
// order.
//
// LINEAR fold — intermediate gists are NOT normalized; only the final root is
// (riverFold's single normalize).  This is a deliberate change of similarity
// semantics from the original per-group normalize, not a cached optimization:
// the fold is now a pure linear operator — a superposition of positionally-
// bound leaf vectors — so an interior node carries its span's natural
// magnitude and a resonance score reads as byte-proportional overlap rather
// than a scale-free cosine.  The mechanisms that depend on that reading
// compensate for it EXPLICITLY, never silently: the contrastive margin on
// approximate votes (voteRegions), company signatures decoupling halo company
// from gist content (sema.ts), and the shared-frame analogy tier (match.ts).

/** Fold `items[start .. start+count)` in groups of `mg` into `out`.
 *
 *  With `force`, the trailing incomplete group (2..mg-1 items) is folded as
 *  well — only a lone singleton passes through.  The river always folds with
 *  force: every level contracts by ~mg, so the tree's DEPTH is a function of
 *  ceil(log_mg(n)) alone.  Letting leftovers pass through unfolded made depth
 *  depend on the exact byte count (39 bytes folded in 3 levels, 41 in 4), and
 *  each extra level applies another seat permutation to the whole gist —
 *  near-identical inputs straddling such a cliff read as orthogonal
 *  (measured: 33-byte-identical prefixes at cos ≈ 0). */
function foldSlice(
  space: Space,
  items: Folded[],
  start: number,
  count: number,
  out: Folded[],
  force: boolean,
): void {
  const mg = space.maxGroup;
  const D = space.D;
  const complete = count - (count % mg);

  const foldAt = (at: number, size: number): void => {
    const gist = new Float32Array(D);
    const kids = new Array<Sema>(size);
    let len = 0;
    for (let k = 0; k < size; k++) {
      const f = items[at + k];
      const seat = space.seats[k].fwd;
      const v = f.tree.v;
      // Fused permute-and-accumulate — same FP ops, same order as the old
      // permuteInto + addInto pair, with no scratch buffer.
      for (let d = 0; d < D; d++) gist[d] += v[seat[d]];
      kids[k] = f.tree;
      len += f.len;
    }
    out.push({ tree: sema(gist, null, kids), len });
  };

  for (let i = 0; i < complete; i += mg) foldAt(start + i, mg);

  const leftover = count - complete;
  if (leftover === 0) return;
  if (force && leftover >= 2) foldAt(start + complete, leftover);
  else for (let i = complete; i < count; i++) out.push(items[start + i]);
}

function riverFold(space: Space, row: Folded[], stableBytes: number): Folded {
  if (row.length === 0) {
    const z = new Float32Array(space.D);
    return { tree: sema(z, new Uint8Array(0), null), len: 0 };
  }
  let level = row;
  while (level.length > 1) {
    // Find the item index where accumulated bytes reaches stableBytes.
    let boundary = level.length;
    if (stableBytes > 0) {
      let acc = 0;
      for (let i = 0; i < level.length; i++) {
        acc += level[i].len;
        if (acc >= stableBytes) {
          boundary = i + 1;
          break;
        }
      }
    }

    const next: Folded[] = [];
    if (boundary < level.length) {
      // Prefix folds independently of the suffix — structural stability.
      foldSlice(space, level, 0, boundary, next, true);
      foldSlice(space, level, boundary, level.length - boundary, next, true);
    } else {
      foldSlice(space, level, 0, level.length, next, true);
    }
    level = next;
  }
  // LINEAR fold — this root normalize is the ONLY normalize of the entire
  // fold; every intermediate gist stays unnormalized (see the folding
  // header).  Skipped for a single-leaf input: that root IS the shared
  // alphabet vector (already unit), and normalizing in place would mutate the
  // alphabet itself.
  if (row.length > 1) normalize(level[0].tree.v);
  return level[0];
}

// ---- public API ----

function bytesToLeaves(
  alphabet: Alphabet,
  bytes: Uint8Array,
): Folded[] {
  return Array.from(bytes, (b, i) => {
    const v = alphabet.vecs[b];
    return { tree: sema(v, bytes.slice(i, i + 1), null), len: 1 };
  });
}

/** CONTENT-DEFINED FOLD BOUNDARIES — where a byte stream segments, chosen by
 *  the bytes rather than by arithmetic.
 *
 *  `riverFold` groups FIXED arity from byte 0 and permutes item k by
 *  `seats[k]`, k = index mod W, so a byte's contribution is a function of its
 *  ABSOLUTE OFFSET: the same byte run is a different vector at a different
 *  position, and the same content is a different SUBTREE.  W's size has nothing
 *  to do with it — any fixed modulus does this, and identity must not depend on
 *  W at all.
 *
 *  A rolling hash removes the dependence without touching the fold's arity: the
 *  cut lands where the hash of the recent bytes vanishes mod W, so a change
 *  upstream moves only the cut it falls inside — every downstream boundary, and
 *  therefore every downstream segment, is unchanged.  Because
 *  {@link stablePrefixFold} folds each segment independently from its own slot
 *  0, byte-identical content then produces byte-identical subtrees, and
 *  hash-consing makes it the SAME NODE ID wherever it appears.  That — not the
 *  root cosine, which should and does still move when content is added — is
 *  what recognition, cover and resolve need.
 *
 *  Measured over 400 real deposits, shifts of 1..7 bytes, downstream cuts
 *  preserved / segments byte-identical:
 *
 *      content-defined, deposit text        99.7% / 98.4%   mean seg 6.61 B
 *      content-defined, non-Latin scripts   99.6% / 98.3%   mean seg 6.43 B
 *      content-defined, random binary       99.9% / 99.2%   mean seg 6.92 B
 *      the arithmetic grid, same corpus     14.3%           (only the k≡0 mod W
 *                                                           shifts survive)
 *
 *  The three content-defined rows agreeing is the load-bearing part: this reads
 *  BYTES, never text.  Mind is not a text engine — the same fold carries grids
 *  and any other modality — so a boundary rule justified by where words or
 *  sentences fall would be importing an assumption the architecture rejects.
 *  Random binary must, and does, behave exactly like prose.
 *
 *  Every constant is derived (§2.2): the cut mask is W, so a cut is offered once
 *  per quantum of bytes — which, composed with the minimum below, puts the
 *  expected segment at minLen + W − 1 ≈ 6 B rather than at W, deliberately (see
 *  the refutation recorded at `cutRate` in {@link contentLevels}: a segment is
 *  the flat PHRASE-scale unit the W-ary groups are built from, not a group of W
 *  children, and forcing E[len] = W costs 15 tests).  The minimum is W−1, `canonicalWindows`'s
 *  straddle neighbour and the write side's own floor for a unit; and the maximum
 *  is the KEYRING's seat count, because a segment folds as ONE flat node and
 *  `fold` has exactly that many seats to bind children into.  Capping there is
 *  what keeps the fold light: a segment of 3..seats leaves is a single node,
 *  where splitting it into W-groups plus a remainder would cost two or three
 *  and the remainders barely share (measured: partial-arity nodes 504 → 3,590,
 *  and total distinct nodes 8,142 → 9,712, when segments folded as [W][rest]). */
/** {@link contentBoundaries} plus, for each cut, its LEVEL — how deep in the
 *  tree that cut reaches.
 *
 *  One rolling hash serves every scale.  A cut is level 0 when its hash vanishes
 *  mod W, level 1 when mod W², and so on: level-L cuts are by construction a
 *  subset of level-(L−1) cuts, which is exactly the nesting a tree needs.  The
 *  expected span of a level-L node is therefore W^(L+1) bytes — the same growth
 *  the grid fold had, but with boundaries the content chose, so a shift moves
 *  one node at each level instead of all of them.
 *
 *  Levels are read from the hash the cut was ACCEPTED at, not recomputed, so
 *  they cost nothing beyond the divisions already being done. */
function contentLevels(
  space: Space,
  bytes: Uint8Array,
): { cuts: number[]; levels: number[] } {
  const W = space.maxGroup;
  const minLen = W - 1;
  const maxLen = space.seats.length;
  // MEASURED AND REFUTED — making E[segment] equal W.  A segment is at least
  // `minLen` bytes and then cuts with probability p, so E[len] = minLen +
  // (1−p)/p; with `h % W === 0` that is minLen + W − 1 = 6 for W = 4 (measured
  // mean 6.61 B on real deposits), half again coarser than the fold's own
  // arity, and the doc above used to claim the mask made the two equal.  It
  // does not, and the mismatch looked like the cause of a real deficit: the
  // climb perceives one region per segment, so on `Michelangelo is to sculpture
  // as who is to literature?` it sees 9 regions where the grid saw 19, reaches
  // one ranked anchor instead of two, and CAST's weave never includes the
  // writing-domain exemplar it needs (test/29 A2, C1).
  //
  // Fixing the rate to hit E[len] = W (a threshold `h % W < W − minLen + 1` on
  // the same rolling value, keeping the two bytes of history) does exactly what
  // it says — mean segment 3.60 B on text, 3.93 B on random binary, 14 segments
  // on that query instead of 9 — and takes the suite from 3 failures to 18,
  // across think, universality, scaling, decomposition, bridge, generalization,
  // saturation, audit and recognition. The coarser-than-arity scale is
  // load-bearing: W is the arity `riverFold` groups CHILDREN at, and a segment
  // is not a group of W children but the flat unit those groups are built from
  // — a phrase-scale unit, and the mechanisms above all read it that way.
  // Do not re-derive the rate from W.
  //
  // MEASURED AND REFUTED — reading the hash's HIGH bits instead of its low
  // ones.  The accumulator shifts LEFT, so `h % W` is the part the mixing has
  // had no chance to reach: with `h = (h << 1) + byte·K` and K odd, `h mod 4`
  // reduces to `(2·(prev mod 2) + byte) mod 4` — two bytes of history, and only
  // their parity.  It reads like a hash test that is really a byte-parity test,
  // and it shows: on `Michelangelo is to sculpture as who is to literature?`
  // the segments come out 8,8,8,8,8,7,4,2 — almost every boundary the FORCED
  // one at maxLen, which is the one offset-dependent cut in the rule.
  //
  // Testing the top bits instead (`h < 2^32 / W`, the same 1/W rate, with the
  // level test falling out as `h < 2^32 / W^(L+1)` — cleaner nesting than
  // divisibility) takes the suite from 2 failures to 21 AND breaks the
  // invariance floor in test/59.  The reason is the whole point: in a
  // shift-accumulator the LOW bits have a short effective window and the HIGH
  // bits a long one, so a disturbance upstream perturbs the high bits for the
  // next ~32 bytes while the low bits re-sync within two.  The narrow window is
  // not a defect in this hash — it IS the invariance.  A boundary rule here is
  // choosing how far a change may propagate, not how well the bits mix.
  //
  // MEASURED AND REFUTED — normalized chunking, to shrink the forced cut.  The
  // hard cut at maxLen is the ONE offset-dependent boundary left in the rule,
  // and it is not rare: 32% of segments on a mixed sample end there, five of
  // the eight in the query above, so for those streams the fold IS a grid of 2W
  // with all of the grid's phase.  The standard remedy applies cleanly here —
  // past a target length, relax the mask by one power of the same radix
  // (W → W/2), still content-defined and so still invariant, just coarser
  // evidence for a boundary; both quantities are already in the rule, nothing
  // introduced.  It works as advertised: forced cuts fall from 32% to 8.3% and
  // test/59's invariance floors still hold.
  //
  // And the suite goes from 2 failures to 5 relaxing at the expected length
  // (minLen + W − 1), or to 6 relaxing at the last opportunity (maxLen − 1) —
  // 22-multihop, 24-generalization, 29, 36.  Taken with the two results above
  // (changing the rate costs 15 tests; changing which bits are read costs 19),
  // the reading is that the segment DISTRIBUTION is what the mechanisms
  // downstream are fitted to, not the purity of the rule that produces it.  The
  // forced cut is part of that distribution.  Do not tidy it away without
  // re-measuring everything that reads a region.
  const cuts: number[] = [];
  const levels: number[] = [];
  let h = 0;
  let last = 0;
  for (let i = 0; i < bytes.length; i++) {
    h = (((h << 1) >>> 0) + Math.imul(bytes[i], 2654435761)) >>> 0;
    if (i + 1 >= bytes.length) break;
    const hit = h % W === 0;
    if (i - last >= minLen && (hit || i - last + 1 >= maxLen)) {
      cuts.push(i + 1);
      // How many further powers of W divide the hash — 0 for a forced cut.
      let lvl = 0;
      if (hit) {
        let m = W;
        while (lvl < 24 && m <= 0x40000000 && h % (m * W) === 0) {
          lvl++;
          m *= W;
        }
      }
      levels.push(lvl);
      last = i + 1;
    }
  }
  return { cuts, levels };
}

export function contentBoundaries(space: Space, bytes: Uint8Array): number[] {
  // ONE implementation of the rule.  This used to carry its own copy of the
  // rolling-hash loop, which is exactly how a write side and a read side drift
  // apart without a type error; the levels are computed from the hash the cut
  // was accepted at, so asking for them costs nothing but an array.
  return contentLevels(space, bytes).cuts;
}

/** Find the longest prefix of `bytes` whose leaf-id signature matches a
 *  known branch via `lookup`.  Returns the byte-length of that prefix, or 0. */
export function knownPrefixLength(
  bytes: Uint8Array,
  leafAt: (i: number) => number | null,
  lookup: (leafIds: number[]) => number | null,
): number {
  const leafIds: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const lid = leafAt(i);
    if (lid === null) break;
    leafIds.push(lid);
  }
  // Match the longest PROPER prefix — a full-length match means the entire
  // input already exists as a stored form (e.g. the flat leaf-id branch
  // stored alongside the structural root).  That would hide the true split
  // point and prevent the river from producing the same tree it folded
  // during training, so the structural recognition cannot find the right
  // forms.  A proper prefix guarantees at least two regions.
  for (let len = bytes.length - 1; len >= 2; len--) {
    if (lookup(leafIds.slice(0, len)) !== null) return len;
  }
  return 0;
}

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
export function bytesToTree(
  space: Space,
  alphabet: Alphabet,
  bytes: Uint8Array,
  leafAt?: (i: number) => number | null,
  lookup?: (leafIds: number[]) => number | null,
  boundaries?: readonly number[],
): Sema {
  if (bytes.length === 0) {
    return sema(alphabet.vecs[0], new Uint8Array(0), null);
  }
  // WHERE A STREAM SEGMENTS IS DECIDED BY ITS BYTES ({@link contentBoundaries}),
  // and the segments then fold BALANCED, W-ary, like any other row of items.
  //
  // The two must not be confused.  Content cuts are what make identity
  // offset-free: a segment folds from its own slot 0, so the same bytes give the
  // same subtree wherever they sit.  The shape ABOVE the segments is a separate
  // question, and it must stay the river's own — grouping W at a time, depth
  // log_W(n).  Joining segments left-nested instead (as the stable-prefix fold
  // does, for its own good reason) costs a node per segment on a single spine:
  // at a cut every ~6.6 B a 3 KB deposit becomes a 450-deep spine of 450 fresh
  // D-vectors, ~1.8 MB for one deposit, and every walker above inherits the
  // depth.  That is an implementation blunder, not a property of content-defined
  // folding, and it is what riverFold below avoids.
  //
  // Caller-supplied boundaries stay left-nested (see stablePrefixFold): there are
  // a handful of them, one per conversation turn, and the cumulative-context-root
  // contract depends on that shape.  Each SPAN between them content-folds.
  const sb = (leafAt && lookup) ? knownPrefixLength(bytes, leafAt, lookup) : 0;
  const outer = new Set<number>();
  if (boundaries !== undefined) { for (const b of boundaries) outer.add(b); }
  if (sb > 0) outer.add(sb);
  if (outer.size === 0) {
    return rootOf(contentFoldSpan(space, alphabet, bytes, 0, bytes.length));
  }
  return stablePrefixFold(
    space,
    alphabet,
    bytes,
    [...outer].sort((a, b) => a - b),
  );
}

/** One span, folded over its own content cuts — AT EVERY LEVEL.
 *
 *  A segment becomes ONE FLAT NODE: every leaf bound into its own seat and
 *  summed, arity = the segment's length.  `contentBoundaries` caps a segment at
 *  the keyring's seat count so this is always possible, and the flat form is
 *  both lighter (one node per segment instead of a [W][remainder] pair) and the
 *  natural unit — a segment IS the smallest thing the cuts claim is a unit.
 *
 *  Above the segments the cutting RECURSES rather than reverting to the grid.
 *  Grouping segment roots W-at-a-time from index 0 would reintroduce the very
 *  bug content cuts exist to remove, one level up: a form spanning segments
 *  12..17 straddles the [12-15] and [16-17] groups and is no node at all, so
 *  recognition can only reach it by an alignment accident (test/44 pins exactly
 *  this — at HEAD the grid happened to put a node one byte before the target).
 *  {@link contentLevels} assigns each cut a level from how divisible its hash
 *  is, so level-L cuts are a subset of level-(L−1) cuts and every node at every
 *  scale is delimited by content.  Identity is then offset-free at all scales,
 *  which is the whole requirement — it must not depend on W. */
function contentFoldSpan(
  space: Space,
  alphabet: Alphabet,
  bytes: Uint8Array,
  from: number,
  to: number,
): Folded {
  const span = bytes.subarray(from, to);
  const { cuts, levels } = contentLevels(space, span);
  const edges = [0, ...cuts, span.length];
  const segs: Folded[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    segs.push(flatFold(space, alphabet, span, edges[i], edges[i + 1]));
  }
  if (segs.length > 1) return groupByLevel(space, segs, levels, 1);
  return segs[0];
}

/** Group a row of items by the level of the cut BETWEEN them: items separated
 *  by a cut of level < L belong to the same parent, and a cut of level ≥ L ends
 *  it.  Recurses upward until one root remains, so the shape at every level is
 *  the content's, not an index's.  `levels[i]` is the level of the cut that
 *  precedes item i+1 (there are items.length − 1 of them).
 *
 *  A level that fails to split (every cut below L) or that would exceed the
 *  keyring falls through to the plain river fold for that row — the fold stays
 *  total on any input, and the fallback is rare enough not to reintroduce a
 *  systematic alignment. */
function groupByLevel(
  space: Space,
  items: Folded[],
  levels: number[],
  level: number,
): Folded {
  if (items.length === 1) return items[0];
  const maxSeats = space.seats.length;
  const groups: Folded[] = [];
  const groupLevels: number[] = [];
  let start = 0;
  for (let i = 0; i <= levels.length; i++) {
    const atEnd = i === levels.length;
    const cutHere = atEnd || levels[i] >= level;
    const wouldOverflow = i - start + 1 >= maxSeats;
    if (!cutHere && !wouldOverflow) continue;
    const slice = items.slice(start, i + 1);
    groups.push(slice.length === 1 ? slice[0] : joinFlat(space, slice));
    if (!atEnd) groupLevels.push(levels[i]);
    start = i + 1;
  }
  if (groups.length === items.length) {
    // This level split nothing — climb rather than spin.
    return level < 24
      ? groupByLevel(space, items, levels, level + 1)
      : riverFoldRaw(space, items);
  }
  return groupByLevel(space, groups, groupLevels, level + 1);
}

/** Join a row of already-folded items as one unnormalized node — the same
 *  seat-bound accumulate `flatFold` does for bytes, one level up. */
function joinFlat(space: Space, items: Folded[]): Folded {
  const gist = new Float32Array(space.D);
  const kids = new Array<Sema>(items.length);
  let len = 0;
  for (let k = 0; k < items.length; k++) {
    const v = items[k].tree.v;
    const seat = space.seats[k].fwd;
    for (let d = 0; d < space.D; d++) gist[d] += v[seat[d]];
    kids[k] = items[k].tree;
    len += items[k].len;
  }
  return { tree: sema(gist, null, kids), len };
}

/** One segment as a single unnormalized node: leaf per byte, each bound into
 *  seat k, summed.  Same FP ops and same seat order as foldSlice's group fold —
 *  only the arity is the segment's own length rather than a fixed W.  Never
 *  normalizes: the linear-fold contract keeps every interior gist raw and
 *  normalizes once at the root. */
function flatFold(
  space: Space,
  alphabet: Alphabet,
  bytes: Uint8Array,
  from: number,
  to: number,
): Folded {
  const n = to - from;
  if (n === 1) {
    const b = bytes[from];
    return {
      tree: sema(alphabet.vecs[b], bytes.slice(from, to), null),
      len: 1,
    };
  }
  const gist = new Float32Array(space.D);
  const kids = new Array<Sema>(n);
  for (let k = 0; k < n; k++) {
    const b = bytes[from + k];
    const v = alphabet.vecs[b];
    const seat = space.seats[k].fwd;
    for (let d = 0; d < space.D; d++) gist[d] += v[seat[d]];
    kids[k] = sema(v, bytes.slice(from + k, from + k + 1), null);
  }
  return { tree: sema(gist, null, kids), len: n };
}

/** The stable-prefix segmented fold (§10.3).  Each segment between
 *  consecutive boundaries folds PLAINLY and independently; segment roots
 *  join left-nested, and only the final root is normalized (the linear-fold
 *  contract: one normalize per perception).  A segment's own inner splits
 *  need no recursion here: a nested learnt prefix is itself an earlier
 *  boundary, so the left-nested join reproduces every intermediate learnt
 *  root ((s₀·s₁) IS the root the store learnt for the first two segments'
 *  bytes, and so on). */
/** A fold's ROOT: ONE normalize per perception, at the root, exactly as
 *  riverFold did — the interior stays raw (the linear-fold contract).
 *
 *  Normalizes EXCEPT when the whole stream folded to a single
 *  leaf: a leaf's vector IS the alphabet's own, shared by every occurrence of
 *  that byte, and `normalize` writes in place.  Every fold entry point returns
 *  through here, because the guard is exactly the kind that gets written at one
 *  site and missed at the next two — which is what had happened: only
 *  {@link bytesToTree} carried it, while `stablePrefixFold` and its incremental
 *  twin normalized unconditionally, reachable by a one-byte stream whose only
 *  boundary is its own length. */
function rootOf(f: Folded): Sema {
  if (f.tree.kids !== null) normalize(f.tree.v);
  return f.tree;
}

function stablePrefixFold(
  space: Space,
  alphabet: Alphabet,
  bytes: Uint8Array,
  boundaries: readonly number[],
): Sema {
  const cuts: number[] = [];
  let prev = 0;
  for (const b of boundaries) {
    if (b > prev && b < bytes.length) {
      cuts.push(b);
      prev = b;
    }
  }
  if (cuts.length === 0) {
    return rootOf(contentFoldSpan(space, alphabet, bytes, 0, bytes.length));
  }
  const edges = [0, ...cuts, bytes.length];
  const segs: Folded[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    segs.push(contentFoldSpan(space, alphabet, bytes, edges[i], edges[i + 1]));
  }
  let cur = segs[0];
  for (let i = 1; i < segs.length; i++) cur = fold2(space, cur, segs[i]);
  return rootOf(cur);
}

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
export function stablePrefixFoldIncremental(
  space: Space,
  alphabet: Alphabet,
  bytes: Uint8Array,
  boundaries: readonly number[],
  prev?: StableFold,
): { tree: Sema; fold: StableFold } {
  const cuts: number[] = [];
  let prevB = 0;
  for (const b of boundaries) {
    if (b > prevB && b < bytes.length) {
      cuts.push(b);
      prevB = b;
    }
  }
  const edges = [0, ...cuts, bytes.length];
  const segs: Folded[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const hit = prev !== undefined && prev.edges[i] === edges[i] &&
        prev.edges[i + 1] === edges[i + 1]
      ? prev.segs[i]
      : undefined;
    segs.push(
      hit ?? contentFoldSpan(space, alphabet, bytes, edges[i], edges[i + 1]),
    );
  }
  if (segs.length === 1) {
    // Degenerate boundary set — one span, which IS the whole stream, and it was
    // just folded (or reused from `prev`) right above.  It cannot go through
    // `rootOf`: the ROOT is normalized, a cached SEGMENT never is (a later turn
    // reuses it as one), and `normalize` writes in place.  Re-folding `bytes`
    // to get a separate object is what this used to do — and a first-seen
    // deposit has no boundaries, so it always lands here, paying the fold
    // twice.  Copying the gist is the same result for one vector copy.  A
    // single LEAF needs neither: its vector is the shared alphabet entry and
    // must not be written at all.
    const only = segs[0].tree;
    const tree = only.kids === null
      ? only
      : sema(Float32Array.from(only.v), null, only.kids);
    if (tree.kids !== null) normalize(tree.v);
    return { tree, fold: { edges, segs } };
  }
  let cur = segs[0];
  for (let i = 1; i < segs.length; i++) cur = fold2(space, cur, segs[i]);
  return { tree: rootOf(cur), fold: { edges, segs } };
}

/** Join two folded items as one 2-kid branch — the top-level join of the
 *  stable-prefix fold, identical FP ops to foldSlice's seat-bound
 *  accumulation over a group of two.  Unnormalized (interior). */
function fold2(space: Space, a: Folded, b: Folded): Folded {
  const D = space.D;
  const gist = new Float32Array(D);
  const kids = [a.tree, b.tree];
  for (let k = 0; k < 2; k++) {
    const seat = space.seats[k].fwd;
    const v = kids[k].v;
    for (let d = 0; d < D; d++) gist[d] += v[seat[d]];
  }
  return { tree: sema(gist, null, kids), len: a.len + b.len };
}

/** Plain river fold WITHOUT the final root normalize — the segment-level
 *  building block of {@link stablePrefixFold} (interiors must keep their
 *  byte-proportional magnitude; only the whole perception's root is ever
 *  normalized).  Exported so callers that COMPOSE already-existing structural
 *  parts into a hypothetical synthetic root (see {@link composeStructuralGist})
 *  can feed the same raw primitive instead of duplicating its mathematics. */
export function riverFoldRaw(space: Space, row: Folded[]): Folded {
  if (row.length === 0) {
    const z = new Float32Array(space.D);
    return { tree: sema(z, new Uint8Array(0), null), len: 0 };
  }
  if (row.length === 1) return row[0];
  let level = row;
  while (level.length > 1) {
    const next: Folded[] = [];
    foldSlice(space, level, 0, level.length, next, true);
    level = next;
  }
  return level[0];
}

// ---- structural composition (synthesize from EXISTING structural parts) ----

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
export function composeStructuralGist(
  space: Space,
  parts: readonly StructuralPart[],
): Vec {
  const foldedParts: Folded[] = [];

  for (const part of parts) {
    if (part.len <= 0) continue;

    const direction = copy(part.v);
    normalize(direction);

    const scaled = zeros(space.D);
    addInto(scaled, direction, Math.sqrt(part.len));

    foldedParts.push({ tree: sema(scaled), len: part.len });
  }

  if (foldedParts.length === 0) return zeros(space.D);

  const rawRoot = riverFoldRaw(space, foldedParts);

  const result = copy(rawRoot.tree.v);
  normalize(result);
  return result;
}

// ---- n-D Hilbert curve ----

function gridDims(grid: Grid): number[] {
  if (grid.dims && grid.dims.length > 0) return grid.dims.slice();
  const dims = [grid.height, grid.width];
  if (grid.channels > 1) dims.push(grid.channels);
  return dims;
}

function hilbertPoint(index: number, n: number, bits: number): number[] {
  const x = new Array<number>(n).fill(0);
  for (let b = 0; b < bits; b++) {
    for (let d = 0; d < n; d++) {
      const bit = (index >>> (b * n + (n - 1 - d))) & 1;
      x[d] |= bit << b;
    }
  }
  const N = 1 << bits;
  let t = x[n - 1] >> 1;
  for (let i = n - 1; i > 0; i--) x[i] ^= x[i - 1];
  x[0] ^= t;
  for (let q = 2; q !== N; q <<= 1) {
    const p = q - 1;
    for (let i = n - 1; i >= 0; i--) {
      if (x[i] & q) x[0] ^= p;
      else {
        t = (x[0] ^ x[i]) & p;
        x[0] ^= t;
        x[i] ^= t;
      }
    }
  }
  return x;
}

export function hilbertBytes(grid: Grid): Uint8Array {
  const dims = gridDims(grid);
  const n = dims.length;
  if (n === 0 || grid.data.length === 0) return new Uint8Array(0);
  if (n === 1) return grid.data.slice(0, dims[0]);
  const maxAxis = Math.max(...dims);
  const bits = Math.max(1, Math.ceil(Math.log2(maxAxis)));
  const side = 1 << bits;
  const total = Math.pow(side, n);
  const stride = new Array<number>(n);
  stride[n - 1] = 1;
  for (let d = n - 2; d >= 0; d--) stride[d] = stride[d + 1] * dims[d + 1];
  const out: number[] = [];
  for (let h = 0; h < total; h++) {
    const pt = hilbertPoint(h, n, bits);
    let inside = true, flat = 0;
    for (let d = 0; d < n; d++) {
      if (pt[d] >= dims[d]) {
        inside = false;
        break;
      }
      flat += pt[d] * stride[d];
    }
    if (inside) out.push(grid.data[flat]);
  }
  return Uint8Array.from(out);
}

export function gridToTree(space: Space, alphabet: Alphabet, grid: Grid): Sema {
  return bytesToTree(space, alphabet, hilbertBytes(grid));
}

export function stackGrids(frames: Grid[]): Grid {
  if (frames.length === 0) {
    return { width: 0, height: 0, channels: 0, data: new Uint8Array(0) };
  }
  const frameDims = gridDims(frames[0]);
  const per = frames[0].data.length;
  const data = new Uint8Array(per * frames.length);
  for (let i = 0; i < frames.length; i++) data.set(frames[i].data, i * per);
  return {
    width: 0,
    height: 0,
    channels: 0,
    dims: [frames.length, ...frameDims],
    data,
  };
}
