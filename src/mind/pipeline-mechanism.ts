// pipeline-mechanism.ts — the uniform grounding-mechanism interface.
//
// Every grounding mechanism (CAST, confluence, cover, extraction, recall, ALU,
// user extensions) implements this ONE interface.  The pipeline (think()) sees
// a list of PipelineMechanism objects — it never imports a mechanism-specific
// type and never has a special-case branch for any mechanism.
//
// The four constraints of the free-will architecture (§14.5):
//   1. DECOUPLING — mechanisms import nothing from each other or from pipeline.
//   2. DECLARED COMPETENCE — floor() returns null when impossible, a number when
//      possible.  Binary, auditable, no learned scores.
//   3. VISIBLE BUDGET — every mechanism carries its own caps internally (√N, k).
//   4. TRAVELING EVIDENCE — run() returns MechanismResult with accounted, moves,
//      and unexplained.  The pipeline computes the weight.

import type { AncestorReach, MindContext, Recognition } from "./types.js";
import type { AttentionRead } from "./types.js";
import type { ComputedSpan } from "../extension.js";
import type { Vec } from "../vec.js";
import { windowIds } from "./canonical.js";
import { read, resolve } from "./primitives.js";
import { alignGraded, type GradedRun, skillExemplar } from "./match.js";
import { climbAttentionAll } from "./attention.js";
import { sharedReachMemo } from "./traverse.js";

// ── Precomputed ──────────────────────────────────────────────────────────────
//
// Precomputed is a LAZY container for structural analyses of the query — the
// ONE place a response's shared evidence lives, for inter-mechanism exchange
// and for analyses future mechanisms will want.  Eager fields (rec, computed,
// guide) are populated by the pipeline before the mechanism loop; everything
// expensive is a lazily-cached method that computes on first access.  A
// mechanism that never asks for an analysis pays nothing for it; two
// mechanisms asking for the same analysis pay once.
//
// This design serves THREE purposes:
//   1. SHARING — when two mechanisms need the same analysis, it's computed once
//      (even under trace, where the ctx-level memos are deliberately bypassed).
//   2. EXTENSIBILITY — a new analysis is one method in one file.
//   3. DECLARATIVE COST — a mechanism's floor() checks its cheap gates and the
//      pipeline's `worthRunning` predicate BEFORE first-touching an expensive
//      analysis, so lazy analyses are only ever computed for a mechanism that
//      could still win.

export class Precomputed {
  /** The response's evidence-breadth constant: how many ranked candidates the
   *  resonance probes, the weave alignment, and the climb all consider.
   *  Derived once from config; every consumer reads it here. */
  readonly k: number;

  constructor(
    readonly ctx: MindContext,
    readonly query: Uint8Array,
    /** Recognition result (structural + canonical). */
    readonly rec: Recognition,
    /** Computed spans from mechanisms that implement `parse()` (e.g. ALU). */
    readonly computed: ComputedSpan[],
    /** The query's gist — the response-wide disambiguation guide. */
    readonly guide: Vec,
  ) {
    this.k = ctx.cfg.recallQueryK * 2;
  }

  // ── Cheap lazy analyses ───────────────────────────────────────────────

  private _windows?: Map<number, number>;
  /** Content-addressed W-window identities for every position in the query
   *  (offset → node id).  O(|query|) probes. */
  get queryWindows(): Map<number, number> {
    return this._windows ??= windowIds(this.ctx, this.query);
  }

  private _resolved?: number | null;
  /** The node id of the query itself, or null when it is not a stored form.
   *  O(|query|) probes. */
  get queryResolved(): number | null {
    if (this._resolved === undefined) {
      this._resolved = resolve(this.ctx, this.query);
    }
    return this._resolved;
  }

  private _anchorWindows = new Map<number, Map<number, number>>();
  /** Content-addressed W-window identities of one anchor's own bytes
   *  (offset → node id), memoised per anchor.  Confluence intersects these;
   *  any future identity-based mechanism reads the same cache. */
  windowsOf(anchor: number): Map<number, number> {
    let w = this._anchorWindows.get(anchor);
    if (w === undefined) {
      w = windowIds(this.ctx, read(this.ctx, anchor));
      this._anchorWindows.set(anchor, w);
    }
    return w;
  }

  /** Shared memo for {@link reachOf} (structural-IDF reads): a window's
   *  ancestor reach is a pure function of the read-only store, so one memo
   *  serves every mechanism that prices commonality — AND the consensus
   *  climb, which is the largest consumer and used to build its own.  The
   *  ONE definition of its lifetime lives in traverse.ts
   *  ({@link sharedReachMemo}): response-scoped for respond(),
   *  conversation-scoped across turns, always cold under a trace. */
  private _reach?: Map<number, AncestorReach>;
  get reachMemo(): Map<number, AncestorReach> {
    return this._reach ??= sharedReachMemo(this.ctx);
  }

  // ── Expensive lazy analyses ───────────────────────────────────────────
  //
  // Async, cached-by-promise: the first caller starts the computation, every
  // later caller (any mechanism, any phase) awaits the same promise.  A
  // mechanism MUST check its cheap floor gates and the pipeline's
  // `worthRunning` predicate before first-touching one of these.

  /** Charge a lazily-shared analysis to its OWN phase rather than to the
   *  mechanism that happened to first-touch it.  Without this the profile
   *  reads as "cast.floor costs 2 s" when what actually cost 2 s is the
   *  consensus climb — which cast merely paid for on everyone's behalf, and
   *  which every later consumer then got free.  Attribution must follow the
   *  work, not the caller. */
  private shared<T>(phase: string, fn: () => Promise<T>): Promise<T> {
    const meter = this.ctx.meter;
    return meter ? meter.time(phase, fn) : fn();
  }

