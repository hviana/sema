/**
 * Small deterministic pseudo-random number generator (mulberry32).
 *
 * Pure ECMAScript. It is used so that the random orthogonal rotation of the
 * RaBitQ quantizer and the HNSW level assignment are reproducible and can be
 * regenerated after (de)serialization without storing large matrices.
 */
export declare class Prng {
    private state;
    constructor(seed: number);
    /** Uniform float in [0, 1). */
    next(): number;
    /** Uniform integer in [0, n). */
    int(n: number): number;
    /** Current internal state (one uint32), for persisting/resuming the stream. */
    snapshot(): number;
    /** Resume the stream from a previously snapshotted state. */
    restore(state: number): void;
}
