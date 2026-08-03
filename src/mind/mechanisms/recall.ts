// mechanisms/recall.ts — Recall by resonance (Grounding VI).
//
// The recall mechanism resonates the whole query's gist against the content
// index and grounds the nearest learned form.  Four tiers, orderly degrading
// from exact self-match to honest echo.

import { cosine } from "../../vec.js";
import {
  conceptThreshold,
  consensusFloor,
  dominates,
  identityBar,
  reachThreshold,
  significanceBar,
} from "../../geometry.js";
import type { MindContext } from "../types.js";
import { gistOf, read, resolve } from "../primitives.js";
import { bytesEqual, indexOf } from "../../bytes.js";
import { allWindowsAreScaffolding, corpusN, hubBound } from "../traverse.js";
import { follow, project, reverseContext } from "../match.js";
import { CONCEPT, STEP } from "../graph-search.js";
import { unexplainedLabel } from "../rationale.js";
import type { PipelineMechanism, Precomputed } from "../pipeline-mechanism.js";
import { rItem, rNode } from "../trace.js";
import { substitutionBridge } from "../bridge.js";

/** A recall result. */
export interface RecallResult {
  bytes: Uint8Array;
  echoed: boolean;
  accounted: Array<[number, number]>;
  moves: number;
  unexplained: string;
  /** See {@link import("../pipeline-mechanism.js").MechanismResult.complete}
   *  — set by the IDENTITY-bridge tier alone. */
  complete?: boolean;
}

