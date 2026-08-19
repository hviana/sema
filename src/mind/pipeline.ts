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
import { fuseAttention, reason } from "./reasoning.js";
import { unexplainedSpans } from "./rationale.js";
import { rItem } from "./trace.js";
import { hubBound } from "./traverse.js";
import { type PipelineMechanism, Precomputed } from "./pipeline-mechanism.js";
import { coverMechanism } from "./mechanisms/cover.js";
import { castMechanism } from "./mechanisms/cast.js";
import { confluenceMechanism } from "./mechanisms/confluence.js";
import { extractionMechanism } from "./mechanisms/extraction.js";
import { referenceMechanism } from "./mechanisms/reference.js";
import { prefixMechanism } from "./mechanisms/prefix-completion.js";
import { recallMechanism } from "./mechanisms/recall.js";

// Re-exports: cover's pre-resolution helpers and the ALU adapter kept
// importable from the pipeline module (their historical home).
export { resolveConcepts, resolveConnectors } from "./mechanisms/cover.js";
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
 *  observation exposed as data.  After the first mechanism (cover, which §2.6
 *  runs first) grounds or abstains, the market's whole outcome is already
 *  determined by the one cost ladder: the consensus climb runs exactly when
 *  `worthRunning(2 * STEP)` is true — CAST (floor 2·STEP) is the cheapest
 *  mechanism that first-touches it, and confluence (3·STEP) / extraction
 *  (CONCEPT+STEP) are only reached after CAST is.  An incumbent at or below
 *  that floor prunes CAST and, with it, the climb (retrieval); anything above
 *  — or no incumbent — runs the full market and the climb (composition).
 *  Purely observational; never read by inference. */
export interface RegimePredictionData {
  version: 1;
  /** retrieval | composition — the two regimes R1 measured as a ~100× cost
   *  step. */
  regime: "retrieval" | "composition";
  /** The incumbent's grade right after the first mechanism ran, or null when
   *  it grounded nothing (best === null — composition, with no incumbent). */
  incumbentGrade: number | null;
  /** The cheapest composition floor in grade units (`grade(2 * STEP)` = 2,
   *  CAST's floor) — the bar the incumbent must sit at or below for the
   *  consensus climb to be skipped. */
  climbFloorGrade: number;
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
  // recognition is a shared analysis (§2.14 contract 5): it does the query's
  // own store work (perceive → foldTree → resolve), which used to land in
  // `think` and in nothing narrower — the meter's one accounting surface must
  // charge it to itself, exactly as attention/weave/resonance are charged.
  const rec = meter
    ? await meter.time("recognise", async () => recognise(ctx, query))
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

  // Phase 2: the shared pre-computation container.  Eager fields only
  // (recognition, computed spans, guide) — every expensive analysis
  // (consensus climb, weave, span-shape classification) is a lazily-cached
  // method on Precomputed, first-touched by whichever mechanism's floor
  // survives its cheap gates and the worthRunning check.  A query no
  // mechanism climbs for (e.g. one an extension decided) never climbs.
  // NOT phased: the constructor itself is trivial (it only derives `k`), so a
  // phase here would add a zero-work entry to every profiled report — the meter
  // attributes WORK (§2.14); the trace already represents structure.
  const pre = new Precomputed(ctx, query, rec, computed, ctx._edgeGuide);

  // ── Grounding: ONE lightest-derivation choice among the mechanisms ────

  interface Candidate {
    bytes: Uint8Array;
    provenance: string;
    weight: number;
    used?: ReadonlySet<number>;
    accounted: ReadonlyArray<[number, number]>;
    unexplained: string;
    complete?: boolean;
    /** Bytes of this candidate's ANSWER that came from spans nothing
     *  recognised — query words carried through verbatim (see
     *  {@link liftedScaffolding}).  Absent means none/unreported. */
    scaffolding?: number;
  }
  const grade = (w: number) => Math.floor(w / STEP);
  const unaccounted = (spans: ReadonlyArray<[number, number]>): number =>
    unexplainedSpans(query.length, spans)
      .reduce((sum, [s, e]) => sum + (e - s), 0);
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

