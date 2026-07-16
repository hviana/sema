// pipeline.ts — the think pipeline (Section 5 of the mind).
//
// think() is the whole file's job: one lightest-derivation choice among
// UNIFORM mechanisms.  The pipeline sees mechanisms through the
// PipelineMechanism interface only — it never imports a mechanism-specific
// type and never has a special-case branch for any mechanism.  Adding a
// mechanism means registering one object; removing one means dropping it
// from the list.  The mechanisms themselves live in mechanisms/ (one file
// each); the shared pre-computation they exchange lives in Precomputed
// (pipeline-mechanism.ts).
import { PASS, STEP } from "./graph-search.js";
import { gistOf, resolve } from "./primitives.js";
import { recognise } from "./recognition.js";
import { fuseAttention, reason } from "./reasoning.js";
import { unexplainedSpans } from "./rationale.js";
import { rItem } from "./trace.js";
import { Precomputed } from "./pipeline-mechanism.js";
import { coverMechanism } from "./mechanisms/cover.js";
import { castMechanism } from "./mechanisms/cast.js";
import { confluenceMechanism } from "./mechanisms/confluence.js";
import { extractionMechanism } from "./mechanisms/extraction.js";
import { recallMechanism } from "./mechanisms/recall.js";
// Re-exports: cover's pre-resolution helpers and the ALU adapter kept
// importable from the pipeline module (their historical home).
export { resolveConcepts, resolveConnectors } from "./mechanisms/cover.js";
export { aluToMechanism } from "./mechanisms/alu.js";
// ── Extension dispatch (pre-loop parse) ─────────────────────────────────────
async function collectComputed(mechanisms, query) {
    const out = [];
    for (const m of mechanisms) {
        if (m.parse)
            out.push(...await m.parse(query));
    }
    return out;
}
// ── Built-in mechanisms ─────────────────────────────────────────────────────
// ORDER MATTERS, but only through the uniform floor/worthRunning pruning —
// no mechanism is special-cased.  Cover runs FIRST: when a computed
// extension result (e.g. ALU) exists, cover masks it in at near-zero cost
// (see mechanisms/cover.ts), which becomes `best` before any other mechanism
// invests in its own precomputation.  CAST's and confluence's floors (2*STEP,
// 3*STEP) then fail `worthRunning` and are skipped by the SAME admissible-
// floor pruning every mechanism is already subject to — not by asking
// "is this an extension?".  Grade TIES keep the earlier candidate, so this
// order is also the tie-break priority: cover, cast, confluence, extraction,
// recall.
export const defaultMechanisms = [
    coverMechanism,
    castMechanism,
    confluenceMechanism,
    extractionMechanism,
    recallMechanism,
];
/** Think: a single lightest-derivation exploration of the Sema graph.
 *
 *  Every answer travels the same path:
 *    1. Pre-computation — recognise, extension parse, guide; everything
 *       expensive stays lazy on Precomputed until a mechanism asks.
 *    2. Grounding — every mechanism yields candidates weighed in the one
 *       cost ladder; the lightest grounding derivation wins.
 *    3. Post-grounding — diagnostics (narrowDecision, thinGrounding),
 *       reasoning (multi-hop), fusion (multi-topic). */
