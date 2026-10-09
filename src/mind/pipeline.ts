// pipeline.ts — the think pipeline (Section 5 of the mind).
//
// think() is the whole file's job: one lightest-derivation choice among
// UNIFORM mechanisms.  The pipeline sees mechanisms through the
// PipelineMechanism interface only — it never imports a mechanism-specific
// type and never has a special-case branch for any mechanism.  Adding a
// mechanism means registering one object; removing one means dropping it
// from the list.  The mechanisms themselves live in mechanisms/ (one file
// each); the shared pre-computation they exchange lives in Precomputed
// (pipeline-mechanism.ts).

import type { MindContext } from "./types.js";
import { PASS, STEP } from "./graph-search.js";
import type { ComputedSpan } from "../extension.js";
import { gistOf, read, resolve } from "./primitives.js";
import { recognise } from "./recognition.js";
import { fusionLayer, walkLayer } from "./reasoning.js";
import {
  closed,
  closeOver,
  type DerivationState,
  remainderOf,
  type Span,
  unaccountedBytes,
  unexplainedSpans,
  windowOf,
} from "./derivation.js";
import { rItem } from "./trace.js";
import { unexplainedLabel } from "./rationale.js";
import {
  hubBound,
  offsetCanon,
  readsOffInstances,
  scaffoldExtents,
} from "./traverse.js";
import { windowIndex, witness } from "./evidence.js";
import { indexOf } from "../bytes.js";
import {
  type MechanismResult,
  type PipelineMechanism,
  Precomputed,
} from "./pipeline-mechanism.js";
import { coverMechanism } from "./mechanisms/cover.js";
import { castMechanism } from "./mechanisms/cast.js";
import { confluenceMechanism } from "./mechanisms/confluence.js";
import { extractionMechanism } from "./mechanisms/extraction.js";
import { referenceMechanism } from "./mechanisms/reference.js";
import { prefixMechanism } from "./mechanisms/prefix-completion.js";
import { recallMechanism } from "./mechanisms/recall.js";

// Re-exports: cover's pre-resolution helpers and the ALU adapter kept
// importable from the pipeline module (their historical home).
export { offerConcepts, offerConnectors } from "./mechanisms/cover.js";
export { aluToMechanism } from "./mechanisms/alu.js";

// ── Extension dispatch (pre-loop parse) ─────────────────────────────────────

async function collectComputed(
  ctx: MindContext,
  mechanisms: readonly PipelineMechanism[],
  query: Uint8Array,
): Promise<ComputedSpan[]> {
  const out: ComputedSpan[] = [];
  const meter = ctx.meter;
  for (const m of mechanisms) {
    if (!m.parse) continue;
    const spans = meter
      ? await meter.time(`${m.name}.parse`, () => m.parse!(query))
      : await m.parse(query);
    out.push(...spans);
  }
  return out;
}

// ── Built-in mechanisms ─────────────────────────────────────────────────────

// ORDER MATTERS, but only through the uniform floor/worthRunning pruning —
// no mechanism is special-cased.  Cover runs FIRST: when a computed
// extension result (e.g. ALU) exists, cover masks it in at near-zero cost
// (see mechanisms/cover.ts), which becomes `best` before any other mechanism
// invests in its own precomputation.  CAST's and confluence's floors (2*STEP,
// 3*STEP) then fail `worthRunning` and are skipped by the SAME admissible-
// floor pruning every mechanism is already subject to — not by asking
// "is this an extension?". Grade TIES keep the earlier candidate, so this
// order is also the tie-break priority: cover, cast, confluence, extraction,
// reference, recall.
//
// REFERENCE sits after extraction and before recall because that is what its
// claim is worth: extraction READS a span out of the query (no synthesis),
// reference voices one through a learnt slot, and recall's tiers degrade
// toward echo and silence.  It does not PRUNE recall — its floor is two
// projections, so recall's one-STEP floor still clears `worthRunning` — and it
// is not meant to: both run, share one resonance read
// (Precomputed.resonance), and the ladder decides.
export const defaultMechanisms: PipelineMechanism[] = [
  coverMechanism,
  castMechanism,
  confluenceMechanism,
  extractionMechanism,
  referenceMechanism,
  recallMechanism,
  prefixMechanism,
];

// ── think — the main inference pipeline ─────────────────────────────────────

export type Provenance =
  | "cast"
  | "join"
  | "cover"
  | "extract"
  | "reference"
  | "recall"
  | "recall-echo"
  | "prefix";

export interface Thought {
  bytes: Uint8Array;
  provenance: Provenance;
}

/** Structured payload of the "decideGrounding" rationale step — the same
 *  numbers the human-readable candidate labels already carry, exposed as
 *  data so a downstream tool need not parse free text.  Purely additive
 *  instrumentation: built only under `ctx.trace?.` (optional chaining
 *  short-circuits its arguments), never read by inference. */
