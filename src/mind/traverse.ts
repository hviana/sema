// traverse.ts — Traverse primitives + disambiguation (Sections 1 & 6 of the mind).
//
//   Traverse — node → nodes   (edgeAncestors, nextOf, prevOf, contains,
//                               guidedNext, chooseNext, chooseAmong, hubCap)
//
// The PROJECTIONS built on these walks (follow, conceptHop, reverseContext,
// project) live in match.ts — the elementary match-and-project operation.

import { cosine, Vec } from "../vec.js";
import { dominates } from "../geometry.js";
import type { AncestorReach, MindContext, SaturationStop } from "./types.js";
import { canonResolve, gistOf, read, resolve } from "./primitives.js";
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
import { bytesEqual, concatBytes, indexOf, latin1 } from "../bytes.js";
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

/** A derivation read off an instance, and the entities a fact holds, depend
 *  on the instance, the fact and the store — never on the question — so they
 *  are kept for the session like the climb's reach, and dropped on a write. */
interface DerivationCache {
  paths: Map<string, Step[][]>;
  slots: Map<string, { span: [number, number]; id: number } | null>;
  converges: Map<string, Array<[Arrival, Arrival]>>;
  facts: Map<number, Map<string, Step>>;
  described: Map<string, Step[] | null>;
  entities: Map<number, Array<{ span: [number, number]; id: number }>>;
}
const derivationCaches = new WeakMap<object, DerivationCache>();
function derivationCache(ctx: MindContext): DerivationCache | null {
  if (ctx.trace !== null || ctx.climbMemo === null) return null;
  let c = derivationCaches.get(ctx._structMemoKey);
  if (c === undefined) {
    derivationCaches.set(
      ctx._structMemoKey,
      c = {
        paths: new Map(),
        entities: new Map(),
        described: new Map(),
        facts: new Map(),
        slots: new Map(),
        converges: new Map(),
      },
    );
  } else if (
    c.paths.size >= STRUCT_MEMO_MAX || c.entities.size >= STRUCT_MEMO_MAX
  ) {
    c.paths.clear();
    c.entities.clear();
    c.described.clear();
    c.facts.clear();
    c.slots.clear();
    c.converges.clear();
  }
  return c;
}

/** Invalidate every session-lifetime structural read after a write. */
export function invalidateStructuralCaches(ctx: MindContext): void {
  reachCaches.delete(ctx._structMemoKey);
  structCaches.delete(ctx._structMemoKey);
  derivationCaches.delete(ctx._structMemoKey);
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
 *  when the question names one (the exact tier below).  So does a fragment
 *  with ONE continuation that was never learnt as a context — no company of
 *  its own (halo): every continuation it holds is inherited, and which one
 *  depends on deposit order (`ther` carried only the last `… mother` fact it
 *  was found reused in).  A form learnt as a context (`Tell me about X`'s `X`,
 *  a defined term) keeps its one continuation.  A form that is
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
  const nx = ctx.store.nextFirst(id, 2).length;
  if (nx === 0 || (nx < 2 && ctx.store.haloMass(id) > 0)) return false;
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
  // A pick made before the climb has run is provisional: a co-instance read
  // from its points may still name one, or outrank what witnessing named.  It
  // serves until the points arrive, and is then made once more.
  const climbed = ctx._edgeAsked?.points !== undefined;
  const hit = memo.get(id);
  if (hit !== undefined && !ctx.trace && (hit.climbed || !climbed)) {
    return hit.entry;
  }
  const entry = askedContinuationsImpl(ctx, id, nx, asked);
  memo.set(id, { entry, climbed });
  return entry;
}

/** One pick per node per question — every mechanism of a response asks the
 *  same node about the same question (the guided-pick memo's own reason). */
const askedMemo = new WeakMap<
  object,
  Map<number, { entry: AskedEntry; climbed: boolean }>
>();

function askedContinuationsImpl(
  ctx: MindContext,
  id: number,
  nx: readonly number[],
  asked: { bytes: Uint8Array; index: WindowIndex },
): AskedEntry {
  const W = ctx.space.maxGroup;
  const allowance = Math.max(hubBound(ctx), chainReach(W));
  const formCap = asked.bytes.length + offsetCanon(
    ctx,
    read(ctx, id, asked.bytes.length * W),
  ).length;
  const seen = witnessedEntry(ctx, id, nx, asked);
  // ONE MEASURE FOR BOTH READINGS.  A continuation is named by the question
  // material that evidences it: witnessing, by the question bytes an
  // establishing context holds; another instance, by the question's frame it
  // shares.  `In which country was the paternal grandmother of Z born?`
  // witnesses `Z mother` with the `mother` inside `grandmother` (10 bytes),
  // while three instances of the whole frame (40 bytes) spell `· father` there:
  // the reading that explains more of the question names the step.
  if (seen === null) return none();
  if (seen.entry.named !== null) {
    // A frame a material holds the whole question holds too, so the whole
    // question's frames (read once per question) bound what another instance
    // could evidence here: when none spans more of the question than the
    // witnessing did, the reading cannot outrank it and is not made.
    const whole = ctx._edgeAsked;
    const most = whole === null ? 0 : Math.max(
      0,
      ...relationFrames(ctx, whole, allowance).map((fr) =>
        fr.spans.reduce((a, [s, e]) => a + e - s, 0)
      ),
    );
    if (most <= seen.bytes) return seen.entry;
  }
  const other = byCoInstance(ctx, id, nx, asked, formCap, allowance);
  if (seen.entry.named === null) return other;
  // The reading that explains more of the question names the step, whether
  // it names another continuation or fewer of the same: a derivation that
  // says what its entity must be withholds the siblings witnessing cannot
  // tell apart.
  if (
    other.named !== null &&
    (other.named.length !== seen.entry.named.length ||
      other.named.some((n) => !seen.entry.named!.includes(n)))
  ) {
    const framed = Math.max(
      ...other.named.map((n) =>
        (other.spans.get(n) ?? []).reduce((a, [s, e]) => a + e - s, 0)
      ),
    );
    if (framed > seen.bytes) return other;
  }
  return seen.entry;
}
const none = (): AskedEntry => ({ named: null, spans: new Map() });

/** The witnessing reading alone: the continuations of `id` one of whose
 *  establishing contexts the question (plus `id`'s bytes) holds whole, with
 *  the question bytes that witnessed the best — or null when the tier
 *  abstains outright (a saturated read, or a question that says nothing
 *  beyond the node). */
