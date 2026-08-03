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
import type { Hit } from "../store.js";
import type { Vec } from "../vec.js";
import { indexOf } from "../bytes.js";
import { dominates } from "../geometry.js";
import { windowIds } from "./canonical.js";
import { read, resolve } from "./primitives.js";
import {
  alignGraded,
  type FrameInstance,
  frameSlots,
  type GradedRun,
  skillExemplar,
} from "./match.js";
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
   *  ({@link sharedReachMemo}): session-scoped between writes and always cold
   *  under a trace. */
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

  private _resonance?: Promise<ReadonlyArray<Hit>>;
  /** The response's ONE top-k content-index read: the k learnt forms nearest
   *  the whole-query gist, ranked.  Recall's every gist tier is built on it,
   *  and {@link frames} assembles the frame inventory from it.
   *
   *  An ANN query is the single most expensive read in the engine, and two
   *  mechanisms asking the same question of the same gist is the one
   *  duplication a profile shows as doubled `annVectorReads` with nothing to
   *  account for it.  Cached BY PROMISE, so a second caller awaits the first. */
  resonance(): Promise<ReadonlyArray<Hit>> {
    return this._resonance ??= this.shared(
      "resonance",
      () => this.ctx.store.resonate(this.guide, this.k),
    );
  }

  private _frames?: Promise<ReadonlyArray<FrameInstance>>;
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
  frames(): Promise<ReadonlyArray<FrameInstance>> {
    return this._frames ??= this.shared("frames", async () => {
      const ctx = this.ctx;
      const W = ctx.space.maxGroup;
      // PHRASE SCALE, the same bound the bridge and the frame filler put on a
      // candidate's bytes: a form an order of magnitude longer than the query
      // is not a candidate for BEING it with a span replaced.
      const capBytes = this.query.length * W;
      const out: FrameInstance[] = [];
      for (const h of await this.resonance()) {
        // REJECT BY LENGTH BEFORE RECONSTRUCTING (§2.8): `contentLen` is an
        // indexed read, `bytesPrefix` rebuilds a subtree.  ONLY the phrase-scale
        // cap is applied — it is a bounded-read discipline, not a judgement.
        //
        // A LOWER bound was here too (`dominates(len, query.length)`, on the
        // reasoning that a candidate shorter than half the query cannot supply
        // a frame that dominates it).  That is reference's gate wearing a cost
        // argument's clothes, and it hid the very pairings another consumer
        // needs: `What is the capital of France?` (30 B) against `What is the
        // capital of the country where the Eiffel Tower is?` (61 B) was
        // rejected before it was ever read — a definite description standing
        // where a noun stands, which is exactly the shape the frame filler
        // exists for.
        const len = ctx.store.contentLen(h.id, capBytes + 1);
        if (len === 0 || len > capBytes) continue;
        const cand = ctx.store.bytesPrefix(h.id, capBytes + 1);
        if (cand.length === 0 || cand.length > capBytes) continue;
        const inst = frameSlots(ctx, this.query, cand, h.id);
        if (inst !== null) out.push(inst);
      }
      return out;
    });
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
  const byAnchor = new Map<number, WeaveInfo["points"][number]>();

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
  const askerBytes = query.length -
    ctx.answeredSpans.reduce((n, [start, end]) => n + end - start, 0);
  const capBytes = askerBytes * quantum;
  // RUNS ARE NOT TRIMMED AGAINST EACH OTHER.  A point keeps every byte it
  // aligned; exclusivity is a property of STRUCTURES (see "one place, one
  // structure" below), not of individual query bytes.
  //
  // This weave used to build points in the climb's vote order and cut each new
  // point's runs against every point already accepted.  It is worth recording
  // what that cost, because the cut was invisible: it did not just resolve
  // ties, it silently DECIDED downstream schemas.  A point's `runs[0]` — the
  // run three CAST branches read as "the filler", "the seat", "the name" — was
  // whichever run happened to survive the cut, so those schemas were reading an
  // elimination order as though it were evidence, and the query's own bytes
  // were truncated on the way ("Shakespeare" surviving as "Shakes").  Each
  // consumer now derives its own reading from the runs (cast.ts: `fillerRun`
  // clips at the seat, redirection scans for the naming run, entry counts own
  // bytes and the climb's dispersion), and with those in place removing the cut
  // costs nothing — measured, the same 442 tests pass either way.
  //
  // What the vote order was RIGHT about is kept: which structures belong in the
  // weave is the climb's call, not a local run measure. Arbitrating byte
  // ownership by local evidence instead (longest covering run, then weight,
  // then rank) was implemented and MEASURED, and it evicted the committed
  // root's own evidence — CAST then refused on its own consistency check ("2
  // aligned structure(s), but none is one of the climb's 1 committed root(s)"),
  // test/29 going 9/2 to 7/4. Weave-local measures decide what is FRAME inside
  // the weave (see the frame gates in cast.ts); membership stays the climb's.
  //
  // TWO PASSES.  `depth` — how much of the weave agrees on each query byte, and
  // therefore what counts as FRAME — must be the whole weave's, not "whatever
  // has been processed so far": read in one pass it made a candidate's own
  // frame reading depend on its rank, and the proposed-run gate below needs the
  // real thing.
  const cands: Array<{
    cand: (typeof rankedCapped)[number];
    ctxBytes: Uint8Array;
    raw: GradedRun[];
  }> = [];
  const querySegments: Array<[number, number]> = [];
  let segmentStart = 0;
  for (const [start, end] of ctx.answeredSpans) {
    if (segmentStart < start) querySegments.push([segmentStart, start]);
    segmentStart = Math.max(segmentStart, end);
  }
  if (segmentStart < query.length) {
    querySegments.push([segmentStart, query.length]);
  }
  const weaveLength = querySegments.reduce((n, [s, e]) => n + e - s, 0);
  const weaveQuery = new Uint8Array(weaveLength);
  const weaveMap: Array<{
    compactStart: number;
    originalStart: number;
    length: number;
  }> = [];
  let compactStart = 0;
  for (const [start, end] of querySegments) {
    weaveQuery.set(query.subarray(start, end), compactStart);
    weaveMap.push({
      compactStart,
      originalStart: start,
      length: end - start,
    });
    compactStart += end - start;
  }
  const segmentOf = (start: number, end: number) => {
    let lo = 0;
    let hi = weaveMap.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (weaveMap[mid].originalStart <= start) lo = mid + 1;
      else hi = mid;
    }
    const part = lo > 0 ? weaveMap[lo - 1] : undefined;
    return part && end <= part.originalStart + part.length ? part : undefined;
  };
  const weaveSites = pre.rec.sites.flatMap((s) => {
    const part = segmentOf(s.start, s.end);
    return part
      ? [{
        ...s,
        start: part.compactStart + s.start - part.originalStart,
        end: part.compactStart + s.end - part.originalStart,
      }]
      : [];
  });
  for (const cand of rankedCapped) {
    const ctxBytes = read(ctx, cand.anchor, capBytes + 1);
    if (ctxBytes.length === 0 || ctxBytes.length > capBytes) continue;
    // CAST compares structures stated by the asker. Completed assistant turns
    // remain available to recognition and the climb as conversation context,
    // but aligning every candidate across their full prose makes weave work
    // grow with answer length and lets the engine analogise against its own
    // previous output. The compact asker stream is aligned once (so candidate
    // windows are not rebuilt per turn), then every run is split back across
    // the original turn segments so no evidence crosses an omitted boundary.
    const raw = alignGraded(ctx, weaveQuery, ctxBytes, weaveSites).flatMap(
      (r) => {
        let lo = 0;
        let hi = weaveMap.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (weaveMap[mid].compactStart <= r.qs) lo = mid + 1;
          else hi = mid;
        }
        const out: GradedRun[] = [];
        for (let pi = Math.max(0, lo - 1); pi < weaveMap.length; pi++) {
          const part = weaveMap[pi];
          if (part.compactStart >= r.qe) break;
          const partEnd = part.compactStart + part.length;
          const start = Math.max(r.qs, part.compactStart);
          const end = Math.min(r.qe, partEnd);
          if (start >= end) continue;
          out.push({
            ...r,
            qs: part.originalStart + start - part.compactStart,
            qe: part.originalStart + end - part.compactStart,
            cs: r.cs + start - r.qs,
          });
        }
        return out;
      },
    );
    if (raw.length === 0) continue;
    // DEPTH COUNTS STRUCTURES, NOT WEIGHT.  The frame test is
    // `dominates(depth[i], aligned)` — "more than half the weave shares this
    // byte" — and `aligned` is a COUNT of points.  Accumulating graded
    // alignment WEIGHT here compared weight-mass against a cardinality: two
    // different dimensions, meaningful only while truncation happened to keep
    // points.length small and weights near 1.
    //
    // Measured (test/29 C2, only truncation toggled): 9 candidates collapse to
    // 2 points and 29/42 bytes read FRAME; without truncation 9 points survive
    // and only 6/42 do. The elimination was SETTING the frame threshold, so
    // every attempt to change run ownership inverted the frame reading and
    // lost the same 10 tests (442 -> 432, twice, for opposite designs).
    //
    // Counting distinct covering candidates restores the documented meaning
    // exactly and makes the comparison like-for-like, which decouples the
    // frame gate from however many points survive.
    const covered = new Uint8Array(query.length);
    for (const r of raw) {
      for (let i = r.qs; i < r.qe; i++) {
        if (!covered[i]) {
          covered[i] = 1;
          depth[i] += 1;
        }
      }
    }
    cands.push({ cand, ctxBytes, raw });
  }
  for (const { cand, ctxBytes, raw } of cands) {
    const free: GradedRun[] = [];
    for (const r of raw) {
      if (r.qe - r.qs >= Math.min(quantum, ctxBytes.length)) {
        free.push({ ...r });
      }
    }
    if (free.length > 0) {
      const pt = {
        anchor: cand.anchor,
        vote: cand.vote,
        ctx: ctxBytes,
        runs: free,
        start: cand.start,
        end: cand.end,
      };
      byAnchor.set(cand.anchor, pt);
      points.push(pt);
    }
  }

  // A byte is FRAME when more than half the weave shares it, and a SPAN is
  // frame when more than half its bytes are — the same two-level
  // half-dominance reading cast.ts's own frame gate uses, over the same
  // `depth`.  Read against the accepted POINTS (as cast.ts does), so it is
  // only meaningful once phase 1 has run.
  const framed = (from: number, to: number): boolean => {
    let n = 0;
    for (let i = from; i < to; i++) if (dominates(depth[i], points.length)) n++;
    return dominates(n, to - from);
  };
  // PHASE 2 — THE CLIMB'S OWN CONCLUSION IS AN ALIGNMENT THE LITERAL MATCHER
  // CANNOT SEE.  `alignRuns` seeds on W-grams, so two forms differing by a
  // single byte share no run at all: on `How is ice like steel?` against a
  // store holding `Ice is cold`, the query's `ice` and the stored `Ice` agree
  // on only `ce ` — three bytes, never seeded — so that structure entered the
  // weave carrying nothing but the ` is ` scaffolding every exemplar shares,
  // lost it to the first point that claimed it, and vanished.  The climb had
  // ALREADY identified it: its resonance elected `Ice is cold` from the query
  // span `ce l` and `Steel is hard` from `stee`, two disjoint spans each naming
  // its own structure, weighed through the region's contrastive margin and its
  // IDF — gates the aligner has no equivalent of.
  //
  // So the climb PROPOSES the pairing (which structure, which query span) and
  // bytes DECIDE its terms (§2.3).  Three gates, each one measured:
  //
  //   • it may only take query bytes NO literal run claimed.  Run inline with
  //     phase 1 this did the opposite of "exact decides" — a higher-ranked
  //     candidate's proposal trimmed a lower-ranked candidate's byte-for-byte
  //     match out of existence (`he W`, proposed for `a nickname meaning the
  //     divine one`, cut the literal `The ` out of `The Starry Night was
  //     painted by Vincent van Gogh.` and CAST's redirection lost its
  //     dominant — test/29 C4).  Hence a second pass, after every literal run
  //     is placed.
  //   • the literal agreement must DOMINATE the span.  A climb vote is not by
  //     itself an alignment: on `The Persistence of Memory was painted by
  //     Salvador Dali.` the climb elects `The Starry Night…` from the span
  //     ` Dali.`, which shares barely a byte with it — the resonance was
  //     carried by the frame those exemplars share.  Admitting it let CAST
  //     weave points out of pure scaffolding and out-account the correct
  //     extraction (test/00, test/24).  Where the proposal is real the
  //     agreement is overwhelming: both C1 spans agree on three of four bytes.
  //   • and the span must not be FRAME.  Literal dominance alone is too weak
  //     at this scale — a 4-byte span agrees three-of-four with half the
  //     corpus by accident (`he W` against `a nickname meaning the divine
  //     one`).  Frame is the weave-local measure of exactly that.
  const claimed = new Uint8Array(query.length);
  for (const p of points) {
    for (const r of p.runs) claimed.fill(1, r.qs, r.qe);
  }
  for (const { cand, ctxBytes } of cands) {
    if (cand.end > cand.start) {
      let qs = cand.start;
      let qe = cand.end;
      while (qs < qe && claimed[qs]) qs++;
      while (qe > qs && claimed[qe - 1]) qe--;
      let clear = true;
      for (let i = qs; i < qe; i++) if (claimed[i]) clear = false;
      if (clear && qe - qs >= Math.min(quantum, ctxBytes.length)) {
        // The gate only asks whether the agreement DOMINATES the span, so
        // search DOWNWARD from the whole span and stop at the first hit: the
        // first length found is both the longest agreement and, by
        // construction, already past the dominance bar.  At most O(W²) bounded
        // substring probes — a span is one segment (≤ 2W) — where a full
        // longest-common-substring scan would be O(|span|² · |ctx|) against a
        // context that may be W× the query.
        const span = query.subarray(qs, qe);
        const bar = Math.floor(span.length / 2) + 1; // dominates(bar, length)
        let bestLen = 0;
        let bestCs = 0;
        for (let len = span.length; len >= bar && bestLen === 0; len--) {
          for (let off = 0; off + len <= span.length; off++) {
            const at = indexOf(ctxBytes, span.subarray(off, off + len), 0);
            if (at < 0) continue;
            bestLen = len;
            // Where the span's FIRST byte lands, so `cs` means the same thing
            // it does for a literal run: the context offset the run starts at.
            bestCs = Math.max(0, at - off);
            break;
          }
        }
        if (bestLen > 0 && !framed(qs, qe)) {
          const run = {
            qs,
            qe,
            cs: bestCs,
            weight: bestLen / (qe - qs),
            proposed: true,
          };
          claimed.fill(1, qs, qe);
          const pt = byAnchor.get(cand.anchor);
          if (!pt) {
            const made = {
              anchor: cand.anchor,
              vote: cand.vote,
              ctx: ctxBytes,
              runs: [run],
              start: cand.start,
              end: cand.end,
            };
            byAnchor.set(cand.anchor, made);
            points.push(made);
          } else {
            pt.runs.push(run);
            pt.runs.sort((x, y) => x.qs - y.qs);
          }
        }
      }
    }
  }
  // ONE PLACE, ONE STRUCTURE.  A stored sentence and the entity it names are
  // not two independent structures when the query's evidence for them is the
  // same bytes — they are one place read at two grains, and admitting both
  // lets a nest of containing sentences outvote the entity the query actually
  // named.  Measured on test/29 C2 ("How is Shakespeare like Leonardo da
  // Vinci?"): the five sentences that merely CONTAIN the two names align the
  // same q6-18 / q23-41 the names do, and comparison ended up seated on a
  // 49-byte sentence instead of the 17-byte entity.
  //
  // A point earns its own place in the weave the same way a second point earns
  // CAST's entry: at least one perception quantum of query bytes no
  // better-voted point already explains.  Points arrive in the climb's vote
  // order, which is the arbiter this file already trusts for what belongs in
  // the weave; unlike run trimming, nothing is CUT here — a point keeps every
  // byte it aligned or it is not a separate structure at all.
  const coveredOf = (p: WeaveInfo["points"][number]): Set<number> => {
    const set = new Set<number>();
    for (const r of p.runs) for (let i = r.qs; i < r.qe; i++) set.add(i);
    return set;
  };
  const kept: WeaveInfo["points"] = [];
  const keptCover: Array<Set<number>> = [];
  for (const p of points) {
    const cov = coveredOf(p);
    let redundant = false;
    for (const other of keptCover) {
      let own = 0;
      for (const i of cov) if (!other.has(i)) own++;
      if (own < quantum) {
        redundant = true;
        break;
      }
    }
    if (!redundant) {
      kept.push(p);
      keptCover.push(cov);
    }
  }
  points.length = 0;
  points.push(...kept);
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
