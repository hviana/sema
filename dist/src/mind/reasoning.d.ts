import type { MindContext } from "./types.js";
import type { Precomputed } from "./pipeline-mechanism.js";
/** Whether `bytes` is a proper byte-subspan of `query` — already present in
 *  the question, so voicing it back only restates part of what was asked,
 *  never answers it.  The exact guard recallByResonance already applies to
 *  its OWN grounding candidates (tier 1's `restates`, tier 2's subspan
 *  check, tier 0b's argument-binding subspan check) — every mechanism that
 *  walks a LEARNT CONTINUATION EDGE past an already-vetted grounding
 *  (reason()'s own hops below, and CAST's `projectCounterfactual` seat
 *  substitution — see cast.ts) needs the same guard applied to what the
 *  walk turns up, since `follow()`/`chooseNext`/`pivotInto` know nothing of
 *  the query at all — only of what structurally continues what. */
export declare function restatesQuery(query: Uint8Array, bytes: Uint8Array): boolean;
/** Extend a grounded answer forward across facts (multi-hop reasoning).
 *  Pivots on the longest unconsumed learnt context each answer contains,
 *  then follows the pivot's continuation to the next fact.  Repeats up
 *  to `cfg.recallQueryK` hops.  `preConsumed` carries node ids already
 *  spoken for by the grounding stage (cover/extract/CAST).  `voiced` carries
 *  the BYTES of the anchors a mechanism declared it voiced (its `used` set),
 *  when it declared one — see the pivot's own containment rule.  `pre` is the
 *  response's shared pre-computation — the post-grounding stages read the
 *  same container the mechanisms did. */
export declare function reason(ctx: MindContext, query: Uint8Array, answer: Uint8Array, preConsumed: ReadonlySet<number>, pre: Precomputed, voiced?: readonly Uint8Array[]): Promise<Uint8Array>;
/** Fuse independent points of attention into one answer (multi-topic).
 *  When the consensus climb finds more than one dominant point, each
 *  independent point grounds its own answer; they are bridged together
 *  by any learnt connector the graph holds between them. */
export declare function fuseAttention(ctx: MindContext, query: Uint8Array, primary: Uint8Array, pre: Precomputed, 
/** True when `primary` never touched the consensus climb at all — e.g. a
 *  pure ALU computation, which has no anchor of its own.  commitVotes
 *  ALWAYS admits the dominant root regardless of its vote (attention.ts:
 *  "roots.length === 0 || …") on the assumption a lone root already IS
 *  primary's own source; that assumption is exactly backwards when
 *  primary is unclimbed.  Absent or false preserves the original
 *  behaviour exactly. */
unclimbed?: boolean, 
/** The query spans `primary`'s own grounding stands on — used ONLY to place
 *  primary in the fused reading order (see below).  Resolved by the caller,
 *  which is the layer that knows how a given grounding records its evidence;
 *  fuseAttention just reads a position from it.  Empty or absent preserves
 *  the original behaviour exactly. */
primarySpans?: ReadonlyArray<readonly [number, number]>): Promise<Uint8Array>;
