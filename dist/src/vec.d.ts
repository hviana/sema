export type Vec = Float32Array;
/** Deterministic PRNG (32-bit mixer). */
export declare function rng(seed: number): () => number;
export declare const zeros: (D: number) => Vec;
export declare const copy: (v: Vec) => Vec;
/** Random point on the unit sphere. */
export declare function randomUnit(D: number, rand: () => number): Vec;
/** target += src * scale (in place). */
export declare function addInto(target: Vec, src: Vec, scale?: number): Vec;
export declare function dot(a: Vec, b: Vec): number;
/** In-place normalization. */
export declare function normalize(v: Vec): Vec;
/** Resonance: 1 = same, 0 = unrelated. */
export declare function cosine(a: Vec, b: Vec): number;
/** Set vector epsilon thresholds. Called once by Mind at construction. */
export declare function setVecConfig(cfg: {
  normalizeEpsilon?: number;
  cosineEpsilon?: number;
}): void;
export interface Permutation {
  fwd: Uint32Array;
  inv: Uint32Array;
}
/** The keyring: one independent permutation per seat.
 *  Independent keys do not commute, so an address in a tree is the
 *  path itself — "seat 2 inside seat 1" ≠ "seat 1 inside seat 2". */
export declare function makeKeyring(
  D: number,
  seats: number,
  rand: () => number,
): Permutation[];
/** Apply permutation: out[i] = v[table[i]]. */
export declare function permute(v: Vec, table: Uint32Array): Vec;
/** Permute into existing buffer — zero allocation. */
export declare function permuteInto(out: Vec, v: Vec, table: Uint32Array): Vec;
