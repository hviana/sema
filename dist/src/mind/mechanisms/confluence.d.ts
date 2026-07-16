import type { MindContext } from "../types.js";
import type { PipelineMechanism, Precomputed } from "../pipeline-mechanism.js";
/** A join answer plus its elementary evidence for think's grounding decider:
 *  `accounted` — the query spans whose votes carried the two constraint
 *  streams; `moves` — the ladder cost of the acts performed (two constraint
 *  matches and one meet, STEP each).  `used` carries the pair's exemplar
 *  anchors so the reasoning stage does not re-speak them. */
export interface JoinResult {
  bytes: Uint8Array;
  used: ReadonlySet<number>;
  accounted: Array<[number, number]>;
  moves: number;
  /** A human-readable label for the query bytes the meet left unexplained —
   *  purely diagnostic, never priced. */
  unexplained: string;
}
/** The main confluence entry point.  Given a query, detect whether it weaves
 *  two or more INDEPENDENT constraints (ranked anchors supported by disjoint
 *  query spans), intersect the constraints' evidence by content-addressed
 *  identity, and return the discriminative content the streams share — the
 *  entity that satisfies all constraints at once.  Null when the query is
 *  not conjunctive or nothing lies in the intersection. */
export declare function confluenceJoin(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
): Promise<JoinResult | null>;
export declare const confluenceMechanism: PipelineMechanism;
