// match.ts — the ONE elementary operation behind every generalising mechanism:
// MATCH a learned structure against bytes, then PROJECT along a learned
// relation, gated by a derived threshold.
//
// Every grounding/generalisation mechanism in the mind is a configuration of
// this single (matcher, direction, gate) operation:
//
//   mechanism           matcher                        direction     gate
//   ─────────────────── ────────────────────────────── ───────────── ────────────────
//   cover follow-edge   exact (content-addressed)      forward       —
//   concept hop         halo sibling                   forward       conceptThreshold
//   recall tier 0–1     identity / whole-query gist    fwd/reverse   identityBar
//   skill extraction    locate() ladder (exact→halo→   read-out      per-step gates
//                       gist) on the exemplar's frames
//   CAST substitution   alignGraded() (graded ladder:  insert        frame shapes
//                       literal W-grams → halo sites)
//   CAST comparison     analogyStrength() (halo,       juxtapose     significanceBar
//                       direct or mutual-sibling)
//   multi-hop pivot     byte containment               forward       —
//   articulation        halo sibling                   substitute    conceptThreshold
//
// This module holds the shared vocabulary those configurations are built
// from — the MATCHERS (locate, alignRuns, alignGraded, analogyStrength) and
// the PROJECTIONS (follow, conceptHop, reverseContext, project) — so each
// mechanism file states only its configuration, never its own copy of the
// machinery.  The gates all live in geometry.ts (derived, never tuned).

import { cosine, Vec } from "../vec.js";
import type { Hit } from "../store.js";
import { conceptThreshold, identityBar, significanceBar } from "../geometry.js";
import { indexOf } from "../bytes.js";
import type { MindContext } from "./types.js";
import { leafIdRun } from "./canonical.js";
import { gistOf, read, resolve } from "./primitives.js";
import {
  argmaxCosine,
  chooseAmong,
  chooseNext,
  guidedFirst,
  hubBound,
  hubCap,
} from "./traverse.js";
import { recognise, segment } from "./recognition.js";
import type { Site } from "./graph-search.js";

// ═══════════════════════════════════════════════════════════════════════════
// MATCHERS — locating learned structure in/against bytes, by graded strictness
// ═══════════════════════════════════════════════════════════════════════════

/** The graded LOCATE ladder: find `needle` in `haystack` starting at
 *  `fromPos`, strictest matcher first, relaxing only when the stricter one
 *  fails.  This is the read-out matcher skill extraction locates exemplar
 *  frames with.
 *
 *  1. exact    — literal byte match (the fast path).
 *  2. halo     — the needle's distributional role matches a recognised query
 *                form (gate: conceptThreshold).
 *  3. gist     — the needle's perceived gist matches a query segment
 *                (gate: identityBar — scale-aware).
 *
 *  Returns the absolute byte position, or −1. */
export function locate(
  ctx: MindContext,
  haystack: Uint8Array,
  needle: Uint8Array,
  fromPos: number,
  sites?: ReadonlyArray<Site>,
): number {
  // 1. Exact match — fast, preserves backward compatibility.
  const exact = indexOf(haystack.subarray(fromPos), needle, 0);
  if (exact >= 0) return fromPos + exact;

  // 2. Halo-based: the frame bytes' distributional role matches a query form.
  if (sites && sites.length > 0) {
    const frameId = resolve(ctx, needle);
    if (frameId !== null) {
      const frameHalo = ctx.store.halo(frameId);
      if (frameHalo) {
        const bestSite = bestHaloMate(
          ctx,
          frameHalo,
          sites.filter((s) => s.start >= fromPos),
          (s) => ctx.store.halo(s.payload),
        );
        if (bestSite !== null) return bestSite.item.start;
      }
    }
  }

  // 3. Gist resonance: the frame's perceived gist against query segments.
  const frameGist = gistOf(ctx, needle);
  const segments = segment(ctx, haystack.subarray(fromPos));
  // The gist tier claims the WHOLE needle appears as a segment — an
  // identity claim over `needle.length` bytes, so its bar is the
  // scale-aware {@link identityBar} (one river window of tolerated foreign
  // bytes), not the fixed estimator floor.  For quantum-sized frames the
  // two coincide; for long needles the fixed bar accepted segments that
  // differed by whole windows.
  const bestSeg = argmaxCosine(
    frameGist,
    segments,
    (s) => s.v,
    identityBar(ctx.store.D, ctx.space.maxGroup, needle.length),
    true,
  );
  if (bestSeg !== null) return fromPos + bestSeg.item.start;

  return -1;
}

