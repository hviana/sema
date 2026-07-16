import { Prng } from "./prng.js";
function nextPow2(n) {
  let p = 1;
  while (p < n) {
    p <<= 1;
  }
  return p;
}
/** Set-bit count for every byte value, for counting code bits during the byte scan. */
const POPCOUNT8 = new Uint8Array(256);
for (let i = 1; i < 256; i++) {
  POPCOUNT8[i] = POPCOUNT8[i >> 1] + (i & 1);
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
export class RaBitQuantizer {
  dim;
  paddedDim;
  codeWords;
  queryBits;
  rounds;
  seed;
  centroid;
  sqrtD;
  maxQInt;
  signs;
  scratch;
  /** Fixed cosine inner-product scale (= 1 / E[L1] of a rotated unit vector). */
  cosFactor;
  // byte-LUT machinery for the query/code estimator
  nbytes;
  /** coordinate index sitting at byte position p, bit k -> bitCoord[p*8 + k]. */
  bitCoord;
  /** true when the largest possible LUT entry overflows a Uint8. */
  lutWide;
  constructor(dim, opts = {}) {
    this.dim = dim;
    this.paddedDim = nextPow2(dim);
    this.codeWords = Math.ceil(this.paddedDim / 32);
    this.queryBits = opts.queryBits ?? 8;
    this.rounds = opts.rounds ?? 3;
    this.seed = (opts.seed ?? 0x1234abcd) >>> 0;
    this.sqrtD = Math.sqrt(this.paddedDim);
    this.cosFactor = Math.sqrt(Math.PI / (2 * this.paddedDim));
    this.maxQInt = (1 << this.queryBits) - 1;
    this.centroid = new Float64Array(dim);
    if (opts.centroid) {
      for (let i = 0; i < dim; i++) {
        this.centroid[i] = opts.centroid[i] ?? 0;
      }
    }
    const prng = new Prng(this.seed);
    this.signs = [];
    for (let r = 0; r < this.rounds; r++) {
      const s = new Float64Array(this.paddedDim);
      for (let i = 0; i < this.paddedDim; i++) {
        s[i] = prng.next() < 0.5 ? -1 : 1;
      }
      this.signs.push(s);
    }
    this.scratch = new Float64Array(this.paddedDim);
    // Map (code-byte position, bit-in-byte) -> coordinate, honouring the host
    // byte order so the Uint8 view of the (Uint32) code buffer is interpreted
    // correctly on both little- and big-endian platforms.
    this.nbytes = this.paddedDim >>> 3;
    const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    this.bitCoord = new Int32Array(this.nbytes * 8);
    for (let p = 0; p < this.nbytes; p++) {
      const word = p >>> 2;
      const localByte = littleEndian ? p & 3 : 3 - (p & 3);
      const bitBase = word * 32 + localByte * 8;
      for (let k = 0; k < 8; k++) {
        this.bitCoord[p * 8 + k] = bitBase + k;
      }
    }
    this.lutWide = 8 * this.maxQInt > 255;
  }
  /** In-place fast Walsh-Hadamard transform; `a.length` must be a power of two. */
  fwht(a) {
    const n = a.length;
    for (let len = 1; len < n; len <<= 1) {
      const span = len << 1;
      for (let i = 0; i < n; i += span) {
        for (let j = i; j < i + len; j++) {
          const u = a[j];
          const v = a[j + len];
          a[j] = u + v;
          a[j + len] = u - v;
        }
      }
    }
  }
  /** Apply the orthogonal rotation in place (a.length === paddedDim). */
  rotate(a) {
    const n = this.paddedDim;
    const inv = 1 / this.sqrtD;
    for (let r = 0; r < this.rounds; r++) {
      const s = this.signs[r];
      for (let i = 0; i < n; i++) {
        a[i] *= s[i];
      }
      this.fwht(a);
      for (let i = 0; i < n; i++) {
        a[i] *= inv;
      }
    }
  }
  /** Encode a raw vector into its 1-bit sign code (the whole representation). */
  encode(vec) {
    const dim = this.dim;
    const pd = this.paddedDim;
    const buf = this.scratch;
    let sq = 0;
    for (let i = 0; i < dim; i++) {
      const v = vec[i] - this.centroid[i];
      buf[i] = v;
      sq += v * v;
    }
    for (let i = dim; i < pd; i++) {
      buf[i] = 0;
    }
    const code = new Uint32Array(this.codeWords);
    if (sq === 0) {
      return code;
    }
    const invNorm = 1 / Math.sqrt(sq);
    for (let i = 0; i < dim; i++) {
      buf[i] *= invNorm; // unit residual; padded dims stay 0
    }
    this.rotate(buf);
    for (let i = 0; i < pd; i++) {
      if (buf[i] > 0) {
        code[i >>> 5] |= 1 << (i & 31);
      }
    }
    return code;
  }
  /** Pre-process a full-precision query into the structure consumed by `estimate`. */
  prepareQuery(vec) {
    const dim = this.dim;
    const pd = this.paddedDim;
    const nb = this.nbytes;
    const buf = this.scratch;
    let sq = 0;
    for (let i = 0; i < dim; i++) {
      const v = vec[i] - this.centroid[i];
      buf[i] = v;
      sq += v * v;
    }
    for (let i = dim; i < pd; i++) {
      buf[i] = 0;
    }
    const qNorm = Math.sqrt(sq);
    const qlut = this.lutWide
      ? new Uint16Array(nb * 256)
      : new Uint8Array(nb * 256);
    if (qNorm === 0) {
      return { vmin: 0, delta: 0, sumQInt: 0, qlut, nbytes: nb, zero: true };
    }
    const invNorm = 1 / qNorm;
    for (let i = 0; i < dim; i++) {
      buf[i] *= invNorm;
    }
    this.rotate(buf);
    let vmin = Infinity;
    let vmax = -Infinity;
    for (let i = 0; i < pd; i++) {
      const x = buf[i];
      if (x < vmin) {
        vmin = x;
      }
      if (x > vmax) {
        vmax = x;
      }
    }
    const range = vmax - vmin;
    const delta = range > 0 ? range / this.maxQInt : 0;
    const invDelta = delta > 0 ? 1 / delta : 0;
    // Quantise each (rotated) query coordinate to queryBits bits.
    const qint = buf; // reuse: write the integer code back over the float buffer
    let sumQInt = 0;
    for (let i = 0; i < pd; i++) {
      let q = delta > 0 ? Math.round((buf[i] - vmin) * invDelta) : 0;
      if (q < 0) {
        q = 0;
      } else if (q > this.maxQInt) {
        q = this.maxQInt;
      }
      qint[i] = q;
      sumQInt += q;
    }
    // Build the byte LUT: qlut[p*256 + v] = sum of qint at coords whose bit is
    // set in v, grown incrementally as qlut[..(v with lowest set bit cleared)..]
    // plus the contribution of that lowest set bit.
    const bitCoord = this.bitCoord;
    for (let p = 0; p < nb; p++) {
      const base = p << 8;
      const cb = p << 3;
      for (let v = 1; v < 256; v++) {
        const low = v & -v;
        const k = 31 - Math.clz32(low);
        qlut[base + v] = qlut[base + (v & (v - 1))] + qint[bitCoord[cb + k]];
      }
    }
    return { vmin, delta, sumQInt, qlut, nbytes: nb, zero: false };
  }
  /**
   * Estimate the cosine distance (1 - cosine) between a stored code and a
   * full-precision query, reading the code's bytes against the query's byte LUT.
   * The code's set-bit count is tallied in the same byte scan, so nothing beyond
   * the code itself is needed.
   *
   * `codeBytes` is a Uint8 view of the packed code buffer and `byteOffset` is the
   * code's start byte (id * paddedDim/8).
   */
  estimate(codeBytes, byteOffset, q) {
    if (q.zero) {
      return 1;
    }
    const nb = q.nbytes;
    const lut = q.qlut;
    let dot = 0;
    let popcount = 0;
    for (let p = 0; p < nb; p++) {
      const b = codeBytes[byteOffset + p];
      dot += lut[(p << 8) + b];
      popcount += POPCOUNT8[b];
    }
    // A = sum_i sign_i * q_rot_i, recovered from the quantised query.
    const A = q.vmin * (2 * popcount - this.paddedDim) +
      q.delta * (2 * dot - q.sumQInt);
    return 1 - this.cosFactor * A;
  }
  /**
   * Cosine distance (1 - cosine, in [0, 2]) between two packed codes, computed
   * directly from the BLOB bytes via their sign-bit Hamming distance — no word
   * reinterpretation, so it is endianness-agnostic. Identical codes score 0.
   *
   * This is the distance used to build the graph (code vs code) and to answer a
   * query given an already-quantized code. It is coarser than `estimate`, where
   * one side is full precision.
   */
  codeDistanceBytes(a, b) {
    const nb = this.nbytes;
    let ham = 0;
    // 32-bit-word Hamming: this is the hot arithmetic of graph construction
    // (every candidate/prune comparison), so fold 4 bytes into one word and
    // popcount it — ~4× fewer loop iterations than a byte-LUT scan, with no
    // allocation and no dependence on the buffers' alignment or endianness
    // (both sides are composed identically, so XOR is order-agnostic).
    let p = 0;
    for (const n4 = nb & ~3; p < n4; p += 4) {
      let x = (a[p] ^ b[p]) |
        ((a[p + 1] ^ b[p + 1]) << 8) |
        ((a[p + 2] ^ b[p + 2]) << 16) |
        ((a[p + 3] ^ b[p + 3]) << 24);
      x -= (x >>> 1) & 0x55555555;
      x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
      x = (x + (x >>> 4)) & 0x0f0f0f0f;
      ham += Math.imul(x, 0x01010101) >>> 24;
    }
    for (; p < nb; p++) {
      ham += POPCOUNT8[a[p] ^ b[p]];
    }
    return (2 * ham) / this.paddedDim;
  }
  /** Pack a code (codeWords 32-bit words) into its little-endian BLOB bytes. */
  codeToBytes(code) {
    const u = new Uint32Array(this.codeWords);
    for (let i = 0; i < this.codeWords; i++) {
      u[i] = code[i];
    }
    return new Uint8Array(u.buffer, 0, u.byteLength);
  }
  /** Reinterpret a code BLOB as a copy of codeWords 32-bit words. */
  bytesToCode(bytes) {
    const u = new Uint32Array(this.codeWords);
    new Uint8Array(u.buffer).set(bytes);
    return u;
  }
}
