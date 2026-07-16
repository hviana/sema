import { Sema } from "../sema.js";
import type { Input, MindContext } from "./types.js";
/** Intern a perceived tree into node ids, bottom-up, sharing equal subtrees.
 *  Returns the root node id and a map from tree nodes to their ids.
 *
 *  Memoized by NODE IDENTITY (ctx._internIds): the pyramid fold shares a
 *  prefix's subtree OBJECTS across an accumulated context's deposits, and a
 *  node already interned needs nothing again — its id is permanent
 *  (content-addressed) and its intern-time side effects (gist capture, kid
 *  rows) fired at first mint; re-interning was pure lookups.  A memo hit
 *  therefore skips the WHOLE shared subtree, making the intern walk
 *  O(new nodes) per deposit instead of O(context).  Only the hit node
 *  itself enters `ids`; descendants stay reachable via the memo (see
 *  idOf in indexSubSpans and the changedNodes prune). */
export declare function internTreeIds(ctx: MindContext, node: Sema, ids: Map<Sema, number>): Promise<number>;
/** Index flat branches for sub-spans of a deposit's byte stream, linked to
 *  their structural chunks via durable CONTAINMENT edges. */
export declare function indexSubSpans(ctx: MindContext, tree: Sema, ids: Map<Sema, number>): Promise<boolean>;
/** Perceive, intern, and index a single input.  Returns the perceived tree,
 *  root id, id map, and the changed (new) subtrees for halo reinforcement. */
export declare function deposit(ctx: MindContext, input: Input, track: boolean): Promise<{
    tree: Sema;
    rootId: number;
    ids: Map<Sema, number>;
    changed: Sema[];
}>;
/** Ingest a single input (a bare experience, no continuation). */
export declare function ingestOne(ctx: MindContext, input: Input): Promise<Sema & {
    id: number;
}>;
/** Ingest a pair (context, continuation) — learn an edge and pour halos. */
export declare function ingestPair(ctx: MindContext, ctxInput: Input, cont: Input): Promise<void>;
/** Dispatch the public ingest input shapes onto one-input / pair handlers —
 *  THE one reading of ingest's polymorphic surface (scalar, (context,
 *  continuation) pair, or a list mixing bare inputs and pairs).  Both ingest
 *  paths — the direct one below and {@link CachedIngest} — route through
 *  this, so the shape-detection can never drift between them again (the
 *  ingest cache once re-implemented it and drifted). */
export declare function dispatchIngest(input: Input | (Input | [Input, Input])[], second: Input | undefined, onOne: (input: Input) => Promise<Sema & {
    id: number;
}>, onPair: (ctxInput: Input, cont: Input) => Promise<void>): Promise<(Sema & {
    id: number;
}) | undefined>;
/** Ingest an input or array of inputs/pairs.  The public ingest entry point. */
export declare function ingest(ctx: MindContext, input: Input | (Input | [Input, Input])[], second?: Input): Promise<(Sema & {
    id: number;
}) | undefined>;
