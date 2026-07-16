/**
 * Binary heap over two parallel numeric arrays storing (key, value) pairs.
 *
 * When `minHeap` is true the smallest key sits at the root, otherwise the
 * largest. Keys are distances, values are integer node ids. Parallel plain
 * arrays are used (rather than an array of objects) to avoid per-element
 * allocation in the search hot path.
 */
export declare class Heap {
    readonly keys: number[];
    readonly vals: number[];
    private readonly minHeap;
    constructor(minHeap: boolean);
    get size(): number;
    clear(): void;
    topKey(): number;
    topVal(): number;
    /** true if `a` belongs closer to the root than `b`. */
    private higher;
    push(key: number, val: number): void;
    pop(): void;
}
