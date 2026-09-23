// meter.ts — the one computational-usage accounting surface.
//
// A Meter counts the WORK one inference call performs, layer by layer, so a
// slow response can be attributed instead of guessed at.  It is the profiling
// counterpart of the rationale: the rationale says WHY an answer was chosen,
// the meter says WHAT IT COST to choose it.
//
// Four contracts, all load-bearing:
//
//   1. NEVER READ BY INFERENCE.  No counter may reach a decision, a threshold,
//      or an ordering.  Determinism (determinism.md) survives
//      only because the meter is write-only from the engine's point of view.
//   2. OFF BY DEFAULT, AND FREE WHEN OFF.  Every call site is `meter?.x++` on
//      a null field.  Nothing allocates, nothing is keyed, nothing is timed
//      unless a Meter is attached (`new Mind({ profile: true })`).
//   3. COUNTS, NOT TIMES, ARE THE PRODUCT.  Counters are deterministic — the
//      same query on the same store meters identically, so a regression is
//      diffable.  `elapsedMs` and the per-phase millisecond totals are the
//      only non-deterministic fields and are reported separately.
//   4. ONE DEFINITION.  This file is the only place a counter name exists.
//      A layer that wants to be visible bumps a field here; it does not grow
//      a private counter (the pattern `danglingReads`/`compactFailures` in
//      store.ts predates this file and stays — those are HEALTH counters,
//      session-lifetime and error-shaped, not per-response work).
//
// Layering: this module imports nothing.  store.ts, the mind, and the graph
// search all reference it, and it references none of them.

/** Per-phase accumulation — one entry per mechanism `floor`/`run` and per
 *  named stage.
 *
 *  PHASES NEST, AND ARE NOT DISJOINT.  `think` contains every mechanism
 *  phase; a mechanism's `floor` contains whatever shared analysis it
 *  first-touched (`attention`, `weave`); `recall.run` contains
 *  `substitutionBridge`.  Read a
 *  phase as "wall-clock spent inside this, inclusive" — never sum them and
 *  expect the total.  `CostReport.elapsedMs` is the only whole.
 *
 *  Shared analyses are charged to THEMSELVES, not to the mechanism that
 *  first-touched them: the first toucher pays the wall clock, but every
 *  later consumer gets the result free, so blaming it would misread which
 *  work is expensive.  (Before this, the profile read "cast.floor costs
 *  2.9 s"; what actually cost 2.7 s of that was the consensus climb, which
 *  cast merely paid for on everyone's behalf.) */
export interface PhaseCost {
  /** How many times the phase ran. */
  calls: number;
  /** Wall-clock milliseconds spent inside it (non-deterministic). */
  ms: number;
  /** Work counters accrued INSIDE this phase — the same names as
   *  {@link CostReport.counters}, differenced across the phase's entry and
   *  exit, summed over its calls.  Deterministic, unlike `ms`, and the field
   *  that answers "which phase did those 75,000 byte reads?" — a question a
   *  whole-response counter total cannot.  Inclusive, like `ms`: a nested
   *  phase's work is counted in its parent too. */
  counters: Record<string, number>;
}

/** A snapshot of one inference call's computational usage.  Plain data —
 *  JSON-serialisable, diffable between runs. */
export interface CostReport {
  version: 1;
  /** Wall-clock milliseconds of the whole call (non-deterministic). */
  elapsedMs: number;
  /** Query length in bytes — the scale every other number is read against. */
  queryBytes: number;
  /** Deterministic work counters, by layer. */
  counters: Record<string, number>;
  /** Per-phase call counts and millisecond totals, insertion-ordered.
   *  NESTED — see {@link PhaseCost}; do not sum. */
  phases: Record<string, PhaseCost>;
}

/** The mutable accumulator.  One is created per profiled inference call and
 *  handed to every layer through `ctx.meter` / `store.meter`. */
