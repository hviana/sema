// vec.ts — vector primitives.
// Superposition (add), normalization (stay on the sphere),
// resonance (cosine), and seat binding (a keyring of fixed permutations).
// No weights. No gradients.
/** Deterministic PRNG (32-bit mixer). */
export function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Standard normal sample (Box–Muller). */
function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0)
        u = rand();
    while (v === 0)
        v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export const zeros = (D) => new Float32Array(D);
export const copy = (v) => new Float32Array(v);
/** Random point on the unit sphere. */
export function randomUnit(D, rand) {
    const v = zeros(D);
    for (let i = 0; i < D; i++)
        v[i] = gaussian(rand);
    return normalize(v);
}
/** target += src * scale (in place). */
export function addInto(target, src, scale = 1) {
    for (let i = 0; i < target.length; i++)
        target[i] += src[i] * scale;
    return target;
}
export function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++)
        s += a[i] * b[i];
    return s;
}
const norm = (v) => Math.sqrt(dot(v, v));
// Epsilon thresholds (settable once via setVecConfig).
let _normalizeEpsilon = 1e-12;
let _cosineEpsilon = 1e-12;
/** In-place normalization. */
export function normalize(v) {
    const n = norm(v);
    if (n > _normalizeEpsilon) {
        for (let i = 0; i < v.length; i++)
            v[i] /= n;
    }
    return v;
}
/** Resonance: 1 = same, 0 = unrelated. */
export function cosine(a, b) {
    const na = norm(a), nb = norm(b);
    return na > _cosineEpsilon && nb > _cosineEpsilon ? dot(a, b) / (na * nb) : 0;
}
/** Set vector epsilon thresholds. Called once by Mind at construction. */
export function setVecConfig(cfg) {
    if (cfg.normalizeEpsilon !== undefined) {
        _normalizeEpsilon = cfg.normalizeEpsilon;
    }
    if (cfg.cosineEpsilon !== undefined)
        _cosineEpsilon = cfg.cosineEpsilon;
}
/** One fixed random permutation (Fisher–Yates). */
function makePermutation(D, rand) {
    const fwd = new Uint32Array(D);
    for (let i = 0; i < D; i++)
        fwd[i] = i;
    for (let i = D - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = fwd[i];
        fwd[i] = fwd[j];
        fwd[j] = t;
    }
    const inv = new Uint32Array(D);
    for (let i = 0; i < D; i++)
        inv[fwd[i]] = i;
    return { fwd, inv };
}
/** The keyring: one independent permutation per seat.
 *  Independent keys do not commute, so an address in a tree is the
 *  path itself — "seat 2 inside seat 1" ≠ "seat 1 inside seat 2". */
export function makeKeyring(D, seats, rand) {
    const ring = [];
    for (let s = 0; s < seats; s++)
        ring.push(makePermutation(D, rand));
    return ring;
}
/** Apply permutation: out[i] = v[table[i]]. */
export function permute(v, table) {
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++)
        out[i] = v[table[i]];
    return out;
}
/** Permute into existing buffer — zero allocation. */
export function permuteInto(out, v, table) {
    for (let i = 0; i < v.length; i++)
        out[i] = v[table[i]];
    return out;
}