/** The ALIGNED matcher: maximal literal matching runs between `query` and
 *  `ct` (a learned context's bytes), by seed-and-extend over
 *  `space.maxGroup`-sized n-gram seeds.  Where locate() finds ONE position of
 *  a short frame, this finds EVERY run two whole structures share — the
 *  matcher CAST detects a woven query with.  Returns non-overlapping runs
 *  sorted by query position. */
export function alignRuns(
  ctx: MindContext,
  query: Uint8Array,
  ct: Uint8Array,
): Array<{ qs: number; qe: number; cs: number }> {
  const quantum = Math.min(ctx.space.maxGroup, ct.length);
  if (quantum < 1 || query.length < quantum) return [];
  const gram = (b: Uint8Array, at: number): string => {
    let s = "";
    for (let i = 0; i < quantum; i++) s += String.fromCharCode(b[at + i]);
    return s;
  };
  const seeds = new Map<string, number[]>();
  for (let i = 0; i + quantum <= query.length; i++) {
    const k2 = gram(query, i);
    const bucket = seeds.get(k2);
    if (bucket === undefined) seeds.set(k2, [i]);
    else bucket.push(i);
  }
  const found: Array<{ qs: number; qe: number; cs: number; len: number }> = [];
  for (let j = 0; j + quantum <= ct.length; j++) {
    const bucket = seeds.get(gram(ct, j));
    if (bucket === undefined) continue;
    for (const i of bucket) {
      if (i > 0 && j > 0 && query[i - 1] === ct[j - 1]) continue;
      let len = quantum;
      while (
        i + len < query.length && j + len < ct.length &&
        query[i + len] === ct[j + len]
      ) len++;
      found.push({ qs: i, qe: i + len, cs: j, len });
    }
  }
  found.sort((a, b) => b.len - a.len);
  const runs: Array<{ qs: number; qe: number; cs: number }> = [];
  for (const r of found) {
    const clash = runs.some((o) =>
      (r.qs < o.qe && o.qs < r.qe) ||
      (r.cs < o.cs + (o.qe - o.qs) && o.cs < r.cs + r.len)
    );
    if (!clash) runs.push({ qs: r.qs, qe: r.qe, cs: r.cs });
  }
  return runs.sort((a, b) => a.qs - b.qs);
}

/** A run from {@link alignGraded} — the ALIGNED matcher extended with the
 *  same graded-evidence ladder as {@link locate}.  Literal runs carry
 *  `weight = 1` (exact match is full evidence); halo-matched site runs carry
 *  `weight = cosine` (measured evidence — the halo similarity itself).
 *  `cs` is the structural byte position in the context regardless of run
 *  kind, so the substitution/redirection schemas work unchanged on conceptual
 *  alignment. */
export interface GradedRun {
  qs: number;
  qe: number;
  cs: number;
  weight: number;
}

/** The GRADED alignment matcher: extends literal W-gram alignment
 *  ({@link alignRuns}) with halo-matched recognised sites in query regions
 *  that have no literal coverage.  Same ladder as {@link locate}: literal
 *  first, then distributional role (halo-matched sites, gate:
 *  conceptThreshold, enforced by {@link bestHaloMate}).  Returns weighted
 *  runs sorted by query position.
 *
 *  `querySites` are the pre-computed recognition sites for the query
 *  (optional — when absent, only literal alignment fires and graded degrades
 *  to the original behaviour).  Context sites are recognised internally. */
