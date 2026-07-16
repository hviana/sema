// attention.ts — Consensus climb / attention pipeline (Section 4 of the mind).
//
// Every region of the query's perceived tree casts a resonance vote for the
// context (learnt fact) it best climbs to.  Votes are pooled through the very
// deduction engine (lightestDerivation) that GraphSearch covers with — so a
// pooled-evidence decision is one weighted rule of the SAME deduction system,
// not a hand-rolled tally.  The result is one or more independent points of
// attention for the rest of the pipeline to follow.
import { isChunk } from "../sema.js";
import { lightestDerivation } from "../derive/src/index.js";
import { consensusFloor, dominates, estimatorNoise } from "../geometry.js";
import { foldTree, gistOf, perceive, read } from "./primitives.js";
import { recognise } from "./recognition.js";
import { leafIdRun } from "./canonical.js";
import { corpusN, edgeAncestors } from "./traverse.js";
import {
  cachedRead,
  junctionContainersFrom,
  junctionSeeds,
  junctionSynonyms,
  walkCache,
} from "./junction.js";
import { indexOf } from "../bytes.js";
import { rNode, traceDerivation } from "./trace.js";
// ── Public entry points ───────────────────────────────────────────────────
/** Climb the query's perceived byte regions up the structural DAG via
 *  resonance, pool the evidence, and return only the ROOT points of
 *  attention — those that cleared commitVotes' significance floor. */
export async function climbAttention(ctx, query, k, mode = "inverse") {
  return (await climbAttentionAll(ctx, query, k, mode)).roots;
}
/** Full read-out of one consensus climb: both the roots (dominant points of
 *  attention) and the entire ranked list.  Cached via ctx.climbMemo when
 *  ctx.trace is null. */
