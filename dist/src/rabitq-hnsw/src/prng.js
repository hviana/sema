/**
 * Small deterministic pseudo-random number generator (mulberry32).
 *
 * Pure ECMAScript. It is used so that the random orthogonal rotation of the
 * RaBitQ quantizer and the HNSW level assignment are reproducible and can be
 * regenerated after (de)serialization without storing large matrices.
 */
export class Prng {
  state;
  constructor(seed) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }
  /** Uniform float in [0, 1). */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform integer in [0, n). */
  int(n) {
    return (this.next() * n) | 0;
  }
  /** Current internal state (one uint32), for persisting/resuming the stream. */
  snapshot() {
    return this.state >>> 0;
  }
  /** Resume the stream from a previously snapshotted state. */
  restore(state) {
    this.state = state >>> 0;
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }
}
