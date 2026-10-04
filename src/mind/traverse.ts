// traverse.ts — Traverse primitives + disambiguation (Sections 1 & 6 of the mind).
//
//   Traverse — node → nodes   (edgeAncestors, nextOf, prevOf, contains,
//                               guidedNext, chooseNext, chooseAmong, hubCap)
//
// The PROJECTIONS built on these walks (follow, conceptHop, reverseContext,
// project) live in match.ts — the elementary match-and-project operation.

import { cosine, Vec } from "../vec.js";
import type { AncestorReach, MindContext, SaturationStop } from "./types.js";
import { gistOf, read, resolve } from "./primitives.js";
import {
  canonicalWindows,
  chainReach,
  leafIdPrefix,
  leafIdRun,
} from "./canonical.js";
// Imported at the TOP, where every other import is.  They used to sit 800 lines
// down under a note claiming the position mattered ("before trace module is
// loaded") — it does not: an ES module's static imports are HOISTED, so the
// file's line order never decides load order.  The note described an intention
// the runtime does not honour; the imports move and the claim goes.
import { decodeText } from "./rationale.js";
import { concatBytes, indexOf, latin1 } from "../bytes.js";
import { type WindowIndex, windowIndex, witness } from "./evidence.js";
import type { RationaleItem } from "./rationale.js";

// ── Session structural memo ─────────────────────────────────────────────
//
// Between ingests the store is read-only, so structural reads are pure
// functions of the node id.  edgeAncestors climbs different start nodes that
// share ancestry (regions sharing a chunk, canonicalChunkId's prefix probes)
// — the reachMemo already caches whole-climb results, but a node visited as an
// INTERMEDIATE in one climb is re-read when it becomes a START in another.
// Caching per-node structural reads eliminates those duplicates.
//
// Each field is cached independently (lazy, separate maps) so that fetching
// hasNext never pulls prevCount or hasParents — those are only read when the
// caller genuinely needs them (hasParents is only called for the start node's
// containment check and voteRegions' canonical-id admission; never for
// intermediate nodes visited during a climb).

interface StructCache {
  hasNext: Map<number, boolean>;
  prevCount: Map<number, number>;
  hasParents: Map<number, boolean>;
}
//
// Budgeted on the same terms as the reach memo below (caches.md): these three
// maps are cleared on every write, but a long read-only session over a large
// store converges on one entry per node per map with nothing to bound it. Past
// the cap all three are dropped together and re-derived, costing cold
// structural probes and never a wrong answer.
const STRUCT_MEMO_MAX = 100_000;
const structCaches = new WeakMap<object, StructCache>();

// ── The shared ancestor-reach memo ──────────────────────────────────────
//
// `edgeAncestors` is a pure function of (node, N) over a read-only store —
// asking never writes — so its result is reusable for as long as the store
// is not written to.  There used to be TWO memos and they never met: the
// climb built a private one per call (computeAttention), while
// `Precomputed.reachMemo` — documented as "one response-scoped memo serves
// every mechanism that prices commonality" — was reached only by confluence.
// The climb is by far the biggest consumer.
//
// Keyed by the Mind's structural lifecycle identity: ordinary and
// conversational asks share it, and every ingest invalidates it. A real
// battery repeatedly reaches the same corpus scaffolding even when its
// surface questions differ.
//
// Budgeted, not unbounded (caches.md): past the cap the whole map is dropped
// and
// re-derived, costing a cold climb and never a wrong answer.
const REACH_MEMO_MAX = 100_000;
const reachCaches = new WeakMap<object, Map<number, AncestorReach>>();

/** The reach memo this ask should use — see the note above.
 *
 *  A TRACED response always gets a fresh, empty one. `AncestorReach`'s
 * `visited`/`maxDepth`/`saturation` fields are populated only when a trace is
 * attached, so an entry deposited by an untraced earlier turn would silently
 * black out the reach detail of a later traced one; and the trace's reach
 * payload is serialised by ITERATING this map, which must therefore hold what
 * THIS climb consulted, not the whole conversation's history. Consistent with
 * memoization.md: a traced response is a different machine — never benchmark
 * with a trace attached. */
export function sharedReachMemo(
  ctx: MindContext,
): Map<number, AncestorReach> {
  if (ctx.trace !== null || ctx.climbMemo === null) return new Map();
  let m = reachCaches.get(ctx._structMemoKey);
  if (m === undefined) reachCaches.set(ctx._structMemoKey, m = new Map());
  else if (m.size >= REACH_MEMO_MAX) m.clear();
  return m;
}

function getStructCache(ctx: MindContext): StructCache | null {
  if (ctx.climbMemo === null) return null;
  let c = structCaches.get(ctx._structMemoKey);
  if (c === undefined) {
    structCaches.set(
      ctx._structMemoKey,
      c = {
        hasNext: new Map(),
        prevCount: new Map(),
        hasParents: new Map(),
      },
    );
  } else if (
    c.hasNext.size >= STRUCT_MEMO_MAX ||
    c.prevCount.size >= STRUCT_MEMO_MAX ||
    c.hasParents.size >= STRUCT_MEMO_MAX
  ) {
    c.hasNext.clear();
    c.prevCount.clear();
    c.hasParents.clear();
  }
  return c;
}

/** Invalidate every session-lifetime structural read after a write. */
export function invalidateStructuralCaches(ctx: MindContext): void {
  reachCaches.delete(ctx._structMemoKey);
  structCaches.delete(ctx._structMemoKey);
}

/** Cached {@link Store.hasNext} — pure during one respond(). */
function cachedHasNext(
  ctx: MindContext,
  id: number,
  cache: StructCache | null,
): boolean {
  if (cache === null) return ctx.store.hasNext(id);
  let v = cache.hasNext.get(id);
  if (v === undefined) {
    v = ctx.store.hasNext(id);
    cache.hasNext.set(id, v);
  }
  return v;
}

/** Cached {@link Store.prevCount} — pure during one respond(). */
function cachedPrevCount(
  ctx: MindContext,
  id: number,
  cache: StructCache | null,
): number {
  if (cache === null) return ctx.store.prevCount(id);
  let v = cache.prevCount.get(id);
  if (v === undefined) {
    v = ctx.store.prevCount(id);
    cache.prevCount.set(id, v);
  }
  return v;
}

/** Cached {@link Store.hasParents} — pure during one respond(). */
function cachedHasParents(
  ctx: MindContext,
  id: number,
  cache: StructCache | null,
): boolean {
  if (cache === null) return ctx.store.hasParents(id);
  let v = cache.hasParents.get(id);
  if (v === undefined) {
    v = ctx.store.hasParents(id);
    cache.hasParents.set(id, v);
  }
  return v;
}

// ── Graph climbing ───────────────────────────────────────────────────────

/** Climb the structural DAG from a node to its edge-bearing ancestor contexts.
 *  Ascent stops at hub nodes (parents > √N) — their reach is non-discriminative.
 *  When the start node has no structural parents, climbs from containment parents
 *  (sub-span flat branches inheriting their chunks' context).
 *
 *  `memo`, when given, caches whole climbs by start id for the duration of ONE
 *  query (the store is read-only while a query is in flight, so a climb is a
 *  pure function of the id).  The consensus pipeline climbs the SAME anchors
 *  repeatedly — regions sharing a chunk, and canonicalChunkId probing each
 *  chunk's prefixes — so without the memo every repeat re-pays the full
 *  fan-out reads. */
