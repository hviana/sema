// confluence.ts — Confluence Join (Section 4 of the mind).
//
// THE CLASS THIS SOLVES: conjunctive queries — answers that are stored in NO
// single fact and exist only as the INTERSECTION of independent evidence
// streams.  "Which material is translucent and featherlight?"  No learnt form
// contains the answer; each constraint reaches its own set of exemplars, and
// the entity satisfying both lives exactly where those sets MEET.  Every
// other mechanism produces its answer by following ONE evidence path (a
// chain, a reverse step, a halo hop, one aligned frame); the consensus climb
// SUMS votes, fusion CONCATENATES topics, CAST COMPARES two seats — none of
// them intersects, so this class was previously answered wrong (fusion pairs
// one fact per constraint, from DIFFERENT entities).
//
// THE MEET IS NATIVE, NOT A BYTE SCAN.  The store is content-addressed: any
// content two deposits share IS the same node id, interned once at write
// time (hash-consing) — so "what do these two facts have in common?" is a
// SET INTERSECTION OF IDENTITIES the write side already computed, asked
// through the canonical window read (leafIdRun/findBranch — the same
// write/read contract recognition runs on).  Three identity/structure tests
// make the whole mechanism:
//
//   • constraint streams — the consensus climb's ranked anchors, each bound
//     to the query spans whose DISCRIMINATIVE windows it holds by identity
//     (a resonance-voted anchor holding none of the query's discriminative
//     content is no constraint at all); two streams are independent when
//     the content they bind is disjoint;
//   • the meet — window ids present in BOTH anchors and ABSENT from the
//     query: shared-with-query windows are the constraint being re-named
//     (or its scaffolding), so subtracting the query's own window ids
//     leaves exactly the content the question asks FOR — the open seat;
//   • the filler/scaffolding separator — the same structural IDF the climb
//     derives (edgeAncestors' contextsReached): shared content reaching a
//     corpus minority of contexts is an entity, content reaching a majority
//     is frame scaffolding.  No statistics, no learning — the same global-
//     quantity-from-capped-local-probes reading that makes the climb's IDF
//     work, pointed at a new question.
//
// HONESTY: the meet can only ever name content that structurally exists in
// two independently learnt exemplars — an empty intersection yields null and
// the ordinary pipeline decides.  Confluence cannot fabricate.
import { read } from "../primitives.js";
import { corpusN, reachOf } from "../traverse.js";
import { dominates } from "../../geometry.js";
import { STEP } from "../graph-search.js";
import { unexplainedLabel } from "../rationale.js";
import { rItem, rNode } from "../trace.js";
/** The main confluence entry point.  Given a query, detect whether it weaves
 *  two or more INDEPENDENT constraints (ranked anchors supported by disjoint
 *  query spans), intersect the constraints' evidence by content-addressed
 *  identity, and return the discriminative content the streams share — the
 *  entity that satisfies all constraints at once.  Null when the query is
 *  not conjunctive or nothing lies in the intersection. */
