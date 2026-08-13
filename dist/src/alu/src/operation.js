// operation.ts — the Operation record and the registry it lives in.
//
// An Operation is the irreducible unit of the ALU.  A PRIMITIVE op has a
// hand-written callback (the kernel's irreducible roots: nand, the real
// arithmetic primitives, converge); a DERIVED op's callback only calls OTHER ops
// by canonical name through the {@link OpContext}.  The two are the SAME type —
// a caller cannot tell a primitive from a derivation — which is the whole point:
// "subtract = add ∘ negate" is registered exactly like a primitive and competes
// in the search exactly like one.  Because a derived callback's body is a
// sequence of `ctx.apply("…", …)` calls, the derivation DAG is literal,
// inspectable source: you can read off, from nand, how every gate is built, and
// from add/multiply/converge how every number-theoretic and numerical op is.
//
// The module is pure.  The one window onto meaning a callback may need — the
// resonant opposite of a symbol, for the polymorphic inverse — arrives through
// {@link ResonanceSync}, which the host pre-resolves (SEMA's async resonance is
// hoisted out of the synchronous search, exactly as concept hops and connectors
// are).  ALU never queries resonance itself.
import { isNd, nd } from "./value.js";
/** A resonance that knows nothing — the default when no host is wired in, so
 *  the pure kernel and its tests run with zero coupling.  Op recognition then
 *  falls back to literal surface forms / canonical names only. */
export const NO_RESONANCE = {
    opposite: () => null,
    recogniseOp: () => null,
};
/** The collection of operations, indexed by canonical name and by surface form.
 *  Building a kernel is a sequence of {@link prim}/{@link derive} calls; the
 *  registry then resolves names at apply time, so registration order need only
 *  respect the dependency DAG loosely (a derived op may reference an op
 *  registered later, since resolution is lazy). */