  // Phase 3: grounding loop
  // Per-mechanism accounting (src/meter.ts).  The market's whole premise is
  // that mechanisms compete on one cost scale — so the profiling read-out is
  // also per-mechanism, uniformly: the loop never asks which one it holds.
  let regimeReported = false;
  for (const mech of mechanisms) {
    const floor = meter
      ? await meter.time(
        `${mech.name}.floor`,
        () => mech.floor(ctx, query, pre, worthRunning),
      )
      : await mech.floor(ctx, query, pre, worthRunning);
    if (meter) {
      if (floor === null) meter.mechanismSkips++;
      else meter.mechanismFloors++;
    }
    if (floor === null) {
      ctx.trace?.step(
        "skipMechanism",
        [],
        [],
        `${mech.name} skipped — structural precondition failed`,
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
    if (meter) meter.mechanismRuns++;
    const results = meter
      ? await meter.time(`${mech.name}.run`, () => mech.run(ctx, query, pre))
      : await mech.run(ctx, query, pre);
    for (const r of results) {
      const weight = r.weight ?? weigh(r.accounted, r.moves);
      consider({
        bytes: r.bytes,
        provenance: r.provenance ?? mech.provenance,
        weight,
        used: r.used,
        accounted: r.accounted,
        unexplained: r.unexplained,
        complete: r.complete,
        scaffolding: r.scaffolding,
      });
    }
    // REGIME PREDICTION (R8) — observational only.  After the FIRST mechanism
    // runs (cover, which §2.6 places first and floors at 0), the market's
    // outcome is already determined: the consensus climb runs exactly when
    // `worthRunning(2 * STEP)` is true — CAST (floor 2·STEP) is the cheapest
    // mechanism that first-touches it, so an incumbent at or below grade 2
    // prunes CAST and, with it, confluence (3·STEP) and extraction
    // (CONCEPT+STEP) (retrieval); anything above — or no incumbent — runs the
    // full market and the climb (composition).  The predicate is
    // `worthRunning`, the same function the loop just used — nothing is
    // computed here that the engine had not already computed, and nothing is
    // read back by inference.
    if (!regimeReported) {
      regimeReported = true;
      const climbFloorGrade = grade(2 * STEP);
      // TS narrows `best` to null in the outer flow (it cannot see the closure
      // assignments in `consider`) — cast back, the same read-back as `decided`
      // below.
      const incumbent = best as Candidate | null;
      const incumbentGrade = incumbent === null
        ? null
        : grade(incumbent.weight);
      const regime: "retrieval" | "composition" = worthRunning(2 * STEP)
        ? "composition"
        : "retrieval";
      ctx.trace?.step(
        "regimePrediction",
        [rItem(query, "query")],
        [],
        regime === "retrieval"
          ? `retrieval regime — incumbent grade ${incumbentGrade} ≤ climb floor ${climbFloorGrade}, so no composition mechanism runs; ` +
            `the consensus climb will not run`
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
        } satisfies RegimePredictionData,
      );
    }
  }

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
      candidates.map((c) =>
        rItem(
          c.bytes,
          `${c.provenance} (weight ${c.weight.toFixed(3)}${
            c.unexplained ? `, unexplained: "${c.unexplained}"` : ""
          })`,
        )
      ),
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
  const castUsed: ReadonlySet<number> = decided.used ?? new Set();

  // ── Post-grounding, gated by provenance ──────────────────────────────
  const preConsumed = provenance === "cast" || provenance === "join"
    ? castUsed
    : provenance === "recall" || provenance === "recall-echo"
    ? new Set<number>()
    : new Set(recognise(ctx, answer).sites.map((s) => s.payload));
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
  // their own unrelated facts, and C3 pins exactly that — `Mona Lisa`, inside
  // the voiced seat `The Mona Lisa was painted by Leonardo da Vinci.`, leads
  // on to `Mona Lisa hangs in the Louvre`, which is about neither analog.
  // The withheld content is the used anchors' CONTINUATIONS, so that is what
  // the containment rule reads: `speare` is contained in `Shakespeare wrote
  // 39 plays` and stays refused, while `Mona Lisa` appears in no withheld
  // continuation and the genuine further hop fires.
  //
  // Only a mechanism carrying its own `used` set (cast/join) gets this: there
  // `preConsumed` is a deliberate, short list of the anchors the answer
  // speaks for, so the fan-out is bounded.  For every other provenance
  // `preConsumed` is derived by re-recognising the answer — "everything in
  // it", not "what it voiced" — and a containment rule over that would
  // suppress every pivot the answer legitimately contains.
  const voiced = (provenance === "cast" || provenance === "join")
    ? [...castUsed].flatMap((id) =>
      ctx.store.nextFirst(id, hubBound(ctx)).map((n) => read(ctx, n))
    )
    : [];
  const reasoned = decided.complete ? answer : meter
    ? await meter.time(
      "reason",
      () => reason(ctx, query, answer, preConsumed, pre, voiced),
    )
    : await reason(ctx, query, answer, preConsumed, pre, voiced);

  // Fuse only when the query has a genuine REMAINDER no mechanism's
  // structural evidence touched at all.  `decided.accounted` alone
  // undercounts this: it is a COST-LADDER quantity (cover.ts prices its
  // masked/computed spans at near-zero and deliberately leaves them out of
  // `accounted` so PASS-bridged bytes are still charged), not a coverage
  // one — a query fully explained by one computed span plus bridged
  // connectors can report `accounted: []` while nothing is actually left
  // unexplained.  The genuine remainder is what NEITHER the winning
  // candidate's accounted spans NOR any recognised extension's computed
  // span (`pre.computed` — every mechanism's parse() output, ALU included)
  // ever touched.  A remainder under one river-fold quantum (W, the same
  // floor cover.ts's restatedSpan and the honesty-density bar above both
  // use) is bridging punctuation/whitespace, never a second topic —
  // observed: a single space between two fully-computed arithmetic spans
  // ("2+2 3+3") registered as "unaccounted" and pulled in an unrelated
  // corpus fact, corrupting "4 6" into "4 63".
  const explained: Array<[number, number]> = [
    ...decided.accounted,
    ...pre.computed.map((u): [number, number] => [u.i, u.j]),
  ];
  const remainder = unaccounted(explained);
  // Whether the winning candidate's entire recognised substance is
  // COMPUTED — every accounted span exactly a pre.computed span, nothing
  // from a genuinely recognised/climbed site.  fuseAttention's lone-root
  // shortcut assumes a single point of attention already IS primary's own
  // source; that assumption is exactly backwards for a pure computation
  // (an ALU result has no anchor of its own) — see fuseAttention's
  // `unclimbed` parameter, gated there by Attention.breadth so a
  // coincidental echo (which this flag alone cannot distinguish) is still
  // rejected.
  const unclimbed = decided.accounted.length > 0 &&
    decided.accounted.every(([i, j]) =>
      pre.computed.some((u) => u.i === i && u.j === j)
    );
  // Where the winning grounding stands in the query — fusion places primary
  // by it (see fuseAttention's `primarySpans`).  `accounted` is the
  // cost-ladder read and is authoritative when non-empty; when it is empty
  // the grounding is a pure COMPUTATION, whose evidence is its computed span.
  // Exactly the cost-ladder-vs-coverage distinction `explained` above draws,
  // read here for POSITION instead of for coverage — and resolved here, where
  // both readings are in hand, rather than inside fuseAttention.
  const primarySpans: ReadonlyArray<[number, number]> =
    decided.accounted.length > 0
      ? decided.accounted
      : pre.computed.map((u): [number, number] => [u.i, u.j]);
  const fused = remainder < ctx.space.maxGroup
    ? reasoned
    : meter
    ? await meter.time(
      "fuse",
      () => fuseAttention(ctx, query, reasoned, pre, unclimbed, primarySpans),
    )
    : await fuseAttention(
      ctx,
      query,
      reasoned,
      pre,
      unclimbed,
      decided.accounted,
    );

  done(
    fused,
    "grounded, reasoned forward, fused across points of attention",
  );
  return { bytes: fused, provenance };
}