export async function climbAttentionAll(ctx, query, k, mode = "inverse") {
  if (ctx.climbMemo && !ctx.trace) {
    const key = `${k}:${mode}`;
    let byRead = ctx.climbMemo.get(query);
    if (byRead === undefined) {
      ctx.climbMemo.set(query, byRead = new Map());
    }
    const hit = byRead.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const read = await computeAttention(ctx, query, k, mode);
    byRead.set(key, read);
    return read;
  }
  return computeAttention(ctx, query, k, mode);
}
// ── Pipeline ──────────────────────────────────────────────────────────────
export async function computeAttention(ctx, query, k, mode) {
  const regions = collectRegions(ctx, query);
  // Recognised sites carry structural evidence that perceived sub-regions
  // miss: a word crossing a W-boundary is split into chunks whose partial
  // gists may not resonate distinctively, but the SITE (content-addressed,
  // exact) names the whole form.  Adding sites as climb regions lets the
  // consensus vote with the full word, at zero cost — recognition is already
  // memoised per response (ctx.recogniseMemo), and gistOf for short sites is
  // O(|span|·D).  Sites that overlap perceived regions add corroborating
  // evidence; sites in gaps (like cross-boundary words) fill them.
  const rec = recognise(ctx, query);
  for (const s of rec.sites) {
    regions.push({
      v: gistOf(ctx, query.subarray(s.start, s.end)),
      start: s.start,
      end: s.end,
      chunk: false,
      known: true, // a recognised site IS a stored form
    });
  }
  if (regions.length === 0) {
    return { roots: [], ranked: [] };
  }
  const N = corpusN(ctx);
  // One climb per distinct anchor for the WHOLE query: regions sharing a
  // chunk, and canonicalChunkId's prefix probes, all hit this memo instead of
  // re-reading the anchor's full edge fan-out from the store.
  const reachMemo = new Map();
  const rvs = await voteRegions(ctx, query, regions, k, mode, N, reachMemo);
  // ── Cross-region: DIRECT region-to-region interaction ─────────────────
  // Two regions whose individual climbs land on DIFFERENT contexts leave
  // their JOINT context — the learnt whole that contains BOTH — with no
  // vote.  crossRegionVotes recovers it by the bridge's content-addressed
  // junction ascent (see the note above the function).
  const cross = await crossRegionVotes(
    ctx,
    query,
    regions,
    rvs,
    k,
    N,
    reachMemo,
  );
  // A vote SUPERSEDED by exact joint evidence (its bytes literally live
  // inside the joint container, yet it climbed elsewhere — grid aliasing)
  // is dropped, not down-weighted: the joint container explains it away.
  const allVotes = cross.votes.length > 0
    ? [
      ...rvs.votes.filter((v) => !cross.superseded.has(v)),
      ...cross.votes,
    ]
    : rvs.votes;
  // ──────────────────────────────────────────────────────────────────────
  if (allVotes.length === 0) {
    traceAttention(ctx, regions, rvs.voters, []);
    return { roots: [], ranked: [] };
  }
  const sat = detectSaturated(ctx, regions, rvs.saturated);
  const pooled = poolVotes(ctx, allVotes, sat, N);
  return commitVotes(ctx, pooled, sat, regions, rvs.voters, N);
}
export function collectRegions(ctx, query) {
  const regions = [];
  // A region that DOMINATES the query (covers more than half — the shared
  // {@link dominates} test liftAnswer uses for a span that swallows its
  // surroundings) can never itself discriminate between several topics the
  // query weaves; voting with it only when it is the sole structure (no
  // narrower region exists) keeps a flat/short query's single point of
  // attention intact without letting a broad, non-discriminative wrapper
  // dilute a multi-topic query's vote or masquerade as a genuine second
  // point of attention.
  // foldTree (not walkTree): the same post-order walk, but each node also
  // resolves content-addressed against the store — `known` is what lets the
  // climb keep exact evidence at full weight while margin-damping the
  // approximate kind (see voteRegions).  One findLeaf/findBranch per tree
  // node, the same lookups a deposit pays.
  foldTree(ctx, perceive(ctx, query), 0, (n, start, end, node) => {
    if (n.kids === null) {
      return;
    }
    if (!dominates(end - start, query.length) || regions.length === 0) {
      regions.push({
        v: n.v,
        start,
        end,
        chunk: isChunk(n),
        known: node !== null,
      });
    }
  });
  return regions;
}
export async function voteRegions(ctx, query, regions, k, mode, N, reachMemo) {
  const regionSaturated = new Array(regions.length).fill(false);
  const regionVotes = [];
  const regionVoter = ctx.trace ? regions.map(() => null) : [];
  for (let ri = 0; ri < regions.length; ri++) {
    const { v, start, end, chunk, known } = regions[ri];
    // EXACT-FIRST: a chunk whose canonical anchor is content-addressed needs
    // no estimator — identity is exact, so its score is 1 BY DEFINITION (the
    // estimated cosine of a form with itself, minus quantisation noise, and
    // the caveat atop geometry.ts forbids trusting the estimate over the
    // exact resolution anyway).  The ANN query is deferred behind
    // `ensureHits` and paid only when actually consulted: the orphan
    // fallback, the contrastive margin (approximate regions only), or a
    // region with no usable canonical.  On chunk-heavy queries this removes
    // the resonate() call for most exact regions — the single largest
    // remaining inference sink — with the anchor choice unchanged (the
    // canonical branch already ignored hits[0]).
    const canonicalId = chunk
      ? canonicalChunkId(ctx, query.subarray(start, end), N, reachMemo)
      : null;
    const canonicalUsable = canonicalId !== null &&
      (ctx.store.hasParents(canonicalId) ||
        ctx.store.hasContainers(canonicalId));
    let hits = null;
    const ensureHits = async () => hits ??= await ctx.store.resonate(v, k);
    const canonicalFailed = chunk && canonicalId === null;
    let voterId;
    let score;
    let scoreId; // the node the score was measured against
    if (canonicalUsable) {
      voterId = canonicalId;
      score = 1;
      scoreId = canonicalId;
    } else {
      const h = await ensureHits();
      if (h.length === 0) {
        continue;
      }
      voterId = h[0].id;
      score = h[0].score;
      scoreId = h[0].id;
    }
    let reach = edgeAncestors(ctx, voterId, N, reachMemo);
    // A region's vote must not die with the TOP hit: `hits[1..k]` were
    // already fetched, and the top-ranked anchor being a structural orphan
    // (no edge-bearing ancestors) is an accident of the approximate ranking,
    // not evidence the region relates to nothing.  Walk the remaining hits —
    // nearest first, climbs memoised — until one climbs.  A SATURATED reach
    // is not an orphan: it is a deliberate abstention, kept as-is.
    if (reach.roots.length === 0 && !reach.saturated) {
      for (const h of await ensureHits()) {
        if (h.id === voterId) {
          continue;
        }
        const r2 = edgeAncestors(ctx, h.id, N, reachMemo);
        if (r2.saturated || r2.roots.length > 0) {
          ctx.trace?.step(
            "anchorFallback",
            [rNode(ctx, voterId, "orphan-anchor", score)],
            [rNode(ctx, h.id, "anchor", h.score)],
            "the top-ranked anchor climbs to no context — a lower-ranked hit votes instead",
          );
          reach = r2;
          voterId = h.id;
          score = h.score;
          scoreId = h.id;
          break;
        }
      }
    } else if (!canonicalUsable && reach.saturated) {
      // TIE-BAND saturation fallback.  A saturated top hit abstains the whole
      // region (a hub's reach concludes nothing) — but the hub may only CLAIM
      // that abstention when it is DISTINGUISHABLY the nearest anchor.  The
      // resonance ranking is an estimate: the difference between two scores
      // against the same query carries √2× the estimator's per-score error,
      // ≈ 1/√D ({@link estimatorNoise}) — so any hit within that band of the
      // top is the SAME rank at measurement resolution, and letting the hub
      // win the tie decides the region by quantisation accident (observed:
      // a 0.1σ rank inversion flipped a pinned behaviour when the query
      // estimator sharpened from 4 to 8 bits).  Walk the tied hits, nearest
      // first; the first that climbs somewhere non-saturated votes for the
      // region.  Beyond the band the hub is genuinely nearest and its
      // abstention stands.  A KNOWN (content-addressed) region never enters:
      // its anchor is exact, not an estimate.
      const band = estimatorNoise(ctx.store.D);
      for (const h of await ensureHits()) {
        if (h.id === voterId) {
          continue;
        }
        if (h.score < score - band) {
          break; // hits are nearest-first
        }
        const r2 = edgeAncestors(ctx, h.id, N, reachMemo);
        if (!r2.saturated && r2.roots.length > 0) {
          ctx.trace?.step(
            "anchorFallback",
            [rNode(ctx, voterId, "saturated-anchor", score)],
            [rNode(ctx, h.id, "anchor", h.score)],
            "the top-ranked anchor is a saturated hub tied within estimator noise — the tied hit votes instead",
          );
          reach = r2;
          voterId = h.id;
          score = h.score;
          scoreId = h.id;
          break;
        }
      }
    }
    regionSaturated[ri] = reach.saturated;
    if (reach.roots.length === 0) {
      continue;
    }
    if (reach.saturated) {
      continue;
    }
    // One IDF per region — dfWeight() and the focus weight used to compute
    // the same logarithm independently.
    const idf = Math.log(N / Math.max(1, reach.contextsReached));
    const df = Math.log(1 + reach.contextsReached);
    const wf = mode === "direct" ? df : mode === "combined" ? idf + df : idf;
    if (wf <= 0) {
      continue;
    }
    // CONTRASTIVE-MARGIN GATE — the compensation the linear (byte-proportional)
    // fold demands, applied to APPROXIMATE evidence only.  Under the linear
    // fold a resonance score reads "fraction of aligned shared bytes", so a
    // NOVEL span sharing a frame with several stored exemplars scores high
    // against each of them without being evidence of ANY of them: the shared
    // scaffolding, not the span's own content, carries the similarity.  Such a
    // frame region resonates ~equally to every framed exemplar, so its top hit
    // barely beats the best DIFFERENT-conclusion rival (a different climb
    // root-set) — its discriminative margin, score MINUS that rival, collapses
    // toward zero.  A region votes only when that margin clears the estimator's
    // own noise floor (1/√D — see {@link estimatorNoise}); below it the margin
    // is quantisation noise, not evidence.  A KNOWN region (content-addressed,
    // exact) skips the contrast: it IS learnt content, not an approximation.
    //
    // The margin GATES; it does NOT scale the weight.  A surviving region votes
    // at its genuine strength (score²·wf) — the SAME scale {@link
    // consensusFloor} is derived for.  Using the margin as a MULTIPLIER
    // (score·margin) conflated "discriminative" with "strong": a genuinely
    // discriminative span whose frame-rival happened to score close got a tiny
    // vote, systematically compressing correct scaffolding-dominated groundings
    // (reordered / paraphrased queries) below the floor so they grounded
    // nothing.  Gating at the noise floor keeps frame-echo suppression (a frame
    // region's margin ≈ 0 is gated out) without penalising honest evidence.
    if (!known) {
      let margin = score;
      for (const h of await ensureHits()) {
        if (h.id === voterId) {
          continue;
        }
        const r2 = edgeAncestors(ctx, h.id, N, reachMemo);
        if (r2.saturated || r2.roots.length === 0) {
          continue; // concludes nothing
        }
        if (sameRoots(r2.roots, reach.roots)) {
          continue; // same conclusion
        }
        margin = score - h.score; // hits are nearest-first: the best rival
        break;
      }
      if (margin <= estimatorNoise(ctx.store.D)) {
        continue;
      }
    }
    // MUTUAL-EXPLANATION WEIGHT (angle + magnitude).  Under the linear fold
    // cos = shared/(‖r‖·‖h‖) with ‖·‖² = content bytes, so the old score²
    // was already — implicitly — (shared/len_r)·(shared/len_h): the fraction
    // of the REGION the hit explains times the fraction of the HIT the
    // region pins down.  Made explicit, each factor is computed from the two
    // magnitudes (the region's own span; the hit's, read from the store —
    // contentLen, √bytes being the linear fold's gist norm) and CAPPED at 1:
    // the estimated cosine can imply more shared content than the smaller
    // side even holds, and the uncapped square silently credited that
    // impossible surplus — a small region echoing inside a large context, or
    // the reverse, voted above its physical evidence.  In the uncapped
    // regime this is exactly score², the scale {@link consensusFloor} is
    // derived for.  (The margin gate above deliberately stays in raw cosine
    // units: it tests the ESTIMATOR's noise floor, which lives in cosine
    // space; converting each side by its own hit's magnitude would compare
    // noise floors of different scales.)
    const lenR = Math.max(1, end - start);
    // Cap the magnitude read at lenR·D: past it s/ratio ≤ s/√D — below the
    // estimator's own noise floor — so the mutual weight is ~0 regardless
    // and the clamped value yields exactly that; no full walk of a huge hit.
    const ratio = Math.sqrt(
      Math.max(1, ctx.store.contentLen(scoreId, lenR * ctx.store.D)) / lenR,
    );
    const mutual = Math.min(1, score * ratio) * Math.min(1, score / ratio);
    const w = (mutual * wf) / reach.roots.length;
    const wFocus = (mutual * idf) / reach.roots.length;
    regionVotes.push({
      start,
      end,
      canonicalFailed,
      roots: reach.roots,
      w,
      wFocus,
    });
    if (ctx.trace) {
      regionVoter[ri] = { id: voterId, score, w: wf };
    }
  }
  return {
    votes: regionVotes,
    saturated: regionSaturated,
    voters: regionVoter,
  };
}
/** The consensus vote as EVIDENCE POOLING, not shortest path: each surviving
 *  region is an axiom; it contributes to every root it climbed to (or, for a
 *  terminal answer node, to the contexts that lead to it) by a `combine:
 *  "sum"` rule, so independent regions corroborating the same anchor ADD
 *  rather than compete to be the cheapest route (see {@link Rule.combine} in
 *  derive/src/deduction.ts).  Run through the very engine {@link
 *  GraphSearch} covers with — `lightestDerivation` — so a pooled-evidence
 *  decision is, like a followed edge or a spliced connector, one weighted
 *  rule of the SAME deduction system, not a separate hand-rolled tally that
 *  merely logs alongside it.  `votesIdf`/`support` are the same two
 *  read-outs {@link commitVotes} always gated on; only how they accumulate
 *  changed. */