export function edgeAncestors(
  ctx: MindContext,
  id: number,
  contextCount: number,
  memo?: Map<number, AncestorReach>,
): AncestorReach {
  const hit = memo?.get(id);
  if (hit !== undefined) return hit;

  // BYTE-ATOM COMMONALITY.  A single-byte leaf (implicit negative id) has no
  // structural parents BY CONSTRUCTION — atoms are never linked into the kid
  // or contain tables — so this climb cannot observe its containment at all.
  // The walk below would see only the atom's own direct edges and report
  // contextsReached ≈ 1, turning the MOST common content in the store into
  // the MOST discriminative voter (observed on a 325K-context store: every
  // recognised single-letter site voted full ln N for the one fact whose
  // continuation is that letter, and their pooled sum out-voted every
  // genuine anchor).  An unmeasurable containment must not default to
  // "maximally rare": it is bounded below by the uniform expectation over
  // the byte alphabet — N contexts, each at least one chunk of up to W of
  // the 256 possible atoms, reach ≥ N·W/256 contexts per atom on average
  // (see {@link atomReach}).  When that floor itself exceeds the hub bound
  // √N the atom is a hub at this corpus scale and the climb abstains
  // (saturated) — the atom's own edges remain fully traversable (tier-0
  // exact recall, chooseNext, project); only its say as a consensus voter
  // is withdrawn.  On a small store the floor stays ≤ √N and the atom
  // climbs exactly as before, so single-letter facts keep working.
  if (id < 0 && atomIsHub(ctx, contextCount)) {
    const bound0 = boundFor(contextCount);
    const reach: AncestorReach = {
      roots: [],
      contextsReached: 0,
      saturated: true,
      ...(ctx.trace
        ? {
          saturation: {
            reason: "byte-atom-commonality" as const,
            node: id,
            observed: atomReach(ctx, contextCount),
            limit: bound0,
          },
          visited: 0,
          maxDepth: 0,
        }
        : {}),
    };
    memo?.set(id, reach);
    return reach;
  }

  const bound = boundFor(contextCount);
  const roots: number[] = [];
  const seen = new Set<number>([id]);
  const ctxSeen = new Set<number>();
  let saturated = false;
  // Provenance of the FIRST decision that saturated this climb — allocated
  // only when a trace is requested (see AncestorReach.saturation's doc); the
  // climb itself never reads it back.
  let satStop: SaturationStop | undefined;

  // EXPAND-UNTIL-DECIDED: a reach is consumed either as a VOTE (which needs
  // contextsReached exactly, and only while ≤ √N — beyond that the region is
  // non-discriminative) or as an ABSTENTION (saturated — whose roots and
  // counts no consumer reads).  So the climb may STOP the moment the answer
  // is decided:
  //   • a node whose prev fan-in alone exceeds √N decides it (its
  //     predecessors are √N+ distinct contexts) — no read needed, prevCount
  //     is an indexed O(1);
  //   • distinct contexts crossing √N decides it;
  //   • a node with more than √N parents decides its own expansion (the
  //     classic hub guard; the walk aborts rather than continue, which no
  //     consumer can distinguish — saturated reaches are never voted).
  // Below every decision threshold the walk is EXACT — identical roots and
  // contexts to the unbounded climb — because prevFirst(√N) IS the full prev
  // list and parentsFirst(√N+1) IS the full parent list whenever they do not
  // decide.  Work is bounded by √N contexts × the climb's local structure,
  // never by the corpus.

  const structCache = getStructCache(ctx);

  // LATERAL-BRANCH ACCOUNT — the cumulative dual of the per-node hub guard.
  // Within one deposit the ascent is a CHAIN (each node's first parent);
  // every parent BEYOND a node's first is an entry into another containing
  // structure (hash-consing: a shared subtree's extra parents are other
  // deposits' chunks).  The per-node guard already declares a node with more
  // than √N parents non-discriminative; a climb whose ACCUMULATED lateral
  // entries exceed √N has spread across just as many distinct containing
  // structures — the same commonness, distributed along the cone instead of
  // concentrated at one node — and is decided: saturated.  A deep chain in
  // ONE structure accrues no laterals, so legitimate deep scaffolding (a
  // fragment far down a long cumulative context) still climbs to its root
  // at any depth; what dies is the cross-structure drift that visited tens
  // of thousands of edge-free interiors (profiled on a 17.7M-node store:
  // ~20K distinct nodes per climb family, >95% unique — not memoisable)
  // while the context account never decided.
  let lateral = 0;

  // CLIMB READ-OUT (pure instrumentation, same contract as satStop): the
  // parallel `depths` stack mirrors every push/pop of `stack`, so a node's
  // ascent distance is known at its pop.  Allocated only when a trace is
  // requested; the climb itself never reads any of these back.
  const depths: number[] | null = ctx.trace ? [] : null;
  let curDepth = 0;
  let visitedCount = 0;
  let maxDepth = 0;

  const visit = (x: number): boolean => {
    if (ctx.meter) ctx.meter.ancestorVisits++;
    if (depths) {
      visitedCount++;
      if (curDepth > maxDepth) maxDepth = curDepth;
    }
    const hasNx = cachedHasNext(ctx, x, structCache);
    const pc = cachedPrevCount(ctx, x, structCache);
    if (hasNx || pc > 0) {
      roots.push(x);
      if (hasNx) ctxSeen.add(x);
      if (pc > bound) {
        // decided: ≥ pc > √N distinct contexts
        if (ctx.trace) {
          satStop = {
            reason: "predecessor-fan-in",
            node: x,
            observed: pc,
            limit: bound,
          };
        }
        return false;
      }
      for (const p of ctx.store.prevFirst(x, bound)) ctxSeen.add(p);
      if (ctxSeen.size > bound) {
        // decided
        if (ctx.trace) {
          satStop = {
            reason: "distinct-context-limit",
            node: x,
            observed: ctxSeen.size,
            limit: bound,
          };
        }
        return false;
      }
    }
    const parents = ctx.store.parentsFirst(x, bound + 1);
    if (parents.length > bound) {
      // decided: hub
      if (ctx.trace) {
        satStop = {
          reason: "parent-fan-out",
          node: x,
          observed: parents.length,
          limit: bound,
        };
      }
      return false;
    }
    let fresh = 0;
    for (const p of parents) {
      if (!seen.has(p)) {
        seen.add(p);
        stack.push(p);
        depths?.push(curDepth + 1);
        fresh++;
      }
    }
    if (fresh > 1) {
      lateral += fresh - 1;
      if (lateral > bound) {
        // decided: cone-wide hub
        if (ctx.trace) {
          satStop = {
            reason: "lateral-cone-limit",
            node: x,
            observed: lateral,
            limit: bound,
          };
        }
        return false;
      }
    }
    return true;
  };

  const stack: number[] = [];
  const containment = !cachedHasParents(ctx, id, structCache);
  if (!containment) {
    stack.push(id);
    depths?.push(0);
  }

  // The containment seed is STREAMED in pages of √N: a distinctive window's
  // containers (which converge on one or two contexts, however many chunks
  // of one deposit repeat it) are walked IN FULL — exact — while a common
  // window's corpus-sized container list is abandoned at the first decision
  // above, after O(√N) pages at most (each page adds containers whose climbs
  // add contexts; √N distinct contexts decide).
  let containerOff = 0;
  let containersExhausted = !containment;
  climb:
  for (;;) {
    if (stack.length === 0) {
      if (containersExhausted) break;
      const page = ctx.store.containersSlice(id, containerOff, bound);
      containerOff += page.length;
      if (page.length < bound) containersExhausted = true;
      for (const c of page) {
        if (!seen.has(c)) {
          seen.add(c);
          stack.push(c);
          depths?.push(1);
        }
      }
      if (stack.length === 0) {
        if (containerOff === 0) {
          stack.push(id); // no containers at all
          depths?.push(0);
        } else break;
      }
    }
    while (stack.length > 0) {
      let x = stack.pop()!;
      if (depths) curDepth = depths.pop()!;
      // TRANSPARENT-CHAIN HOP: a node with no edges in or out and exactly one
      // parent contributes nothing here — no root, no context, no lateral
      // entry — so the run to its first non-transparent ancestor is skipped
      // in ONE store read (Store.chainRun) instead of three probes per node.
      // The interior nodes still enter `seen`, exactly as a node-at-a-time
      // ascent would have recorded them at push time, so sibling entries into
      // the same chain keep identical fresh/lateral accounting; and if the
      // terminal was already seen (another chain merged into this one first),
      // it is not visited twice — the same dedup the push-time seen-check
      // used to provide.
      const run = ctx.store.chainRun(x);
      if (run.length > 1) {
        const top = run[run.length - 1];
        const dup = seen.has(top);
        for (let i = 1; i < run.length; i++) seen.add(run[i]);
        if (dup) continue;
        x = top;
        // The chain's interior hops are part of the terminal's ascent
        // distance — count them exactly as a node-at-a-time ascent would.
        if (depths) curDepth += run.length - 1;
      }
      if (!visit(x)) {
        saturated = true;
        break climb;
      }
    }
  }

  const reach: AncestorReach = {
    roots,
    contextsReached: ctxSeen.size,
    saturated,
    ...(saturated && satStop ? { saturation: satStop } : {}),
    ...(depths ? { visited: visitedCount, maxDepth } : {}),
  };
  memo?.set(id, reach);
  return reach;
}

/** Convenience: forward edges of a node. */
export function nextOf(ctx: MindContext, id: number): number[] {
  return ctx.store.next(id);
}

/** Convenience: reverse edges of a node. */
export function prevOf(ctx: MindContext, id: number): number[] {
  return ctx.store.prev(id);
}

/** The uniform-expectation floor on a byte atom's corpus commonality: N
 *  learnt contexts, each at least one perception chunk of up to W of the 256
 *  possible byte values, contain a given atom in ≥ N·W/256 contexts on
 *  average.  An atom's TRUE containment is unmeasurable (atoms carry no
 *  kid/contain links by construction), so this floor is the honest stand-in:
 *  derived entirely from the corpus scale N, the perception window W, and
 *  the alphabet size — never tuned. */
