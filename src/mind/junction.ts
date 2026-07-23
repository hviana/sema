// junction.ts — content-addressed junction search (bridge Tier 1).
//
// "Which learnt wholes ran L and R together?" answered by DAG ascent, not a
// similarity guess: hash-consing means any deposit containing L's bytes shares
// L's node (or L's canonical-window ids — position-independent identities), so
// climbing parents + containment links from L's and R's seeds reaches every
// container that literally holds L-then-R.  A resonance seed (the gist of the
// bare concatenation — an object never learnt) could rank the true container
// out of its top-k; the ascent cannot.
//
// Extracted from resonance.ts so BOTH the bridge (a connector between two
// adjacent ANSWER pieces) and cross-region attention (the joint CONTEXT of two
// non-adjacent QUERY regions) ascend by the same disciplined, bounded walk.

import type { Hit } from "../store.js";
import type { MindContext } from "./types.js";
import { read, resolve } from "./primitives.js";
import { windowIds } from "./canonical.js";
import { hubBound } from "./traverse.js";
import { haloSiblings } from "./match.js";
import { indexOf } from "../bytes.js";

export interface Junction {
  /** The node whose learnt bytes evidence this junction (a container form,
   *  a continuation, or a context). */
  id: number;
  /** The bytes that belong between left and right. */
  interior: Uint8Array;
}

/** Which relaxation produced a {@link SynonymJunction}: one side replaced by
 *  a distributional halo sibling (`single-synonym`), or both (`double-
 *  synonym`) — the two remaining rungs of the graded ladder below exact DAG
 *  containment (see the module doc atop {@link junctionSynonyms}). */
export type SynonymJunctionTier =
  | "single-synonym"
  | "double-synonym";

export interface SynonymJunction extends Junction {
  tier: SynonymJunctionTier;
  /** Sibling score for a single-synonym junction; min(left, right) sibling
   *  score for a double-synonym junction. */
  confidence: number;
}

/** The exact node ids and halo siblings resolved for one junction call's two
 *  sides — computed ONCE and reused by every ladder rung that needs them
 *  (junctionSynonyms' two tiers, and the structural-resonance tier beyond
 *  it).  A failed synonym junction means only "no common DAG container was
 *  proven" — it does NOT mean the loaded siblings stop being useful. */
export interface JunctionSynonymSides {
  leftId: number | null;
  rightId: number | null;
  leftSiblings: Hit[];
  rightSiblings: Hit[];
}

/** Resolve `left`/`right` to their exact node ids (when known) and load each
 *  resolved side's halo siblings once — deterministic (haloSiblings already
 *  ranks nearest-first) and shared by every ladder rung that consults
 *  siblings, so no ladder rung repeats a halo ANN query the previous one
 *  already paid for. */
export async function loadJunctionSynonymSides(
  ctx: MindContext,
  left: Uint8Array,
  right: Uint8Array,
): Promise<JunctionSynonymSides> {
  const leftId = resolve(ctx, left);
  const rightId = resolve(ctx, right);
  const leftSiblings = leftId !== null ? await haloSiblings(ctx, leftId) : [];
  const rightSiblings = rightId !== null
    ? await haloSiblings(ctx, rightId)
    : [];
  return { leftId, rightId, leftSiblings, rightSiblings };
}

/** Seed node ids to ascend from for one side of a junction: the side's own
 *  node when it is a stored form, plus — when the node has no structural
 *  parents — its canonical window ids.  A non-W-aligned node may have no
 *  parents, but its constituent W-grams typically do; the window ids
 *  provide alternative ascent paths.  The `parentsFirst(…, 1)` probe is a
 *  single indexed lookup, far cheaper than computing every window id, so
 *  the window-id path is only taken when the node alone cannot ascend.
 *  Exported for callers (synonym junctions) that hold one side FIXED across
 *  several calls and so compute its seeds once instead of per call. */
export function junctionSeeds(ctx: MindContext, b: Uint8Array): number[] {
  const r = resolve(ctx, b);
  if (r !== null) {
    if (ctx.store.parentsFirst(r, 1).length > 0) return [r];
    const wids = [...windowIds(ctx, b).values()];
    return [r, ...wids];
  }
  const wids = [...windowIds(ctx, b).values()];
  if (wids.length <= 2) return wids;
  return [wids[0], wids[wids.length - 1]];
}

/** Per-response cache of the identity walks' pure reads (capped bytes,
 *  parent pages, container pages), keyed by the response lifecycle object
 *  (ctx.climbMemo).  One response issues many walks whose ancestries overlap
 *  heavily (pair sides repeat across combos, and synonym walks revisit the
 *  same neighbourhoods); the store is read-only while a response is in flight,
 *  so every one of these reads is a pure function of the id — repeats cost a
 *  Map hit instead of a SQL statement or a byte reconstruction. */