export class OperationRegistry {
    ops = new Map();
    /** Surface form → the canonical names that claim it.  A form may be shared
     *  (e.g. "-" is both subtract and negate); the caller disambiguates by arity
     *  and position, so the index keeps every claimant. */
    formIndex = new Map();
    /** Register an operation record directly. */
    register(op) {
        this.ops.set(op.name, op);
        for (const f of op.forms) {
            const a = this.formIndex.get(f);
            if (a) {
                if (!a.includes(op.name))
                    a.push(op.name);
            }
            else
                this.formIndex.set(f, [op.name]);
        }
    }
    /** Register a PRIMITIVE op (hand-written callback), with optional {@link
     *  OpTraits} — structural (consumes an nd whole, exempt from broadcast),
     *  infix binding, expression-operand — declared here, next to the op. */
    prim(name, arity, forms, fn, traits = {}) {
        this.register({ name, arity, primitive: true, forms, fn, ...traits });
    }
    /** Register a DERIVED op (callback composes other ops via ctx).  `traits`
     *  as in {@link prim}. */
    derive(name, arity, forms, fn, traits = {}) {
        this.register({ name, arity, primitive: false, forms, fn, ...traits });
    }
    /** The op with this canonical name, or undefined. */
    get(name) {
        return this.ops.get(name);
    }
    has(name) {
        return this.ops.has(name);
    }
    /** The canonical names a surface form maps to (empty if none).  Several ops
     *  can share one surface (unary vs binary "-"), so this returns all. */
    lookupForm(form) {
        return this.formIndex.get(form) ?? [];
    }
    /** Every (surface form → canonical name) pair — the host enumerates these to
     *  seed its operator recogniser. */
    *formEntries() {
        for (const [form, names] of this.formIndex) {
            for (const name of names)
                yield { form, name };
        }
    }
    /** Every registered canonical name. */
    names() {
        return this.ops.keys();
    }
    /** Build a context bound to a resonance and runtime — the object derived
     *  callbacks call back into.  `apply` validates arity-vs-presence and surfaces
     *  a clear error rather than letting an undefined op silently produce NaN.
     *  An optional expression evaluator lets the numerical layer act on functions
     *  (see {@link EvalExpr}). */
    context(resonance, rt, evalExpr) {
        const self = this;
        const ctx = {
            rt,
            resonance,
            evalExpr,
            has: (name) => self.ops.has(name),
            resolveOp: (op, arity) => self.resolveOp(op, resonance, arity),
            apply(name, args) {
                const op = self.ops.get(name);
                if (!op)
                    throw new Error(`ALU: unknown operation "${name}"`);
                // ── ELEMENT-WISE BROADCAST ────────────────────────────────────────
                // A SCALAR op (non-structural) applied to an n-dimensional argument
                // lifts over it: the op runs on each element and the results re-pack
                // into an nd of the same shape.  This is the ONE place "every operation
                // supports nd" is implemented — add, sin, nand, the polymorphic inverse
                // all broadcast for free, and because each element re-enters `apply`,
                // NESTING recurses (an nd of nd lifts twice) with no extra code.
                //
                //   • several nd args ZIP position-wise (their top-level lengths must
                //     agree); a scalar arg is held constant against the list — so
                //     add([1,2,3],[4,5,6]) = [5,7,9] and add([1,2,3], 10) = [11,12,13].
                //   • a structural op is exempt: it wants the whole list (a reduce
                //     cannot be lifted across the very elements it folds).
                if (!op.structural && args.some(isNd)) {
                    let len = -1;
                    for (const a of args) {
                        if (!isNd(a))
                            continue;
                        if (len === -1)
                            len = a.items.length;
                        else if (a.items.length !== len) {
                            throw new Error(`ALU: cannot broadcast "${name}" over lists of unequal length ` +
                                `(${len} vs ${a.items.length})`);
                        }
                    }
                    const out = [];
                    for (let i = 0; i < len; i++) {
                        out.push(ctx.apply(name, args.map((a) => isNd(a) ? a.items[i] : a)));
                    }
                    return nd(out);
                }
                if (op.arity !== "variadic" && args.length !== op.arity) {
                    throw new Error(`ALU: "${name}" expects ${op.arity} operand(s), got ${args.length}`);
                }
                return op.fn(args, ctx);
            },
        };
        return ctx;
    }
    /** Resolve an operation-denoting value to a canonical op name — the shared
     *  machinery behind {@link OpContext.resolveOp}.  Tries, in order: a literal
     *  surface form (the registry's own index, arity-disambiguated), the meaning
     *  via `resonance.recogniseOp`, then a bare canonical name / decimal reading.
     *  Returns null when nothing resolves.  Static-shaped (takes the resonance
     *  explicitly) so both the context closure and callers can use it. */
    resolveOp(op, resonance, arity) {
        // The op-value's surface text, if it has a byte reading.
        let text = null;
        if (op.domain === "symbol") {
            let s = "";
            for (let i = 0; i < op.bytes.length; i++) {
                s += String.fromCharCode(op.bytes[i]);
            }
            text = s.trim();
        }
        else if (op.domain === "int")
            text = op.n.toString();
        else if (op.domain === "bit")
            text = String(op.b);
        if (text === null || text.length === 0)
            return null;
        // (1) a literal SURFACE FORM, arity-disambiguated when asked.
        const claimants = this.formIndex.get(text);
        if (claimants && claimants.length > 0) {
            if (arity !== undefined) {
                for (const n of claimants) {
                    const o = this.ops.get(n);
                    const a = o && (o.arity === "variadic" ? 2 : o.arity);
                    if (a === arity)
                        return n;
                }
            }
            return claimants[0];
        }
        // (2) the MEANING, via pre-resolved resonance (synonym / multimodal gesture
        //     the bytes do not literally spell) — only a symbol carries meaning.
        if (op.domain === "symbol") {
            const byMeaning = resonance.recogniseOp(op.bytes);
            if (byMeaning && this.ops.has(byMeaning))
                return byMeaning;
        }
        // (3) a bare canonical NAME already registered.
        if (this.ops.has(text))
            return text;
        return null;
    }
}
