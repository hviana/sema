export interface QueryContext {
  vmin: number;
  delta: number;
  sumQInt: number;
  /**
   * Per-query lookup table of length nbytes*256. `qlut[p*256 + b]` is the sum of
   * the quantised query values at the (up to 8) coordinates whose code bits are
   * set in byte value `b` at code-byte position `p`. The query/code inner product
   * for a stored code is then sum over its bytes of qlut[p*256 + codeByte_p].
   */
  qlut: Uint8Array | Uint16Array;
  /** number of bytes per code (paddedDim / 8). */
  nbytes: number;
  /** true when the (centered) query has zero norm. */
  zero: boolean;
}
export interface RaBitQOptions {
  queryBits?: number;
  rounds?: number;
  seed?: number;
  centroid?: ArrayLike<number>;
}
/**
 * 1-bit RaBitQ quantizer (cosine) -- the ONLY representation of a vector kept by
 * the index. A D-dimensional vector collapses to ceil(D/32) 32-bit words of sign
 * bits, e.g. a 256-d vector goes from 256*4 = 1024 bytes to 32 bytes of code.
 *
 * Each vector is centered by an optional centroid, normalised, rotated by a
 * fast random orthogonal transform (random sign flips + Walsh-Hadamard,
 * O(D log D)) and reduced to one sign bit per padded dimension. The random
 * rotation makes the quantisation error essentially uniform across vectors, so
 * the cosine estimate needs only a single fixed scale (`cosFactor`) rather than
 * any per-vector correction.
 *
 * Two estimators are provided:
 *   - `estimate`          : full-precision query vs stored code (accurate)
 *   - `codeDistanceBytes` : stored code vs stored code (Hamming based; used while
 *                           building the graph, where neither side is full precision)
 *
 * Reference: Gao & Long, "RaBitQ: Quantizing High-Dimensional Vectors with a
 * Theoretical Error Bound for Approximate Nearest Neighbor Search", SIGMOD 2024.
 */
export declare class RaBitQuantizer {
  readonly dim: number;
  readonly paddedDim: number;
  readonly codeWords: number;
  readonly queryBits: number;
  readonly rounds: number;
  readonly seed: number;
  readonly centroid: Float64Array;
  private readonly sqrtD;
  private readonly maxQInt;
  private readonly signs;
  private readonly scratch;
  /** Fixed cosine inner-product scale (= 1 / E[L1] of a rotated unit vector). */
  readonly cosFactor: number;
  private readonly nbytes;
  /** coordinate index sitting at byte position p, bit k -> bitCoord[p*8 + k]. */
  private readonly bitCoord;
  /** true when the largest possible LUT entry overflows a Uint8. */
  private readonly lutWide;
  constructor(dim: number, opts?: RaBitQOptions);
  /** In-place fast Walsh-Hadamard transform; `a.length` must be a power of two. */
  private fwht;
  /** Apply the orthogonal rotation in place (a.length === paddedDim). */
  private rotate;
  /** Encode a raw vector into its 1-bit sign code (the whole representation). */
  encode(vec: ArrayLike<number>): Uint32Array;
  /** Pre-process a full-precision query into the structure consumed by `estimate`. */
  prepareQuery(vec: ArrayLike<number>): QueryContext;
  /**
   * Estimate the cosine distance (1 - cosine) between a stored code and a
   * full-precision query, reading the code's bytes against the query's byte LUT.
   * The code's set-bit count is tallied in the same byte scan, so nothing beyond
   * the code itself is needed.
   *
   * `codeBytes` is a Uint8 view of the packed code buffer and `byteOffset` is the
   * code's start byte (id * paddedDim/8).
   */
  estimate(codeBytes: Uint8Array, byteOffset: number, q: QueryContext): number;
  /**
   * Cosine distance (1 - cosine, in [0, 2]) between two packed codes, computed
   * directly from the BLOB bytes via their sign-bit Hamming distance — no word
   * reinterpretation, so it is endianness-agnostic. Identical codes score 0.
   *
   * This is the distance used to build the graph (code vs code) and to answer a
   * query given an already-quantized code. It is coarser than `estimate`, where
   * one side is full precision.
   */
  codeDistanceBytes(a: Uint8Array, b: Uint8Array): number;
  /** Pack a code (codeWords 32-bit words) into its little-endian BLOB bytes. */
  codeToBytes(code: ArrayLike<number>): Uint8Array;
  /** Reinterpret a code BLOB as a copy of codeWords 32-bit words. */
  bytesToCode(bytes: Uint8Array): Uint32Array;
}
