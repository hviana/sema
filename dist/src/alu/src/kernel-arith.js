// kernel-arith.ts — the field-and-order layer.
//
// Identities 0 and 1, then the six primitives the field stands on — add,
// negate, multiply, reciprocal, sign (plus floor / mod for integer number
// theory).  Everything else is a derivation:
//
//   subtract  = add ∘ negate
//   divide    = multiply ∘ reciprocal
//   every comparison = sign ∘ subtract        (−1 / 0 / +1 → a truth bit)
//   abs(x)    = multiply(sign x, x)            (no branch needed)
//   min / max = select on compare             (control flow from layer 1)
//   power     = repeated multiply (integer) | exp(e·log b) (real, layer 3)
//   gcd       = Euclid via mod
//
// The arithmetic primitives are POLYMORPHIC over the numeric domains: when every
// operand is exact (bit/int) they run on bigint, so the result is exact past
// 2^53 and AGREES with the nand bootstrap (kernel-bits.ts); the moment a real
// operand appears the whole expression lifts to IEEE doubles, which is what the
// limit layer needs.  This is the hybrid: the bit-vector derivation is the
// proof, native bigint is the exact hot path, native doubles back the reals.
//
// Vector / matrix / polynomial routines (dot, matmul, polyEval, linsolve) take
// JS arrays rather than the flat Value list an infix operator would, because a
// matrix has no sensible two-operand surface form; they are exported as pure
// functions, composed from the same scalar primitives, and tested directly.
// `linsolve` is Gaussian elimination — structured arithmetic, not a new
// primitive.
import { asInt, asReal, bit, int, joinDomain, real, } from "./value.js";
/** Reduce numeric operands in their join domain: exact bigint when all are
 *  bit/int, native double once any is real.  `bigOp` and `realOp` are the same
 *  fold expressed in each carrier. */
