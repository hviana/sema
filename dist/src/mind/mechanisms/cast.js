// counterfactual.ts — Counterfactual Transfer / CAST (Section 4 of the mind).
//
// When a query weaves together byte-string evidence from multiple independently-
// learnt structures (disjoint run alignments, literal or distributional), CAST
// attempts to transfer structure between them — substitution, redirection, or
// analogical comparison — producing a counterfactual answer that goes beyond what
// the ordinary cover-and-extract pipeline can reach.
//
// CAST is a configuration of the elementary match-and-project operation
// (match.ts): matcher = alignGraded (literal W-gram runs + halo-matched pre.rec.sites),
// gate = the frame gate below + analogyStrength, projection = insert / project /
// juxtapose.
import { read } from "../primitives.js";
import { argmaxBy, hubBound } from "../traverse.js";
import { analogyStrength, follow, project, reverseContext } from "../match.js";
import { joinWithBridge } from "../resonance.js";
import { CONCEPT, STEP } from "../graph-search.js";
import { concat2, indexOf } from "../../bytes.js";
import { dominates } from "../../geometry.js";
import { unexplainedLabel } from "../rationale.js";
import { rItem, rNode } from "../trace.js";
// ── CAST gates ────────────────────────────────────────────────────────────
//
// The frame gate has TWO components, both derived from the weave itself:
//
//   1. MIN WEAVE — the same 2 as the precondition `points.length < 2` (CAST
//      needs at least two aligned structures to form a weave).  Frame requires
//      evidence BEYOND the minimum pair — a third structure agreeing — so the
//      depth gate is `depth > MIN_WEAVE`.  One definition, two uses.
//
//   2. HALF-DOMINANCE — `dominates(framed, len)` (the same test
//      collectRegions, liftAnswer, and confluence's filler gate all use): a
//      span more than half scaffolding no longer discriminates its own content.
//      The per-byte test `dominates(depth[i], aligned)` classifies a byte as
//      frame; the per-run test `dominates(framedCount, runLen)` decides
//      whether the run is usable.
//
// Both are derived from structural quantities (aligned points, run length),
// never tuned.  The constants below are the weave's own shape, not thresholds.
//
// DO NOT replace the frame gates with the structural IDF (reachOf +
// dominates): it was tried and empirically REFUTED (17-intelligence's
// reorder probe).  CAST's frame is WEAVE-LOCAL — "what the aligned
// structures share among THEMSELVES" — while the IDF is corpus-global; a
// phrase common to the aligned exemplars (" describe it", "the importance
// of") is frame here even when it reaches only a corpus minority, and
// treating it as content lets the substitution branch fire on reordered
// single-fact queries.  The two commonality notions coincide often, but
// neither derives the other.
/** The minimum number of aligned structures to form a weave — the same 2 that
 *  gates CAST entry (`points.length < 2`).  Frame requires MORE than this
 *  minimum: `depth > MIN_WEAVE` means at least three structures agree on a
 *  byte, so no byte is frame when only the minimum pair exists. */
const MIN_WEAVE = 2;
/** CAST's own entry gates, checked once here and reused by
/** The main CAST entry point.  Given a query and its pre-computed pre.rec.sites,
 *  determine whether the query weaves together multiple independent learnt
 *  structures (by graded alignment — literal first, then halo-matched pre.rec.sites).
 *  If so, attempt substitution, redirection, AND analogical comparison —
 *  each schema is tried independently and every one that fires yields its
 *  OWN candidate; think's grounding decider (which already compares weights
 *  across mechanisms) picks among them, so CAST no longer needs an internal
 *  priority order.
 *
 *  `climb`, when given, is {@link castFloor}'s own climb result — reused
 *  instead of re-running climbAttentionAll (see the note on {@link
 *  CastFloor}).  Its gates (`query.length`, `edgeSourceCount`,
 *  `ranked.length < 2`) MUST stay in sync with castFloor's — one is the
 *  other's admissible lower bound, checked before this runs.
 *
 *  Returns the array of {@link CastResult}s that fired (possibly empty). */
