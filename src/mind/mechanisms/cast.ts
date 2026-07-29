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

import type { MindContext } from "../types.js";
import type { Vec } from "../../vec.js";
import { read } from "../primitives.js";
import { argmaxBy, corpusN, hubBound } from "../traverse.js";
import {
  analogyStrength,
  follow,
  type GradedRun,
  project,
  reverseContext,
  sharedFrameStrengthOf,
} from "../match.js";
import { joinWithBridge } from "../resonance.js";
import { restatesQuery } from "../reasoning.js";
import { CONCEPT, STEP } from "../graph-search.js";
import { concat2, indexOf } from "../../bytes.js";
import { consensusFloor, dominates } from "../../geometry.js";
import {
  decodeText,
  unexplainedLabel,
  unexplainedSpans,
} from "../rationale.js";
import { rItem, rNode } from "../trace.js";
import { dismissedKnownContent } from "../bridge.js";

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

// ── Counterfactual Transfer ───────────────────────────────────────────────

/** A CAST answer plus its elementary evidence for think's grounding decider:
 *  `accounted` — the query spans the weave's aligned runs explain; `moves` —
 *  the ladder cost of the acts the taken branch performed (STEP per
 *  projection, CONCEPT for the halo-mediated analogy gate). */
export interface CastResult {
  bytes: Uint8Array;
  used: ReadonlySet<number>;
  accounted: Array<[number, number]>;
  moves: number;
  /** A human-readable label for the query bytes this schema left
   *  unexplained — purely diagnostic, never priced (see the module's
   *  Task 2 note in pipeline.ts's Candidate interface). */
  unexplained: string;
}

/** The seat that establishes a node's role in an analogical comparison:
 *  the REVERSE context (what leads to it) when a predecessor genuinely
 *  ESTABLISHES id — introduces or describes it by name — else the FORWARD
 *  continuation (what it leads to), else `fallback`.
 *
 *  An earlier version gated this purely on `prevCount(id) > 0`: any
 *  predecessor at all was treated as proof of a genuine named ENTITY
 *  (seat it by what established it), while no predecessor meant a bare
 *  learnt CONTEXT (seat it by what it leads to, since voicing it verbatim
 *  would answer a question with a question).  That test measured the wrong
 *  thing — a broad sample of this store's own question-shaped nodes showed
 *  the large majority (≈71%) have at least one predecessor, most of them a
 *  handful of generic, high-fan-out sentences that recur as an INCIDENTAL
 *  neighbour to dozens of otherwise-unrelated destinations (a SmolSent-
 *  style sentence-adjacency artifact, never naming or describing what
 *  follows).  Traced live: "What is the capital of France?" — whose own
 *  forward edge unambiguously resolves to "The capital of France is
 *  Paris." — has exactly one such incidental predecessor ("Create an
 *  example of a types of questions a GPT model can answer.?"), wrongly
 *  read as disqualifying proof of "genuine entity."
 *
 *  A plain forward-first swap (matching {@link project}'s universal
 *  priority) over-corrected: test/29's C2/C3 pin that a genuine entity
 *  analog (e.g. "Leonardo da Vinci", established by "The Mona Lisa was
 *  painted by Leonardo da Vinci.") must be seated by that establishing
 *  sentence, NOT by its own biography fact — voicing the bio leaks exactly
 *  what a comparison must keep out, and loses the embedded "Mona Lisa"
 *  term C3 relies on for a further hop.
 *
 *  The distinguishing signal is content-addressed, not a count: a genuine
 *  establishing predecessor's bytes CONTAIN id's own bytes — it names or
 *  describes id ("...painted by Leonardo da Vinci." contains "Leonardo da
 *  Vinci").  An incidental adjacency predecessor never does — it merely
 *  preceded id in some unrelated document without ever mentioning it.  No
 *  new tuned constant: containment is the same primitive `restatesQuery`
 *  and `dominates`-style checks already use throughout this codebase.
 *
 *  `allowForward` (default true) gates the FORWARD branch specifically —
 *  see the call sites below: the DOMINANT is what the query is actually
 *  ASKING, so completing it forward is the whole point; an ANALOG is only
 *  being CITED for comparison; the query never asked about IT, so chasing
 *  its own further continuation drifts onto whatever coincidentally
 *  follows it in the corpus.  Traced live: the analog "What is the capital
 *  of Japan?\nTokyo is the capital of Japan." is ALREADY a complete,
 *  self-answering unit (prevCount 0, so no establishing predecessor
 *  either) — its sole forward edge is "And what is the capital of the
 *  Moon?", an unrelated quiz question sharing nothing but corpus
 *  adjacency.  With forward disallowed, an analog like this falls through
 *  to `fallback` — its own bytes, exactly the complete fact that made it a
 *  genuine analog in the first place.  See
 *  test/41-seatofnode-direction.test.mjs and
 *  test/43-cast-analog-seat.test.mjs. */
