import type { DerivationStep } from "./graph-search.js";
import type { AncestorReach, Attention, AttentionRead, DFMode, MindContext, Region, RegionVote, SaturationInfo } from "./types.js";
/** Climb the query's perceived byte regions up the structural DAG via
 *  resonance, pool the evidence, and return only the ROOT points of
 *  attention — those that cleared commitVotes' significance floor. */
export declare function climbAttention(ctx: MindContext, query: Uint8Array, k: number, mode?: DFMode): Promise<Attention[]>;
/** Full read-out of one consensus climb: both the roots (dominant points of
 *  attention) and the entire ranked list.  Cached via ctx.climbMemo when
 *  ctx.trace is null. */
export declare function climbAttentionAll(ctx: MindContext, query: Uint8Array, k: number, mode?: DFMode): Promise<AttentionRead>;
export declare function computeAttention(ctx: MindContext, query: Uint8Array, k: number, mode: DFMode): Promise<AttentionRead>;
export declare function collectRegions(ctx: MindContext, query: Uint8Array): Region[];
export declare function voteRegions(ctx: MindContext, query: Uint8Array, regions: readonly Region[], k: number, mode: DFMode, N: number, reachMemo?: Map<number, AncestorReach>): Promise<{
    votes: RegionVote[];
    saturated: boolean[];
    voters: Array<{
        id: number;
        score: number;
        w: number;
    } | null>;
}>;
/** The consensus vote as EVIDENCE POOLING, not shortest path: each surviving
 *  region is an axiom; it contributes to every root it climbed to (or, for a
 *  terminal answer node, to the contexts that lead to it) by a `combine:
 *  "sum"` rule, so independent regions corroborating the same anchor ADD
 *  rather than compete to be the cheapest route (see {@link Rule.combine} in
 *  derive/src/deduction.ts).  Run through the very engine {@link
 *  GraphSearch} covers with — `lightestDerivation` — so a pooled-evidence
 *  decision is, like a followed edge or a spliced connector, one weighted
 *  rule of the SAME deduction system, not a separate hand-rolled tally that
 *  merely logs alongside it.  `votesIdf`/`support` are the same two
 *  read-outs {@link commitVotes} always gated on; only how they accumulate
 *  changed. */
export declare function poolVotes(ctx: MindContext, regionVotes: readonly RegionVote[], sat: SaturationInfo, N: number): {
    votes: Map<number, number>;
    votesIdf: Map<number, number>;
    support: Map<number, {
        start: number;
        end: number;
        w: number;
    }>;
    steps: DerivationStep[];
};
export declare function commitVotes(ctx: MindContext, pooled: {
    votes: Map<number, number>;
    votesIdf: Map<number, number>;
    support: Map<number, {
        start: number;
        end: number;
        w: number;
    }>;
    steps: DerivationStep[];
}, sat: SaturationInfo, regions: readonly Region[], regionVoter: ReadonlyArray<{
    id: number;
    score: number;
    w: number;
} | null>, N: number): AttentionRead;
export declare function detectSaturated(ctx: MindContext, regions: ReadonlyArray<{
    start: number;
    end: number;
    chunk?: boolean;
}>, saturated: ReadonlyArray<boolean>): SaturationInfo;
export declare function canonicalChunkId(ctx: MindContext, regionBytes: Uint8Array, N: number, reachMemo?: Map<number, AncestorReach>): number | null;
export declare function naturalBreak(votes: number[]): number;
export declare function traceAttention(ctx: MindContext, regions: ReadonlyArray<{
    start: number;
    end: number;
}>, regionVoter: ReadonlyArray<{
    id: number;
    score: number;
    w: number;
} | null>, roots: ReadonlyArray<Attention>, steps?: ReadonlyArray<DerivationStep>): void;
