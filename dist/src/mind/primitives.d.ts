import { Vec } from "../vec.js";
import { Sema } from "../sema.js";
import type { Input, MindContext } from "./types.js";
/** The content key of a byte span — one latin1 char per byte, an exact,
 *  collision-free encoding.  Spans on the perception path are query-scale
 *  (windows, regions, candidate spans), so key construction is far cheaper
 *  than the river fold it deduplicates. */
export declare function latin1Key(bytes: Uint8Array): string;
/** The {@link perceive} memo key: the span's content PLUS the boundary set it
 *  was folded under.  The tree is a function of BOTH — the same bytes fold
 *  plainly with no boundaries and into a left-nested stable-prefix shape with
 *  them — so a content-only key returns whichever shape was computed first.
 *  That is exactly what happened: a conversation seeded its cumulative context
 *  under the content key, and every later plain `perceive` of those bytes was
 *  served the boundary tree instead (measured: respondTurn answered where
 *  respond() on byte-identical input did not).  NUL separates the two parts —
 *  the boundary rendering is digits and commas, so no content byte can forge
 *  the split. */
export declare function perceiveKey(bytes: Uint8Array, boundaries?: readonly number[]): string;
/** Perceive input into a content-defined tree (the river fold).
 *  Deterministic — identical bytes always produce an identical tree.
 *
 *  `boundaries` is an optional sorted list of proper byte offsets where the
 *  fold must split so that each prefix segment folds identically to how it
 *  folded when it was learned (§10.3 stable-prefix contract).  Only the
 *  CALLER — who assembled the multi-turn context — knows where those
 *  boundaries are; the geometry never guesses them from the bytes. */
export declare function perceive(ctx: MindContext, input: Input, leafAt?: (i: number) => number | null, lookup?: (ids: number[]) => number | null, boundaries?: readonly number[]): Sema;
/** The DEPOSIT-shaped perceive.  Folds over the stream's own content cuts —
 *  bit-identical to what inference computes for the same bytes.  That
 *  train/inference agreement is the whole contract: the trained context node
 *  and the node `resolve(query)` reaches must be the SAME node, and the only
 *  way to guarantee it is to give this function nothing extra to say.  It
 *  imposes no boundaries, knows nothing about turns, and reads no convention
 *  out of the bytes.
 *
 *  An input that EXTENDS a previously deposited one — a conversation context
 *  grown by a turn, or a resumed replay — reuses that deposit's already-folded
 *  content segments ({@link contentFoldIncremental}), so it costs O(new bytes)
 *  instead of O(context).  The reuse is TRANSPARENT by construction: a segment
 *  is a pure function of its own bytes, so a reused one is bit-identical to a
 *  refolded one.  Nothing has to prove that the extending deposit is "really"
 *  a next turn — a coincidental byte prefix reuses the same segments and gets
 *  the same tree it would have got anyway.  (It used to matter: while this
 *  path imposed turn BOUNDARIES, a wrong guess changed the tree, so the cache
 *  needed a continuation-bytes proof to gate it.  Nothing is imposed now, so
 *  there is nothing to gate.) */
export declare function perceiveDeposit(ctx: MindContext, bytes: Uint8Array, conversational?: boolean): Sema;
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
/** Equivalence-class resolution: when the exact content-addressed lookup
 *  misses, find a stored node whose CANONICAL key equals the span's — the
 *  store's canon index proposes candidates by key hash, and each is verified
 *  by re-canonicalizing its bytes (hash-then-verify, like every content
 *  lookup).  Among verified candidates, one that leads somewhere (has a
 *  continuation edge) is preferred; ties break to the lowest id — a corpus
 *  property, not a seed property.  Null when the response carries no
 *  canonicalizer, the store has no canon index, or nothing verifies. */
export declare function canonResolve(ctx: MindContext, bytes: Uint8Array): number | null;
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
