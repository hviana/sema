import type { AncestorReach, MindContext, Recognition } from "./types.js";
import type { AttentionRead } from "./types.js";
import type { ComputedSpan } from "../extension.js";
import type { Hit } from "../store.js";
import type { Vec } from "../vec.js";
import { type FrameInstance, type GradedRun } from "./match.js";
export declare class Precomputed {
    readonly ctx: MindContext;
    readonly query: Uint8Array;
    /** Recognition result (structural + canonical). */
    readonly rec: Recognition;
    /** Computed spans from mechanisms that implement `parse()` (e.g. ALU). */
    readonly computed: ComputedSpan[];
    /** The query's gist — the response-wide disambiguation guide. */
    readonly guide: Vec;
    /** The response's evidence-breadth constant: how many ranked candidates the
     *  resonance probes, the weave alignment, and the climb all consider.
     *  Derived once from config; every consumer reads it here. */
    readonly k: number;
    constructor(ctx: MindContext, query: Uint8Array, 
    /** Recognition result (structural + canonical). */
    rec: Recognition, 
    /** Computed spans from mechanisms that implement `parse()` (e.g. ALU). */
    computed: ComputedSpan[], 
    /** The query's gist — the response-wide disambiguation guide. */
    guide: Vec);
    private _windows?;
    /** Content-addressed W-window identities for every position in the query
     *  (offset → node id).  O(|query|) probes. */
    get queryWindows(): Map<number, number>;
    private _resolved?;
    /** The node id of the query itself, or null when it is not a stored form.
     *  O(|query|) probes. */
    get queryResolved(): number | null;
    private _anchorWindows;
    /** Content-addressed W-window identities of one anchor's own bytes
     *  (offset → node id), memoised per anchor.  Confluence intersects these;
     *  any future identity-based mechanism reads the same cache. */
    windowsOf(anchor: number): Map<number, number>;
    /** Shared memo for {@link reachOf} (structural-IDF reads): a window's
     *  ancestor reach is a pure function of the read-only store, so one memo
     *  serves every mechanism that prices commonality — AND the consensus
     *  climb, which is the largest consumer and used to build its own.  The
     *  ONE definition of its lifetime lives in traverse.ts
     *  ({@link sharedReachMemo}): session-scoped between writes and always cold
     *  under a trace. */
    private _reach?;
    get reachMemo(): Map<number, AncestorReach>;
    /** Charge a lazily-shared analysis to its OWN phase rather than to the
     *  mechanism that happened to first-touch it.  Without this the profile
     *  reads as "cast.floor costs 2 s" when what actually cost 2 s is the
     *  consensus climb — which cast merely paid for on everyone's behalf, and
     *  which every later consumer then got free.  Attribution must follow the
     *  work, not the caller. */
    private shared;
    private _resonance?;
    /** The response's ONE top-k content-index read: the k learnt forms nearest
     *  the whole-query gist, ranked.  Recall's every gist tier is built on it,
     *  and {@link frames} assembles the frame inventory from it.
     *
     *  An ANN query is the single most expensive read in the engine, and two
     *  mechanisms asking the same question of the same gist is the one
     *  duplication a profile shows as doubled `annVectorReads` with nothing to
     *  account for it.  Cached BY PROMISE, so a second caller awaits the first. */
    resonance(): Promise<ReadonlyArray<Hit>>;
    private _wide?;
    /** The response's WIDE candidate list — the top-k when the query's gist has
     *  no concept-level match anywhere, and an exhaustive √N read when it does.
     *
     *  Every mechanism that has to look PAST the top-k reads this one list: the
     *  substitution bridge, prefix completion and the frame filler all did, and
     *  it was memoised inside recall for exactly that reason (measured: 490 ms
     *  median re-issued against 13 ms non-exhaustive, 36x).  A memo inside one
     *  mechanism only serves that mechanism's own tiers, so it lives here now —
     *  the same move `resonance` made for the top-k.
     *
     *  THE CONDITION IS THE TOP HIT'S SCORE, NOT THE CORPUS SIZE.  When nothing
     *  ranks at concept level, an exhaustive ANN only scores more vectors below
     *  the bar (profiled at 38K–40K annVectorReads per refusing query on a 325K-
     *  context store); the structural channels — junction walks, anchor climbs,
     *  the write side's window index — are the correct proposal source there,
     *  because the ANN cannot propose what the gist cannot rank.  This was once
     *  spelled `corpusN(ctx) <= (k · W)³`, which asks a different question and
     *  answers it wrongly at exactly the scale it was written from: at N =
     *  325,608 with k = 24 and W = 4 the cube is 884,736, so that store took the
     *  exhaustive branch — the very branch measured above.  Measured cost of the
     *  mismatch: substitutionBridge 8,544 ms of a 19,548 ms think (44%), against
     *  1,248 ms and 14,218 ms without it, every answer byte-identical. */
    wideResonance(): Promise<ReadonlyArray<number>>;
    private _frames?;
    /** THE FRAME INVENTORY — every ranked candidate that reads as an instance of
     *  the same frame as the query, each with the query spans it leaves VARIABLE
     *  ({@link FrameInstance}).  The one place the engine represents "a position
     *  whose occupant comes from the context rather than the corpus".
     *
     *  AN INVENTORY, NOT AN ELECTION.  It reports every pairing and elects no
     *  frame, deliberately: a slot is a property of a PAIRING, not of the query,
     *  and different candidates put slots in different places.  Committing to one
     *  reading here would push whichever consumer asked first onto everyone else
     *  — the market's decoupling (§2.6) broken from inside the shared container,
     *  and the population error §2.7 names.  Each consumer groups and commits
     *  for its own question; reference elects the modal slot signature, and a
     *  consumer wanting a different reading is not fighting this one.
     *
     *  NO LICENCE EITHER.  Knowing a span is variable is safe for every consumer
     *  — it can only improve an alignment.  Knowing one may be VOICED through is
     *  a different and much stronger claim, gated separately by
     *  {@link carriesFillers}, which needs projections this must not perform. */
    frames(): Promise<ReadonlyArray<FrameInstance>>;
    private _attention?;
    /** The full consensus climb (roots + ranked anchors) — the query-level
     *  evidence CAST, confluence, extraction, recall's scaffolding tier, and
     *  fusion all share.  Computed on first access; a query no mechanism
     *  climbs for (e.g. one an extension decided outright) never pays for it. */
    attention(): Promise<AttentionRead>;
    private _weave?;
    /** Result of {@link alignGraded} for the first k ranked anchors —
     *  O(k · |query| · |ctx|).  Consumed by CAST; reusable by any future
     *  mechanism doing analogical transfer. */
    weave(): Promise<WeaveInfo>;
    /** Span-shaped classification of one ranked anchor, memoised per anchor id
     *  so repeated calls (extraction's own early-exit scan, any future
     *  template-based mechanism) never redo the work.  Deliberately NOT an
     *  eager all-anchors map: `skillExemplar` is the expensive part of
     *  extraction (capped fan-out reads plus an O(|ctx|) scan), and most
     *  queries are answered by the FIRST ranked anchor that qualifies — paying
     *  for every ranked anchor regardless of where the scan stops would turn
     *  an early-exit lookup into full O(k) work on every query. */
    private _spanShaped;
    spanShapedOf(anchor: number): Promise<SkillInfo | null>;
    /** Every ranked anchor's classification at once, sharing the same
     *  per-anchor cache as {@link spanShapedOf} — for a mechanism that
     *  genuinely needs the full picture (not an early-exit scan).  Mixing
     *  access patterns across mechanisms never duplicates work: whichever
     *  anchors an early-exit consumer already asked for are reused here, and
     *  whichever this computes first are reused by a later early-exit scan. */
    spanShapedAll(): Promise<Map<number, SkillInfo | null>>;
}
/** The weave-local structural alignment, computed once and consumed by CAST
 *  (and any future mechanism doing analogical transfer). */
