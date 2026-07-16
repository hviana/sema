import { addInto, normalize, permute, permuteInto, randomUnit, rng, zeros, } from "./vec.js";
export const sema = (v, leaf = null, kids = null) => ({ v, leaf, kids });
/** Whether a node is a CHUNK — a leaf-parent whose children are ALL leaves,
 *  the perception tree's smallest grouped unit.  The one predicate behind
 *  region collection, canonical segmentation seams, and sub-span indexing;
 *  named here beside the type so no consumer restates the shape inline. */
export const isChunk = (n) => n.kids !== null && n.kids.every((k) => k.kids === null);
// Reusable permute buffer for fold.
let _foldBuf = null;
/** Bind one vector into a seat — the elementary half of fold. Used to index an
 *  episode from either side and to pour a partner into a form's halo. */
export const bindSeat = (space, v, seat) => permute(v, space.seats[seat].fwd);
// ── Company signatures ──────────────────────────────────────────────────
//
// A halo is a superposition of EPISODE SIGNATURES: it answers "who does this
// form keep company with", and two forms share a concept when they keep the
// SAME company (the same partner nodes).  Pouring the partner's raw GIST was
// an approximation of that: it worked while the hierarchical fold decorrelated
// unrelated gists quickly, but any byte-overlap between partners leaks CONTENT
// similarity into COMPANY similarity, silently shifting the halo null model
// that conceptThreshold's derivation (unrelated halos ⇒ cosine 0 ± 1/√D)
// depends on.  A signature makes the semantics exact and fold-independent:
// a deterministic unit vector derived from the partner's IDENTITY, so two
// halos correlate exactly as much as their company overlaps — never because
// their partners merely contain similar bytes.
//
// Seeded by node id: ids are content-addressed mint order, stable for a given
// corpus (including checkpoint/resume, which re-derives identical ids), and
// halos are per-store training artifacts that are never compared across
// stores.
const _sigCache = new WeakMap();
const SIG_CACHE_MAX = 65_536;
/** The company signature of node `id` — the halo's pour unit (see above). */
export function companySignature(space, id) {
    let cache = _sigCache.get(space);
    if (!cache)
        _sigCache.set(space, cache = new Map());
    const hit = cache.get(id);
    if (hit)
        return hit;
    const v = randomUnit(space.D, rng((id ^ 0x9e3779b9) >>> 0));
    if (cache.size >= SIG_CACHE_MAX)
        cache.clear(); // flat cap; regeneration is cheap
    cache.set(id, v);
    return v;
}
/** fold — combine ordered children into one gist.
 *  Each child is turned with its seat's own key, superposed, normalized. */
export function fold(space, kids) {
    if (kids.length > space.seats.length) {
        throw new Error(`fold: ${kids.length} children but the keyring has only ${space.seats.length} seats`);
    }
    const out = zeros(space.D);
    if (!_foldBuf || _foldBuf.length !== space.D) {
        _foldBuf = new Float32Array(space.D);
    }
    const buf = _foldBuf;
    for (let i = 0; i < kids.length; i++) {
        permuteInto(buf, kids[i], space.seats[i].fwd);
        addInto(out, buf);
    }
    return normalize(out);
}
