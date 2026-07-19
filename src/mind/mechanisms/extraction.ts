// extraction.ts — Extraction (Skill) — Section 4 of the mind.
//
// Given a query and its consensus-ranked anchors, find the first span-shaped
// skill exemplar among the ranked anchors and read the analogous span of the
// query.  A skill exemplar is a learnt fact whose context and answer together
// form a span-in-context pattern: the answer is a subsequence of the context
// (or one of its pieces is), and the context is the smallest spanning frame
// that contains it.

import type { Vec } from "../../vec.js";
import type { MindContext } from "../types.js";
import type { Site } from "../graph-search.js";
import { foldTree, gistOf, perceive, read, resolve } from "../primitives.js";
import { follow, locate } from "../match.js";
import { chooseAmong, hubBound } from "../traverse.js";
import { concatBytes, indexOf } from "../../bytes.js";
import { decodeText, unexplainedLabel } from "../rationale.js";
import type {
  PipelineMechanism,
  Precomputed,
  SkillInfo,
} from "../pipeline-mechanism.js";
import { CONCEPT, STEP } from "../graph-search.js";
import { rItem, rNode, traceFail } from "../trace.js";

// ── Extraction ────────────────────────────────────────────────────────────

/** Find the first span-shaped skill exemplar among the ranked anchors from
 *  climbAttentionAll and read the analogous span from the query.  Returns
 *  the extracted bytes PLUS the query spans the skill ACCOUNTED FOR — the
 *  located frames AND any read span BOUNDED by located frames on both
 *  sides, the elementary evidence think's grounding decider weighs.  A
 *  bounded read is explained: the skill located both its borders in the
 *  query and emitted exactly what sits between them.  An OPEN-ENDED read
 *  (the exemplar's answer reaches the context's end, so the query is read
 *  to its own end with no located right border) remains a guess about where
 *  the span stops — it stays unaccounted, priced by exclusion like the
 *  cover's bridged bytes.  (Accounting frames only — the earlier convention
 *  — let a CAST juxtaposition that merely echoed the query's exact site
 *  outweigh a correct bounded extraction: the same span counted as
 *  explained for one mechanism and not the other, and the asymmetry, not
 *  the answers' merits, decided the grounding.)  Null when no skill
 *  applies. */
export async function extractBySkill(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
): Promise<
  {
    bytes: Uint8Array;
    accounted: Array<[number, number]>;
    unexplained: string;
  } | null