  private _attention?: Promise<AttentionRead>;
  /** The full consensus climb (roots + ranked anchors) — the query-level
   *  evidence CAST, confluence, extraction, recall's scaffolding tier, and
   *  fusion all share.  Computed on first access; a query no mechanism
   *  climbs for (e.g. one an extension decided outright) never pays for it. */
  attention(): Promise<AttentionRead> {
    return this._attention ??= this.shared(
      "attention",
      () => climbAttentionAll(this.ctx, this.query, this.k),
    );
  }

  private _weave?: Promise<WeaveInfo>;
  /** Result of {@link alignGraded} for the first k ranked anchors —
   *  O(k · |query| · |ctx|).  Consumed by CAST; reusable by any future
   *  mechanism doing analogical transfer. */
  weave(): Promise<WeaveInfo> {
    return this._weave ??= this.attention().then((climb) =>
      this.shared(
        "weave",
        async () => computeWeave(this.ctx, this.query, this, climb),
      )
    );
  }

  /** Span-shaped classification of one ranked anchor, memoised per anchor id
   *  so repeated calls (extraction's own early-exit scan, any future
   *  template-based mechanism) never redo the work.  Deliberately NOT an
   *  eager all-anchors map: `skillExemplar` is the expensive part of
   *  extraction (capped fan-out reads plus an O(|ctx|) scan), and most
   *  queries are answered by the FIRST ranked anchor that qualifies — paying
   *  for every ranked anchor regardless of where the scan stops would turn
   *  an early-exit lookup into full O(k) work on every query. */
  private _spanShaped = new Map<number, Promise<SkillInfo | null>>();
  spanShapedOf(anchor: number): Promise<SkillInfo | null> {
    let p = this._spanShaped.get(anchor);
    if (p === undefined) {
      p = this.shared(
        "spanShaped",
        () => skillExemplar(this.ctx, anchor, this.guide),
      );
      this._spanShaped.set(anchor, p);
    }
    return p;
  }

  /** Every ranked anchor's classification at once, sharing the same
   *  per-anchor cache as {@link spanShapedOf} — for a mechanism that
   *  genuinely needs the full picture (not an early-exit scan).  Mixing
   *  access patterns across mechanisms never duplicates work: whichever
   *  anchors an early-exit consumer already asked for are reused here, and
   *  whichever this computes first are reused by a later early-exit scan. */
  async spanShapedAll(): Promise<Map<number, SkillInfo | null>> {
    const { ranked } = await this.attention();
    const out = new Map<number, SkillInfo | null>();
    for (const cand of ranked) {
      if (out.has(cand.anchor)) continue;
      out.set(cand.anchor, await this.spanShapedOf(cand.anchor));
    }
    return out;
  }
}

// ── WeaveInfo ────────────────────────────────────────────────────────────────

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

function computeWeave(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
  climb: AttentionRead,
): WeaveInfo {
  const quantum = ctx.space.maxGroup;
  const { ranked } = climb;
  const rankedCapped = ranked.length > pre.k ? ranked.slice(0, pre.k) : ranked;
  const depth = new Float64Array(query.length);
  const points: WeaveInfo["points"] = [];

  // WEAVE-SCALE anchors only: CAST transfers structure between things the
  // QUERY weaves together — query-scale structures.  A context an order of
  // magnitude beyond the query is not woven BY the query (the query can at
  // most quote a fragment of it, and fragment-level evidence is exactly what
  // recognition and the cover already handle); CAST's own comparison gate
  // demands `ctx.length ≤ query.length` before it fires, and its
  // substitution seats sit within a quantum of a context's start.  W is the
  // perceptual quantum — the same scale multiplier the bridge's phrase-scale
  // contract uses.  The prefix-capped read makes an oversized anchor cost a
  // bounded read instead of reconstructing (and then canonically
  // recognising) a corpus-sized deposit: profiled on a 17.7M-node store,
  // uncapped weaves spent 5–8s per query recognising conversation-length
  // anchors that could never form a weave point.
  const capBytes = query.length * quantum;
  for (const cand of rankedCapped) {
    const ctxBytes = read(ctx, cand.anchor, capBytes + 1);
    if (ctxBytes.length === 0 || ctxBytes.length > capBytes) continue;
    const raw = alignGraded(ctx, query, ctxBytes, pre.rec.sites);
    if (raw.length === 0) continue;
    for (const r of raw) {
      for (let i = r.qs; i < r.qe; i++) depth[i] += r.weight;
    }
    const free: GradedRun[] = [];
    for (const r of raw) {
      let { qs, qe, cs, weight } = r;
      for (const p of points) {
        for (const o of p.runs) {
          if (qs >= qe) break;
          if (o.qe <= qs || o.qs >= qe) continue;
          const left = Math.max(0, o.qs - qs);
          const right = Math.max(0, qe - o.qe);
          if (left >= right) qe = qs + left;
          else {
            cs += qe - right - qs;
            qs = qe - right;
          }
        }
      }
      if (qe - qs >= Math.min(quantum, ctxBytes.length)) {
        free.push({ qs, qe, cs, weight });
      }
    }
    if (free.length > 0) {
      points.push({
        anchor: cand.anchor,
        vote: cand.vote,
        ctx: ctxBytes,
        runs: free,
      });
    }
  }
  return { points, depth };
}

// ── SkillInfo ────────────────────────────────────────────────────────────────

/** Span-shaped classification of one anchor — the structural information
 *  extraction uses to decide whether a learned fact can serve as a template
 *  for reading an analogous span out of the query. */
export interface SkillInfo {
  contextBytes: Uint8Array;
  answerBytes: Uint8Array;
}

// ── MechanismResult ──────────────────────────────────────────────────────────

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

// ── PipelineMechanism ────────────────────────────────────────────────────────

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
