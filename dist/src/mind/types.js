// types.ts — all interfaces, types, and free functions for the mind.
//
// GraphSearchHost is defined first (minimal imports) so GraphSearch can import
// it without pulling in the full MindContext.
import { concatBytes } from "../bytes.js";
import { dominates } from "../geometry.js";
// ═══════════════════════════════════════════════════════════════════════════
// FREE FUNCTIONS (pure, no state)
// ═══════════════════════════════════════════════════════════════════════════
/** Read a whole node's bytes. */
export const ALL = 0x7fffffff;
/** Splice every chosen span in order — the whole cover as one byte string. */
export function spliceAll(segs) {
    if (!segs.some((s) => s.rec))
        return null;
    return concatBytes(segs.map((s) => s.bytes));
}
/** Lift the answer out of the cover for think: the recognised region, free of
 *  the asker's surrounding (unrecognised) framing. */
export function liftAnswer(segs, queryLen) {
    const recognised = [];
    for (let k = 0; k < segs.length; k++)
        if (segs[k].rec)
            recognised.push(k);
    if (recognised.length === 0)
        return null;
    if (recognised.length === 1) {
        const s = segs[recognised[0]];
        if (dominates(s.j - s.i, queryLen)) {
            return concatBytes(segs.map((x) => x.bytes));
        }
        return s.bytes;
    }
    const lo = recognised[0];
    const hi = recognised[recognised.length - 1];
    return concatBytes(segs.slice(lo, hi + 1).map((x) => x.bytes));
}
/** The CHANGED NODES of a freshly-perceived `tree` against the node ids a previous
 *  tracked deposit interned (`prevSeen`). */
export function changedNodes(tree, ids, prevSeen) {
    const newCount = new Map();
    const count = (n) => {
        const memo = newCount.get(n);
        if (memo !== undefined)
            return memo;
        const id = ids.get(n);
        // PRUNE: a node whose id the previous deposit already interned is old,
        // and content addressing makes that transitive — the same id names the
        // same content, so every descendant was interned then too.  The whole
        // subtree counts 0 without walking it; with the pyramid fold sharing a
        // conversation's prefix subtree, this is what keeps the changed-nodes
        // read O(new nodes) instead of O(context).  (A node internTreeIds
        // memo-skipped has an id here exactly when it is such a shared root.)
        if (id !== undefined && prevSeen.has(id)) {
            newCount.set(n, 0);
            return 0;
        }
        let c = 1; // reachable only when NOT pruned above ⇒ this node is new
        if (n.kids) {
            for (const k of n.kids)
                c += count(k);
        }
        newCount.set(n, c);
        return c;
    };
    const total = count(tree);
    if (total === 0)
        return [tree];
    let n = tree;
    for (;;) {
        if (n.kids === null)
            return [n];
        let holder = null;
        for (const k of n.kids) {
            if (newCount.get(k) === total) {
                holder = k;
                break;
            }
        }
        if (holder === null)
            return [n];
        n = holder;
    }
}