export function atomReach(ctx: MindContext, contextCount: number): number {
  return Math.max(
    1,
    Math.ceil((contextCount * ctx.space.maxGroup) / 256),
  );
}

/** Whether a byte atom is a hub at this corpus scale — its commonality floor
 *  {@link atomReach} exceeds the hub bound √N.  Below it (small stores) an
 *  atom votes and is recognised exactly as any stored form; above it the
 *  alphabet is scaffolding everywhere and abstains. */
export function atomIsHub(ctx: MindContext, contextCount: number): boolean {
  return atomReach(ctx, contextCount) > boundFor(contextCount);
}

/** Cached "does this node bear a continuation edge?" — the CHEAP half of
 *  {@link leadsSomewhere}, exported for hot paths that must PRE-FILTER a
 *  candidate before paying for a fold and cannot afford the halo tier.
 *
 *  `leadsSomewhere`'s second tier (`hasHalo`) is deliberately uncached — one
 *  indexed point probe per candidate, which is right where candidates are
 *  already few.  On recognition's off-boundary chain pass they are not few:
 *  using the full predicate there took haloProbes from 922 to 9,144 on a
 *  nine-query battery over the trained store.  The edge tier alone is memoised
 *  for the response, so it is ~free, and a node bearing an edge is exactly the
 *  "deposited whole, not an interned fragment" claim that pass needs.
 *
 *  Strictly NARROWER than `leadsSomewhere` — a halo-only node reads false — so
 *  it is sound as a pre-filter before a consumer that applies the full
 *  predicate, and never as a replacement for it. */
export function bearsEdge(ctx: MindContext, id: number): boolean {
  return cachedHasNext(ctx, id, getStructCache(ctx));
}

/** Whether a node LEADS SOMEWHERE — the store's admission predicate
 * ({@link Store.leadsSomewhere}: edge or halo) with its edge tier memoised for
 * the response.  Recognition filters sites with it (cover.md): a form that
 * leads nowhere contributes nothing to any derivation. Runs once per candidate
 * span on the recognition hot path — `hasNext` is cached per response (the same
 * flat-branch ids are probed across prefix variants by canonicalChunkId).
 * `hasHalo` is not cached: it's a single indexed point probe per candidate, and
 * the candidates that reach this check have already been filtered by hasNext
 * above in edgeAncestors. */
export function leadsSomewhere(ctx: MindContext, id: number): boolean {
  const memo = getStructCache(ctx);
  if (cachedHasNext(ctx, id, memo)) return true;
  return ctx.store.hasHalo(id);
}

/** The structural IDF read of ONE node: how many distinct learnt contexts
 *  its containment/edge climb reaches, or Infinity when it reaches none or
 *  saturates (no usable identity evidence).  The number every
 *  discriminative-vs-scaffolding decision derives from — paired with the
 *  half-dominance convention (geometry.dominates(reach, N)): content
 *  reaching a corpus MINORITY of contexts discriminates (an entity, a
 *  filler); content reaching a majority is frame scaffolding. */
export function reachOf(
  ctx: MindContext,
  id: number,
  contextCount: number,
  memo?: Map<number, AncestorReach>,
): number {
  const r = edgeAncestors(ctx, id, contextCount, memo);
  if (r.saturated || r.roots.length === 0) return Infinity;
  return Math.max(1, r.contextsReached);
}

/** The corpus scale N — the count of DISTINCT learnt contexts, floored at 2
 *  so its derived readings (ln N in the consensus floor, √N in the hub bound)
 *  stay meaningful on a near-empty store.  The one definition every consumer
 *  of "how big is this corpus?" reads. */
export function corpusN(ctx: MindContext): number {
  return Math.max(2, ctx.store.edgeSourceCount());
}

/** The hub bound √N itself (≥ 2 always, since N is floored at 2) — for
 *  consumers that pass it to the store's LIMITed reads instead of capping a
 *  materialised list.  {@link hubCap} is the list-side reading of the same
 *  convention. */
export function hubBound(ctx: MindContext): number {
  return boundFor(corpusN(ctx));
}

/** √N for an EXPLICIT context count — the ctx-free reading of {@link
 *  hubBound}, for the callers inside this module that are handed a count
 *  rather than a context ({@link edgeAncestors}, {@link atomIsHub}).  The
 *  floor at 2 matches {@link corpusN}'s, so both readings agree for every
 *  input: the two used to be spelled out inline, once WITH the floor and
 *  once without, in the same function. */
function boundFor(contextCount: number): number {
  return Math.ceil(Math.sqrt(Math.max(2, contextCount)));
}

/** Cap a candidate list at the hub bound √N (insertion order) — the ONE
 * fan-out convention every walk and disambiguation uses (see bounded-reads.md).
 * A node connected to more than √N others is a hub whose individual connections
 * carry ~no discriminative information; materialising or scoring them all would
 * make single decisions scale with the corpus. */
export function hubCap<T>(
  ctx: MindContext,
  ids: readonly T[],
): readonly T[] {
  const bound = hubBound(ctx);
  return ids.length > bound ? ids.slice(0, bound) : ids;
}

/** Whether `descendant` lies within `ancestor`'s subtree — a structural DAG
 *  relation read off the hash-consed `kids` lists, by a bounded explicit-stack
 *  descent.  Used by articulation to keep a voice from revoicing a fragment
 *  OF that voice.
 *
 *  A HOMONYM, NOT A RELATIVE: the law's `Continuation.contains` (derivation.ts) is
 *  a producer's claim that its step IS a continuation, a boolean on one step.  This
 *  is a structural relation between two nodes in the DAG.  The shared word is
 *  deliberate vocabulary — "containment" is what both name — and the two must not be
 *  read as one. */
export function contains(
  ctx: MindContext,
  ancestor: number,
  descendant: number,
): boolean {
  if (ancestor === descendant) return true;
  const seen = new Set<number>([ancestor]);
  const stack = [ancestor];
  while (stack.length > 0) {
    const rec = ctx.store.get(stack.pop()!);
    if (!rec?.kids) continue;
    for (const k of rec.kids) {
      if (k === descendant) return true;
      if (!seen.has(k)) {
        seen.add(k);
        stack.push(k);
      }
    }
  }
  return false;
}

/** Whether a continuation edge joins the two forms, in either direction —
 *  the EXACT half's veto on calling them synonyms.
 *
 *  Halos measure company, and the strongest company any two forms can keep is
 * standing next to each other: a question and its answer co-occur in every
 * episode that taught the pair, so their halos SHOULD be similar, and on a
 * conversational store they are (measured on the CONV fixture: consecutive
 * turns at 0.809 against a 0.516 concept threshold). A gate reading halo cosine
 * alone therefore reads adjacency as synonymy and revoices an answer in the
 * words of the question it answers — "it hangs in madrid" spliced back into
 * "where is it kept now". The distributional layer cannot tell the two
 * relations apart, because to it they are the same observation; the exact half
 * can, for free, because it stored the edge. halo-sketch.md's division of
 * labour exactly: approximate proposes, exact decides.
 *
 *  Read LIMITed in both directions at the hub bound — a common continuation's
 *  fan-in is corpus-sized, and no single decision may scale with it. */
export function answers(
  ctx: MindContext,
  a: number,
  b: number,
): boolean {
  const bound = hubBound(ctx);
  if (ctx.store.hasNext(a) && ctx.store.nextFirst(a, bound).includes(b)) {
    return true;
  }
  return ctx.store.hasNext(b) && ctx.store.nextFirst(b, bound).includes(a);
}

// ── Edge disambiguation (Section 6) ──────────────────────────────────────

/** The best-scoring item by cosine against `query`, among items scoring at
 *  or above `threshold` — the shared arg-max every Pattern-A "which of these
 *  resonates best" decision reduces to.  `strict` picks the tie-break a
 *  caller needs: `true` keeps the first-seen leader on a tie (`>`), the
 *  default lets a later equal score take it (`>=`). */
export function argmaxBy<T>(
  items: Iterable<T>,
  scoreOf: (item: T) => number,
  threshold: number,
  strict: boolean = false,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = scoreOf(item);
    const bar = best?.score ?? threshold;
    if (strict ? score > bar : score >= bar) best = { item, score };
  }
  return best;
}

export function argmaxCosine<T>(
  query: Vec,
  items: Iterable<T>,
  vecOf: (item: T) => Vec | null | undefined,
  threshold: number,
  strict: boolean = false,
): { item: T; score: number } | null {
  return argmaxBy(
    items,
    (item) => {
      const v = vecOf(item);
      return v ? cosine(query, v) : -Infinity;
    },
    threshold,
    strict,
  );
}