export interface WeaveInfo {
    /** Per-anchor alignment: context bytes, vote weight, and graded runs. */
    points: Array<{
        anchor: number;
        vote: number;
        ctx: Uint8Array;
        runs: GradedRun[];
        /** The query span the CLIMB elected this anchor from — its evidence,
         *  independent of any literal run alignment (see Attention.start/end). */
        start: number;
        end: number;
    }>;
    /** Weighted depth at each query byte — sum of alignment weights.
     *  `depth[i]` is the total evidence that byte i is shared among the
     *  aligned structures. */
    depth: Float64Array;
}
/** Span-shaped classification of one anchor — the structural information
 *  extraction uses to decide whether a learned fact can serve as a template
 *  for reading an analogous span out of the query. */
export interface SkillInfo {
    contextBytes: Uint8Array;
    answerBytes: Uint8Array;
}
/** Raw result from a mechanism's `run()`.  The pipeline computes the weight
 *  from `moves` + `PASS * unaccounted(accounted)` — the mechanism does not
 *  know about the cost ladder.
 *
 *  When `weight` is present, the pipeline uses it directly instead of
 *  computing `weigh(accounted, moves)`.  This is for mechanisms whose cost
 *  is derived externally (e.g. cover: the A*LD derivation's g-value). */
export interface MechanismResult {
    bytes: Uint8Array;
    accounted: Array<[number, number]>;
    moves: number;
    used?: ReadonlySet<number>;
    unexplained: string;
    /** Explicit weight override.  When absent, weight = moves + PASS·unaccounted. */
    weight?: number;
    /** Bytes of `bytes` that came from spans nothing recognised — the asker's
     *  own words carried through verbatim rather than derived (see
     *  {@link liftedScaffolding}).  Reported, not priced: the ladder prices what
     *  a candidate leaves UNACCOUNTED, and this orders candidates that tie on
     *  exactly that.  Omit when a mechanism composes its answer entirely from
     *  recognised material, which is the usual case. */
    scaffolding?: number;
    /** Override the mechanism's default provenance for this result.
     *  When absent, the pipeline uses `mech.provenance`. */
    provenance?: string;
    /** This grounding is a COMPLETE trained answer — post-grounding must not
     *  extend it.  Declared by the mechanism about its own result, exactly like
     *  `accounted`/`used`/`unexplained`; the decider honours the property and
     *  never asks which mechanism set it, so the market stays uniform.
     *
     *  Set it only when the answer is a stored form's OWN continuation reached
     *  through an identity claim about the query — i.e. the query IS some
     *  trained context, so its continuation is the whole read-out and a further
     *  multi-hop pivot would chain PAST the fact that produced the answer.
     *  That is the same reasoning `reason`'s echo guard already applies to a
     *  query that resolves exactly (see reasoning.ts); this carries the claim
     *  for the mechanisms that establish the identity by another route.
     *
     *  Observed without it: the correct "What is the process of
     *  photosynthesis?" grounding was pivoted forward four times, out of the
     *  fact that answered it and into an unrelated "Hello! How can I assist you
     *  today?" conversational turn. */
    complete?: boolean;
}
export interface PipelineMechanism {
    /** Stable identifier for trace/debug. */
    readonly name: string;
    /** Which provenance tag the pipeline attaches to this mechanism's answers. */
    readonly provenance: string;
    /** Parse authoritative spans BEFORE the grounding loop.
     *  Only needed by computational mechanisms (e.g. ALU).  Results from ALL
     *  mechanisms that implement this are collected into `Precomputed.computed`
     *  before any `floor()` or `run()` is called. */
    parse?(query: Uint8Array): Promise<ComputedSpan[]>;
    /** Admissible lower bound on this mechanism's weight.
     *  Returns `null` when the mechanism structurally cannot fire.
     *
     *  `worthRunning(cheapFloor)` reports whether the CURRENT incumbent
     *  (established by mechanisms that already ran this response, cover being
     *  first — see `defaultMechanisms`) could still be beaten by a floor no
     *  tighter than `cheapFloor`.  THE INVESTMENT DISCIPLINE: before
     *  first-touching an expensive shared analysis (`pre.attention()`,
     *  `pre.weave()`, …), check `worthRunning(bound)` with this mechanism's
     *  cheapest possible bound — and when it fails, RETURN THE BOUND rather
     *  than null.  The bound is still admissible (it never overstates cost),
     *  the pipeline's own check then prunes `run()` and records the truthful
     *  "cannot beat incumbent" trace note, and no analysis was computed just
     *  to be discarded.  This is uniform: no mechanism asks what produced the
     *  incumbent — a computed extension result and an ordinary cheap cover
     *  prune the same way. */
    floor(ctx: MindContext, query: Uint8Array, pre: Precomputed, worthRunning: (floor: number) => boolean): Promise<number | null>;
    /** Produce candidate answers. */
    run(ctx: MindContext, query: Uint8Array, pre: Precomputed): Promise<MechanismResult[]>;
}
