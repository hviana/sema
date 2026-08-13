import type { MindContext } from "../types.js";
import type { MechanismResult, PipelineMechanism, Precomputed } from "../pipeline-mechanism.js";
/** Voice the query's referents through their frame's own attested carriage, or
 *  null when the corpus does not attest one. */
export declare function bindReference(ctx: MindContext, query: Uint8Array, pre: Precomputed): Promise<MechanismResult | null>;
export declare const referenceMechanism: PipelineMechanism;
