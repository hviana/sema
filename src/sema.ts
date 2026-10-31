import {
  normalize,
  Permutation,
  permute,
  randomUnit,
  rng,
  Vec,
} from "./vec.js";

/** The one structure. A node's vector is the gist of its whole subtree; it also
 *  carries the structure the DAG store interns — its leaf bytes, or its kids. */
export interface Sema {
  v: Vec;
  leaf: Uint8Array | null;
  kids: Sema[] | null;
}

export const sema = (
  v: Vec,
  leaf: Uint8Array | null = null,
  kids: Sema[] | null = null,
): Sema => ({ v, leaf, kids });

/** Whether a node is a CHUNK — a leaf-parent whose children are ALL leaves,
 *  the perception tree's smallest grouped unit.  The one predicate behind
 *  region collection, canonical segmentation seams, and sub-span indexing;
 *  named here beside the type so no consumer restates the shape inline. */
export const isChunk = (n: Sema): n is Sema & { kids: Sema[] } =>
  n.kids !== null && n.kids.every((k) => k.kids === null);

/** The medium: dimension, keyring, and noise source. */
export interface Space {
  D: number;
  seats: Permutation[];
  rand: () => number;
  maxGroup: number;
}

/** Bind one vector into a seat — the elementary half of fold. Used to index an
 *  episode from either side and to pour a partner into a form's halo. */
export const bindSeat = (space: Space, v: Vec, seat: number): Vec =>
  permute(v, space.seats[seat].fwd);

/** The positional coordinate of child `index` inside a node of `size` items.
 *
 * Positions are anchored at BOTH ends of the full keyring: the left half uses
 * the lowest seats and the right half uses the highest seats.  Growing a node
 * at one edge therefore preserves the coordinates anchored at the other edge,
 * while every position remains injective as long as
 * `0 <= index < size <= seatCount`.  The helper is shared by perception and by
 * synthetic/canonical folds so there is exactly one structural algebra. */
export function twoEndedSeat(
  seatCount: number,
  size: number,
  index: number,
): number {
  const front = (size + 1) >> 1;
  return index < front ? index : seatCount - size + index;
}

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

const _sigCache = new WeakMap<Space, Map<number, Vec>>();
/** The signatures' byte budget (caches.md): D·4 bytes each, dropped whole at
 *  the budget — a miss re-draws one from the node id. */
const SIG_CACHE_BYTES = 64_000_000;

/** The company signature of node `id` — the halo's pour unit (see above). */
export function companySignature(space: Space, id: number): Vec {
  let cache = _sigCache.get(space);
  if (!cache) _sigCache.set(space, cache = new Map());
  const hit = cache.get(id);
  if (hit) return hit;
  const v = randomUnit(space.D, rng((id ^ 0x9e3779b9) >>> 0));
  if (cache.size * space.D * 4 >= SIG_CACHE_BYTES) cache.clear();
  cache.set(id, v);
  return v;
}

/** THE FOLD'S ONE BINDING: a row of vectors, each bound to its two-ended seat
 *  and superposed, unnormalized — `gist[d] += v[seat[d]]`, in row order, from
 *  zero.  Two-ended: the first half takes low seats and the second half high
 *  seats, inward from the tail of the FULL keyring, so interior items keep
 *  their seats when a leading or trailing item is perturbed.  A segment's gist
 *  is this over its bytes (geometry.ts `flatFold`), a group's over its items
 *  (`joinFlat`), a stored node's over its kids (`storedGist`), a window's
 *  ({@link fold}, normalized); one order of float32 additions, so equal rows
 *  give equal bits (geometry.ts `boundCoord` is its one-coordinate twin). */
export function bindRow(space: Space, row: ArrayLike<Vec>): Vec {
  const n = row.length;
  const gist = new Float32Array(space.D);
  for (let k = 0; k < n; k++) {
    const v = row[k];
    const seat = space.seats[twoEndedSeat(space.seats.length, n, k)].fwd;
    for (let d = 0; d < space.D; d++) gist[d] += v[seat[d]];
  }
  return gist;
}

/** fold — combine ordered children into one gist: {@link bindRow}, then the
 *  root's one normalize. */
export function fold(space: Space, kids: Vec[]): Vec {
  if (kids.length > space.seats.length) {
    throw new Error(
      `fold: ${kids.length} children but the keyring has only ${space.seats.length} seats`,
    );
  }
  return normalize(bindRow(space, kids));
}