> {
  const t = ctx.trace?.enter("extractBySkill", [
    rItem(query, "query"),
  ]);
  const fail = traceFail(t);
  // Use climbAttentionAll to get the FULL ranked list, not just the
  // roots that cleared commitVotes' significance floor.  The floor
  // gates further points of attention for fusion, but extraction only
  // needs ONE anchor that IS a span-shaped skill exemplar — and on
  // some seeds the top-voted anchor is not one (e.g. a concept-merge
  // nickname outvotes the painting exemplars on shared substrings,
  // while the exemplars' votes fall below the floor).  Iterating the
  // ranked list instead of just the roots lets extraction reach the
  // first painting-exemplar anchor regardless of its floor status.
  //
  const { ranked } = await pre.attention();
  if (ranked.length === 0) {
    return fail("no consensus anchor — no skill to apply");
  }

  // Try ranked anchors IN ORDER until one yields a USABLE extraction — not
  // merely a span-shaped exemplar, but one whose extracted span clears the
  // same one-river-fold quantum (W) cover.ts's restatedSpan gate already
  // treats as the floor below which byte overlap is chance, not evidence.
  // isSpanShaped (spanShapedOf) is a deliberately permissive sparse-
  // subsequence check — see the section note below — so it accepts exemplars
  // whose relation to the query is coincidental gap-matching, not genuine
  // structure.  Stopping at the FIRST such exemplar let a coincidental match
  // early in the ranked list win outright and read out a sub-quantum
  // fragment (observed: a 3-byte "Hel" pulled from an unrelated exemplar,
  // while a later ranked anchor would have read the query's own "Hello…"
  // correctly).  Trying further anchors when one produces nothing usable is
  // the same idiom this loop already uses for non-exemplars — extended to
  // cover a bad extraction, not just a structural non-match.
  //
  // The retry is bounded at pre.k — the SAME evidence-breadth constant every
  // other consumer of a ranked list already self-limits to (resonance, the
  // weave, the climb itself; see Precomputed.k's own doc comment) — not the
  // full ranked list.  locate()'s frame match has an EXACT-byte tier with no
  // significance correction of its own (short W-byte frames are cheap to
  // match by pure chance), so trying every ranked anchor turns that per-
  // anchor chance into a near-certainty over enough attempts: on a pure-
  // gibberish query, 170 anchors deep found an unrelated Zulu exemplar whose
  // short frame happened to byte-match, producing "xyzzy pl" — a coincidence
  // no different in kind from the "RaBitQ estimate overshot the reach bar
  // and grounded pure gibberish" failure recall.ts's own significance
  // correction exists to prevent (see recallByResonance's reach-threshold
  // comment).  Bounding the search to the ranked list's own top-k restores
  // the "genuinely relevant but not root-significant" exemplars this loop
  // was built for, without the unbounded tail's chance collisions.
  const W = ctx.space.maxGroup;
  const searched = ranked.slice(0, pre.k);
  let shapeMisses = 0;
  let subQuantum = 0;
  for (const cand of searched) {
    const exemplar = await pre.spanShapedOf(cand.anchor);
    if (!exemplar) {
      shapeMisses++;
      continue;
    }
    const built = buildFromExemplar(ctx, query, pre, exemplar);
    if (built === null || built.bytes.length < W) {
      subQuantum++;
      continue;
    }
    if (shapeMisses > 0 || subQuantum > 0) {
      ctx.trace?.step(
        "trySkillAnchors",
        [
          rItem(
            query.subarray(0, 0),
            `skipped ${shapeMisses + subQuantum}`,
          ),
          rNode(ctx, cand.anchor, "chosen"),
        ],
        [],
        `skipped ${shapeMisses} non-exemplar and ${subQuantum} sub-quantum ` +
          `anchor(s) before one yielded a usable extraction`,
      );
    }
    t?.done(
      [rItem(built.bytes, "extracted")],
      built.pieces === 1
        ? `apply a learnt extraction skill — read the analogous span of the query` +
          ` framed like "${
            decodeText(exemplar.answerBytes)
          }" sits in its exemplar`
        : `apply a learnt MULTI-PIECE skill — read ${built.pieces} analogous` +
          ` pieces of the query and synthesize them like "${
            decodeText(exemplar.answerBytes)
          }"`,
    );
    return {
      bytes: built.bytes,
      accounted: built.accounted,
      unexplained: unexplainedLabel(query, built.accounted),
    };
  }
  if (shapeMisses === searched.length) {
    ctx.trace?.step(
      "trySkillAnchors",
      [],
      [],
      `none of the top ${searched.length} ranked anchor(s) (of ${ranked.length} total) ` +
        `is a span-shaped skill exemplar`,
    );
    return fail("no consensus root is a span-shaped skill exemplar");
  }
  return fail(
    "no ranked anchor yielded an extraction at or above the quantum floor",
  );
}

/** Build the extracted bytes for ONE already-accepted span-shaped exemplar —
 *  factored out of {@link extractBySkill} so its anchor loop can try
 *  successive ranked candidates instead of committing to the first
 *  structural match.  Null when the exemplar's answer does not decompose
 *  against its context, or no piece's frame locates in the query. */