export function poolVotes(ctx, regionVotes, sat, N) {
  const eligible = [];
  for (let ri = 0; ri < regionVotes.length; ri++) {
    const rv = regionVotes[ri];
    if (
      rv.canonicalFailed &&
      sat.intervals.some((iv) => rv.start >= iv.start && rv.end <= iv.end)
    ) {
      continue;
    }
    eligible.push(ri);
  }
  const key = (it) =>
    it.kind === "region"
      ? `r${it.ri}`
      : it.kind === "anchor"
      ? `a${it.id}`
      : `x${it.id}`;
  const pool = new Map();
  const system = {
    key,
    *axioms() {
      for (const ri of eligible) {
        yield { item: { kind: "region", ri }, cost: 0 };
      }
    },
    isGoal: () => false, // exhaust every axiom; there is no single goal to stop at
    // Every region axiom ties at cost 0, so the agenda's pop order among them
    // is otherwise unspecified; ordering by `ri` here only steers the HEAP
    // (never added to a stored cost — see relax's use of h) so pooling fires
    // in exactly the regionVotes array order the original loop used, byte-for-
    // byte reproducing its accumulation and tie-break order.
    heuristic: (it) => it.kind === "region" ? it.ri : 0,
    *rules(it) {
      if (it.kind !== "region") {
        return;
      }
      const rv = regionVotes[it.ri];
      // The same hub bound the rest of the system uses (edgeAncestors' parent
      // cutoff, chooseNext's candidate cap): a terminal answer followed by
      // more than √N contexts is a non-discriminative hub — spreading a
      // region's vote across its FULL corpus-sized fan-in yields O(corpus)
      // rule applications per region and near-zero per-target weight anyway.
      // Cap the redistribution at the first √N contexts (insertion order,
      // the same convention chooseNext caps by).
      const hubBound = Math.ceil(Math.sqrt(N));
      for (const r of rv.roots) {
        // CAPPED read: only the first hubBound targets are ever credited, so
        // only they are read — a common continuation's full reverse fan-in
        // is corpus-sized and is never materialised.
        const pv = ctx.store.prevFirst(r, hubBound);
        const isAnswer = pv.length > 0 && !ctx.store.hasNext(r);
        const targets = isAnswer ? pv : [r];
        for (const t of targets) {
          yield {
            premises: [it],
            conclusion: { kind: "anchor", id: t },
            cost: rv.w / targets.length,
            combine: "sum",
          };
          yield {
            premises: [it],
            conclusion: { kind: "anchorFocus", id: t },
            cost: rv.wFocus / targets.length,
            combine: "sum",
          };
        }
      }
    },
    pool,
  };
  lightestDerivation(system);
  const votes = new Map();
  const votesIdf = new Map();
  const support = new Map();
  const steps = [];
  let order = 0;
  for (const pc of pool.values()) {
    if (pc.item.kind === "anchor") {
      votes.set(pc.item.id, pc.cost);
      const premises = [];
      const seenRi = new Set();
      for (const c of pc.contributions) {
        const p0 = c.premises[0].item;
        if (p0.kind !== "region" || seenRi.has(p0.ri)) {
          continue;
        }
        seenRi.add(p0.ri);
        const rv = regionVotes[p0.ri];
        premises.push({ kind: "form", span: [rv.start, rv.end] });
      }
      steps.push({
        order: order++,
        move: "pool-vote",
        premises,
        conclusion: { kind: "form", span: [-1, -1], node: pc.item.id },
        cost: pc.cost,
        producers: [],
      });
    } else if (pc.item.kind === "anchorFocus") {
      votesIdf.set(pc.item.id, pc.cost);
      let bestRv = null;
      for (const c of pc.contributions) {
        const p0 = c.premises[0].item;
        if (p0.kind !== "region") {
          continue;
        }
        const rv = regionVotes[p0.ri];
        if (!bestRv || rv.wFocus > bestRv.wFocus) {
          bestRv = rv;
        }
      }
      if (bestRv) {
        support.set(pc.item.id, {
          start: bestRv.start,
          end: bestRv.end,
          w: bestRv.wFocus,
        });
      }
    }
  }
  return { votes, votesIdf, support, steps };
}
export function commitVotes(ctx, pooled, sat, regions, regionVoter, N) {
  const { votes, votesIdf, support, steps } = pooled;
  if (votes.size === 0) {
    traceAttention(ctx, regions, regionVoter, [], steps);
    return { roots: [], ranked: [] };
  }
  const ranked = [...votes.entries()]
    .map(([anchor, vote]) => {
      const s = support.get(anchor);
      return { anchor, vote, start: s.start, end: s.end };
    })
    .sort((a, b) => b.vote - a.vote);
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  const idfDesc = [...votesIdf.values()].sort((a, b) => b - a);
  const rootCut = naturalBreak(idfDesc);
  // A FURTHER point of attention (beyond the dominant one, which always
  // grounds) must clear the same absolute significance floor
  // recallByResonance trusts a climb anchor with — log(N) + 1/2, three-ish
  // halvings of confidence above pure chance at this corpus scale — not
  // merely beat whatever its immediate neighbour in the ratio happens to be.
  // Without it, naturalBreak's ratio is scale-free but not FLOOR-free: on a
  // large, topic-diverse corpus the steepest ratio in a long noise tail can
  // sit far below any real signal, admitting scaffolding echoes as if they
  // were genuine further topics.
  const floor = consensusFloor(N);
  const placed = [];
  const roots = [];
  for (const point of ranked) {
    const absorbed = placed.some((p) => overlaps(point, p));
    if (!absorbed) {
      const pastLeading = !sat.hasLeading ||
        roots.length === 0 || point.start >= sat.leadingEnd;
      const vote = votesIdf.get(point.anchor) ?? 0;
      if (
        (roots.length === 0 || (vote >= rootCut && vote >= floor)) &&
        pastLeading
      ) {
        roots.push(point);
      } else {
        continue;
      }
    }
    placed.push(point);
  }
  traceAttention(ctx, regions, regionVoter, roots, steps);
  return { roots, ranked };
}
export function detectSaturated(ctx, regions, saturated) {
  // Intervals are built from CHUNK regions only.  collectRegions emits the
  // tree in POST-ORDER — a parent region arrives AFTER its children and
  // shares its first child's `start` — so the raw array is not monotone in
  // byte position, and a saturated parent would fuse with a later saturated
  // chunk into an interval swallowing a NON-saturated child.  Chunk regions
  // (leaf-parents) are disjoint and already in byte order, and saturation
  // masking exists to drop canonicalFailed CHUNK votes (see poolVotes), so
  // chunks are both the sufficient and the safe basis.  A region without a
  // `chunk` flag (a bare {start,end} from a direct caller) is treated as a
  // chunk.
  const intervals = [];
  let intStart = -1;
  let intEnd = -1;
  let totalLen = 0;
  for (let ri = 0; ri < regions.length; ri++) {
    const r = regions[ri];
    totalLen = Math.max(totalLen, r.end);
    if (r.chunk === false) {
      continue;
    }
    if (saturated[ri]) {
      if (intStart === -1) {
        intStart = r.start;
      }
      intEnd = r.end;
    } else {
      if (intStart !== -1) {
        intervals.push({ start: intStart, end: intEnd });
        intStart = -1;
      }
    }
  }
  if (intStart !== -1) {
    intervals.push({ start: intStart, end: intEnd });
  }
  const leading = intervals.length > 0 && intervals[0].start === 0
    ? intervals[0]
    : null;
  const hasLeading = leading !== null &&
    leading.end >= ctx.space.maxGroup &&
    leading.end < totalLen;
  const leadingEnd = leading !== null ? leading.end : 0;
  return { leadingEnd, hasLeading, intervals };
}
/** Set equality of two climb root lists (the "same conclusion" test the
 *  contrastive margin skips rivals by). */