/** The guided-or-first continuation of a node, as answer-shaped bytes source:
 *  chooseNext under the response guide, falling back to the FIRST-inserted
 *  edge — the one no-guide convention chooseNext, project() and the search's
 *  formRules all share.  undefined when the node has no continuation. */
export function guidedFirst(
  ctx: MindContext,
  id: number,
): number | undefined {
  const pick = guidedNext(ctx, id);
  if (pick !== undefined) return pick;
  // No guide in flight (or nothing chosen): the first-inserted edge, read
  // with LIMIT 1 — never the full fan-out.
  const nx = ctx.store.nextFirst(id, 1);
  return nx.length > 0 ? nx[0] : undefined;
}

export function guidedNext(
  ctx: MindContext,
  node: number,
): number | undefined {
  if (ctx._edgeGuide === null) return undefined;
  // The pick memo is BYPASSED while a rationale trace is attached — the same
  // policy climbMemo and recogniseMemo follow (every mechanism must emit its
  // own steps; a memo hit would swallow the repeat's `disambiguate` step).
  // Consistency does not need the memo: chooseNext is a pure function of the
  // (read-only) store, the guide and the consensus climb's points once they
  // exist (the memo is cleared when they arrive), so recomputation yields the
  // same pick.
  if (!ctx.trace) {
    const memo = ctx._edgeChoice.get(node);
    if (memo !== undefined) return memo === -1 ? undefined : memo;
  }
  const pick = chooseNext(ctx, node, ctx._edgeGuide);
  if (!ctx.trace) ctx._edgeChoice.set(node, pick ?? -1);
  return pick;
}

/** Disambiguate among a node's learnt continuations: first by the question's
 *  own witness of an establishing context (the exact tier, see
 *  {@link askedContinuations}), then by distributional support.  NOTE the
 *  `guide` contract: its VALUE is deliberately unused —
 *  only its PRESENCE gates disambiguation (a null guide means no query is in
 *  flight, so structural walkers keep plain first-edge behaviour).  The
 *  gist-cosine of short answer candidates against a query guide is dominated
 *  by accidental byte-pattern correlations, not semantic relatedness, so the
 *  evidence consulted is structural: each candidate's reverse-edge support
 *  count (see below).  Contrast {@link chooseAmong}, the REVERSE-direction
 *  disambiguator, whose candidates are whole learnt contexts — long enough
 *  that their perceived gists ARE semantically meaningful — and which
 *  therefore scores by guide cosine.  The two directions consult different
 *  halves of the evidence on purpose. */
export function chooseNext(
  ctx: MindContext,
  id: number,
  guide?: Vec | null,
): number | undefined {
  // CAPPED read: only the first √N continuations are ever candidates (the
  // documented hub trade), so only they are read — a hub context's full
  // fan-out is corpus-sized and must never be materialised.  hubBound ≥ 2,
  // so the single-continuation fast path below stays exact.
  const nx = ctx.store.nextFirst(id, hubBound(ctx));
  if (nx.length === 0) return undefined;
  if (nx.length === 1 || !guide) return nx[0];

  // THE EXACT TIER — the continuation the QUESTION names.  Every other
  // disambiguation below reads popularity, and is right to refuse the gist (see
  // the doc above); but the corpus also wrote down, for each continuation,
  // WHICH QUESTIONS IT ANSWERS — its establishing contexts — and a question is
  // not a gist.  When one of them is witnessed by the asker's bytes plus the
  // node's own, that continuation is the one being asked for.  Measured on the
  // 31.7M-node store: `Who is the father of Frederick II?` answered the
  // citizenship fact (the most-poured of eight) while `Frederick II father` —
  // one of the father fact's own establishing contexts — lay wholly inside the
  // question.  Exact, so it ranks first (exact-vs-approximate.md); when nothing
  // is witnessed the ladder below decides exactly as before.
  const asked = ctx._edgeAsked;
  const named = asked === null ? null : askedContinuations(ctx, id, nx, asked);
  if (named !== null && named.length === 1) return named[0];

  // Cap candidates at √N — the same bound the original chooseAmong used.
  // A hub context can accumulate thousands of continuations; the best-fit
  // one is among the first √N by insertion order (edges are never deleted,
  // so the oldest are the most established).  A strongly-supported edge
  // inserted beyond the cap is invisible here — the deliberate trade
  // against paying O(fan-out) count reads on every disambiguation.  Several
  // continuations named EQUALLY by the question are told apart by the same
  // ladder, over them alone.
  const capped = named ?? nx; // already the hub-capped prefix, by the read above

  // Distributional-evidence disambiguation, consulting BOTH read-outs of the
  // evidence the training poured:
  //   1. prevCount — how many DISTINCT contexts predict this candidate (one
  //      indexed COUNT; never a materialisation — a common continuation's
  //      reverse fan-in is corpus-sized).  Diversity of independent evidence
  //      is the primary signal: three different formulations agreeing beat
  //      one formulation repeated.
  //   2. haloMass — how many episode signatures were poured into the
  //      candidate's halo (repetition counts).  The tie-break among equally
  //      diverse candidates: a fact reinforced across many episodes is more
  //      corroborated than one seen once, and this is the DIRECT measure of
  //      that — consulting only the structural count would leave poured
  //      evidence on the table.
  // When both are equal, first-inserted wins (backward compatible).
  let best = capped[0];
  let bestSupport = ctx.store.prevCount(best);
  let bestMass = ctx.store.haloMass(best);
  for (let i = 1; i < capped.length; i++) {
    const support = ctx.store.prevCount(capped[i]);
    if (support < bestSupport) continue;
    const mass = ctx.store.haloMass(capped[i]);
    if (support > bestSupport || mass > bestMass) {
      best = capped[i];
      bestSupport = support;
      bestMass = mass;
    }
  }

  // NO consensusFloor gate here (tried and reverted — see
  // test/40-choosenext-scale-guard.test.mjs): that floor is calibrated for
  // POOLED, IDF-weighted CLIMB VOTES (recallByResonance, commitVotes), where
  // each corroborating region contributes at most ln N and the floor grows with
  // N exactly as that per-region ceiling does (thresholds.md). `bestSupport`
  // here is a different kind of quantity — a raw prevCount of how many training
  // contexts predicted ONE destination, bounded by how often that specific fact
  // was retold, never by corpus size N. Gating an N-invariant count against an
  // N-growing threshold guarantees failure once N is large enough, discarding
  // genuinely, structurally dominant edges (observed: a fact corroborated
  // 2-to-1-1-1 refused at N≈325K, falling back to a noisy concept-hop). The
  // loop above already IS the "genuinely competing" test: a tie leaves
  // first-inserted as the pick (test/30's own pinned behaviour); a strict
  // winner is real evidence regardless of corpus scale. Matches `chooseNext`'s
  // own pseudocode, which has no such floor.

  // Trace is built lazily — the filter + map below only execute when a
  // trace listener is attached, so the common (no-trace) path pays only
  // for the prevCount calls in the loop above, never for extra rItemShort
  // byte-reads.
  if (ctx.trace) {
    // A BOUNDED SAMPLE, AND THE COUNT.  The step used to carry EVERY candidate
    // it weighed — measured on the trained store, 1559 out-items in one step
    // (hubBound's own size) and 1082 in another (the hub's degree).  The
    // rationale's job is to explain the CHOICE, and the count is what says how
    // wide the field was; the declared candidate budget (`recallQueryK`) is what
    // bounds the sample, so no number is invented here.
    const others = capped
      .filter((c) => c !== best)
      .slice(0, ctx.cfg.rationaleSampleK);
    ctx.trace.step(
      "disambiguate",
      [rItemShort(ctx, best, "halo-evidence", bestSupport)],
      others.map((c) =>
        rItemShort(ctx, c, "candidate", ctx.store.prevCount(c))
      ),
      `${capped.length} continuations — distributional evidence selects ` +
        `the most corroborated (distinct contexts ${bestSupport}, ` +
        `poured mass ${bestMass})`,
    );
  }

  return best;
}

/** The response canonicalizer's reading of `bytes` when it keeps every offset
 *  — so a window found in the canonical bytes sits at the same place in the
 *  asker's — else the bytes themselves.  Text canon is offset-preserving on
 *  ASCII without interior whitespace runs; where it is not, the raw bytes are
 *  read and a case-variant window simply does not match. */
export function offsetCanon(ctx: MindContext, bytes: Uint8Array): Uint8Array {
  if (ctx.canon === null) return bytes;
  const c = ctx.canon(bytes);
  return c.length === bytes.length ? c : bytes;
}