export function alignGraded(
  ctx: MindContext,
  query: Uint8Array,
  contextBytes: Uint8Array,
  querySites?: ReadonlyArray<Site>,
): GradedRun[] {
  const lit = alignRuns(ctx, query, contextBytes);
  const out: GradedRun[] = lit.map((r) => ({ ...r, weight: 1 }));

  if (!querySites || querySites.length === 0) return out;

  // Mark query positions ALREADY covered by literal runs — halo fills gaps.
  // If literal coverage is already complete, skip the halo step entirely
  // (recognise is O(|ctx|·W) — wasted when every byte is accounted for).
  const covered = new Uint8Array(query.length);
  let gaps = false;
  for (const r of lit) {
    for (let i = r.qs; i < r.qe; i++) covered[i] = 1;
  }
  for (let i = 0; i < query.length; i++) {
    if (!covered[i]) {
      gaps = true;
      break;
    }
  }
  if (!gaps) return out;

  // Recognise sites in the exemplar context — structural positions for halo
  // matching.  (Circular import with recognition.ts is safe: recognise() is
  // called lazily, never at module load — the same pattern `segment` uses.)
  const ctxSites = recognise(ctx, contextBytes).sites;
  if (ctxSites.length === 0) return out;

  // Context sites with halos, hoisted: the same set serves every query site.
  const ctxCands = ctxSites.filter((cs) => ctx.store.hasHalo(cs.payload));
  if (ctxCands.length === 0) return out;

  // Candidate halos, also hoisted (lazily, first query site that needs them):
  // bestHaloMate consults every candidate's halo PER QUERY SITE, and sites
  // share the candidate set — without this memo the same few dozen halos were
  // re-fetched thousands of times per response.  Distinct payloads can repeat
  // across sites, hence the map by payload id.
  const ctxHalos = new Map<number, Vec | null>();
  const ctxHaloOf = (cs: Site): Vec | null => {
    let h = ctxHalos.get(cs.payload);
    if (h === undefined) {
      h = ctx.store.halo(cs.payload);
      ctxHalos.set(cs.payload, h);
    }
    return h;
  };

  for (const qs of querySites) {
    // Only sites that overlap UNCOVERED query regions add new evidence.
    let touchesGap = false;
    for (let i = qs.start; i < qs.end; i++) {
      if (!covered[i]) {
        touchesGap = true;
        break;
      }
    }
    if (!touchesGap) continue;

    const qHalo = ctx.store.halo(qs.payload);
    if (!qHalo) continue;

    // bestHaloMate already gates at conceptThreshold — no second check needed.
    const match = bestHaloMate(ctx, qHalo, ctxCands, ctxHaloOf);
    if (match === null) continue;

    out.push({
      qs: qs.start,
      qe: qs.end,
      cs: match.item.start,
      weight: match.score,
    });
  }

  out.sort((a, b) => a.qs - b.qs);
  return out;
}

/** The IN-LIST halo matcher: the best halo-mate for `halo` among EXPLICIT
 *  candidates, above the concept threshold — the list counterpart of
 *  {@link haloSiblings}, which asks the halo INDEX for candidates instead.
 *  Behind locate()'s halo step and articulation's voice matching; a third
 *  "best halo among these" decision must come here, not inline. */
export function bestHaloMate<T>(
  ctx: MindContext,
  halo: Vec,
  items: Iterable<T>,
  haloOf: (item: T) => Vec | null | undefined,
): { item: T; score: number } | null {
  return argmaxCosine(halo, items, haloOf, conceptThreshold(ctx.store.D));
}

/** The HALO-SIBLING matcher: the nodes that keep the same distributional
 *  company as `id`, nearest first — `resonateHalo` filtered to exclude the
 *  node itself and everything below `bar` (default: the concept threshold).
 *  `halo`, when the caller has already read the node's halo row, is reused
 *  instead of refetched (one read per relation).  Returns [] for a node with
 *  no halo.  The one sibling enumeration behind the concept hop, the
 *  reasoning stage's synonym expansion, and the analogy matcher below. */
