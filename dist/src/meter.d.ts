/** Per-phase accumulation — one entry per mechanism `floor`/`run` and per
 *  named stage.
 *
 *  PHASES NEST, AND ARE NOT DISJOINT.  `think` contains every mechanism
 *  phase; a mechanism's `floor` contains whatever shared analysis it
 *  first-touched (`attention`, `weave`); `recall.run` contains
 *  `substitutionBridge`, which contains `recall.exhaustiveResonate`.  Read a
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
export declare class Meter {
    /** `store.get` — one node record materialised (cache hit or DB row). */
    nodeRecords: number;
    /** `store.bytes` / `store.bytesPrefix` — one reconstruction request. */
    byteReads: number;
    /** Bytes actually handed back by those reads — the real I/O volume, and
     *  the number that exposes an unbounded read (AGENTS §2.8) that a call
     *  count alone hides. */
    bytesRead: number;
    /** `store.contentLen`. */
    lenReads: number;
    /** `store.findLeaf`. */
    leafLookups: number;
    /** `store.findBranch`. */
    branchLookups: number;
    /** `store.canonFind` — equivalence-class candidate proposal. */
    canonLookups: number;
    /** `parents` + `parentsFirst` — materialising parent reads. */
    parentReads: number;
    /** `hasParents` — indexed existence probe. */
    parentProbes: number;
    /** `chainRun` — one bounded transparent-chain climb. */
    chainRuns: number;
    /** `containers` + `containersSlice`. */
    containerReads: number;
    /** `hasContainers` — indexed existence probe. */
    containerProbes: number;
    /** `next` + `nextFirst`. */
    edgeReads: number;
    /** `hasNext` — indexed existence probe. */
    edgeProbes: number;
    /** `prev` + `prevFirst`. */
    prevReads: number;
    /** `prevCount` — indexed count probe. */
    prevProbes: number;
    /** `halo` — one halo vector decoded. */
    haloReads: number;
    /** `hasHalo` + `haloMass` — probes that never decode a vector. */
    haloProbes: number;
    /** `resonate` calls that descended the content index. */
    annQueries: number;
    /** `resonate` calls served from the per-flush read cache. */
    annCacheHits: number;
    /** Stored vectors the content index actually scored — the dominant cost of
     *  a query on a large store, and the one counter that grows with N when a
     *  budget is missing. */
    annVectorReads: number;
    /** `resonateHalo` calls. */
    haloQueries: number;
    /** `perceive` calls that actually folded (memo misses only). */
    perceptions: number;
    /** Bytes folded by those perceptions — perception is O(bytes), so this is
     *  its true cost, and it is what a multi-turn regression shows up in first
     *  (re-folding the whole context instead of the new turn). */
    perceivedBytes: number;
    /** `perceive` calls served from the per-response / conversation memo. */
    perceiveHits: number;
    /** `recognise` calls that actually ran. */
    recognitions: number;
    /** Bytes recognised by those calls. */
    recognisedBytes: number;
    /** `recognise` calls served from the memo. */
    recogniseHits: number;
    /** `resolve` — whole-span content-addressed identity requests. */
    resolves: number;
    /** `climbAttentionAll` calls that actually climbed. */
    climbs: number;
    /** `climbAttentionAll` calls served from `climbMemo`. */
    climbHits: number;
    /** Query regions the climb voted on, summed over climbs. */
    climbRegions: number;
    /** Nodes popped and examined by `edgeAncestors` ascents — the climb's
     *  inner loop, and the thing `hubBound` is supposed to be bounding. */
    ancestorVisits: number;
    /** `alignGraded` / `alignRuns` invocations. */
    alignments: number;
    /** Σ (query bytes × context bytes) over those alignments — the alignment
     *  family is quadratic, so this is the honest unit. */
    alignCells: number;
    /** `junctionContainersFrom` ascents started — the cross-region ladder's
     *  and the bridge's shared "which learnt whole contains these two forms?"
     *  walk. */
    junctionWalks: number;
    /** Nodes popped by those ascents, against their √N·W budget — the counter
     *  that shows whether the walks are deciding early or burning the budget. */
    junctionPops: number;
    /** Arbitrary byte spans whose distributional company was VSA-bundled from
     *  existing episode halos. */
    spanHalos: number;
    /** Canonical W-windows examined while composing those span halos. */
    spanHaloWindows: number;
    /** `lightestDerivation` searches started. */
    searches: number;
    /** Chart items popped by those searches. */
    searchPops: number;
    /** Chart items pushed by those searches. */
    searchPushes: number;
    /** `floor()` calls that returned a bound (the mechanism could fire). */
    mechanismFloors: number;
    /** `floor()` calls that returned null (structurally impossible). */
    mechanismSkips: number;
    /** `run()` calls — the ones the floor pruning let through. */
    mechanismRuns: number;
    /** Candidates the decider weighed. */
    candidates: number;
    /** Candidates refused before the competition for explaining less than 1/W
     *  of the query — the honesty-density floor (see pipeline.ts `consider`). */
    thinRejects: number;
    private readonly _phases;
    private readonly _t0;
    /** Every work counter's current value, by name — the snapshot `time`
     *  differences to attribute work to a phase. */
    private snapshot;
    /** Charge `ms`, one call, and a counter delta to a named phase.
     *  Insertion-ordered, so a report reads in execution order. */
    charge(phase: string, ms: number, delta?: Record<string, number>): void;
    /** Time one async phase and attribute the work done inside it.  Returns
     *  the awaited value untouched — a meter never changes what a layer
     *  computes, only what is known about it. */
    time<T>(phase: string, fn: () => Promise<T>): Promise<T>;
    /** The finished report.  Zero-valued counters are dropped: a report should
     *  show what a query DID, not the whole vocabulary of what it might have. */
    report(queryBytes: number): CostReport;
}
/** Sum a set of reports into one — for aggregating a battery of probes or a
 *  multi-turn session.  `elapsedMs` and `queryBytes` add; counters and phases
 *  merge by key. */
export declare function sumReports(reports: readonly CostReport[]): CostReport;
/** A human-readable rendering of a report — the shape a profiling run prints.
 *  Pure formatting; no ANSI, so it is safe to log anywhere. */
export declare function formatReport(r: CostReport): string;