/** A FRAGMENT ANSWERS OTHER QUESTIONS.  A recognised form that sits inside
 *  other forms (it has structural parents or containers) holds continuations
 *  because the forms it is a piece of were asked — suffix inheritance gives
 *  `f death` the answer of every `… place of death` question, and `director`
 *  the answer of every `… director` one.  Choosing one of several such
 *  continuations by popularity voices some other question's answer.  A
 *  fragment with several continuations leads somewhere FOR THIS QUESTION only
 *  when the question names one (the exact tier below).  A form that is
 *  (nearly) the whole question is not a piece of it: the question says
 *  nothing beyond it, so its continuations answer THIS question.  Read by
 *  every mechanism that projects through a recognised site (cover's sites,
 *  recall's argument binding). */
export function answersOtherQuestions(
  ctx: MindContext,
  id: number,
  queryLen: number,
  siteLen: number,
): boolean {
  const asked = ctx._edgeAsked;
  if (asked === null || queryLen - siteLen < ctx.space.maxGroup) return false;
  if (!(ctx.store.hasParents(id) || ctx.store.hasContainers(id))) return false;
  if (ctx.store.nextFirst(id, 2).length < 2) return false;
  return namedContinuations(ctx, id, asked) === null;
}

/** The continuations of `id` that `asked` NAMES (see {@link
 *  askedContinuations}) — for a caller holding material other than the whole
 *  question: the multi-hop walk asks with what of the question no product has
 *  restated yet.  null when none is named. */
export function namedContinuations(
  ctx: MindContext,
  id: number,
  asked: { bytes: Uint8Array; index: WindowIndex },
): number[] | null {
  const nx = ctx.store.nextFirst(id, hubBound(ctx));
  return nx.length === 0 ? null : askedContinuations(ctx, id, nx, asked);
}

/** The continuations of `id` (among `nx`) that the question NAMES: one of
 *  their establishing contexts — a predecessor other than `id` itself — is
 *  wholly witnessed by the question plus `id`'s own bytes (evidence.ts), with
 *  the question supplying at least one window the node does not.  Ranked by
 *  how much of the question witnesses it; null when none is named.
 *
 *  THE NODE'S OWN BYTES ARE MATERIAL because a derivation stands on them.  On
 *  the second hop of `Where was the place of death of the director of film
 *  Beat Girl?` the node is `Edmond T. Gréville` — reached, never written — and
 *  its fact's establishing context `Edmond T. Gréville place of death` is held
 *  by neither the question nor the node, only by both.  Measured over 5,236
 *  held-out 2Wiki questions: such a context is wholly witnessed by the
 *  question alone 69 times, by the question and the first hop 2,153 times.
 *
 *  BOUNDED: predecessor reads share one √N budget across the candidates (see
 *  the loop below), asked cheapest first; past it the tier abstains for the
 *  rest, metered, and the ladder decides as before.
 *  Each form is read at most to the material's length — a form longer than
 *  everything at hand cannot be wholly witnessed without repeating it. */
function askedContinuations(
  ctx: MindContext,
  id: number,
  nx: readonly number[],
  asked: { bytes: Uint8Array; index: WindowIndex },
): number[] | null {
  return askedEntry(ctx, id, nx, asked).named;
}

/** The question spans that NAMED `pick` among `id`'s continuations — the
 *  evidence a projection through that pick stands on, so a mechanism can
 *  account for what the question said about it (mechanism-market.md:
 *  evidence travels).  Empty when the question names no continuation of `id`
 *  or names others. */
export function askedEvidence(
  ctx: MindContext,
  id: number,
  pick: number,
): Array<[number, number]> {
  const asked = ctx._edgeAsked;
  if (asked === null) return [];
  const nx = ctx.store.nextFirst(id, hubBound(ctx));
  const entry = askedEntry(ctx, id, nx, asked);
  return entry.named?.includes(pick) ? entry.spans.get(pick) ?? [] : [];
}

interface AskedEntry {
  named: number[] | null;
  /** Per named continuation, the question spans that witnessed it. */
  spans: Map<number, Array<[number, number]>>;
}

function askedEntry(
  ctx: MindContext,
  id: number,
  nx: readonly number[],
  asked: { bytes: Uint8Array; index: WindowIndex },
): AskedEntry {
  let memo = askedMemo.get(asked);
  if (memo === undefined) askedMemo.set(asked, memo = new Map());
  const hit = memo.get(id);
  if (hit !== undefined && !ctx.trace) return hit;
  const entry = askedContinuationsImpl(ctx, id, nx, asked);
  // Nothing named before the climb has run is provisional: a co-instance
  // read from its points may still name one.
  if (entry.named !== null || ctx._edgeAsked?.points !== undefined) {
    memo.set(id, entry);
  }
  return entry;
}

/** One pick per node per question — every mechanism of a response asks the
 *  same node about the same question (the guided-pick memo's own reason). */
const askedMemo = new WeakMap<object, Map<number, AskedEntry>>();

function askedContinuationsImpl(
  ctx: MindContext,
  id: number,
  nx: readonly number[],
  asked: { bytes: Uint8Array; index: WindowIndex },
): AskedEntry {
  const none: AskedEntry = { named: null, spans: new Map() };
  const W = ctx.space.maxGroup;
  // A SATURATED READ IS NOT A CANDIDATE SET.  When the continuations came back
  // at the √N cap the read may have cut the named one off, so "none of these is
  // named" and "this is the named one" are both unfounded — and this is exactly
  // where witnessing would read most.  The tier abstains, metered, and the
  // distributional ladder decides as it always has.
  if (nx.length >= hubBound(ctx)) {
    if (ctx.meter) ctx.meter.askedReadsSaturated++;
    return none;
  }
  const cache = getStructCache(ctx);
  const ownCap = asked.bytes.length * W;
  const own = offsetCanon(ctx, read(ctx, id, ownCap));
  const ownIndex = windowIndex(own, W);
  // Naming needs the question to say at least one window the node does not:
  // when the node already holds every window of the question (the question IS
  // this context, or a piece of it), nothing can be named, and nothing is read.
  let beyond = false;
  for (const key of asked.index.keys()) {
    if (!ownIndex.has(key)) {
      beyond = true;
      break;
    }
  }
  if (!beyond) return none;
  const indexes = [asked.index, ownIndex];
  const formCap = asked.bytes.length + own.length;
  // BOUNDED READS (bounded-reads.md): the decision reads at most √N
  // establishing contexts — floored at the write side's own arity `chainReach(W)`
  // so a store too small for √N to cover one fact's questions still decides.
  // Candidates are asked CHEAPEST FIRST (fewest establishing contexts): a common
  // reply established by hundreds of contexts would otherwise spend the whole
  // allowance alone.  The order changes what is READ, never what wins: scores
  // are compared afterwards in the continuations' own order.
  const allowance = Math.max(hubBound(ctx), chainReach(W));
  let budget = allowance;
  const order = nx
    .map((n, at) => ({ n, at, support: cachedPrevCount(ctx, n, cache) }))
    .filter((c) => c.support >= 2) // only `id` establishes the rest
    .sort((a, b) => a.support - b.support || a.at - b.at);
  const scored: Array<
    {
      n: number;
      at: number;
      score: number;
      by: number;
      spans: Array<[number, number]>;
    }
  > = [];
  for (const { n, at, support } of order) {
    if (support > budget) {
      if (ctx.meter) ctx.meter.askedReadsSaturated++;
      break;
    }
    budget -= support;
    if (ctx.meter) ctx.meter.askedPredecessorReads += support;
    let score = 0;
    let by = -1;
    let spans: Array<[number, number]> = [];
    for (const c of ctx.store.prevFirst(n, support)) {
      if (c === id) continue;
      // The form's FIRST window decides most refusals: one short prefix read
      // before the whole form is reconstructed (a conversation-length
      // predecessor would otherwise be read in full to fail on its opening).
      const head = offsetCanon(ctx, read(ctx, c, W));
      if (head.length < W) continue;
      if (!indexes.some((ix) => ix.has(latin1(head)))) continue;
      // AN ESTABLISHING CONTEXT IS A DEPOSITED ONE.  A span interned inside
      // bigger forms inherits their edges (the fragment ` born?` leads to the
      // fact of every `Where was … born?` question), so witnessing it names
      // every one of them — measured on the 2Wiki fixture with one-hop
      // questions deposited, ` born?` named nine strangers' birthplaces.  The
      // structural predicate pivotInto already reads: a form with parents or
      // containers was never a context on its own.
      if (
        cachedHasParents(ctx, c, cache) || ctx.store.hasContainers(c)
      ) continue;
      const form = read(ctx, c, formCap + 1);
      if (form.length < W || form.length > formCap) continue;
      const w = witness(offsetCanon(ctx, form), indexes, W);
      if (!w.complete || w.bytes < W) continue;
      if (w.bytes > score) {
        score = w.bytes;
        by = c;
        spans = w.spans;
      }
    }
    if (score > 0) scored.push({ n, at, score, by, spans });
  }
  scored.sort((a, b) => a.at - b.at);
  let best: number[] = [];
  let bestBytes = 0;
  let witnessed: number | null = null;
  for (const { n, score, by } of scored) {
    if (score > bestBytes) {
      best = [n];
      bestBytes = score;
      witnessed = by;
    } else if (score === bestBytes) best.push(n);
  }
  if (best.length === 0) {
    return byCoInstance(ctx, id, nx, asked, formCap, allowance);
  }
  if (ctx.meter) ctx.meter.askedContinuations++;
  if (ctx.trace && witnessed !== null) {
    ctx.trace.step(
      "askedContinuation",
      [rItemShort(ctx, id, "node"), rItemShort(ctx, witnessed, "asked")],
      best.map((n) => rItemShort(ctx, n, "named")),
      `${nx.length} continuations — the question witnesses ` +
        `${best.length === 1 ? "one's" : `${best.length}'`} own establishing ` +
        `context (${bestBytes} question byte(s) beyond the node)`,
    );
  }
  const evidence = new Map<number, Array<[number, number]>>();
  for (const c of scored) if (best.includes(c.n)) evidence.set(c.n, c.spans);
  return { named: best, spans: evidence };
}