function witnessedEntry(
  ctx: MindContext,
  id: number,
  nx: readonly number[],
  asked: { bytes: Uint8Array; index: WindowIndex },
): { entry: AskedEntry; bytes: number } | null {
  const none: AskedEntry = { named: null, spans: new Map() };
  const W = ctx.space.maxGroup;
  // A SATURATED READ IS NOT A CANDIDATE SET.  When the continuations came back
  // at the √N cap the read may have cut the named one off, so "none of these is
  // named" and "this is the named one" are both unfounded — and this is exactly
  // where witnessing would read most.  The tier abstains, metered, and the
  // distributional ladder decides as it always has.
  if (nx.length >= hubBound(ctx)) {
    if (ctx.meter) ctx.meter.askedReadsSaturated++;
    return null;
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
  if (!beyond) return null;
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
  if (best.length === 0) return { entry: none, bytes: 0 };
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
  return { entry: { named: best, spans: evidence }, bytes: bestBytes };
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
): {
  span: [number, number];
  spans: Array<[number, number]>;
  filler: number;
  open: number;
  close: number;
} | null {
  const frame = coInstanceFrame(ctx, raw, indexes, question);
  if (frame === null) return null;
  // The entity the slot opens with, or — a description first — ends with: the
  // reading the derivation's own instances take (`slotSteps`).
  const found = slotEntity(ctx, raw, frame.open, raw.length - frame.close) ??
    closingEntity(ctx, raw, frame.open, raw.length - frame.close);
  return found === null
    ? null
    : { ...frame, span: found.span, filler: found.id };
}

/** The FRAME half of {@link coInstanceFiller}: the opening and close `raw`
 *  shares with the question, every window of them held by the material and at
 *  least one of them discriminating — or null.  It reads no store but the hub
 *  probes, so a reader that asks it of one form against several materials (the
 *  walk's, after each product) pays the filler search only once. */
function coInstanceFrame(
  ctx: MindContext,
  raw: Uint8Array,
  indexes: ReadonlyArray<WindowIndex>,
  question: Uint8Array,
): { open: number; close: number; spans: Array<[number, number]> } | null {
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
  const spans: Array<[number, number]> = [];
  if (a > 0) spans.push([0, a]);
  if (b > 0) spans.push([question.length - b, question.length]);
  return { open: a, close: b, spans };
}

/** Whether `bytes` are already in the response canonicalizer's form. */
function readUnderCanon(ctx: MindContext, bytes: Uint8Array): boolean {
  return ctx.canon !== null && bytesEqual(ctx.canon(bytes), bytes);
}

/** The ENTITY a slot holds: the longest stored context with continuations of
 *  its own (a thing the corpus knows) that covers the byte where the two forms
 *  part.  The slot of `raw` lies between its opening `[0, open)` and its close
 *  at `end`.
 *
 *  `Peter Jackson` is one; `converts sunlight into chemical energy`, the slot of
 *  `Explain how photosynthesis …`, is a description of the frame's own subject.
 *  THE FILLER IS WHAT DIFFERS, so it reaches past the opening: the `mother`
 *  inside a frame's own `grandmother` is frame.  It may open up to
 *  `chainReach(W)` bytes before the openings part — the reach of the write
 *  side's canonical chains; fillers that begin alike (`Princess Louise …`,
 *  `Princess Augusta …`) share their first word — and end up to one window into
 *  the close (a filler byte can sit in a window the question holds by chance:
 *  the `T` of `Taika` inside `as t` of `was the`).  It need not fill the slot:
 *  the record's `John V` is the question's `John V, Count Of Oldenburg`.  An
 *  exact run some deposit spelled whole is looked up first; a filler the record
 *  spells only under the response's equivalence (`3Rd Baron` for the stored
 *  `3rd Baron`) has no flat run of its own, and the canonical class is asked
 *  where the exact reading found nothing — or, for bytes already under the
 *  canon, for anything longer than it found. */
function slotEntity(
  ctx: MindContext,
  raw: Uint8Array,
  open: number,
  end: number,
  ownSpelling = false,
): { span: [number, number]; id: number } | null {
  const W = ctx.space.maxGroup;
  const ids = leafIdPrefix(ctx, raw);
  const cache = getStructCache(ctx);
  const reach = Math.min(ids.length, end + W - 1);
  let span: [number, number] | null = null;
  let id: number | null = null;
  const scan = (exact: boolean): void => {
    for (let st = open; st >= Math.max(0, open - chainReach(W)); st--) {
      for (let en = reach; en - st >= W && en > open; en--) {
        if (span !== null && en - st <= span[1] - span[0]) break;
        if (st + raw.length - en < W) continue;
        if (exact && ctx.store.findBranch(ids.slice(st, en)) === null) continue;
        // A longer reading of the same entity holds the exact one.
        if (!exact && span !== null && (st > span[0] || en < span[1])) continue;
        const n = exact
          ? resolve(ctx, raw.subarray(st, en))
          : canonResolve(ctx, raw.subarray(st, en));
        if (n === null || !cachedHasNext(ctx, n, cache)) continue;
        [span, id] = [[st, en], n];
        break;
      }
    }
  };
  scan(true);
  // The LONGEST, across both readings, where the bytes are read under the
  // canon already: the question's `eric i of denmark` holds short exact runs
  // (`mark`) inside the entity only its canonical class spells, and the
  // canonical pass is asked for longer spans that hold the exact one.  A form
  // in its own spelling holds its names exactly.
  // A stored form in its own spelling holds its names exactly; only a
  // question is read under the response's equivalence.
  if (
    !ownSpelling && ctx.canon !== null &&
    (span === null || readUnderCanon(ctx, raw))
  ) {
    scan(false);
  }
  return span === null || id === null ? null : { span, id };
}

/** The entity at a slot's CLOSE: {@link slotEntity} read from the other
 *  boundary — the longest stored context with continuations that covers the
 *  last byte of the slot.  A description reads before its entity (`the
 *  paternal grandmother of Z`), so the entity is what differs at the close.
 *  It may run up to `chainReach(W)` bytes past the slot (names that end
 *  alike) and begin up to one window before it. */
function closingEntity(
  ctx: MindContext,
  raw: Uint8Array,
  open: number,
  end: number,
): { span: [number, number]; id: number } | null {
  const W = ctx.space.maxGroup;
  const ids = leafIdPrefix(ctx, raw);
  const cache = getStructCache(ctx);
  const first = Math.max(0, open - W + 1);
  let span: [number, number] | null = null;
  let id: number | null = null;
  const scan = (exact: boolean): void => {
    const last = Math.min(ids.length, end + chainReach(W));
    for (let en = end; en <= last; en++) {
      for (let st = first; en - st >= W && st < end; st++) {
        if (span !== null && en - st <= span[1] - span[0]) break;
        if (st + raw.length - en < W) continue;
        if (exact && ctx.store.findBranch(ids.slice(st, en)) === null) continue;
        // A longer reading of the same entity holds the exact one.
        if (!exact && span !== null && (st > span[0] || en < span[1])) continue;
        const n = exact
          ? resolve(ctx, raw.subarray(st, en))
          : canonResolve(ctx, raw.subarray(st, en));
        if (n === null || !cachedHasNext(ctx, n, cache)) continue;
        [span, id] = [[st, en], n];
        break;
      }
    }
  };
  scan(true);
  // The longest across both readings, as `slotEntity`.
  if (ctx.canon !== null && (span === null || readUnderCanon(ctx, raw))) {
    scan(false);
  }
  return span === null || id === null ? null : { span, id };
}

/** What a slot SAYS of its entity: the entity (the longest stored context
 *  with continuations covering the parting byte, `slotEntity`) and the steps
 *  the rest of the slot applies to it.  An entity that fills the slot, up to
 *  less than one window, takes none.  A remainder other forms hold around
 *  another entity is a DESCRIPTION, read off them (`describedSteps`: `Y's
 *  dad`, `the paternal grandmother of Z`).  Else a remainder that names one
 *  fact of the entity, witnessed by the slot's own material, is that step
 *  (`Eleanor of Aquitaine's father`); one that names several is
 *  `undetermined`; one that names none (`(1259–1321)` after `Blanche of
 *  Portugal`) only QUALIFIES an entity the slot opens with, and takes no step.
 *  An entity found only at the slot's close (`closingEntity`) leaves the
 *  forms parting on the remainder, which must then be read, or the slot is
 *  `undetermined`.  null: the slot holds no entity to read. */
/** What `slotSteps` reads of a slot: its entity and the steps the rest of the
 *  slot applies to it, or an entity whose remainder determines nothing. */
type SlotReading =
  | { x: { span: [number, number]; id: number }; steps: Step[] }
  | { x: { span: [number, number]; id: number }; undetermined: true };

function slotSteps(
  ctx: MindContext,
  bytes: Uint8Array,
  open: number,
  end: number,
  instance?: { frame: number },
): SlotReading | null {
  const W = ctx.space.maxGroup;
  const opening = slotEntity(ctx, bytes, open, end);
  const x = opening ?? closingEntity(ctx, bytes, open, end);
  if (x === null) return null;
  const said = Math.max(
    0,
    Math.min(end, x.span[1]) - Math.max(open, x.span[0]),
  );
  if (end - open - said < W) return { x, steps: [] };
  // AN INSTANCE SHARES MORE THAN IT DIFFERS.  A form whose slot says more
  // beyond its entity than the frame it shares with the question (`Who is Y's
  // paternal grandmother?` against `Who is the maternal grandfather of Z?`:
  // `Who is `·`?`, 8 bytes, against 23) is another question, not this one's
  // frame around another filler.
  if (instance !== undefined && end - open - said > instance.frame) {
    return null;
  }
  // The forms that hold the whole remainder read all of it; witnessing reads
  // a word of it (`father` in `Y's grandma on the father's side`) and is asked
  // only where no form does.
  const described = describedSteps(ctx, bytes, x, open, end);
  if (described !== null) return { x, steps: described };
  const slot = bytes.subarray(open, end);
  const nx = ctx.store.nextFirst(x.id, hubBound(ctx));
  const seen = witnessedEntry(ctx, x.id, nx, {
    bytes: slot,
    index: windowIndex(offsetCanon(ctx, slot), W),
  });
  const named = seen?.entry.named ?? null;
  // A remainder nothing reads QUALIFIES an entity the forms part on; where
  // they part on the remainder itself — the entity only at the slot's close —
  // they differ by more than a filler, and the slot determines nothing.
  if (named === null) {
    return opening === null ? { x, undetermined: true } : { x, steps: [] };
  }
  if (named.length !== 1) return { x, undetermined: true };
  // The step is the named fact's establishing context with the entity cut.
  const xb = read(ctx, x.id);
  for (const c of ctx.store.prevFirst(named[0], hubBound(ctx))) {
    if (c === x.id) continue;
    const cb = read(ctx, c, bytes.length + xb.length + 1);
    const at = indexOf(cb, xb, 0);
    if (at < 0) continue;
    return {
      x,
      steps: [{
        prefix: cb.subarray(0, at),
        suffix: cb.subarray(at + xb.length),
      }],
    };
  }
  return { x, undetermined: true };
}

/** Whether `steps` begins with `head`, step for step, byte for byte. */
function startsWith(steps: Step[], head: Step[]): boolean {
  return head.length <= steps.length &&
    head.every((h, i) =>
      bytesEqual(h.prefix, steps[i].prefix) &&
      bytesEqual(h.suffix, steps[i].suffix)
    );
}

/** What a DESCRIPTION in a slot names — the sequence of steps it applies to
 *  its entity — read off the forms that hold the same description around
 *  another entity.  `Y's dad` is held by `Who is Z's dad?` (whose derivation
 *  from `Z` is `· father`) and by `Where was Z's dad born?` (`· father →
 *  · place of birth`): a description is applied first, nearest its entity, so
 *  what it names is the BEGINNING those derivations share.  The shortest
 *  sequence two forms spell alike is the reading, if every other sequence two
 *  forms spell begins with it; otherwise, or with none, nothing is read.  The
 *  forms come from the description's rarest window (`siblingInstances`).
 *  Kept for the session by the description's bytes. */
function describedSteps(
  ctx: MindContext,
  bytes: Uint8Array,
  x: { span: [number, number]; id: number },
  open: number,
  end: number,
): Step[] | null {
  const W = ctx.space.maxGroup;
  const s0 = Math.max(open, Math.min(x.span[0], end));
  const e0 = Math.min(end, Math.max(x.span[1], open));
  const before = offsetCanon(ctx, bytes.subarray(open, s0));
  const after = offsetCanon(ctx, bytes.subarray(e0, end));
  if (before.length + after.length < W) return null;
  const memo = derivationCache(ctx);
  const key = "d" + latin1(before) + "\u0000" + latin1(after);
  if (memo?.described.has(key)) return memo.described.get(key)!;
  const allowance = Math.max(hubBound(ctx), chainReach(W));
  const cache = getStructCache(ctx);
  const deposited = (c: number): boolean =>
    !cachedHasParents(ctx, c, cache) && !ctx.store.hasContainers(c);
  const spans: Array<[number, number]> = [];
  if (before.length > 0) spans.push([open, s0]);
  if (after.length > 0) spans.push([e0, end]);
  const bySeq = new Map<string, { steps: Step[]; forms: Set<number> }>();
  for (const f of siblingInstances(ctx, bytes, spans, allowance)) {
    if (!deposited(f) || !cachedHasNext(ctx, f, cache)) continue;
    const fb = offsetCanon(ctx, read(ctx, f));
    for (const z of entitiesIn(ctx, f).held) {
      if (z.id === x.id) continue;
      const [zs, ze] = z.span;
      if (zs < before.length || ze + after.length > fb.length) continue;
      if (!bytesEqual(fb.subarray(zs - before.length, zs), before)) continue;
      if (!bytesEqual(fb.subarray(ze, ze + after.length), after)) continue;
      for (
        const [one, rest] of instanceSteps(
          ctx,
          f,
          z.id,
          fb.length * 2,
          allowance,
          deposited,
        )
      ) {
        const steps = [one, ...(rest ?? [])];
        const k = steps.map((st) =>
          latin1(st.prefix) + "\u0000" + latin1(st.suffix)
        ).join("\u0001");
        let at = bySeq.get(k);
        if (at === undefined) bySeq.set(k, at = { steps, forms: new Set() });
        at.forms.add(f);
      }
    }
  }
  const agreed = [...bySeq.entries()].filter(([, v]) => v.forms.size >= 2);
  let out: Step[] | null = null;
  if (agreed.length > 0) {
    agreed.sort((a, b) => a[1].steps.length - b[1].steps.length);
    const [k0, v0] = agreed[0];
    if (agreed.every(([k]) => k === k0 || k.startsWith(k0 + "\u0001"))) {
      out = v0.steps;
    }
  }
  memo?.described.set(key, out);
  return out;
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
  const frames = relationFrames(ctx, asked, allowance).filter((fr) =>
    fr.then === undefined
  );
  // A DERIVATION is the question's, not the walk's: its steps are read off the
  // whole question once, and each step is offered only where the derivation
  // stands (below) — so the material a product has already said does not
  // withhold the second step the way it withholds a frame said twice.
  const whole = ctx._edgeAsked;
  const chains = whole === null
    ? []
    : relationFrames(ctx, whole, allowance).filter((fr) =>
      fr.then !== undefined
    );
  if (frames.length === 0 && chains.length === 0) return none;
  const node = read(ctx, id, formCap);
  // What names each continuation: the question material of the strongest
  // frame naming it.
  const strength = new Map<number, number>();
  const spans = new Map<number, Array<[number, number]>>();
  const via = new Map<number, { q: number; t: number; chain: boolean }>();
  const named: Array<{ n: number; bytes: number; by: number[] }> = [];
  const credit = (
    fr: RelationFrame,
    t: number,
    chain: boolean,
    cond?: Map<string, Step>,
  ): void => {
    const bytes = fr.spans.reduce((a, [s, e]) => a + e - s, 0);
    for (const n of ctx.store.nextFirst(t, allowance)) {
      if (!nx.includes(n)) continue;
      // A step the derivation says more of names only a fact holding an
      // entity that is what every instance's was.
      if (cond !== undefined && cond.size > 0) {
        const { fact, held } = entitiesIn(ctx, n);
        if (
          !held.some((h) =>
            h.id !== id &&
            satisfies(ctx, fact.subarray(h.span[0], h.span[1]), cond)
          )
        ) {
          if (ctx.meter) ctx.meter.conditionWithheld++;
          continue;
        }
      }
      named.push({ n, bytes, by: fr.by });
      if (bytes > (strength.get(n) ?? -1)) {
        strength.set(n, bytes);
        spans.set(n, fr.spans);
        via.set(n, { q: fr.by[0], t, chain });
      }
    }
  };
  const at = (prefix: Uint8Array, suffix: Uint8Array): number | null => {
    const t = resolve(ctx, concatBytes([prefix, node, suffix]));
    return t === null || t === id ? null : t;
  };
  for (const fr of frames) {
    if (fr.not === id) continue;
    const t = at(fr.prefix, fr.suffix);
    if (t !== null) credit(fr, t, false);
  }
  for (const fr of chains) {
    // The FIRST step applies to the thing the question names — its own filler,
    // resolved — and step i+1 only to an entity the replay of steps 1..i from
    // that same thing reaches: the derivation is followed in order, from where
    // the question stands, or not at all.
    const x = resolve(ctx, fr.filler!);
    if (x === null) continue;
    const all: Step[] = [fr, ...fr.then!];
    let i = x === id ? 0 : -1;
    if (i < 0) {
      fr.replay ??= replayOf(ctx, x, all, formCap, allowance);
      i = fr.replay.findIndex((reached) => reached.has(id)) + 1;
      if (i === 0) continue;
    }
    const t = at(all[i].prefix, all[i].suffix);
    if (t !== null) credit(fr, t, true, fr.cond?.[i]);
  }
  // ONE MEASURE.  The frames naming a continuation rank by the question
  // material they share — the measure witnessing is ranked by — so `· father`,
  // which a partial frame of 8 bytes spells, does not tie with the 36-byte
  // derivation that spells `· mother` at the same node.  Frames within one
  // window of the strongest are evidence perception cannot tell apart (W, its
  // smallest distinction), and name together.
  const W = ctx.space.maxGroup;
  const top = Math.max(-1, ...named.map((x) => x.bytes));
  const tier = named.filter((x) => top - x.bytes < W);
  const best = nx.filter((n) => tier.some((x) => x.n === n));
  const most = new Set(tier.flatMap((x) => x.by)).size;
  if (best.length === 0) return none;
  const first = via.get(best[0]);
  if (ctx.meter) {
    ctx.meter.coInstanceNamings++;
    if (first?.chain) ctx.meter.chainNamings++;
  }
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
        `${most} co-instance(s) of the question carry the ` +
        `${first.chain ? "derivation's step" : "relation"} to ` +
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
 *  that node's context for the same relation.
 *
 *  A DERIVATION FRAME carries a second step (`then`): the co-instance's
 *  continuation is reached from its filler in two hops that meet at an entity
 *  (`Who is the paternal grandmother of Z?` → `The mother of Y is W.`, where
 *  `Z father` leads to `The father of Z is Y.` and `Y mother` to the answer),
 *  so the relation is the pair `· father`, `· mother`, followed in order from
 *  the question's own filler (`filler`). */
interface RelationFrame {
  /** The co-instances that spell the relation this way (first one traced). */
  by: number[];
  prefix: Uint8Array;
  suffix: Uint8Array;
  spans: Array<[number, number]>;
  /** The steps after the first, in order (a derivation of any length). */
  then?: Step[];
  filler?: Uint8Array;
  /** An entity a one-step relation does not apply at: the question slot's,
   *  when what the slot says of it determines nothing. */
  not?: number;
  /** Per position, the entities the replay from `filler` reaches. */
  replay?: Array<Set<number>>;
  /** Per position (the entity after step i), the facts EVERY instance's entity
   *  there holds, spelled with the entity cut out — what the derivation says
   *  of the entities it stands on, not only how it leaves them. */
  cond?: Array<Map<string, Step>>;
  /** The first instance's entities, read for `cond` once another agrees. */
  first?: Array<Step["to"]>;
}

/** Whether other instances of the question carry a relation — a frame two
 *  co-instances spell alike — once the consensus climb has shown its points.
 *  It is the one piece of a question's evidence the climb adds: a reading made
 *  before it is stale only where this holds (pipeline.ts, `runOf`). */
export function readsOffInstances(ctx: MindContext): boolean {
  const whole = ctx._edgeAsked;
  if (whole === null || whole.points === undefined) return false;
  const W = ctx.space.maxGroup;
  return relationFrames(ctx, whole, Math.max(hubBound(ctx), chainReach(W)))
    .length > 0;
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
  // What a form says as an instance does not depend on the material it is
  // read against — only whether its frame is held does — so the reading of
  // each form (its bytes, filler and relations) is kept on the question
  // (`instanceBook`) and every later material pays only the frame check.
  const book = instanceBook(whole!);
  // The question's own entity between a frame — read by the rule that reads
  // an instance's, once per frame.
  // What the question's own slot says between a frame — read by the rule an
  // instance's is, once per frame.
  const slotAt = (
    co: { open: number; close: number },
  ): SlotReading | null => {
    const at = `${co.open}:${co.close}`;
    let x = book.entity.get(at);
    if (x === undefined) {
      x = slotSteps(ctx, asked.bytes, co.open, asked.bytes.length - co.close);
      book.entity.set(at, x);
    }
    return x;
  };
  const spelled = new Map<string, RelationFrame>();
  const spell = (
    q: number,
    co: { spans: Array<[number, number]>; open: number; close: number },
    step: Step,
    then: Step[] | undefined,
    tos: Array<Step["to"]>,
  ): void => {
    // THE QUESTION'S DERIVATION is what its slot says of its entity, then what
    // the frame says: `Where was the paternal grandmother of Z born?` is
    // `· father → · mother` (the description, read off the forms that hold it)
    // then `· place of birth` (the frame, read off its instances), followed in
    // order from Z.  A frame whose slot says nothing is a relation any node may
    // take; anything longer starts at the slot's entity.
    // A slot whose remainder determines nothing leaves a one-step relation
    // to any node but its own entity (`Where was the maternal great-grandmother
    // of Z born?` is not about Z's birth); one with no entity to read leaves it
    // to any node.
    const read_ = slotAt(co);
    const not = read_ !== null && "undetermined" in read_
      ? read_.x.id
      : undefined;
    const said = read_ === null || "undetermined" in read_ ? null : read_;
    if (said === null && then !== undefined) return;
    const all = [...(said?.steps ?? []), step, ...(then ?? [])];
    let key = "";
    for (const t of all) {
      key += latin1(t.prefix) + "\u0000" + latin1(t.suffix) + "\u0001";
    }
    if (not !== undefined) key += `|not:${not}`;
    // WHAT THE DERIVATION SAYS OF THE ENTITIES IT STANDS ON is what every
    // instance's entity there is: `Which child of Y is a medic?` answered
    // `The occupation of C is surgeon.` stands on a child of Y that is a
    // surgeon, in every instance, though the question never says so.  A fact
    // one instance's entity lacks says nothing of the derivation.
    // Read once a second instance agrees on the steps: the first instance's
    // entities for their facts, then each later one only for those still
    // shared, an exact lookup of the whole fact — the test the question's
    // entity will take.
    const at = said?.steps.length ?? 0;
    const to = all.slice(0, -1).map((_, i) => i < at ? undefined : tos[i - at]);
    const known = spelled.get(key);
    if (known !== undefined) {
      if (known.by.includes(q)) return;
      known.by.push(q);
      known.cond = (known.cond ?? known.first!.map((e) =>
        e === undefined ? new Map<string, Step>() : factFrames(ctx, e)
      )).map((m, i) => {
        const e = to[i];
        return m.size === 0 || e === undefined
          ? new Map<string, Step>()
          : new Map([...m].filter(([, c]) =>
            holds(ctx, e.bytes, c)
          ));
      });
      return;
    }
    const fr: RelationFrame = {
      by: [q],
      ...all[0],
      spans: co.spans,
      first: to,
    };
    if (not !== undefined) fr.not = not;
    if (all.length > 1) {
      fr.then = all.slice(1);
      fr.filler = asked.bytes.subarray(said!.x.span[0], said!.x.span[1]);
    }
    spelled.set(key, fr);
  };
  const seen = new Set<number>();
  let frame: Array<[number, number]> | null = null;
  let frameSize = 0;
  // Whether `q` shares a frame with the question — what the question-entity
  // fallback asks of its siblings — whether or not its slot then reads as an
  // instance's.
  const consider = (q: number): boolean => {
    if (seen.has(q)) return false;
    seen.add(q);
    if (!deposited(q)) return false;
    let r = book.forms.get(q);
    if (r === undefined) {
      if (ctx.meter) ctx.meter.coInstanceReads++;
      r = { raw: read(ctx, q, formCap + 1) };
      book.forms.set(q, r);
    }
    if (r.raw.length > formCap) return false;
    const co = coInstanceFrame(ctx, r.raw, [asked.index], asked.bytes);
    if (co === null) return false;
    // What the instance's slot SAYS of its entity, by the question's rule:
    // `Where was Y's dad born?` applies `· father` to Y before the frame does.
    if (r.filler === undefined) {
      const said = slotSteps(ctx, r.raw, co.open, r.raw.length - co.close, {
        frame: co.open + co.close,
      });
      r.filler = said === null || "undetermined" in said
        ? null
        : { id: said.x.id, span: said.x.span, said: said.steps };
    }
    if (r.filler === null) return true;
    // The most specific frame shown — the longest — leads to the siblings.
    const size = co.open + co.close;
    if (frame === null || size > frameSize) {
      [frame, frameSize] = [co.spans, size];
    }
    r.steps ??= instanceSteps(
      ctx,
      q,
      r.filler.id,
      formCap,
      allowance,
      deposited,
    );
    // The FRAME's relation is what follows what the slot already said: an
    // instance whose derivation does not begin with its slot's steps reads
    // nothing, and one whose slot says it all asks for the entity it names.
    const said = r.filler.said;
    for (const [one, two] of r.steps) {
      const all = [one, ...(two ?? [])];
      if (!startsWith(all, said)) continue;
      const own = all.slice(said.length);
      if (own.length === 0) continue;
      spell(
        q,
        co,
        own[0],
        own.length > 1 ? own.slice(1) : undefined,
        own.slice(0, -1).map((st) => st.to),
      );
    }
    return true;
  };
  // Most corroborated first (the climb's own ranking), at most
  // `chainReach(W)` read — the exact tier's own floor.
  const proposals = points.filter((c) => cachedHasNext(ctx, c, cache))
    .slice(0, Math.min(allowance, chainReach(W)));
  for (const q of proposals) consider(q);
  // ONE REGION VOTES FOR ONE CONTEXT, so the climb's points hold one instance
  // of a frame that several instances share.  The siblings are what the
  // frame's rarest window reaches — the climb's own memoised reach, a
  // saturated window proposing nothing — read only once a co-instance has
  // shown what the frame is, and once per question.
  if (frame !== null) {
    // The question's own frame decides them; a later material — fewer windows
    // held, a narrower frame — reads the question's.
    const siblings = book.siblings ??
      siblingInstances(ctx, asked.bytes, frame, allowance);
    if (asked === whole) book.siblings = siblings;
    for (const q of siblings) {
      if (seen.has(q)) continue;
      if (ctx.meter) ctx.meter.coInstanceSiblings++;
      consider(q);
    }
  }
  // THE QUESTION'S OWN ENTITY SHOWS ITS FRAME where no two co-instances
  // agree.  The climb's points hold the thing the question names (`Ingegerd
  // Olofsdotter`) even when they hold no instances of what it asks; what the question
  // says around it is the frame to read siblings by.  It is a hypothesis, not
  // a frame a co-instance has shown, so it is refuted as soon as it shows
  // nothing: when the first `chainReach(W)` siblings hold no co-instance —
  // the exact tier's own floor — the rest are not read (on the trained store a
  // question's frame reached hundreds of contexts and no instance).
  if (![...spelled.values()].some((fr) => fr.by.length >= 2)) {
    if (book.held === undefined && asked === whole) {
      const x = heldEntity(ctx, asked.bytes);
      book.held = x === null ? [] : siblingInstances(
        ctx,
        asked.bytes,
        [[0, x[0]], [x[1], asked.bytes.length]],
        allowance,
      );
    }
    let shown = false;
    let tried = 0;
    for (const q of book.held ?? []) {
      if (!shown && tried >= chainReach(W)) break;
      if (seen.has(q)) continue;
      tried++;
      if (ctx.meter) ctx.meter.coInstanceSiblings++;
      if (consider(q)) shown = true;
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
  if (ctx.trace && seen.size > 0) {
    const show = (fr: RelationFrame): string =>
      `${decodeText(fr.prefix)}·${decodeText(fr.suffix)}` +
      (fr.then ?? []).map((t) =>
        ` → ${decodeText(t.prefix)}·${decodeText(t.suffix)}`
      ).join("") +
      ` (${fr.by.length})` +
      (fr.cond ?? []).map((m, i) =>
        m.size === 0
          ? ""
          : ` [${i + 1}: ${
            [...m.values()].map((c) =>
              `${decodeText(c.prefix)}·${decodeText(c.suffix)}`
            ).join(", ")
          }]`
      ).join("");
    ctx.trace.step(
      "relationFrames",
      [...new Set([...spelled.values()].flatMap((fr) => fr.by))].map((q) =>
        rItemShort(ctx, q, "co-instance")
      ),
      [],
      `${seen.size} form(s) read; frames ${
        [...spelled.values()].map(show).join("; ")
      } — ${frames.length} spelled alike by two or more`,
    );
  }
  return frames;
}

/** One step of a derivation: a frame around the entity it stands on.  A step
 *  read off an instance's path also keeps the entity it REACHED there (`to`),
 *  so what that entity is can be compared across instances. */
type Step = {
  prefix: Uint8Array;
  suffix: Uint8Array;
  to?: { id: number; bytes: Uint8Array };
};

/** One form's reading as an instance of the question, kept for the question:
 *  its bytes, its filler (null: none), and the relations it carries — each a
 *  one-hop step, or a first step with the second it leads to. */
interface InstanceReading {
  raw: Uint8Array;
  filler?: { id: number; span: [number, number]; said: Step[] } | null;
  steps?: Array<[Step, Step[] | undefined]>;
}

/** Per question: the forms read as instances, their siblings, and the
 *  question's own entity per frame. */
interface InstanceBook {
  forms: Map<number, InstanceReading>;
  siblings?: number[];
  held?: number[];
  entity: Map<string, SlotReading | null>;
}
const bookMemo = new WeakMap<object, InstanceBook>();
function instanceBook(whole: object): InstanceBook {
  let b = bookMemo.get(whole);
  if (b === undefined) {
    bookMemo.set(whole, b = { forms: new Map(), entity: new Map() });
  }
  return b;
}

/** The relations an instance `q` carries from its filler `z`.  Its
 *  continuation is established by other contexts too (`Peter Jackson place of
 *  birth`); one that holds the filler spells the relation the corpus's way.
 *  Where none does, the continuation is not a fact about the filler but the end
 *  of a DERIVATION from it, read as two hops meeting at an entity (below). */
function instanceSteps(
  ctx: MindContext,
  q: number,
  z: number,
  formCap: number,
  allowance: number,
  deposited: (c: number) => boolean,
): Array<[Step, Step[] | undefined]> {
  const W = ctx.space.maxGroup;
  // The filler as the corpus spells it — the co-instance may spell it only
  // under the response's equivalence.
  const filler = read(ctx, z, formCap);
  const out: Array<[Step, Step[] | undefined]> = [];
  for (const f of ctx.store.nextFirst(q, W)) {
    for (const c of ctx.store.prevFirst(f, allowance)) {
      if (c === q || !deposited(c)) continue;
      const cb = read(ctx, c, formCap + 1);
      const at = indexOf(cb, filler, 0);
      if (at < 0) continue;
      const prefix = cb.subarray(0, at);
      const suffix = cb.subarray(at + filler.length);
      if (prefix.length + suffix.length === 0) continue;
      out.push([{ prefix, suffix }, undefined]);
    }
  }
  if (out.length > 0) return out;
  for (const f of ctx.store.nextFirst(q, W)) {
    for (
      const [one, ...rest] of pathSteps(
        ctx,
        z,
        filler,
        f,
        q,
        allowance,
        formCap,
        deposited,
      )
    ) {
      if (rest.length > 0) out.push([one, rest]);
    }
  }
  return out;
}

/** The entities `fact` holds WHOLE: maximal spans of at least one window that
 *  the corpus learnt as contexts leading on — `Yaroslav the Wise` in `The
 *  father of Anne of Kiev is Yaroslav the Wise.`, never the `Yaroslav` inside
 *  it.  A span is probed by content hash first (its flat twin), so only a
 *  stored run pays the lookup. */
function entitiesIn(
  ctx: MindContext,
  factId: number,
): { fact: Uint8Array; held: Array<{ span: [number, number]; id: number }> } {
  // What a fact holds WHOLE is read off the whole fact: a prefix cut at the
  // material's length would hold `Henry` where the fact holds `Henry IV of
  // France`.
  const fact = read(ctx, factId);
  const memo = derivationCache(ctx);
  const hit = memo?.entities.get(factId);
  if (hit !== undefined) return { fact, held: hit };
  const W = ctx.space.maxGroup;
  const ids = leafIdPrefix(ctx, fact);
  const cache = getStructCache(ctx);
  const found: Array<{ span: [number, number]; id: number }> = [];
  for (let st = 0; st + W <= ids.length; st++) {
    for (let en = ids.length; en - st >= W; en--) {
      // The form is not an entity inside itself.
      if (en - st === fact.length) continue;
      if (ctx.store.findBranch(ids.slice(st, en)) === null) continue;
      const n = resolve(ctx, fact.subarray(st, en));
      // LEARNT WHOLE, not inherited: a piece of other forms (`mother`, the
      // tail of every `… mother` context) holds continuations by suffix
      // inheritance but no company of its own (answersOtherQuestions).
      if (
        n === null || !cachedHasNext(ctx, n, cache) ||
        !(ctx.store.haloMass(n) > 0)
      ) continue;
      found.push({ span: [st, en], id: n });
      break;
    }
  }
  const out = found.filter((a) =>
    !found.some((b) =>
      b !== a && b.span[0] <= a.span[0] && b.span[1] >= a.span[1]
    )
  );
  memo?.entities.set(factId, out);
  return { fact, held: out };
}

/** Whether `bytes` holds a thing the corpus learnt WHOLE — the test
 *  {@link entitiesIn} applies to each span of a fact, asked only of these
 *  bytes: ` is Thistlecombe.` holds `Thistlecombe`; `The date of birth of `
 *  holds nothing. */
export function holdsAThing(ctx: MindContext, bytes: Uint8Array): boolean {
  const W = ctx.space.maxGroup;
  const ids = leafIdPrefix(ctx, bytes);
  const cache = getStructCache(ctx);
  for (let st = 0; st + W <= ids.length; st++) {
    for (let en = ids.length; en - st >= W; en--) {
      if (ctx.store.findBranch(ids.slice(st, en)) === null) continue;
      const n = resolve(ctx, bytes.subarray(st, en));
      if (
        n !== null && cachedHasNext(ctx, n, cache) &&
        ctx.store.haloMass(n) > 0
      ) return true;
    }
  }
  return false;
}

/** The facts an entity holds, each spelled with the entity cut out (`The
 *  occupation of · is surgeon.`): what a derivation's instances may agree the
 *  entities it stands on are.  A hub's facts come back at the bound and say
 *  nothing (bounded-reads.md). */
function factFrames(
  ctx: MindContext,
  to: { id: number; bytes: Uint8Array },
): Map<string, Step> {
  const memo = derivationCache(ctx);
  const hit = memo?.facts.get(to.id);
  if (hit !== undefined) return hit;
  const bound = hubBound(ctx);
  const out = new Map<string, Step>();
  const facts = ctx.store.nextFirst(to.id, bound);
  if (facts.length < bound) {
    for (const g of facts) {
      const fb = read(ctx, g);
      const at = indexOf(fb, to.bytes, 0);
      if (at < 0) continue;
      const step = {
        prefix: fb.subarray(0, at),
        suffix: fb.subarray(at + to.bytes.length),
      };
      out.set(latin1(step.prefix) + "\u0000" + latin1(step.suffix), step);
    }
  }
  memo?.facts.set(to.id, out);
  return out;
}

/** Whether the entity spelled `bytes` holds the fact `c` spells around it —
 *  an exact lookup of the whole fact. */
function holds(ctx: MindContext, bytes: Uint8Array, c: Step): boolean {
  return resolve(ctx, concatBytes([c.prefix, bytes, c.suffix])) !== null;
}

/** Whether the entity spelled `bytes` holds every fact `cond` names. */
function satisfies(
  ctx: MindContext,
  bytes: Uint8Array,
  cond: Map<string, Step>,
): boolean {
  for (const c of cond.values()) if (!holds(ctx, bytes, c)) return false;
  return true;
}

/** A co-instance's continuation `f` read as the end of a DERIVATION from its
 *  filler `z`, of whatever length the corpus shows: a path of facts in which
 *  each fact is established by a context holding the entity the path stands
 *  on (`Z father` → `The father of Z is Y.`) and holds the entity the next one
 *  stands on (`Y`), until an entity some establishing context of `f` holds
 *  (`Y mother` → the answer).  Each step is that context with its entity cut
 *  out, so the derivation is the sequence of frames (`· father`, `· mother`),
 *  replayed in order from the question's own entity.
 *
 *  The path is searched breadth first, so the shortest derivation the corpus
 *  holds is the one read, and its length comes from the corpus, not from a
 *  depth.  Every entity expanded is one read of its facts out of the exact
 *  tier's own allowance (`√N`, floored at `chainReach(W)`); a hub whose facts
 *  come back at the bound is not expanded (bounded-reads.md), and a search that
 *  spends the allowance without reaching `f` reads nothing — metered
 *  (`pathReadsSaturated`), never a silent cut. */
function pathSteps(
  ctx: MindContext,
  z: number,
  filler: Uint8Array,
  f: number,
  q: number,
  allowance: number,
  formCap: number,
  deposited: (c: number) => boolean,
): Step[][] {
  const memo = derivationCache(ctx);
  const key = `${q}:${z}:${f}`;
  const hit = memo?.paths.get(key);
  if (hit !== undefined) return hit;
  const found = pathSearch(ctx, z, filler, f, q, allowance, formCap, deposited);
  memo?.paths.set(key, found);
  return found;
}

function pathSearch(
  ctx: MindContext,
  z: number,
  filler: Uint8Array,
  f: number,
  q: number,
  allowance: number,
  formCap: number,
  deposited: (c: number) => boolean,
): Step[][] {
  // Where the derivation must arrive: the entities f's own establishing
  // contexts hold, each with the last step it would take.
  const last = new Map<number, Step[]>();
  for (const p of ctx.store.prevFirst(f, allowance)) {
    if (p === q || !deposited(p)) continue;
    const pb = read(ctx, p, formCap + 1);
    if (pb.length > formCap || indexOf(pb, filler, 0) >= 0) continue;
    for (const e of entitiesIn(ctx, p).held) {
      const step = {
        prefix: pb.subarray(0, e.span[0]),
        suffix: pb.subarray(e.span[1]),
      };
      const at = last.get(e.id);
      if (at === undefined) last.set(e.id, [step]);
      else at.push(step);
    }
  }
  if (last.size === 0) return [];
  return searchWays(
    ctx,
    z,
    filler,
    allowance,
    formCap,
    deposited,
    (s) =>
      s.ways.flatMap((way) =>
        way.length === 0
          ? []
          : (last.get(s.id) ?? []).map((step) => [...way, step])
      ),
  );
}

/** The steps that reach fact `g` from an entity spelled `bytes`: g's
 *  establishing contexts that hold the entity, with it cut out. */
function stepsInto(
  ctx: MindContext,
  bytes: Uint8Array,
  g: number,
  allowance: number,
  formCap: number,
  deposited: (c: number) => boolean,
): Step[] {
  const steps: Step[] = [];
  for (const c of ctx.store.prevFirst(g, allowance)) {
    if (!deposited(c)) continue;
    const cb = read(ctx, c, formCap + 1);
    const at = indexOf(cb, bytes, 0);
    if (at < 0) continue;
    const step = {
      prefix: cb.subarray(0, at),
      suffix: cb.subarray(at + bytes.length),
    };
    if (step.prefix.length + step.suffix.length > 0) steps.push(step);
  }
  return steps;
}

/** Where a breadth-first derivation search stands: an entity, as the fact that
 *  reached it spells it, with every way the search reached it at this depth. */
type Stand = { id: number; bytes: Uint8Array; ways: Step[][] };

/** The breadth-first search a derivation is read by (`pathSearch`,
 *  `pathTo`): from `z`, through facts each established by a context holding
 *  the entity the search stands on, until `arrive` completes some ways at the
 *  depth it stands at — the shortest the corpus holds.  Each entity expanded
 *  is one read of its facts out of `allowance`; a hub is not expanded, and a
 *  search that spends the allowance reads nothing (`pathReadsSaturated`). */
function searchWays(
  ctx: MindContext,
  z: number,
  filler: Uint8Array,
  allowance: number,
  formCap: number,
  deposited: (c: number) => boolean,
  arrive: (s: Stand) => Step[][],
): Step[][] {
  const bound = hubBound(ctx);
  // An entity stands once per depth, with EVERY way the search reached it
  // there: two relations that lead to the same child (`· child`, `· heir`)
  // are two derivations an instance carries, and which one the corpus
  // deposited first is no reason to read only it.  An entity reached at a
  // shallower depth is not stood on again.
  let front: Stand[] = [{ id: z, bytes: filler, ways: [[]] }];
  const seen = new Set<number>([z]);
  let budget = allowance;
  while (front.length > 0) {
    const out = front.flatMap(arrive);
    if (out.length > 0) return out;
    const next = new Map<number, Stand>();
    for (const s of front) {
      if (budget-- <= 0) {
        if (ctx.meter) ctx.meter.pathReadsSaturated++;
        return [];
      }
      if (ctx.meter) ctx.meter.pathExpansions++;
      const facts = ctx.store.nextFirst(s.id, bound);
      if (facts.length >= bound) continue;
      for (const g of facts) {
        const steps = stepsInto(ctx, s.bytes, g, allowance, formCap, deposited);
        if (steps.length === 0) continue;
        const { fact, held } = entitiesIn(ctx, g);
        for (const e of held) {
          let at = next.get(e.id);
          if (at === undefined) {
            if (seen.has(e.id)) continue;
            seen.add(e.id);
            const bytes = fact.subarray(e.span[0], e.span[1]);
            next.set(e.id, at = { id: e.id, bytes, ways: [] });
          }
          const to = { id: e.id, bytes: at.bytes };
          for (const step of steps) {
            for (const way of s.ways) at.ways.push([...way, { ...step, to }]);
          }
        }
      }
    }
    front = [...next.values()];
  }
  return [];
}

/** The entities a derivation's replay from `x` stands on: entry i holds those
 *  reached after steps 1..i+1 (the last step is never replayed — it is the one
 *  the walk takes).  Each step is an exact lookup of the frame around the
 *  entity, and the entities are those its continuations hold whole. */
function replayOf(
  ctx: MindContext,
  x: number,
  steps: Step[],
  formCap: number,
  allowance: number,
): Array<Set<number>> {
  const out: Array<Set<number>> = [];
  let front = new Map<number, Uint8Array>([[x, read(ctx, x, formCap)]]);
  for (const step of steps.slice(0, -1)) {
    const next = new Map<number, Uint8Array>();
    for (const [e, bytes] of front) {
      const t = resolve(ctx, concatBytes([step.prefix, bytes, step.suffix]));
      if (t === null) continue;
      for (const g of ctx.store.nextFirst(t, allowance)) {
        const { fact, held } = entitiesIn(ctx, g);
        for (const h of held) {
          if (h.id !== e) next.set(h.id, fact.subarray(h.span[0], h.span[1]));
        }
      }
    }
    out.push(new Set(next.keys()));
    front = next;
  }
  return out;
}

/** The derivations from `z` whose last step reaches a fact `goal` accepts,
 *  shortest first, by the search a co-instance's derivation is read by
 *  (`searchWays`) — each with that fact and the entity it was reached from,
 *  as the search spelled it. */
function pathToFact(
  ctx: MindContext,
  z: number,
  filler: Uint8Array,
  goal: (g: number) => boolean,
  allowance: number,
  formCap: number,
  deposited: (c: number) => boolean,
): Array<{ steps: Step[]; fact: number; stand: Uint8Array }> {
  const bound = hubBound(ctx);
  let found: Array<{ steps: Step[]; fact: number; stand: Uint8Array }> = [];
  searchWays(ctx, z, filler, allowance, formCap, deposited, (s) => {
    const out: Step[][] = [];
    const facts = ctx.store.nextFirst(s.id, bound);
    if (facts.length >= bound) return out;
    for (const g of facts) {
      if (!goal(g)) continue;
      for (
        const step of stepsInto(ctx, s.bytes, g, allowance, formCap, deposited)
      ) {
        for (const way of s.ways) {
          out.push([...way, step]);
          found.push({ steps: [...way, step], fact: g, stand: s.bytes });
        }
      }
    }
    return out;
  });
  // Only the depth the search stopped at: the shortest.
  const depth = Math.min(...found.map((f) => f.steps.length));
  found = found.filter((f) => f.steps.length === depth);
  return found;
}

/** What an ANSWER FRAME says of a fact: it is spelled `head`, the entity the
 *  derivation stood on, `mid`, the answer, `tail` (or the answer first, when
 *  `answerFirst`).  Read off the instances' last facts — the answer being
 *  what the fact shares with the instance's continuation — and agreed on like
 *  any frame, it says, exactly, which bytes of a new fact answer. */
interface AnswerFrame {
  head: Uint8Array;
  mid: Uint8Array;
  tail: Uint8Array;
  answerFirst: boolean;
}

function answerFrameOf(
  g: Uint8Array,
  stand: Uint8Array,
  [rs0, re0]: [number, number],
): AnswerFrame | null {
  const at = indexOf(g, stand, 0);
  if (at < 0) return null;
  const end = at + stand.length;
  if (at < rs0 || end <= rs0) {
    const rs = Math.max(rs0, end);
    if (rs >= re0) return null;
    return {
      head: g.subarray(0, at),
      mid: g.subarray(end, rs),
      tail: g.subarray(re0),
      answerFirst: false,
    };
  }
  const re = Math.min(re0, at);
  if (rs0 >= re) return null;
  return {
    head: g.subarray(0, rs0),
    mid: g.subarray(re, at),
    tail: g.subarray(end),
    answerFirst: true,
  };
}

/** The answer a fact spells in an answer frame around the entity `stand`, or
 *  null when the fact is not spelled that way. */
function answerIn(
  g: Uint8Array,
  stand: Uint8Array,
  fr: AnswerFrame,
): Uint8Array | null {
  const pre = fr.answerFirst ? fr.head : concatBytes([fr.head, stand, fr.mid]);
  const post = fr.answerFirst ? concatBytes([fr.mid, stand, fr.tail]) : fr.tail;
  if (g.length <= pre.length + post.length) return null;
  if (!bytesEqual(g.subarray(0, pre.length), pre)) return null;
  if (!bytesEqual(g.subarray(g.length - post.length), post)) return null;
  return g.subarray(pre.length, g.length - post.length);
}

const frameKey = (fr: AnswerFrame): string =>
  `${fr.answerFirst ? 1 : 0}\u0000${latin1(fr.head)}\u0000${
    latin1(fr.mid)
  }\u0000${latin1(fr.tail)}`;

/** The facts a derivation's full replay from `x` ends on: its steps before
 *  the last replayed as `replayOf` does, the last one's continuations
 *  collected — exact lookups of each frame around each entity. */
function replayFacts(
  ctx: MindContext,
  x: number,
  steps: Step[],
  formCap: number,
  allowance: number,
): Array<{ fact: number; stand: Uint8Array }> {
  let front = new Map<number, Uint8Array>([[x, read(ctx, x, formCap)]]);
  const out: Array<{ fact: number; stand: Uint8Array }> = [];
  for (const [i, step] of steps.entries()) {
    const next = new Map<number, Uint8Array>();
    for (const [e, bytes] of front) {
      const t = resolve(ctx, concatBytes([step.prefix, bytes, step.suffix]));
      if (t === null) continue;
      for (const g of ctx.store.nextFirst(t, allowance)) {
        if (i === steps.length - 1) {
          out.push({ fact: g, stand: bytes });
          continue;
        }
        const { fact, held } = entitiesIn(ctx, g);
        for (const h of held) {
          if (h.id !== e) next.set(h.id, fact.subarray(h.span[0], h.span[1]));
        }
      }
    }
    front = next;
  }
  return out;
}

/** One CONVERGENCE read off instances of a question about TWO things: the
 *  derivation each thing takes, both ending at the entity the instance is
 *  answered with (`Who is both the mother of A and the spouse of B?` →
 *  `The answer is M.`: `· mother` from A, `· spouse` from B, both to M). */
export interface Convergence {
  by: number[];
  steps: [Step[], Step[]];
  answers: [AnswerFrame, AnswerFrame];
}

/** The two things a question names around its frame — and the convergences
 *  two instances of that frame agree on — or null. */
export interface ConvergenceReading {
  x: [{ span: [number, number]; id: number }, {
    span: [number, number];
    id: number;
  }];
  frames: Convergence[];
}

const convergenceMemo = new WeakMap<object, ConvergenceReading | null>();

/** A question that names two things around one frame (`Who is both the
 *  mother of · and the spouse of ·?`) is read the way a one-slot question is
 *  read off its co-instances (`relationFrames`), with the slot parted where
 *  the two forms share a run (` and the spouse of `): each side holds a thing
 *  (`slotEntity`), and an instance whose continuation holds an entity both
 *  its things reach — each by a derivation of its own (`pathTo`) — shows the
 *  frame's CONVERGENCE.  Two instances spelling the same pair of derivations
 *  agree, the agreement every relation read off instances needs.  The
 *  proposals are the consensus climb's points, read once per question. */
export function convergenceOf(ctx: MindContext): ConvergenceReading | null {
  const whole = ctx._edgeAsked;
  if (whole === null || whole.points === undefined) return null;
  const hit = convergenceMemo.get(whole);
  if (hit !== undefined && !ctx.trace) return hit;
  const out = readConvergence(ctx, whole);
  convergenceMemo.set(whole, out);
  return out;
}

function readConvergence(
  ctx: MindContext,
  whole: { bytes: Uint8Array; index: WindowIndex; points?: readonly number[] },
): ConvergenceReading | null {
  const W = ctx.space.maxGroup;
  const Q = whole.bytes;
  const formCap = 2 * Q.length;
  const allowance = Math.max(hubBound(ctx), chainReach(W));
  const cache = getStructCache(ctx);
  const deposited = (c: number): boolean =>
    !cachedHasParents(ctx, c, cache) && !ctx.store.hasContainers(c);
  const proposals = (whole.points ?? []).filter((c) =>
    cachedHasNext(ctx, c, cache)
  ).slice(0, Math.min(allowance, chainReach(W)));
  // What a slot holds, by its span — the question's read once per question,
  // a form's once per session (it does not depend on the question).
  const memo = derivationCache(ctx);
  const held = new Map<string, ReturnType<typeof slotEntity>>();
  // Each side holds a thing LEARNT WHOLE (`entitiesIn`'s law): a word of the
  // frame (` mother`, `-law?`) holds continuations by inheritance and no
  // company of its own, and a slot that parts on it holds one thing, not two.
  const entity = (
    q: number | null,
    raw: Uint8Array,
    s0: number,
    e0: number,
  ) => {
    const k = `${q ?? "Q"}:${s0}:${e0}`;
    const store = q === null ? held : memo?.slots ?? held;
    if (!store.has(k)) {
      const e = slotEntity(ctx, raw, s0, e0, q !== null);
      store.set(k, e !== null && ctx.store.haloMass(e.id) > 0 ? e : null);
    }
    return store.get(k)!;
  };
  const things = new Map<string, ConvergenceReading["x"] | null>();
  const spelled = new Map<string, Convergence>();
  const candidates: Array<{
    q: number;
    raw: Uint8Array;
    e1: { span: [number, number]; id: number };
    e2: { span: [number, number]; id: number };
    key: string;
    f: Uint8Array;
  }> = [];
  let x: ConvergenceReading["x"] | null = null;
  // The forms are the ones `relationFrames` read as instances of this
  // question: their bytes are on the question's book.
  const book = instanceBook(whole);
  for (const q of proposals) {
    // A form on the book was read as deposited; any other is probed here and
    // read onto the book, as `relationFrames` reads it.
    let r = book.forms.get(q);
    if (r === undefined) {
      if (!deposited(q)) continue;
      if (ctx.meter) ctx.meter.coInstanceReads++;
      r = { raw: read(ctx, q, formCap + 1) };
      book.forms.set(q, r);
    }
    const raw = r.raw;
    if (raw.length > formCap) continue;
    const co = coInstanceFrame(ctx, raw, [whole.index], Q);
    if (co === null) continue;
    const form = offsetCanon(ctx, raw);
    const fs = form.subarray(co.open, form.length - co.close);
    const qs = Q.subarray(co.open, Q.length - co.close);
    const mid = sharedRun(fs, qs, W);
    if (mid === null) continue;
    const [fa, qa, len] = mid;
    // What the instance shows comes first: its things, and the derivation
    // each takes to its answer.  Only an instance that shows a convergence
    // makes the question's own things worth reading.
    // The thing the slot opens with is the one the one-thing reading found
    // there, when it read this form for this question.
    const known = r.filler != null && r.filler.span[1] < co.open + fa + W &&
        ctx.store.haloMass(r.filler.id) > 0
      ? { id: r.filler.id, span: r.filler.span }
      : undefined;
    const e1 = known ?? entity(q, raw, co.open, co.open + fa);
    if (e1 === null) continue;
    const e2 = entity(q, raw, co.open + fa + len, raw.length - co.close);
    if (e2 === null || e1.id === e2.id) continue;
    const key = `${co.open}:${co.close}:${qa}:${len}`;
    for (const f of ctx.store.nextFirst(q, W)) {
      candidates.push({ q, raw, e1, e2, key, f: read(ctx, f) });
    }
  }
  // WHAT AN INSTANCE ANSWERS is what its continuation holds beyond the frame
  // every instance's continuation shares (`The answer is ` … `.`) — the filler
  // of the answers, read as a co-instance's is: frame shared, filler differs.
  for (const c of candidates) {
    let pre = c.f.length, suf = c.f.length;
    for (const o of candidates) {
      if (o.q === c.q) continue;
      let i = 0;
      while (i < Math.min(c.f.length, o.f.length) && c.f[i] === o.f[i]) i++;
      let j = 0;
      while (
        j < Math.min(c.f.length, o.f.length) - i &&
        c.f[c.f.length - 1 - j] === o.f[o.f.length - 1 - j]
      ) j++;
      pre = Math.min(pre, i);
      suf = Math.min(suf, j);
    }
    // Less than one window of frame is no frame — a letter the answers share
    // by chance (`…way.`, `…bury.`) stays theirs.
    if (pre < W) pre = 0;
    if (suf < W) suf = 0;
    if (pre + suf >= c.f.length) continue;
    const answer = c.f.subarray(pre, c.f.length - suf);
    if (answer.length < W) continue;
    const ik = `${c.q}:${c.e1.id}:${c.e2.id}:${latin1(answer)}`;
    let shown = memo?.converges.get(ik);
    if (shown === undefined) {
      if (ctx.meter) ctx.meter.convergenceReads++;
      shown = instanceConvergence(
        ctx,
        c.raw,
        c.e1,
        c.e2,
        answer,
        allowance,
        formCap,
        deposited,
      );
      memo?.converges.set(ik, shown);
    }
    if (shown.length === 0) continue;
    if (!things.has(c.key)) {
      const [o, cl, qa, len] = c.key.split(":").map(Number);
      const q1 = entity(null, Q, o, o + qa);
      const q2 = entity(null, Q, o + qa + len, Q.length - cl);
      things.set(c.key, q1 && q2 && q1.id !== q2.id ? [q1, q2] : null);
    }
    const asked = things.get(c.key)!;
    if (asked === null) continue;
    if (c.e1.id === asked[0].id && c.e2.id === asked[1].id) continue;
    // Forms part the slot where their names happen to share letters
    // (`Rains and ` against `Evans and `); the question's things are what
    // the instances are about, whichever parting read them.
    const about = `${asked[0].id}:${asked[1].id}`;
    for (const [a, b] of shown) {
      const k = about + "|" +
        [a, b].map(({ steps, frame }) =>
          steps.map((t) => latin1(t.prefix) + "\u0000" + latin1(t.suffix))
            .join("\u0001") + "\u0003" + frameKey(frame)
        ).join("\u0002");
      const known = spelled.get(k);
      if (known === undefined) {
        spelled.set(k, {
          by: [c.q],
          steps: [a.steps, b.steps],
          answers: [a.frame, b.frame],
        });
      } else if (!known.by.includes(c.q)) known.by.push(c.q);
      x ??= asked;
    }
  }
  const frames = [...spelled.values()].filter((c) => c.by.length >= 2);
  if (ctx.trace && spelled.size > 0) {
    const show = (steps: Step[]): string =>
      steps.map((t) => `${decodeText(t.prefix)}·${decodeText(t.suffix)}`)
        .join(" → ");
    ctx.trace.step(
      "convergenceFrames",
      [...new Set([...spelled.values()].flatMap((c) => c.by))].map((q) =>
        rItemShort(ctx, q, "co-instance")
      ),
      [],
      [...spelled.values()].map((c) =>
        `${show(c.steps[0])} ⋈ ${show(c.steps[1])} (${c.by.length})`
      ).join("; ") + ` — ${frames.length} spelled alike by two or more`,
    );
  }
  return frames.length === 0 || x === null ? null : { x, frames };
}

type Arrival = { steps: Step[]; frame: AnswerFrame };

/** What one instance shows of a convergence: for each pair of derivations by
 *  which its two things reach a fact holding its `answer` exactly, the steps
 *  and that fact's answer frame on each side. */
function instanceConvergence(
  ctx: MindContext,
  raw: Uint8Array,
  e1: { span: [number, number]; id: number },
  e2: { span: [number, number]; id: number },
  answer: Uint8Array,
  allowance: number,
  formCap: number,
  deposited: (c: number) => boolean,
): Array<[Arrival, Arrival]> {
  const at = (g: number): number => indexOf(read(ctx, g), answer, 0);
  const ends = (e: { id: number; span: [number, number] }): Arrival[] =>
    pathToFact(
      ctx,
      e.id,
      raw.subarray(e.span[0], e.span[1]),
      (g) => at(g) >= 0,
      allowance,
      formCap,
      deposited,
    ).flatMap((p) => {
      const s0 = at(p.fact);
      const fr = answerFrameOf(read(ctx, p.fact), p.stand, [
        s0,
        s0 + answer.length,
      ]);
      return fr === null ? [] : [{ steps: p.steps, frame: fr }];
    });
  const p1 = ends(e1);
  if (p1.length === 0) return [];
  const out: Array<[Arrival, Arrival]> = [];
  for (const b of ends(e2)) for (const a of p1) out.push([a, b]);
  return out;
}

/** The longest run two slots share strictly inside both — where a slot holding
 *  two things parts — as `[at in a, at in b, length]`, at least one window
 *  long; null when none. */
function sharedRun(
  a: Uint8Array,
  b: Uint8Array,
  W: number,
): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      const n = cur[j] = prev[j - 1] + 1;
      const ai = i - n, bj = j - n;
      if (
        n >= W && ai > 0 && bj > 0 && i < a.length && j < b.length &&
        (best === null || n > best[2])
      ) best = [ai, bj, n];
    }
    prev = cur;
  }
  return best;
}

/** Where a question's two things meet by a convergence its instances agree
 *  on: each derivation replayed from the question's own thing, the answer each
 *  last fact spells in its side's answer frame (`answerIn`), and the two
 *  compared byte for byte — the exact tier decides.  Each meet with the two
 *  facts, its evidence. */
export function convergenceMeets(
  ctx: MindContext,
  reading: ConvergenceReading,
): Array<{ name: Uint8Array; facts: [number, number]; by: number }> {
  const W = ctx.space.maxGroup;
  const whole = ctx._edgeAsked;
  if (whole === null) return [];
  const formCap = 2 * whole.bytes.length;
  const allowance = Math.max(hubBound(ctx), chainReach(W));
  const out: Array<{ name: Uint8Array; facts: [number, number]; by: number }> =
    [];
  for (const c of reading.frames) {
    const side = (k: 0 | 1) =>
      replayFacts(ctx, reading.x[k].id, c.steps[k], formCap, allowance)
        .flatMap(({ fact, stand }) => {
          const name = answerIn(read(ctx, fact), stand, c.answers[k]);
          return name === null ? [] : [{ fact, name }];
        });
    const two = side(1);
    for (const one of side(0)) {
      for (const other of two) {
        if (bytesEqual(one.name, other.name)) {
          out.push({
            name: one.name,
            facts: [one.fact, other.fact],
            by: c.by.length,
          });
        }
      }
    }
  }
  return out;
}

/** Further instances of a frame a co-instance has shown: the contexts the
 *  question's RAREST frame window reaches, through the climb's own memoised
 *  reach.  A window every frame shares is held by every instance; the rarest
 *  one reaches the fewest contexts, and a saturated reach proposes nothing. */
function siblingInstances(
  ctx: MindContext,
  question: Uint8Array,
  frame: ReadonlyArray<[number, number]>,
  allowance: number,
): number[] {
  const W = ctx.space.maxGroup;
  const bound = hubBound(ctx);
  const ids = leafIdPrefix(ctx, question);
  const hub = hubWindows(ctx, question);
  let best: number | null = null;
  let rarity = bound + 1;
  for (const [s, e] of frame) {
    for (let o = s; o + W <= e && o + W <= ids.length; o++) {
      if (hub[o]) continue;
      const wid = ctx.store.findBranch(ids.slice(o, o + W));
      if (wid === null) continue;
      const r = ctx.store.containersSlice(wid, 0, bound + 1).length;
      if (r > 0 && r < rarity) {
        rarity = r;
        best = wid;
      }
    }
  }
  if (best === null) return [];
  const reach = edgeAncestors(ctx, best, corpusN(ctx), sharedReachMemo(ctx));
  return reach.saturated ? [] : reach.roots.slice(0, allowance);
}
const frameMemo = new WeakMap<object, RelationFrame[]>();

/** The question's own entity: the longest of the climb's points the question
 *  holds whole, exactly or under the response's equivalence, that has
 *  continuations of its own — `[start, end)` in the question, or null.
 *  `learnt`: only a thing learnt WHOLE, with company of its own as well
 *  (`entitiesIn`'s law), not a piece that inherits continuations. */
export function heldEntity(
  ctx: MindContext,
  question: Uint8Array,
  learnt = false,
): [number, number] | null {
  const points = ctx._edgeAsked?.points;
  if (points === undefined) return null;
  const W = ctx.space.maxGroup;
  const cache = getStructCache(ctx);
  let best: [number, number] | null = null;
  for (const id of points.slice(0, chainReach(W))) {
    const raw = read(ctx, id, question.length);
    if (raw.length < W || raw.length + W > question.length) continue;
    if (best !== null && raw.length <= best[1] - best[0]) continue;
    let at = indexOf(question, raw, 0);
    if (at < 0 && ctx.canon !== null) {
      const form = ctx.canon(raw);
      if (form.length === raw.length) at = indexOf(question, form, 0);
    }
    if (at < 0 || !cachedHasNext(ctx, id, cache)) continue;
    if (learnt && !(ctx.store.haloMass(id) > 0)) continue;
    best = [at, at + raw.length];
  }
  return best;
}

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
