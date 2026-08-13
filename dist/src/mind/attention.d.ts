import type { DerivationStep } from "./graph-search.js";
import type { AncestorReach, Attention, AttentionRead, DFMode, MindContext, Region, RegionVote, SaturationInfo, SaturationStop } from "./types.js";
import { type StructuralPart } from "../geometry.js";
import { type JunctionSynonymSides } from "./junction.js";
import type { Vec } from "../vec.js";
/** How the newly-added graded junction ladder (junction.ts / attention.ts's
 *  {@link CrossRegionTier}) is reported on a `junctionVotes` entry.  The
 *  instrumentation spec this implements predates that ladder and only knew
 *  two tiers ("exact" | "synonym"); with the richer `CrossRegionTier` now
 *  the real shape of a junction vote's provenance, `junctionVotes[].tier`
 *  reports it DIRECTLY (the tier as-is: "exact" | "single-synonym" |
 *  "double-synonym" | "structural-resonance") rather than collapsing every
 *  non-exact tier into a lossy "synonym" bucket — the whole point of
 *  exposing `tier` here is to let a debugger tell a halo-sibling
 *  substitution apart from a structural-resonance ANN guess, which the
 *  spec's original two-value type cannot do. */
export type ClimbConsensusJunctionTier = CrossRegionTier;
export type RegionOutcome = "voted" | "no-ann-hit" | "no-structural-reach" | "saturated-abstention" | "nonpositive-df-weight" | "contrastive-margin-rejection";
/** The best DIFFERENT-conclusion rival the contrastive-margin gate found
 *  while scanning an ordinary (approximate) region's ANN hits — spec §1.
 *  Its roots/saturation/contextsReached are already available through
 *  `reaches` (serialiseReaches) for `node`; not duplicated here. */
export interface ConsensusContrastiveRivalTrace {
    node: number;
    rank: number;
    score: number;
}
export interface ConsensusRegionTrace {
    index: number;
    source: "perceived" | "recognised";
    span: [number, number];
    chunk: boolean;
    known: boolean;
    canonicalId?: number;
    canonicalUsable: boolean;
    canonicalFailed: boolean;
    annQueried: boolean;
    annHitsReturned: number;
    annHitsExamined: number;
    selected?: {
        source: "canonical" | "ann";
        node: number;
        rank?: number;
        score: number;
        fallback?: "orphan" | "saturated-tie";
    };
    reachNode?: number;
    outcome: RegionOutcome;
    idf?: number;
    dfWeight?: number;
    contrastiveMargin?: number;
    contrastiveNoiseFloor?: number;
    contrastiveRival?: ConsensusContrastiveRivalTrace;
    mutualWeight?: number;
    voteWeightPerRoot?: number;
    focusWeightPerRoot?: number;
    ordinaryVoteProduced: boolean;
    superseded: boolean;
}
export interface ConsensusReachTrace {
    node: number;
    roots: number[];
    contextsReached: number;
    saturated: boolean;
    saturation?: SaturationStop;
    /** Nodes the climb processed — see {@link AncestorReach.visited}.  Absent
     *  on payloads recorded before this field existed. */
    visited?: number;
    /** Maximum ascent distance — see {@link AncestorReach.maxDepth}. */
    maxDepth?: number;
}
export type AnchorRejectionReason = "below-natural-break" | "below-consensus-floor" | "leading-saturation";
export interface ConsensusAnchorTrace {
    anchor: number;
    rank: number;
    pooledVote: number;
    idfVote: number;
    candidateBreadth: number;
    contributingVotes: number;
    contributingEvidence: number;
    breadth: number;
    contributingSpans: Array<[number, number]>;
    clusters: number;
    commit: {
        status: "root" | "overlap" | "rejected";
        dominant: boolean;
        passesNaturalBreak?: boolean;
        passesConsensusFloor?: boolean;
        pastLeadingSaturation?: boolean;
        rejectionReasons: AnchorRejectionReason[];
    };
}
export interface JunctionVoteTrace {
    container: number;
    span: [number, number];
    roots: number[];
    sourceRegionIndices: number[];
    explainedAwayRegionIndices: number[];
    absorbed: number;
    tier?: ClimbConsensusJunctionTier;
    /** Zero-based index into `crossRegion.probes` — the probe this vote was
     *  produced from (spec §8). */
    probe: number;
    confidence: number;
    /** "Evidence bytes" — the container-coverage byte count (the existing
     *  `bestCov` variable at the push site). */
    evidenceBytes: number;
    mutualWeight: number;
    voteWeightPerRoot: number;
}
/** Whether one DAG/synonym tier attempt was even made for a probe, and how
 *  many candidate containers it returned — spec §2/§3. */