/** The climb's points the question HOLDS under the response's equivalence —
 *  stored forms whose canonical bytes occur in the question's, as sites.  The
 *  recognition walk matches bytes and the fold's own boundaries, so a stored
 *  `Man at Bath` inside `… of film Man At Bath work at?` is no site; the
 *  consensus climb reaches it through the windows the two spellings share, and
 *  containment under the canon (offset-preserving, so the span is the
 *  question's own) decides.  Approximate proposes, exact decides.  Read off
 *  the `chainReach(W)` most corroborated points; empty before the climb. */
export function canonHeldPoints(
  ctx: MindContext,
  minLen: number,
): Array<{ start: number; end: number; payload: number }> {
  const asked = ctx._edgeAsked;
  if (asked === null || asked.points === undefined || ctx.canon === null) {
    return [];
  }
  const W = ctx.space.maxGroup;
  const out: Array<{ start: number; end: number; payload: number }> = [];
  for (const id of asked.points.slice(0, chainReach(W))) {
    const raw = read(ctx, id, asked.bytes.length);
    if (raw.length < minLen || raw.length >= asked.bytes.length) continue;
    const form = ctx.canon(raw);
    if (form.length !== raw.length) continue;
    const at = indexOf(asked.bytes, form, 0);
    if (at >= 0) out.push({ start: at, end: at + raw.length, payload: id });
  }
  return out;
}

/** A CO-INSTANCE of the question: a stored form that shares the question's
 *  FRAME — the same opening and the same close, byte for byte under the
 *  response's equivalence — around ONE different filler.  `Where was Peter
 *  Jackson born?` against `Where was the director of film Beat Girl born?`
 *  shares `Where was ` and ` born?`, and leaves `Peter Jackson` against `the
 *  director of film Beat Girl`: another instance of the same question, never
 *  this one.  It is the ordered limit of witnessing: a frame is not a bag of
 *  windows (an order-free reading lets `Lyon is a city in France` pass for an
 *  instance of `what if the capital of France were Lyon?`, which NAMES Lyon;
 *  and a coincidental window inside a filler splits it).
 *
 *  The frame must reach one window, every window inside it must be held by
 *  the material (so on the walk, a frame a product already said cannot name a
 *  second step), and the form's filler must be a thing the corpus knows
 *  (below) — a record that differs from the question only inside the frame
 *  by a description (`converts sunlight into chemical energy` against
 *  `works`) is the same question about the frame's own subject.  (Requiring
 *  the two fillers to share no window as well was measured redundant with
 *  this and cost two answers on the 2Wiki fixture.)  Returns the form's filler span in `raw` and the
 *  question spans of the frame, or null.  One reading for every consumer: the
 *  exact tier transfers the relation through it, and the readers that would
 *  VOICE such a form's own continuation refuse it. */
export function coInstanceFiller(
  ctx: MindContext,
  raw: Uint8Array,
  indexes: ReadonlyArray<WindowIndex>,
  question: Uint8Array,
): { span: [number, number]; spans: Array<[number, number]> } | null {
  const W = ctx.space.maxGroup;
  const form = offsetCanon(ctx, raw);
  const max = Math.min(form.length, question.length);
  let a = 0;
  while (a < max && form[a] === question[a]) a++;
  let b = 0;
  while (
    b < max - a &&
    form[form.length - 1 - b] === question[question.length - 1 - b]
  ) b++;
  const fe = form.length - b;
  if (a + b < W || fe <= a || question.length - b <= a) return null;
  // Scaffolding is nobody's evidence, so a frame window that is a hub need not
  // be unsaid (` is ` in `Which country Leo Mittler is from?`, which the first
  // hop's `… is Arshad Khan.` already said).
  const hub = hubWindows(ctx, raw);
  const held = (o: number): boolean => {
    if (hub[o]) return true;
    const key = latin1(form.subarray(o, o + W));
    return indexes.some((ix) => ix.has(key));
  };
  for (let o = 0; o + W <= a; o++) if (!held(o)) return null;
  for (let o = fe; o + W <= form.length; o++) if (!held(o)) return null;
  // THE FILLER IS A THING THE CORPUS KNOWS: a stored context with
  // continuations of its own, opening where the slot opens (up to one window
  // earlier — a filler byte can sit in a window the question holds by chance:
  // the `T` of `Taika` inside `as t` of `was the`).  `Peter Jackson` is one;
  // `converts sunlight into chemical energy`, the slot of `Explain how
  // photosynthesis …`, is a description of the frame's own subject, and the
  // record answers the question.  The longest such context is the filler.
  // One content-addressed probe per byte (the `keyEnds` reading); only a run
  // some deposit spelled whole is looked up.
  const ids = leafIdPrefix(ctx, raw);
  let best: [number, number] | null = null;
  const cache = getStructCache(ctx);
  const reach = Math.min(ids.length, fe + W - 1);
  for (let st = Math.max(0, a - W + 1); st <= a; st++) {
    const run: number[] = [];
    for (let en = st + 1; en <= reach; en++) {
      run.push(ids[en - 1]);
      if (en - st < W) continue;
      // The flat branch over the whole run exists only where some deposit
      // spelled exactly these bytes — the cheap filter; the context it names
      // is then looked up by content.
      if (ctx.store.findBranch(run) === null) continue;
      if (best !== null && en - st <= best[1] - best[0]) continue;
      const id = resolve(ctx, raw.subarray(st, en));
      if (id !== null && cachedHasNext(ctx, id, cache)) best = [st, en];
    }
  }
  if (best === null) return null;
  const spans: Array<[number, number]> = [];
  if (a > 0) spans.push([0, a]);
  if (b > 0) spans.push([question.length - b, question.length]);
  return { span: best, spans };
}

/** THE RELATION, READ OFF ANOTHER INSTANCE — the exact tier's second reading,
 *  asked only when no establishing context of `id`'s continuations is
 *  witnessed outright.
 *
 *  `When was the director of film Jinpa born?` reaches `Pema Tseden`, whose
 *  date-of-birth fact is established by `Pema Tseden date of birth`: the
 *  question says `born`, the corpus says `date of birth`, and no window joins
 *  them.  What can join them is ANOTHER INSTANCE of the same question.  A
 *  stored context the question witnesses in every byte but ONE contiguous span
 *  (`When was Peter Jackson born?`, residue `Peter Jackson`) is the question's
 *  own frame around a different filler — a CO-INSTANCE.  Its continuation is
 *  established by other contexts too (`Peter Jackson date of birth`), and one
 *  that holds the filler is the relation spelled the way the corpus spells it.
 *  Put this node where the filler was and look the result up by content:
 *  `Pema Tseden date of birth` exists, and its continuation is named.
 *
 *  Nothing here is stored as a unit — not `born` ≈ `date of birth`, not the
 *  frame — and nothing is approximate: the co-instance is witnessed, the
 *  substitution is bytes, the target is an exact lookup that either exists
 *  with this node's continuation or does not.  A frame the question shares only
 *  partly (`Where was … born?` against `When was …`) leaves two residues and
 *  is no co-instance.
 *
 *  BOUNDED: the frames are a property of the question and are read once per
 *  question (`relationFrames`); co-instances are proposed by the edge-bearing
 *  ancestors of its windows (`edgeAncestors`, the climb's own memoised reach;
 *  a saturated window proposes nothing), rarest first, at most `allowance` of
 *  them, each read once.  A node pays one exact lookup per frame. */