const haloSiblingMemo = new WeakMap<object, Map<number, Hit[]>>();
export async function haloSiblings(
  ctx: MindContext,
  id: number,
  halo?: Vec | null,
  bar: number = conceptThreshold(ctx.store.D),
): Promise<Hit[]> {
  // Per-response memo for the DEFAULT-ARGUMENT reading (the one the concept
  // hop, the bridge's synonym tier, and reasoning's synonym expansion all
  // use): the same node's siblings are asked for repeatedly within one
  // response (bridge pairs share sides), each a full halo-ANN query, and the
  // store is read-only while a response is in flight.  Keyed by the response
  // lifecycle object (ctx.climbMemo — fresh per respond, nulled after).
  // Calls with an explicit halo or bar (analogyStrength's gated reading)
  // bypass the memo — their filter differs.
  const memoable = halo === undefined &&
    bar === conceptThreshold(ctx.store.D) && ctx.climbMemo !== null;
  let memo: Map<number, Hit[]> | undefined;
  if (memoable) {
    memo = haloSiblingMemo.get(ctx.climbMemo!);
    if (memo === undefined) {
      haloSiblingMemo.set(ctx.climbMemo!, memo = new Map());
    }
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
  }
  const h = halo ?? ctx.store.halo(id);
  const out = h
    ? (await ctx.store.resonateHalo(h, ctx.cfg.haloQueryK))
      .filter((sib) => sib.id !== id && sib.score >= bar)
    : [];
  if (memo !== undefined) memo.set(id, out);
  return out;
}

/** The DISTRIBUTIONAL matcher between two nodes: mutual-nearest-neighbour
 *  strength, not a pick.  Returns the direct halo cosine, or failing that the
 *  highest mutual-halo-sibling min-score (second-order analogy), or failing
 *  that the SHARED-FRAME strength (below) — the gate CAST's comparison
 *  schema validates genuine analogs with (bar: significanceBar). */
export async function analogyStrength(
  ctx: MindContext,
  a: number,
  b: number,
): Promise<number> {
  const ha = ctx.store.halo(a);
  const hb = ctx.store.halo(b);
  if (ha && hb) {
    const bar = significanceBar(ctx.store.D);
    const direct = cosine(ha, hb);
    if (direct >= bar) return direct;
    const sibsA = await haloSiblings(ctx, a, ha, bar);
    const sibsB = await haloSiblings(ctx, b, hb, bar);
    let best = 0;
    for (const x of sibsA) {
      if (x.id === b) continue;
      const y = sibsB.find((s) => s.id === x.id);
      if (y !== undefined) {
        best = Math.max(best, Math.min(x.score, y.score));
      }
    }
    if (best > 0) return best;
  }
  return sharedFrameStrength(ctx, a, b);
}

/** The STRUCTURAL analogy tier: two nodes are analogs when their byte
 *  streams share a LEARNT frame — a content-addressed flat form of at least
 *  one full river window (W bytes, the perception quantum) that occurs in
 *  BOTH.  This is what "playing the same role" means structurally: "Ice is
 *  cold" and "Steel is hard" share the learnt " is " frame even though they
 *  keep disjoint distributional company.  Halos measure company by IDENTITY
 *  (company signatures — see sema.ts), so unrelated-company analogs must be
 *  validated by the frame itself, not by content leaking through halo
 *  vectors.  Strength is the shared learnt coverage of the SHORTER side —
 *  a fraction, comparable to the cosine tiers above.  Derived: the window
 *  is maxGroup, the same quantum differsByOneWindow and canonicalChunkId
 *  measure by; no tuned constants. */
