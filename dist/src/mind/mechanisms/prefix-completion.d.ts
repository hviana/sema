import type { MindContext } from "../types.js";
import type { PipelineMechanism } from "../pipeline-mechanism.js";
/** A trained form the query opens, and the bytes by which it continues. */
export interface PrefixCompletion {
    /** The trained form whose opening the query is — the answer, voiced whole. */
    id: number;
    /** The form's own bytes.  The mechanism grounds a FORM, never a slice of
     *  one: slicing at the query's end would cut at an offset the geometry has
     *  no reason to treat as a boundary. */
    form: Uint8Array;
    /** The bytes past the query — carried for the rationale and for the
     *  uniqueness comparison, not voiced on its own. */
    continuation: Uint8Array;
}
/** The sole trained form the query opens — or null when no candidate opens with
 *  it, when the continuation is sub-quantum, when a candidate's continuation
 *  cannot be read through, or when the candidates disagree.
 *
 *  `ranked` must be a list the caller has ALREADY fetched; this mechanism never
 *  resonates on its own (see the header's cost note). */
export declare function prefixCompletion(ctx: MindContext, query: Uint8Array, ranked: ReadonlyArray<number>): PrefixCompletion | null;
export declare const prefixMechanism: PipelineMechanism;
