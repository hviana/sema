/**
 * Binary heap over two parallel numeric arrays storing (key, value) pairs.
 *
 * When `minHeap` is true the smallest key sits at the root, otherwise the
 * largest. Keys are distances, values are integer node ids. Parallel plain
 * arrays are used (rather than an array of objects) to avoid per-element
 * allocation in the search hot path.
 */
export class Heap {
    keys = [];
    vals = [];
    minHeap;
    constructor(minHeap) {
        this.minHeap = minHeap;
    }
    get size() {
        return this.keys.length;
    }
    clear() {
        this.keys.length = 0;
        this.vals.length = 0;
    }
    topKey() {
        return this.keys[0];
    }
    topVal() {
        return this.vals[0];
    }
    /** true if `a` belongs closer to the root than `b`. */
    higher(a, b) {
        return this.minHeap ? a < b : a > b;
    }
    push(key, val) {
        const keys = this.keys;
        const vals = this.vals;
        let i = keys.length;
        keys.push(key);
        vals.push(val);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.higher(keys[i], keys[parent])) {
                const tk = keys[i];
                keys[i] = keys[parent];
                keys[parent] = tk;
                const tv = vals[i];
                vals[i] = vals[parent];
                vals[parent] = tv;
                i = parent;
            }
            else
                break;
        }
    }
    pop() {
        const keys = this.keys;
        const vals = this.vals;
        const n = keys.length;
        if (n === 0)
            return;
        const lastKey = keys[n - 1];
        const lastVal = vals[n - 1];
        keys.pop();
        vals.pop();
        const m = keys.length;
        if (m === 0)
            return;
        keys[0] = lastKey;
        vals[0] = lastVal;
        let i = 0;
        while (true) {
            const left = 2 * i + 1;
            const right = left + 1;
            let best = i;
            if (left < m && this.higher(keys[left], keys[best]))
                best = left;
            if (right < m && this.higher(keys[right], keys[best]))
                best = right;
            if (best === i)
                break;
            const tk = keys[i];
            keys[i] = keys[best];
            keys[best] = tk;
            const tv = vals[i];
            vals[i] = vals[best];
            vals[best] = tv;
            i = best;
        }
    }
}
