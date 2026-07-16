// trace.ts — trace instrumentation + persistence (Section 9 of the mind).
//
//   rItem, rNode, rDeriv — build RationaleItems from bytes/nodes/derivations
//   traceDerivation        — trace a full derivation proof tree
//   MOVE_NOTE              — human-readable names for each derivation move
import { read } from "./primitives.js";
import { decodeText } from "./rationale.js";
export function rItem(bytes, role, node, span) {
    return {
        text: decodeText(bytes),
        role,
        node: node ?? undefined,
        span,
    };
}
export function rNode(ctx, id, role, score) {
    return {
        text: decodeText(read(ctx, id)),
        node: id,
        role,
        score,
    };
}
export function rDeriv(ctx, it, role) {
    const text = it.bytes
        ? decodeText(it.bytes)
        : it.node !== undefined
            ? decodeText(read(ctx, it.node))
            : it.kind === "cover"
                ? `cover@${it.span[0]}`
                : `[${it.span[0]},${it.span[1]})`;
    return { text, role: role ?? it.kind, node: it.node, span: it.span };
}
/** The standard FALL-THROUGH closer every self-gating mechanism ends with:
 *  close the open scope with no outputs and the reason, and return null so
 *  the caller can `return fail("…")` in one expression.  `t` is the scope an
 *  enclosing `ctx.trace?.enter(...)` returned (undefined when not tracing). */
export function traceFail(t) {
    return (note) => {
        t?.done([], note);
        return null;
    };
}
export const MOVE_NOTE = {
    "follow-edge": "follow a learned continuation edge — 'what follows what'",
    "concept-hop": "jump a concept (halo) link — a synonym's edge",
    "voice": "emit the asker's own wording for this form (articulation)",
    "ground": "a chain reached its terminal answer",
    "splice-connector": "splice a learnt connector between two rewrites",
    "split": "cut a span at a sub-leaf form boundary so a form can be reached",
    "fuse": "fuse adjacent fragments toward a deeper learned form",
    "recompose": "recompose fused parts into a learned whole that leads on",
    "bridge": "advance the cover frontier across this span",
    "pool-vote": "pool independent regions' evidence for a shared anchor (sum, not shortest path)",
    "axiom": "a seed: a perceived leaf, recognised form, or computed result",
    "step": "a derivation step",
};
export function traceDerivation(ctx, steps) {
    const t = ctx.trace;
    if (!t)
        return;
    const indexOfOrder = new Map();
    for (const s of steps) {
        const note = MOVE_NOTE[s.move] ?? s.move;
        const deps = s.producers
            .map((o) => indexOfOrder.get(o))
            .filter((x) => x !== undefined);
        const premises = s.premises.map((p) => rDeriv(ctx, p));
        const conclusion = [rDeriv(ctx, s.conclusion)];
        const index = t.step(s.move, premises, conclusion, s.cost > 0 ? `${note} (cost ${s.cost})` : note, deps.length > 0 ? deps : undefined);
        indexOfOrder.set(s.order, index);
    }
}