export interface DecideGroundingData {
  version: 1;
  /** Every grounding candidate weighed, in consideration order. */
  candidates: Array<{
    provenance: string;
    /** The candidate's exact weight in the one cost ladder. */
    weight: number;
    /** The DISCRETE grade the decision actually compares (floor(weight/STEP)). */
    grade: number;
    /** Query bytes the candidate's accounted spans leave unexplained. */
    unexplainedBytes: number;
    /** Whether this candidate won the decision. */
    decided: boolean;
  }>;
  /** Grade margin between the winner and the runner-up, when both exist —
   *  the same quantity the "narrowDecision" step reports as narrow when
   *  ≤ 1.  Absent for a single-candidate decision. */
  runnerUpMargin?: number;
}

/** Structured payload of the "narrowDecision" rationale step. */
export interface NarrowDecisionData {
  version: 1;
  margin: number;
}

/** Structured payload of the "regimePrediction" rationale step — the R8
 *  observation exposed as data. After the first mechanism (cover, which
 * mechanism-market.md runs first) grounds or abstains, the market's whole
 * outcome is already determined by the one cost ladder: the consensus climb
 * runs exactly when `worthRunning(2 * STEP)` is true — CAST (floor 2·STEP) is
 * the cheapest mechanism that first-touches it, and confluence (3·STEP) /
 * extraction (CONCEPT+STEP) are only reached after CAST is. An incumbent at or
 * below that floor prunes CAST and, with it, the climb (retrieval); anything
 * above — or no incumbent — runs the full market and the climb (composition).
 * Purely observational; never read by inference. */
export interface RegimePredictionData {
  version: 1;
  /** retrieval | composition — the two regimes R1 measured as a ~100× cost
   *  step. */
  regime: "retrieval" | "composition";
  /** The incumbent's grade once the first mechanism's turn is over (it ran, or
   *  it was skipped), or null when nothing has grounded — `best === null`,
   *  which is composition with no incumbent. */
  incumbentGrade: number | null;
  /** The cheapest composition floor in grade units (`grade(2 * STEP)` = 2,
   *  CAST's floor) — the bar the incumbent must sit at or below for the
   *  consensus climb to be skipped. */
  climbFloorGrade: number;
  /** The lowest grade reached by a mechanism run AHEAD of a dearer one (see
   *  the grounding loop), when one ran and grounded: a bound below
   *  `climbFloorGrade` makes the regime retrieval whatever the incumbent. */
  boundGrade?: number;
}

/** Think: a single lightest-derivation exploration of the Sema graph.
 *
 *  Every answer travels the same path:
 *    1. Pre-computation — recognise, extension parse, guide; everything
 *       expensive stays lazy on Precomputed until a mechanism asks.
 *    2. Grounding — every mechanism yields candidates weighed in the one
 *       cost ladder; the lightest grounding derivation wins.
 *    3. Post-grounding — diagnostics (narrowDecision, thinGrounding),
 *       reasoning (multi-hop), fusion (multi-topic). */