export async function seatOfNode(
  ctx: MindContext,
  id: number,
  guide: Vec | null | undefined,
  fallback: Uint8Array,
  allowForward = true,
): Promise<Uint8Array> {
  const rev = ctx.store.prevFirst(id, hubBound(ctx));
  if (rev.length > 0) {
    const own = read(ctx, id);
    const establishing = rev.some((p) => indexOf(read(ctx, p), own, 0) >= 0);
    if (establishing) {
      const back = reverseContext(ctx, id, guide, rev);
      if (back !== null) return back;
    }
  }
  // The "last resort, non-establishing reverse" fallback below is itself a
  // LESS CERTAIN projection (the same tier as forward) — an analog
  // (allowForward: false) must stop at `fallback` (its own bytes) here
  // rather than fall back to a predecessor that already failed the
  // establishing check just above.
  if (!allowForward) return fallback;
  const fwd = await follow(ctx, id, guide);
  if (fwd !== null) return fwd;
  return reverseContext(ctx, id, guide, rev) ?? fallback;
}

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
export async function counterfactualTransfer(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
): Promise<CastResult[]> {
  // Opened unconditionally, at entry — the same convention recall.ts's
  // recallByResonance and extraction.ts's extractBySkill use, so every exit
  // path (five gates below, then the schemas themselves) closes through
  // ONE scope and inspectRationale never hits a silent dead end.  Only the
  // first two gates duplicate floor()'s own admissible bound (query length,
  // ranked anchor count) — required to stay in sync per this function's own
  // doc comment above, and effectively dead through the ordinary pipeline
  // (floor() returning null already stops run() from being called at all),
  // but this function is also exported and callable directly, so they stay
  // and get the same honest trace as everything past them.
  const t = ctx.trace?.enter("counterfactual", [rItem(query, "query")]);
  const fail = (note: string): CastResult[] => {
    t?.done([], note);
    return [];
  };

  const quantum = ctx.space.maxGroup;
  if (query.length < 2 * quantum || ctx.store.edgeSourceCount() === 0) {
    return fail("query below the two-quantum floor, or no edges learnt yet");
  }
  const { roots, ranked } = await pre.attention();
  if (ranked.length < 2) {
    return fail(
      `only ${ranked.length} ranked anchor(s) — CAST needs at least two`,
    );
  }

  const weave = await pre.weave();
  const points = weave.points;
  const depth = weave.depth;
  // CAST'S OWN SINGLE-VS-MULTI TEST, MEASURED FROM THE QUERY.
  //
  // `points.length >= 2` reads as "two structures to transfer between", but
  // measured, it functions as "the query is about more than one thing" — and
  // it only discriminates because the weave's exclusivity eliminates hard
  // enough that a single-topic query cannot reach two points.  The condition
  // is carried by the elimination, not by anything CAST measures.  Traced on
  // test/24 3.1 ("the importance of gender equality in the workplace"): the
  // climb is byte-identical either way (16 of 31 sub-regions, one context),
  // and relaxing the weave alone makes CAST fire and answer about the 1992
  // Dream Team.
  //
  // What actually separates 3.1 from a genuine comparison (test/29 C2, "How is
  // Shakespeare like Leonardo da Vinci?") is CONTENT: C2's two points are
  // evidenced by DIFFERENT query spans, while 3.1's extra points align to the
  // same shared frame the first one already explains.  So require two points
  // that explain genuinely different parts of the query — a second point must
  // contribute at least one perception quantum of query bytes the
  // best-covered point does not.  Derived from the runs themselves, order-free,
  // and independent of how many points survived.
  const coveredBy = (p: typeof points[0]): Set<number> => {
    const set = new Set<number>();
    for (const r of p.runs) for (let i = r.qs; i < r.qe; i++) set.add(i);
    return set;
  };
  let widest = points[0];
  let widestN = -1;
  for (const p of points) {
    const n = coveredBy(p).size;
    if (n > widestN) {
      widestN = n;
      widest = p;
    }
  }
  const widestSet = widest === undefined
    ? new Set<number>()
    : coveredBy(widest);
  let distinct = points.length === 0 ? 0 : 1;
  for (const p of points) {
    if (p === widest) continue;
    let own = 0;
    for (const i of coveredBy(p)) if (!widestSet.has(i)) own++;
    if (own >= quantum) {
      distinct = 2;
      break;
    }
  }
  // THE CLIMB ANSWERS THE SAME QUESTION, AND IT ANSWERS IT ORDER-FREE.  Runs
  // are literal W-gram agreement, so two structures the query names in its own
  // words can share no run at all: on `How is ice like steel?` the query's
  // `ice` and the stored `Ice is cold` agree on nothing but the ` is `
  // scaffolding `Steel is hard` also matches, and the run test above reads one
  // topic.  The climb had already read two — it elected `Ice is cold` from
  // q4-9 and `Steel is hard` from q16-20, two disjoint places — and DISPERSION
  // (Attention.clusters) is exactly that reading: not how much evidence, but
  // how many separate places in the query corroborate it.  Measured against
  // the case this gate exists to refuse, test/24 3.1: a genuinely single-topic
  // query reads clusters 1, while C1's single committed root reads 2.
  //
  // Either source is sufficient — bytes the other point does not explain, or
  // places the climb found the query's evidence in — and neither is a count of
  // weave survivors.
  // Dispersion alone is a property of the QUERY, not of the pair being woven,
  // so it is read together with the pair's own elected spans: two points count
  // as two topics when the climb found the query dispersed AND it elected them
  // from places at least a quantum apart.  (Dispersion alone was measured and
  // is too weak — it let CAST into test/33's near-tie and test/24's list
  // skill, whose points the climb elects from the same place.)
  const dispersed = roots.length >= MIN_WEAVE ||
    roots.some((r) => r.clusters >= MIN_WEAVE);
  const apart = points.some((a) =>
    points.some((b) =>
      a !== b &&
      (b.start - a.end >= quantum || a.start - b.end >= quantum)
    )
  );
  // …and only where there is something left to transfer.  When ONE point
  // already explains the query down to the last quantum there is no analogy to
  // draw — the query is that structure, restated or truncated — and the
  // dispersion the climb reports is the SAME topic corroborated twice, not two
  // topics.  Measured on test/33's `steel is hard so steel is`, a prefix of one
  // stored fact: its root disperses into 2 clusters purely because the fact
  // repeats `steel is`, while that one point's runs cover all 25 query bytes.
  const unexplained = query.length - widestN;
  const aligned =
    distinct >= 2 || (dispersed && apart && unexplained >= quantum)
      ? points.length
      : 1;
  if (aligned < 2) {
    return fail(
      `only ${aligned} structure(s) aligned across the query — CAST needs ` +
        `at least two to transfer between`,
    );
  }

  type Point = typeof points[0];

  // ── Frame gate (half-dominance, weave-local) ─────────────────────────
  // A byte is FRAME when more than MIN_WEAVE aligned structures cover it
  // AND those structures are a majority of all aligned structures.
  // Per-byte:  frame(i) ⇔ depth[i] > MIN_WEAVE ∧ dominates(depth[i], aligned)
  // Per-run:   usable(r) ⇔ ¬dominates(framedCount, runLen)
  const isFrame = (i: number): boolean =>
    depth[i] > MIN_WEAVE && dominates(depth[i], aligned);
  const framedCount = (qs: number, qe: number): number => {
    let n = 0;
    for (let i = qs; i < qe; i++) if (isFrame(i)) n++;
    return n;
  };
  const usable = (qs: number, qe: number): boolean =>
    !dominates(framedCount(qs, qe), qe - qs);

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
    for (const r of p.runs) cover += r.qe - r.qs;
    if (cover > domCover) {
      domCover = cover;
      dominant = p;
    }
  }
  const isRoot = (id: number) => roots.some((r) => r.anchor === id);
  // The weave must touch a COMMITTED point of attention: the dominant
  // structure itself, or another aligned point the climb committed to.
  if (!points.some((p) => isRoot(p.anchor))) {
    t?.done(
      [
        ...points.map((p) => rNode(ctx, p.anchor, "aligned")),
        ...roots.map((r) => rNode(ctx, r.anchor, "committed-root")),
      ],
      `${points.length} aligned structure(s), but none is one of the climb's ` +
        `${roots.length} committed root(s) — CAST refuses to transfer through ` +
        `content the climb itself never settled on`,
      {
        aligned: points.map((p) => ({
          anchor: p.anchor,
          vote: p.vote,
          runs: p.runs.map((r) => ({ ...r })),
          coveredBytes: p.runs.reduce((n, r) => n + r.qe - r.qs, 0),
        })),
        committedRoots: roots.map((r) => ({
          anchor: r.anchor,
          vote: r.vote,
        })),
      },
    );
    return [];
  }

  // WOVEN — is anything actually brought TOGETHER?  A run restating a site
  // the query already contains is not, by itself, evidence of that; but TWO
  // points restating DIFFERENT sites is exactly a comparison ("How is
  // Michelangelo like Homer?" names both entities, recognition finds both,
  // and the weave aligns each to its own stored structure).  The escape
  // clause alone called that unwoven — a reading that held only while
  // recognition UNDER-reported sites, and test/29 A2 started failing the
  // moment recognition's interior chains stopped dying mid-form.
  //
  // Both points must be evidenced in what the asker JUST SAID.  A multi-turn
  // query is the whole transcript, so the earlier turns' own questions are
  // aligned points too — traced on test/48, the weave for `And what is the
  // capital of Spain?` holds `What is the capital of France?` (runs q0-61,
  // entirely inside the previous turn and its answer) beside the new question
  // (q65-94).  Two points, two named sites, and nothing woven at all: one of
  // them is conversation history.  The current turn is the bytes past the last
  // answered span — the same `askerBytes` notion computeWeave prices its read
  // budget with — so requiring both points to have evidence THERE separates a
  // genuine two-place weave from a follow-up.  Single-turn queries have no
  // answered spans, so the current turn is the whole query and nothing changes.
  const turnStart = ctx.answeredSpans.reduce((n, [, e]) => Math.max(n, e), 0);
  const inTurn = points.filter((p) => p.runs.some((r) => r.qe > turnStart));
  const siteAt = (r: GradedRun): number =>
    pre.rec.sites.findIndex((s) => r.qs >= s.start && r.qe <= s.end);
  const namedSites = new Set<number>();
  for (const p of inTurn) {
    for (const r of p.runs) {
      const i = siteAt(r);
      if (i >= 0) namedSites.add(i);
    }
  }
  const woven = points.some((p) => p.runs.some((r) => siteAt(r) < 0)) ||
    (inTurn.length >= MIN_WEAVE && namedSites.size >= MIN_WEAVE);
  if (!woven) {
    return fail(
      `every aligned run restates a recognised query site — nothing was ` +
        `actually WOVEN across structures, so there is nothing to transfer`,
    );
  }

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
  const runSpans = (p: Point): Array<[number, number]> =>
    p.runs.map((r) => [r.qs, r.qe] as [number, number]);
  const results: CastResult[] = [];
  const record = (
    answer: Uint8Array | null,
    note: string,
    used: ReadonlySet<number> | undefined,
    moves: number,
    accounted: Array<[number, number]>,
  ): void => {
    if (answer === null) return;
    ctx.trace?.step(
      "castSchema",
      [rItem(query, "query")],
      [rItem(answer, "answer")],
      note,
    );
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
  const lastRun = (p: Point) => p.runs[p.runs.length - 1];
  const qv = pre.guide;

  // ── SUBSTITUTION ──────────────────────────────────────────────────
  const fillerOf = (s: Point, r: GradedRun = s.runs[0]): Uint8Array =>
    r.cs < quantum
      ? s.ctx.subarray(0, r.cs + (r.qe - r.qs))
      : query.subarray(r.qs, r.qe);
  // THE FILLER IS WHAT THE SUBJECT CONTRIBUTES BEFORE THE SEAT — CLIPPED HERE,
  // NOT ARBITRATED BY RANK.  A subject whose alignment runs INTO the seat span
  // agrees with the displaced structure there; those shared bytes are frame,
  // and only the part before the seat is the subject's own contribution.
  // Reading `runs[0]` whole made this schema depend on the weave having
  // already cut that overlap away for it: on `steel is frigid` the weave's
  // exclusivity handed `steel is hard so steel is strong` the run q0-5
  // (`steel`) only because the seat's point ranked higher and took q5-15
  // first.  Read without that cut the same run is q0-9 (`steel is `), it ends
  // PAST the seat at q5, and substitution found no subject at all — a schema
  // silently reading a global elimination order as if it were local evidence.
  // Clipping at the seat derives the same span from the two points actually
  // involved, so the reading no longer moves when the weave's order does.
  const fillerRun = (s: Point, at: number): GradedRun | null => {
    const r0 = s.runs[0];
    if (r0.qs >= at) return null;
    const qe = Math.min(r0.qe, at);
    return qe - r0.qs >= Math.min(quantum, s.ctx.length)
      ? (qe === r0.qe ? r0 : { ...r0, qe })
      : null;
  };
  // The subject is the closest structure whose FILLER RUN precedes the seat.
  // The gate is on `runs[0]` — the run `fillerOf` actually reads — not on the
  // point's LAST run: requiring the subject's whole alignment to end before
  // the seat disqualifies any structure the query mentions on BOTH sides of
  // it, which is the shape CAST exists for.  Measured on
  // `steel is frigid so steel is ???` against `steel is hard so steel is
  // strong` (runs "steel is " at 0-9 and "d so steel is " at 14-28) and
  // `water is frigid so water is freezing` (seat "frigi" at 9-14): the
  // subject's filler run sits squarely before the seat, but its second run —
  // the recurrence AFTER it, the very thing that makes the sentence an
  // analogy — pushed lastRun past the seat and no substitution fired at all.
  // The ordering key follows the gate to the same run, so "closest preceding"
  // still means closest by the evidence actually used.
  const beforeOf = (
    p: Point,
    r: GradedRun,
  ): { point: Point; run: GradedRun } | undefined =>
    argmaxBy(
      points.flatMap((s) => {
        if (s === p) return [];
        const f = fillerRun(s, r.qs);
        return f !== null && f.cs < quantum && usable(f.qs, f.qe)
          ? [{ point: s, run: f }]
          : [];
      }),
      (s) => s.run.qs,
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
      if (before === undefined) return null;
      if (r.cs > fillerOf(before.point, before.run).length + quantum) {
        return null;
      }
      // SUBSTITUTION MUST ACTUALLY DISPLACE.  The schema's premise is that the
      // displaced structure's seat is held by something ELSE, which the
      // subject then replaces.  When the subject's filler already occurs in
      // that structure, there is nothing to displace — the "transfer" restates
      // the structure with its own occupant put back, and the answer is a
      // tautology.  Measured on `Michelangelo is to sculpture as who is to
      // literature?`: the weave aligned the concept `Michelangelo` and the
      // exemplar `The David was sculpted by Michelangelo.`, and substitution
      // produced `Michelangelo sculpted by Michelangelo.` — then outbid every
      // honest candidate with it (test/29 A2).  Byte containment, the same
      // primitive the self-evidence and contradiction guards use.
      if (indexOf(p.ctx, fillerOf(before.point, before.run), 0) >= 0) {
        return null;
      }
      return { p, before, depth: p.ctx.length - r.cs };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const picked = argmaxBy(displacement, (c) => c.depth, -Infinity, true);
  const proj = picked?.item.p ?? null;
  const subj = picked?.item.before ?? null;
  if (proj !== null && subj !== null) {
    const seat = proj.runs[0];
    const filler = fillerOf(subj.point, subj.run);
    const tail = proj.ctx.subarray(seat.cs);
    let answer = await joinWithBridge(ctx, filler, tail);
    const fwd = await follow(ctx, proj.anchor, qv);
    if (
      fwd !== null && indexOf(answer, fwd, 0) < 0 &&
      !restatesQuery(query, fwd)
    ) {
      answer = concat2(answer, fwd);
    }
    ctx.trace?.step(
      "projectCounterfactual",
      [
        rItem(filler, "filler", subj.point.anchor),
        rNode(ctx, proj.anchor, "displaced-structure"),
      ],
      [rItem(answer, "projection")],
      "transfer the displaced structure onto the subject filler (seat substitution)",
    );
    record(
      answer,
      "counterfactual substitution — the subject fills the analog's seat",
      new Set([subj.point.anchor, proj.anchor]),
      // The acts performed: one seat INSERT projection + one edge FOLLOW.
      STEP + STEP,
      // What substitution actually READ: the two points it transfers
      // between — the subject filling the seat, and the displaced
      // structure whose seat it fills — not every OTHER point the weave
      // happened to align (a third, unrelated point in the same weave
      // contributes nothing to what substitution itself explains).
      [...runSpans(subj.point), ...runSpans(proj)],
    );
  }

  // ── REDIRECTION ────────────────────────────────────────────────────
  // REDIRECTION IS ABOUT THE SUBSTITUTE THE QUERY NAMES, SO IT LOOKS FOR THE
  // RUN THAT NAMES ONE.  A structure is named when the query quotes it from
  // its own opening bytes (`cs === 0`) — `…were Lyon?` against `Lyon is a city
  // in France`.  Reading that off `runs[0]` assumed the weave had already
  // eliminated everything the point shares with the dominant, which is the
  // elimination deciding the schema again: relaxed, the same point also aligns
  // the query's trailing ` France` (cs 17, frame it shares with `what is the
  // capital of France?`), that run sorts FIRST, and redirection stopped seeing
  // a named substitute at all.  Scanning the point's runs for the naming one
  // is the same reading, taken from the runs rather than from their order, and
  // "latest named" then means latest by the run actually relied on.
  const named = points.flatMap((p) => {
    const r = p.runs.find((r) => r.cs === 0 && usable(r.qs, r.qe));
    return r !== undefined ? [{ point: p, run: r }] : [];
  });
  // …and it must be named AFTER what it displaces.  Redirection replaces the
  // ANSWER, so the substitute is the newest thing the query says — `…of France
  // were Lyon?` names Lyon past everything the displaced structure aligned.
  // The old `latest last run` reduce encoded this implicitly and only held
  // while trimming kept the dominant's runs latest; stated on the naming run
  // it is the same reading without that dependency.  Measured on test/29 D1
  // (`steel is frigid`), where the point with a naming run is the SUBJECT at
  // q0-9, ahead of the dominant's q5-15: redirection must not fire, and
  // substitution — which is what that shape is — keeps the case.
  const last = argmaxBy(
    named.filter((n) => n.run.qs > lastRun(dominant).qs),
    (n) => n.run.qs,
    -Infinity,
    true,
  )?.item;
  // Displacement test, capped at the hub bound: a hub anchor can carry a
  // corpus-sized fan-out, and each continuation costs a full byte
  // reconstruction plus an O(|query|·|bytes|) scan.  The first √N edges (the
  // same insertion-order convention chooseNext caps by) decide; past a hub's
  // cap the test reads "none of the established continuations appears".
  const domNext = ctx.store.nextFirst(dominant.anchor, hubBound(ctx));
  const displaced = domNext
    .every((n) => indexOf(query, read(ctx, n), 0) < 0);
  if (last !== undefined && last.point !== dominant && displaced) {
    const g = await project(ctx, last.point.anchor, qv);
    if (g !== null) {
      ctx.trace?.step(
        "projectCounterfactual",
        [
          rNode(ctx, dominant.anchor, "displaced-structure"),
          rNode(ctx, last.point.anchor, "substitute"),
        ],
        [rItem(g, "projection")],
        "the substitute's own fact replaces the displaced structure's answer",
      );
      record(
        g,
        "counterfactual redirection — the named substitute's fact is followed",
        new Set([dominant.anchor, last.point.anchor]),
        // One forward projection across the substitute's own fact.
        STEP,
        // What redirection READ: the displaced structure's own recognized
        // seat (still explained — this schema RECOGNIZES it as the slot
        // being overridden, it just doesn't answer from it) plus the named
        // substitute's own aligned run — not every OTHER point the weave
        // happened to align.
        [...runSpans(dominant), ...runSpans(last.point)],
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
  // The seat that establishes a candidate's role — see {@link seatOfNode}.
  const seatOf = (p: Point, allowForward = true): Promise<Uint8Array> =>
    seatOfNode(ctx, p.anchor, qv, p.ctx, allowForward);
  interface AnalogCandidate {
    anchor: number;
    /** The point this candidate came from, or null when it is a nextOf
     *  descendant — then its own bytes ARE the seat (already one meaningful
     *  hop from `src`; see the comparison gate below). */
    point: Point | null;
    /** For a nextOf descendant: the aligned point whose continuation edge
     *  named it.  Its runs ARE the query evidence this analog rests on
     *  (the hop was reached THROUGH that alignment), so the comparison
     *  schema accounts them. */
    src: Point;
  }
  // QUERY-SCALE — "this learnt context is the same size as the question", the
  // bound comparison holds its dominant and its analogs to.  A byte-exact
  // `<= query.length` made that judgement turn on a difference the
  // architecture cannot perceive: on `The Weeping Woman was painted by Pablo
  // Picasso.` (47 bytes) the weave's dominant was `The Night Watch was painted
  // by Rembrandt van Rijn.` (50) — three bytes over, so comparison refused
  // outright, while the interchangeable `The Mona Lisa was painted by Leonardo
  // da Vinci.` (47) would have passed.  WHICH exemplar becomes dominant is
  // settled by run-claiming order among equals, so a 3-byte difference was
  // deciding whether the schema fires at all (test/33 1b).  W is the smallest
  // distinction perception can make — the same quantum countClusters separates
  // neighbourhoods by — so a context within one quantum of the query's length
  // carries no independently perceivable unit beyond it and is the same scale.
  //
  // ONE QUANTUM OF EXCESS IS AN ABSOLUTE UNIT, AND SCALE IS NOT ABSOLUTE.
  // `n - query.length < quantum` calls a 504-byte context the same scale as a
  // 500-byte query while refusing a 47-byte context on a 42-byte one — the
  // same 5 bytes, opposite verdicts, because the bar never looks at what it is
  // measuring against.  Measured on test/29 C3, whose query is C2's verbatim:
  // the climb elects the exemplar SENTENCE (47) rather than the entity, five
  // bytes past a 42-byte query, and comparison refused a pair it accepts at
  // C2's grain.  Read the excess against the query with `dominates` — the same
  // half-dominance predicate this file uses for frame, and the one scale-free
  // reading of "the seat sentence must not dominate the comparison" available
  // without inventing a ratio.
  const queryScale = (n: number): boolean =>
    !dominates(n - query.length, query.length);
  const analogs: AnalogCandidate[] = [];
  for (const p of points) {
    if (p === dominant) continue;
    // Push the point's own anchor only when its context fits within
    // the query (the seat sentence must not dominate the comparison).
    if (
      queryScale(p.ctx.length) &&
      indexOf(dominant.ctx, p.ctx, 0) < 0 &&
      indexOf(p.ctx, dominant.ctx, 0) < 0 &&
      indexOf(query, p.ctx, 0) < 0
    ) {
      analogs.push({ anchor: p.anchor, point: p, src: p });
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
        !queryScale(nctx.length) ||
        indexOf(dominant.ctx, nctx, 0) >= 0 ||
        indexOf(nctx, dominant.ctx, 0) >= 0 ||
        indexOf(query, nctx, 0) >= 0
      ) continue;
      analogs.push({ anchor: nid, point: null, src: p });
    }
  }
  // MEASURED AND REFUTED — proposing analogs from the dominant's halo when the
  // query-local generator finds none.  Both loops above are query-local (an
  // aligned point, or one forward hop off one), while the gate that judges
  // candidates — analogyStrength's halo tier — is cross-domain by construction
  // and is licence enough on its own (`bestHalo` exempts it from the naming and
  // trusted-root bars).  So the gate reads as strictly more capable than the
  // generator, and closing that asymmetry looks like the fix for test/29 A2
  // (`Michelangelo is to sculpture as who is to literature?`, whose only stored
  // content is `Michelangelo`: the weave aligns the concept and its own
  // exemplar, each contains the other, so every candidate is excluded and
  // comparison checks zero).
  //
  // It proposes nothing.  Measured on A2's own 13-pair corpus: `Michelangelo`
  // HAS a halo, and `haloSiblings` returns not one sibling above
  // significanceBar — the distributional company that would make Shakespeare a
  // cross-domain analog was never trained.  The asymmetry is real but it is not
  // what stops A2; the corpus is.
  let bestAnalog: AnalogCandidate | null = null;
  let bestSim = 0;
  let bestHalo = false;
  // Whether the query itself NAMES a candidate.  A directly aligned point
  // is named by construction — its runs ARE query bytes.  A hop-reached
  // candidate is named when its own bytes contain the query text of an
  // aligned run of the point whose continuation edge reached it (that
  // alignment IS the query evidence the hop rests on — the same reading
  // cmpAccounted already prices): "William Shakespeare", reached off
  // "Macbeth was written by William Shakespeare.", contains the src's
  // 12-byte aligned run " Shakespeare" — test/29 C2/C3.  The run must span
  // at least TWO perception windows (2·W, the same two-quantum floor
  // CAST's own entry gate holds the whole query to): a single shared
  // W-window is exactly the frame tier's own evidence quantum — the level
  // "half the corpus" shares — and stopword scraps (" the ", "he b",
  // 4–5 bytes) never reach two windows, while a genuinely named entity
  // does.  NOT the weave's usable()/frame filter: weave depth counts every
  // ranked exemplar, so a query's own named entity recurring across
  // exemplars ("Shakespeare" in Hamlet+Macbeth+…) is wrongly classified as
  // frame — measured live, it silently disqualified C3's genuine analog.
  const namedByQuery = (c: AnalogCandidate): boolean => {
    if (c.point !== null) return true;
    const bytes = read(ctx, c.anchor);
    return c.src.runs.some((r) =>
      r.qe - r.qs >= 2 * quantum &&
      indexOf(bytes, query.subarray(r.qs, r.qe), 0) >= 0
    );
  };
  // Whether any committed root's consensus vote clears the SAME trust bar
  // recallByResonance applies before grounding through a climb root:
  // consensusFloor(N) = ln(N) + 1/2.  The climb's FIRST root is
  // deliberately floor-free (attention.ts: "the dominant one always
  // grounds") — fine for ORIENTING mechanisms, not for voicing learnt
  // content the query never asked about.  Computed once here; both the
  // hub fallback below and the comparison gate consume it.
  const rootTrusted = roots.some((r) => r.vote >= consensusFloor(corpusN(ctx)));
  // The context that ESTABLISHES a filler — the same reverse context, under
  // the same naming test, `seatOfNode` uses to VOICE an analog (a predecessor
  // whose bytes CONTAIN the node's: it names or describes it, rather than
  // merely having preceded it somewhere).  Memoised: the analogy loop below
  // asks about the same dominant every time, and only ever asks at all when
  // the cheap tiers already read zero.
  // A NODE NOTHING ESTABLISHES IS ITS OWN ESTABLISHING CONTEXT — the same
  // reading `seatOfNode` takes one gate up: a bare filler was learnt as some
  // context's answer and has a predecessor that NAMES it, so no establishing
  // predecessor means the node already IS a learnt context.  Returning null
  // there made the tier depend on both sides being elected at the same GRAIN:
  // test/29 C2's climb elects the entity `Leonardo da Vinci` (established by
  // `The Mona Lisa was painted by…`) and reads 0.371, while C3's identical
  // query elects that sentence ITSELF for the same side, whose own
  // predecessor establishes nothing — the tier read 0.000 and comparison
  // never fired, on a pair that is strictly MORE explicit about its frame.
  const estMemo = new Map<number, Uint8Array>();
  const establishing = (id: number): Uint8Array => {
    const hit = estMemo.get(id);
    if (hit !== undefined) return hit;
    const own = read(ctx, id);
    const rev = reverseContext(ctx, id, pre.guide);
    const out = rev !== null && indexOf(rev, own, 0) >= 0 ? rev : own;
    estMemo.set(id, out);
    return out;
  };
  // COMPARISON VOICES WHAT IT COMPARED.  When the frame tier decided the
  // analogy, the two establishing contexts it read ARE the roles being
  // compared, so the schema below voices those same bytes instead of
  // re-deriving a seat that can land somewhere else entirely.  Measured on
  // test/29 C3: the dominant is the exemplar sentence `The Mona Lisa was
  // painted by Leonardo da Vinci.`, nothing establishes it, so `seatOf`
  // took its FORWARD continuation and voiced `Leonardo was a Renaissance
  // polymath` — the analog's own biography, exactly what C2 pins comparison
  // must never leak, from the branch whose own doc says forward completion
  // is right for a DOMINANT (true when the dominant is a bare name whose
  // continuation establishes it; false when it already IS the establishing
  // context).  Only frame-tier pairs are affected: a halo-tier analogy was
  // never measured on these bytes and keeps the seat it always had.
  const frameSeats = new Map<AnalogCandidate, [Uint8Array, Uint8Array]>();
  for (const c of analogs) {
    const ev = await analogyStrength(ctx, dominant.anchor, c.anchor);
    let sim = ev.score;
    const halo = ev.halo;
    // ROLE IS ESTABLISHED BY CONTEXT, NOT BY A NAME.  When neither halo tier
    // fired and the two anchors' own bytes share no learnt frame either, the
    // anchors are FILLERS — bare entity names — not the frame-bearing
    // structures the tier is about.  Read the tier on what establishes each
    // one instead: the aligned point's own context (or, for a hop-reached
    // candidate, the point whose continuation edge reached it — the same
    // context `cmpAccounted` already prices as that hop's query evidence).
    // Both are ALREADY IN HAND, so this costs no extra read.
    //
    // Measured on test/29's corpus: "Michelangelo" vs "Homer" reads 0.000
    // while "The David was sculpted by Michelangelo." vs "The Iliad was
    // written by Homer." reads 0.452 — and a context in a different frame
    // ("Water boils at one hundred degrees.") still reads 0.000.  The tier
    // was never failing to discriminate; it was reading the fillers.
    //
    // Still the FRAME tier (`halo` stays false), so this evidence remains
    // subject to the naming / trusted-root bar the comparison gate holds all
    // frame evidence to — a wider READING of the same tier, not a new licence.
    // Containment is excluded for the same reason the generator excludes it:
    // a context that contains the other establishes nothing independent.
    if (!halo && sim === 0) {
      // For a hop-reached candidate the thing whose ROLE is in question is
      // the point the query named, not the fact one edge past it: "Homer"
      // was named and "The Iliad was written by Homer." establishes it,
      // while the hop's own destination ("Homer was an ancient Greek poet")
      // has no establishing predecessor at all.  The same reading
      // `namedByQuery` and `cmpAccounted` already take of a hop.
      const da = establishing(dominant.anchor);
      const ca = establishing(c.point !== null ? c.anchor : c.src.anchor);
      if (indexOf(da, ca, 0) < 0 && indexOf(ca, da, 0) < 0) {
        sim = sharedFrameStrengthOf(ctx, da, ca);
        frameSeats.set(c, [da, ca]);
      }
    }
    ctx.trace?.step(
      "tryAnalog",
      [
        rNode(ctx, dominant.anchor, "dominant"),
        rNode(ctx, c.anchor, "candidate", sim),
      ],
      [],
      `analogy strength ${sim.toFixed(4)}${halo ? " (halo tier)" : ""}`,
    );
    if (sim > bestSim) {
      bestSim = sim;
      bestAnalog = c;
      bestHalo = halo;
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
      // A fallback comparison carries NO similarity evidence at all.  Its
      // honesty rests on the grounding decider discounting it against
      // richer candidates (the design note below) — an assumption that
      // holds only when the climb itself settled on this query with real
      // evidence.  Under a root the consensus floor does not trust, an
      // unnamed, hop-reached hub is pure corpus adjacency: refusing it is
      // what kept the live wrong echo silent.  A hub the query itself
      // NAMED stays eligible either way (test/29 C2/C3's "William
      // Shakespeare"); an unnamed one under a TRUSTED root stays eligible
      // too (test/33 1b's deliberately weak second candidate).
      if (!rootTrusted && !namedByQuery(c)) continue;
      // Evidence clamped at the hub bound: beyond √N + 1 the exact fan-out
      // no longer discriminates (every mega-hub ties at the clamp), and
      // counting it exactly would require the corpus-sized read.
      const fanOut = ctx.store.nextFirst(c.anchor, fanClamp).length;
      if (fanOut === 0) continue;
      const support = ctx.store.prevCount(c.anchor);
      if (support === 0) continue;
      const total = support + fanOut;
      if (total < hubSupport) continue;
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
  //
  // roots.length <= 1 is a PROXY for "the query is about one thing" — it is
  // only as good as the climb's own root-commitment, which depends on
  // recognise() having found something to commit a root TO.  When the
  // query's newest content genuinely isn't recognised (not boundary noise —
  // real, uncommitted content; see the session's own investigation of the
  // France→Spain live trace), the climb under-commits roots and this proxy
  // is fooled: comparison looks licensed to treat the query as one topic
  // when it is not.
  //
  // The direct check is the SAME accounted spans comparison is about to
  // cite as its evidence: unexplainedSpans (rationale.ts, the same gap
  // computation the trace's own `unexplained` diagnostic uses) names every
  // stretch of the query NEITHER the dominant NOR the analog's evidence
  // touches.  A short comparison query ("How is ice like steel?") legitimately
  // accounts for only its two short entity spans — the surrounding "How is
  // ... like ...?" framing is real but SHORT, split into several small gaps,
  // none of them the bulk of the query.  The live bug's shape is different in
  // kind, not degree: ONE contiguous, substantial gap — a whole second
  // question the query added that comparison's two spans never touch at all.
  //
  // Two bars, both derived, neither tuned:
  //   • the largest gap must not DOMINATE the whole query (the same
  //     predicate CAST's own frame gate uses) — rules out a gap that is
  //     most of the query outright;
  //   • the largest gap must be SMALLER than the dominant's own established
  //     context.  A gap can't be dismissed as mere connective framing once
  //     it is at least as large as the topic being compared FROM — at that
  //     scale it isn't glue between two named things, it's substantial
  //     enough to be a second topic in its own right.  This is what
  //     actually separates the live bug (a 47-byte gap against a 30-byte
  //     dominant — the ignored content is bigger than the topic itself)
  //     from ordinary short comparisons (a 9-byte gap against an 11-byte
  //     dominant — the gap is smaller than what's being compared): the two
  //     cases land on the same side of "half the query" often enough
  //     (both can exceed or clear it) that the query-relative bar alone
  //     does not reliably separate them — the topic-relative scale does.
  const cmpAccounted: Array<[number, number]> = bestAnalog !== null
    ? [...runSpans(dominant), ...runSpans(bestAnalog.point ?? bestAnalog.src)]
    : [];
  const cmpGaps = unexplainedSpans(query.length, cmpAccounted);
  const cmpMaxGap = cmpGaps.reduce((n, [s, e]) => Math.max(n, e - s), 0);
  // An analog that is not itself a directly ALIGNED point (point !== null —
  // its own runs are query bytes, the query NAMED it) was only reached
  // through a continuation hop or the structural-hub fallback.  Voicing
  // learnt content the query never named is the same act recallByResonance
  // refuses to perform through a climb root whose consensus vote is below
  // consensusFloor(N) = ln(N) + 1/2 (recall.ts's minVote), so comparison
  // holds the climb to that SAME bar before citing a hop-reached analog:
  // some committed root must clear the floor.  The climb's FIRST root is
  // deliberately floor-free (attention.ts: "the dominant one always
  // grounds") — fine for ORIENTING mechanisms, not for transferring
  // unnamed content through.  The live bug this gates (real trained store,
  // 325k edge sources, floor 13.2): the query's stopword scraps pooled a
  // 1.92 vote that committed an unrelated haiku exemplar as the sole root,
  // and comparison voiced that exemplar's continuation through a
  // hop-reached analog while every other mechanism honestly refused.  A
  // directly aligned analog needs no floor — the query's own bytes are its
  // evidence (test/29 C1's "Steel is hard" for "How is ice like steel?").
  // See test/50-cast-analog-consensus-floor.
  // A HALO-tier best analog needs neither: its similarity already cleared
  // significanceBar-gated distributional company (analogyStrength's
  // `halo`) — genuine evidence in its own right, the very case the halo
  // gate exists for (test/33 1b's nickname-corroborated analog).  Only a
  // FRAME-tier or fallback analog — whose "similarity" is an unbarred
  // coverage fraction or nothing — needs the query's naming or the climb's
  // trust.
  const analogNamed = bestAnalog !== null && namedByQuery(bestAnalog);
  // NOTE — two further gates were tried here and empirically REFUTED,
  // recorded so they are not re-tried:
  //   • dominant self-coverage (dominant's aligned runs must dominate its
  //     own ctx): legitimate dominants sit at the same coverage as junk
  //     ones ("The Mona Lisa was painted by…" 16/47 vs the live junk
  //     haiku ~10/54) — no separation.
  //   • denying the shared-frame similarity tier to hop-reached analogs:
  //     semantically right in isolation, but it merely promoted the next
  //     junk candidate — an ALIGNED scrap-matched point ("The affluence…",
  //     frame 0.157) — into bestAnalog on the live store, and the aligned
  //     configuration is byte-structurally IDENTICAL to test/29 C1's
  //     legitimate one ("Steel is hard", frame 0.364): every derived
  //     local separator measured (run length, site overlap, frame
  //     query-containment, weave-usable classification) falls on the same
  //     side for both.  Only corpus-scale consensus separates them, which
  //     is exactly what `rootTrusted` prices.
  // FRAME-tier evidence under an UNTRUSTED root is comparison's weakest
  // licence (an unbarred coverage fraction, a climb the consensus floor
  // does not trust).  There it is additionally held to the IGNORED-KNOWN
  // principle (dismissedKnownContent, bridge.ts): the two analogs' aligned
  // runs must account for every STORED window of the query.  This is the
  // byte-structural separator the refuted-gates note below could not find
  // locally: a legitimate small-corpus comparison ("How is ice like
  // steel?") leaves only UNATTESTED spans ("How ", " like ") unexplained,
  // while a scrap-matched junk pair leaves the query's own trained content
  // ("…songs…times…", "…planet…sun.") dismissed as gaps.  Halo-tier and
  // trusted-root comparisons are exempt — their evidence already stands.
  // A TRUSTED ROOT IS NOT A LICENCE TO IGNORE WHAT THE STORE KNOWS.  This
  // exemption used to read `!(bestHalo || rootTrusted)`, so a root clearing
  // consensusFloor discarded the ignored-known verdict entirely — and that
  // verdict is the one piece of evidence in this gate that actually sees the
  // failure: measured on test/50's probes, `dismissedKnownContent` returns
  // TRUE for both ("songs"/"times"/"planet"-class trained content left in the
  // comparison's gaps) while `rootTrusted` is also true, so the gate read
  // false and comparison fired on a junk analog.
  //
  // The root's trust says the CLIMB settled on something; it says nothing
  // about whether THIS comparison's own evidence covers the query's known
  // content, which is a different question about a different quantity.  Halo
  // stays exempt — halo-tier company is independent evidence in its own right
  // (test/33 1b's nickname-corroborated analog), which is exactly what a
  // pooled consensus vote is not.
  //
  // Measured cost, and it is a candidate COUNT, not an answer: test/33 1b
  // ("expected at least two CAST candidates") loses one of its two, because
  // the comparison schema now honestly declines. The junk analogs it used to
  // supply were never the ones that test is about.
  const cmpDismisses = !bestHalo &&
    dismissedKnownContent(ctx, query, cmpAccounted);
  if (
    bestAnalog !== null &&
    (bestHalo || analogNamed || rootTrusted) &&
    !cmpDismisses &&
    queryScale(dominant.ctx.length) &&
    roots.length <= 1 &&
    !dominates(cmpMaxGap, query.length) &&
    cmpMaxGap < dominant.ctx.length
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
    const seats = frameSeats.get(bestAnalog);
    const a = seats !== undefined ? seats[0] : await seatOf(dominant);
    // The analog is only being CITED for comparison — the query never asked
    // about it — so its seat never chases a FORWARD continuation (see
    // seatOfNode's `allowForward`): only reverse (if a predecessor genuinely
    // establishes it) or its own bytes.  A DIRECTLY aligned point
    // (bestAnalog.point !== null) still goes through seatOfNode for that
    // reverse check (a bare entity NAME like "Leonardo da Vinci" needs it —
    // test/29's C2/C3).  A nextOf DESCENDANT (point === null) was already
    // reached by following ONE meaningful hop off another aligned point (the
    // alignment loop above: "its nextOf is the hub... and the hub's own
    // [...] context will be the seat") — its own bytes ARE that seat
    // directly, with no predecessor to even check (it was found by a
    // forward edge, not matched in the query).
    const b = seats !== undefined
      ? seats[1]
      : bestAnalog.point !== null
      ? await seatOf(bestAnalog.point, false)
      : read(ctx, bestAnalog.anchor);
    const answer = await joinWithBridge(ctx, a, b);
    record(
      answer,
      "analogical comparison — each analog voiced by the context that establishes its role",
      new Set([dominant.anchor, bestAnalog.anchor]),
      // A halo-mediated act (the analogy gate) plus two seat projections.
      CONCEPT + STEP + STEP,
      // What comparison READ: the dominant's own aligned runs, plus the
      // aligned runs of the point that named the analog — the analog itself
      // when it was an aligned point, else the source point whose
      // continuation edge reached it (that alignment IS the query evidence
      // the hop rests on).
      cmpAccounted,
    );
  } else if (
    bestAnalog !== null &&
    queryScale(dominant.ctx.length) &&
    roots.length <= 1
  ) {
    ctx.trace?.step(
      "validateAnalogy",
      [
        rNode(ctx, dominant.anchor, "analog", bestSim),
        rNode(ctx, bestAnalog.anchor, "analog", bestSim),
      ],
      [],
      !(bestHalo || analogNamed || rootTrusted)
        ? `the best analog carries no halo-tier company evidence, was never ` +
          `named by the query, and no committed root's consensus vote ` +
          `clears the floor, so comparison refuses to voice it`
        : cmpDismisses
        ? `a frame-tier analog under an untrusted root dismisses stored ` +
          `query content its alignment never accounted for — comparison ` +
          `refuses to ignore what the store knows`
        : `comparison's own accounted evidence leaves a ${cmpMaxGap}-byte gap in ` +
          `a ${query.length}-byte query against a ${dominant.ctx.length}-byte ` +
          `dominant — too large to be mere framing — so it refuses rather ` +
          `than paper over it with an analog the query never asked about`,
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

// ── Pipeline mechanism ──────────────────────────────────────────────────────

import type { PipelineMechanism, Precomputed } from "../pipeline-mechanism.js";

export const castMechanism: PipelineMechanism = {
  name: "cast",
  provenance: "cast",
  async floor(_ctx, query, pre, worthRunning) {
    const W = _ctx.space.maxGroup;
    // Cheap checks first — no pre-computation needed.
    if (query.length < 2 * W || _ctx.store.edgeSourceCount() === 0) return null;
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
    if (!worthRunning(2 * STEP)) return 2 * STEP;
    // Now first-touch the shared analyses (climb, then the weave built on
    // it).  If another mechanism already triggered either, this awaits the
    // cached result; otherwise it's computed once here and reused in run().
    if ((await pre.attention()).ranked.length < 2) return null;
    if ((await pre.weave()).points.length < 2) return null;
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
