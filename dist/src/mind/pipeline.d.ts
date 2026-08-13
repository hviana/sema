import type { MindContext } from "./types.js";
import { type PipelineMechanism } from "./pipeline-mechanism.js";
export { resolveConcepts, resolveConnectors } from "./mechanisms/cover.js";
export { aluToMechanism } from "./mechanisms/alu.js";
export declare const defaultMechanisms: PipelineMechanism[];
export type Provenance = "cast" | "join" | "cover" | "extract" | "reference" | "recall" | "recall-echo" | "prefix";
export interface Thought {
    bytes: Uint8Array;
    provenance: Provenance;
}
/** Structured payload of the "decideGrounding" rationale step — the same
 *  numbers the human-readable candidate labels already carry, exposed as
 *  data so a downstream tool need not parse free text.  Purely additive
 *  instrumentation: built only under `ctx.trace?.` (optional chaining
 *  short-circuits its arguments), never read by inference. */
export interface DecideGroundingData {
    version: 1;
    /** Every grounding candidate weighed, in consideration order. */
    candidates: Array<{
        provenance: string;
        /** The candidate's exact weight in the one cost ladder. */
        weight: number;
        /** The DISCRETE grade the decision actually compares (floor(weight/STEP)). */
        grade: number;
        /** Query bytes the candidate's accounted spans leave unexplained. */
        unexplainedBytes: number;
        /** Whether this candidate won the decision. */
        decided: boolean;
    }>;
    /** Grade margin between the winner and the runner-up, when both exist —
     *  the same quantity the "narrowDecision" step reports as narrow when
     *  ≤ 1.  Absent for a single-candidate decision. */
    runnerUpMargin?: number;
}
/** Structured payload of the "narrowDecision" rationale step. */
export interface NarrowDecisionData {
    version: 1;
    margin: number;
}
/** Think: a single lightest-derivation exploration of the Sema graph.
 *
 *  Every answer travels the same path:
 *    1. Pre-computation — recognise, extension parse, guide; everything
 *       expensive stays lazy on Precomputed until a mechanism asks.
 *    2. Grounding — every mechanism yields candidates weighed in the one
 *       cost ladder; the lightest grounding derivation wins.
 *    3. Post-grounding — diagnostics (narrowDecision, thinGrounding),
 *       reasoning (multi-hop), fusion (multi-topic). */
export declare function think(ctx: MindContext, query: Uint8Array, mechs?: readonly PipelineMechanism[]): Promise<Thought | null>;