export class Meter {
  // ── Store: content reads ────────────────────────────────────────────────
  /** `store.get` — one node record materialised (cache hit or DB row). */
  nodeRecords = 0;
  /** `store.bytes` / `store.bytesPrefix` — one reconstruction request. */
  byteReads = 0;
  /* * Bytes actually handed back by those reads — the real I/O volume, and the
   *  number that exposes an unbounded read (bounded-reads.md) that a call count
   * alone hides. */
  bytesRead = 0;
  /** `store.contentLen`. */
  lenReads = 0;

  // ── Store: content-addressed identity ───────────────────────────────────
  /** `store.findLeaf`. */
  leafLookups = 0;
  /** `store.findBranch`. */
  branchLookups = 0;
  /** `store.canonFind` — equivalence-class candidate proposal. */
  canonLookups = 0;

  // ── Store: structure (parents / containment) ────────────────────────────
  /** `parents` + `parentsFirst` — materialising parent reads. */
  parentReads = 0;
  /** `hasParents` — indexed existence probe. */
  parentProbes = 0;
  /** `chainRun` — one bounded transparent-chain climb. */
  chainRuns = 0;
  /** `containers` + `containersSlice`. */
  containerReads = 0;
  /** `hasContainers` — indexed existence probe. */
  containerProbes = 0;

  // ── Store: learned edges ────────────────────────────────────────────────
  /** `next` + `nextFirst`. */
  edgeReads = 0;
  /** `hasNext` — indexed existence probe. */
  edgeProbes = 0;
  /** `prev` + `prevFirst`. */
  prevReads = 0;
  /** `prevCount` — indexed count probe. */
  prevProbes = 0;

  // ── Store: halo ─────────────────────────────────────────────────────────
  /** `halo` — one halo vector decoded. */
  haloReads = 0;
  /** `hasHalo` + `haloMass` — probes that never decode a vector. */
  haloProbes = 0;

  // ── Store: approximate search (the ANN indexes) ─────────────────────────
  /** `resonate` calls that descended the content index. */
  annQueries = 0;
  /** `resonate` calls served from the per-flush read cache. */
  annCacheHits = 0;
  /** Stored vectors the content index actually scored — the dominant cost of
   *  a query on a large store, and the one counter that grows with N when a
   *  budget is missing. */
  annVectorReads = 0;
  /** `resonateHalo` calls. */
  haloQueries = 0;

  // ── Mind: perception & recognition ──────────────────────────────────────
  /** `perceive` calls that actually folded (memo misses only). */
  perceptions = 0;
  /** Bytes folded by those perceptions — perception is O(bytes), so this is
   *  its true cost, and it is what a multi-turn regression shows up in first
   *  (re-folding the whole context instead of the new turn). */
  perceivedBytes = 0;
  /** `perceive` calls served from the per-response / conversation memo. */
  perceiveHits = 0;
  /** `recognise` calls that actually ran. */
  recognitions = 0;
  /** Bytes recognised by those calls. */
  recognisedBytes = 0;
  /** `recognise` calls served from the memo. */
  recogniseHits = 0;
  /** `resolve` — whole-span content-addressed identity requests. */
  resolves = 0;

  // ── Mind: the consensus climb ───────────────────────────────────────────
  /** `climbAttentionAll` calls that actually climbed. */
  climbs = 0;
  /** `climbAttentionAll` calls served from `climbMemo`. */
  climbHits = 0;
  /** Query regions the climb voted on, summed over climbs. */
  climbRegions = 0;
  /** Nodes popped and examined by `edgeAncestors` ascents — the climb's
   *  inner loop, and the thing `hubBound` is supposed to be bounding. */
  ancestorVisits = 0;