function reduceNumeric(args, identityBig, bigOp, realOp) {
    const d = joinDomain(args);
    if (d === "real") {
        let acc = Number(identityBig);
        let first = true;
        for (const a of args) {
            const x = asReal(a);
            acc = first ? x : realOp(acc, x);
            first = false;
        }
        return real(acc);
    }
    let acc = identityBig;
    let first = true;
    for (const a of args) {
        const n = asInt(a);
        acc = first ? n : bigOp(acc, n);
        first = false;
    }
    return int(acc);
}
// The infix binding tiers of arithmetic notation, loosest to tightest.  These
// are declared ONCE, here, next to the ops they describe; the expression
// grammar (expr.ts) reads them off the registry, so no parser hardcodes an
// operator table.  Comparisons deliberately declare NO infix binding: a
// statement like "2+2=4" is a learnt FACT (true/false lives in the corpus),
// not a computation the ALU should evaluate over the learner's head.
const ADDITIVE = { precedence: 1 };
const MULTIPLICATIVE = { precedence: 2 };
const EXPONENT = { precedence: 3, rightAssoc: true };
/** Register the arithmetic layer into `r`. */
export function registerArith(r) {
    // ── identities ──────────────────────────────────────────────────────────
    r.prim("zero", 0, ["0"], () => int(0n));
    r.prim("one", 0, ["1"], () => int(1n));
    // ── primitives ──────────────────────────────────────────────────────────
    // add / multiply are variadic folds (so "sum"/"product" of many is one call);
    // the infix path calls them with exactly two operands.
    r.prim("add", "variadic", ["+", "plus", "sum", "add", "total"], (args) => reduceNumeric(args, 0n, (a, b) => a + b, (a, b) => a + b), { infix: ADDITIVE });
    r.prim("multiply", "variadic", [
        "*",
        "×",
        "·",
        "times",
        "multiply",
        "product",
    ], (args) => reduceNumeric(args, 1n, (a, b) => a * b, (a, b) => a * b), {
        infix: MULTIPLICATIVE,
    });
    r.prim("negate", 1, ["-", "negate", "neg"], (args) => {
        const v = args[0];
        return v.domain === "real" ? real(-v.x) : int(-asInt(v));
    });
    // reciprocal lives in the reals: 1/2 = 0.5, so it lifts to a double (an int
    // result like 1/1 still formats cleanly through the codec).
    r.prim("reciprocal", 1, ["reciprocal", "recip"], (args) => real(1 / asReal(args[0])));
    // sign ∈ {−1, 0, +1}, returned exact (int) so comparisons are exact.
    r.prim("sign", 1, ["sign", "sgn"], (args) => {
        const v = args[0];
        if (v.domain === "real")
            return int(v.x > 0 ? 1n : v.x < 0 ? -1n : 0n);
        const n = asInt(v);
        return int(n > 0n ? 1n : n < 0n ? -1n : 0n);
    });
    // floor / mod — the optional integer-number-theory primitives.
    r.prim("floor", 1, ["floor"], (args) => {
        const v = args[0];
        return v.domain === "real" ? int(BigInt(Math.floor(v.x))) : int(asInt(v));
    });
    // ── derived: the field ─────────────────────────────────────────────────
    r.derive("subtract", 2, ["-", "minus", "subtract", "difference", "less"], (args, ctx) => ctx.apply("add", [args[0], ctx.apply("negate", [args[1]])]), { infix: ADDITIVE });
    r.derive("divide", 2, ["/", "÷", "divide", "over"], (args, ctx) => ctx.apply("multiply", [args[0], ctx.apply("reciprocal", [args[1]])]), { infix: MULTIPLICATIVE });
    // Euclidean-style remainder.  Exact for ints; native % for reals.
    r.derive("mod", 2, ["mod", "%", "modulo"], (args, ctx) => {
        void ctx;
        const d = joinDomain(args);
        if (d === "real")
            return real(asReal(args[0]) % asReal(args[1]));
        return int(asInt(args[0]) % asInt(args[1]));
    }, { infix: MULTIPLICATIVE });
    // ── derived: order (every comparison = sign ∘ subtract → a truth bit) ────
    const cmpSign = (args, ctx) => asInt(ctx.apply("sign", [ctx.apply("subtract", [args[0], args[1]])]));
    r.derive("eq", 2, ["=", "==", "equals", "eq"], (args, ctx) => bit(cmpSign(args, ctx) === 0n ? 1 : 0));
    r.derive("ne", 2, ["!=", "≠", "ne"], (args, ctx) => bit(cmpSign(args, ctx) !== 0n ? 1 : 0));
    r.derive("lt", 2, ["<", "lt"], (args, ctx) => bit(cmpSign(args, ctx) < 0n ? 1 : 0));
    r.derive("le", 2, ["<=", "≤", "le"], (args, ctx) => bit(cmpSign(args, ctx) <= 0n ? 1 : 0));
    r.derive("gt", 2, [">", "gt"], (args, ctx) => bit(cmpSign(args, ctx) > 0n ? 1 : 0));
    r.derive("ge", 2, [">=", "≥", "ge"], (args, ctx) => bit(cmpSign(args, ctx) >= 0n ? 1 : 0));
    // ── derived: magnitude / extremes ────────────────────────────────────────
    // abs(x) = sign(x)·x — branch-free.
    r.derive("abs", 1, ["abs", "|x|"], (args, ctx) => ctx.apply("multiply", [ctx.apply("sign", [args[0]]), args[0]]));
    // min / max select on the comparison — the control flow layer 1 provides.
    r.derive("min", 2, ["min"], (args, ctx) => cmpSign(args, ctx) <= 0n ? args[0] : args[1]);
    r.derive("max", 2, ["max"], (args, ctx) => cmpSign(args, ctx) >= 0n ? args[0] : args[1]);
    // ── derived: power ───────────────────────────────────────────────────────
    // Integer exponent → repeated multiply (exact); non-integer or real → fall to
    // the limit layer's exp(e·log b) when it is registered.
    r.derive("power", 2, ["^", "**", "pow", "power"], (args, ctx) => {
        const base = args[0];
        const e = args[1];
        // An INTEGER-VALUED exponent → repeated multiply (exact), even if it arrived
        // as a real that happens to be whole (a derived call may hand a real 2.0).
        // This keeps b^2 exact and avoids exp(e·ln b), which is approximate and
        // undefined for a negative base (ln(−3) = NaN).  Only a genuinely fractional
        // exponent falls to the limit layer.
        const eInt = e.domain !== "real"
            ? asInt(e)
            : Number.isInteger(e.x)
                ? BigInt(e.x)
                : null;
        if (eInt !== null) {
            let n = eInt;
            const neg = n < 0n;
            if (neg)
                n = -n;
            let acc = int(1n);
            for (let i = 0n; i < n; i++)
                acc = ctx.apply("multiply", [acc, base]);
            return neg ? ctx.apply("reciprocal", [acc]) : acc;
        }
        // Fractional exponent: b^e = exp(e·ln b), needing the limit layer.
        if (ctx.has("exp") && ctx.has("log")) {
            return ctx.apply("exp", [
                ctx.apply("multiply", [e, ctx.apply("log", [base])]),
            ]);
        }
        return real(Math.pow(asReal(base), asReal(e)));
    }, { infix: EXPONENT });
    // gcd via Euclid (mod) — number theory standing on the integer primitives.
    r.derive("gcd", 2, ["gcd"], (args, ctx) => {
        let a = asInt(args[0]);
        let b = asInt(args[1]);
        a = a < 0n ? -a : a;
        b = b < 0n ? -b : b;
        while (b !== 0n) {
            const t = asInt(ctx.apply("mod", [int(a), int(b)]));
            a = b;
            b = t < 0n ? -t : t;
        }
        return int(a);
    });
    // ── polymorphic inverse (the bridge to the symbol domain) ────────────────
    // The additive inverse of a NUMBER is its negation; the inverse of a SYMBOL is
    // its RESONANT OPPOSITE — found by the host's resonance and pre-resolved into
    // ctx.resonance (see resonance.ts).  One op, dispatched on the operand's
    // domain: this is "inverse of 3 is −3, inverse of <a learned form> is its
    // opposite", in any modality.  A bit inverts as logical not.
    r.derive("inverse", 1, ["inverse", "opposite", "invert"], (args, ctx) => {
        const v = args[0];
        if (v.domain === "symbol") {
            const opp = ctx.resonance.opposite(v.bytes);
            // No known opposite → leave the form unchanged rather than fabricate one
            // (faithfulness: ALU never invents meaning resonance did not supply).
            return opp ? { domain: "symbol", bytes: opp } : v;
        }
        if (v.domain === "bit")
            return ctx.apply("not", [v]);
        return ctx.apply("negate", [v]);
    });
    // reciprocal already registered as the multiplicative inverse primitive.
}
// ── exported array routines (derivations whose natural shape is arrays) ──────
/** Horner evaluation of a polynomial whose coefficients run constant-first
 *  (`coeffs[0]` is the constant term).  Pure arithmetic over add/multiply. */