function buildFromExemplar(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
  exemplar: SkillInfo,
):
  | { bytes: Uint8Array; accounted: Array<[number, number]>; pieces: number }
  | null {
  const { contextBytes, answerBytes } = exemplar;

  const ansCtxRuns = answerRunsInContext(ctx, contextBytes, answerBytes);
  if (ansCtxRuns === null || ansCtxRuns.length === 0) {
    return null;
  }

  if (ansCtxRuns.length > 1) {
    ctx.trace?.step(
      "decomposeAnswer",
      [rItem(answerBytes, "multi-piece-answer")],
      ansCtxRuns.map((r) =>
        rItem(contextBytes.subarray(r.start, r.end), "piece", undefined, [
          r.start,
          r.end,
        ])
      ),
      `answer splits into ${ansCtxRuns.length} piece(s) within the exemplar context`,
    );
  }

  const pieces: Uint8Array[] = [];
  const accounted: Array<[number, number]> = [];
  for (let ri = 0; ri < ansCtxRuns.length; ri++) {
    const run = ansCtxRuns[ri];
    const isLast = ri === ansCtxRuns.length - 1;

    const framePreLen = Math.min(run.start, ctx.space.maxGroup);
    const framePre = run.start > 0
      ? contextBytes.subarray(run.start - framePreLen, run.start)
      : null;

    const frames: Array<[number, number]> = [];
    let start = 0;
    if (framePre) {
      const prePos = locate(ctx, query, framePre, 0, pre.rec.sites);
      if (prePos < 0) continue;
      start = prePos + framePre.length;
      frames.push([prePos, start]); // the located frame IS matched evidence
    }

    let end: number;
    if (isLast) {
      if (run.end < contextBytes.length) {
        const framePostLen = Math.min(
          contextBytes.length - run.end,
          ctx.space.maxGroup,
        );
        const framePost = contextBytes.subarray(
          run.end,
          run.end + framePostLen,
        );
        const postPos = locate(
          ctx,
          query.subarray(start),
          framePost,
          0,
          pre.rec.sites,
        );
        if (postPos < 0) continue;
        end = start + postPos;
        frames.push([end, end + framePost.length]); // matched post-frame
      } else {
        end = query.length;
      }
    } else {
      const nextRun = ansCtxRuns[ri + 1];
      const nextPreLen = Math.min(nextRun.start, ctx.space.maxGroup);
      const nextPre = contextBytes.subarray(
        nextRun.start - nextPreLen,
        nextRun.start,
      );
      const nextPos = locate(
        ctx,
        query.subarray(start),
        nextPre,
        0,
        pre.rec.sites,
      );
      if (nextPos < 0) {
        end = start + run.ansLen;
      } else {
        end = start + nextPos;
        frames.push([end, end + nextPre.length]); // matched next-frame
      }
    }
    if (start >= end) continue;
    pieces.push(query.subarray(start, end));
    accounted.push(...frames);
    // Bounded on both sides ⇒ the read span itself is explained (see doc).
    // frames carries the pre-border (when the answer is not at the context's
    // start) and the located right border (post-frame or next piece's
    // pre-frame); only when BOTH borders were located is the read bounded.
    const preBounded = run.start === 0 || frames.some(([, e]) => e === start);
    const postBounded = frames.some(([b]) => b === end);
    if (preBounded && postBounded) accounted.push([start, end]);
  }
  if (pieces.length === 0) {
    return null;
  }

  const out = pieces.length === 1 ? pieces[0] : concatBytes(pieces);
  return { bytes: out, accounted, pieces: pieces.length };
}

// ── The two span-shape readings: OPEN acceptance vs. STRONG decomposition ──
//
// isSpanShaped and answerRunsInContext read the SAME relation ("the answer is
// drawn from the context") at two deliberately different strengths, and they
// are NOT interchangeable:
//
//   • isSpanShaped — the OPEN reading: any in-order embedding (a sparse
//     subsequence, arbitrary gaps).  O(|context|) byte scan.  Used to ACCEPT
//     an exemplar candidate.
//   • answerRunsInContext — the STRONG reading: a greedy longest-run
//     DECOMPOSITION into contiguous pieces.  Greedy-longest is strictly
//     stronger than subsequence (a long late match can consume context an
//     earlier shorter choice needed), so an ACCEPTED exemplar can still fail
//     to decompose — extractBySkill then fails with "answer is not a
//     subsequence of the context" and think falls through to recall.  That
//     fall-through is BEHAVIOUR, pinned by the extraction suites: do not
//     "unify" the two into one machine — replacing the open reading with the
//     strong one silently rejects exemplars extraction today accepts, and
//     replacing the strong one with a backtracking embedding changes which
//     pieces are read out of the query.

