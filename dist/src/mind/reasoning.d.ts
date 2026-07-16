import type { MindContext } from "./types.js";
import type { Precomputed } from "./pipeline-mechanism.js";
/** Extend a grounded answer forward across facts (multi-hop reasoning).
 *  Pivots on the longest unconsumed learnt context each answer contains,
 *  then follows the pivot's continuation to the next fact.  Repeats up
 *  to `cfg.recallQueryK` hops.  `preConsumed` carries node ids already
 *  spoken for by the grounding stage (cover/extract/CAST).  `pre` is the
 *  response's shared pre-computation — the post-grounding stages read the
 *  same container the mechanisms did. */
export declare function reason(ctx: MindContext, query: Uint8Array, answer: Uint8Array, preConsumed: ReadonlySet<number>, pre: Precomputed): Promise<Uint8Array>;
/** Fuse independent points of attention into one answer (multi-topic).
 *  When the consensus climb finds more than one dominant point, each
 *  independent point grounds its own answer; they are bridged together
 *  by any learnt connector the graph holds between them. */
export declare function fuseAttention(ctx: MindContext, query: Uint8Array, primary: Uint8Array, pre: Precomputed): Promise<Uint8Array>;