export interface CrossRegionTierAttemptTrace {
    attempted: boolean;
    candidatesReturned: number;
}
/** Aggregate outcome of the container-selection loop for a DAG/synonym tier
 *  that returned at least one container — spec §4.  Only aggregate counts
 *  and the final outcome are recorded, never every candidate. */
export interface CrossRegionStructuralTrace {
    tier: "exact" | "single-synonym" | "double-synonym";
    selfEvidenceRejected: number;
    contradictionRejected: number;
    passedGuards: number;
    selectedNode?: number;
    outcome: "all-rejected" | "saturated" | "no-roots" | "nonpositive-idf" | "accepted";
}
/** One retained structural-resonance variant that actually issued its own
 *  ANN query — spec §5. */
export interface StructuralResonanceVariantTrace {
    kind: StructuralVariant["kind"];
    semanticConfidence: number;
    leftSiblingId?: number;
    rightSiblingId?: number;
    annHitsReturned: number;
}
/** One merged structural-resonance proposal actually examined via
 *  edgeAncestors — spec §5.  Retains node/variant/scores, but NOT
 *  roots/saturation/contextsReached/idf (already in `reaches`). */
export interface StructuralResonanceCandidateTrace {
    node: number;
    variant: StructuralVariant["kind"];
    leftSiblingId?: number;
    rightSiblingId?: number;
    annScore: number;
    semanticConfidence: number;
    effectiveScore: number;
    outcome: "saturated" | "no-roots" | "nonpositive-idf" | "same-as-endpoint" | "same-as-selected" | "selected" | "contrastive-rival";
}
export interface StructuralResonanceTrace {
    variantBudget: number;
    variants: StructuralResonanceVariantTrace[];
    mergedProposals: number;
    examined: StructuralResonanceCandidateTrace[];
    contrastiveMargin?: number;
    noiseFloor: number;
    outcome: "ineligible" | "empty" | "no-valid-proposal" | "margin-rejected" | "accepted";
    ineligibleReasons?: Array<"between-region" | "not-both-strong" | "not-both-known" | "gap-too-large">;
}
/** One cross-region pair the ladder actually probed — spec §2.  Exactly one
 *  of these is pushed per pair that incremented `probes`. */
export interface CrossRegionProbeTrace {
    leftRegionIndex: number;
    rightRegionIndex: number;
    betweenRegionIndices: number[];
    exact: CrossRegionTierAttemptTrace;
    singleSynonym: CrossRegionTierAttemptTrace;
    doubleSynonym: CrossRegionTierAttemptTrace;
    structural?: CrossRegionStructuralTrace;
    resonance?: StructuralResonanceTrace;
    outcome: "accepted" | "structural-rejected" | "resonance-ineligible" | "resonance-rejected";
}
export interface ClimbConsensusData {
    version: 1;
    cache: {
        hit: boolean;
        detailAvailable: boolean;
    };
    config: {
        annK: number;
        crossRegionProbeLimit: number;
        mode: DFMode;
        corpusN?: number;
        dimension?: number;
        hubBound?: number;
        estimatorNoise?: number;
        naturalBreak?: number;
        consensusFloor?: number;
    };
    candidates: {
        perceived: number;
        recognised: number;
        total: number;
    };
    regions?: ConsensusRegionTrace[];
    reaches?: ConsensusReachTrace[];
    crossRegion?: {
        eligibleRegions: number;
        maximalRegions: number;
        probeLimit: number;
        probesAttempted: number;
        junctionVotes: JunctionVoteTrace[];
        supersededOrdinaryVotes: number;
        probes: CrossRegionProbeTrace[];
        stopReason: "insufficient-regions" | "probe-limit" | "pairs-exhausted";
    };
    saturation?: {
        regionIntervals: Array<{
            start: number;
            end: number;
        }>;
        hasLeading: boolean;
        leadingEnd: number;
    };
    pooling?: {
        inputVotes: number;
        eligibleVotes: number;
        saturationMaskedVotes: number;
    };
    anchors?: ConsensusAnchorTrace[];
    result: AttentionRead;
}
/** The mutable collection buffers threaded through one traced consensus
 *  climb — allocated exactly once, in {@link computeAttention}, only when
 *  `ctx.trace` is set.  Every field mirrors a `ClimbConsensusData` array/map,
 *  built incrementally as the pipeline runs so commit-time decisions (in
 *  particular) are recorded LIVE, not reconstructed afterward. */
