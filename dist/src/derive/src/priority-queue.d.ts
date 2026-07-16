/**
 * Binary min-heap keyed by a numeric priority, carrying an arbitrary payload.
 *
 * It is the agenda of the lightest-derivation search, where the priority is the
 * estimate f = g + h. Stale entries are tolerated by the consumer (lazy
 * deletion), so there is no decrease-key: when an item's cost improves it is
 * simply pushed again, and the older, higher-priority copy is recognised as
 * stale and discarded when it surfaces. Parallel arrays (rather than an array
 * of objects) keep the hot path allocation-free.
 */
export declare class MinHeap<T> {
  private readonly keys;
  private readonly vals;
  get size(): number;
  push(priority: number, value: T): void;
  pop(): {
    priority: number;
    value: T;
  } | undefined;
}
