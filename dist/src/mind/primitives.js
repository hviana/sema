// primitives.ts — Address + Read primitives (Section 1 of the mind).
//
//   Address  — bytes → node   (perceive, foldTree, resolve)
//   Read     — node → bytes   (read)
import { bytesToTree, bytesToTreePyramid, gridToTree, hilbertBytes, stackGrids, } from "../geometry.js";
import { ALL } from "./types.js";
// ── Address: bytes → node ──────────────────────────────────────────────
/** The content key of a byte span — one latin1 char per byte, an exact,
 *  collision-free encoding.  Spans on the perception path are query-scale
 *  (windows, regions, candidate spans), so key construction is far cheaper
 *  than the river fold it deduplicates. */
function latin1Key(bytes) {
    // Batched String.fromCharCode — avoids the O(n²) cost of repeated += on
    // potentially-large query spans, and stays well under the ~65536 arg limit.
    const n = bytes.length;
    let s = "";
    for (let i = 0; i < n; i += 4096) {
        s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 4096, n)));
    }
    return s;
}
/** Perceive input into a content-defined tree (the river fold).
 *  Deterministic — identical bytes always produce an identical tree. */
export function perceive(ctx, input, leafAt, lookup) {
    if (typeof input === "string" || input instanceof Uint8Array) {
        const bytes = typeof input === "string"
            ? new TextEncoder().encode(input)
            : input;
        if (leafAt === undefined && lookup === undefined) {
            // Per-response memo (see MindContext.perceiveMemo): only the plain
            // inference shape — raw bytes, no store capabilities — is memoised,
            // keyed by CONTENT so byte-identical spans in fresh arrays still hit.
            // The tree is shared by reference; Sema nodes are never mutated.
            const memo = ctx.perceiveMemo;
            if (memo) {
                const key = latin1Key(bytes);
                const hit = memo.get(key);
                if (hit !== undefined)
                    return hit;
                const tree = bytesToTree(ctx.space, ctx.alphabet, bytes);
                memo.set(key, tree);
                return tree;
            }
            return bytesToTree(ctx.space, ctx.alphabet, bytes);
        }
        return bytesToTree(ctx.space, ctx.alphabet, bytes, leafAt, lookup);
    }
    if (Array.isArray(input)) {
        return gridToTree(ctx.space, ctx.alphabet, stackGrids(input));
    }
    return gridToTree(ctx.space, ctx.alphabet, input);
}
/** The DEPOSIT-shaped perceive: the PLAIN fold (bit-identical to inference
 *  perception — that structural train/inference agreement is load-bearing
 *  for exact recall), computed INCREMENTALLY via the fold's level pyramid
 *  ({@link bytesToTreePyramid}).  An accumulated context (a conversation)
 *  grows by suffixes: the previous context's pyramid is cached by CONTENT
 *  (ctx._depositTrees), and this deposit refolds only the right edge of
 *  each level — O(turn) instead of O(context) per turn.  Purely a cache:
 *  the produced tree never depends on cache state. */
export function perceiveDeposit(ctx, bytes) {
    let prev;
    // Longest cached PROPER prefix first.
    const lens = [...ctx._depositLens]
        .filter((L) => L >= 2 && L < bytes.length)
        .sort((a, b) => b - a);
    for (const L of lens) {
        const hit = ctx._depositTrees.get(latin1Key(bytes.subarray(0, L)));
        if (hit !== undefined) {
            prev = hit;
            break;
        }
    }
    const { tree, pyramid } = bytesToTreePyramid(ctx.space, ctx.alphabet, bytes, prev);
    if (bytes.length >= 2) {
        // The lengths set drifts as the map evicts; past the probe budget the
        // drift itself becomes the cost (each stale length is an O(len) key
        // build), so both reset together — losing only warm-up on live chains.
        if (ctx._depositLens.size > 64) {
            ctx._depositLens.clear();
            ctx._depositTrees.clear();
        }
        ctx._depositTrees.set(latin1Key(bytes), pyramid);
        ctx._depositLens.add(bytes.length);
    }
    return tree;
}
/** The raw bytes of an input — modality-neutral conversion. */
export function inputBytes(ctx, input) {
    if (typeof input === "string")
        return new TextEncoder().encode(input);
    if (input instanceof Uint8Array)
        return input;
    if (Array.isArray(input))
        return hilbertBytes(stackGrids(input));
    return hilbertBytes(input);
}
/** Convenience: the gist vector of a byte span. */
export function gistOf(ctx, bytes) {
    return perceive(ctx, bytes).v;
}
/** Fold a perceived tree bottom-up against the store's content-addressed maps:
 *  every leaf is named by findLeaf, every branch by findBranch over its kids'
 *  ids (null the moment any child is unknown).  `visit`, when given, sees each
 *  node with its byte span and resolved id.  Returns the node's byte end and
 *  resolved id. */
export function foldTree(ctx, n, start, visit) {
    if (n.kids === null) {
        const b = n.leaf ?? new Uint8Array(0);
        const end = start + b.length;
        const node = ctx.store.findLeaf(b);
        visit?.(n, start, end, node);
        return { end, node };
    }
    let pos = start;
    let known = true;
    const kids = [];
    for (const k of n.kids) {
        const r = foldTree(ctx, k, pos, visit);
        if (r.node === null)
            known = false;
        else if (known)
            kids.push(r.node);
        pos = r.end;
    }
    const node = known ? ctx.store.findBranch(kids) : null;
    visit?.(n, start, pos, node);
    return { end: pos, node };
}
/** The canonical node id of a byte span: perceive it in isolation — the way
 *  training did — and recover its root bottom-up.  Returns null if any part is
 *  unknown. */
export function resolve(ctx, bytes) {
    if (bytes.length === 0)
        return null;
    return foldTree(ctx, perceive(ctx, bytes), 0).node;
}
/** Walk a perceived tree in POST-ORDER with byte offsets — children before
 *  their parent, `visit(node, start, end)` for every node including leaves.
 *  Returns the byte end.  The one shared traversal the offset-carrying tree
 *  readers (recognition via foldTree's richer variant, attention's region
 *  collection, resonance's branch counting) build on, so each does not
 *  re-derive the offset bookkeeping.  (recognition.segment keeps its own
 *  walk: its flush semantics need PRE-order decisions at leaf-parents, which
 *  a post-order visitor cannot express.) */
export function walkTree(n, start, visit) {
    if (n.kids === null) {
        const end = start + (n.leaf?.length ?? 0);
        visit(n, start, end);
        return end;
    }
    let pos = start;
    for (const k of n.kids)
        pos = walkTree(k, pos, visit);
    visit(n, start, pos);
    return pos;
}
// ── Read: node → bytes ──────────────────────────────────────────────────
/** Reconstruct a node's byte content from the DAG, up to `maxLen` bytes. */
export function read(ctx, id, maxLen = ALL) {
    return ctx.store.bytesPrefix(id, maxLen);
}