  // ── Mind: matching & search ─────────────────────────────────────────────
  /** `alignGraded` / `alignRuns` invocations. */
  alignments = 0;
  /** Σ (query bytes × context bytes) over those alignments — the alignment
   *  family is quadratic, so this is the honest unit. */
  alignCells = 0;
  /** `junctionContainersFrom` ascents started — the cross-region ladder's
   *  and the bridge's shared "which learnt whole contains these two forms?"
   *  walk. */
  junctionWalks = 0;
  /** Nodes popped by those ascents, against their √N·W budget — the counter
   *  that shows whether the walks are deciding early or burning the budget. */
  junctionPops = 0;
  /** Ascents that ended by EXHAUSTING the expansion budget rather than by
   *  deciding — the walk abstained and the caller silently fell through to a
   * lower tier of the ladder — honest degradation, and nothing else reports it
   * (INVARIANTS.md). It rises the moment a SHARED budget is drained by an
   * earlier walk, which is what makes "this tier answered nothing"
   * distinguishable from "this tier never got to look". */
  junctionBudgetExhausted = 0;
  /** Arbitrary byte spans whose distributional company was VSA-bundled from
   *  existing episode halos. */
  spanHalos = 0;
  /** Canonical W-windows examined while composing those span halos. */
  spanHaloWindows = 0;

  /** `lightestDerivation` searches started. */
  searches = 0;
  /** Chart items popped by those searches. */
  searchPops = 0;
  /** Chart items pushed by those searches. */
  searchPushes = 0;

  // ── Mind: the mechanism market ──────────────────────────────────────────
  /** `floor()` calls that returned a bound (the mechanism could fire). */
  mechanismFloors = 0;
  /** `floor()` calls that returned null (structurally impossible). */
  mechanismSkips = 0;
  /** `run()` calls — the ones the floor pruning let through. */
  mechanismRuns = 0;
  /** Candidates the decider weighed. */
  candidates = 0;

  // ── Graph search: the fact join (DIRECTION) ─────────────────────────────
  //
  // The join's outcome was observable ONLY through the rationale, and the
  // rationale PERTURBS the search (measured: appending text to a refusal note
  // changed a traced answer).  These four counters are the untraced view — the
  // same surface every other work counter uses, incremented where the decision
  // is made, never behind a trace guard.
  /** `deriveThrough` yielded — a fact was reached through the subject the query
   *  never named. */
  joinFired = 0;
  /** Refused: no key names the entity and the tail together.  (A key that
   *  resolves but leads nowhere is not "refused" — it is not the relation, so
   *  the scan simply moves on; there is no counter for a case the loop cannot
   *  reach.) */
  joinNoKey = 0;
  /** Refused: the fact contains no entity that leads anywhere. */
  joinNoEntity = 0;
  /** `recompleteNode` re-covered a produced form — the descent that decomposes
   *  a completion by ITS OWN kids.  Without this the descent is invisible: a
   *  caller could see the chain's result but not whether the recomposition
   *  happened, so "the recursion stopped" and "the recursion never ran" were
   *  indistinguishable from the counters alone. */
  recompletes = 0;

