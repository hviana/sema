// recognition.ts — Section 2 of the mind:
// Address + Read over byte streams — decompose a query into its known forms.
//
//   recognise — structural + canonical decomposition into every stored form
//               that leads somewhere (has a continuation edge or a halo).
//   segment   — leaf-parent segmentation using the geometry's own groupings.
import { rItem } from "./trace.js";
import { foldTree, gistOf, perceive, resolve } from "./primitives.js";
import { leadsSomewhere } from "./traverse.js";
import { chainReach, leafIdAt } from "./canonical.js";
import { isChunk } from "../sema.js";
/** Decompose a byte stream into every stored form that leads somewhere
 *  (has a continuation edge or a halo).  Two complementary readings:
 *
 *   • structural — walk the query's own perceived tree, naming each subtree
 *     by findLeaf at the leaves and findBranch above.  Catches every form
 *     aligned to the query's segmentation.
 *
 *   • canonical — re-derive the store's segmentation directly: at each byte,
 *     the longest known leaf, chained into flat branches.  Names forms the
 *     query's own cut cannot, and records sub-leaf boundaries as `splits`.
 *
 *  Both O(n · maxGroup) bounded O(1) probes — never a scan of the corpus. */
export function recognise(ctx, bytes) {
    // Per-response memo (see MindContext.recogniseMemo): think, articulate and
    // the pre-consume pass all recognise the same byte objects; each repeat is
    // O(n·maxGroup²) store probes.  Skipped while tracing so every call still
    // emits its rationale step.
    if (ctx.recogniseMemo && !ctx.trace) {
        const hit = ctx.recogniseMemo.get(bytes);
        if (hit !== undefined)
            return hit;
        const fresh = recogniseImpl(ctx, bytes);
        ctx.recogniseMemo.set(bytes, fresh);
        return fresh;
    }
    return recogniseImpl(ctx, bytes);
}
function recogniseImpl(ctx, bytes) {
    const store = ctx.store;
    const sites = [];
    const leaves = [];
    const splits = new Set();
    if (bytes.length === 0)
        return { sites, leaves, splits };
    // Span-resolve memo for THIS call: the structural pass (sub-runs inside
    // leaf-parents) and the canonical pass (leaf-id chains) probe overlapping
    // spans, and each resolve() is a full fold of the sub-span (fresh subarray
    // objects — the per-response perceive memo cannot see them).  Keyed
    // numerically by (start, end); resolve is pure and the store is read-only
    // here, so a hit is exact.
    const spanIds = new Map();
    const resolveSpan = (start, end) => {
        const key = start * (bytes.length + 1) + end;
        let id = spanIds.get(key);
        if (id === undefined) {
            id = resolve(ctx, bytes.subarray(start, end));
            spanIds.set(key, id);
        }
        return id;
    };
    const emit = (start, end, id) => {
        if (leadsSomewhere(ctx, id)) {
            sites.push({ start, end, payload: id });
        }
    };
    // ── structural: the query's own perceived tree ──────────────────────
    const starts = new Set();
    starts.add(0);
    foldTree(ctx, perceive(ctx, bytes), 0, (n, start, end, node) => {
        if (n.kids === null) {
            leaves.push({ start, end, bytes: n.leaf ?? new Uint8Array(0), node });
        }
        if (node !== null)
            emit(start, end, node);
        if (isChunk(n)) {
            starts.add(start);
            // Try every sub-span within this leaf-parent.
            const leafOffsets = [];
            let off = start;
            for (const k of n.kids) {
                leafOffsets.push(off);
                off += k.leaf?.length ?? 0;
            }
            for (let i = 0; i < n.kids.length; i++) {
                const subIds = [];
                for (let j = i; j < n.kids.length; j++) {
                    const kj = n.kids[j];
                    if (kj.kids !== null || !kj.leaf)
                        break;
                    const lid = store.findLeaf(kj.leaf);
                    if (lid === null)
                        break;
                    subIds.push(lid);
                    const branch = store.findBranch(subIds);
                    if (branch === null)
                        continue;
                    const subEnd = leafOffsets[j] + (kj.leaf?.length ?? 0);
                    const resolved = resolveSpan(leafOffsets[i], subEnd);
                    if (resolved !== null)
                        emit(leafOffsets[i], subEnd, resolved);
                }
            }
        }
    });
    // ── canonical: longest-known-leaf re-segmentation ──────────────────
    const W = ctx.space.maxGroup;
    const singleLeaf = new Array(bytes.length).fill(null);
    for (let p = 0; p < bytes.length; p++) {
        const id = leafIdAt(ctx, bytes, p);
        if (id !== null)
            singleLeaf[p] = { id, end: p + 1 };
    }
    const leafFrom = (p) => {
        if (p >= bytes.length)
            return null;
        return singleLeaf[p];
    };
    const chunkEnd = new Uint32Array(bytes.length);
    const sorted = [...starts].sort((a, b) => a - b);
    for (let si = 0; si < sorted.length; si++) {
        const chunkStart = sorted[si];
        const chunkLimit = si + 1 < sorted.length ? sorted[si + 1] : bytes.length;
        for (let p = chunkStart; p < chunkLimit; p++) {
            chunkEnd[p] = chunkLimit;
        }
    }
    const tryChain = (p, maxIds) => {
        const first = leafFrom(p);
        if (!first)
            return;
        emit(p, first.end, first.id);
        const ids = [first.id];
        let pos = first.end;
        let prevId = null;
        for (let depth = 1; pos < bytes.length && ids.length <= maxIds; depth++) {
            const nx = leafFrom(pos);
            if (!nx)
                break;
            ids.push(nx.id);
            pos = nx.end;
            if (store.findBranch(ids) === null)
                continue;
            const id = resolveSpan(p, pos);
            if (id === null || id === prevId)
                continue;
            prevId = id;
            emit(p, pos, id);
        }
    };
    for (let p = 0; p < bytes.length; p++) {
        if (starts.has(p)) {
            tryChain(p, chainReach(W)); // boundary start — full reach
        }
        else {
            const limit = chunkEnd[p] + W;
            tryChain(p, Math.min(limit - p, chainReach(W)));
        }
    }
    // ── splits: a form boundary that does not fall on a leaf edge ────────
    const leafEdges = new Set([bytes.length]);
    for (const lf of leaves)
        leafEdges.add(lf.start);
    for (const s of sites) {
        if (!leafEdges.has(s.start))
            splits.add(s.start);
        if (!leafEdges.has(s.end))
            splits.add(s.end);
    }
    ctx.trace?.step("recognise", [rItem(bytes, "query")], sites.map((s) => rItem(bytes.subarray(s.start, s.end), "form", s.payload, [
        s.start,
        s.end,
    ])), `decompose the query into ${sites.length} learnt form(s) that lead somewhere` +
        ` (over ${leaves.length} perceived leaves)`);
    return { sites, leaves, splits };
}
/** Segment bytes using the geometry's own groupings — leaf-parent
 *  nodes from the perceived tree, with consecutive bare leaves merged
 *  into one segment.  Each segment's gist is perceived from its bytes
 *  IN ISOLATION, so the same content has the same gist regardless of
 *  where it appears. */
export function segment(ctx, bytes) {
    const tree = perceive(ctx, bytes);
    const out = [];
    let pendingStart = -1;
    let pendingEnd = -1;
    const flush = () => {
        if (pendingStart >= 0 && pendingEnd > pendingStart) {
            out.push({
                start: pendingStart,
                end: pendingEnd,
                v: gistOf(ctx, bytes.subarray(pendingStart, pendingEnd)),
            });
        }
        pendingStart = -1;
        pendingEnd = -1;
    };
    const walk = (n, start) => {
        if (n.kids === null) {
            const end = start + (n.leaf?.length ?? 0);
            if (pendingStart < 0)
                pendingStart = start;
            pendingEnd = end;
            return end;
        }
        if (isChunk(n)) {
            flush();
            let end = start;
            for (const c of n.kids)
                end += c.leaf?.length ?? 0;
            out.push({ start, end, v: gistOf(ctx, bytes.subarray(start, end)) });
            return end;
        }
        flush();
        let pos = start;
        for (const c of n.kids)
            pos = walk(c, pos);
        return pos;
    };
    walk(tree, 0);
    flush();
    return out;
}