export async function confluenceJoin(ctx, query, pre) {
    const W = ctx.space.maxGroup;
    if (query.length < 2 * W || ctx.store.edgeSourceCount() === 0)
        return null;
    const { ranked } = await pre.attention();
    if (ranked.length < 2)
        return null;
    const N = corpusN(ctx);
    // Response-scoped shared memos: the anchor-window identities and the
    // structural-IDF reach live on Precomputed, so any other identity-based
    // mechanism in the same response reuses them.
    const reachMemo = pre.reachMemo;
    const windowsOfAnchor = (anchor) => pre.windowsOf(anchor);
    // The query's own window identities, offset → id (the canonical
    // content-addressed read, canonical.windowIds): whatever the meet shares
    // with the query is the CONSTRAINT being re-named (or its scaffolding),
    // never the open seat the question asks for — subtracted by identity,
    // below.
    const queryWin = pre.queryWindows;
    const queryIds = new Set(queryWin.values());
    const streams = [];
    const rankedCapped = ranked.length > pre.k ? ranked.slice(0, pre.k) : ranked;
    for (const cand of rankedCapped) {
        if (streams.some((s) => s.anchor === cand.anchor))
            continue;
        const ids = new Set(windowsOfAnchor(cand.anchor).values());
        if (ids.size === 0)
            continue;
        const cover = [];
        const held = [];
        let curC = null;
        let curH = null;
        for (const [off, wid] of queryWin) {
            if (!ids.has(wid))
                continue;
            if (curH !== null && off <= curH[1])
                curH[1] = off + W;
            else
                held.push(curH = [off, off + W]);
            if (dominates(reachOf(ctx, wid, N, reachMemo), N))
                continue; // scaffolding never binds
            if (curC !== null && off <= curC[1])
                curC[1] = off + W;
            else
                cover.push(curC = [off, off + W]);
        }
        if (cover.length > 0) {
            streams.push({ anchor: cand.anchor, vote: cand.vote, ids, cover, held });
        }
    }
    if (streams.length < 2)
        return null;
    // Two streams are INDEPENDENT constraints when the query content they
    // hold is disjoint — each answers a different part of what was asked.
    const disjoint = (a, b) => a.cover.every(([as, ae]) => b.cover.every(([bs, be]) => be <= as || bs >= ae));
    let met = null;
    for (let i = 0; i < streams.length; i++) {
        for (let j = i + 1; j < streams.length; j++) {
            const a = streams[i];
            const b = streams[j];
            if (!disjoint(a, b))
                continue;
            const wa = windowsOfAnchor(a.anchor);
            const wb = b.ids;
            // ── The MEET: in both anchors, not in the query ────────────────────
            // Offsets of A whose window id is shared with B and absent from the
            // query — merged into maximal contiguous spans (windows overlap, so
            // consecutive shared offsets weave one span).
            const spans = [];
            let cur = null;
            for (const [off, wid] of wa) {
                const inMeet = wb.has(wid) && !queryIds.has(wid);
                if (inMeet) {
                    if (cur !== null && off <= cur[1])
                        cur[1] = off + W;
                    else
                        spans.push(cur = [off, off + W]);
                }
            }
            if (spans.length === 0)
                continue;
            const aBytes = read(ctx, a.anchor);
            for (const [s, e] of spans) {
                // Scaffolding gate: the span's MOST discriminative window decides.
                // Content reaching a corpus MAJORITY of contexts discriminates
                // nothing (the same half-dominance convention every wrapper test
                // uses); the query-subtraction above already removed everything the
                // question names, so what survives here is a genuine open-seat
                // entity.
                let reach = Infinity;
                for (let off = s; off + W <= e; off++) {
                    const wid = wa.get(off);
                    if (wid !== undefined && wb.has(wid) && !queryIds.has(wid)) {
                        reach = Math.min(reach, reachOf(ctx, wid, N, reachMemo));
                    }
                }
                if (!isFinite(reach) || dominates(reach, N))
                    continue;
                const len = e - s;
                if (met === null || reach < met.reach ||
                    (reach === met.reach && len > met.len)) {
                    met = { bytes: aBytes.subarray(s, e), reach, len, a, b };
                }
            }
        }
    }
    if (met === null)
        return null;
    const t = ctx.trace?.enter("confluence", [rItem(query, "query")]);
    ctx.trace?.step("intersectEvidence", [
        rNode(ctx, met.a.anchor, "constraint", met.a.vote),
        rNode(ctx, met.b.anchor, "constraint", met.b.vote),
    ], [rItem(met.bytes, "meet")], `the discriminative content BOTH constraints' evidence shares, by content-addressed identity (reach ${met.reach} of ${N} contexts)`);
    t?.done([rItem(met.bytes, "answer")], "conjunctive join — the entity where the independent evidence streams meet");
    // Evidence: the query spans whose content the two streams hold by
    // identity (scaffolding included — held, not just the binding cover);
    // the acts were two constraint matches and one meet.
    const accounted = [
        ...met.a.held,
        ...met.b.held,
    ];
    return {
        bytes: met.bytes,
        used: new Set([met.a.anchor, met.b.anchor]),
        accounted,
        moves: 3 * STEP,
        unexplained: unexplainedLabel(query, accounted),
    };
}
// ── Pipeline mechanism ──────────────────────────────────────────────────────
export const confluenceMechanism = {
    name: "confluence",
    provenance: "join",
    async floor(_ctx, query, pre, worthRunning) {
        const W = _ctx.space.maxGroup;
        if (query.length < 2 * W || _ctx.store.edgeSourceCount() === 0)
            return null;
        // Confluence's floor is always exactly 3*STEP when it exists — same
        // investment discipline as CAST's (see cast.ts): when the bound already
        // cannot beat the incumbent, return it UNINVESTED (never first-touch the
        // climb just to be pruned) and let the pipeline record the truthful
        // "cannot beat incumbent" note.
        if (!worthRunning(3 * STEP))
            return 3 * STEP;
        if ((await pre.attention()).ranked.length < 2)
            return null;
        return 3 * STEP;
    },
    async run(ctx, query, pre) {
        const met = await confluenceJoin(ctx, query, pre);
        if (!met)
            return [];
        return [{
                bytes: met.bytes,
                accounted: met.accounted,
                moves: met.moves,
                used: met.used,
                unexplained: met.unexplained,
            }];
    },
};