/** Decompose an answer into substrings of its surrounding context, in order —
 *  the STRONG span-shape reading (see the section note above).  Returns null
 *  when no greedy longest-run decomposition exists.  Adjacent runs that
 *  connect contiguously are merged. */
export function answerRunsInContext(
  _ctx: MindContext,
  context: Uint8Array,
  answer: Uint8Array,
): Array<{ start: number; end: number; ansLen: number }> | null {
  const pos = indexOf(context, answer, 0);
  if (pos >= 0) {
    return [{ start: pos, end: pos + answer.length, ansLen: answer.length }];
  }

  const runs: Array<
    { start: number; end: number; ansLen: number }
  > = [];
  let ai = 0;
  let ci = 0;
  while (ai < answer.length) {
    // Longest match of the remaining answer at any position of the remaining
    // context: one direct extend per context position — O(|ctx|·match) per
    // run, replacing the previous longest-first indexOf countdown whose
    // repeated scans were cubic on long sparse-subsequence answers.
    let bestLen = 0;
    let bestPos = -1;
    for (let p = ci; p < context.length; p++) {
      let l = 0;
      const maxL = Math.min(context.length - p, answer.length - ai);
      if (maxL <= bestLen) break; // no later position can beat the best
      while (l < maxL && context[p + l] === answer[ai + l]) l++;
      if (l > bestLen) {
        bestLen = l;
        bestPos = p;
        if (ai + l === answer.length) break; // the whole remainder matched
      }
    }
    if (bestLen === 0) return null;
    runs.push({ start: bestPos, end: bestPos + bestLen, ansLen: bestLen });
    ai += bestLen;
    ci = bestPos + bestLen;
  }
  const merged: Array<{ start: number; end: number; ansLen: number }> = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.start === last.end) {
      last.end = r.end;
      last.ansLen += r.ansLen;
    } else {
      merged.push({ ...r });
    }
  }
  return merged.length > 0 ? merged : null;
}

/** Check whether an anchor is a span-shaped skill exemplar: it represents a
 *  fact whose context and answer together form a span-in-context pattern.
 *  If the anchor has a nextOf continuation, that is the answer and the anchor
 *  itself is the context.  Otherwise the anchor's prevOf parents provide
 *  candidate contexts, and the longest one whose span is span-shaped wins. */
export async function skillExemplar(
  ctx: MindContext,
  anchor: number,
  guide?: Vec | null,
): Promise<{ contextBytes: Uint8Array; answerBytes: Uint8Array } | null> {
  if (ctx.store.hasNext(anchor)) {
    const contextBytes = read(ctx, anchor);
    const answerBytes = await follow(ctx, anchor, guide);
    if (
      answerBytes !== null && isSpanShaped(ctx, contextBytes, answerBytes)
    ) {
      return { contextBytes, answerBytes };
    }
    return null;
  }
  const answerBytes = read(ctx, anchor);
  // Candidate contexts, capped at the hub bound (a common answer's reverse
  // fan-in is corpus-sized).
  const capped = ctx.store.prevFirst(anchor, hubBound(ctx));
  const spanShaped: Array<{ id: number; bytes: Uint8Array }> = [];
  for (const p of capped) {
    const ctxB = read(ctx, p);
    if (ctxB.length > 0 && isSpanShaped(ctx, ctxB, answerBytes)) {
      spanShaped.push({ id: p, bytes: ctxB });
    }
  }
  if (spanShaped.length === 0) return null;
  // Among span-shaped contexts, the longest wins (the smallest spanning frame
  // heuristic's dual: more frame to locate in the query); the query gist,
  // when given, breaks LENGTH TIES via chooseAmong — the same reverse-regime
  // disambiguator every context pick uses, whose gist cache spares the
  // re-fold this block once paid per tied candidate.  Same strict first-seen
  // tie-break as the hand loop it replaces.
  const maxLen = Math.max(...spanShaped.map((s) => s.bytes.length));
  const longest = spanShaped.filter((s) => s.bytes.length === maxLen);
  let contextBytes = longest[0].bytes;
  if (guide && longest.length > 1) {
    const pick = chooseAmong(ctx, longest.map((s) => s.id), guide).id;
    contextBytes = longest.find((s) => s.id === pick)!.bytes;
  }
  return { contextBytes, answerBytes };
}

