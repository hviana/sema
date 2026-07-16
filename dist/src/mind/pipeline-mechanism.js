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
import { windowIds } from "./canonical.js";
import { read, resolve } from "./primitives.js";
import { alignGraded } from "./match.js";
import { climbAttentionAll } from "./attention.js";
import { skillExemplar } from "./mechanisms/extraction.js";
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
  ctx;
  query;
  rec;
  computed;
  guide;
  /** The response's evidence-breadth constant: how many ranked candidates the
   *  resonance probes, the weave alignment, and the climb all consider.
   *  Derived once from config; every consumer reads it here. */
  k;
  constructor(
    ctx,
    query,
    /** Recognition result (structural + canonical). */
    rec,
    /** Computed spans from mechanisms that implement `parse()` (e.g. ALU). */
    computed,
    /** The query's gist — the response-wide disambiguation guide. */
    guide,
  ) {
    this.ctx = ctx;
    this.query = query;
    this.rec = rec;
    this.computed = computed;
    this.guide = guide;
    this.k = ctx.cfg.recallQueryK * 2;
  }
  // ── Cheap lazy analyses ───────────────────────────────────────────────
  _windows;
  /** Content-addressed W-window identities for every position in the query
   *  (offset → node id).  O(|query|) probes. */
  get queryWindows() {
    return this._windows ??= windowIds(this.ctx, this.query);
  }
  _resolved;
  /** The node id of the query itself, or null when it is not a stored form.
   *  O(|query|) probes. */
  get queryResolved() {
    if (this._resolved === undefined) {
      this._resolved = resolve(this.ctx, this.query);
    }
    return this._resolved;
  }
  _anchorWindows = new Map();
  /** Content-addressed W-window identities of one anchor's own bytes
   *  (offset → node id), memoised per anchor.  Confluence intersects these;
   *  any future identity-based mechanism reads the same cache. */
  windowsOf(anchor) {
    let w = this._anchorWindows.get(anchor);
    if (w === undefined) {
      w = windowIds(this.ctx, read(this.ctx, anchor));
      this._anchorWindows.set(anchor, w);
    }
    return w;
  }
  /** Shared memo for {@link reachOf} (structural-IDF reads): a window's
   *  ancestor reach is a pure function of the read-only store, so one
   *  response-scoped memo serves every mechanism that prices commonality. */
  reachMemo = new Map();
  // ── Expensive lazy analyses ───────────────────────────────────────────
  //
  // Async, cached-by-promise: the first caller starts the computation, every
  // later caller (any mechanism, any phase) awaits the same promise.  A
  // mechanism MUST check its cheap floor gates and the pipeline's
  // `worthRunning` predicate before first-touching one of these.
  _attention;
  /** The full consensus climb (roots + ranked anchors) — the query-level
   *  evidence CAST, confluence, extraction, recall's scaffolding tier, and
   *  fusion all share.  Computed on first access; a query no mechanism
   *  climbs for (e.g. one an extension decided outright) never pays for it. */
  attention() {
    return this._attention ??= climbAttentionAll(this.ctx, this.query, this.k);
  }
  _weave;
  /** Result of {@link alignGraded} for the first k ranked anchors —
   *  O(k · |query| · |ctx|).  Consumed by CAST; reusable by any future
   *  mechanism doing analogical transfer. */
  weave() {
    return this._weave ??= this.attention().then((climb) =>
      computeWeave(this.ctx, this.query, this, climb)
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
  _spanShaped = new Map();
  spanShapedOf(anchor) {
    let p = this._spanShaped.get(anchor);
    if (p === undefined) {
      p = skillExemplar(this.ctx, anchor, this.guide);
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
  async spanShapedAll() {
    const { ranked } = await this.attention();
    const out = new Map();
    for (const cand of ranked) {
      if (out.has(cand.anchor)) {
        continue;
      }
      out.set(cand.anchor, await this.spanShapedOf(cand.anchor));
    }
    return out;
  }
}
function computeWeave(ctx, query, pre, climb) {
  const quantum = ctx.space.maxGroup;
  const { ranked } = climb;
  const rankedCapped = ranked.length > pre.k ? ranked.slice(0, pre.k) : ranked;
  const depth = new Float64Array(query.length);
  const points = [];
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
    if (ctxBytes.length === 0 || ctxBytes.length > capBytes) {
      continue;
    }
    const raw = alignGraded(ctx, query, ctxBytes, pre.rec.sites);
    if (raw.length === 0) {
      continue;
    }
    for (const r of raw) {
      for (let i = r.qs; i < r.qe; i++) {
        depth[i] += r.weight;
      }
    }
    const free = [];
    for (const r of raw) {
      let { qs, qe, cs, weight } = r;
      for (const p of points) {
        for (const o of p.runs) {
          if (qs >= qe) {
            break;
          }
          if (o.qe <= qs || o.qs >= qe) {
            continue;
          }
          const left = Math.max(0, o.qs - qs);
          const right = Math.max(0, qe - o.qe);
          if (left >= right) {
            qe = qs + left;
          } else {
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
