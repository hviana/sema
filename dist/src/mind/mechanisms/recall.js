// mechanisms/recall.ts — Recall by resonance (Grounding IV).
//
// The recall mechanism resonates the whole query's gist against the content
// index and grounds the nearest learned form.  Four tiers, orderly degrading
// from exact self-match to honest echo.
import { cosine } from "../../vec.js";
import { consensusFloor, identityBar, reachThreshold, significanceBar, } from "../../geometry.js";
import { gistOf, read, resolve } from "../primitives.js";
import { corpusN, hubBound } from "../traverse.js";
import { project, reverseContext } from "../match.js";
import { CONCEPT, STEP } from "../graph-search.js";
import { unexplainedLabel } from "../rationale.js";
import { rItem, rNode } from "../trace.js";
/** Recall the answer by resonating the whole query against the content index. */
export async function recallByResonance(ctx, query, pre) {
    const t = ctx.trace?.enter("recallByResonance", [
        rItem(query, "query"),
    ]);
    const whole_ = [[0, query.length]];
    const nothing = [];
    const ground = (bytes, note, accounted, moves, echoed = false) => {
        t?.done(bytes === null
            ? []
            : [rItem(bytes, "answer", resolve(ctx, bytes) ?? undefined)], note);
        return bytes === null ? null : {
            bytes,
            echoed,
            accounted,
            moves,
            unexplained: unexplainedLabel(query, accounted),
        };
    };
    const k = pre.k;
    const queryGist = pre.guide;
    // 0. Exact self-match — content-addressed, deterministic.
    const qId = pre.queryResolved;
    if (qId !== null) {
        const rev = ctx.store.prevFirst(qId, hubBound(ctx));
        const g = reverseContext(ctx, qId, queryGist, rev);
        if (g !== null) {
            return ground(g, rev.length === 1
                ? "exact self-match — reverse recall to the sole predecessor"
                : "exact self-match — reverse recall to the best-resonating predecessor", nothing, STEP);
        }
    }
    const whole = await ctx.store.resonate(queryGist, k);
    if (whole.length === 0) {
        return ground(null, "empty store — nothing to resonate with", [], 0);
    }
    const top = whole[0];
    ctx.trace?.step("resonate", [rItem(query, "query-gist")], whole.map((h) => rNode(ctx, h.id, "hit", h.score)), `resonate the whole-query gist → ${whole.length} nearest learnt form(s)`);
    // 1. Clean resonance — the scale-aware identity claim.  The ANGLE
    // (top.score) carries the shared fraction; the query's MAGNITUDE (√len,
    // the linear fold's own norm) converts the tolerated foreign fraction
    // into bytes — at most one river window (see {@link identityBar}).  A
    // fixed cosine bar let long queries claim "near-identical" while whole
    // windows — an answer word — differed.
    if (top.score >= identityBar(ctx.store.D, ctx.space.maxGroup, query.length)) {
        for (const h of whole) {
            if (h.id === qId || h.score >= 1.0) {
                const rev = ctx.store.prevFirst(h.id, hubBound(ctx));
                const g = reverseContext(ctx, h.id, queryGist, rev);
                if (g !== null) {
                    return ground(g, rev.length === 1
                        ? "perfect self-match — reverse recall to the sole predecessor"
                        : "perfect self-match — reverse recall to the best-resonating predecessor", nothing, STEP);
                }
                const own = read(ctx, h.id);
                if (own.length > 0) {
                    return ground(own, "perfect self-match — the query IS this node", nothing, STEP);
                }
            }
            const g = await project(ctx, h.id, queryGist);
            if (g) {
                return ground(g, "clean whole-query resonance — ground the nearest hit", whole_, STEP);
            }
        }
    }
    // 2. Scaffolding-dominated.
    if (top.score >= significanceBar(ctx.store.D)) {
        const N = corpusN(ctx);
        const minVote = consensusFloor(N);
        // The committed points of attention ARE the shared climb's roots (same
        // query, same k, same DF mode) — read them from Precomputed instead of
        // re-climbing, so even a traced response pays for the climb once.
        const forest = (await pre.attention()).roots;
        if (forest.length > 0 && forest[0].vote >= minVote) {
            const g = await project(ctx, forest[0].anchor, queryGist);
            if (g) {
                return ground(g, "scaffolding-dominated query — ground the consensus-climb anchor", [[forest[0].start, forest[0].end]], CONCEPT);
            }
        }
    }
    // 3. Last resort — gated on the FRACTION OF THE QUERY the grounding
    // explains, not the raw cosine.  Root gists are unit vectors, but their
    // magnitudes are recoverable from the byte lengths (‖·‖ = √len under the
    // linear fold): cos = shared/√(lenQ·lenG), so shared/lenQ = cos·√(lenG/lenQ).
    // The raw cosine punished honest containment — a query fully inside a
    // longer grounded answer scored √(lenQ/lenG) and was refused — and let a
    // long answer sharing only scaffolding pass; the query-relative fraction
    // measures exactly what the reach bar means: how much of THE QUERY the
    // store accounts for.
    const fracOfQuery = (cos, otherLen) => Math.min(1, cos * Math.sqrt(otherLen / Math.max(1, query.length)));
    for (const h of whole) {
        const g = await project(ctx, h.id, queryGist);
        if (g) {
            if (fracOfQuery(cosine(queryGist, gistOf(ctx, g)), g.length) >=
                reachThreshold(ctx.space.maxGroup)) {
                return ground(g, "last resort: the nearest grounded whole-query hit", [], STEP);
            }
        }
    }
    // The refusal/echo decision, in the same query-relative units — the top
    // hit's magnitude read from the store (contentLen: √bytes IS the linear
    // fold's gist norm), never from re-reading its bytes.
    // The magnitude read SATURATES at the decision point: frac reaches the
    // reach bar exactly when lenH = lenQ·(reach/score)², so the walk never
    // needs to see past that — a huge conversation root costs a capped read,
    // and a clamped return decides "pass" identically (frac ≥ reach).
    const reach = reachThreshold(ctx.space.maxGroup);
    const lenCap = Math.ceil(query.length * (reach / Math.max(top.score, 1e-6)) ** 2) + 1;
    if (fracOfQuery(top.score, ctx.store.contentLen(top.id, lenCap)) < reach) {
        return ground(null, "below reach threshold — nothing in the store relates to this query", [], 0);
    }
    // Honest echo.
    return ground(read(ctx, top.id), "last resort: the nearest resonant form's own bytes (echo, not grounded)", [], 0, true);
}
// ── Pipeline mechanism ──────────────────────────────────────────────────────
export const recallMechanism = {
    name: "recall",
    provenance: "recall",
    // Recall's floor is free to state (one STEP-grade projection) and its run
    // gates its own tiers — no expensive investment happens inside floor, so
    // there is nothing to guard with worthRunning here: the pipeline's own
    // check prunes run() against the incumbent.
    async floor(_ctx, _query, _pre, _worthRunning) {
        return STEP;
    },
    async run(ctx, query, pre) {
        const r = await recallByResonance(ctx, query, pre);
        if (!r)
            return [];
        return [{
                bytes: r.bytes,
                accounted: r.accounted,
                moves: r.moves,
                unexplained: r.unexplained,
                provenance: r.echoed ? "recall-echo" : "recall",
            }];
    },
};
