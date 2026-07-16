import { Vec } from "../vec.js";
import { Sema } from "../sema.js";
import type { Input, MindContext } from "./types.js";
/** Perceive input into a content-defined tree (the river fold).
 *  Deterministic — identical bytes always produce an identical tree. */
export declare function perceive(ctx: MindContext, input: Input, leafAt?: (i: number) => number | null, lookup?: (ids: number[]) => number | null): Sema;
/** The DEPOSIT-shaped perceive: the PLAIN fold (bit-identical to inference
 *  perception — that structural train/inference agreement is load-bearing
 *  for exact recall), computed INCREMENTALLY via the fold's level pyramid
 *  ({@link bytesToTreePyramid}).  An accumulated context (a conversation)
 *  grows by suffixes: the previous context's pyramid is cached by CONTENT
 *  (ctx._depositTrees), and this deposit refolds only the right edge of
 *  each level — O(turn) instead of O(context) per turn.  Purely a cache:
 *  the produced tree never depends on cache state. */
export declare function perceiveDeposit(ctx: MindContext, bytes: Uint8Array): Sema;
/** The raw bytes of an input — modality-neutral conversion. */
export declare function inputBytes(ctx: MindContext, input: Input): Uint8Array;
/** Convenience: the gist vector of a byte span. */
export declare function gistOf(ctx: MindContext, bytes: Uint8Array): Vec;
/** Fold a perceived tree bottom-up against the store's content-addressed maps:
 *  every leaf is named by findLeaf, every branch by findBranch over its kids'
 *  ids (null the moment any child is unknown).  `visit`, when given, sees each
 *  node with its byte span and resolved id.  Returns the node's byte end and
 *  resolved id. */
export declare function foldTree(ctx: MindContext, n: Sema, start: number, visit?: (n: Sema, start: number, end: number, node: number | null) => void): {
    end: number;
    node: number | null;
};
/** The canonical node id of a byte span: perceive it in isolation — the way
 *  training did — and recover its root bottom-up.  Returns null if any part is
 *  unknown. */
export declare function resolve(ctx: MindContext, bytes: Uint8Array): number | null;
/** Walk a perceived tree in POST-ORDER with byte offsets — children before
 *  their parent, `visit(node, start, end)` for every node including leaves.
 *  Returns the byte end.  The one shared traversal the offset-carrying tree
 *  readers (recognition via foldTree's richer variant, attention's region
 *  collection, resonance's branch counting) build on, so each does not
 *  re-derive the offset bookkeeping.  (recognition.segment keeps its own
 *  walk: its flush semantics need PRE-order decisions at leaf-parents, which
 *  a post-order visitor cannot express.) */
export declare function walkTree(n: Sema, start: number, visit: (node: Sema, start: number, end: number) => void): number;
/** Reconstruct a node's byte content from the DAG, up to `maxLen` bytes. */
export declare function read(ctx: MindContext, id: number, maxLen?: number): Uint8Array;
