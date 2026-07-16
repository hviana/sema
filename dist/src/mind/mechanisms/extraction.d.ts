import type { Vec } from "../../vec.js";
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
/** Check whether an anchor is a span-shaped skill exemplar: it represents a
 *  fact whose context and answer together form a span-in-context pattern.
 *  If the anchor has a nextOf continuation, that is the answer and the anchor
 *  itself is the context.  Otherwise the anchor's prevOf parents provide
 *  candidate contexts, and the longest one whose span is span-shaped wins. */
export declare function skillExemplar(ctx: MindContext, anchor: number, guide?: Vec | null): Promise<{
    contextBytes: Uint8Array;
    answerBytes: Uint8Array;
} | null>;
/** Whether the answer is a SPARSE subsequence of the context (bytes in
 *  order, arbitrary gaps) — the OPEN span-shape reading (see the section
 *  note above).  This is what lets extraction validate a MULTI-PIECE
 *  exemplar whose answer is stitched from several context runs — but it is
 *  deliberately permissive, so it must never be used as evidence that one
 *  span was "drawn from" another (see {@link containsSpan} for that).
 *
 *  There is deliberately NO containsSpan pre-check here: strict containment
 *  IMPLIES the subsequence embedding (a contiguous run, or a resolved node —
 *  whose content-addressed identity means its bytes occur contiguously — is
 *  an in-order embedding with zero gaps), so the scan below decides alone,
 *  with the same truth value.  The old pre-check re-perceived the context
 *  (a full river fold) per CANDIDATE in skillExemplar's √N-capped loop —
 *  pure cost, no discrimination. */
export declare function isSpanShaped(_ctx: MindContext, context: Uint8Array, answer: Uint8Array): boolean;
/** STRICT containment: the answer's resolved node appears in the context's
 *  folded tree, or the answer occurs as one CONTIGUOUS byte run of the
 *  context.  This is real evidence the answer was drawn from the context.
 *  Fusion gates on this — the sparse-subsequence reading of
 *  {@link isSpanShaped} is trivially satisfied by short answers over long
 *  queries ("cold" is a gap-tolerant subsequence of most sentences holding
 *  c…o…l…d in order), and gating fusion on it silently starved multi-topic
 *  queries of their further points of attention. */
export declare function containsSpan(ctx: MindContext, context: Uint8Array, answer: Uint8Array): boolean;
export declare const extractionMechanism: PipelineMechanism;
