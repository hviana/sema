// cast.ts — Counterfactual Transfer / CAST.
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
import {
  answersOtherQuestions,
  argmaxBy,
  corpusN,
  heldElsewhere,
  hubBound,
  hubWindows,
  offsetCanon,
  otherInstance,
  thingIn,
} from "../traverse.js";
import {
  analogyStrength,
  follow,
  type GradedRun,
  project,
  reverseContext,
  sharedFrameStrengthOf,
} from "../match.js";
import { joinWithBridge } from "../resonance.js";
import { CONCEPT, STEP } from "../graph-search.js";
import { indexOf, latin1, sharedEnds } from "../../bytes.js";
import {
  AGREEMENT,
  consensusFloor,
  dominates,
  instanceCap,
  phraseCap,
  twoQuanta,
} from "../../geometry.js";
import {
  restates,
  unexplainedSpans,
  unionSpans,
  windowSpans,
} from "../derivation.js";
import { rItem, rNode } from "../trace.js";
import { dismissedKnownContent } from "../bridge.js";

// ── CAST gates ────────────────────────────────────────────────────────────
//
// The frame gate has TWO components, both derived from the weave itself:
//
//   1. MIN WEAVE — the same 2 as the precondition `points.length < 2` (CAST
//      needs at least two aligned structures to form a weave).  Frame requires
//      evidence BEYOND the minimum pair — a third structure agreeing — so the
//      depth gate is `depth > AGREEMENT`.  One definition, two uses.
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

