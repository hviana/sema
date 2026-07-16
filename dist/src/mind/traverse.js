// traverse.ts — Traverse primitives + disambiguation (Sections 1 & 6 of the mind).
//
//   Traverse — node → nodes   (edgeAncestors, nextOf, prevOf, contains,
//                               guidedNext, chooseNext, chooseAmong, hubCap)
//
// The PROJECTIONS built on these walks (follow, conceptHop, reverseContext,
// project) live in match.ts — the elementary match-and-project operation.
import { cosine } from "../vec.js";
import { gistOf, read } from "./primitives.js";
const structCaches = new WeakMap();
function getStructCache(ctx) {
    if (ctx.climbMemo === null)
        return null;
    let c = structCaches.get(ctx.climbMemo);
    if (c === undefined) {
        structCaches.set(ctx.climbMemo, c = {
            hasNext: new Map(),
            prevCount: new Map(),
            hasParents: new Map(),
        });
    }
    return c;
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
    const bound = Math.ceil(Math.sqrt(contextCount));
    const roots = [];
    const seen = new Set([id]);
    const ctxSeen = new Set();
    let saturated = false;
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
    const visit = (x) => {
        const hasNx = cachedHasNext(ctx, x, structCache);
        const pc = cachedPrevCount(ctx, x, structCache);
        if (hasNx || pc > 0) {
            roots.push(x);
            if (hasNx)
                ctxSeen.add(x);
            if (pc > bound)
                return false; // decided: ≥ pc > √N distinct contexts
            for (const p of ctx.store.prevFirst(x, bound))
                ctxSeen.add(p);
            if (ctxSeen.size > bound)
                return false; // decided
        }
        const parents = ctx.store.parentsFirst(x, bound + 1);
        if (parents.length > bound)
            return false; // decided: hub
        let fresh = 0;
        for (const p of parents) {
            if (!seen.has(p)) {
                seen.add(p);
                stack.push(p);
                fresh++;
            }
        }
        if (fresh > 1) {
            lateral += fresh - 1;
            if (lateral > bound)
                return false; // decided: cone-wide hub
        }
        return true;
    };
    const stack = [];
    const containment = !cachedHasParents(ctx, id, structCache);
    if (!containment)
        stack.push(id);
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
                }
            }
            if (stack.length === 0) {
                if (containerOff === 0)
                    stack.push(id); // no containers at all
                else
                    break;
            }
        }
        while (stack.length > 0) {
            let x = stack.pop();
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
            }
            if (!visit(x)) {
                saturated = true;
                break climb;
            }
        }
    }
    const reach = { roots, contextsReached: ctxSeen.size, saturated };
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
    return Math.ceil(Math.sqrt(corpusN(ctx)));
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