interface TraceDraft {
    perceivedCount: number;
    regions: ConsensusRegionTrace[];
    crossRegionJunctionVotes: JunctionVoteTrace[];
    crossRegionSummary?: {
        eligibleRegions: number;
        maximalRegions: number;
        probeLimit: number;
        probesAttempted: number;
        stopReason?: "insufficient-regions" | "probe-limit" | "pairs-exhausted";
    };
    crossRegionProbes: CrossRegionProbeTrace[];
    supersededOrdinaryVotes: number;
    saturation?: {
        regionIntervals: Array<{
            start: number;
            end: number;
        }>;
        hasLeading: boolean;
        leadingEnd: number;
    };
    pooling?: {
        inputVotes: number;
        eligibleVotes: number;
        saturationMaskedVotes: number;
    };
    anchors: ConsensusAnchorTrace[];
}
/** The config/corpus context {@link traceAttention} needs to fill in
 *  `ClimbConsensusData.config` and `.result` at whichever exit fires —
 *  threaded down from {@link computeAttention} rather than re-derived, so
 *  every emission point reports the SAME numbers the real climb used. */
interface ClimbConsensusCfg {
    k: number;
    mode: DFMode;
    perceivedCount: number;
    totalRegions: number;
    N?: number;
    reachMemo?: ReadonlyMap<number, AncestorReach>;
    naturalBreak?: number;
    consensusFloor?: number;
}
/** Climb the query's perceived byte regions up the structural DAG via
 *  resonance, pool the evidence, and return only the ROOT points of
 *  attention — those that cleared commitVotes' significance floor. */
export declare function climbAttention(ctx: MindContext, query: Uint8Array, k: number, mode?: DFMode): Promise<Attention[]>;
/** Full read-out of one consensus climb: both the roots (dominant points of
 *  attention) and the entire ranked list.  Cached via ctx.climbMemo, ALWAYS —
 *  see {@link recognise} for why this memo (and recognise()'s own) is never
 *  gated on tracing.  The short of it: computeAttention's collectRegions
 *  votes over what walking the query's perceived tree EMITS, and foldTree's
 *  subtree-resolution fast path used to skip that walk on a warm cache, so a
 *  second climb over identical bytes saw less evidence than the first — which
 *  a conversation's shared prefix subtrees guaranteed by the second turn.
 *  foldTree now takes that fast path only when nothing is watching the walk
 *  (see primitives.ts), so the climb is idempotent on its own and this memo
 *  is an accelerator again.  It stays unconditional anyway: attaching a trace
 *  must not change which regions attention weighs.
 *
 *  A cache hit still emits a trace step — abbreviated, since the full
 *  per-sub-region voting detail {@link traceAttention} builds isn't preserved
 *  by the cached read-out — so a traced response is never silently blacked
 *  out for a repeated query. */
