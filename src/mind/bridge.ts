// bridge.ts — corroborated-substitution grounding (recall's last tier before
// refusal).
//
// THE GAP (test/49): a query phrased through a near-synonym of a trained
// word ("Name the biggest planet." against a corpus that only ever says
// "largest planet") reaches nothing — recognition finds no form, whole-query
// resonance stays below the reach bar — even though the fact is trained and
// the synonym pairing is corroborated across the corpus.  Words are never
// independently addressable nodes (deposit interns whole streams plus W-1/W
// leaf windows; a word mid-sentence falls between those scales), so no halo
// ever links "biggest" to "largest" — and the write side cannot cheaply
// mint such nodes without polluting the shared indexes (measured: an
// earlier write-side attempt regressed 24 unrelated tests).
//
// THE MECHANISM — read-only, refusal-path-only.  When recall is about to
// refuse, the query's own content-addressed windows (the W-byte leaf-id
// flat branches indexSubSpans already interns at every byte offset) are
// probed against the store; the rarest ones anchor a climb (edgeAncestors —
// the same climb consensus voting uses) to the trained contexts that
// contain them.  Each candidate context is ALIGNED to the query byte-for-
// byte around the anchor, leaving mismatched spans; a mismatch grounds as a
// SUBSTITUTION only under two derived gates:
//
//   • CORROBORATION — the query-side span is itself corpus-attested: every
//     W-window inside it resolves as a stored flat form, at least one of
//     them reused across ≥ 2 containers (the same "≥ 2 structural parents"
//     bar propagateSuffixes gates suffix inheritance with).  An untrained
//     word ("deadliest") has no stored windows and can never substitute.
//   • GEOMETRIC IDENTITY — the two spans' own perceived gists must clear
//     conceptThreshold(D), the same "same concept" bar haloSiblings and
//     articulation already gate on.  This is what separates a synonym pair
//     the fold geometry genuinely identifies ("biggest"~"largest", sharing
//     most of their bytes and their role) from an arbitrary co-frame word.
//
// A candidate context is accepted when its aligned-plus-substituted spans
// DOMINATE the query (the same half-dominance predicate used throughout)
// and every unexplained gap stays within one perception window W (the same
// single-window tolerance identityBar prices).  The accepted context is
// then grounded exactly like any recall hit — project() through its learnt
// edges — so the answer is a trained continuation, never synthesized bytes.
//
// COST: nothing on any answering path — the bridge runs only where the
// alternative was silence.  There it pays O(|query|) content-hash probes
// (the propagateSuffixes trick), at most W anchor climbs and hubBound
// candidate reads, and one O(|query|·|candidate|)-bounded alignment each —
// all capped by existing derived bounds (W, chainReach, hubBound).

import { cosine } from "../vec.js";
import { conceptThreshold, dominates } from "../geometry.js";
import { bytesEqual, indexOf } from "../bytes.js";
import type { MindContext } from "./types.js";
import { perceive } from "./primitives.js";
import { chainReach, leafIdRun } from "./canonical.js";
import { corpusN, edgeAncestors, hubBound } from "./traverse.js";
import { rItem, rNode } from "./trace.js";

/** One accepted substitution: query span [qs,qe) stands in for the
 *  candidate context's span — recorded for the rationale trace. */
interface Substitution {
  qs: number;
  qe: number;
  cs: number;
  ce: number;
}

/** A bridged grounding proposal: the trained context to ground, the query
 *  spans its alignment accounts for, and the substitutions that closed it. */
export interface BridgeHit {
  id: number;
  accounted: Array<[number, number]>;
  subs: Substitution[];
}

/** True when some query byte-range left UNACCOUNTED by `spans` contains a
 *  STORED window — content the store has seen that the proposed reading
 *  simply ignores.  The IGNORED-KNOWN principle: a span may be dismissed
 *  only when the store itself has never seen it; known content the
 *  alignment failed to account for is grounds for refusal, while genuinely
 *  novel spans (an untrained word, stray punctuation) remain tolerable.
 *  Shared by the substitution bridge's own acceptance and CAST's
 *  frame-tier comparison gate (cast.ts).  Pure attestation — no
 *  similarity, no constants. */
export function dismissedKnownContent(
  ctx: MindContext,
  query: Uint8Array,
  spans: ReadonlyArray<readonly [number, number]>,
): boolean {
  const W = ctx.space.maxGroup;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [s, e] of [...sorted, [query.length, query.length] as const]) {
    for (let o = cursor; o + W <= s; o++) {
      const ids = leafIdRun(ctx, query, o, o + W);
      if (ids !== null && ctx.store.findBranch(ids) !== null) return true;
    }
    cursor = Math.max(cursor, e);
  }
  return false;
}

