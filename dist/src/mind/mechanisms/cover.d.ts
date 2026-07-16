import type { MindContext } from "../types.js";
import type { Site } from "../graph-search.js";
import type { PipelineMechanism } from "../pipeline-mechanism.js";
export declare function resolveConcepts(
  ctx: MindContext,
  sites: Site[],
): Promise<Map<number, number>>;
export declare function resolveConnectors(
  ctx: MindContext,
  sites: ReadonlyArray<Site>,
): Promise<Map<string, Uint8Array>>;
export declare const coverMechanism: PipelineMechanism;