export declare function climbAttentionAll(ctx: MindContext, query: Uint8Array, k: number, mode?: DFMode): Promise<AttentionRead>;
export declare function computeAttention(ctx: MindContext, query: Uint8Array, k: number, mode: DFMode): Promise<AttentionRead>;
export declare function collectRegions(ctx: MindContext, query: Uint8Array): Region[];
export declare function voteRegions(ctx: MindContext, query: Uint8Array, regions: readonly Region[], k: number, mode: DFMode, N: number, reachMemo?: Map<number, AncestorReach>, td?: TraceDraft): Promise<{
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
export declare function poolVotes(ctx: MindContext, regionVotes: readonly RegionVote[], sat: SaturationInfo, N: number, td?: TraceDraft): {
    votes: Map<number, number>;
    votesIdf: Map<number, number>;
    support: Map<number, {
        start: number;
        end: number;
        w: number;
    }>;
    /** Per-anchor SCALE-INVARIANT support: Σ RegionVote.absorbed over the
     *  distinct contributing regions — see Attention.breadth. */
    regionSupport: Map<number, number>;
    /** Per-anchor contributing region spans — see Attention.clusters. */
    regionSpans: Map<number, Array<[number, number]>>;
    /** Per-anchor count of contributing region VOTES (pooled axioms), which is
     *  not the length of `regionSpans`: a joint binding is one vote sitting in
     *  several places. */
    regionAxioms: Map<number, number>;
    /** Per-anchor LARGEST single-region contribution — see Attention.peak. */
    regionPeak: Map<number, number>;
    /** Anchors with support from at least one NON-corroborating region. */
    anchored: Set<number>;
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
    regionSupport: Map<number, number>;
    regionSpans: Map<number, Array<[number, number]>>;
    regionAxioms: Map<number, number>;
    regionPeak: Map<number, number>;
    anchored: Set<number>;
    steps: DerivationStep[];
}, sat: SaturationInfo, regions: readonly Region[], regionVoter: ReadonlyArray<{
    id: number;
    score: number;
    w: number;
} | null>, N: number, td?: TraceDraft, cfg?: ClimbConsensusCfg): AttentionRead;
export declare function detectSaturated(ctx: MindContext, regions: ReadonlyArray<{
    start: number;
    end: number;
    chunk?: boolean;
}>, saturated: ReadonlyArray<boolean>): SaturationInfo;
export declare function canonicalChunkId(ctx: MindContext, regionBytes: Uint8Array, N: number, reachMemo?: Map<number, AncestorReach>): number | null;
export declare function naturalBreak(votes: number[]): number;
export type CrossRegionTier = "exact" | "single-synonym" | "double-synonym" | "structural-resonance";
export interface StructuralVariant {
    left: StructuralPart;
    right: StructuralPart;
    kind: "exact-exact" | "left-synonym" | "right-synonym" | "double-synonym";
    semanticConfidence: number;
    leftSiblingId?: number;
    rightSiblingId?: number;
}
export interface StructuralResonanceProposal {
    id: number;
    annScore: number;
    semanticConfidence: number;
    effectiveScore: number;
    variant: StructuralVariant["kind"];
    leftSiblingId?: number;
    rightSiblingId?: number;
}
/** A sibling gist cached in the shared, climb-wide memo alongside the
 *  COMPLETE stored byte length it was reconstructed from — the length is
 *  required to tell whether a cache hit is still valid under a probe whose
 *  `maxSiblingBytes` bound is smaller than the one that first cached it. */
interface CachedSiblingGist {
    gist: Vec;
    length: number;
}
/** Build, bound and order every mandatory structural variant (§7-8): the
 *  exact/exact composition is always kept; up to `ctx.cfg.haloQueryK`
 *  synonym variants (single- and double-synonym combined, one shared
 *  budget) are appended, ordered by confidence, then kind, then sibling id.
 *  Variant selection is entirely lightweight (see {@link
 *  buildStructuralVariantSpecs}); a sibling's bytes are read and perceived
 *  only for specs actually retained, and at most once per sibling id per
 *  climb via `siblingGistMemo`. */
export declare function buildStructuralVariants(ctx: MindContext, ra: Region, rb: Region, sides: JunctionSynonymSides, siblingGistMemo: Map<number, CachedSiblingGist>): {
    variants: StructuralVariant[];
    exactLeft: StructuralPart;
    exactRight: StructuralPart;
};
export declare function structuralResonance(ctx: MindContext, query: Uint8Array, ra: Region, rb: Region, sides: JunctionSynonymSides, siblingGistMemo: Map<number, CachedSiblingGist>, k: number, N: number, reachMemo: Map<number, AncestorReach>, 
/** Each side's OWN individual climb roots (from voteRegions), when it cast
 *  one — the self-evidence backstop structural-resonance needs and the
 *  exact tier gets for free from literal byte containment (§11's whole
 *  premise: recover a JOINT context neither side votes for alone).  A
 *  candidate whose reach is exactly one side's own conclusion is not new
 *  evidence of a joint whole; it is that side's resonance rediscovering
 *  itself through a synthetic gist still dominated by its own direction. */
ownRootsA: readonly number[] | undefined, ownRootsB: readonly number[] | undefined, trace?: StructuralResonanceTrace): Promise<{
    proposal: StructuralResonanceProposal;
    reach: AncestorReach;
    idf: number;
} | null>;
/** Emit the "climbConsensus" step — the human-readable note this always
 *  produced, now paired (when `ctx.trace` and `cfg` are both present) with
 *  the structured {@link ClimbConsensusData} payload on the SAME step's
 *  `data` field.  Every exit of {@link computeAttention} funnels through
 *  here, so instrumentation and the existing rationale text can never drift
 *  apart — see the instrumentation spec's §9 "every exit path". */
export declare function traceAttention(ctx: MindContext, regions: ReadonlyArray<{
    start: number;
    end: number;
}>, regionVoter: ReadonlyArray<{
    id: number;
    score: number;
    w: number;
} | null>, roots: ReadonlyArray<Attention>, steps?: ReadonlyArray<DerivationStep>, td?: TraceDraft, cfg?: ClimbConsensusCfg, ranked?: ReadonlyArray<Attention>): void;
export {};
