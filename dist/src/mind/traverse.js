// traverse.ts — Traverse primitives + disambiguation (Sections 1 & 6 of the mind).
//
//   Traverse — node → nodes   (edgeAncestors, nextOf, prevOf, contains,
//                               guidedNext, chooseNext, chooseAmong, hubCap)
//
// The PROJECTIONS built on these walks (follow, conceptHop, reverseContext,
// project) live in match.ts — the elementary match-and-project operation.
import { cosine } from "../vec.js";
import { gistOf, read } from "./primitives.js";
import { canonicalWindows, leafIdPrefix, leafIdRun } from "./canonical.js";
//
// Budgeted on the same terms as the reach memo below (AGENTS §2.12): these
// three maps are cleared on every write, but a long read-only session over a
// large store converges on one entry per node per map with nothing to bound
// it.  Past the cap all three are dropped together and re-derived, costing
// cold structural probes and never a wrong answer.
const STRUCT_MEMO_MAX = 100_000;
const structCaches = new WeakMap();
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
// Budgeted, not unbounded (AGENTS §2.12): past the cap the whole map is
// dropped and re-derived, costing a cold climb and never a wrong answer.
const REACH_MEMO_MAX = 100_000;
const reachCaches = new WeakMap();
/** The reach memo this ask should use — see the note above.
 *
 *  A TRACED response always gets a fresh, empty one.  `AncestorReach`'s
 *  `visited`/`maxDepth`/`saturation` fields are populated only when a trace
 *  is attached, so an entry deposited by an untraced earlier turn would
 *  silently black out the reach detail of a later traced one; and the trace's
 *  reach payload is serialised by ITERATING this map, which must therefore
 *  hold what THIS climb consulted, not the whole conversation's history.
 *  Consistent with AGENTS §2.11: a traced response is a different machine —
 *  never benchmark with a trace attached. */