/** True when the query span [qs,qe) is corpus-attested: every full W-window
 *  inside it resolves as a stored flat form and at least one is reused
 *  across ≥ 2 containers.  Spans shorter than W carry no window of their
 *  own and cannot attest — they are refused (an unattestable span must not
 *  substitute). */
function attested(
  ctx: MindContext,
  bytes: Uint8Array,
  qs: number,
  qe: number,
): boolean {
  const W = ctx.space.maxGroup;
  if (qe - qs < W) return false;
  let reused = false;
  for (let o = qs; o + W <= qe; o++) {
    const ids = leafIdRun(ctx, bytes, o, o + W);
    if (ids === null) return false;
    const id = ctx.store.findBranch(ids);
    if (id === null) return false;
    if (!reused && ctx.store.containersSlice(id, 0, 2).length >= 2) {
      reused = true;
    }
  }
  return reused;
}

/** Extend a seed match (query offset qo ↔ candidate offset co) to its
 *  maximal common run, then walk outward in both directions collecting
 *  further common runs of at least W bytes across bounded mismatch gaps
 *  (each side ≤ chainReach).  Returns the matched query spans and the
 *  mismatch pairs between consecutive runs. */
function align(
  ctx: MindContext,
  q: Uint8Array,
  c: Uint8Array,
  qo: number,
  co: number,
): { matched: Array<[number, number]>; gaps: Substitution[] } {
  const W = ctx.space.maxGroup;
  const reachCap = chainReach(W);
  // Maximal run around the seed.
  let qs = qo, ss = co;
  while (qs > 0 && ss > 0 && q[qs - 1] === c[ss - 1]) {
    qs--;
    ss--;
  }
  let qe = qo, se = co;
  while (qe < q.length && se < c.length && q[qe] === c[se]) {
    qe++;
    se++;
  }
  const matched: Array<[number, number]> = [[qs, qe]];
  const gaps: Substitution[] = [];
  // The next common run of ≥ W bytes past (qi, si), with each side's gap
  // bounded by chainReach; smallest total gap wins (nearest continuation).
  const runLenAt = (qi: number, si: number): number => {
    let n = 0;
    while (qi + n < q.length && si + n < c.length && q[qi + n] === c[si + n]) {
      n++;
    }
    return n;
  };
  // RIGHT sweep.
  let qi = qe, si = se;
  for (;;) {
    let found = false;
    for (let total = 1; total <= 2 * reachCap && !found; total++) {
      for (let gq = 0; gq <= Math.min(total, reachCap); gq++) {
        const gs = total - gq;
        if (gs > reachCap) continue;
        if (qi + gq >= q.length || si + gs >= c.length) continue;
        const n = runLenAt(qi + gq, si + gs);
        if (n >= W || qi + gq + n === q.length) {
          if (n === 0) continue;
          if (gq > 0 || gs > 0) {
            gaps.push({ qs: qi, qe: qi + gq, cs: si, ce: si + gs });
          }
          matched.push([qi + gq, qi + gq + n]);
          qi = qi + gq + n;
          si = si + gs + n;
          found = true;
          break;
        }
      }
    }
    if (!found) break;
  }
  // LEFT sweep (mirror).
  qi = qs;
  si = ss;
  for (;;) {
    let found = false;
    for (let total = 1; total <= 2 * reachCap && !found; total++) {
      for (let gq = 0; gq <= Math.min(total, reachCap); gq++) {
        const gs = total - gq;
        if (gs > reachCap) continue;
        if (qi - gq <= 0 || si - gs <= 0) continue;
        // Run ENDING at (qi - gq, si - gs).
        let n = 0;
        while (
          n < qi - gq && n < si - gs &&
          q[qi - gq - 1 - n] === c[si - gs - 1 - n]
        ) {
          n++;
        }
        if (n >= W || n === qi - gq) {
          if (n === 0) continue;
          if (gq > 0 || gs > 0) {
            gaps.push({ qs: qi - gq, qe: qi, cs: si - gs, ce: si });
          }
          matched.push([qi - gq - n, qi - gq]);
          qi = qi - gq - n;
          si = si - gs - n;
          found = true;
          break;
        }
      }
    }
    if (!found) break;
  }
  return { matched, gaps };
}

/** Recall's corroborated-substitution bridge — see the module comment.
 *  Returns the best bridged grounding proposal, or null. */
