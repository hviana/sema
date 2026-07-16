import type { MindContext } from "../types.js";
/** A CAST answer plus its elementary evidence for think's grounding decider:
 *  `accounted` — the query spans the weave's aligned runs explain; `moves` —
 *  the ladder cost of the acts the taken branch performed (STEP per
 *  projection, CONCEPT for the halo-mediated analogy gate). */
export interface CastResult {
  bytes: Uint8Array;
  used: ReadonlySet<number>;
  accounted: Array<[number, number]>;
  moves: number;
  /** A human-readable label for the query bytes this schema left
   *  unexplained — purely diagnostic, never priced (see the module's
   *  Task 2 note in pipeline.ts's Candidate interface). */
  unexplained: string;
}
/** CAST's own entry gates, checked once here and reused by
/** The main CAST entry point.  Given a query and its pre-computed pre.rec.sites,
 *  determine whether the query weaves together multiple independent learnt
 *  structures (by graded alignment — literal first, then halo-matched pre.rec.sites).
 *  If so, attempt substitution, redirection, AND analogical comparison —
 *  each schema is tried independently and every one that fires yields its
 *  OWN candidate; think's grounding decider (which already compares weights
 *  across mechanisms) picks among them, so CAST no longer needs an internal
 *  priority order.
 *
 *  `climb`, when given, is {@link castFloor}'s own climb result — reused
 *  instead of re-running climbAttentionAll (see the note on {@link
 *  CastFloor}).  Its gates (`query.length`, `edgeSourceCount`,
 *  `ranked.length < 2`) MUST stay in sync with castFloor's — one is the
 *  other's admissible lower bound, checked before this runs.
 *
 *  Returns the array of {@link CastResult}s that fired (possibly empty). */
export declare function counterfactualTransfer(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
): Promise<CastResult[]>;
import type { PipelineMechanism, Precomputed } from "../pipeline-mechanism.js";
export declare const castMechanism: PipelineMechanism;