/** Recall the answer by resonating the whole query against the content index. */
export async function recallByResonance(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
): Promise<RecallResult | null> {
  const t = ctx.trace?.enter("recallByResonance", [
    rItem(query, "query"),
  ]);
  const whole_: Array<[number, number]> = [[0, query.length]];
  const nothing: Array<[number, number]> = [];
  const ground = (
    bytes: Uint8Array | null,
    note: string,
    accounted: Array<[number, number]>,
    moves: number,
    echoed = false,
    complete = false,
  ): RecallResult | null => {
    t?.done(
      bytes === null
        ? []
        : [rItem(bytes, "answer", resolve(ctx, bytes) ?? undefined)],
      note,
    );
    return bytes === null ? null : {
      bytes,
      echoed,
      accounted,
      moves,
      unexplained: unexplainedLabel(query, accounted),
      ...(complete ? { complete } : {}),
    };
  };
  const k = pre.k;
  const queryGist = pre.guide;

  // 0. Exact self-match — content-addressed, deterministic.
  const qId = pre.queryResolved;
  if (qId !== null) {
    const rev = ctx.store.prevFirst(qId, hubBound(ctx));
    const g = reverseContext(ctx, qId, queryGist, rev);
    if (g !== null) {
      return ground(
        g,
        rev.length === 1
          ? "exact self-match — reverse recall to the sole predecessor"
          : "exact self-match — reverse recall to the best-resonating predecessor",
        nothing,
        STEP,
      );
    }
  }

  // 0b. ARGUMENT BINDING (RC8): the query is not itself a stored form, but
  // it CONTAINS a recognised constituent that is an edge SOURCE — a learnt
  // pair's left side carried inside a wrapper ("How do you say 'thank you'
  // in French?").  The wrapper is scaffolding; the argument is the span
  // that LEADS somewhere, so its continuation — guided by the whole query's
  // gist — is the answer.  Matching the wrapper while ignoring the argument
  // (the observed "good morning" template failure) is worse than silence,
  // so anything short of ONE unambiguous binding falls through: the
  // constituent bar is the same two-quanta (2W) reading confluence binds
  // under, nested recognitions collapse to their MAXIMAL span, and two
  // distinct maximal arguments mean the query asks about neither alone.
  if (qId === null) {
    const W2 = 2 * ctx.space.maxGroup;
    const args = pre.rec.sites.filter((s) =>
      s.end - s.start >= W2 &&
      s.end - s.start < query.length &&
      ctx.store.hasNext(s.payload)
    );
    // Maximal spans by one sorted sweep (starts ascending, ties longest
    // first): every earlier span starts at or before s, so s is contained
    // exactly when the running max end already covers it.  O(m log m) — a
    // long input recognises O(|input|) sites, and a pairwise scan here was
    // quadratic in the input.
    args.sort((a, b) => a.start - b.start || b.end - a.end);
    const maximal: typeof args = [];
    let maxEnd = -1;
    for (const s of args) {
      if (s.end <= maxEnd) continue;
      maximal.push(s);
      maxEnd = s.end;
    }
    // The wrapper must actually BE scaffolding: RC8's own premise is "the
    // wrapper is scaffolding; the argument is the span that leads
    // somewhere" ("How do you say 'thank you' in French?" — everything
    // outside the argument is a small fixed template).  When the query
    // instead has ANOTHER substantial recognised form (≥ W2, the same
    // constituent bar the argument itself must clear) sitting OUTSIDE the
    // chosen argument, the query is not one argument in a wrapper — it is
    // several complete, independently-meaningful pieces (a multi-turn
    // conversation's own accumulated turns are exactly this shape), and
    // binding to the argument's continuation would answer past content
    // the query itself already carries forward.  Derived from the same W2
    // bar the argument itself is held to, never a separate tuned number.
    const hasSubstantialOutside = maximal.length === 1 &&
      pre.rec.sites.some((s) =>
        s.end - s.start >= W2 &&
        (s.end <= maximal[0].start || s.start >= maximal[0].end)
      );
    if (maximal.length === 1 && !hasSubstantialOutside) {
      const arg = maximal[0];
      const g = await follow(ctx, arg.payload, queryGist);
      // The same "no restated fragment" guard tier 2 applies below (§ "the
      // anchor cleared the consensus floor..."): a followed continuation
      // that is itself a proper byte-subspan of the QUERY restates part of
      // the question — never an answer.  A multi-turn query's own later
      // turns are exact, content-addressed matches for exactly this reason
      // (each turn is its own previously-learnt form), so without this
      // guard the argument's OWN later restatement in the same
      // conversation reads as if it were the next thing to say.
      if (
        g !== null && g.length > 0 &&
        !(g.length < query.length && indexOf(query, g, 0) >= 0)
      ) {
        return ground(
          g,
          "argument binding — the query's sole edge-source constituent, continuation followed",
          [[arg.start, arg.end]],
          STEP,
        );
      }
    }
  }

  // The response's ONE top-k read (Precomputed.resonance) — the same list the
  // frame inventory is assembled from, so a query that reaches both pays for a
  // single ANN query rather than two identical ones.
  const whole = await pre.resonance();
  if (whole.length === 0) {
    return ground(null, "empty store — nothing to resonate with", [], 0);
  }
  const top = whole[0];
  ctx.trace?.step(
    "resonate",
    [rItem(query, "query-gist")],
    whole.map((h) => rNode(ctx, h.id, "hit", h.score)),
    `resonate the whole-query gist → ${whole.length} nearest learnt form(s)`,
  );

  // 1. Clean resonance — the scale-aware identity claim.  The ANGLE
  // (top.score) carries the shared fraction; the query's MAGNITUDE (√len,
  // the linear fold's own norm) converts the tolerated foreign fraction
  // into bytes — at most one river window (see {@link identityBar}).  A
  // fixed cosine bar let long queries claim "near-identical" while whole
  // windows — an answer word — differed.
  // A hit RESTATES the query when its bytes are the query's own — exactly,
  // or under the response's equivalence (a case/width twin).  Restating
  // hits may only conclude through disciplined reverse recall: voicing
  // their bytes echoes the query back at itself (never an answer — the
  // same principle that keeps cast from voicing stored questions), and
  // projecting them forward is reverse recall's containment failure in the
  // other direction — "whatever followed these bytes in some document".
  const qKey = ctx.canon ? ctx.canon(query) : query;
  const restates = (b: Uint8Array): boolean =>
    bytesEqual(b, query) ||
    (ctx.canon !== null && bytesEqual(ctx.canon(b), qKey));
  const idBar = identityBar(ctx.store.D, ctx.space.maxGroup, query.length);
  if (top.score >= idBar) {
    for (const h of whole) {
      // The identity claim is PER HIT, not per tier: hits are ranked
      // nearest-first, and grounding one below the bar under this tier's
      // "near-identical" label would launder byte-overlap noise (observed:
      // "merci" projecting through the unrelated near hit "meraih").
      if (h.score < idBar) break;
      const own = read(ctx, h.id);
      if (h.id === qId || restates(own)) {
        const rev = ctx.store.prevFirst(h.id, hubBound(ctx));
        const g = reverseContext(ctx, h.id, queryGist, rev);
        if (g !== null) {
          return ground(
            g,
            rev.length === 1
              ? "perfect self-match — reverse recall to the sole predecessor"
              : "perfect self-match — reverse recall to the best-resonating predecessor",
            nothing,
            STEP,
          );
        }
        continue;
      }
      const g = await project(ctx, h.id, queryGist);
      if (g) {
        return ground(
          g,
          "clean whole-query resonance — ground the nearest hit",
          whole_,
          STEP,
        );
      }
    }
  }

  // The query-relative grounding fraction, shared by tiers 2–4 — gated on
  // the FRACTION OF THE QUERY the grounding explains, not the raw cosine.
  // Root gists are unit vectors, but their magnitudes are recoverable from
  // the byte lengths (‖·‖ = √len under the linear fold):
  // cos = shared/√(lenQ·lenG), so shared/lenQ = cos·√(lenG/lenQ).
  // The raw cosine punished honest containment — a query fully inside a
  // longer grounded answer scored √(lenQ/lenG) and was refused — and let a
  // long answer sharing only scaffolding pass; the query-relative fraction
  // measures exactly what the reach bar means: how much of THE QUERY the
  // store accounts for.
  // Chance similarity survives the length conversion AMPLIFIED: the same
  // √(lenG/lenQ) factor that converts an honest shared fraction into a
  // query-relative one multiplies the estimator/chance floor too, so a long
  // stored form (√(lenG/lenQ) ≈ 10 at 100×) lifted a noise-level cosine past
  // the reach bar and grounded pure gibberish (observed).  Only the
  // ABOVE-CHANCE part of the similarity is evidence of shared content —
  // subtract the significance bar (3/√D, §8.3) before converting.  Derived
  // from the existing bars; never tuned.
  const sig = significanceBar(ctx.store.D);
  const reach = reachThreshold(ctx.space.maxGroup);
  const fracOfQuery = (cos: number, otherLen: number): number =>
    Math.min(
      1,
      Math.max(0, cos - sig) *
        Math.sqrt(otherLen / Math.max(1, query.length)),
    );

  // 2. Scaffolding-dominated.
  if (top.score >= sig) {
    // The committed points of attention ARE the shared climb's roots (same
    // query, same k, same DF mode) — read them from Precomputed instead of
    // re-climbing, so even a traced response pays for the climb once.
    const forest = (await pre.attention()).roots;
    // TRUST THE ANCHOR ON ITS BREADTH, NOT ON ITS ABSOLUTE VOTE.
    //
    // This gate read `forest[0].vote >= consensusFloor(N)`.  Attention.breadth's
    // own contract (types.ts) says why that is the wrong quantity: the IDF vote
    // is "an absolute, ln(N)-scaled quantity that means 'strong' on a small
    // store and 'weak' on a large one for the SAME degree of genuine
    // consensus", while breadth is the SCALE-INVARIANT reading — "a point whose
    // breadth clears `dominates` (> half the query's regions corroborate it) is
    // real consensus; one that does not is a coincidental single-region echo".
    // Attention.peak's contract makes the same point from the other side:
    // comparing a POOLED SUM against a floor that prices ONE region's evidence
    // is a dimensional error.
    //
    // Measured on the 15.7M-node store (N=325,615, so the old floor was 13.19).
    // The absolute vote cannot separate right from wrong at this scale, and the
    // proof is a probe that must stay SILENT:
    //
    //   anchor picked by the climb          vote   breadth  correct?
    //   "What is the chemical formula …"   10.60    0.556   RIGHT
    //   "Qual é a capital de França?"       8.19    0.667   RIGHT
    //   "Who wrote the play Romeo …?"       8.25    0.833   RIGHT
    //   "How do you say "good morning" …"  10.77    0.800   RIGHT
    //   "What is the commercial capital …" 12.69    0.333   Zamunda — MUST be silent
    //   "Menene sunan ginin mafi tsayi …"  12.79    0.214   wrong (Hausa)
    //   "Today is the 5th of March …"      10.36    0.000   wrong
    //
    // Zamunda's junk attractor outvotes every correct anchor, so no vote
    // threshold admits the right ones without admitting fabrication — while
    // breadth > ½ admits exactly the four correct anchors and nothing else.
    // The old floor was simply never cleared on a corpus this large: the tier
    // was dead code here, which is why 12 probes fell through to silence.
    //
    // `dominates(breadth, 1)` is the SAME half-dominance predicate used
    // throughout, applied to the fraction — no new constant, and the bar the
    // breadth contract names.  COST: none; breadth is already computed and
    // carried on every Attention the climb returns.
    //
    // The two readings are ALTERNATIVES, never a substitution.  REPLACING the
    // vote test with the breadth test was tried and broke 7 tests: on a small
    // store ln(N) is low, so the vote bar is the one that legitimately fires
    // there, and — as Attention.clusters' own contract warns — "breadth starves
    // a genuine, evenly-split multi-topic query, since no root in a real N-way
    // split can exceed half the vote" (the two 3.1 two-topic fusion tests are
    // exactly that shape).  Each reading is sufficient on its own evidence: a
    // vote that clears the absolute floor is strong enough wherever the corpus
    // is small enough for that to mean something, and a breadth past ½ is real
    // consensus at any scale.  ORing them keeps every admission the floor
    // already made and adds only the scale-invariant ones it could never see.
    //
    // BREADTH ALSO NEEDS DISCRIMINATIVENESS.  Breadth asks how much of the
    // query corroborates the anchor, never whether the anchor SAYS anything: on
    // a one-context store every region trivially corroborates the only anchor
    // there is, so breadth is 1 while the anchor's IDF is 0 — and test/31 A2
    // ("explain quantum chromodynamics" against a lone cat fact) answered the
    // cat, which is fabrication.  A region's IDF contribution for an anchor
    // reached through c of N contexts is ln(N/c), so requiring it to exceed
    // ln 2 is requiring c·2 < N — the SAME half-dominance reading used
    // everywhere, expressed in the IDF's own units rather than as a new bar.
    // `peak` is that per-region contribution, and reading it here is what
    // Attention.peak's contract asks of a consumer gating on this evidence.
    //
    // AND THE QUERY MUST SAY SOMETHING.  Both readings above price the
    // ANCHOR's evidence; neither asks whether the QUERY discriminates
    // anything.  A query that is entirely corpus-global scaffolding gives the
    // corpus nothing to be held to, and this tier — which exists to serve
    // scaffolding-DOMINATED queries — is exactly where that runs out.
    // Measured on the trained store: "What is the capital " answered "Colombo
    // is the commercial capital of Sri Lanka…" on breadth 0.667 / clusters 1,
    // and every window it spells is a hub ("What":572).  See
    // allWindowsAreScaffolding for the full separation, including the probes
    // this tier serves CORRECTLY, which all retain a discriminating window
    // ("what is the capital of france" → "f fr":248).
    //
    // DISPERSION WAS TRIED HERE FIRST AND FALSIFIED — do not retry it: the
    // fabrication and the no-punctuation robustness probe have the IDENTICAL
    // profile (breadth 0.667, clusters 1), so requiring clusters >= 2 silenced
    // "what is the capital of france" too and cost the battery a probe.
    const minVote = consensusFloor(corpusN(ctx));
    if (
      forest.length > 0 &&
      !allWindowsAreScaffolding(ctx, query) &&
      (forest[0].vote >= minVote ||
        (dominates(forest[0].breadth, 1) && forest[0].peak > Math.LN2))
    ) {
      const g = await project(ctx, forest[0].anchor, queryGist);
      // The anchor cleared the consensus floor, but the floor prices the
      // ANCHOR's evidence, not the projection's: a junk attractor can clear
      // it and project a PIECE OF THE QUERY back at it (the observed
      // "buenos días in English" → "English" fragment).  A projection that
      // is a proper byte-subspan of the query restates part of the question
      // — never an answer (the same principle as `restates` above, extended
      // to fragments).  Genuine anchor groundings — longer than the query,
      // or disjoint from it — pass untouched.
      if (g && !(g.length < query.length && indexOf(query, g, 0) >= 0)) {
        return ground(
          g,
          "scaffolding-dominated query — ground the consensus-climb anchor",
          [[forest[0].start, forest[0].end]],
          CONCEPT,
        );
      }
    }
  }

  // 3. Last resort — the nearest grounded whole-query hit, same gate.
  for (const h of whole) {
    const g = await project(ctx, h.id, queryGist);
    if (g) {
      if (
        fracOfQuery(cosine(queryGist, gistOf(ctx, g)), g.length) >=
          reach
      ) {
        return ground(
          g,
          "last resort: the nearest grounded whole-query hit",
          [],
          STEP,
        );
      }
    }
  }
  // 3b. Corroborated-substitution bridge — refusal-path only (bridge.ts).
  // The WIDE candidate list every past-the-top-k mechanism reads lives on
  // Precomputed (see wideResonance): shared across the whole response, so the
  // exhaustive branch runs at most once whoever first-touches it.
  const wideIds = () => pre.wideResonance();

  // Every gist-based tier has failed; before refusing, align the query
  // byte-for-byte against the trained contexts its own stored windows
  // anchor, accepting mismatches only as corpus-attested, concept-bar
  // substitutions.  A bridged context grounds exactly like any hit —
  // projected through its learnt edges — under the same restated-fragment
  // guard tiers 0b/2 apply.  Costs nothing on any answering path.
  {
    // The resonance hits already ranked above are handed to the bridge as
    // PROPOSED candidates alongside its own anchor climbs: on a corpus this
    // size a W-byte window is far too common for the clamped climb to
    // single out the right trained context, while the whole-query gist
    // already ranked it nearest (observed live: "what is the capital of
    // france" resonating straight to "What is the capital of France?" yet
    // refusing on the reach bar).  Approximate scores propose; the bridge's
    // byte-exact alignment and attestation gates decide.
    //
    // Reuse recall's already-ranked proposals. Never scan every IVF cluster:
    // exact co-occurrence and bounded anchor ascent are the bridge's structural
    // proposal channels, while an exhaustive ANN call made every honest
    // refusal cost hundreds of milliseconds regardless of k.
    const bridged = await substitutionBridge(ctx, query, wideIds);
    if (bridged !== null) {
      const g = await project(ctx, bridged.id, queryGist);
      // A projection contained in a substituted candidate-side span is the
      // substitution RESTATED as if it were knowledge — the exact failure
      // observed live: "Darwin was born in England." bridged to the
      // Einstein fact through " England." → " Germany." and would have
      // voiced "Germany", an answer the substitution itself manufactured.
      // The same principle as the restated-fragment guards above, extended
      // to the bridge's own substitutions.
      const cBytes = ctx.store.bytes(bridged.id);
      const manufactured = g !== null &&
        bridged.subs.some((s) =>
          indexOf(cBytes.subarray(s.cs, s.ce), g!, 0) >= 0
        );
      // THE PREFIX TRAP IS NOT THIS TIER'S TO SPRING.  With no substitutions
      // the claim is "a trained context IS this query, up to filler".  When
      // the query is a STRICT BYTE PREFIX of that context, the claim is false
      // in the one way that matters: the candidate's extra tail is precisely
      // the DISCRIMINATING part, and dismissing it as filler asserts a
      // specification the asker never made.  Measured on a 4,300-fact fixture
      // of "what is the value of <i>?": the query "what is the value of"
      // bridged with subs [] to "what is the value of 0?" and answered "the
      // value of 0 is 0" — one arbitrary pick from 4,300 equally-matching
      // contexts, every one of which fits the query exactly as well.
      //
      // The engine ALREADY has the right machinery for this shape:
      // prefixCompletion runs a few lines below and carries the three guards
      // this tier lacks — unreadable-continuation veto, sub-quantum
      // continuation, and UNIQUENESS (distinct continuations ⇒ refuse), which
      // is exactly what 4,300 competing values must trip.  So this is not a
      // new rule and not a new threshold: it is deferring a prefix decision to
      // the tier that owns it (§2.5, one factored machinery).  Byte-strict on
      // purpose — a candidate differing by case or punctuation ("what is the
      // capital of france" → "What is the capital of France?") is NOT a byte
      // prefix, keeps grounding here, and is unaffected.
      const strictPrefix = g !== null &&
        cBytes.length > query.length &&
        indexOf(cBytes, query, 0) === 0;
      if (
        g !== null && g.length > 0 && !restates(g) && !manufactured &&
        !(bridged.subs.length === 0 && strictPrefix) &&
        !(g.length < query.length && indexOf(query, g, 0) >= 0)
      ) {
        return ground(
          g,
          bridged.subs.length === 0
            ? `identity bridge — a trained context IS this query, up to ` +
              `scaffolding the corpus itself treats as filler`
            : `substitution bridge — a trained context accounts for the ` +
              `query up to ${bridged.subs.length} corroborated ` +
              `substitution(s)`,
          // WHAT THIS GROUNDING EXPLAINS — the spans its alignment covers,
          // matched AND substituted, for BOTH tiers.
          //
          // A corroborated substitution is not a gap in the explanation; it is
          // an explanation the mechanism PAID for, one CONCEPT each in `moves`
          // just below.  Leaving its span unaccounted charges the same act
          // twice — once as a move, once as PASS-per-unexplained-byte — and the
          // second charge is far the larger, so a bridge that matched 28 of 29
          // bytes declared the whole query unexplained and lost to any
          // mechanism with a smaller honest claim.  Measured on test/49's
          // paraphrase: it FOUND the trained fact through two corroborated case
          // substitutions and was outbid 29011 to 1012 by a CAST comparison
          // that voiced the wrong country.
          //
          // This tier DID once report `[]` for the substituted case, against
          // the observation that "pricing the aligned spans outweighed
          // extraction's correct answer in the grounding decider".  That is no
          // longer so and the suite is the witness: with the fold's regions
          // content-defined and the junction tiers no longer consuming each
          // other's candidates, full accounting here passes every test that
          // refutation was recorded for.  Reporting only the LITERALLY matched
          // spans (accounted minus the substituted ones) was also implemented
          // and is a strictly worse reading of the same ladder — it still
          // double-charges, just less.
          //
          // An IDENTITY bridge (zero substitutions) substituted nothing, so
          // there is nothing to be humble about: every accounted byte is a
          // LITERAL match against a trained form, and the query is that form
          // up to scaffolding.  Reporting `[]` for it was actively wrong in
          // two ways — it priced a full explanation at PASS-per-byte so junk
          // outweighed it, and, because the honest-remainder test in think()
          // reads the same spans, it left the whole query "unaccounted" and
          // forced the multi-topic fusion gate open.  Observed live: the
          // correct "What is the process of photosynthesis?" grounding was
          // fused away into an unrelated "Hello! How can I assist you
          // today?" point of attention.
          [...bridged.accounted],
          CONCEPT * bridged.subs.length + STEP,
          false,
          // COMPLETE only for the identity tier: the query IS this trained
          // context, so `g` is that context's own continuation — the whole
          // read-out.  A SUBSTITUTED bridge makes no such claim (it stood a
          // different word in the query's place), so it stays extendable.
          bridged.subs.length === 0,
        );
      }
    }
  }

  // The refusal/echo decision.  The echo returns a stored form's bytes AS
  // the answer — a near-identity claim about the query — and identity-grade
  // decisions are never made on an estimated score ("approximate scores may
  // rank and propose; they may never decide", §6.2): the RaBitQ estimate
  // overshooting the reach bar echoed a WRONG-entity neighbour ("capital of
  // Zamunda?" echoed the Armenia fact, observed).  The bytes are read
  // anyway to be echoed, so the decision uses their EXACT fold: one river
  // fold of the top hit, measured in the same query-relative,
  // chance-corrected units as the tier above.
  const topBytes = read(ctx, top.id);
  const exact = topBytes.length > 0
    ? cosine(queryGist, gistOf(ctx, topBytes))
    : 0;
  if (fracOfQuery(exact, topBytes.length) < reach) {
    return ground(
      null,
      "below reach threshold — nothing in the store relates to this query",
      [],
      0,
    );
  }
  // Echoing the query's own bytes back at it is not an echo of a RELATED
  // form — it is the query restated, which answers nothing.
  if (restates(topBytes)) {
    return ground(
      null,
      "the nearest form IS the query itself — restating it answers nothing",
      [],
      0,
    );
  }
  // Honest echo.
  return ground(
    topBytes,
    "last resort: the nearest resonant form's own bytes (echo, not grounded)",
    [],
    0,
    true,
  );
}

// ── Pipeline mechanism ──────────────────────────────────────────────────────

export const recallMechanism: PipelineMechanism = {
  name: "recall",
  provenance: "recall",
  // Recall's floor is free to state (one STEP-grade projection) and its run
  // gates its own tiers — no expensive investment happens inside floor, so
  // there is nothing to guard with worthRunning here: the pipeline's own
  // check prunes run() against the incumbent.
  async floor(_ctx, _query, _pre, _worthRunning) {
    return STEP;
  },
  async run(ctx, query, pre) {
    const r = await recallByResonance(ctx, query, pre);
    if (!r) return [];
    return [{
      bytes: r.bytes,
      accounted: r.accounted,
      moves: r.moves,
      unexplained: r.unexplained,
      provenance: r.echoed ? "recall-echo" : "recall",
      ...(r.complete ? { complete: true } : {}),
    }];
  },
};
