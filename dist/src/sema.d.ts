import { Permutation, Vec } from "./vec.js";
/** The one structure. A node's vector is the gist of its whole subtree; it also
 *  carries the structure the DAG store interns — its leaf bytes, or its kids. */
export interface Sema {
    v: Vec;
    leaf: Uint8Array | null;
    kids: Sema[] | null;
}
export declare const sema: (v: Vec, leaf?: Uint8Array | null, kids?: Sema[] | null) => Sema;
/** Whether a node is a CHUNK — a leaf-parent whose children are ALL leaves,
 *  the perception tree's smallest grouped unit.  The one predicate behind
 *  region collection, canonical segmentation seams, and sub-span indexing;
 *  named here beside the type so no consumer restates the shape inline. */
export declare const isChunk: (n: Sema) => n is Sema & {
    kids: Sema[];
};
/** The medium: dimension, keyring, and noise source. */
export interface Space {
    D: number;
    seats: Permutation[];
    rand: () => number;
    maxGroup: number;
}
/** Bind one vector into a seat — the elementary half of fold. Used to index an
 *  episode from either side and to pour a partner into a form's halo. */
export declare const bindSeat: (space: Space, v: Vec, seat: number) => Vec;
/** The positional coordinate of child `index` inside a node of `size` items.
 *
 * Positions are anchored at BOTH ends of the full keyring: the left half uses
 * the lowest seats and the right half uses the highest seats.  Growing a node
 * at one edge therefore preserves the coordinates anchored at the other edge,
 * while every position remains injective as long as
 * `0 <= index < size <= seatCount`.  The helper is shared by perception and by
 * synthetic/canonical folds so there is exactly one structural algebra. */
export declare function twoEndedSeat(seatCount: number, size: number, index: number): number;
/** The company signature of node `id` — the halo's pour unit (see above). */
export declare function companySignature(space: Space, id: number): Vec;
/** fold — combine ordered children into one gist.
 *  Each child is turned in the same two-ended coordinate frame used by the
 *  perception tree, then superposed and normalized. */
export declare function fold(space: Space, kids: Vec[]): Vec;