export interface WalkCache {
  /** id → prefix bytes read so far + whether they are the COMPLETE bytes
   *  (shorter than the cap that read them). */
  reads: Map<number, { b: Uint8Array; complete: boolean }>;
  parents: Map<number, number[]>;
  containers: Map<number, number[]>;
}
const walkCaches = new WeakMap<object, WalkCache>();
export function walkCache(ctx: MindContext): WalkCache | null {
  if (ctx.climbMemo === null) return null;
  let c = walkCaches.get(ctx.climbMemo);
  if (c === undefined) {
    walkCaches.set(
      ctx.climbMemo,
      c = { reads: new Map(), parents: new Map(), containers: new Map() },
    );
  }
  return c;
}
export function cachedRead(
  ctx: MindContext,
  cache: WalkCache | null,
  id: number,
  cap: number,
): Uint8Array {
  if (cache === null) return read(ctx, id, cap + 1);
  const hit = cache.reads.get(id);
  // A cached COMPLETE read serves any cap; a cached truncated read serves
  // any cap it already covers (the caller only checks `length > cap`).
  if (hit !== undefined && (hit.complete || hit.b.length > cap)) return hit.b;
  const b = read(ctx, id, cap + 1);
  cache.reads.set(id, { b, complete: b.length <= cap });
  return b;
}
function cachedParents(
  ctx: MindContext,
  cache: WalkCache | null,
  id: number,
  limit: number,
): number[] {
  if (cache === null) return ctx.store.parentsFirst(id, limit);
  let v = cache.parents.get(id);
  if (v === undefined) {
    v = ctx.store.parentsFirst(id, limit);
    cache.parents.set(id, v);
  }
  return v;
}
function cachedContainers(
  ctx: MindContext,
  cache: WalkCache | null,
  id: number,
  limit: number,
): number[] {
  if (cache === null) return ctx.store.containersSlice(id, 0, limit);
  let v = cache.containers.get(id);
  if (v === undefined) {
    v = ctx.store.containersSlice(id, 0, limit);
    cache.containers.set(id, v);
  }
  return v;
}

/** Tier 1 body, parameterised on already-resolved seed lists so a caller
 *  holding one side FIXED across several calls (synonym junctions) pays for
 *  that side's seeds once, not once per call.  The byte-containment check
 *  below ensures only genuine containers are returned regardless of seeds.
 *
 *  BOUNDED at corpus scale by three disciplines (profiled on a 17.7M-node
 *  store, where the unbounded form spent >90% of a query's CPU here):
 *   • PHRASE-SCALE READS — a junction container is by contract a whole the
 *     pair nearly exhausts (glue from a period to a phrase), so every visit
 *     reads at most `maxContainer + 1` bytes (`bytesPrefix` stops early).
 *     A node whose bytes exceed the cap cannot be a junction container, and
 *     its ancestors are strictly larger — the branch is PRUNED, never
 *     reconstructing a corpus-sized deposit (an oasst2 conversation) just
 *     to reject it.
 *   • EXPANSION BUDGET — at most √N·W nodes are popped in total: a √N-wide
 *     frontier (the one fan-out convention) through the ~W structural
 *     levels that separate phrase-scale content from its containers
 *     (perception trees are W-ary, so a junction container lies within a
 *     few levels of its parts).  A side too common to decide within the
 *     budget abstains here and falls through to the resonance tier (the
 *     climb's own saturation semantics).
 *   • per-node hub guards — parent fan-outs beyond √N are hubs (not
 *     expanded); each node contributes at most one √N page of containers;
 *     √N collected candidates decide. */
