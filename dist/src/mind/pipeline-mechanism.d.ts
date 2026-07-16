import type { AncestorReach, MindContext, Recognition } from "./types.js";
import type { AttentionRead } from "./types.js";
import type { ComputedSpan } from "../extension.js";
import type { Vec } from "../vec.js";
import { type GradedRun } from "./match.js";
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
  constructor(
    ctx: MindContext,
    query: Uint8Array,
    /** Recognition result (structural + canonical). */
    rec: Recognition,
    /** Computed spans from mechanisms that implement `parse()` (e.g. ALU). */
    computed: ComputedSpan[],
    /** The query's gist — the response-wide disambiguation guide. */
    guide: Vec,
  );
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
   *  ancestor reach is a pure function of the read-only store, so one
   *  response-scoped memo serves every mechanism that prices commonality. */
  readonly reachMemo: Map<number, AncestorReach>;
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
  /** Override the mechanism's default provenance for this result.
   *  When absent, the pipeline uses `mech.provenance`. */
  provenance?: string;
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
  floor(
    ctx: MindContext,
    query: Uint8Array,
    pre: Precomputed,
    worthRunning: (floor: number) => boolean,
  ): Promise<number | null>;
  /** Produce candidate answers. */
  run(
    ctx: MindContext,
    query: Uint8Array,
    pre: Precomputed,
  ): Promise<MechanismResult[]>;
}