export function sharedFrameStrength(
  ctx: MindContext,
  a: number,
  b: number,
): number {
  const W = ctx.space.maxGroup;
  const A = read(ctx, a);
  const B = read(ctx, b);
  if (A.length < W || B.length < W) return 0;
  // Mark every byte of the shorter side covered by a learnt W-window that
  // also occurs in the longer side.
  const [s, l] = A.length <= B.length ? [A, B] : [B, A];
  const covered = new Uint8Array(s.length);
  for (let off = 0; off + W <= s.length; off++) {
    const win = s.subarray(off, off + W);
    // Learnt: the window resolves as a content-addressed flat form.
    const ids = leafIdRun(ctx, s, off, off + W);
    if (ids === null || ctx.store.findBranch(ids) === null) continue;
    if (indexOf(l, win, 0) < 0) continue;
    covered.fill(1, off, off + W);
  }
  let n = 0;
  for (let i = 0; i < s.length; i++) n += covered[i];
  return n >= W ? n / s.length : 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTIONS — what a matched node is projected ALONG (the direction)
// ═══════════════════════════════════════════════════════════════════════════

/** FORWARD through a synonym: the continuation an edge-less node borrows from
 *  a concept (halo) sibling — resonate the node's halo, take the first
 *  sibling above the concept threshold that itself has a direct edge. */
export async function conceptHop(
  ctx: MindContext,
  id: number,
): Promise<number | null> {
  for (const sib of await haloSiblings(ctx, id)) {
    const hop = guidedFirst(ctx, sib.id);
    if (hop !== undefined) return hop;
  }
  return null;
}

/** FORWARD projection: follow continuation edges from a node to its fixpoint.
 *  The first hop may cross a concept (halo) link — a synonym.  The rest
 *  follow direct edges.  Convergence is intrinsic: the seen set guards
 *  against cycles.  `guide` disambiguates multi-continuation nodes by
 *  resonance. */
export async function follow(
  ctx: MindContext,
  id: number,
  guide?: Vec | null,
): Promise<Uint8Array | null> {
  const seen = new Set<number>([id]);

  // First hop: a direct edge, else a concept sibling's edge (the synonym).
  let next = chooseNext(ctx, id, guide);
  if (next === undefined) {
    const hop = await conceptHop(ctx, id);
    if (hop === null) return null;
    next = hop;
  }

  // Direct successors to the fixpoint.  Only the FIXPOINT's bytes are
  // returned, so the walk tracks node ids and reads bytes exactly once at
  // the end — a K-hop chain used to pay K full reconstructions and discard
  // K−1 of them.
  while (!seen.has(next)) {
    seen.add(next);
    const fwd = chooseNext(ctx, next, guide);
    if (fwd === undefined || seen.has(fwd)) break;
    next = fwd;
  }
  return read(ctx, next);
}

/** REVERSE projection: the context a learnt continuation follows, voiced as
 *  bytes.  A common continuation ("Yes.") follows MANY contexts; with a
 *  `guide` the context whose gist resonates with the query wins (seat
 *  symmetry) — without one, the most-corroborated context wins (poured halo
 *  MASS, the direct measure of how many episodes established it), falling
 *  back to first-learnt on equal mass.  Callers that HAVE a query gist must
 *  pass it, or they silently change disambiguation regime.
 *
 *  `rev`, when the caller has already materialised prevOf (one read per
 *  relation — a hub's reverse fan-in is corpus-sized), is reused instead of
 *  refetched.  Returns null when there is no predecessor or the picked
 *  context reads empty (a zero-length context is no grounding: an empty
 *  Uint8Array is truthy, and returning it would flow a hollow "answer"
 *  onward). */
export function reverseContext(
  ctx: MindContext,
  id: number,
  guide?: Vec | null,
  rev?: readonly number[],
): Uint8Array | null {
  // CAPPED default read: only the first √N predecessors are ever candidates
  // (hubCap below / in chooseAmong), so only they are read.  hubBound ≥ 2
  // keeps the single-predecessor shortcut exact.
  const candidates = rev ?? ctx.store.prevFirst(id, hubBound(ctx));
  if (candidates.length === 0) return null;
  const pick = candidates.length === 1
    ? candidates[0]
    : guide
    ? chooseAmong(ctx, candidates, guide).id
    : pickByMass(ctx, candidates);
  const g = read(ctx, pick);
  return g.length > 0 ? g : null;
}

/** The most-corroborated candidate by poured halo mass (first-seen wins a
 *  tie).  Capped at √N candidates by insertion order — the same hub bound
 *  every fan-out walk uses. */
function pickByMass(ctx: MindContext, ids: readonly number[]): number {
  const capped = hubCap(ctx, ids);
  let best = capped[0];
  let bestMass = ctx.store.haloMass(best);
  for (let i = 1; i < capped.length; i++) {
    const mass = ctx.store.haloMass(capped[i]);
    if (mass > bestMass) {
      best = capped[i];
      bestMass = mass;
    }
  }
  return best;
}

/** THE projection: ground a matched node to answer bytes — FORWARD to its
 *  continuation fixpoint (which may cross a concept hop), else REVERSE to
 *  the context it follows.  This is the direction ladder every mechanism's
 *  final grounding step reduces to. */
export async function project(
  ctx: MindContext,
  id: number,
  guide?: Vec | null,
): Promise<Uint8Array | null> {
  const fc = await follow(ctx, id, guide);
  if (fc) return fc;
  return reverseContext(ctx, id, guide);
}
