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
export class MinHeap {
  keys = [];
  vals = [];
  get size() {
    return this.keys.length;
  }
  push(priority, value) {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(priority);
    vals.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[i] < keys[parent]) {
        const tk = keys[i];
        keys[i] = keys[parent];
        keys[parent] = tk;
        const tv = vals[i];
        vals[i] = vals[parent];
        vals[parent] = tv;
        i = parent;
      } else {
        break;
      }
    }
  }
  pop() {
    const keys = this.keys;
    const vals = this.vals;
    const n = keys.length;
    if (n === 0) {
      return undefined;
    }
    const top = { priority: keys[0], value: vals[0] };
    const lastKey = keys.pop();
    const lastVal = vals.pop();
    const m = keys.length;
    if (m > 0) {
      keys[0] = lastKey;
      vals[0] = lastVal;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let best = i;
        if (left < m && keys[left] < keys[best]) {
          best = left;
        }
        if (right < m && keys[right] < keys[best]) {
          best = right;
        }
        if (best === i) {
          break;
        }
        const tk = keys[i];
        keys[i] = keys[best];
        keys[best] = tk;
        const tv = vals[i];
        vals[i] = vals[best];
        vals[best] = tv;
        i = best;
      }
    }
    return top;
  }
}
