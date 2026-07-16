import type { MindContext } from "./types.js";
import { type PipelineMechanism } from "./pipeline-mechanism.js";
export { resolveConcepts, resolveConnectors } from "./mechanisms/cover.js";
export { aluToMechanism } from "./mechanisms/alu.js";
export declare const defaultMechanisms: PipelineMechanism[];
export type Provenance =
  | "cast"
  | "join"
  | "cover"
  | "extract"
  | "recall"
  | "recall-echo";
export interface Thought {
  bytes: Uint8Array;
  provenance: Provenance;
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
export declare function think(
  ctx: MindContext,
  query: Uint8Array,
  mechs?: readonly PipelineMechanism[],
): Promise<Thought | null>;
