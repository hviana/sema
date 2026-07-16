import type { MindContext } from "../types.js";
import type { PipelineMechanism, Precomputed } from "../pipeline-mechanism.js";
/** A recall result. */
export interface RecallResult {
    bytes: Uint8Array;
    echoed: boolean;
    accounted: Array<[number, number]>;
    moves: number;
    unexplained: string;
}
/** Recall the answer by resonating the whole query against the content index. */
export declare function recallByResonance(ctx: MindContext, query: Uint8Array, pre: Precomputed): Promise<RecallResult | null>;
export declare const recallMechanism: PipelineMechanism;