export async function counterfactualTransfer(ctx, query, pre) {
  const quantum = ctx.space.maxGroup;
  if (query.length < 2 * quantum || ctx.store.edgeSourceCount() === 0) {
    return [];
  }
  const { roots, ranked } = await pre.attention();
  if (ranked.length < 2) {
    return [];
  }
  const weave = await pre.weave();
  const points = weave.points;
  const depth = weave.depth;
  const aligned = points.length;
  if (aligned < 2) {
    return [];
  }
  // ── Frame gate (half-dominance, weave-local) ─────────────────────────
  // A byte is FRAME when more than MIN_WEAVE aligned structures cover it
  // AND those structures are a majority of all aligned structures.
  // Per-byte:  frame(i) ⇔ depth[i] > MIN_WEAVE ∧ dominates(depth[i], aligned)
  // Per-run:   usable(r) ⇔ ¬dominates(framedCount, runLen)
  const isFrame = (i) => depth[i] > MIN_WEAVE && dominates(depth[i], aligned);
  const framedCount = (qs, qe) => {
    let n = 0;
    for (let i = qs; i < qe; i++) {
      if (isFrame(i)) {
        n++;
      }
    }
    return n;
  };
  const usable = (qs, qe) => !dominates(framedCount(qs, qe), qe - qs);
  // The weave's DOMINANT is its principal STRUCTURE — the aligned point
  // explaining the most query bytes — not the climb's top-ranked TOPIC.
  // The two used to coincide (approximate votes from a query's novel spans
  // boosted whichever exemplar shared its frame), but the contrastive
  // margin ranks the query's own exact site first, and CAST's schemas all
  // orient around the frame-bearing structure: the substitution/redirection
  // seat is displaced IN the dominant, and comparison seats the analogs by
  // the contexts that establish their roles.  Coverage is weave-local and
  // derived (sum of aligned run lengths); ties keep the ranked order.
  let dominant = points[0];
  let domCover = -1;
  for (const p of points) {
    let cover = 0;
    for (const r of p.runs) {
      cover += r.qe - r.qs;
    }
    if (cover > domCover) {
      domCover = cover;
      dominant = p;
    }
  }
  const isRoot = (id) => roots.some((r) => r.anchor === id);
  // The weave must touch a COMMITTED point of attention: the dominant
  // structure itself, or another aligned point the climb committed to.
  if (!points.some((p) => isRoot(p.anchor))) {
    return [];
  }
  const woven = points.some((p) =>
    p.runs.some((r) =>
      !pre.rec.sites.some((s) => r.qs >= s.start && r.qe <= s.end)
    )
  );
  if (!woven) {
    return [];
  }
  const t = ctx.trace?.enter("counterfactual", [
    rItem(query, "query"),
  ]);
  // Each schema tried below RECORDS its candidate (when it fires) rather than
  // returning immediately — every schema that succeeds contributes its own
  // candidate, and the grounding decider's own weight comparison (not CAST's
  // former internal priority) picks among them.
  //
  // `accounted` is SCHEMA-SPECIFIC, not the whole weave's alignment: a
  // schema only actually TRANSFERS BETWEEN the two points its own logic
  // names (substitution: the filled subject + the displaced seat;
  // redirection: the displaced seat + the named substitute; comparison:
  // the dominant + its analog) — a THIRD point the weave happened to align
  // but this schema never touched contributes nothing to what THIS answer
  // explains.  Pricing every schema against the SAME "every kept point's
  // every run" span would let the cheapest schema win on move-cost alone
  // regardless of which one actually used more of the query; pricing it
  // against only a fragment of even its OWN two points (e.g. one run
  // instead of the point's full aligned evidence) is just as wrong the
  // other way — it starves an otherwise-correct schema of credit for
  // evidence it legitimately relied on.  Each call site below passes the
  // full run set of exactly the points ITS OWN transfer used — no more,
  // no less.
  const runSpans = (p) => p.runs.map((r) => [r.qs, r.qe]);
  const results = [];
  const record = (answer, note, used, moves, accounted) => {
    if (answer === null) {
      return;
    }
    ctx.trace?.step("castSchema", [rItem(query, "query")], [
      rItem(answer, "answer"),
    ], note);
    results.push({
      bytes: answer,
      used: used ?? new Set(),
      accounted,
      moves,
      unexplained: unexplainedLabel(query, accounted),
    });
  };
  ctx.trace?.step(
    "alignStructures",
    [rItem(query, "query")],
    points.map((p) => rNode(ctx, p.anchor, "structure", p.vote)),
    "the independent learnt structures the query weaves, by graded alignment",
  );
  const lastRun = (p) => p.runs[p.runs.length - 1];
  const qv = pre.guide;
  // ── SUBSTITUTION ──────────────────────────────────────────────────
  const fillerOf = (s) => {
    const r = s.runs[0];
    return r.cs < quantum
      ? s.ctx.subarray(0, r.cs + (r.qe - r.qs))
      : query.subarray(r.qs, r.qe);
  };
  const beforeOf = (p, r) =>
    argmaxBy(
      points.filter((s) =>
        s !== p && lastRun(s).qe <= r.qs &&
        s.runs[0].cs < quantum &&
        usable(s.runs[0].qs, s.runs[0].qe)
      ),
      (s) => lastRun(s).qs,
      -Infinity,
      true,
    )?.item;
  const displacement = points
    .map((p) => {
      const r = p.runs[0];
      if (r.cs < quantum || !usable(r.qs, r.qe)) {
        return null;
      }
      const before = beforeOf(p, r);
      if (before === undefined) {
        return null;
      }
      if (r.cs > fillerOf(before).length + quantum) {
        return null;
      }
      return { p, before, depth: p.ctx.length - r.cs };
    })
    .filter((c) => c !== null);
  const picked = argmaxBy(displacement, (c) => c.depth, -Infinity, true);
  const proj = picked?.item.p ?? null;
  const subj = picked?.item.before ?? null;
  if (proj !== null && subj !== null) {
    const seat = proj.runs[0];
    const filler = fillerOf(subj);
    const tail = proj.ctx.subarray(seat.cs);
    let answer = await joinWithBridge(ctx, filler, tail);
    const fwd = await follow(ctx, proj.anchor, qv);
    if (fwd !== null && indexOf(answer, fwd, 0) < 0) {
      answer = concat2(answer, fwd);
    }
    ctx.trace?.step(
      "projectCounterfactual",
      [
        rItem(filler, "filler", subj.anchor),
        rNode(ctx, proj.anchor, "displaced-structure"),
      ],
      [rItem(answer, "projection")],
      "transfer the displaced structure onto the subject filler (seat substitution)",
    );
    record(
      answer,
      "counterfactual substitution — the subject fills the analog's seat",
      new Set([subj.anchor, proj.anchor]),
      // The acts performed: one seat INSERT projection + one edge FOLLOW.
      STEP + STEP,
      // What substitution actually READ: the two points it transfers
      // between — the subject filling the seat, and the displaced
      // structure whose seat it fills — not every OTHER point the weave
      // happened to align (a third, unrelated point in the same weave
      // contributes nothing to what substitution itself explains).
      [...runSpans(subj), ...runSpans(proj)],
    );
  }
  // ── REDIRECTION ────────────────────────────────────────────────────
  const last = points.reduce((a, b) => lastRun(b).qs > lastRun(a).qs ? b : a);
  // Displacement test, capped at the hub bound: a hub anchor can carry a
  // corpus-sized fan-out, and each continuation costs a full byte
  // reconstruction plus an O(|query|·|bytes|) scan.  The first √N edges (the
  // same insertion-order convention chooseNext caps by) decide; past a hub's
  // cap the test reads "none of the established continuations appears".
  const domNext = ctx.store.nextFirst(dominant.anchor, hubBound(ctx));
  const displaced = domNext
    .every((n) => indexOf(query, read(ctx, n), 0) < 0);
  if (
    last !== dominant &&
    last.runs[0].cs === 0 && displaced &&
    usable(last.runs[0].qs, last.runs[0].qe)
  ) {
    const g = await project(ctx, last.anchor, qv);
    if (g !== null) {
      ctx.trace?.step(
        "projectCounterfactual",
        [
          rNode(ctx, dominant.anchor, "displaced-structure"),
          rNode(ctx, last.anchor, "substitute"),
        ],
        [rItem(g, "projection")],
        "the substitute's own fact replaces the displaced structure's answer",
      );
      record(
        g,
        "counterfactual redirection — the named substitute's fact is followed",
        new Set([dominant.anchor, last.anchor]),
        // One forward projection across the substitute's own fact.
        STEP,
        // What redirection READ: the displaced structure's own recognized
        // seat (still explained — this schema RECOGNIZES it as the slot
        // being overridden, it just doesn't answer from it) plus the named
        // substitute's own aligned run — not every OTHER point the weave
        // happened to align.
        [...runSpans(dominant), ...runSpans(last)],
      );
    }
  }
  // ── COMPARISON ─────────────────────────────────────────────────────
  // Collect every qualifying non-dominant point as a candidate analog.
  // When a point's own anchor is structurally at the wrong level
  // (e.g. a long exemplar sentence whose halo does not resemble the
  // dominant's), its nextOf targets often point to the right level — the
  // person / concept the exemplar is about.  Trying both prevents a
  // seed-dependent failure where the climb ranks an exemplar above a
  // person node and the person node is excluded from points by run-
  // overlap trimming.
  // The seat that establishes a candidate's role: the REVERSE projection
  // (the context it follows), voiced by the query gist — falling back to the
  // candidate's own bytes when it follows nothing.  DELIBERATE STRENGTHENING
  // over the pre-refactor code: reverseContext also returns null when the
  // picked context READS EMPTY (a dangling id degrades to zero bytes), so a
  // corrupted-store read now falls back here instead of voicing a hollow
  // seat into the comparison — the same "empty bytes are no grounding"
  // invariant project() has always enforced.
  const seatOfNode = (id, fallback) => reverseContext(ctx, id, qv) ?? fallback;
  const seatOf = (p) => seatOfNode(p.anchor, p.ctx);
  const analogs = [];
  for (const p of points) {
    if (p === dominant) {
      continue;
    }
    // Push the point's own anchor only when its context fits within
    // the query (the seat sentence must not dominate the comparison).
    if (
      p.ctx.length <= query.length &&
      indexOf(dominant.ctx, p.ctx, 0) < 0 &&
      indexOf(p.ctx, dominant.ctx, 0) < 0 &&
      indexOf(query, p.ctx, 0) < 0
    ) {
      analogs.push({ anchor: p.anchor, point: p });
    }
    // Reach through to the point's continuation targets regardless
    // of the point's own context length: when the point is a leaf
    // (exemplar sentence), its nextOf is the hub (person / concept)
    // that makes a genuine cross-domain analog, and the hub's own
    // (shorter) context will be the seat.
    // Capped like every fan-out: a hub anchor's full continuation list is
    // corpus-sized, and each candidate costs a read plus O(|query|·|bytes|)
    // scans — only the first √N (insertion order, the same convention
    // chooseNext caps by) are reachable as analogs.
    for (const nid of ctx.store.nextFirst(p.anchor, hubBound(ctx))) {
      const nctx = read(ctx, nid);
      if (
        nctx.length > query.length ||
        indexOf(dominant.ctx, nctx, 0) >= 0 ||
        indexOf(nctx, dominant.ctx, 0) >= 0 ||
        indexOf(query, nctx, 0) >= 0
      ) {
        continue;
      }
      analogs.push({ anchor: nid, point: null });
    }
  }
  let bestAnalog = null;
  let bestSim = 0;
  for (const c of analogs) {
    const sim = await analogyStrength(ctx, dominant.anchor, c.anchor);
    ctx.trace?.step(
      "tryAnalog",
      [
        rNode(ctx, dominant.anchor, "dominant"),
        rNode(ctx, c.anchor, "candidate", sim),
      ],
      [],
      `analogy strength ${sim.toFixed(4)}`,
    );
    if (sim > bestSim) {
      bestSim = sim;
      bestAnalog = c;
    }
  }
  // When every candidate fails the similarity gates (halo company — now
  // deterministic signatures, see sema.ts — and the shared-frame tier),
  // fall back to a candidate that is a genuine structural hub (edges in
  // BOTH directions).  A hub node — a person, concept, or category — is
  // the kind of thing that makes sense to compare across domains.  A leaf
  // value (extracted span, terminal answer) has edges in at most one
  // direction and comparing it would preempt the extraction pipeline,
  // which is the right mechanism for those.  A fallback comparison carries
  // NO similarity evidence — it stays honest only because the grounding
  // decider weighs it against mechanisms that explain more of the query
  // (extraction accounts its whole located envelope; see extraction.ts).
  //
  // WHICH hub: not the first in `analogs` order — that order flows from the
  // vote ranking, which flows from approximate resonance, which is seed-
  // dependent.  Pick by evidence instead: combined edge support (prevCount +
  // fan-out), tie-broken by poured halo MASS (episode corroboration — the
  // direct distributional evidence), then by LOWEST node id.  The id order
  // is a property of the corpus, not of the seed — but note ids are SIGNED:
  // byte leaves occupy −256…−1, so "lowest id" is creation order only among
  // multi-byte nodes and byte-value order among leaves.  Either way it is
  // deterministic, which is all the final tie-break must be.
  if (bestAnalog === null && analogs.length > 0) {
    let hubSupport = -1;
    let hubMass = -1;
    const fanClamp = hubBound(ctx) + 1;
    for (const c of analogs) {
      // Evidence clamped at the hub bound: beyond √N + 1 the exact fan-out
      // no longer discriminates (every mega-hub ties at the clamp), and
      // counting it exactly would require the corpus-sized read.
      const fanOut = ctx.store.nextFirst(c.anchor, fanClamp).length;
      if (fanOut === 0) {
        continue;
      }
      const support = ctx.store.prevCount(c.anchor);
      if (support === 0) {
        continue;
      }
      const total = support + fanOut;
      if (total < hubSupport) {
        continue;
      }
      const mass = ctx.store.haloMass(c.anchor);
      if (
        total > hubSupport ||
        mass > hubMass ||
        (mass === hubMass && bestAnalog !== null &&
          c.anchor < bestAnalog.anchor)
      ) {
        hubSupport = total;
        hubMass = mass;
        bestAnalog = c;
      }
    }
    if (bestAnalog !== null) {
      ctx.trace?.step(
        "tryAnalog",
        [],
        [rNode(ctx, bestAnalog.anchor, "fallback", hubSupport)],
        "no candidate passed the similarity gates — using the best-supported structural hub",
      );
    }
  }
  ctx.trace?.step(
    "tryAnalog",
    [],
    bestAnalog !== null ? [rNode(ctx, bestAnalog.anchor, "best", bestSim)] : [],
    bestAnalog !== null
      ? `best analog with strength ${bestSim.toFixed(4)}`
      : `no analog candidate passed (${analogs.length} checked)`,
  );
  // COMPARISON gate — analogical comparison seats the dominant against ONE
  // analog, so it presupposes the query is ABOUT a single thing.  When the
  // consensus climb instead committed to MULTIPLE independent points of
  // attention (`roots.length > 1`), the query names independent topics to
  // FUSE — the reasoner's fuseAttention already combines them — not analogs
  // to compare.  Firing here would juxtapose two co-scaffolded but unrelated
  // records (each sharing only the corpus preamble), out-accounting the
  // honest thin multi-root grounding with a frame echo.  Derived from the
  // climb's own forest, never tuned; substitution/redirection stay
  // unaffected — they orient around a displaced seat, not a whole-topic
  // analogy.
  if (
    bestAnalog !== null &&
    dominant.ctx.length <= query.length &&
    roots.length <= 1
  ) {
    ctx.trace?.step(
      "validateAnalogy",
      [
        rNode(ctx, dominant.anchor, "analog", bestSim),
        rNode(ctx, bestAnalog.anchor, "analog", bestSim),
      ],
      [],
      "the two structures keep distributional company beyond chance — genuine analogs",
    );
    const a = seatOf(dominant);
    const b = bestAnalog.point !== null
      ? seatOf(bestAnalog.point)
      : seatOfNode(bestAnalog.anchor, read(ctx, bestAnalog.anchor));
    const answer = await joinWithBridge(ctx, a, b);
    record(
      answer,
      "analogical comparison — each analog voiced by the context that establishes its role",
      new Set([dominant.anchor, bestAnalog.anchor]),
      // A halo-mediated act (the analogy gate) plus two seat projections.
      CONCEPT + STEP + STEP,
      // What comparison READ: the dominant's own aligned runs, plus the
      // analog's aligned runs when it was itself an aligned point (a nextOf
      // descendant was never aligned to the query directly, so it
      // contributes no accounted span — its seat is graph-reached, not
      // query-matched).
      [
        ...runSpans(dominant),
        ...(bestAnalog.point !== null ? runSpans(bestAnalog.point) : []),
      ],
    );
  }
  t?.done(
    results.map((r) => rItem(r.bytes, "answer")),
    results.length > 0
      ? `${results.length} counterfactual schema(s) fired — the grounding decider weighs them`
      : "no counterfactual weave — the ordinary pipeline decides",
  );
  return results;
}
export const castMechanism = {
  name: "cast",
  provenance: "cast",
  async floor(_ctx, query, pre, worthRunning) {
    const W = _ctx.space.maxGroup;
    // Cheap checks first — no pre-computation needed.
    if (query.length < 2 * W || _ctx.store.edgeSourceCount() === 0) {
      return null;
    }
    // CAST's floor, when it exists, is ALWAYS exactly 2*STEP — the climb and
    // the weave only decide whether it exists (2*STEP) or not (null), they
    // never tighten the number itself.  So if 2*STEP already can't beat
    // whatever incumbent has already won this response (cover runs first —
    // see defaultMechanisms), no analysis can change the outcome: RETURN THE
    // BOUND uninvested (still admissible) and let the pipeline's own check
    // prune run() with the truthful "cannot beat incumbent" note.  This is
    // the SAME admissible-floor economy worthRunning applies to run(),
    // applied to floor()'s own investment — uniformly, whatever mechanism
    // supplied the incumbent (an extension's computed result is not
    // special-cased; any sufficiently cheap incumbent prunes the same way).
    if (!worthRunning(2 * STEP)) {
      return 2 * STEP;
    }
    // Now first-touch the shared analyses (climb, then the weave built on
    // it).  If another mechanism already triggered either, this awaits the
    // cached result; otherwise it's computed once here and reused in run().
    if ((await pre.attention()).ranked.length < 2) {
      return null;
    }
    if ((await pre.weave()).points.length < 2) {
      return null;
    }
    return 2 * STEP;
  },
  async run(ctx, query, pre) {
    const casts = await counterfactualTransfer(ctx, query, pre);
    return casts.map((c) => ({
      bytes: c.bytes,
      accounted: c.accounted,
      moves: c.moves,
      used: c.used,
      unexplained: c.unexplained,
    }));
  },
};