// A weave needs AGREEMENT aligned structures; frame requires MORE than that
// minimum: `depth > AGREEMENT` means at least three structures agree on a
// byte, so no byte is frame when only the minimum pair exists.

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
 *  term C3's further-hop candidate lives in.
 *
 *  The distinguishing signal is content-addressed, not a count: a genuine
 *  establishing predecessor's bytes CONTAIN id's own bytes — it names or
 *  describes id ("...painted by Leonardo da Vinci." contains "Leonardo da
 *  Vinci").  An incidental adjacency predecessor never does — it merely
 *  preceded id in some unrelated document without ever mentioning it.  No
 *  new tuned constant: containment is the same primitive `restates`
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
  if (query.length < twoQuanta(quantum) || ctx.store.edgeSourceCount() === 0) {
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
  let widest = points[0];
  let widestN = -1;
  for (const p of points) {
    const n = coveredOf(p).size;
    if (n > widestN) {
      widestN = n;
      widest = p;
    }
  }
  const widestSet = widest === undefined
    ? new Set<number>()
    : coveredOf(widest);
  let distinct = points.length === 0 ? 0 : 1;
  for (const p of points) {
    if (p === widest) continue;
    let own = 0;
    for (const i of coveredOf(p)) if (!widestSet.has(i)) own++;
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
  const dispersed = roots.length >= AGREEMENT ||
    roots.some((r) => r.clusters >= AGREEMENT);
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
  // A byte is FRAME when more than AGREEMENT aligned structures cover it
  // AND those structures are a majority of all aligned structures.
  // Per-byte:  frame(i) ⇔ depth[i] > AGREEMENT ∧ dominates(depth[i], aligned)
  // Per-run:   usable(r) ⇔ ¬dominates(framedCount, runLen)
  const isFrame = (i: number): boolean =>
    depth[i] > AGREEMENT && dominates(depth[i], aligned);
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
  // VOICEABLE — a structure whose own learnt content a schema may SPEAK.
  //
  // The gate below asks only that the weave TOUCH a committed point.  That is
  // the right question for MEMBERSHIP — a weave needs uncommitted structure to
  // compare against; that is what an analogy IS — and the wrong one for
  // VOICING: satisfied by any committed bystander, it lets every OTHER aligned
  // point put its own learnt content into the answer while a root that
  // contributed nothing holds the door open.  The refusal note below already
  // states the principle — "CAST refuses to transfer through content the climb
  // itself never settled on" — it was simply never asked of the structure a
  // schema actually transfers THROUGH.
  //
  // Measured on a two-hop question over dialogue filler (N ~ 103,
  // consensusFloor 5.13): the climb committed ONE root at vote 8.13, and
  // substitution then voiced a filler deposit at vote 0.15 together with a
  // second structure at 0.57 — neither committed, both an order of magnitude
  // below the floor, while the licensing root supplied no bytes at all.
  //
  // OR THE QUERY NAMED IT.  Commitment is not the only warrant: a structure the
  // asker QUOTED is content the query did ask about, whoever the climb settled
  // on.  The naming test is the one redirection's own `named` list uses — an
  // aligned run starting at the structure's OPENING bytes (`cs === 0`) — and
  // NOT merely "has an aligned run", which every weave point has by
  // construction.  Without this disjunct the gate refuses test/29 B3 ("what if
  // the capital of France were Lyon?" must answer about Lyon), where the
  // substitute is named outright and the climb never commits it.  This mirrors
  // the pairing the hub fallback makes with `!rootTrusted && !namedByQuery`.
  const namedFromOpening = (p: Point): boolean =>
    p.runs.some((r) => r.cs === 0 && usable(r.qs, r.qe));
  const voiceable = (p: Point): boolean =>
    isRoot(p.anchor) || namedFromOpening(p);
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
  // NO TRANSFER THROUGH ANOTHER INSTANCE OF THE QUESTION.  A co-instance
  // (traverse.ts, `otherInstance`) is the question's frame around another
  // filler: what it shares with the query is frame, and its seat is that
  // filler's own answer.  It evidences the frame (evidence.md) and is voiced by
  // no schema — not as the comparison's dominant or analog, not as the
  // substitution's subject or displaced structure.  `Where was the father of
  // Z born?` took `Where was Y born?` as subject and voiced its opening:
  // `Where was fatherThe father of Z is X.`  One read per point, memoised.
  const coInstances = new Map<number, boolean>();
  const isCoInstance = (anchor: number): boolean => {
    let v = coInstances.get(anchor);
    if (v === undefined) {
      v =
        otherInstance(ctx, read(ctx, anchor, instanceCap(query.length) + 1)) !==
          null;
      coInstances.set(anchor, v);
    }
    return v;
  };

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
        // …and the subject is a structure OF THIS QUESTION: a fragment whose
        // continuations the question names none of answers other questions
        // (traverse.ts, `answersOtherQuestions`), the bar redirection holds
        // its substitute to below.  `director`, inheriting every `… director`
        // fact, filled the seat of `Premium (film)` with itself.
        return f !== null && f.cs < quantum && usable(f.qs, f.qe) &&
            !answersOtherQuestions(ctx, s.anchor, query.length, f.qe - f.qs) &&
            !isCoInstance(s.anchor)
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
      // The DISPLACED STRUCTURE is what this schema speaks — the answer is its
      // tail past the seat plus its own continuation — so it must be
      // voiceable.  Filtered HERE rather than after the argmax so an eligible
      // structure with less depth still fires the schema, instead of an
      // ineligible deepest candidate suppressing it outright.  The SUBJECT is
      // deliberately not gated: `fillerOf` reads the QUERY's own bytes for it,
      // so it contributes what the asker already said, not learnt content.
      if (!voiceable(p) || isCoInstance(p.anchor)) return null;
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
      !restates(query, fwd, 0, { proper: true })
    ) {
      // THROUGH THE SHARED JOINER, not a bare concatenation.
      //
      // `joinWithBridge` is the composition step every out-of-search assembly
      // shares (multi-topic fusion, CAST's substitution and comparison): it
      // asks the corpus for a learnt connector between the pieces and, on a
      // miss, joins them BARE **and says so** — the `bridgeMiss` step (see
      // resonance.ts).  This site bypassed it, and that is the whole of the
      // gluing the study measured: `"Steel is hard"` + `"wet"` came back as
      // `"hardwet"`, `"eva director father"` + `"The father of…"` as
      // `"fatherThe"` — compositions no rationale could show, because the one
      // step that made them left no trace.
      //
      // Routing it through the shared joiner is the instrumentation fix that
      // comes first: a bare join stays possible (the house rule is "joined
      // bare, never silent") but it is now VISIBLE, and an attested connector
      // is used when the corpus has one.
      answer = await joinWithBridge(ctx, answer, fwd);
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
  // A run NAMES only by what is not scaffolding: `The ` of `Year Of The
  // Horse` opens `The Secret director` too, and named nothing (the evidence
  // TWO THINGS NAMED asks of a comparison, commonality.md).
  // A REDIRECTION PUTS ONE THING IN ANOTHER'S PLACE; A QUESTION THAT ASKS
  // THE SAME OF TWO THINGS ENUMERATES.  When what the substitute would voice
  // and what the displaced structure would voice are two instances of one
  // frame (shared ends of at least a window, each with its own middle), and
  // the question names the displaced one's thing too (held whole, every
  // window of it), the question asks about both — `Which film has the
  // director who was born later, A or B?` — and voicing B's fact alone
  // answers half of it.  `…were Lyon?` against `What is the capital of
  // France?` (Paris / Lyon is a city in France: no shared frame) and
  // `When was the director of film Jinpa born?` (the displaced director's
  // film is not named) still redirect.  Measured: 86 of the 100 real answers
  // the schema misvoiced over three 2Wiki fixtures, with every redirection
  // test kept.
  const enumerates = async (
    displaced: Point,
    voiced: Uint8Array,
  ): Promise<boolean> => {
    const d = await follow(ctx, displaced.anchor, qv);
    if (d === null) return false;
    const [p, q] = sharedEnds(d, voiced);
    if (
      p + q < quantum || d.length - p - q <= 0 || voiced.length - p - q <= 0
    ) {
      return false;
    }
    const th = thingIn(ctx, d.subarray(p, d.length - q));
    const asked = ctx._edgeAsked;
    if (th === null || asked === null) return false;
    const own = offsetCanon(ctx, th.bytes);
    if (own.length < quantum) return false;
    for (let o = 0; o + quantum <= own.length; o++) {
      if (!asked.index.has(latin1(own.subarray(o, o + quantum)))) return false;
    }
    return true;
  };
  const hubQ = hubWindows(ctx, query);
  const names = (r: GradedRun): boolean => {
    for (let o = r.qs; o + quantum <= r.qe; o++) if (!hubQ[o]) return true;
    return false;
  };
  const named = points.flatMap((p) => {
    const r = p.runs.find((r) => r.cs === 0 && usable(r.qs, r.qe) && names(r));
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
  // The SUBSTITUTE is what redirection speaks — the answer IS `project(last)`,
  // its own fact — so the same bar applies.  The displaced structure is only
  // recognised as the slot being overridden and is never voiced, so it is
  // deliberately not gated here.
  // …and the substitute must lead somewhere FOR THIS QUESTION: a fragment
  // whose continuations the question names none of answers other questions
  // (traverse.ts, `answersOtherQuestions`).  `ong)?`, the tail of every
  // `… (… Song)?` question, was "named" by `What is the place of birth of the
  // performer of song Heaven (Namie Amuro Song)?`, and redirection voiced
  // its most-poured stranger's birthplace.
  const stranger = last !== undefined &&
    answersOtherQuestions(
      ctx,
      last.point.anchor,
      query.length,
      last.run.qe - last.run.qs,
    );
  if (
    last !== undefined && last.point !== dominant &&
    voiceable(last.point) && !stranger
  ) {
    const g = await project(ctx, last.point.anchor, qv);
    if (g !== null && !(await enumerates(dominant, g))) {
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
      !restates(query, p.ctx, 0)
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
        restates(query, nctx, 0)
      ) continue;
      analogs.push({ anchor: nid, point: null, src: p });
    }
  }
  // MEASURED AND REFUTED — proposing analogs from the dominant's halo when the
  // query-local generator finds none.  Both loops above are query-local (an
  // aligned point, or one forward hop off one), while the gate that judges
  // candidates — analogyStrength's halo tier — is cross-domain by construction
  // and is licence enough on its own (`bestHalo` exempts it from the
  // ignored-known principle).  So the gate reads as strictly more capable than the
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
      r.qe - r.qs >= twoQuanta(quantum) &&
      indexOf(bytes, query.subarray(r.qs, r.qe), 0) >= 0
    );
  };
  // Whether any committed root's consensus vote clears the SAME trust bar
  // recallByResonance applies before grounding through a climb root:
  // consensusFloor(N) = ln(N) + 1/2.  The climb's FIRST root is
  // deliberately floor-free (attention.ts: "the dominant one always
  // grounds") — fine for ORIENTING mechanisms, not for voicing learnt
  // content the query never asked about.  The hub fallback below reads it.
  const rootTrusted = roots.some((r) =>
    r.idfVote >= consensusFloor(corpusN(ctx))
  ); // the IDF sum: the bar's own quantity
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
    // subject to the ignored-known principle the comparison gate holds all
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
  // COMPARISON gate — a comparison cites the dominant and ONE analog, so the
  // query must be about them.  The check is the accounted spans comparison
  // is about to cite as its evidence: unexplainedSpans names every stretch
  // of the query NEITHER the dominant NOR the analog's evidence touches.  A
  // short comparison query ("How is ice like steel?") leaves its "How is ...
  // like ...?" framing in several small gaps; the failure is different in
  // kind — ONE contiguous gap at least as large as the topic compared FROM
  // (the dominant's own established context), which is no glue between two
  // named things but a second topic in its own right (measured live: a
  // 47-byte gap against a 30-byte dominant, while ordinary comparisons leave
  // a 9-byte gap against an 11-byte dominant).
  const cmpAccounted: Array<[number, number]> = bestAnalog !== null
    ? [...runSpans(dominant), ...runSpans(bestAnalog.point ?? bestAnalog.src)]
    : [];
  const cmpGaps = unexplainedSpans(query.length, cmpAccounted);
  const cmpMaxGap = cmpGaps.reduce((n, [s, e]) => Math.max(n, e - s), 0);
  // TWO THINGS NAMED.  A comparison voices two structures, so the question
  // must name EACH with material of its own: W-windows of the question the
  // structure holds — on its aligned runs, or anywhere in its own form under
  // the response's equivalence (the witness reading, evidence.md) — neither
  // inside the other's runs nor corpus scaffolding (`hubWindows`), and a run of
  // them no other context holds (`heldElsewhere`).  Exact decides which
  // structure is meant; the halo only ranks.  `father of Frederick II?`
  // reached `Peter III of Aragon father` through ` father`, which the dominant
  // `Frederick II father` already holds, and ` of `, which every fact holds —
  // and the comparison glued the analog's bare question onto the answer.
  // `When was the director of film Reykjavík-Rotterdam born?` named `David
  // Eady (film director) date of birth` by `ctor` and `film `, which its
  // `date of death` holds too; `In which town did Z come into the world?`
  // named the dominant `Did W come into the world in X?` by what every `Did …
  // come into the world in …?` holds.  `How is ice like steel?` names `Ice is
  // cold` with `ice `, which no run aligns (the case differs) and no other
  // context holds.
  const namedMemo = new Map<string, boolean>();
  const namesApart = (
    point: number,
    voiced: number,
    runs: Array<[number, number]>,
    other: Array<[number, number]>,
  ): boolean => {
    const key = `${point}:${voiced}`;
    const hit = namedMemo.get(key);
    if (hit !== undefined) return hit;
    const W = ctx.space.maxGroup;
    const hub = hubWindows(ctx, query);
    const cap = phraseCap(query.length, W);
    const forms = [point, voiced].map((id) =>
      offsetCanon(ctx, read(ctx, id, cap))
    );
    const owns = (o: number): boolean =>
      !hub[o] && !other.some(([ms, me]) => o >= ms && o + W <= me);
    const own = new Set<number>();
    for (const [s, e] of runs) {
      for (let o = s; o + W <= e; o++) {
        const w = offsetCanon(ctx, query.subarray(o, o + W));
        if (owns(o) && forms.some((f) => indexOf(f, w, 0) >= 0)) own.add(o);
      }
    }
    const asked = ctx._edgeAsked;
    if (asked !== null) {
      const form = offsetCanon(
        ctx,
        read(ctx, voiced, phraseCap(asked.bytes.length, W)),
      );
      for (let o = 0; o + W <= form.length; o++) {
        const at = asked.index.get(latin1(form.subarray(o, o + W)));
        if (at !== undefined && owns(at)) own.add(at);
      }
    }
    // A span is a run of consecutive owned windows.
    const spans = unionSpans(windowSpans(own, W), 1 - W);
    // Named apart only where the net was read to its end and held by no other
    // context; a saturated net (commonness past the hub) abstains.
    const out = spans.some((sp) =>
      heldElsewhere(ctx, query, sp, point, voiced) === "apart"
    );
    namedMemo.set(key, out);
    return out;
  };
  const analogNamedApart = (): boolean =>
    bestAnalog !== null && namesApart(
      (bestAnalog.point ?? bestAnalog.src).anchor,
      bestAnalog.anchor,
      runSpans(bestAnalog.point ?? bestAnalog.src),
      runSpans(dominant),
    );
  const dominantNamedApart = (): boolean =>
    bestAnalog !== null && namesApart(
      dominant.anchor,
      dominant.anchor,
      runSpans(dominant),
      runSpans(bestAnalog.point ?? bestAnalog.src),
    );
  // THE LICENCE IS WHAT THE QUESTION LEAVES UNSAID.  A comparison cites two
  // structures, and what refuses a junk analog is what its evidence leaves
  // out: the IGNORED-KNOWN principle (dismissedKnownContent, bridge.ts) — the
  // two analogs' aligned runs must account for every STORED window of the
  // query.  A legitimate comparison ("How is ice like steel?") leaves only
  // UNATTESTED spans ("How ", " like ") unexplained, while a scrap-matched
  // junk pair leaves the query's own trained content ("…songs…times…",
  // "…planet…sun.") dismissed as gaps (test/50).  A halo-tier analog is
  // exempt: halo-tier company is independent evidence in its own right
  // (test/33 1b's nickname-corroborated analog).
  //
  // MEASURED REDUNDANT, and removed: an evidence bar (halo tier, a naming by
  // the question that discriminates, or a root clearing consensusFloor), the
  // analog's scale, a single committed root, and a largest gap that does not
  // dominate the query.  Each was withdrawn alone and all four together over
  // the suite and three 2Wiki fixtures (900 questions, a fresh Mind each):
  // no answer moved — the ignored-known principle, the co-instance refusal,
  // the gap against the dominant and the two namings below decide every case
  // they did.
  const cmpDismisses = !bestHalo &&
    dismissedKnownContent(ctx, query, cmpAccounted);
  // …and both analogs must be something the question is ABOUT (`isCoInstance`):
  // `Where was the performer of song God (Lennon Song) born?` compared `Where
  // was Shakira (Shakira Song) born?` with `John Lennon` and voiced Shakira's
  // birthplace; an analog `Where was Robert, 1st Earl of Gloucester … born?`
  // was voiced whole beside the first hop of `Where was the father of …?`.
  const coInstanceAnalog = isCoInstance(dominant.anchor) ||
    (bestAnalog !== null && isCoInstance(bestAnalog.anchor));
  if (
    bestAnalog !== null &&
    !coInstanceAnalog &&
    !cmpDismisses &&
    cmpMaxGap < dominant.ctx.length &&
    analogNamedApart() &&
    dominantNamedApart()
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
    let b = seats !== undefined
      ? seats[1]
      : bestAnalog.point !== null
      ? await seatOf(bestAnalog.point, false)
      : read(ctx, bestAnalog.anchor);
    // AN ECHO IS NOT A VOICE.  `allowForward: false` above leaves seatOfNode
    // with one last resort — the point's OWN BYTES — and when the aligned
    // anchor is a QUESTION node those bytes are the question itself.  The
    // comparison then hands the asker their own words back: "What is the
    // capital of France? And what is the largest planet?" answered "The
    // capital of France is Paris.What is the largest planet?", one topic
    // answered and the other merely repeated.  (The same corpus answered BOTH
    // when asked in the opposite order — the echo was never about the topic,
    // only about whether the climb happened to land on the question node or
    // the answer node.)
    //
    // The fix is NOT to allow the forward edge for every directly aligned
    // analog.  "Directly aligned" does not mean "the query named it": a point
    // can be aligned by HALO similarity with no literal overlap at all, and
    // test/43 pins exactly that case — an analog whose own bytes are already a
    // complete Q+A unit, cited structurally, whose forward edge is an
    // unrelated next quiz question.  There, stopping at its own bytes is
    // right, because those bytes are an answer and nothing was echoed.
    //
    // What separates the two is the RESTATEMENT, which is directly testable:
    // a seat whose bytes already occur in the query says nothing the asker did
    // not just say, so it cannot be this analog's contribution — and only then
    // is the continuation the query literally asked for worth following.  Same
    // `restatesQuery` primitive the substitution schema above already gates
    // its own forward step on; no new constant and no new notion of "named".
    // Read the restatement UNDER THE RESPONSE'S OWN EQUIVALENCE.  Byte-exact
    // containment misses the case that actually occurs: the trained node is
    // "What is the largest planet?" while the query asks "And what is the
    // largest planet?" — the same words, one capital letter apart, so
    // `indexOf` finds nothing and the echo sails through.  `ctx.canon` is the
    // response's injected notion of "the same text" (case, width, whitespace);
    // consulting it here is the same fallback `resolve` already makes when an
    // exact content lookup misses, and it keeps this mechanism from carrying
    // any idea of its own about what a character is.
    // TWO WITNESSES, ONE LAW: the byte reading, and — when the response carries
    // one — the same reading under the response's own equivalence.  Asked twice
    // rather than branched on, because the equivalence is a property of the
    // injected canonicalizer (a substring-monotone function is the usual case,
    // not a guarantee), and the two readings are OR-ed here exactly as they were
    // before this became one definition.
    const echoesQuery = (x: Uint8Array): boolean =>
      restates(query, x, 0, { proper: true }) ||
      (ctx.canon !== null &&
        restates(query, x, 0, { equate: ctx.canon, proper: true }));
    if (echoesQuery(b)) {
      const fwd = await follow(ctx, bestAnalog.anchor, qv);
      if (fwd !== null && fwd.length > 0 && !echoesQuery(fwd)) b = fwd;
    }
    // VOICED IN THE ORDER THE QUERY POSED THEM.  `a` is the DOMINANT point
    // and `b` the analog, which is a ranking by consensus strength — not by
    // where either was asked about.  Reading the pair out in that ranking
    // makes a two-topic answer's order depend on which topic resonated
    // harder, so the same two questions asked in the opposite order produce
    // the same sentence: measured on test/57, "What is the largest planet?
    // And what is the capital of France?" answered "The capital of France is
    // Paris.The largest planet is Jupiter." — both halves right, the order
    // backwards, because France was the dominant point (accounted [[33,62],
    // [0,27]] — the runs are literally in reverse query order).
    //
    // This is the SAME rule fuseAttention already applies one layer up ("a
    // multi-topic answer should read in the order the question posed its
    // topics"), applied to the pair a single comparison voices itself.  Each
    // point's position is the earliest query byte its own aligned runs stand
    // on — the same runs `cmpAccounted` prices the schema by, so order and
    // cost read one source.
    const earliest = (p: Point): number =>
      runSpans(p).reduce((m, [s]) => Math.min(m, s), Infinity);
    const analogPoint = bestAnalog.point ?? bestAnalog.src;
    const swap = earliest(analogPoint) < earliest(dominant);
    const answer = swap
      ? await joinWithBridge(ctx, b, a)
      : await joinWithBridge(ctx, a, b);
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
  } else if (bestAnalog !== null) {
    ctx.trace?.step(
      "validateAnalogy",
      [
        rNode(ctx, dominant.anchor, "analog", bestSim),
        rNode(ctx, bestAnalog.anchor, "analog", bestSim),
      ],
      [],
      coInstanceAnalog
        ? `an analog is another instance of the question's frame — its ` +
          `seat is another filler's answer, not what the question asks about`
        : cmpDismisses
        ? `a frame-tier analog under an untrusted root dismisses stored ` +
          `query content its alignment never accounted for — comparison ` +
          `refuses to ignore what the store knows`
        : cmpMaxGap >= dominant.ctx.length
        ? `comparison's own accounted evidence leaves a ${cmpMaxGap}-byte gap in ` +
          `a ${query.length}-byte query against a ${dominant.ctx.length}-byte ` +
          `dominant — too large to be mere framing — so it refuses rather ` +
          `than paper over it with an analog the query never asked about`
        : !analogNamedApart()
        ? `the question evidences the analog only with windows the dominant ` +
          `holds, the corpus' scaffolding, or runs another context holds too ` +
          `— it names one structure, not two, so there is nothing to compare`
        : `the question evidences the dominant only with runs another context ` +
          `holds too — it names a frame, not the structure compared from`,
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

import {
  coveredOf,
  type PipelineMechanism,
  type Precomputed,
} from "../pipeline-mechanism.js";

export const castMechanism: PipelineMechanism = {
  name: "cast",
  provenance: "cast",
  async floor(_ctx, query, pre, worthRunning) {
    const W = _ctx.space.maxGroup;
    // Cheap checks first — no pre-computation needed.
    if (query.length < twoQuanta(W) || _ctx.store.edgeSourceCount() === 0) {
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
    }));
  },
};