export function junctionContainersFrom(
  ctx: MindContext,
  left: Uint8Array,
  right: Uint8Array,
  maxContainer: number,
  leftSeeds: number[],
  rightSeeds: number[],
  /** Shared expansion budget — a TIER's √N pops, not each walk's, when one
   *  tier issues several walks (synonym junctions try up to 2·haloQueryK
   *  siblings; without a shared budget each sibling would spend its own √N). */
  budget?: { n: number },
  /** ORDER-FREE containment: also accept containers holding right-then-left.
   *  A junction is evidence that the two forms were LEARNT TOGETHER; which
   *  one the query happened to mention first is a fact about the query, not
   *  about the learnt whole.  The walk is identical (the seed ascent does not
   *  depend on order) — only the byte-containment test gains a second probe,
   *  so order-freedom costs two indexOf calls per visited node, never a
   *  second walk. */
  unordered = false,
): Junction[] {
  const bound = hubBound(ctx);
  const joinedLength = left.length + right.length;
  const seeds = [...new Set([...leftSeeds, ...rightSeeds])];
  if (seeds.length === 0) return [];

  const b = budget ?? { n: bound * ctx.space.maxGroup };
  // DEPTH CAP: perception trees are W-ary and a junction container is
  // phrase-scale, so it sits within ~log_W(maxContainer) structural levels
  // of its parts — at most W levels for any practical W (plus the
  // containment hop the seeds already are).  Ancestry beyond that depth is
  // strictly larger than any admissible container; walking it can only burn
  // budget, never find a junction.
  const maxDepth = ctx.space.maxGroup;
  const out: Junction[] = [];
  const cache = walkCache(ctx);
  const seen = new Set<number>(seeds);
  const stack: Array<{ id: number; d: number }> = seeds.map((id) => ({
    id,
    d: 0,
  }));
  while (stack.length > 0 && out.length < bound && b.n-- > 0) {
    const { id: x, d } = stack.pop()!;
    const f = cachedRead(ctx, cache, x, maxContainer);
    if (f.length > maxContainer) continue; // beyond phrase scale: prune branch
    if (unordered) {
      // Order-free containment does NOT require disjoint occurrences: two
      // grid-aligned fragments of the same whole legitimately OVERLAP inside
      // it ("red " at 0 and " cir" at 3 in `red circle`), and both being
      // literal substrings is the evidence.  The interior is the gap between
      // them when they are disjoint, empty otherwise.  Only the containment
      // test differs from the ordered form — and because occurrences may
      // overlap or abut, `f.length > joinedLength` is too strict (grid
      // fragments of one whole sum past it; "red " + "circle" exactly equals
      // `red circle`).  The container must be a STRICT super-form of each
      // side, so that holding both is more than restating either.
      const li = indexOf(f, left, 0);
      const ri = li >= 0 ? indexOf(f, right, 0) : -1;
      if (
        li >= 0 && ri >= 0 && f.length > Math.max(left.length, right.length)
      ) {
        const lo = Math.min(li + left.length, ri + right.length);
        const hi = Math.max(li, ri);
        out.push({
          id: x,
          interior: lo < hi ? f.subarray(lo, hi) : f.subarray(0, 0),
        });
      }
    } else if (f.length > joinedLength) {
      const li = indexOf(f, left, 0);
      if (li >= 0) {
        const ri = indexOf(f, right, li + left.length);
        if (ri >= 0) {
          out.push({ id: x, interior: f.subarray(li + left.length, ri) });
        }
      }
    }
    if (d >= maxDepth) continue; // deeper ancestry is beyond phrase scale
    const parents = cachedParents(ctx, cache, x, bound + 1);
    if (parents.length <= bound) { // beyond √N parents: a hub, not expanded
      for (const p of parents) {
        if (!seen.has(p)) {
          seen.add(p);
          stack.push({ id: p, d: d + 1 });
        }
      }
    }
    // Containment fan-out under the SAME hub reading as parents: a node
    // whose containers fill a whole √N page is COMMON content — its
    // containment ancestry reaches a non-discriminative slice of the corpus
    // (the climb's saturation semantics), and walking it would spend the
    // entire budget discovering nothing a junction could use.  Such a node
    // is not expanded through containment; a pair whose sides are common
    // abstains here in a handful of pops and falls through to the resonance
    // tier.  Below the page bound the read IS the full container list, so
    // the walk stays exact exactly where identity evidence discriminates.
    const containers = cachedContainers(ctx, cache, x, bound);
    if (containers.length < bound) {
      for (const c of containers) {
        if (!seen.has(c)) {
          seen.add(c);
          stack.push({ id: c, d: d + 1 });
        }
      }
    }
  }
  return out;
}

/** Tier 1 entry point: every learnt whole that literally contains
 *  left-then-right, found by ascending the structural DAG (parents +
 *  containment links) from the two sides' content-addressed identities.
 *  Both sides' seeds resolved fresh, one call. */
export function junctionContainers(
  ctx: MindContext,
  left: Uint8Array,
  right: Uint8Array,
  maxContainer: number,
  unordered = false,
): Junction[] {
  return junctionContainersFrom(
    ctx,
    left,
    right,
    maxContainer,
    junctionSeeds(ctx, left),
    junctionSeeds(ctx, right),
    undefined,
    unordered,
  );
}

/** Tier 2.5: synonym junctions — the container ascent (tier 1) applied to
 *  halo siblings of left and right.  When a distributional synonym of one
 *  form participates in a learnt whole with the other form, the container
 *  between the synonym and the other side is valid evidence for the
 *  original pair.  The container evidence is exact (content-addressed DAG
 *  ascent, with window-id-enhanced seeds so non-W-aligned siblings still
 *  ascend); the relaxation is only in which form occupies one side — a
 *  distributional sibling rather than the exact form.
 *
 *  ONE expansion budget is shared by every sibling walk in this call, so
 *  cost is bounded at √N·W pops total regardless of how many siblings are
 *  tried.  A sibling whose bytes exceed `maxInterior` is skipped (it
 *  cannot be junction-sized). */