/** Whether the answer is a SPARSE subsequence of the context (bytes in
 *  order, arbitrary gaps) — the OPEN span-shape reading (see the section
 *  note above).  This is what lets extraction validate a MULTI-PIECE
 *  exemplar whose answer is stitched from several context runs — but it is
 *  deliberately permissive, so it must never be used as evidence that one
 *  span was "drawn from" another (see {@link containsSpan} for that).
 *
 *  There is deliberately NO containsSpan pre-check here: strict containment
 *  IMPLIES the subsequence embedding (a contiguous run, or a resolved node —
 *  whose content-addressed identity means its bytes occur contiguously — is
 *  an in-order embedding with zero gaps), so the scan below decides alone,
 *  with the same truth value.  The old pre-check re-perceived the context
 *  (a full river fold) per CANDIDATE in skillExemplar's √N-capped loop —
 *  pure cost, no discrimination. */
export function isSpanShaped(
  _ctx: MindContext,
  context: Uint8Array,
  answer: Uint8Array,
): boolean {
  let ai = 0;
  for (let ci = 0; ci < context.length && ai < answer.length; ci++) {
    if (context[ci] === answer[ai]) ai++;
  }
  return ai === answer.length;
}

/** STRICT containment: the answer's resolved node appears in the context's
 *  folded tree, or the answer occurs as one CONTIGUOUS byte run of the
 *  context.  This is real evidence the answer was drawn from the context.
 *  Fusion gates on this — the sparse-subsequence reading of
 *  {@link isSpanShaped} is trivially satisfied by short answers over long
 *  queries ("cold" is a gap-tolerant subsequence of most sentences holding
 *  c…o…l…d in order), and gating fusion on it silently starved multi-topic
 *  queries of their further points of attention. */
export function containsSpan(
  ctx: MindContext,
  context: Uint8Array,
  answer: Uint8Array,
): boolean {
  const ansId = resolve(ctx, answer);
  if (ansId !== null) {
    let found = false;
    foldTree(ctx, perceive(ctx, context), 0, (_n, _s, _e, node) => {
      if (node === ansId) found = true;
    });
    if (found) return true;
  }
  return indexOf(context, answer, 0) >= 0;
}

// ── Pipeline mechanism ──────────────────────────────────────────────────────

export const extractionMechanism: PipelineMechanism = {
  name: "extraction",
  provenance: "extract",
  async floor(_ctx, _query, pre, worthRunning) {
    // Extraction's floor is always exactly CONCEPT+STEP when it exists —
    // same investment discipline as CAST's (see cast.ts): when the bound
    // already cannot beat the incumbent, return it UNINVESTED (never
    // first-touch the climb just to be pruned).
    if (!worthRunning(CONCEPT + STEP)) return CONCEPT + STEP;
    if ((await pre.attention()).ranked.length === 0) return null;
    return CONCEPT + STEP;
  },
  async run(ctx, query, pre) {
    const ex = await extractBySkill(ctx, query, pre);
    if (!ex) return [];
    return [{
      bytes: ex.bytes,
      accounted: ex.accounted,
      moves: CONCEPT + STEP * ex.accounted.length,
      unexplained: ex.unexplained,
    }];
  },
};
