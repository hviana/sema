// geometry.ts — every modality is a stream; geometry is only a reading order.
//
//   1. Each byte is a leaf — an atom carrying its own vector straight from
//      the alphabet.
//   2. The river folds leaves upward in fixed-size groups (maxGroup).  Items
//      that cross the stable-prefix boundary are split so the prefix folds
//      identically regardless of what follows — pure structural stability.
//   3. The same rule recurses level after level until one root remains.
import { normalize } from "./vec.js";
import { sema } from "./sema.js";
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
export function mergeThreshold(D) {
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
export function identityBar(D, maxGroup, len) {
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
export function reachThreshold(maxGroup) {
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
export function estimatorNoise(D) {
    return 1 / Math.sqrt(D);
}
/** The statistical-significance bar for whole-query resonance: 3/√D.
 *  In D dimensions the expected cosine of two independent random vectors is 0
 *  with standard deviation 1/√D.  A cosine ≥ 3/√D is three standard deviations
 *  above chance — the query is statistically related to the store, not merely
 *  sharing random byte noise.  Below this bar the consensus climb (which trusts
 *  sub-region resonance) is skipped: there is no evidence the query belongs to
 *  the same distribution as the stored content.  Derived, never tuned. */
export function significanceBar(D) {
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
export function conceptThreshold(D) {
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
export function dominates(partLen, wholeLen) {
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
export function consensusFloor(N) {
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
export function coverageBar(_maxGroup, D) {
    return conceptThreshold(D);
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
 *  well — only a lone singleton passes through — guaranteeing progress when
 *  the caller detected a stall. */
function foldSlice(space, items, start, count, out, force) {
    const mg = space.maxGroup;
    const D = space.D;
    const complete = count - (count % mg);
    const foldAt = (at, size) => {
        const gist = new Float32Array(D);
        const kids = new Array(size);
        let len = 0;
        for (let k = 0; k < size; k++) {
            const f = items[at + k];
            const seat = space.seats[k].fwd;
            const v = f.tree.v;
            // Fused permute-and-accumulate — same FP ops, same order as the old
            // permuteInto + addInto pair, with no scratch buffer.
            for (let d = 0; d < D; d++)
                gist[d] += v[seat[d]];
            kids[k] = f.tree;
            len += f.len;
        }
        out.push({ tree: sema(gist, null, kids), len });
    };
    for (let i = 0; i < complete; i += mg)
        foldAt(start + i, mg);
    const leftover = count - complete;
    if (leftover === 0)
        return;
    if (force && leftover >= 2)
        foldAt(start + complete, leftover);
    else
        for (let i = complete; i < count; i++)
            out.push(items[start + i]);
}
function riverFold(space, row, stableBytes) {
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
        const next = [];
        if (boundary < level.length) {
            // Prefix folds independently of the suffix — structural stability.
            foldSlice(space, level, 0, boundary, next, false);
            foldSlice(space, level, boundary, level.length - boundary, next, false);
        }
        else {
            foldSlice(space, level, 0, level.length, next, false);
        }
        if (next.length === level.length) {
            // Stuck — every group was incomplete.  Force-fold to break the stall.
            const forced = [];
            foldSlice(space, next, 0, next.length, forced, true);
            level = forced;
        }
        else {
            level = next;
        }
    }
    // LINEAR fold — this root normalize is the ONLY normalize of the entire
    // fold; every intermediate gist stays unnormalized (see the folding
    // header).  Skipped for a single-leaf input: that root IS the shared
    // alphabet vector (already unit), and normalizing in place would mutate the
    // alphabet itself.
    if (row.length > 1)
        normalize(level[0].tree.v);
    return level[0];
}
// ---- public API ----
function bytesToLeaves(alphabet, bytes) {
    return Array.from(bytes, (b, i) => {
        const v = alphabet.vecs[b];
        return { tree: sema(v, bytes.slice(i, i + 1), null), len: 1 };
    });
}
/** Find the longest prefix of `bytes` whose leaf-id signature matches a
 *  known branch via `lookup`.  Returns the byte-length of that prefix, or 0. */
export function knownPrefixLength(bytes, leafAt, lookup) {
    const leafIds = [];
    for (let i = 0; i < bytes.length; i++) {
        const lid = leafAt(i);
        if (lid === null)
            break;
        leafIds.push(lid);
    }
    // Match the longest PROPER prefix — a full-length match means the entire
    // input already exists as a stored form (e.g. the flat leaf-id branch
    // stored alongside the structural root).  That would hide the true split
    // point and prevent the river from producing the same tree it folded
    // during training, so the structural recognition cannot find the right
    // forms.  A proper prefix guarantees at least two regions.
    for (let len = bytes.length - 1; len >= 2; len--) {
        if (lookup(leafIds.slice(0, len)) !== null)
            return len;
    }
    return 0;
}
/** Bytes → Sema tree.  `leafAt` and `lookup` are store capabilities for
 *  detecting previously-stored prefixes so the river can split at the
 *  correct boundary.  Pass them through from `perceive`; the geometry
 *  computes the stable prefix internally. */
export function bytesToTree(space, alphabet, bytes, leafAt, lookup) {
    if (bytes.length === 0) {
        return sema(alphabet.vecs[0], new Uint8Array(0), null);
    }
    const sb = (leafAt && lookup) ? knownPrefixLength(bytes, leafAt, lookup) : 0;
    return riverFold(space, bytesToLeaves(alphabet, bytes), sb > 0 ? sb : bytes.length).tree;
}
/** Plain bytes→tree (identical to capability-less {@link bytesToTree}) that
 *  also RETURNS its pyramid, reusing `prev` — the pyramid of a PROPER
 *  prefix of `bytes` (caller guarantees content match and
 *  prev.bytes < bytes.length). */
export function bytesToTreePyramid(space, alphabet, bytes, prev) {
    if (bytes.length === 0) {
        return {
            tree: sema(alphabet.vecs[0], new Uint8Array(0), null),
            pyramid: { levels: [], bytes: 0 },
        };
    }
    const mg = space.maxGroup;
    const reusable = (L) => {
        // prev's TOPMOST level holds its normalized ROOT — reusable blocks must
        // be raw interiors, so the top level is always excluded.
        if (!prev || L > prev.levels.length - 2)
            return null;
        return prev.levels[L];
    };
    // Level 0: reuse the prefix's leaf items wholesale (all are full blocks).
    const lv0 = reusable(0);
    const row = lv0
        ? [...lv0, ...bytesToLeaves(alphabet, bytes.subarray(prev.bytes))]
        : bytesToLeaves(alphabet, bytes);
    const levels = [row];
    let level = row;
    let L = 0;
    while (level.length > 1) {
        let next = [];
        // Reuse the leading FULL blocks of prev's level L+1 (len == mg^(L+1),
        // wholly inside the prefix); the rule below folds the rest from this
        // level's items exactly as the from-scratch fold would.
        const blockLen = mg ** (L + 1);
        let reused = 0;
        const cand = reusable(L + 1);
        if (cand) {
            const maxFull = Math.floor(prev.bytes / blockLen);
            while (reused < maxFull && reused < cand.length &&
                cand[reused].len === blockLen)
                reused++;
            for (let i = 0; i < reused; i++)
                next.push(cand[i]);
        }
        foldSlice(space, level, reused * mg, level.length - reused * mg, next, false);
        if (next.length === level.length) {
            // Stuck — same force-fold as riverFold (reuse cannot cause it: any
            // reused block replaces a whole folded group, so reused > 0 implies
            // progress).
            const forced = [];
            foldSlice(space, next, 0, next.length, forced, true);
            next = forced;
        }
        levels.push(next);
        level = next;
        L++;
    }
    if (row.length > 1)
        normalize(level[0].tree.v);
    return {
        tree: level[0].tree,
        pyramid: { levels, bytes: bytes.length },
    };
}
// ---- n-D Hilbert curve ----
function gridDims(grid) {
    if (grid.dims && grid.dims.length > 0)
        return grid.dims.slice();
    const dims = [grid.height, grid.width];
    if (grid.channels > 1)
        dims.push(grid.channels);
    return dims;
}
function hilbertPoint(index, n, bits) {
    const x = new Array(n).fill(0);
    for (let b = 0; b < bits; b++) {
        for (let d = 0; d < n; d++) {
            const bit = (index >>> (b * n + (n - 1 - d))) & 1;
            x[d] |= bit << b;
        }
    }
    const N = 1 << bits;
    let t = x[n - 1] >> 1;
    for (let i = n - 1; i > 0; i--)
        x[i] ^= x[i - 1];
    x[0] ^= t;
    for (let q = 2; q !== N; q <<= 1) {
        const p = q - 1;
        for (let i = n - 1; i >= 0; i--) {
            if (x[i] & q)
                x[0] ^= p;
            else {
                t = (x[0] ^ x[i]) & p;
                x[0] ^= t;
                x[i] ^= t;
            }
        }
    }
    return x;
}
export function hilbertBytes(grid) {
    const dims = gridDims(grid);
    const n = dims.length;
    if (n === 0 || grid.data.length === 0)
        return new Uint8Array(0);
    if (n === 1)
        return grid.data.slice(0, dims[0]);
    const maxAxis = Math.max(...dims);
    const bits = Math.max(1, Math.ceil(Math.log2(maxAxis)));
    const side = 1 << bits;
    const total = Math.pow(side, n);
    const stride = new Array(n);
    stride[n - 1] = 1;
    for (let d = n - 2; d >= 0; d--)
        stride[d] = stride[d + 1] * dims[d + 1];
    const out = [];
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
        if (inside)
            out.push(grid.data[flat]);
    }
    return Uint8Array.from(out);
}
export function gridToTree(space, alphabet, grid) {
    return bytesToTree(space, alphabet, hilbertBytes(grid));
}
export function stackGrids(frames) {
    if (frames.length === 0) {
        return { width: 0, height: 0, channels: 0, data: new Uint8Array(0) };
    }
    const frameDims = gridDims(frames[0]);
    const per = frames[0].data.length;
    const data = new Uint8Array(per * frames.length);
    for (let i = 0; i < frames.length; i++)
        data.set(frames[i].data, i * per);
    return {
        width: 0,
        height: 0,
        channels: 0,
        dims: [frames.length, ...frameDims],
        data,
    };
}