export function sharedReachMemo(ctx) {
    if (ctx.trace !== null || ctx.climbMemo === null)
        return new Map();
    let m = reachCaches.get(ctx._structMemoKey);
    if (m === undefined)
        reachCaches.set(ctx._structMemoKey, m = new Map());
    else if (m.size >= REACH_MEMO_MAX)
        m.clear();
    return m;
}
function getStructCache(ctx) {
    if (ctx.climbMemo === null)
        return null;
    let c = structCaches.get(ctx._structMemoKey);
    if (c === undefined) {
        structCaches.set(ctx._structMemoKey, c = {
            hasNext: new Map(),
            prevCount: new Map(),
            hasParents: new Map(),
        });
    }
    else if (c.hasNext.size >= STRUCT_MEMO_MAX ||
        c.prevCount.size >= STRUCT_MEMO_MAX ||
        c.hasParents.size >= STRUCT_MEMO_MAX) {
        c.hasNext.clear();
        c.prevCount.clear();
        c.hasParents.clear();
    }
    return c;
}
/** Invalidate every session-lifetime structural read after a write. */
export function invalidateStructuralCaches(ctx) {
    reachCaches.delete(ctx._structMemoKey);
    structCaches.delete(ctx._structMemoKey);
}
/** Cached {@link Store.hasNext} — pure during one respond(). */
function cachedHasNext(ctx, id, cache) {
    if (cache === null)
        return ctx.store.hasNext(id);
    let v = cache.hasNext.get(id);
    if (v === undefined) {
        v = ctx.store.hasNext(id);
        cache.hasNext.set(id, v);
    }
    return v;
}
/** Cached {@link Store.prevCount} — pure during one respond(). */
function cachedPrevCount(ctx, id, cache) {
    if (cache === null)
        return ctx.store.prevCount(id);
    let v = cache.prevCount.get(id);
    if (v === undefined) {
        v = ctx.store.prevCount(id);
        cache.prevCount.set(id, v);
    }
    return v;
}
/** Cached {@link Store.hasParents} — pure during one respond(). */
function cachedHasParents(ctx, id, cache) {
    if (cache === null)
        return ctx.store.hasParents(id);
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
export function edgeAncestors(ctx, id, contextCount, memo) {
    const hit = memo?.get(id);
    if (hit !== undefined)
        return hit;
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
        const reach = {
            roots: [],
            contextsReached: 0,
            saturated: true,
            ...(ctx.trace
                ? {
                    saturation: {
                        reason: "byte-atom-commonality",
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
    const roots = [];
    const seen = new Set([id]);
    const ctxSeen = new Set();
    let saturated = false;
    // Provenance of the FIRST decision that saturated this climb — allocated
    // only when a trace is requested (see AncestorReach.saturation's doc); the
    // climb itself never reads it back.
    let satStop;
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
    const depths = ctx.trace ? [] : null;
    let curDepth = 0;
    let visitedCount = 0;
    let maxDepth = 0;
    const visit = (x) => {
        if (ctx.meter)
            ctx.meter.ancestorVisits++;
        if (depths) {
            visitedCount++;
            if (curDepth > maxDepth)
                maxDepth = curDepth;
        }
        const hasNx = cachedHasNext(ctx, x, structCache);
        const pc = cachedPrevCount(ctx, x, structCache);
        if (hasNx || pc > 0) {
            roots.push(x);
            if (hasNx)
                ctxSeen.add(x);
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
            for (const p of ctx.store.prevFirst(x, bound))
                ctxSeen.add(p);
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
    const stack = [];
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
    climb: for (;;) {
        if (stack.length === 0) {
            if (containersExhausted)
                break;
            const page = ctx.store.containersSlice(id, containerOff, bound);
            containerOff += page.length;
            if (page.length < bound)
                containersExhausted = true;
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
                }
                else
                    break;
            }
        }
        while (stack.length > 0) {
            let x = stack.pop();
            if (depths)
                curDepth = depths.pop();
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
                for (let i = 1; i < run.length; i++)
                    seen.add(run[i]);
                if (dup)
                    continue;
                x = top;
                // The chain's interior hops are part of the terminal's ascent
                // distance — count them exactly as a node-at-a-time ascent would.
                if (depths)
                    curDepth += run.length - 1;
            }
            if (!visit(x)) {
                saturated = true;
                break climb;
            }
        }
    }
    const reach = {
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
export function nextOf(ctx, id) {
    return ctx.store.next(id);
}
/** Convenience: reverse edges of a node. */
export function prevOf(ctx, id) {
    return ctx.store.prev(id);
}
/** The uniform-expectation floor on a byte atom's corpus commonality: N
 *  learnt contexts, each at least one perception chunk of up to W of the 256
 *  possible byte values, contain a given atom in ≥ N·W/256 contexts on
 *  average.  An atom's TRUE containment is unmeasurable (atoms carry no
 *  kid/contain links by construction), so this floor is the honest stand-in:
 *  derived entirely from the corpus scale N, the perception window W, and
 *  the alphabet size — never tuned. */
export function atomReach(ctx, contextCount) {
    return Math.max(1, Math.ceil((contextCount * ctx.space.maxGroup) / 256));
}
/** Whether a byte atom is a hub at this corpus scale — its commonality floor
 *  {@link atomReach} exceeds the hub bound √N.  Below it (small stores) an
 *  atom votes and is recognised exactly as any stored form; above it the
 *  alphabet is scaffolding everywhere and abstains. */
export function atomIsHub(ctx, contextCount) {
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
export function bearsEdge(ctx, id) {
    return cachedHasNext(ctx, id, getStructCache(ctx));
}
/** Whether a node LEADS SOMEWHERE — it bears a continuation edge or a halo.
 *  The admission predicate recognition filters sites with (HOW_IT_WORKS
 *  §15.3): a form that leads nowhere contributes nothing to any derivation.
 *  Runs once per candidate span on the recognition hot path — `hasNext` is
 *  cached per response (the same flat-branch ids are probed across prefix
 *  variants by canonicalChunkId).  `hasHalo` is not cached: it's a single
 *  indexed point probe per candidate, and the candidates that reach this
 *  check have already been filtered by hasNext above in edgeAncestors. */
export function leadsSomewhere(ctx, id) {
    const memo = getStructCache(ctx);
    if (cachedHasNext(ctx, id, memo))
        return true;
    return ctx.store.hasHalo(id);
}
/** The structural IDF read of ONE node: how many distinct learnt contexts
 *  its containment/edge climb reaches, or Infinity when it reaches none or
 *  saturates (no usable identity evidence).  The number every
 *  discriminative-vs-scaffolding decision derives from — paired with the
 *  half-dominance convention (geometry.dominates(reach, N)): content
 *  reaching a corpus MINORITY of contexts discriminates (an entity, a
 *  filler); content reaching a majority is frame scaffolding. */
export function reachOf(ctx, id, contextCount, memo) {
    const r = edgeAncestors(ctx, id, contextCount, memo);
    if (r.saturated || r.roots.length === 0)
        return Infinity;
    return Math.max(1, r.contextsReached);
}
/** The corpus scale N — the count of DISTINCT learnt contexts, floored at 2
 *  so its derived readings (ln N in the consensus floor, √N in the hub bound)
 *  stay meaningful on a near-empty store.  The one definition every consumer
 *  of "how big is this corpus?" reads. */
export function corpusN(ctx) {
    return Math.max(2, ctx.store.edgeSourceCount());
}
/** The hub bound √N itself (≥ 2 always, since N is floored at 2) — for
 *  consumers that pass it to the store's LIMITed reads instead of capping a
 *  materialised list.  {@link hubCap} is the list-side reading of the same
 *  convention. */
export function hubBound(ctx) {
    return boundFor(corpusN(ctx));
}
/** √N for an EXPLICIT context count — the ctx-free reading of {@link
 *  hubBound}, for the callers inside this module that are handed a count
 *  rather than a context ({@link edgeAncestors}, {@link atomIsHub}).  The
 *  floor at 2 matches {@link corpusN}'s, so both readings agree for every
 *  input: the two used to be spelled out inline, once WITH the floor and
 *  once without, in the same function. */
function boundFor(contextCount) {
    return Math.ceil(Math.sqrt(Math.max(2, contextCount)));
}
/** Cap a candidate list at the hub bound √N (insertion order) — the ONE
 *  fan-out convention every walk and disambiguation uses (see HOW_IT_WORKS
 *  §8.6).  A node connected to more than √N others is a hub whose individual
 *  connections carry ~no discriminative information; materialising or scoring
 *  them all would make single decisions scale with the corpus. */
export function hubCap(ctx, ids) {
    const bound = hubBound(ctx);
    return ids.length > bound ? ids.slice(0, bound) : ids;
}
/** Whether `descendant` lies within `ancestor`'s subtree — a structural DAG
 *  relation read off the hash-consed `kids` lists, by a bounded explicit-stack
 *  descent.  Used by articulation to keep a voice from revoicing a fragment
 *  OF that voice. */
export function contains(ctx, ancestor, descendant) {
    if (ancestor === descendant)
        return true;
    const seen = new Set([ancestor]);
    const stack = [ancestor];
    while (stack.length > 0) {
        const rec = ctx.store.get(stack.pop());
        if (!rec?.kids)
            continue;
        for (const k of rec.kids) {
            if (k === descendant)
                return true;
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
 *  standing next to each other: a question and its answer co-occur in every
 *  episode that taught the pair, so their halos SHOULD be similar, and on a
 *  conversational store they are (measured on the CONV fixture: consecutive
 *  turns at 0.809 against a 0.516 concept threshold).  A gate reading halo
 *  cosine alone therefore reads adjacency as synonymy and revoices an answer
 *  in the words of the question it answers — "it hangs in madrid" spliced back
 *  into "where is it kept now".  The distributional layer cannot tell the two
 *  relations apart, because to it they are the same observation; the exact
 *  half can, for free, because it stored the edge.  §4.1's division of labour
 *  exactly: approximate proposes, exact decides.
 *
 *  Read LIMITed in both directions at the hub bound — a common continuation's
 *  fan-in is corpus-sized, and no single decision may scale with it. */
export function answers(ctx, a, b) {
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
export function argmaxBy(items, scoreOf, threshold, strict = false) {
    let best = null;
    for (const item of items) {
        const score = scoreOf(item);
        const bar = best?.score ?? threshold;
        if (strict ? score > bar : score >= bar)
            best = { item, score };
    }
    return best;
}
export function argmaxCosine(query, items, vecOf, threshold, strict = false) {
    return argmaxBy(items, (item) => {
        const v = vecOf(item);
        return v ? cosine(query, v) : -Infinity;
    }, threshold, strict);
}
/** The guided-or-first continuation of a node, as answer-shaped bytes source:
 *  chooseNext under the response guide, falling back to the FIRST-inserted
 *  edge — the one no-guide convention chooseNext, project() and the search's
 *  formRules all share.  undefined when the node has no continuation. */
export function guidedFirst(ctx, id) {
    const pick = guidedNext(ctx, id);
    if (pick !== undefined)
        return pick;
    // No guide in flight (or nothing chosen): the first-inserted edge, read
    // with LIMIT 1 — never the full fan-out.
    const nx = ctx.store.nextFirst(id, 1);
    return nx.length > 0 ? nx[0] : undefined;
}
export function guidedNext(ctx, node) {
    if (ctx._edgeGuide === null)
        return undefined;
    // The pick memo is BYPASSED while a rationale trace is attached — the same
    // policy climbMemo and recogniseMemo follow (every mechanism must emit its
    // own steps; a memo hit would swallow the repeat's `disambiguate` step).
    // Consistency does not need the memo: chooseNext is a pure function of the
    // (read-only) store and the guide, so recomputation yields the same pick.
    if (!ctx.trace) {
        const memo = ctx._edgeChoice.get(node);
        if (memo !== undefined)
            return memo === -1 ? undefined : memo;
    }
    const pick = chooseNext(ctx, node, ctx._edgeGuide);
    if (!ctx.trace)
        ctx._edgeChoice.set(node, pick ?? -1);
    return pick;
}
/** Disambiguate among a node's learnt continuations by distributional
 *  support.  NOTE the `guide` contract: its VALUE is deliberately unused —
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
export function chooseNext(ctx, id, guide) {
    // CAPPED read: only the first √N continuations are ever candidates (the
    // documented hub trade), so only they are read — a hub context's full
    // fan-out is corpus-sized and must never be materialised.  hubBound ≥ 2,
    // so the single-continuation fast path below stays exact.
    const nx = ctx.store.nextFirst(id, hubBound(ctx));
    if (nx.length === 0)
        return undefined;
    if (nx.length === 1 || !guide)
        return nx[0];
    // Cap candidates at √N — the same bound the original chooseAmong used.
    // A hub context can accumulate thousands of continuations; the best-fit
    // one is among the first √N by insertion order (edges are never deleted,
    // so the oldest are the most established).  A strongly-supported edge
    // inserted beyond the cap is invisible here — the deliberate trade
    // against paying O(fan-out) count reads on every disambiguation.
    const capped = nx; // already the hub-capped prefix, by the read above
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
        if (support < bestSupport)
            continue;
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
    // each corroborating region contributes at most ln N and the floor grows
    // with N exactly as that per-region ceiling does (HOW_IT_WORKS.md §8.6).
    // `bestSupport` here is a different kind of quantity — a raw prevCount of
    // how many training contexts predicted ONE destination, bounded by how
    // often that specific fact was retold, never by corpus size N.  Gating an
    // N-invariant count against an N-growing threshold guarantees failure
    // once N is large enough, discarding genuinely, structurally dominant
    // edges (observed: a fact corroborated 2-to-1-1-1 refused at N≈325K,
    // falling back to a noisy concept-hop).  The loop above already IS the
    // "genuinely competing" test: a tie leaves first-inserted as the pick
    // (test/30's own pinned behaviour); a strict winner is real evidence
    // regardless of corpus scale.  Matches HOW_IT_WORKS.md §25's own
    // chooseNext pseudocode, which has no such floor.
    // Trace is built lazily — the filter + map below only execute when a
    // trace listener is attached, so the common (no-trace) path pays only
    // for the prevCount calls in the loop above, never for extra rItemShort
    // byte-reads.
    if (ctx.trace) {
        const others = capped.filter((c) => c !== best);
        ctx.trace.step("disambiguate", [rItemShort(ctx, best, "halo-evidence", bestSupport)], others.map((c) => rItemShort(ctx, c, "candidate", ctx.store.prevCount(c))), `${capped.length} continuations — distributional evidence selects ` +
            `the most corroborated (distinct contexts ${bestSupport}, ` +
            `poured mass ${bestMass})`);
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
export function candidateGist(ctx, c) {
    const hit = ctx._gistCache.get(c);
    if (hit !== undefined)
        return hit;
    const b = read(ctx, c);
    if (b.length === 0)
        return null;
    const g = gistOf(ctx, b);
    ctx._gistCache.set(c, g);
    return g;
}
export function chooseAmong(ctx, candidates, guide) {
    const capped = hubCap(ctx, candidates);
    const found = argmaxCosine(guide, capped, (c) => candidateGist(ctx, c), -Infinity, true);
    return found
        ? { id: found.item, score: found.score }
        : { id: candidates[0], score: -Infinity };
}
// ── Trace shim (used by chooseNext before trace module is loaded) ────────
import { decodeText } from "./rationale.js";
function rItemShort(ctx, id, role, score) {
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
 *  WHAT IT IS FOR.  Several mechanisms ground a query through the literal
 *  spans it did NOT explain, and those spans are the whole of their evidence.
 *  When every one of them is a hub, the query says nothing the corpus can be
 *  held to, and grounding it means picking one of thousands of continuations
 *  it gives no evidence for — a fabrication whatever the answer happens to be.
 *  Answering with silence there is the honest degradation contract (§2.13).
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
 *  NO NEW THRESHOLD (§2.2): `hubBound` is the √N reading of "hub" used
 *  everywhere, and the containment read is clamped to it exactly as every
 *  other fan-out read is (§2.8).  A query with no stored window at all is NOT
 *  scaffolding-only — it has no evidence either way, and its callers already
 *  refuse it on their own terms. */
export function allWindowsAreScaffolding(ctx, query) {
    const W = ctx.space.maxGroup;
    const bound = hubBound(ctx);
    let sawOne = false;
    for (let o = 0; o + W <= query.length; o++) {
        const ids = leafIdRun(ctx, query, o, o + W);
        if (ids === null)
            continue;
        const id = ctx.store.findBranch(ids);
        if (id === null)
            continue;
        const rarity = ctx.store.containersSlice(id, 0, bound + 1).length;
        if (rarity === 0)
            continue;
        if (rarity <= bound)
            return false;
        sawOne = true;
    }
    return sawOne;
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
 *  BOUNDED (§2.8), AND WITH NO NEW THRESHOLD.  The window whose containment is
 *  SMALLEST carries the most evidence, and one saturated at `hubBound` carries
 *  none — that is the same √N reading of "hub" the rest of the mind uses, not
 *  a tuned knob.  The upward walk spends a budget of `hubBound` nodes and
 *  fans out by W, so a hub query enumerates nothing and the caller stays
 *  silent rather than guessing (§2.13).  Measured on the trained store: the
 *  photosynthesis form at a one-byte truncation picks a window with 52
 *  containers, visits 446 nodes, and yields exactly ONE candidate that
 *  survives the caller's byte compare — the form itself.
 *
 *  These are PROPOSALS only.  Every candidate still faces the byte-exact
 *  prefix compare and all three guards below, so a wrong proposal costs one
 *  bounded read and can never be voiced (§2.3). */
export function formsOpenedBy(ctx, query) {
    const store = ctx.store;
    const W = ctx.space.maxGroup;
    const run = leafIdPrefix(ctx, query);
    // The widest canonical window is the most discriminative one the write side
    // ever interned; a query too short to spell one carries no window evidence.
    const len = canonicalWindows(W)[1];
    if (run.length < len)
        return [];
    const bound = hubBound(ctx);
    let best = null;
    let bestN = 0;
    for (let off = 0; off + len <= run.length; off++) {
        const wid = store.findBranch(run.slice(off, off + len));
        if (wid === null)
            continue;
        const n = store.containersSlice(wid, 0, bound).length;
        // Empty says the window spans no chunk; saturated says it is a hub, whose
        // containment discriminates nothing.  Neither is evidence.
        if (n === 0 || n >= bound)
            continue;
        if (best === null || n < bestN) {
            best = wid;
            bestN = n;
        }
    }
    if (best === null)
        return [];
    let frontier = store.containersSlice(best, 0, bound);
    const seen = new Set(frontier);
    let budget = bound;
    while (frontier.length > 0 && budget > 0) {
        const next = [];
        for (const f of frontier) {
            if (budget-- <= 0)
                break;
            for (const p of store.parentsFirst(f, W)) {
                if (seen.has(p))
                    continue;
                seen.add(p);
                next.push(p);
            }
        }
        frontier = next;
    }
    return [...seen];
}