export async function junctionSynonyms(
  ctx: MindContext,
  left: Uint8Array,
  right: Uint8Array,
  maxInterior: number,
  unordered = false,
  sides?: JunctionSynonymSides,
): Promise<SynonymJunction[]> {
  const s = sides ?? await loadJunctionSynonymSides(ctx, left, right);
  if (s.leftId === null && s.rightId === null) return [];

  // ── Tier 2.5a: single-synonym — one side replaced by a halo sibling ──────
  // ONE shared expansion budget across BOTH directions of this tier.
  const singleBudget = { n: hubBound(ctx) * ctx.space.maxGroup };
  const singleOut = new Map<number, SynonymJunction>();
  const keepBest = (
    map: Map<number, SynonymJunction>,
    j: Junction,
    tier: SynonymJunctionTier,
    confidence: number,
  ) => {
    const prev = map.get(j.id);
    if (prev === undefined || confidence > prev.confidence) {
      map.set(j.id, { ...j, tier, confidence });
    }
  };

  // Left-side synonyms: containers of sibling+right.  `right`'s seeds are
  // FIXED across every sibling this loop tries.
  if (s.leftId !== null) {
    const rightSeeds = junctionSeeds(ctx, right);
    for (const sib of s.leftSiblings) {
      const sibBytes = read(ctx, sib.id, maxInterior + 1);
      if (sibBytes.length === 0 || sibBytes.length > maxInterior) continue;
      const containers = junctionContainersFrom(
        ctx,
        sibBytes,
        right,
        sibBytes.length + right.length + maxInterior,
        junctionSeeds(ctx, sibBytes),
        rightSeeds,
        singleBudget,
        unordered,
      );
      for (const c of containers) {
        keepBest(singleOut, c, "single-synonym", sib.score);
      }
    }
  }

  // Right-side synonyms: containers of left+sibling.  `left`'s seeds are
  // likewise fixed across this loop.
  if (s.rightId !== null) {
    const leftSeeds = junctionSeeds(ctx, left);
    for (const sib of s.rightSiblings) {
      const sibBytes = read(ctx, sib.id, maxInterior + 1);
      if (sibBytes.length === 0 || sibBytes.length > maxInterior) continue;
      const containers = junctionContainersFrom(
        ctx,
        left,
        sibBytes,
        left.length + sibBytes.length + maxInterior,
        leftSeeds,
        junctionSeeds(ctx, sibBytes),
        singleBudget,
        unordered,
      );
      for (const c of containers) {
        keepBest(singleOut, c, "single-synonym", sib.score);
      }
    }
  }

  if (singleOut.size > 0) return [...singleOut.values()];

  // ── Tier 2.5b: double-synonym — BOTH sides replaced, tried only when
  // single-synonym found NOTHING.  Every (leftSibling, rightSibling) pair,
  // sorted deterministically, bounded to haloQueryK pairs total, ONE fresh
  // shared budget for the whole tier. ─────────────────────────────────────
  if (s.leftSiblings.length === 0 || s.rightSiblings.length === 0) return [];

  const pairs: Array<{ l: Hit; r: Hit; confidence: number }> = [];
  for (const l of s.leftSiblings) {
    for (const r of s.rightSiblings) {
      pairs.push({ l, r, confidence: Math.min(l.score, r.score) });
    }
  }
  pairs.sort((a, b) =>
    b.confidence - a.confidence ||
    a.l.id - b.l.id ||
    a.r.id - b.r.id
  );

  const doubleOut = new Map<number, SynonymJunction>();
  const budget = { n: hubBound(ctx) * ctx.space.maxGroup };
  const tries = Math.min(pairs.length, ctx.cfg.haloQueryK);
  for (let i = 0; i < tries; i++) {
    const { l, r, confidence } = pairs[i];
    const lBytes = read(ctx, l.id, maxInterior + 1);
    const rBytes = read(ctx, r.id, maxInterior + 1);
    if (
      lBytes.length === 0 || lBytes.length > maxInterior ||
      rBytes.length === 0 || rBytes.length > maxInterior
    ) continue;
    const containers = junctionContainersFrom(
      ctx,
      lBytes,
      rBytes,
      lBytes.length + rBytes.length + maxInterior,
      junctionSeeds(ctx, lBytes),
      junctionSeeds(ctx, rBytes),
      budget,
      unordered,
    );
    for (const c of containers) {
      keepBest(doubleOut, c, "double-synonym", confidence);
    }
  }

  return [...doubleOut.values()];
}