export async function substitutionBridge(
  ctx: MindContext,
  query: Uint8Array,
): Promise<BridgeHit | null> {
  const W = ctx.space.maxGroup;
  if (query.length < 2 * W) return null;
  const bound = hubBound(ctx);
  const N = corpusN(ctx);
  const bar = conceptThreshold(ctx.store.D);
  const reachCap = chainReach(W);

  // 1. The query's stored windows, rarest first (fewest containers — the
  //    most discriminative anchors; hub-clamped like every fan-out read).
  const anchors: Array<{ off: number; id: number; rarity: number }> = [];
  for (let o = 0; o + W <= query.length; o++) {
    const ids = leafIdRun(ctx, query, o, o + W);
    if (ids === null) continue;
    const id = ctx.store.findBranch(ids);
    if (id === null) continue;
    const rarity = ctx.store.containersSlice(id, 0, bound + 1).length;
    if (rarity === 0) continue;
    anchors.push({ off: o, id, rarity });
  }
  if (anchors.length === 0) return null;
  anchors.sort((a, b) => a.rarity - b.rarity);
  // Up to W anchors, at least one window apart — the quantum's own count.
  const picked: typeof anchors = [];
  for (const a of anchors) {
    if (picked.length >= W) break;
    if (picked.some((p) => Math.abs(p.off - a.off) < W)) continue;
    picked.push(a);
  }

  // 2. Candidate trained contexts: climb each anchor to its edge-bearing
  //    ancestors (the same climb consensus voting uses).
  const seen = new Set<number>();
  const candidates: number[] = [];
  for (const a of picked) {
    const reach = edgeAncestors(ctx, a.id, N);
    for (const sid of reach.roots) {
      if (seen.has(sid)) continue;
      seen.add(sid);
      if (!ctx.store.hasNext(sid)) continue;
      candidates.push(sid);
      if (candidates.length >= bound) break;
    }
    if (candidates.length >= bound) break;
  }

  // 3. Align each candidate; gate its mismatches; keep the best.
  const allBytes = new Map<number, Uint8Array>();
  for (const sid of candidates) allBytes.set(sid, ctx.store.bytes(sid));

  // FRAME UNANIMITY: a substitution U → C inside the frame (Lf, Rf) is
  // groundable only when the collected candidates — the store's own sample
  // of contexts sharing the query's content — are unanimous about the
  // filler: every occurrence of Lf…Rf across them holds either U (the
  // query's own word, corroboration) or C.  A THIRD distinct filler means
  // the frame is a VALUE SLOT ("was born in _" held Germany, Poland,
  // England, Serbia — observed live), and picking one value would assert
  // knowledge the store does not have.  Consensus of the store's own
  // instances, no similarity judgement, no tuned constant.
  const unanimous = (
    u: Uint8Array,
    c: Uint8Array,
    lf: Uint8Array,
    rf: Uint8Array,
  ): boolean => {
    for (const bytes of allBytes.values()) {
      let from = 0;
      for (;;) {
        const i = indexOf(bytes, lf, from);
        if (i < 0) break;
        from = i + 1;
        const start = i + lf.length;
        const j = indexOf(
          bytes.subarray(start, start + reachCap + rf.length),
          rf,
          0,
        );
        if (j < 0) continue;
        const filler = bytes.subarray(start, start + j);
        if (filler.length === 0) continue;
        if (!bytesEqual(filler, u) && !bytesEqual(filler, c)) return false;
      }
    }
    return true;
  };

  // The query's most DISCRIMINATIVE known content — its rarest-tier
  // windows (every stored window whose container count ties the minimum) —
  // must literally occur in a bridged context.  A candidate reached
  // through a common scaffolding window that lacks all of them is about
  // something else entirely, however well its frames align (observed live:
  // "what is the capital of france" bridging to a Matrix synopsis that
  // contains no "franc"-window at all, its tail "matched" by the
  // coincidental "f fr" ↔ "of free will").
  const minRarity = anchors[0].rarity;
  const rareTier = anchors.filter((a) => a.rarity === minRarity);
  let best: BridgeHit | null = null;
  let bestAccounted = 0;
  for (const sid of candidates) {
    const cBytes = allBytes.get(sid)!;
    if (cBytes.length === 0) continue;
    if (
      !rareTier.some((a) =>
        indexOf(cBytes, query.subarray(a.off, a.off + W), 0) >= 0
      )
    ) continue;
    // Seed at the rarest picked anchor that literally occurs in this
    // candidate.
    let seed: { qo: number; co: number } | null = null;
    for (const a of picked) {
      const co = indexOf(cBytes, query.subarray(a.off, a.off + W), 0);
      if (co >= 0) {
        seed = { qo: a.off, co };
        break;
      }
    }
    if (seed === null) continue;
    const { matched, gaps } = align(ctx, query, cBytes, seed.qo, seed.co);

    // Gate each mismatch: a corroborated, geometrically-identified
    // substitution counts as accounted; anything else stays a gap.
    //
    // A raw mismatch is the MINIMAL byte diff ("big" ↔ "lar" inside
    // biggest/largest), usually below the scale at which either side is a
    // corpus unit.  The true unit is found by EXPANSION: absorb flanking
    // bytes from the adjacent matched runs (equal on both sides by
    // construction, so both spans grow identically) until the query side
    // attests and the pair clears the concept bar — smallest expansion
    // first, capped at chainReach like the mismatch itself.  Absorbed
    // bytes were already matched, so coverage is unchanged.
    const subs: Substitution[] = [];
    let ok = true;
    for (const g of gaps) {
      const uLen = g.qe - g.qs, cLen = g.ce - g.cs;
      if (uLen === 0 || cLen === 0 || uLen > reachCap || cLen > reachCap) {
        // Pure insertion/deletion or over-long mismatch.  Query-side: one
        // perception window (the identityBar tolerance).  Candidate-side:
        // one chain reach (W², the two-level composite bound) — a genuine
        // paraphrase inserts inflection-scale material ("does water boil"
        // ↔ "should water be boiled"), while a divergent candidate jumps
        // hundreds of bytes between the query's frames.
        if (uLen > W || cLen > reachCap) ok = false;
        continue;
      }
      let accepted = false;
      const maxExtra = reachCap - Math.max(uLen, cLen);
      outer:
      for (let extra = 0; extra <= maxExtra; extra++) {
        for (let a = 0; a <= extra; a++) {
          const b = extra - a;
          const qs2 = g.qs - a, qe2 = g.qe + b;
          const cs2 = g.cs - a, ce2 = g.ce + b;
          if (qs2 < 0 || qe2 > query.length) continue;
          if (cs2 < 0 || ce2 > cBytes.length) continue;
          // INTERIOR gate: a substitution must sit INSIDE matched
          // structure — at least one full window of matched bytes must
          // remain adjacent on BOTH sides after absorption.  Every junk
          // substitution observed live sat at the query's edge, with only
          // terminal punctuation beyond it ("…born in [England].",
          // "…capital of [Zamunda]?"): an edge mismatch is the query
          // trailing off into different content, not a word standing in a
          // shared frame.
          const leftOk = matched.some(([s, e]) => e >= qs2 && qs2 - s >= W);
          const rightOk = matched.some(([s, e]) => s <= qe2 && e - qe2 >= W);
          if (!leftOk || !rightOk) continue;
          if (!attested(ctx, query, qs2, qe2)) continue;
          const u = query.subarray(qs2, qe2);
          const cSpan = cBytes.subarray(cs2, ce2);
          if (cosine(perceive(ctx, u).v, perceive(ctx, cSpan).v) < bar) {
            continue;
          }
          if (
            !unanimous(
              u,
              cSpan,
              query.subarray(qs2 - W, qs2),
              query.subarray(qe2, qe2 + W),
            )
          ) continue;
          subs.push({ qs: qs2, qe: qe2, cs: cs2, ce: ce2 });
          accepted = true;
          break outer;
        }
      }
      if (!accepted && (uLen > W || cLen > reachCap)) ok = false;
    }
    if (!ok || subs.length === 0) continue;

    // Coverage: matched runs plus accepted substitutions must dominate the
    // query, every interior gap already proved ≤ W above, and the EDGES
    // must be explained to the same one-window tolerance — the same "at
    // most one river window of foreign content" identityBar prices.  The
    // live junk this closes: alignments that matched a query's scaffolding
    // and one substitution but left the query's whole trailing content
    // ("…planet orbiting our sun.", 24 bytes) unexplained, yet still
    // half-dominated the byte count.
    const spans: Array<[number, number]> = [
      ...matched,
      ...subs.map((s) => [s.qs, s.qe] as [number, number]),
    ].sort((x, y) => x[0] - y[0]);
    let covered = 0;
    let reachEnd = 0;
    for (const [s, e] of spans) {
      if (e <= reachEnd) continue;
      covered += e - Math.max(s, reachEnd);
      reachEnd = Math.max(reachEnd, e);
    }
    if (spans[0][0] > W || query.length - reachEnd > W) continue;
    if (!dominates(covered, query.length)) continue;

    // KNOWN content may never be dismissed — see dismissedKnownContent
    // (the live case: "what is the capital of france" aligning into a
    // Matrix synopsis by writing off "ance" — a stored window of the
    // trained "France" — as a gap, while genuinely novel spans like
    // test/49's untrained "Name" remain tolerable).
    if (dismissedKnownContent(ctx, query, spans)) continue;

    if (covered > bestAccounted) {
      bestAccounted = covered;
      best = { id: sid, accounted: spans, subs };
    }
  }

  if (best !== null) {
    ctx.trace?.step(
      "substitutionBridge",
      [rItem(query, "query")],
      [
        rNode(ctx, best.id, "bridged-context"),
        ...best.subs.map((s) =>
          rItem(query.subarray(s.qs, s.qe), "substituted")
        ),
      ],
      `a trained context accounts for the query up to ${best.subs.length} ` +
        `corroborated substitution(s) — grounding through its learnt edges`,
    );
  }
  return best;
}