export function polyEval(coeffs, x) {
    let acc = 0;
    for (let i = coeffs.length - 1; i >= 0; i--)
        acc = acc * x + coeffs[i];
    return acc;
}
/** Dot product of two equal-length vectors — a fold of add over multiply. */
export function dot(a, b) {
    if (a.length !== b.length)
        throw new Error("dot: length mismatch");
    let s = 0;
    for (let i = 0; i < a.length; i++)
        s += a[i] * b[i];
    return s;
}
/** Matrix · vector. */
export function matVec(m, v) {
    return m.map((row) => dot(row, v));
}
/** Matrix · matrix. */
export function matMul(a, b) {
    const n = a.length;
    const k = b.length;
    const p = b[0].length;
    const out = Array.from({ length: n }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < p; j++) {
            let s = 0;
            for (let t = 0; t < k; t++)
                s += a[i][t] * b[t][j];
            out[i][j] = s;
        }
    }
    return out;
}
/** Solve A·x = b by Gaussian elimination with partial pivoting — structured
 *  arithmetic (add / multiply / divide / compare for the pivot), not a new
 *  primitive.  Returns x, or null if A is singular to tolerance `tol`. */
export function linsolve(A, b, tol = 1e-12) {
    const n = A.length;
    // Work on an augmented copy so the inputs are untouched.
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        // Partial pivot: the row with the largest |value| in this column.
        let piv = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[piv][col]))
                piv = r;
        }
        if (Math.abs(M[piv][col]) < tol)
            return null; // singular
        [M[col], M[piv]] = [M[piv], M[col]];
        // Eliminate below.
        for (let r = col + 1; r < n; r++) {
            const f = M[r][col] / M[col][col];
            for (let c = col; c <= n; c++)
                M[r][c] -= f * M[col][c];
        }
    }
    // Back-substitute.
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let s = M[i][n];
        for (let j = i + 1; j < n; j++)
            s -= M[i][j] * x[j];
        x[i] = s / M[i][i];
    }
    return x;
}