  // ── Mind: the multi-hop pivot (EXTENSION) ───────────────────────────────
  //
  // `pivotStep` was observable only through the rationale, and the rationale
  // perturbs the search (measured).  How far the reasoner hopped is a
  // BEHAVIOUR, so it needs an untraced view: one counter, incremented where the
  // step is emitted.
  /** Times the reasoner pivoted on a span its answer contains and stepped
   *  across that fact. */
  pivotSteps = 0;
  /** Times the multi-hop chain consumed its hop allowance to the end
   *  (`recallQueryK`) instead of stopping.  The two exits were indistinguishable
   *  — the chain's `done` note says "fixpoint" either way, which is true only
   *  for the stopping one — so this says the hops ran out.
   *
   *  Necessary but NOT sufficient to call it a cut: an answer can be complete
   *  with the allowance spent to the last hop.  What separates "the reach was
   *  cut" from "the count ran out on a finished chain" is whether a further step
   *  existed, which only the rationale can say (the note).  Counters state
   *  facts; interpretation stays with the reader.
   *
   *  NO FIXTURE IN THE SUITE REACHES THIS EXIT — measured, not assumed: the
   *  3-link chain of test/110 still stops by structure after one pivot with
   *  `recallQueryK` at 2 and at its default, so this stays absent.  It is
   *  reachable in principle — a chain that spends every hop it is allowed and
   *  would take one more — and on none of the corpora that exist here.
   *  Tightening `recallQueryK` does NOT produce it, because the same number is
   *  also the pivot's probe budget (`resonance.ts`), which then cannot find a
   *  pivot at all: the duplication this work exists to remove, blocking its own
   *  test. */
  reasonHopsExhausted = 0;
  /** Branch-node probes the pivot sweep actually spent looking for the learnt
   *  context an answer contains (one `resonate` per probe).  The untraced view
   *  of what the multi-hop's shortlist costs. */
  pivotProbes = 0;
  /** Branch nodes the pivot's probe cap withheld (`branchCount − probeCap`, over
   *  every call).  A capacity fact, not a verdict: the sweep is breadth-first,
   *  so the probes it DOES spend are the largest regions, and recognition still
   *  contributes every exact containment candidate regardless of the budget.
   *  Read it with {@link pivotProbes} — one says the work, the other the
   *  shortfall. */
  pivotBranchesUnprobed = 0;

  // ── Mind: the cover's connector assembly (LIMIT) ────────────────────────
  //
  // The cover's `run` is 91% of a hub query's time (`"Hello."`: 2.7 s of 3.0 s)
  // and holds its ~270 MB peak, and none of it was countable: `searchPushes`
  // and `candidates` do not see the connector assembly.  These two counters are
  // the untraced view of it.
  /** `bridge` calls the cover makes assembling connectors (pairwise + n-ary). */
  coverBridges = 0;
  /** Continuations a CHAIN hop offered the search.  Bounded by the question
   *  (`ceil(queryLen / W)`) rather than by the corpus's fan-out — measured on a
   *  hub of degree 1083, offering every continuation grew the chart to 3113 outs
   *  and cost a 270 MB peak / 256 MB OOM for a two-word question. */
  chainOffers = 0;
  /** Σ byte-allowance the n-ary interior passes those bridges.  The allowance
   *  is `middleBytes + (m + 1) * W` — every intermediate answer's bytes plus
   *  one window of glue per joint — so it is the quantity that grows with a hub
   *  query's answers, and the first thing to read when the peak moves. */
  coverAllowanceBytes = 0;

  // ── Phases ──────────────────────────────────────────────────────────────

  private readonly _phases = new Map<string, PhaseCost>();
  private readonly _t0 = performance.now();