function sameRoots(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  const s = new Set(a);
  for (const x of b) {
    if (!s.has(x)) {
      return false;
    }
  }
  return true;
}
export function canonicalChunkId(ctx, regionBytes, N, reachMemo) {
  const len = Math.min(regionBytes.length, ctx.space.maxGroup);
  for (let off = 0; off + len <= regionBytes.length; off++) {
    const ids = leafIdRun(ctx, regionBytes, off, off + len);
    if (ids === null) {
      return null;
    }
    const flatId = ctx.store.findBranch(ids);
    if (flatId === null) {
      continue;
    }
    if (len < 2) {
      return flatId;
    }
    let bestId = flatId;
    let bestReach = edgeAncestors(ctx, flatId, N, reachMemo);
    for (let k2 = 1; k2 < len; k2++) {
      const shortIds = ids.slice(0, len - k2);
      const shortId = ctx.store.findBranch(shortIds);
      if (shortId === null) {
        continue;
      }
      const shortReach = edgeAncestors(ctx, shortId, N, reachMemo);
      if (
        shortReach.saturated ||
        shortReach.contextsReached > bestReach.contextsReached
      ) {
        bestId = shortId;
        bestReach = shortReach;
      }
    }
    return bestId;
  }
  return null;
}
export function naturalBreak(votes) {
  if (votes.length <= 1) {
    return votes[0] ?? 0;
  }
  let breakAt = 1;
  let steepest = Infinity;
  for (let i = 1; i < votes.length; i++) {
    if (votes[i - 1] <= 0) {
      break;
    }
    const ratio = votes[i] / votes[i - 1];
    if (ratio < steepest) {
      steepest = ratio;
      breakAt = i;
    }
  }
  return votes[breakAt - 1];
}
// ═══════════════════════════════════════════════════════════════════════════
// Cross-region attention — DIRECT region-to-region interaction.
//
// voteRegions climbs each region INDEPENDENTLY; poolVotes then ADDS those
// independent votes.  Additive pooling is a soft conjunction, but it can only
// ever surface a context at least one region already votes for.  Two regions
// whose individual climbs land on DIFFERENT contexts leave their JOINT context
// — the learnt whole that contains BOTH — with no vote at all, and no amount
// of pooling can recover it.  ("red" climbs to `red square`, "circle" to
// `circle`; nothing votes for `red circle`, the only fact holding both.)
//
// This is the attention counterpart of the bridge, and it ascends by the SAME
// content-addressed junction walk (junction.ts): "which learnt whole contains
// region A then region B?" is a bounded DAG ascent from the two forms'
// canonical identities — NOT a resonance guess on a synthesised gist.  Folding
// two region vectors cannot even reconstruct the stored joint form: Sema builds
// a multi-word gist from BYTE-chunk folds, so isolated word vectors superpose
// into a different direction and resonate to `red circle` and `red square`
// indistinguishably.  The ascent sidesteps this by matching BYTES, not vectors.
//
// A joint container is EXACT evidence (it literally holds both forms), so it
// votes at full strength — the exact-first discipline voteRegions gives a
// content-addressed chunk.  Each junction search is a bounded walk with NO
// ANN query, and searches are capped at k.  Three further disciplines make
// the composition ORDER-FREE, N-ARY, and CORPUS-INDEPENDENT:
//
//  • ORDER-FREE — a junction is evidence the forms were LEARNT TOGETHER;
//    which one the query mentioned first is a fact about the query, not the
//    learnt whole.  The walk tests both byte orders at no extra walk cost
//    (see junctionContainersFrom's `unordered`).
//  • N-ARY — binding is not intrinsically pairwise.  A pair's containers are
//    FILTERED by the remaining candidate forms: the container covering the
//    MOST of the query's composable forms wins, so three cross-cutting
//    attributes (each pair ambiguous) still resolve to their unique triple —
//    at the cost of one cached byte read + indexOf per (container, extra),
//    never an extra walk.
//  • CORPUS-INDEPENDENT — candidates are ANY voted region, not just
//    recognised sites.  A word never learnt standalone has no site, but its
//    stored chunks still vote and their BYTES still compose: the ascent
//    matches byte containment, so a fragment pair evidences the same joint
//    container the whole word would.  Contiguous shards of one word cannot
//    pair (the adjacency skip), and a pair covered by a single KNOWN region
//    is skipped — that whole form already votes directly, and re-deriving it
//    from its own pieces would only double-count.
//
// EXPLAINING AWAY (the aliasing complement of corpus independence): a chunk
// of the query can straddle the byte grid so that it exists verbatim in the
// WRONG deposit (" cir" of "red then circle" is a stored chunk of `blue
// circle`, never of `red circle` — a pure alignment accident) and its
// independent climb then votes for a context the query gives no reason to
// believe.  When a junction binds, any individual vote whose bytes the joint
// container LITERALLY CONTAINS yet whose climb disagrees with the junction's
// is superseded: the exact joint evidence explains those bytes, so their
// disagreeing vote is grid aliasing, not signal.  Votes whose bytes the
// container does not hold (a genuine second topic) are untouched.
// ═══════════════════════════════════════════════════════════════════════════
async function crossRegionVotes(ctx, query, regions, rvs, k, N, reachMemo) {
  // Candidate regions: every region that ALREADY CAST ITS OWN VOTE in
  // voteRegions — individually idf > 0, genuinely discriminative on its own,
  // just not necessarily for the SAME context as its partner.  This is the
  // exact shape of the binding problem: "red" alone votes for `red square`,
  // "circle" alone for `circle` — each independently informative, disagreeing
  // on the conclusion — and only their CONJUNCTION resolves to the one
  // context, `red circle`, that actually holds both.
  //
  // A region that never voted (idf == 0 — e.g. a repeated system-prompt
  // prefix shared by every deposit) carries NO individual signal, and must be
  // excluded here too: ascending from a non-discriminative fragment's seeds
  // can still land on some deeper, incidentally-unique DESCENDANT container —
  // its rarity would come entirely from context OUTSIDE the fragments
  // actually composed, manufacturing confidence the query gave no reason to
  // have.  Requiring a prior individual vote is the same discipline the noise
  // drop already applies to single regions, extended to compositions — with
  // one graded relaxation: a KNOWN region that did NOT vote (saturated, or
  // idf ≤ 0) may still serve as the WEAK side of a pair whose other side DID
  // vote.  Saturation is an abstention about where the region CLIMBS; its
  // content-addressed identity is still exact, and the junction asks a
  // different question — "which whole holds both?" — whose conclusion the
  // container's own idf gate below still guards.  Two non-voting regions
  // never pair (that is exactly the shared-prefix trap above), so at least
  // one side is always individually discriminative.
  //
  // Only MAXIMAL spans compose: a span contained in another candidate is a
  // fragment of that candidate's evidence, never independent of it.
  const votedSpans = new Set();
  for (const rv of rvs.votes) {
    votedSpans.add(`${rv.start},${rv.end}`);
  }
  const seen = new Set();
  const eligible = [];
  const strong = new Set();
  for (let ri = 0; ri < regions.length; ri++) {
    const r = regions[ri];
    const key = `${r.start},${r.end}`;
    const isStrong = votedSpans.has(key);
    if ((!isStrong && !r.known) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    eligible.push(ri);
    if (isStrong) {
      strong.add(ri);
    }
  }
  const cand = eligible.filter((x) =>
    !eligible.some((y) =>
      y !== x &&
      regions[y].start <= regions[x].start &&
      regions[x].end <= regions[y].end &&
      regions[y].end - regions[y].start > regions[x].end - regions[x].start
    )
  );
  const none = { votes: [], superseded: new Set() };
  if (cand.length < 2) {
    return none;
  }
  cand.sort((x, y) =>
    regions[x].start - regions[y].start || regions[x].end - regions[y].end
  );
  const dec = (b) => new TextDecoder().decode(b).replace(/\s+/g, " ").trim();
  const cache = walkCache(ctx);
  // One junctionSeeds per candidate for the WHOLE pairing loop — a candidate
  // recurs in up to |cand|−1 pairs, and its seeds are a pure function of its
  // bytes.
  const seedsMemo = new Map();
  const seedsOf = (ri) => {
    let s = seedsMemo.get(ri);
    if (s === undefined) {
      const r = regions[ri];
      s = junctionSeeds(ctx, query.subarray(r.start, r.end));
      seedsMemo.set(ri, s);
    }
    return s;
  };
  const overlapsSpan = (e, s) => e.start < s.end && s.start < e.end;
  const out = [];
  const superseded = new Set();
  // A candidate consumed by one junction does not seed another: its evidence
  // is already composed at full joint strength, and re-pairing it would vote
  // the same container (or a sub-container of it) twice.
  const consumed = new Set();
  let probes = 0;
  for (let a = 0; a < cand.length && probes < k; a++) {
    if (consumed.has(cand[a])) {
      continue;
    }
    const ra = regions[cand[a]];
    for (let b = a + 1; b < cand.length && probes < k; b++) {
      if (consumed.has(cand[b])) {
        continue;
      }
      const rb = regions[cand[b]];
      if (!strong.has(cand[a]) && !strong.has(cand[b])) {
        continue;
      }
      if (ra.end >= rb.start) {
        continue; // overlap or adjacent — nothing between
      }
      // A single KNOWN region covering both: the whole form is already a
      // stored identity that votes directly; its pieces add nothing.
      if (
        regions.some((r) => r.known && r.start <= ra.start && rb.end <= r.end)
      ) {
        continue;
      }
      probes++;
      const left = query.subarray(ra.start, ra.end);
      const right = query.subarray(rb.start, rb.end);
      // Phrase-scale contract, exactly as the bridge: the glue between the two
      // forms may be up to W× the content it joins.
      const maxInterior = (left.length + right.length) * ctx.space.maxGroup;
      const cap = left.length + right.length + maxInterior;
      // Tier 1 — exact containers (both forms as substrings, either order, by
      // DAG ascent).  Exact evidence first; only falls through to synonyms
      // when the exact ascent finds nothing — the SAME graded ladder the
      // bridge uses.
      let containers = junctionContainersFrom(
        ctx,
        left,
        right,
        cap,
        seedsOf(cand[a]),
        seedsOf(cand[b]),
        undefined,
        true,
      );
      if (containers.length === 0) {
        // Tier 2.5 — synonym containers (halo sibling of one side + the other).
        containers = await junctionSynonyms(
          ctx,
          left,
          right,
          maxInterior,
          true,
        );
      }
      if (containers.length === 0) {
        continue;
      }
      // N-ARY selection: the container covering the MOST remaining candidate
      // forms wins (then tightest interior, then lowest id).  Reads are
      // cache hits — every container's bytes were already read by the walk.
      //
      // SELF-EVIDENCE GUARD: a junction is BINDING evidence only when the
      // container joins forms the query mentions APART.  When the container's
      // own joined occurrence (left..right including its interior) is a
      // literal substring of the query, the query already spells that phrase
      // out contiguously — perception already voted with it, and grid shards
      // of one phrase pairing "around" a gap chunk would merely rediscover
      // the phrase they are shards of, then explain away its rivals.
      let best = null;
      let bestExtras = [];
      let bestCov = -1;
      for (const c of containers) {
        const bytes = cachedRead(ctx, cache, c.id, cap);
        const li = indexOf(bytes, left, 0);
        const ri = indexOf(bytes, right, 0);
        if (li >= 0 && ri >= 0) {
          const joined = bytes.subarray(
            Math.min(li, ri),
            Math.max(li + left.length, ri + right.length),
          );
          if (indexOf(query, joined, 0) >= 0) {
            continue; // query says it itself
          }
        }
        let cov = left.length + right.length;
        const extras = [];
        for (const ei of cand) {
          if (ei === cand[a] || ei === cand[b] || consumed.has(ei)) {
            continue;
          }
          const e = regions[ei];
          if (overlapsSpan(e, ra) || overlapsSpan(e, rb)) {
            continue;
          }
          const eb = query.subarray(e.start, e.end);
          if (indexOf(bytes, eb, 0) >= 0) {
            extras.push(ei);
            cov += eb.length;
          }
        }
        if (
          cov > bestCov ||
          (cov === bestCov && best !== null &&
            (c.interior.length < best.interior.length ||
              (c.interior.length === best.interior.length && c.id < best.id)))
        ) {
          best = c;
          bestExtras = extras;
          bestCov = cov;
        }
      }
      if (best === null) {
        continue; // every container was self-evidence
      }
      const reach = edgeAncestors(ctx, best.id, N, reachMemo);
      if (reach.saturated || reach.roots.length === 0) {
        continue;
      }
      const idf = Math.log(N / Math.max(1, reach.contextsReached));
      if (idf <= 0) {
        continue;
      }
      // EXACT joint evidence (score = 1): the container literally contains
      // every composed form.  Mutual-explanation weight over their COMBINED
      // byte length — the same magnitude reading voteRegions uses, here with
      // the estimator collapsed to certainty, so mutual = min(ratio, 1/ratio).
      const lenR = Math.max(1, bestCov);
      const ratio = Math.sqrt(
        Math.max(1, ctx.store.contentLen(best.id, lenR * ctx.store.D)) / lenR,
      );
      const mutual = Math.min(1, ratio) * Math.min(1, 1 / ratio);
      const w = (mutual * idf) / reach.roots.length;
      let spanStart = ra.start;
      let spanEnd = rb.end;
      for (const ei of bestExtras) {
        spanStart = Math.min(spanStart, regions[ei].start);
        spanEnd = Math.max(spanEnd, regions[ei].end);
      }
      out.push({
        start: spanStart,
        end: spanEnd,
        canonicalFailed: false, // content-addressed: never saturation-masked
        roots: reach.roots,
        w,
        wFocus: w,
      });
      consumed.add(cand[a]);
      consumed.add(cand[b]);
      for (const ei of bestExtras) {
        consumed.add(ei);
      }
      // EXPLAINING AWAY — see the block comment above the function.  Byte
      // containment in the joint container is the relatedness test (the
      // vote's bytes are literally part of the learnt whole), and FULL root
      // disjointness is the disagreement test: a vote sharing even one root
      // with the junction corroborates it and keeps its say elsewhere.
      const containerBytes = cachedRead(ctx, cache, best.id, cap);
      const jointRoots = new Set(reach.roots);
      for (const rv of rvs.votes) {
        if (rv.roots.some((r) => jointRoots.has(r))) {
          continue;
        }
        const bytes = query.subarray(rv.start, rv.end);
        if (indexOf(containerBytes, bytes, 0) >= 0) {
          superseded.add(rv);
        }
      }
      const label = [cand[a], cand[b], ...bestExtras]
        .sort((x, y) => regions[x].start - regions[y].start)
        .map((ri) => dec(query.subarray(regions[ri].start, regions[ri].end)))
        .join(" ▸ ");
      ctx.trace?.step(
        "crossRegion",
        [{ text: label, role: "pair" }],
        reach.roots.map((r) => ({
          text: dec(read(ctx, r)).slice(0, 60),
          node: r,
          role: "joint-context",
        })),
        `${label} → junction node ${best.id}` +
          (best.interior.length === 0
            ? " (adjacent)"
            : ` (interior "${dec(best.interior)}")`) +
          ` → ${reach.roots.length} context(s), by content-addressed ascent` +
          (superseded.size > 0
            ? `; ${superseded.size} aliasing vote(s) explained away`
            : ""),
      );
      break; // ra is consumed — move to the next unconsumed candidate
    }
  }
  return { votes: out, superseded };
}
export function traceAttention(ctx, regions, regionVoter, roots, steps = []) {
  if (!ctx.trace) {
    return;
  }
  const voters = [];
  for (let i = 0; i < regions.length; i++) {
    const rv = regionVoter[i];
    if (rv == null) {
      continue;
    }
    const item = rNode(ctx, rv.id, "sub-region", rv.score);
    item.text = `${item.text}  (df-w ${rv.w.toFixed(2)})`;
    voters.push(item);
  }
  const t = ctx.trace.enter("climbConsensus", voters);
  // The pooled-evidence decision, one DerivationStep per anchor — the same
  // shape {@link GraphSearch}'s own cover steps take (see traceDerivation).
  if (steps.length > 0) {
    traceDerivation(ctx, steps);
  }
  t.done(
    roots.map((r) => rNode(ctx, r.anchor, "anchor", r.vote)),
    roots.length === 0
      ? `${regions.length} sub-regions climbed the DAG, but none agreed on a context`
      : roots.length === 1
      ? `${voters.length} of ${regions.length} sub-regions voted; IDF-weighted consensus picked one context (vote ${
        roots[0].vote.toFixed(2)
      })`
      : `${voters.length} of ${regions.length} sub-regions voted; consensus ordered ${roots.length} INDEPENDENT points of attention (votes ${
        roots.map((r) => r.vote.toFixed(2)).join(", ")
      })`,
  );
}