export async function think(ctx, query, mechs) {
    if (query.length === 0)
        return null;
    ctx._edgeGuide = gistOf(ctx, query);
    ctx._edgeChoice.clear();
    const t = ctx.trace?.enter("think", [rItem(query, "query")]);
    const done = (answer, note) => {
        t?.done(answer
            ? [rItem(answer, "answer", resolve(ctx, answer) ?? undefined)]
            : [], note);
        return answer;
    };
    // ── Pre-computation ──────────────────────────────────────────────────
    const mechanisms = mechs ?? defaultMechanisms;
    const rec = recognise(ctx, query);
    // Phase 1: collect computed spans from mechanisms that implement parse()
    const computed = await collectComputed(mechanisms, query);
    if (computed.length > 0) {
        ctx.trace?.step("computeExtensions", [rItem(query, "query")], computed.map((u) => rItem(query.subarray(u.i, u.j), "operand", undefined, [u.i, u.j])), `extensions recognised and evaluated ${computed.length} computation(s)`);
        for (const u of computed) {
            ctx.trace?.step("evalComputation", [rItem(query.subarray(u.i, u.j), "expression", undefined, [u.i, u.j])], [rItem(u.bytes, "result", resolve(ctx, u.bytes) ?? undefined)], "evaluate the recognised operation to its authoritative result");
        }
    }
    // Phase 2: the shared pre-computation container.  Eager fields only
    // (recognition, computed spans, guide) — every expensive analysis
    // (consensus climb, weave, span-shape classification) is a lazily-cached
    // method on Precomputed, first-touched by whichever mechanism's floor
    // survives its cheap gates and the worthRunning check.  A query no
    // mechanism climbs for (e.g. one an extension decided) never climbs.
    const pre = new Precomputed(ctx, query, rec, computed, ctx._edgeGuide);
    const grade = (w) => Math.floor(w / STEP);
    const unaccounted = (spans) => unexplainedSpans(query.length, spans)
        .reduce((sum, [s, e]) => sum + (e - s), 0);
    const weigh = (accounted, moves) => moves + PASS * unaccounted(accounted);
    const candidates = [];
    let best = null;
    const consider = (c) => {
        if (c.bytes.length === 0)
            return;
        candidates.push(c);
        if (best === null || grade(c.weight) < grade(best.weight))
            best = c;
    };
    const worthRunning = (floor) => best === null || grade(floor) < grade(best.weight);
    // Phase 3: grounding loop
    for (const mech of mechanisms) {
        const floor = await mech.floor(ctx, query, pre, worthRunning);
        if (floor === null) {
            ctx.trace?.step("skipMechanism", [], [], `${mech.name} skipped — structural precondition failed`);
            continue;
        }
        if (!worthRunning(floor)) {
            ctx.trace?.step("skipMechanism", [], [], `${mech.name} skipped — floor ${floor} cannot beat incumbent (grade ${grade(best.weight)})`);
            continue;
        }
        const results = await mech.run(ctx, query, pre);
        for (const r of results) {
            const weight = r.weight ?? weigh(r.accounted, r.moves);
            consider({
                bytes: r.bytes,
                provenance: r.provenance ?? mech.provenance,
                weight,
                used: r.used,
                accounted: r.accounted,
                unexplained: r.unexplained,
            });
        }
    }
    // (TS cannot see the closure assignments into `best` and narrows it to its
    // initial null, so the read-back needs the assertion.)
    const decided = best;
    if (candidates.length > 1) {
        ctx.trace?.step("decideGrounding", candidates.map((c) => rItem(c.bytes, `${c.provenance} (weight ${c.weight.toFixed(3)}${c.unexplained ? `, unexplained: "${c.unexplained}"` : ""})`)), decided ? [rItem(decided.bytes, decided.provenance)] : [], "the lightest grounding derivation wins — every mechanism weighed in the one cost ladder");
        if (decided !== null) {
            let runnerUp = null;
            for (const c of candidates) {
                if (c === decided)
                    continue;
                if (runnerUp === null || grade(c.weight) < grade(runnerUp.weight)) {
                    runnerUp = c;
                }
            }
            if (runnerUp !== null) {
                const margin = grade(runnerUp.weight) - grade(decided.weight);
                if (margin <= 1) {
                    ctx.trace?.step("narrowDecision", [
                        rItem(decided.bytes, `${decided.provenance} (weight ${decided.weight.toFixed(3)})`),
                    ], [
                        rItem(runnerUp.bytes, `${runnerUp.provenance} (weight ${runnerUp.weight.toFixed(3)})`),
                    ], `margin ${margin} grade-unit(s) — the decision could change with one more training fact`);
                }
            }
        }
    }
    if (decided === null) {
        done(null, "no mechanism grounded an answer");
        return null;
    }
    // Honesty density
    {
        const covered = query.length - unaccounted(decided.accounted);
        const density = query.length > 0 ? covered / query.length : 1;
        const thinBar = 1 / ctx.space.maxGroup;
        if (density < thinBar) {
            ctx.trace?.step("thinGrounding", [rItem(decided.bytes, decided.provenance)], [], `grounded but thin — density ${density.toFixed(3)} is below 1/W (${thinBar.toFixed(3)})`);
        }
    }
    const answer = decided.bytes;
    const provenance = decided.provenance;
    const castUsed = decided.used ?? new Set();
    // ── Post-grounding, gated by provenance ──────────────────────────────
    const preConsumed = provenance === "cast" || provenance === "join"
        ? castUsed
        : provenance === "recall" || provenance === "recall-echo"
            ? new Set()
            : new Set(recognise(ctx, answer).sites.map((s) => s.payload));
    const reasoned = await reason(ctx, query, answer, preConsumed, pre);
    const fused = provenance === "recall" || provenance === "recall-echo"
        ? await fuseAttention(ctx, query, reasoned, pre)
        : reasoned;
    done(fused, "grounded, reasoned forward, fused across points of attention");
    return { bytes: fused, provenance };
}