export async function think(
  ctx: MindContext,
  query: Uint8Array,
  mechs?: readonly PipelineMechanism[],
): Promise<Thought | null> {
  if (query.length === 0) return null;

  ctx._edgeGuide = gistOf(ctx, query);
  {
    const asked = offsetCanon(ctx, query);
    ctx._edgeAsked = {
      bytes: asked,
      index: windowIndex(asked, ctx.space.maxGroup),
    };
  }
  ctx._edgeChoice.clear();

  const t = ctx.trace?.enter("think", [rItem(query, "query")]);
  const done = (answer: Uint8Array | null, note: string) => {
    t?.done(
      answer
        ? [rItem(answer, "answer", resolve(ctx, answer) ?? undefined)]
        : [],
      note,
    );
    return answer;
  };

  // ── Pre-computation ──────────────────────────────────────────────────
  const mechanisms = mechs ?? defaultMechanisms;
  const meter = ctx.meter;
  // recognition is a shared analysis (meter.md contract 5): it does the query's
  // own store work (perceive → foldTree → resolve), which used to land in
  // `think` and in nothing narrower — the meter's one accounting surface must
  // charge it to itself, exactly as attention/weave/resonance are charged.
  // SYNCHRONOUS phase: recognition is on the sync side of meter.md's seam, so
  // it is timed with `timeSync` — wrapping it in a promise would make a
  // profiled response await where an unprofiled one does not.
  const rec = meter
    ? meter.timeSync("recognise", () => recognise(ctx, query))
    : recognise(ctx, query);

  // Phase 1: collect computed spans from mechanisms that implement parse()
  const computed = meter
    ? await meter.time(
      "collectComputed",
      () => collectComputed(ctx, mechanisms, query),
    )
    : await collectComputed(ctx, mechanisms, query);

  if (computed.length > 0) {
    ctx.trace?.step(
      "computeExtensions",
      [rItem(query, "query")],
      computed.map((u) =>
        rItem(query.subarray(u.i, u.j), "operand", undefined, [u.i, u.j])
      ),
      `extensions recognised and evaluated ${computed.length} computation(s)`,
    );
    for (const u of computed) {
      ctx.trace?.step(
        "evalComputation",
        [rItem(query.subarray(u.i, u.j), "expression", undefined, [u.i, u.j])],
        [rItem(u.bytes, "result", resolve(ctx, u.bytes) ?? undefined)],
        "evaluate the recognised operation to its authoritative result",
      );
    }
  }

  // Phase 2: the shared pre-computation container. Eager fields only
  // (recognition, computed spans, guide) — every expensive analysis (consensus
  // climb, weave, span-shape classification) is a lazily-cached method on
  // Precomputed, first-touched by whichever mechanism's floor survives its
  // cheap gates and the worthRunning check. A query no mechanism climbs for
  // (e.g. one an extension decided) never climbs. NOT phased: the constructor
  // itself is trivial (it only derives `k`), so a phase here would add a
  // zero-work entry to every profiled report — the meter attributes WORK
  // (meter.md); the trace already represents structure.
  const pre = new Precomputed(ctx, query, rec, computed, ctx._edgeGuide);

  // ── Grounding: ONE lightest-derivation choice among the mechanisms ────

  interface Candidate {
    bytes: Uint8Array;
    provenance: string;
    weight: number;
    used?: ReadonlySet<number>;
    accounted: ReadonlyArray<[number, number]>;
    complete?: boolean;
    /** Bytes of this candidate's ANSWER that came from spans nothing
     *  recognised — query words carried through verbatim (see
     *  {@link liftedScaffolding}).  Absent means none/unreported. */
    scaffolding?: number;
  }
  const grade = (w: number) => Math.floor(w / STEP);
  const unaccounted = (spans: ReadonlyArray<[number, number]>): number =>
    unaccountedBytes(unexplainedSpans(query.length, spans));
  const weigh = (
    accounted: ReadonlyArray<[number, number]>,
    moves: number,
  ): number => moves + PASS * unaccounted(accounted);

  const candidates: Candidate[] = [];
  let best: Candidate | null = null;
  const consider = (c: Candidate) => {
    if (c.bytes.length === 0) return;
    if (ctx.meter) ctx.meter.candidates++;
    candidates.push(c);
    if (best === null) {
      best = c;
      return;
    }
    const g = grade(c.weight), gb = grade(best.weight);
    if (g < gb) {
      best = c;
      return;
    }
    // TIE-BREAK: AT EQUAL GRADE, PREFER THE ANSWER THAT INVENTS LESS.
    //
    // The ladder prices what a candidate leaves UNACCOUNTED, which is the
    // right primary question but cannot separate two candidates that leave
    // the same bytes unaccounted — and then the winner is whichever mechanism
    // happened to be considered first, which is not a reason.
    //
    // What still separates them is what they DID with those bytes.  A
    // candidate that carries an unexplained span into its answer is passing
    // the asker's own words back as if they were derived; one that leaves
    // them out has made a smaller, honest claim.  Measured on test/22's
    // two-fact chain: cover and recall both graded 11001 over 11 unexplained
    // bytes, cover answering "The capital of France is Paris famous for" (11
    // bytes of scaffolding) against recall's crossing of the hop (0).  Order
    // alone decided it, and the shallower reading won.
    //
    // This never overrides the ladder — it only orders within one grade, so
    // coverage and moves still dominate exactly as before.
    if (g === gb && (c.scaffolding ?? 0) < (best.scaffolding ?? 0)) best = c;
  };
  const worthRunning = (floor: number) =>
    best === null || grade(floor) < grade(best.weight);

  // REGIME PREDICTION (R8) — observational only. Once the FIRST mechanism has
  // had its turn (cover, which mechanism-market.md places first and floors at
  // 0), the market's outcome is already determined by the one cost ladder: the
  // consensus climb runs exactly when `worthRunning(2 * STEP)` is true — CAST
  // (floor 2·STEP) is the cheapest mechanism that first-touches it, so an
  // incumbent at or below grade 2 prunes CAST and, with it, confluence (3·STEP)
  // and extraction (CONCEPT+STEP) (retrieval); anything above — or no incumbent
  // — runs the full market and the climb (composition). The predicate is
  // `worthRunning`, the same function the loop itself uses — nothing is
  // computed here that the engine had not already computed, and nothing is read
  // back by inference.
  //
  // EMITTED BEFORE THE SECOND MECHANISM'S FLOOR, never after some mechanism's
  // run: a "prediction" published after the fact could assert "the climb will
  // not run" about a climb that already ran — which is what happens whenever
  // the first mechanism is SKIPPED (null floor or pruned) and the block sits at
  // the end of the first mechanism that actually ran.  Emitting on entry to
  // iteration 1 makes the claim true by construction, whatever the first
  // mechanism did, and keeps the payload identical on the ordinary path (the
  // incumbent cannot change between the two positions).
  let regimeReported = false;
  const reportRegime = () => {
    if (regimeReported) return;
    regimeReported = true;
    const climbFloorGrade = grade(2 * STEP);
    // TS narrows `best` to null in the outer flow (it cannot see the closure
    // assignments in `consider`) — cast back, the same read-back as `decided`
    // below.
    const incumbent = best as Candidate | null;
    const incumbentGrade = incumbent === null ? null : grade(incumbent.weight);
    const regime: "retrieval" | "composition" = worthDeclared(2 * STEP)
      ? "composition"
      : "retrieval";
    ctx.trace?.step(
      "regimePrediction",
      [rItem(query, "query")],
      [],
      regime === "retrieval"
        ? (incumbentGrade !== null && incumbentGrade <= climbFloorGrade
          ? `retrieval regime — incumbent grade ${incumbentGrade} ≤ climb floor ${climbFloorGrade}, `
          : `retrieval regime — grade ${bound} already reached by a mechanism run ahead, below climb floor ${climbFloorGrade}, `) +
          `so no mechanism floored above that grade runs; CAST will not climb`
        : `composition regime — ${
          incumbentGrade === null
            ? "no incumbent (nothing grounded)"
            : `incumbent grade ${incumbentGrade}`
        } above climb floor ${climbFloorGrade}, so the full market and climb run`,
      undefined,
      {
        version: 1,
        regime,
        incumbentGrade,
        climbFloorGrade,
        ...(bound !== Infinity ? { boundGrade: bound } : {}),
      } satisfies RegimePredictionData,
    );
  };
  // Phase 3: grounding loop
  // Per-mechanism accounting (src/meter.ts).  The market's whole premise is
  // that mechanisms compete on one cost scale — so the profiling read-out is
  // also per-mechanism, uniformly: the loop never asks which one it holds.
  //
  // A CHEAPER BOUND IS LOOKED AT BEFORE A DEARER ONE IS PAID FOR.
  //
  // The declared order is the tie-break priority, and the pruning above is
  // only as strong as the incumbent it has: a mechanism floored LOWER than the
  // one about to invest, but declared after it, could not prune it.  Measured
  // on the 31.7M-node store: a lowercased dialogue turn (#97 of the battery)
  // was won by recall at grade 1 — after CAST (floor grade 2) had paid the
  // consensus climb and the weave, confluence (3) a reach climb, and extraction
  // and reference their reads: ~10 s of a 12.6 s response, for candidates that
  // could not win.
  //
  // So before mechanism `m` first-touches anything, every LATER mechanism whose
  // bound is strictly lower runs AHEAD of it, cheapest bound first, and the
  // lowest grade any of them reaches becomes `bound`.  A mechanism whose floor
  // grade exceeds `bound` is then skipped.  THE DECISION IS UNCHANGED — the
  // same candidate wins as in the declared order:
  //   • a mechanism `p` run ahead with best grade g bounds the final grade by
  //     g: in the declared order p either runs (its candidate is weighed) or is
  //     pruned by an incumbent already at or below p's floor ≤ g;
  //   • so a mechanism floored above `bound` has only candidates the final
  //     winner strictly outgrades — and with every candidate above `bound`
  //     dropped, every mechanism floored at or below it meets the same
  //     run-or-prune decision (`f < incumbent` iff `f < min(incumbent,
  //     bound + 1)` for f ≤ bound) and yields the same candidates;
  //   • and the winner is chosen from the candidates at or below `bound`, in
  //     declared order — `consider` replays them where they are declared.
  // Equal-grade floors are NOT skipped (≤, not <): a mechanism declared earlier
  // keeps the tie it would have won.  Running `p` ahead is never extra work:
  // what prunes p in the declared order is a candidate at or below p's floor,
  // which only a mechanism floored at or below it can produce — and every such
  // mechanism is either already run or run ahead of p.
  //
  // The bound is learnt by asking `floor` with a `worthRunning` that refuses:
  // under the investment discipline (pipeline-mechanism.ts) a floor that cannot
  // pay returns its bound UNINVESTED, so the question costs no analysis.
  const refuse = () => false;
  const probed: Array<number | null | undefined> = new Array(
    mechanisms.length,
  );
  const probeGrade = async (i: number): Promise<number | null> => {
    if (probed[i] === undefined) {
      const f = await mechanisms[i].floor(ctx, query, pre, refuse);
      probed[i] = f === null ? null : grade(f);
    }
    return probed[i]!;
  };
  /** Per mechanism: its floor once computed, and its results once run. */
  const floors = new Map<number, number | null>();
  const runs = new Map<
    number,
    { results: MechanismResult[]; points: boolean }
  >();
  let bound = Infinity;
  const worthAhead = (floor: number) =>
    grade(floor) <
      Math.min(best === null ? Infinity : grade(best.weight), bound);
  const worthDeclared = (floor: number) =>
    worthRunning(floor) && grade(floor) <= bound;
  const floorOf = async (
    i: number,
    worth: (floor: number) => boolean,
  ): Promise<number | null> => {
    if (floors.has(i)) return floors.get(i)!;
    const mech = mechanisms[i];
    const floor = meter
      ? await meter.time(
        `${mech.name}.floor`,
        () => mech.floor(ctx, query, pre, worth),
      )
      : await mech.floor(ctx, query, pre, worth);
    if (meter) {
      if (floor === null) meter.mechanismSkips++;
      else meter.mechanismFloors++;
    }
    floors.set(i, floor);
    return floor;
  };
  // A RESULT RUN AHEAD IS THE DECLARED ORDER'S ONLY IF IT SAW WHAT THE DECLARED
  // ORDER WOULD HAVE SHOWN IT.  A mechanism run ahead of the consensus climb
  // reads the question without the climb's points, so the evidence that names
  // its pick through another instance (traverse.ts, `byCoInstance`) is not yet
  // there, and its result is priced as if the question had not named it.  At
  // its declared turn, after an earlier mechanism ran the climb, it is run
  // again (`mechanismReruns`) — when other instances of the question carry a
  // relation, the one evidence the climb adds; otherwise nothing it read has
  // changed.  Measured on the 2Wiki fixture, recall's
  // `The place of birth of John Lennon is Liverpool.` was the same bytes, owing
  // 49 bytes ahead of the climb and 27 after it, and the lighter reading was the
  // declared order's answer.
  const pointsShown = () => ctx._edgeAsked?.points !== undefined;
  const runOf = async (
    i: number,
    rerunWorth?: () => boolean,
  ): Promise<MechanismResult[]> => {
    const held = runs.get(i);
    if (
      held !== undefined &&
      (held.points || !pointsShown() || !(rerunWorth?.() ?? false))
    ) {
      return held.results;
    }
    const mech = mechanisms[i];
    if (meter) {
      meter.mechanismRuns++;
      if (held !== undefined) meter.mechanismReruns++;
    }
    const points = pointsShown();
    const results = meter
      ? await meter.time(`${mech.name}.run`, () => mech.run(ctx, query, pre))
      : await mech.run(ctx, query, pre);
    runs.set(i, { results, points });
    return results;
  };
  const runAhead = async (mi: number) => {
    const g = await probeGrade(mi);
    if (g === null) return;
    const ahead: Array<[number, number]> = [];
    for (let j = mi + 1; j < mechanisms.length; j++) {
      if (floors.has(j)) continue;
      const gj = await probeGrade(j);
      if (gj !== null && gj < g) ahead.push([gj, j]);
    }
    ahead.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [gj, j] of ahead) {
      // Only what the declared order would also run: a bound that cannot beat
      // what is already held is not even asked for its real floor.
      if (
        !(gj < Math.min(best === null ? Infinity : grade(best.weight), bound))
      ) {
        continue;
      }
      const floor = await floorOf(j, worthAhead);
      if (floor === null || !worthAhead(floor)) continue;
      ctx.trace?.step(
        "runAhead",
        [],
        [],
        `${mechanisms[j].name} runs ahead of ${
          mechanisms[mi].name
        } — its floor (grade ${grade(floor)}) is below ${
          mechanisms[mi].name
        }'s (grade ${g}), so its result bounds what ${
          mechanisms[mi].name
        } could win`,
      );
      for (const r of await runOf(j)) {
        // `consider` drops an empty answer, so it bounds nothing.
        if (r.bytes.length === 0) continue;
        bound = Math.min(bound, grade(weigh(r.accounted, r.moves)));
      }
    }
  };
  for (let mi = 0; mi < mechanisms.length; mi++) {
    const mech = mechanisms[mi];
    if (mi > 0) {
      await runAhead(mi);
      reportRegime();
    }
    const floor = await floorOf(mi, worthDeclared);
    if (floor === null) {
      ctx.trace?.step(
        "skipMechanism",
        [],
        [],
        `${mech.name} skipped — structural precondition failed`,
      );
      continue;
    }
    if (grade(floor) > bound) {
      if (meter) meter.mechanismsBounded++;
      ctx.trace?.step(
        "skipMechanism",
        [],
        [],
        `${mech.name} skipped — floor ${floor} cannot beat grade ${bound}, already reached by a mechanism run ahead`,
      );
      continue;
    }
    if (!worthRunning(floor)) {
      ctx.trace?.step(
        "skipMechanism",
        [],
        [],
        `${mech.name} skipped — floor ${floor} cannot beat incumbent (grade ${
          grade(best!.weight)
        })`,
      );
      continue;
    }
    const results = await runOf(mi, () => readsOffInstances(ctx));
    for (const r of results) {
      // ONE FORMULA, EVERY CANDIDATE: the chart's derivation reports how many
      // discrete moves it made and which bytes it could not recognise; the
      // currency prices both.  No mechanism passes a price of its own.
      const weight = weigh(r.accounted, r.moves);
      consider({
        bytes: r.bytes,
        provenance: r.provenance ?? mech.provenance,
        weight,
        used: r.used,
        accounted: r.accounted,
        complete: r.complete,
        scaffolding: r.scaffolding,
      });
    }
  }
  // A market of ONE mechanism never reaches iteration 1; the step is still
  // emitted exactly once per think(), so a consumer never has to ask whether
  // the list was long enough for the prediction to exist.
  reportRegime();

  // (TS cannot see the closure assignments into `best` and narrows it to its
  // initial null, so the read-back needs the assertion.)
  const decided = best as Candidate | null;
  if (candidates.length > 1) {
    // The runner-up is computed BEFORE the decideGrounding step so its grade
    // margin can ride along in the step's structured data payload; the
    // computation itself is pure and was always unconditional — only its
    // position moved.
    let runnerUp: Candidate | null = null;
    if (decided !== null) {
      for (const c of candidates) {
        if (c === decided) continue;
        if (runnerUp === null || grade(c.weight) < grade(runnerUp.weight)) {
          runnerUp = c;
        }
      }
    }
    const margin = decided !== null && runnerUp !== null
      ? grade(runnerUp.weight) - grade(decided.weight)
      : null;
    ctx.trace?.step(
      "decideGrounding",
      // THE LABEL IS RENDERED WHERE IT IS SHOWN.  It was a field on every
      // mechanism's result, and at every one of them it was exactly
      // `unexplainedLabel(query, accounted)` — a second representation of a
      // quantity one pure function already yields, computed on every response
      // whether or not anyone looked.  Here it is computed only when a rationale
      // is attached, because `trace?.step` short-circuits its arguments.
      candidates.map((c) => {
        const label = unexplainedLabel(query, c.accounted);
        return rItem(
          c.bytes,
          `${c.provenance} (weight ${c.weight.toFixed(3)}${
            label ? `, unexplained: "${label}"` : ""
          })`,
        );
      }),
      decided ? [rItem(decided.bytes, decided.provenance)] : [],
      "the lightest grounding derivation wins — every mechanism weighed in the one cost ladder",
      undefined,
      {
        version: 1,
        candidates: candidates.map((c) => ({
          provenance: c.provenance,
          weight: c.weight,
          grade: grade(c.weight),
          unexplainedBytes: unaccounted(c.accounted),
          decided: c === decided,
        })),
        ...(margin !== null ? { runnerUpMargin: margin } : {}),
      } satisfies DecideGroundingData,
    );
    if (decided !== null && runnerUp !== null && margin !== null) {
      if (margin <= 1) {
        ctx.trace?.step(
          "narrowDecision",
          [
            rItem(
              decided.bytes,
              `${decided.provenance} (weight ${decided.weight.toFixed(3)})`,
            ),
          ],
          [
            rItem(
              runnerUp.bytes,
              `${runnerUp.provenance} (weight ${runnerUp.weight.toFixed(3)})`,
            ),
          ],
          `margin ${margin} grade-unit(s) — the decision could change with one more training fact`,
          undefined,
          { version: 1, margin } satisfies NarrowDecisionData,
        );
      }
    }
  }

  if (decided === null) {
    done(null, "no mechanism grounded an answer");
    return null;
  }

  // Honesty density
  {
    const covered = query.length - unaccounted(decided.accounted);
    const density = query.length > 0 ? covered / query.length : 1;
    const thinBar = 1 / ctx.space.maxGroup;
    if (density < thinBar) {
      ctx.trace?.step(
        "thinGrounding",
        [rItem(decided.bytes, decided.provenance)],
        [],
        `grounded but thin — density ${density.toFixed(3)} is below 1/W (${
          thinBar.toFixed(3)
        })`,
      );
    }
  }
  const answer: Uint8Array = decided.bytes;
  const provenance = decided.provenance as Provenance;
  const declaredUsed = decided.used;

  // ── THE DERIVATION STATE ─────────────────────────────────────────────
  //
  // THE REASONER JUDGES ITS OWN EXTENSIONS BY THE PIPELINE'S REMAINDER, not by
  // the ladder's `accounted` — and by the SAME reading the fuse gate below uses,
  // with the same W floor.  `accounted` is a COST quantity (measured: a query
  // fully explained by one computed span plus bridged connectors reports
  // `accounted: []` while nothing is unexplained), and a remainder under one
  // river-fold quantum is bridging punctuation, never a second topic — so it
  // licenses no extension and blocks none.
  //
  // The state is built HERE, where these quantities are already computed, so it
  // costs nothing new: `accounted` is what the winning transition priced,
  // `remainder` is the coverage reading over `accounted ∪ the response's
  // computed spans` (the union is what makes the two different quantities, and
  // both are kept), `cost` is the ladder position, and the two declarations are
  // the producer's own (`fixed`, `used`).  What follows reads THIS state rather
  // than a tuple rebuilt at each call site.
  // A DERIVATION IS BORN OWING WHAT ITS ANSWER DOES NOT CARRY.  The winning
  // transition PRICED these spans, and pricing is not carrying: coverage claimed
  // without evidence stays owed, and a later transition pays it only by carrying
  // it (the law reads the window; see derivation.ts).  Same reading, one
  // definition — not a second spelling of it here.
  const priced: Array<[number, number]> = [
    ...decided.accounted,
    ...pre.computed.map((u): [number, number] => [u.i, u.j]),
  ];
  const explained = priced.filter(([a, b]) =>
    windowOf([a, b], answer, query, ctx.space.maxGroup) !== null
  );
  // THE DERIVATION IS BORN OWING ITS DISCRIMINATIVE MATERIAL.  The bytes a
  // corpus-global scaffolding window reaches (traverse.ts, `scaffoldExtents`)
  // are nobody's debt — otherwise a later step could claim to pay them by
  // restating ` is `, which every fact holds, and the law (which measures
  // carrying by any window of what is owed) would admit it; the substitution
  // bridge reads gaps the same way (`explainedSpan`).  PRICING is untouched:
  // the ladder still charges every unexplained byte, because for a question
  // made of nothing but scaffolding (`How are you today?`) covering those bytes
  // IS the evidence.
  const scaffold = scaffoldExtents(ctx, query);
  const paid = remainderOf(
    query.length,
    [...explained, ...scaffold],
    ctx.space.maxGroup,
  );
  // WHAT THE CONSTRUCTION WITHHOLDS, at or above one quantum: the difference between
  // the remainder paid in full and the remainder paid by carrying.  Both readings
  // are the law's, so the floor is applied once and in one place — and the
  // paid-in-full reading is computed only when a meter will read it.
  if (ctx.meter) {
    const paidInFull = remainderOf(query.length, priced, ctx.space.maxGroup);
    ctx.meter.groundingWithheldBytes += unaccountedBytes(paid) -
      unaccountedBytes(paidInFull);
  }
  const state: DerivationState = {
    product: answer,
    accounted: decided.accounted,
    remainder: paid,
    cost: decided.weight,
    fixed: decided.complete,
    used: decided.used,
  };
  const uncovered = state.remainder;

  // ── Post-grounding, gated by the declaration and the remainder ────────
  // WHAT THE GROUNDING SPOKE FOR, when it did not declare it: the forms inside
  // the answer that the ASKER already holds.  An answer is the asker's material
  // plus what the corpus added — the fact's own value — and only the former was
  // spoken for: re-entering it walks back to the question.  The latter is what a
  // chain continues THROUGH.  Consuming every form recognised in the answer
  // consumed that too, so a chain could start only where recognition happened
  // to miss the next entity — measured on 133 held-out 2Wiki compositional
  // questions, 3 pivot steps in all once interior recognition named the entity
  // inside every fact.  Witnessed exactly, as `chooseNext`'s exact tier reads the
  // question (evidence.ts); a form below one window cannot be witnessed, and is
  // consumed as before.
  const asked = ctx._edgeAsked;
  const preConsumed = declaredUsed ??
    new Set(
      recognise(ctx, answer).sites
        .filter((s) =>
          asked === null || s.end - s.start < ctx.space.maxGroup ||
          witness(
            offsetCanon(ctx, answer.subarray(s.start, s.end)),
            [asked.index],
            ctx.space.maxGroup,
          ).complete
        )
        .map((s) => s.payload),
    );
  // A grounding that DECLARED itself complete is not extended: the answer is
  // already a trained form's own continuation, reached through an identity
  // claim about the query, so a multi-hop pivot could only chain past the
  // fact that produced it (see MechanismResult.complete).
  // WHAT THE MECHANISM WITHHELD, NOT WHAT IT VOICED.  A pivot must not
  // re-open content a grounding deliberately kept out: comparison cites two
  // analogs and refuses their own downstream facts, so pivoting into one is
  // the mechanism's own refusal undone one step later (test/29 C2 pivoted
  // through `speare` — a stored fragment of the analog `William Shakespeare`
  // — into the biography CAST had declined).
  //
  // Reading the used anchors' OWN bytes here says something stronger and
  // wrong: that nothing INSIDE what was voiced may be pivoted through.  A
  // comparison's seat sentence legitimately contains further terms with
  // their own unrelated facts — `Mona Lisa`, inside the voiced seat `The Mona
  // Lisa was painted by Leonardo da Vinci.`, leads on to `Mona Lisa hangs in
  // the Louvre`, which is about neither analog (test/29 C3: a candidate the
  // walk takes only when the question names it).
  // The withheld content is the used anchors' CONTINUATIONS, so that is what
  // the containment rule reads: `speare` is contained in `Shakespeare wrote
  // 39 plays` and stays refused, while `Mona Lisa` appears in no withheld
  // continuation and stays a candidate.
  //
  // Only a mechanism carrying its own `used` set (cast/join) gets this: there
  // `preConsumed` is a deliberate, short list of the anchors the answer
  // speaks for, so the fan-out is bounded.  For every other provenance
  // `preConsumed` is derived by re-recognising the answer — "everything in
  // it", not "what it voiced" — and a containment rule over that would
  // suppress every pivot the answer legitimately contains.
  //
  // …and a continuation the ANSWER ITSELF holds was voiced, not withheld.  A
  // substitution that answers with its anchor's own continuation (`The director
  // of Beat Girl is Edmond T. Gréville.`) declared that anchor used, so reading
  // its continuations as withheld refused every pivot inside the answer — the
  // chain could never step past the entity the first hop introduced.
  const voiced = declaredUsed === undefined ? [] : [...declaredUsed].flatMap(
    (id) =>
      ctx.store.nextFirst(id, hubBound(ctx))
        .map((n) => read(ctx, n))
        .filter((v) => indexOf(answer, v, 0) < 0),
  );
  // WHAT THIS BRANCH READ, published where it was read.  Post-grounding decides
  // by the DECLARATION (`decided.used`, which becomes `voiced`), by what the
  // recognition already consumed (`preConsumed`) and by the derivation's own
  // remainder — never by the provenance NAME, which is REPORTED throughout and
  // compared nowhere (a stale comment here claimed otherwise; the register caught
  // it, and this is the correction).  The operands were invisible in the trace, so
  // a change to the branching could not be shown equivalent or otherwise from
  // outside — three separate investigations failed on exactly that gap.  A gap in instrumentation is a defect IN the instrumentation
  // (AGENTS.md §6): closed here, once, as counts only — never content.
  ctx.trace?.step(
    "postGrounding",
    [rItem(answer, provenance)],
    [],
    `used=${decided.used !== undefined ? "declared" : "absent"} · ` +
      `preConsumed=${preConsumed.size} · voiced=${voiced.length}`,
    undefined,
    {
      version: 1,
      provenance,
      usedDeclared: decided.used !== undefined,
      preConsumed: preConsumed.size,
      voiced: voiced.length,
      // THE STATE THE LAW GOVERNS, rendered where it is decided: what the asker
      // said that no step has accounted for, in spans at or above one quantum,
      // and whether the producer supplied a fixed point.  Counts only, like
      // every other operand here — and the spans are the state's, so a reader
      // can check them against the meter's aggregate of the same remainder.
      remainderSpans: state.remainder.length,
      remainderBytes: unaccountedBytes(state.remainder),
      fixed: state.fixed === true,
    },
  );
  // REPORTABLE, NOT SILENT.  A declared-complete grounding ends the derivation
  // here, and that decision is part of the derivation's shape: the reader of a
  // rationale must be able to see that the chain stopped because the mechanism
  // claimed the query WAS the context, not because nothing followed.  The step
  // carries the claim, not a re-description of the answer — the extension is
  // skipped, so there is no output item to show.
  if (decided.complete) {
    ctx.trace?.step(
      "completeGrounding",
      [rItem(answer, provenance)],
      [],
      "grounding declared complete — the query IS the context, so " +
        "post-grounding extension is skipped",
    );
  }
  // PUBLISHED, NOT RECOMPUTED: the same `uncovered` the gates below read.  A
  // write-only accounting (meter contract 1), so the number that licenses an
  // extension or a fusion stops being invisible.
  if (meter) {
    meter.postGroundingRemainderSpans += uncovered.length;
    meter.postGroundingRemainderBytes += unaccountedBytes(uncovered);
  }
  // ── THE CLOSURE ENGINE ───────────────────────────────────────────────
  //
  // The grounding's state is CLOSED under the law by two layers, in order: the
  // multi-hop WALK (`walkLayer`: a forward absorb or a pivot, offered one at a
  // time) and the multi-topic FUSION (`fusionLayer`: one composed transition).
  // Every step either layer offers goes through the same `closure` and the same
  // law; this function no longer sequences them or gates them by hand.
  //
  // WHAT USED TO BE TWO HAND-WRITTEN GATES IS NOW THE LAW'S, OR THE LAYER'S:
  //   • a declared-complete grounding (`fixed`) admits no transition — the
  //     engine enters no layer for it (the law's first clause), which is the
  //     walk-skip and the fusion-skip this branch used to spell separately;
  //   • a CLOSED derivation has nothing left for a second topic to account for,
  //     so the fusion layer does not ENGAGE — read off the state the walk
  //     reached, the one fusion is actually offered against.
  //
  // What the fusion needs from the grounding — whether its substance is purely
  // computed (`unclimbed`) and where it stands in the query (`primarySpans`) —
  // is the grounding's own evidence, resolved here where both readings are in
  // hand.
  //
  // Whether the winning candidate's entire recognised substance is COMPUTED —
  // every accounted span exactly a pre.computed span, nothing from a genuinely
  // recognised/climbed site.  fuseAttention's lone-root shortcut assumes a
  // single point of attention already IS primary's own source; that assumption
  // is exactly backwards for a pure computation (an ALU result has no anchor of
  // its own) — gated there by Attention.breadth so a coincidental echo (which
  // this flag alone cannot distinguish) is still rejected.
  const unclimbed = state.accounted.length > 0 &&
    state.accounted.every(([i, j]) =>
      pre.computed.some((u) => u.i === i && u.j === j)
    );
  // Where the winning grounding stands in the query — fusion places primary by
  // it.  `accounted` is the cost-ladder read and is authoritative when
  // non-empty; when it is empty the grounding is a pure COMPUTATION, whose
  // evidence is its computed span — the cost-ladder-vs-coverage distinction
  // `explained` above draws, read here for POSITION instead of coverage.
  const primarySpans: ReadonlyArray<Span> = state.accounted.length > 0
    ? state.accounted
    : pre.computed.map((u): [number, number] => [u.i, u.j]);
  const fused = await closeOver(
    state,
    query,
    ctx.space.maxGroup,
    [
      walkLayer(ctx, query, preConsumed, pre, voiced),
      {
        ...fusionLayer(ctx, query, pre, unclimbed, primarySpans),
        engages: (d: DerivationState) => !closed(d),
      },
    ],
    meter ? (name, walk) => meter.time(name, walk) : undefined,
  );

  done(
    fused.product,
    // NO CLAIM ABOUT FUSION HERE.  `fuseAttention` is entered whenever a
    // remainder ≥ W exists and returns early when there is nothing to bridge, so
    // this note used to assert a fusion that frequently did not happen (measured:
    // "What is the capital of France famous for" fuses 0 times).  The fusion is
    // reported by `fuseAttention`'s own `done` when it happens — the layer that
    // did the work is the layer that says so.
    "grounded, reasoned forward",
  );
  return { bytes: fused.product, provenance };
}