function byCoInstance(
  ctx: MindContext,
  id: number,
  nx: readonly number[],
  asked: { bytes: Uint8Array; index: WindowIndex },
  formCap: number,
  allowance: number,
): AskedEntry {
  const none: AskedEntry = { named: null, spans: new Map() };
  const frames = relationFrames(ctx, asked, allowance);
  if (frames.length === 0) return none;
  const node = read(ctx, id, formCap);
  const support = new Map<number, Set<number>>();
  const spans = new Map<number, Array<[number, number]>>();
  const via = new Map<number, { q: number; t: number }>();
  for (const fr of frames) {
    const t = resolve(ctx, concatBytes([fr.prefix, node, fr.suffix]));
    if (t === null || t === id) continue;
    for (const n of ctx.store.nextFirst(t, allowance)) {
      if (!nx.includes(n)) continue;
      let by = support.get(n);
      if (by === undefined) support.set(n, by = new Set());
      for (const q of fr.by) by.add(q);
      if (!spans.has(n)) {
        spans.set(n, fr.spans);
        via.set(n, { q: fr.by[0], t });
      }
    }
  }
  let best: number[] = [];
  let most = 0;
  for (const n of nx) {
    const k = support.get(n)?.size ?? 0;
    if (k === 0) continue;
    if (k > most) {
      best = [n];
      most = k;
    } else if (k === most) best.push(n);
  }
  if (best.length === 0) return none;
  if (ctx.meter) ctx.meter.coInstanceNamings++;
  const first = via.get(best[0]);
  if (ctx.trace && first !== undefined) {
    ctx.trace.step(
      "askedByCoInstance",
      [
        rItemShort(ctx, id, "node"),
        rItemShort(ctx, first.q, "co-instance"),
        rItemShort(ctx, first.t, "asked"),
      ],
      best.map((n) => rItemShort(ctx, n, "named")),
      `${nx.length} continuations — no establishing context is witnessed; ` +
        `${most} co-instance(s) of the question carry the relation to ` +
        `${best.length === 1 ? "one" : best.length} of them`,
    );
  }
  const evidence = new Map<number, Array<[number, number]>>();
  for (const n of best) evidence.set(n, spans.get(n) ?? []);
  return { named: best, spans: evidence };
}

/** One RELATION FRAME read off a co-instance: an establishing context of the
 *  co-instance's continuation with the filler cut out (`Peter Jackson place
 *  of birth` → `` + · + ` place of birth`).  Any node put in the gap spells
 *  that node's context for the same relation. */
interface RelationFrame {
  /** The co-instances that spell the relation this way (first one traced). */
  by: number[];
  prefix: Uint8Array;
  suffix: Uint8Array;
  spans: Array<[number, number]>;
}

/** The relation frames the question's co-instances carry — a property of the
 *  QUESTION, not of the node asked about, so it is read once per question
 *  (and once per walk material) and every node only pays the exact lookups.
 *  A question the corpus holds verbatim is its own instance and reads none. */
function relationFrames(
  ctx: MindContext,
  asked: { bytes: Uint8Array; index: WindowIndex },
  allowance: number,
): RelationFrame[] {
  // A co-instance is the question's frame around ONE other filler, so it is
  // read at most to twice the question's length.
  const formCap = 2 * asked.bytes.length;
  const hit = frameMemo.get(asked);
  if (hit !== undefined && !ctx.trace) return hit;
  const whole = ctx._edgeAsked;
  // THE PROPOSALS ARE THE CLIMB'S.  The consensus climb already scored the
  // stored forms the question's regions reach — measured on the 2Wiki
  // fixture with one-hop questions, the co-instances were among its points —
  // so the tier reads co-instances from those and climbs nothing of its own.
  // Before the climb has run there is nothing to read, and nothing is
  // remembered: a later ask, after the climb, reads its points.
  const points = whole?.points;
  if (points === undefined) return [];
  const frames: RelationFrame[] = [];
  frameMemo.set(asked, frames);
  if (whole !== null && resolve(ctx, whole.bytes) !== null) return frames;
  const W = ctx.space.maxGroup;
  const cache = getStructCache(ctx);
  const deposited = (c: number): boolean =>
    !cachedHasParents(ctx, c, cache) && !ctx.store.hasContainers(c);
  const spelled = new Map<string, RelationFrame>();
  // Most corroborated first (the climb's own ranking), at most
  // `chainReach(W)` read — the exact tier's own floor.
  const proposals = points.filter((c) => cachedHasNext(ctx, c, cache))
    .slice(0, Math.min(allowance, chainReach(W)));
  for (const q of proposals) {
    if (!deposited(q)) continue;
    const raw = read(ctx, q, formCap + 1);
    if (raw.length > formCap) continue;
    if (ctx.meter) ctx.meter.coInstanceReads++;
    const co = coInstanceFiller(ctx, raw, [asked.index], asked.bytes);
    if (co === null) continue;
    const [fs, fe] = co.span;
    const filler = raw.subarray(fs, fe);
    for (const f of ctx.store.nextFirst(q, W)) {
      for (const c of ctx.store.prevFirst(f, allowance)) {
        if (c === q || !deposited(c)) continue;
        const cb = read(ctx, c, formCap + 1);
        const at = indexOf(cb, filler, 0);
        if (at < 0) continue;
        const prefix = cb.subarray(0, at);
        const suffix = cb.subarray(at + filler.length);
        if (prefix.length + suffix.length === 0) continue;
        const key = latin1(prefix) + "\u0000" + latin1(suffix);
        const known = spelled.get(key);
        if (known === undefined) {
          spelled.set(key, { by: [q], prefix, suffix, spans: co.spans });
        } else if (!known.by.includes(q)) known.by.push(q);
      }
    }
  }
  // ONE INSTANCE AGREES WITH NOTHING.  A relation is read off the corpus only
  // where two co-instances spell it the same way — the agreement `reference`
  // demands of a frame (MIN_INSTANCES), for the same reason: a single
  // coincidental alignment is not evidence of what the frame means.  Measured
  // on the trained store, long dialogue turns proposed hundreds of one-off
  // "frames", each an exact lookup for every node asked about.
  for (const fr of spelled.values()) if (fr.by.length >= 2) frames.push(fr);
  frames.sort((a, b) => b.by.length - a.by.length);
  return frames;
}
const frameMemo = new WeakMap<object, RelationFrame[]>();

/** The perceived gist of a candidate node, through the session gist cache.
 *  Re-gisting a candidate is a full river fold of its bytes — the measured
 *  recall bottleneck (a hub context offers up to √N continuations, EACH
 *  re-perceived per pick).  A node's bytes are immutable and perception is
 *  pure, so the cached gist is valid for the store's lifetime.  Exported for
 *  every "score node ids against a guide" decision (chooseAmong here, the
 *  bridge's junction pick) so they share ONE cache and one convention. */
export function candidateGist(ctx: MindContext, c: number): Vec | null {
  const hit = ctx._gistCache.get(c);
  if (hit !== undefined) return hit;
  const b = read(ctx, c);
  if (b.length === 0) return null;
  const g = gistOf(ctx, b);
  ctx._gistCache.set(c, g);
  return g;
}

export function chooseAmong(
  ctx: MindContext,
  candidates: readonly number[],
  guide: Vec,
): { id: number; score: number } {
  const capped = hubCap(ctx, candidates);
  const found = argmaxCosine(
    guide,
    capped,
    (c) => candidateGist(ctx, c),
    -Infinity,
    true,
  );
  return found
    ? { id: found.item, score: found.score }
    : { id: candidates[0], score: -Infinity };
}

function rItemShort(
  ctx: MindContext,
  id: number,
  role?: string,
  score?: number,
): RationaleItem {
  return {
    text: decodeText(read(ctx, id)),
    node: id,
    role,
    score,
  };
}

/** True when NO window of `query` discriminates anything — every stored
 *  W-window it spells is contained by more places than the hub bound allows,
 *  i.e. the whole query is corpus-global scaffolding.
 *
 * WHAT IT IS FOR. Several mechanisms ground a query through the literal spans
 * it
 * did NOT explain, and those spans are the whole of their evidence. When every
 * one of them is a hub, the query says nothing the corpus can be held to, and
 * grounding it means picking one of thousands of continuations it gives no
 * evidence for — a fabrication whatever the answer happens to be. Answering
 * with silence there is the honest degradation contract (INVARIANTS.md).
 *
 *  MEASURED SEPARATION (trained store, hubBound 571) — this is categorical,
 *  not marginal, and it is why the predicate lives here rather than being
 *  spelled twice:
 *    "What is the capital of"  ALL saturated ("What":572)  → fabricated
 *    "What is the capital "    ALL saturated ("What":572)  → fabricated
 *    "what is the capital of france"  min "f fr":248       → correct
 *    "What is the capitol of France?" min "f Fr":114       → correct
 *    "WHAT IS THE CAPITAL OF FRANCE?" min "HE C":1         → correct
 *    "What  is   the capital  of France?" min "t  i":4     → correct
 *    "Who wrote Romeo and Juliet?"    min "iet?":26        → correct
 *    "What is the capital of Zamunda?" min "Zamu":3        → silent anyway
 *  Note the last: the honest-silence probes are already refused on other
 *  evidence and sit on the SAME side as the correct ones, so this predicate
 *  is not what makes them silent and cannot be credited for them.
 *
 *  NO NEW THRESHOLD (thresholds.md): `hubBound` is the √N reading of "hub" used
 * everywhere, and the containment read is clamped to it exactly as every other
 * fan-out read is (bounded-reads.md). A query with no stored window at all is
 * NOT scaffolding-only — it has no evidence either way, and its callers already
 * refuse it on their own terms. */
