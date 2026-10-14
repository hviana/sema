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
 *  a distributional halo sibling — the rung of the graded ladder below exact
 *  DAG containment (see {@link junctionSynonyms}). */
export type SynonymJunctionTier = "single-synonym";

export interface SynonymJunction extends Junction {
  tier: SynonymJunctionTier;
  /** The substituted sibling's score. */
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

/** One EQUIVALENCE VARIANT of a pair: one side (or both) replaced by an
 *  attested halo sibling.  Its confidence is the weaker replaced side's score. */
export interface PairVariant {
  kind: "left-synonym" | "right-synonym" | "double-synonym";
  confidence: number;
  leftId?: number;
  rightId?: number;
}

const VARIANT_ORDER: Record<PairVariant["kind"], number> = {
  "left-synonym": 0,
  "right-synonym": 1,
  "double-synonym": 2,
};

/** THE EQUIVALENCE VARIANTS of a pair — the one enumeration every reader of
 *  "the pair up to attested synonyms" takes (the synonym junctions, the
 *  structural-resonance composition): each side replaced by a halo sibling,
 *  and, with `double`, both.  Ordered by confidence, then kind (left, right,
 *  double), then sibling ids — the corpus's order on a tie.  Cost-free: no
 *  sibling is read here. */
export function pairVariants(
  sides: JunctionSynonymSides,
  double: boolean,
): PairVariant[] {
  const out: PairVariant[] = [];
  for (const l of sides.leftSiblings) {
    out.push({ kind: "left-synonym", confidence: l.score, leftId: l.id });
  }
  for (const r of sides.rightSiblings) {
    out.push({ kind: "right-synonym", confidence: r.score, rightId: r.id });
  }
  if (double) {
    for (const l of sides.leftSiblings) {
      for (const r of sides.rightSiblings) {
        out.push({
          kind: "double-synonym",
          confidence: Math.min(l.score, r.score),
          leftId: l.id,
          rightId: r.id,
        });
      }
    }
  }
  return out.sort((a, b) =>
    b.confidence - a.confidence ||
    VARIANT_ORDER[a.kind] - VARIANT_ORDER[b.kind] ||
    (a.leftId ?? -1) - (b.leftId ?? -1) ||
    (a.rightId ?? -1) - (b.rightId ?? -1)
  );
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

/** Session cache of the identity walks' pure reads (capped bytes,
 *  parent pages, container pages), keyed by the write-invalidated structural
 *  lifecycle object. One response issues many walks whose ancestries overlap
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
const WALK_CACHE_MAX = 100_000;
export function walkCache(ctx: MindContext): WalkCache | null {
  if (ctx.climbMemo === null) return null;
  let c = walkCaches.get(ctx._structMemoKey);
  if (c === undefined) {
    walkCaches.set(
      ctx._structMemoKey,
      c = { reads: new Map(), parents: new Map(), containers: new Map() },
    );
  } else if (
    c.reads.size + c.parents.size + c.containers.size >= WALK_CACHE_MAX
  ) {
    c.reads.clear();
    c.parents.clear();
    c.containers.clear();
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
 *
 *     REFUTED TIGHTENING (measured, 325K contexts): giving this walk
 *     edgeAncestors' cumulative LATERAL-CONE limit — abstain once the
 *     accumulated lateral entries pass √N — would cut most of the pops (47
 *     of 56 walks exceed √N lateral, and 47 exhaust the budget), but TWO OF
 *     THE FOUR walks that actually found a container had lateral spread of
 *     1425 and 1426, far past √N.  The cone limit is sound for
 *     edgeAncestors' question and wrong for this one: a junction container
 *     is legitimately reached across many containing structures.  Half the
 *     successful junctions would be lost.
 *
 * REFUTED EARLY-STOP (side-cone exhaustion, saturation.md's "real saturation"):
 *     stopping the walk the moment ONE side's upward cone is emptied is wrong,
 *     in both a hub-guarded form and a hub-flagged form.  The junction test is
 *     a BYTE containment over the UNION of the two cones, and a junction can be
 *     structurally reachable from only ONE side — the side whose seed is a
 *     FOLD sub-node of the container (test/16: "cold or hot" is reached from
 *     the window "cold", but the 3-byte answer "hot" is not a 4-byte window of
 *     it, so "hot"'s cone is empty while the junction still lies ahead in
 *     "cold"'s cone; test/34's n-ary binding fails the hub-guarded form the
 *     same way).  "One cone exhausted" therefore never proves "no junction
 *     left", and the walk must keep the √N·W budget as its NET after the
 *     per-node saturations below.
 *   • per-node hub guards — parent fan-outs beyond √N are hubs (not
 *     expanded); each node contributes at most one √N page of containers;
 *     √N collected candidates decide. */
/** How a holders walk climbs — the parameters in which the engine's readers
 *  legitimately differ, each named once. */
export interface HolderWalk {
  /** Surfaces climbed from each node: the chunks it IS (parents) and the
   *  chunks it SPANS (containers). */
  readonly containers: boolean;
  /** Depth first (a stack) or breadth first (a queue). */
  readonly order: "dfs" | "bfs";
  /** Levels above the seeds a node may be expanded from. */
  readonly maxDepth: number;
  /** Bytes read per visited node; a node longer than this cannot be a holder
   *  and, its ancestors being larger still, its branch is PRUNED.  Infinity
   *  reads whole forms and prunes nothing. */
  readonly maxBytes: number;
  /** Rows read per node and surface.  With `hub`, a node whose surface holds
   *  MORE than this many rows is a hub and is not expanded through it (read
   *  one past the page to tell a full page from a saturated one, test/34). */
  readonly fan: number;
  readonly hub: boolean;
  /** The net: pops shared by every walk of one tier.  Running out is an
   *  abstention, reported as such — never read as "nothing is held". */
  readonly budget: { n: number };
  /** Holders that decide the walk. */
  readonly limit: number;
  /** Whether a node longer than `maxBytes` is pruned (else it is read up to
   *  the cap and decided on that prefix). */
  readonly prune?: boolean;
  /** Nodes never visited (already read below the seeds). */
  readonly skip?: Iterable<number>;
  /** The meter's name for one visit. */
  readonly visits?: "junctionPops" | "holderVisits";
}

/** THE HOLDERS of byte material — the one exploration of the content-addressed
 *  ascent.  No index says who holds a span: a window's containment rows are
 *  the chunks it OVERLAPS, so holders are PROPOSED by climbing from content-
 *  addressed seeds through parents and containers, and DECIDED by their own
 *  bytes (`decide`, which reads the node's bytes and returns a holder or
 *  null) — exact decides, the climb proposes.  Returns the holders found and
 *  whether the net ran out first. */
export function holdersFrom<T>(
  ctx: MindContext,
  seeds: readonly number[],
  decide: (bytes: () => Uint8Array, id: number) => T | null,
  walk: HolderWalk,
): { found: T[]; exhausted: boolean } {
  const cache = walkCache(ctx);
  const found: T[] = [];
  const seen = new Set<number>([...seeds, ...(walk.skip ?? [])]);
  const frontier: Array<{ id: number; d: number }> = seeds.map((id) => ({
    id,
    d: 0,
  }));
  let head = 0;
  const pending = (): boolean =>
    walk.order === "dfs" ? frontier.length > 0 : head < frontier.length;
  const take = (): { id: number; d: number } =>
    walk.order === "dfs" ? frontier.pop()! : frontier[head++];
  // OLDEST FIRST: rows come back in insertion order, and a stack visits the
  // first-listed first only when they are pushed in reverse — ties are the
  // corpus's order (determinism.md), the same for every walk.
  const push = (ids: readonly number[], d: number): void => {
    if (walk.hub && ids.length > walk.fan) return;
    const fresh = ids.filter((p) => !seen.has(p));
    for (const p of fresh) seen.add(p);
    if (walk.order === "dfs") fresh.reverse();
    for (const p of fresh) frontier.push({ id: p, d });
  };
  const rows = walk.hub ? walk.fan + 1 : walk.fan;
  while (pending() && found.length < walk.limit) {
    if (walk.budget.n-- <= 0) return { found, exhausted: true };
    const { id: x, d } = take();
    if (ctx.meter) ctx.meter[walk.visits ?? "junctionPops"]++;
    // Bytes are read when the decision asks for them — or first, when a node
    // past the cap prunes its branch before anything else is read above it.
    let f: Uint8Array | undefined;
    const bytesOf = (): Uint8Array =>
      f ??= Number.isFinite(walk.maxBytes)
        ? cachedRead(ctx, cache, x, walk.maxBytes)
        : read(ctx, x);
    if (walk.prune !== false && Number.isFinite(walk.maxBytes)) {
      if (bytesOf().length > walk.maxBytes) continue; // prune the branch
    }
    const held = decide(bytesOf, x);
    if (held !== null) found.push(held);
    if (d >= walk.maxDepth) continue;
    push(cachedParents(ctx, cache, x, rows), d + 1);
    if (walk.containers) push(cachedContainers(ctx, cache, x, rows), d + 1);
  }
  return { found, exhausted: false };
}

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
   *  about the learnt whole.  Only the byte-containment test gains a second
   *  probe. */
  unordered = false,
): Junction[] {
  const bound = hubBound(ctx);
  const joinedLength = left.length + right.length;
  const seeds = [...new Set([...leftSeeds, ...rightSeeds])];
  if (seeds.length === 0) return [];
  if (ctx.meter) ctx.meter.junctionWalks++;
  const { found, exhausted } = holdersFrom(
    ctx,
    seeds,
    (bytes, x): Junction | null => {
      const f = bytes();
      if (unordered) {
        // Order-free containment does NOT require disjoint occurrences: two
        // grid-aligned fragments of the same whole legitimately OVERLAP inside
        // it, and both being literal substrings is the evidence.  The
        // container must be a STRICT super-form of each side.
        const li = indexOf(f, left, 0);
        const ri = li >= 0 ? indexOf(f, right, 0) : -1;
        if (
          li < 0 || ri < 0 || f.length <= Math.max(left.length, right.length)
        ) {
          return null;
        }
        const lo = Math.min(li + left.length, ri + right.length);
        const hi = Math.max(li, ri);
        return {
          id: x,
          interior: lo < hi ? f.subarray(lo, hi) : f.subarray(0, 0),
        };
      }
      if (f.length <= joinedLength) return null;
      const li = indexOf(f, left, 0);
      if (li < 0) return null;
      const ri = indexOf(f, right, li + left.length);
      return ri < 0
        ? null
        : { id: x, interior: f.subarray(li + left.length, ri) };
    },
    {
      containers: true,
      order: "dfs",
      // a junction container is phrase-scale: within ~W levels of its parts
      maxDepth: ctx.space.maxGroup,
      maxBytes: maxContainer,
      fan: bound,
      hub: true,
      budget: budget ?? { n: bound * ctx.space.maxGroup },
      limit: bound,
    },
  );
  if (exhausted && ctx.meter) ctx.meter.junctionBudgetExhausted++;
  return found;
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
  sharedBudget?: { n: number },
): Promise<SynonymJunction[]> {
  const s = sides ?? await loadJunctionSynonymSides(ctx, left, right);
  if (s.leftId === null && s.rightId === null) return [];

  // ── Tier 2.5a: single-synonym — one side replaced by a halo sibling ──────
  // ONE shared expansion budget across BOTH directions.
  const singleBudget = sharedBudget ??
    { n: hubBound(ctx) * ctx.space.maxGroup };
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

  // Each single-synonym variant: the container ascent over the sibling and
  // the other side, whose seeds are computed once.
  const fixed = new Map<"left" | "right", number[]>();
  const seedsOfSide = (side: "left" | "right"): number[] => {
    let v = fixed.get(side);
    if (v === undefined) {
      fixed.set(side, v = junctionSeeds(ctx, side === "left" ? left : right));
    }
    return v;
  };
  for (const v of pairVariants(s, false)) {
    const sib = v.leftId ?? v.rightId!;
    const sibBytes = read(ctx, sib, maxInterior + 1);
    if (sibBytes.length === 0 || sibBytes.length > maxInterior) continue;
    const onLeft = v.leftId !== undefined;
    const [l, r] = onLeft ? [sibBytes, right] : [left, sibBytes];
    const containers = junctionContainersFrom(
      ctx,
      l,
      r,
      l.length + r.length + maxInterior,
      onLeft ? junctionSeeds(ctx, sibBytes) : seedsOfSide("left"),
      onLeft ? seedsOfSide("right") : junctionSeeds(ctx, sibBytes),
      singleBudget,
      unordered,
    );
    for (const c of containers) {
      keepBest(singleOut, c, "single-synonym", v.confidence);
    }
  }

  // (A double-synonym tier — BOTH sides replaced by halo siblings, tried when
  // no single replacement found a container — was measured to find nothing
  // the suite or three 2Wiki fixtures used, and removed.)
  return [...singleOut.values()];
}
