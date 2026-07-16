import type { MindContext } from "./types.js";
/** Re-voice an answer in the asker's own words.  For each recognised form
 *  in the answer, find a concept-sibling in the query (by halo resonance)
 *  and substitute the asker's wording.  The search's own cover mechanism
 *  splices the substitutes into the answer exactly where the forms sit. */
export declare function articulate(ctx: MindContext, answer: Uint8Array, query: Uint8Array | null): Promise<Uint8Array>;
