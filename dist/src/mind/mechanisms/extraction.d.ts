import type { MindContext } from "../types.js";
import type { PipelineMechanism, Precomputed } from "../pipeline-mechanism.js";
/** Find the first span-shaped skill exemplar among the ranked anchors from
 *  climbAttentionAll and read the analogous span from the query.  Returns
 *  the extracted bytes PLUS the query spans the skill ACCOUNTED FOR — the
 *  located frames AND any read span BOUNDED by located frames on both
 *  sides, the elementary evidence think's grounding decider weighs.  A
 *  bounded read is explained: the skill located both its borders in the
 *  query and emitted exactly what sits between them.  An OPEN-ENDED read
 *  (the exemplar's answer reaches the context's end, so the query is read
 *  to its own end with no located right border) remains a guess about where
 *  the span stops — it stays unaccounted, priced by exclusion like the
 *  cover's bridged bytes.  (Accounting frames only — the earlier convention
 *  — let a CAST juxtaposition that merely echoed the query's exact site
 *  outweigh a correct bounded extraction: the same span counted as
 *  explained for one mechanism and not the other, and the asymmetry, not
 *  the answers' merits, decided the grounding.)  Null when no skill
 *  applies. */
export declare function extractBySkill(ctx: MindContext, query: Uint8Array, pre: Precomputed): Promise<{
    bytes: Uint8Array;
    accounted: Array<[number, number]>;
    unexplained: string;
} | null>;
/** Decompose an answer into substrings of its surrounding context, in order —
 *  the STRONG span-shape reading (see the section note above).  Returns null
 *  when no greedy longest-run decomposition exists.  Adjacent runs that
 *  connect contiguously are merged. */
export declare function answerRunsInContext(_ctx: MindContext, context: Uint8Array, answer: Uint8Array): Array<{
    start: number;
    end: number;
    ansLen: number;
}> | null;
export declare const extractionMechanism: PipelineMechanism;
