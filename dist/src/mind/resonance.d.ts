import type { MindContext } from "./types.js";
/** The connector that belongs BETWEEN two adjacent results — the graded
 *  junction ladder described in the module note above.  Returns null when
 *  the graph holds no evidence that the two ever ran together. */
export declare function bridge(ctx: MindContext, left: Uint8Array, right: Uint8Array, interiorAllowance?: number): Promise<Uint8Array | null>;
/** Join two spans with the learnt connector between them, when one exists —
 *  the composition step every out-of-search assembly (multi-topic fusion,
 *  CAST's substitution and comparison) shares.  A miss joins the pieces BARE
 *  and is never silent: it emits the same `bridgeMiss` trace step everywhere,
 *  so a degraded join is visible in the rationale regardless of which
 *  mechanism paid it.  (The in-search connector splice in graph-search.ts is
 *  the same concept inside the deduction, where the join is a costed rule.) */
export declare function joinWithBridge(ctx: MindContext, left: Uint8Array, right: Uint8Array): Promise<Uint8Array>;
/** The pivot a produced answer bridges through: the longest UNCONSUMED learnt
 *  CONTEXT (a node bearing a continuation edge) whose bytes `answer` literally
 *  contains.  Candidates are gathered by resonating the answer's sub-regions
 *  (breadth-first, leaves skipped, probes capped by branch count), then
 *  confirmed by exact byte containment — a near-resonance alone never hops.
 *
 *  `voiced` carries the BYTES of the anchors the grounding mechanism declared
 *  it spoke for, and no candidate CONTAINED IN one of them may be pivoted
 *  through.  Node identity alone is too coarse a reading of "already spoken
 *  for": the same content is interned at several scales, so a strict fragment
 *  of a voiced anchor is a different id carrying no evidence the anchor did
 *  not already carry.  Measured on test/29 C2 — CAST voiced "William
 *  Shakespeare" (id 676) and the pivot hopped through "speare" (id 606, not
 *  in `consumed`) straight into that analog's own biography, which is exactly
 *  what the comparison had refused to voice.  The rule is CONTAINMENT, not
 *  overlap, so C3's genuine further hop — "Mona Lisa", a term inside the seat
 *  sentence but part of NEITHER analog — still fires. */
export declare function pivotInto(ctx: MindContext, answer: Uint8Array, consumed: ReadonlySet<number>, voiced?: readonly Uint8Array[]): Promise<number | null>;
export declare function meaningOf(ctx: MindContext, bytes: Uint8Array, anchors: ReadonlyArray<{
    name: string;
    form: Uint8Array;
}>): Promise<string | null>;