  /** Every work counter's current value, by name — the snapshot `time`
   *  differences to attribute work to a phase. */
  private snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(this)) {
      if (k.charCodeAt(0) === 0x5f) continue;
      if (typeof v === "number") out[k] = v;
    }
    return out;
  }

  /** Charge `ms`, one call, and a counter delta to a named phase.
   *  Insertion-ordered, so a report reads in execution order. */
  charge(phase: string, ms: number, delta?: Record<string, number>): void {
    let p = this._phases.get(phase);
    if (p === undefined) {
      this._phases.set(phase, p = { calls: 0, ms: 0, counters: {} });
    }
    p.calls++;
    p.ms += ms;
    if (delta) {
      for (const [k, v] of Object.entries(delta)) {
        if (v !== 0) p.counters[k] = (p.counters[k] ?? 0) + v;
      }
    }
  }

  /* * Time one SYNCHRONOUS phase.  The sync/async seam is a real contract
   * (meter.md) — perception, recognition and the graph search are synchronous —
   * so a synchronous layer must not be wrapped in `time`'s promise just to be
   * measured: that would make the profiled path await where the unprofiled one
   * does not, and a meter never changes what a layer computes. */
  timeSync<T>(phase: string, fn: () => T): T {
    const before = this.snapshot();
    const t = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - t;
      const after = this.snapshot();
      const delta: Record<string, number> = {};
      for (const k of Object.keys(after)) delta[k] = after[k] - before[k];
      this.charge(phase, ms, delta);
    }
  }

  /** Time one async phase and attribute the work done inside it.  Returns
   *  the awaited value untouched — a meter never changes what a layer
   *  computes, only what is known about it. */
  async time<T>(phase: string, fn: () => Promise<T>): Promise<T> {
    const before = this.snapshot();
    const t = performance.now();
    try {
      return await fn();
    } finally {
      const ms = performance.now() - t;
      const after = this.snapshot();
      const delta: Record<string, number> = {};
      for (const k of Object.keys(after)) delta[k] = after[k] - before[k];
      this.charge(phase, ms, delta);
    }
  }

  // ── Read-out ────────────────────────────────────────────────────────────

  /** The finished report.  Zero-valued counters are dropped: a report should
   *  show what a query DID, not the whole vocabulary of what it might have. */
  report(queryBytes: number): CostReport {
    const counters: Record<string, number> = {};
    for (const [k, v] of Object.entries(this)) {
      // `_`-prefixed fields are the meter's own bookkeeping (`_t0` is a
      // non-zero number and would otherwise read as a work counter).
      if (k.charCodeAt(0) === 0x5f) continue;
      if (typeof v === "number" && v !== 0) counters[k] = v;
    }
    const phases: Record<string, PhaseCost> = {};
    for (const [k, v] of this._phases) {
      phases[k] = { calls: v.calls, ms: v.ms, counters: { ...v.counters } };
    }
    return {
      version: 1,
      elapsedMs: performance.now() - this._t0,
      queryBytes,
      counters,
      phases,
    };
  }
}

/** Sum a set of reports into one — for aggregating a battery of probes or a
 *  multi-turn session.  `elapsedMs` and `queryBytes` add; counters and phases
 *  merge by key. */
export function sumReports(reports: readonly CostReport[]): CostReport {
  const counters: Record<string, number> = {};
  const phases: Record<string, PhaseCost> = {};
  let elapsedMs = 0;
  let queryBytes = 0;
  for (const r of reports) {
    elapsedMs += r.elapsedMs;
    queryBytes += r.queryBytes;
    for (const [k, v] of Object.entries(r.counters)) {
      counters[k] = (counters[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(r.phases)) {
      const p = phases[k] ??= { calls: 0, ms: 0, counters: {} };
      p.calls += v.calls;
      p.ms += v.ms;
      for (const [ck, cv] of Object.entries(v.counters)) {
        p.counters[ck] = (p.counters[ck] ?? 0) + cv;
      }
    }
  }
  return { version: 1, elapsedMs, queryBytes, counters, phases };
}

/** A human-readable rendering of a report — the shape a profiling run prints.
 *  Pure formatting; no ANSI, so it is safe to log anywhere. */
export function formatReport(r: CostReport): string {
  const lines: string[] = [];
  lines.push(
    `cost: ${r.elapsedMs.toFixed(1)}ms over ${r.queryBytes} query byte(s)`,
  );
  const names = Object.keys(r.counters).sort();
  const w = names.reduce((m, n) => Math.max(m, n.length), 0);
  for (const n of names) {
    lines.push(`  ${n.padEnd(w)}  ${r.counters[n].toLocaleString("en-US")}`);
  }
  const ph = Object.entries(r.phases);
  if (ph.length > 0) {
    lines.push("  phases (nested — inclusive, do not sum):");
    const pw = ph.reduce((m, [n]) => Math.max(m, n.length), 0);
    for (const [n, p] of ph) {
      // The three heaviest counters inside the phase — enough to say WHAT it
      // spent, without reprinting the whole vocabulary per line.
      const top = Object.entries(p.counters)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`)
        .join(", ");
      lines.push(
        `    ${n.padEnd(pw)}  ${p.calls}× ${p.ms.toFixed(1)}ms${
          top ? `  [${top}]` : ""
        }`,
      );
    }
  }
  return lines.join("\n");
}