export function allWindowsAreScaffolding(
  ctx: MindContext,
  query: Uint8Array,
): boolean {
  const W = ctx.space.maxGroup;
  const bound = hubBound(ctx);
  let sawOne = false;
  for (let o = 0; o + W <= query.length; o++) {
    const ids = leafIdRun(ctx, query, o, o + W);
    if (ids === null) continue;
    const id = ctx.store.findBranch(ids);
    if (id === null) continue;
    const rarity = ctx.store.containersSlice(id, 0, bound + 1).length;
    if (rarity === 0) continue;
    if (rarity <= bound) return false;
    sawOne = true;
  }
  return sawOne;
}

/** Per offset of `bytes`: 1 when the W-window there is a stored form contained
 *  in more than √N places (corpus-global scaffolding; see the floor below),
 *  else 0.  Memoised per
 *  byte array for the life of the store's read-only response. */
export function hubWindows(ctx: MindContext, bytes: Uint8Array): Uint8Array {
  const hit = hubWindowMemo.get(bytes);
  if (hit !== undefined) return hit;
  const W = ctx.space.maxGroup;
  // Floored at the write side's arity: inside ONE deposit's fold a window is
  // already contained by up to `chainReach(W)` chunks and branches, so on a
  // store of a few facts the √N reading would call every window frame — that
  // is fold structure, not corpus commonality.
  const bound = Math.max(hubBound(ctx), chainReach(W));
  const hub = new Uint8Array(Math.max(0, bytes.length - W + 1));
  for (let o = 0; o < hub.length; o++) {
    const ids = leafIdRun(ctx, bytes, o, o + W);
    const id = ids === null ? null : ctx.store.findBranch(ids);
    if (id !== null && ctx.store.containersSlice(id, bound, 1).length > 0) {
      hub[o] = 1;
    }
  }
  hubWindowMemo.set(bytes, hub);
  return hub;
}
const hubWindowMemo = new WeakMap<Uint8Array, Uint8Array>();

/** The query's SCAFFOLDING CORE, as spans: the bytes every W-window over which
 *  is a hub (see {@link hubWindows}) — what is nothing but frame, where
 *  {@link scaffoldExtents} is what a frame window reaches. */
export function scaffoldSpans(
  ctx: MindContext,
  query: Uint8Array,
): Array<[number, number]> {
  const W = ctx.space.maxGroup;
  const hub = hubWindows(ctx, query);
  const n = hub.length;
  if (n <= 0) return [];
  const spans: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < query.length; i++) {
    let all = true;
    for (let o = Math.max(0, i - W + 1); o <= Math.min(i, n - 1); o++) {
      if (!hub[o]) {
        all = false;
        break;
      }
    }
    if (all && start < 0) start = i;
    if (!all && start >= 0) {
      spans.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) spans.push([start, query.length]);
  return spans;
}

/** The EXTENTS of the query's SCAFFOLDING windows, merged: every byte some
 *  W-window reaches that is a stored form contained in more than √N places —
 *  corpus-global commonality (commonality.md), the same "hub" reading as
 *  {@link allWindowsAreScaffolding} and the bridge's `explainedSpan`.  A window
 *  the store never saw is NOT scaffolding.  The extent, not the core, is what
 *  a coverage test needs: a span that still holds one hub window can be
 *  "carried" by any fact that holds that window. */
export function scaffoldExtents(
  ctx: MindContext,
  query: Uint8Array,
): Array<[number, number]> {
  const W = ctx.space.maxGroup;
  const hub = hubWindows(ctx, query);
  const spans: Array<[number, number]> = [];
  for (let o = 0; o < hub.length; o++) {
    if (!hub[o]) continue;
    const last = spans[spans.length - 1];
    if (last !== undefined && o <= last[1]) last[1] = o + W;
    else spans.push([o, o + W]);
  }
  return spans;
}

// ── THE PREFIX SUPPLY ───────────────────────────────────────────────────────
//
// A RETRIEVAL capability, not a grounding one: "which trained forms does this
// byte run OPEN?"  It lived inside a recall tier, which is the wrong altitude
// — it reads the write side's own leaf-id window index and answers a question
// about the STORE, so any mechanism may ask it.

/** Trained forms the query may OPEN, proposed from the write side's own
 *  leaf-id window index — the supply of last resort for prefix completion.
 *
 *  WHY A SECOND SUPPLY EXISTS.  The ranked list prefix completion normally reads
 *  is a resonance list, and resonance cannot rank a proper prefix: measured on
 *  the trained store, cos(prefix, form) falls from 0.9629 at a one-byte
 *  truncation to 0.6206 at three bytes, against a reachThreshold of 0.8750.
 *  Three bytes of truncation put the answer out of reach on GEOMETRY, not on a
 *  bug, so no k and no re-ranking recovers it.
 *
 *  WHY THIS ROUTE WORKS WHERE THE FOLD DOES NOT.  A query's own fold is
 *  useless here: content addressing is not phrase-position-invariant, so a
 *  standalone prefix folds to a DIFFERENT node than the same bytes sitting
 *  inside a longer deposit, and neither the prefix's own node nor its
 *  ancestors lead to the deposit (measured: the 22-byte prefix of the
 *  photosynthesis form resolves, is shared by 6 contexts, and does not have
 *  the form among its ancestors).  Leaf ids ARE position-invariant — they are
 *  content-addressed on single bytes — and `indexSubSpans` already interns a
 *  flat branch over every canonical WINDOW of a deposit's leaf-id stream, with
 *  containment edges to the chunks that window spans.  A query that is a
 *  prefix therefore shares those window nodes exactly, and reaches the deposit
 *  by climbing containment then parents.  Nothing is added to the write side;
 *  this reads an index training already built.
 *
 *  BOUNDED (bounded-reads.md), AND WITH NO NEW THRESHOLD. The window whose
 * containment is SMALLEST carries the most evidence, and one saturated at
 * `hubBound` carries none — that is the same √N reading of "hub" the rest of
 * the mind uses, not a tuned knob. The upward walk spends a budget of
 * `hubBound` nodes and fans out by W, so a hub query enumerates nothing and the
 * caller stays silent rather than guessing (INVARIANTS.md). Measured on the
 * trained store: the photosynthesis form at a one-byte truncation picks a
 * window with 52 containers, visits 446 nodes, and yields exactly ONE candidate
 * that survives the caller's byte compare — the form itself.
 *
 *  These are PROPOSALS only. Every candidate still faces the byte-exact prefix
 * compare and all three guards below, so a wrong proposal costs one bounded
 * read and can never be voiced (exact-vs-approximate.md). */
export function formsOpenedBy(
  ctx: MindContext,
  query: Uint8Array,
): number[] {
  const store = ctx.store;
  const W = ctx.space.maxGroup;
  const run = leafIdPrefix(ctx, query);
  // The widest canonical window is the most discriminative one the write side
  // ever interned; a query too short to spell one carries no window evidence.
  const len = canonicalWindows(W)[1];
  if (run.length < len) return [];
  const bound = hubBound(ctx);

  let best: number | null = null;
  let bestN = 0;
  for (let off = 0; off + len <= run.length; off++) {
    const wid = store.findBranch(run.slice(off, off + len));
    if (wid === null) continue;
    const n = store.containersSlice(wid, 0, bound).length;
    // Empty says the window spans no chunk; saturated says it is a hub, whose
    // containment discriminates nothing.  Neither is evidence.
    if (n === 0 || n >= bound) continue;
    if (best === null || n < bestN) {
      best = wid;
      bestN = n;
    }
  }
  if (best === null) return [];

  let frontier = store.containersSlice(best, 0, bound);
  const seen = new Set<number>(frontier);
  let budget = bound;
  while (frontier.length > 0 && budget > 0) {
    const next: number[] = [];
    for (const f of frontier) {
      if (budget-- <= 0) break;
      for (const p of store.parentsFirst(f, W)) {
        if (seen.has(p)) continue;
        seen.add(p);
        next.push(p);
      }
    }
    frontier = next;
  }
  return [...seen];
}
