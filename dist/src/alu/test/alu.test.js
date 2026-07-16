// Self-contained tests for the `alu` library: the ALU kernel — logic from nand,
// the exact bit-vector arithmetic bootstrap, the polymorphic real arithmetic,
// the numerical limit layer, and the synchronous operator/operand scanner.
// Uses node:test; no dependency on sema (a stub resonance stands in for the
// host's halo space, so the polymorphic inverse is exercised with zero coupling).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addBits,
  Alu,
  asReal,
  compareBits,
  converge,
  decimalCodec,
  diff,
  dot,
  freeVariables,
  int,
  integrate,
  interpolate,
  isNd,
  linsolve,
  matMul,
  mulBits,
  nd,
  negateBits,
  NO_RESONANCE,
  odeSolve,
  OperationRegistry,
  optimize,
  parseValue,
  polyEval,
  powerEig,
  prefetchRecognisedOps,
  real,
  registerArith,
  registerBits,
  registerLogic,
  registerNd,
  registerNumeric,
  regress,
  signBits,
  solve,
  symbol,
  tagOf,
  topSingular,
} from "../src/index.js";
// ── helpers ─────────────────────────────────────────────────────────────────
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
/** Build an ALU Value from a JS literal — a TEST fixture, NOT a parser: the
 *  kernel no longer reads list structure from bytes (that is the host's
 *  meaning-level job — see src/mind/mind.ts recogniseValue), so the kernel's own tests
 *  construct Values directly.  An array → nd, an integer → int, a fractional
 *  number → real, a string → an opaque symbol (its bytes verbatim). */
const V = (x) =>
  Array.isArray(x)
    ? nd(x.map(V))
    : typeof x === "number"
    ? (Number.isInteger(x) ? int(BigInt(x)) : real(x))
    : symbol(enc(x));
/** A logic-only registry + context — the substrate the bit bootstrap runs on. */
function logicCtx() {
  const r = new OperationRegistry();
  registerLogic(r);
  return r.context(NO_RESONANCE, { tol: 1e-10, maxIter: 1000 });
}
/** A full registry context (all kernels). */
function fullCtx(resonance = NO_RESONANCE) {
  const r = new OperationRegistry();
  registerLogic(r);
  registerBits(r);
  registerArith(r);
  registerNumeric(r);
  return { r, ctx: r.context(resonance, { tol: 1e-12, maxIter: 2000 }) };
}
const B = (v) => (v.domain === "bit" ? v.b : NaN);
const N = (v) => (v.domain === "int" ? v.n : NaN);
// ─────────────────────────────────────────────────────────────────────────────
// 1 — Logic: the completeness layer.  nand is the one axiom; every gate derives.
// ─────────────────────────────────────────────────────────────────────────────
test("nand truth table is the irreducible axiom", () => {
  const ctx = logicCtx();
  const t = (a, b) => B(ctx.apply("nand", [int(BigInt(a)), int(BigInt(b))]));
  assert.equal(t(0, 0), 1);
  assert.equal(t(0, 1), 1);
  assert.equal(t(1, 0), 1);
  assert.equal(t(1, 1), 0);
});
test("not/and/or derive from nand and match their truth tables", () => {
  const ctx = logicCtx();
  const bit01 = (n) => int(BigInt(n));
  assert.equal(B(ctx.apply("not", [bit01(0)])), 1);
  assert.equal(B(ctx.apply("not", [bit01(1)])), 0);
  for (
    const [a, b, and, or] of [
      [0, 0, 0, 0],
      [0, 1, 0, 1],
      [1, 0, 0, 1],
      [1, 1, 1, 1],
    ]
  ) {
    assert.equal(B(ctx.apply("and", [bit01(a), bit01(b)])), and);
    assert.equal(B(ctx.apply("or", [bit01(a), bit01(b)])), or);
  }
});
test("nor/xor/xnor/implies/iff all derive from nand", () => {
  const ctx = logicCtx();
  const bit01 = (n) => int(BigInt(n));
  const truth = (name) =>
    [0, 1].flatMap((a) =>
      [0, 1].map((b) => B(ctx.apply(name, [bit01(a), bit01(b)])))
    );
  assert.deepEqual(truth("nor"), [1, 0, 0, 0]);
  assert.deepEqual(truth("xor"), [0, 1, 1, 0]);
  assert.deepEqual(truth("xnor"), [1, 0, 0, 1]);
  assert.deepEqual(truth("implies"), [1, 1, 0, 1]);
  assert.deepEqual(truth("iff"), [1, 0, 0, 1]);
});
test("mux(s,a,b) selects a when s=0, b when s=1 — the bridge to control flow", () => {
  const ctx = logicCtx();
  const bit01 = (n) => int(BigInt(n));
  // s=0 → a
  assert.equal(B(ctx.apply("mux", [bit01(0), bit01(0), bit01(1)])), 0);
  assert.equal(B(ctx.apply("mux", [bit01(0), bit01(1), bit01(0)])), 1);
  // s=1 → b
  assert.equal(B(ctx.apply("mux", [bit01(1), bit01(0), bit01(1)])), 1);
  assert.equal(B(ctx.apply("mux", [bit01(1), bit01(1), bit01(0)])), 0);
});
// ─────────────────────────────────────────────────────────────────────────────
// 2 — Arithmetic: the bit-vector bootstrap is EXACT (the nand→everything proof).
// ─────────────────────────────────────────────────────────────────────────────
test("full_adder built from xor/and/or matches its truth table", () => {
  const { r, ctx } = fullCtx();
  assert.ok(r.get("bits.fullAdder"));
  // sum in bit 0, carry in bit 1.
  const fa = (a, b, c) =>
    N(ctx.apply("bits.fullAdder", [
      int(BigInt(a)),
      int(BigInt(b)),
      int(BigInt(c)),
    ]));
  assert.equal(fa(0, 0, 0), 0n); // sum 0 carry 0
  assert.equal(fa(1, 0, 0), 1n); // sum 1 carry 0
  assert.equal(fa(1, 1, 0), 2n); // sum 0 carry 1
  assert.equal(fa(1, 1, 1), 3n); // sum 1 carry 1
});
test("ripple add / two's-complement negate / shift-add multiply equal native bigint", () => {
  const ctx = logicCtx();
  const cases = [
    [0n, 0n],
    [5n, 7n],
    [12n, 30n],
    [-3n, 8n],
    [-15n, -9n],
    [123n, 456n],
    [1000n, -1n],
  ];
  for (const [a, b] of cases) {
    assert.equal(addBits(ctx, a, b), a + b, `add ${a}+${b}`);
    assert.equal(negateBits(ctx, a), -a, `negate ${a}`);
    assert.equal(mulBits(ctx, a, b), a * b, `mul ${a}*${b}`);
    assert.equal(
      signBits(ctx, a),
      a > 0n ? 1n : a < 0n ? -1n : 0n,
      `sign ${a}`,
    );
    assert.equal(
      compareBits(ctx, a, b),
      a > b ? 1n : a < b ? -1n : 0n,
      `compare ${a}?${b}`,
    );
  }
});
test("the bit bootstrap stays exact past 2^53", () => {
  const ctx = logicCtx();
  const a = 9007199254740993n; // 2^53 + 1, not representable as a double
  const b = 1000000007n;
  assert.equal(mulBits(ctx, a, b), a * b);
});
// ─────────────────────────────────────────────────────────────────────────────
// 3 — Arithmetic: polymorphic primitives + the derived field and order.
// ─────────────────────────────────────────────────────────────────────────────
test("add/multiply are exact on ints and lift to reals", () => {
  const { ctx } = fullCtx();
  assert.equal(N(ctx.apply("add", [int(2n), int(2n)])), 4n);
  assert.equal(N(ctx.apply("multiply", [int(6n), int(7n)])), 42n);
  // A real operand lifts the whole expression.
  const r = ctx.apply("add", [int(2n), real(0.5)]);
  assert.equal(r.domain, "real");
  close(asReal(r), 2.5);
});
test("subtract = add∘negate, divide = multiply∘reciprocal", () => {
  const { ctx } = fullCtx();
  assert.equal(N(ctx.apply("subtract", [int(10n), int(3n)])), 7n);
  close(asReal(ctx.apply("divide", [int(7n), int(2n)])), 3.5);
});
test("every comparison = sign∘subtract", () => {
  const { ctx } = fullCtx();
  const b = (name, x, y) => ctx.apply(name, [real(x), real(y)]);
  assert.equal(B(b("lt", 2, 3)), 1);
  assert.equal(B(b("lt", 3, 3)), 0);
  assert.equal(B(b("le", 3, 3)), 1);
  assert.equal(B(b("gt", 5, 3)), 1);
  assert.equal(B(b("ge", 2, 3)), 0);
  assert.equal(B(b("eq", 4, 4)), 1);
  assert.equal(B(b("ne", 4, 5)), 1);
});
test("abs/min/max/power/gcd derive correctly", () => {
  const { ctx } = fullCtx();
  assert.equal(N(ctx.apply("abs", [int(-9n)])), 9n);
  assert.equal(N(ctx.apply("min", [int(3n), int(8n)])), 3n);
  assert.equal(N(ctx.apply("max", [int(3n), int(8n)])), 8n);
  assert.equal(N(ctx.apply("power", [int(2n), int(10n)])), 1024n);
  close(asReal(ctx.apply("power", [real(2), int(-2n)])), 0.25);
  assert.equal(N(ctx.apply("gcd", [int(48n), int(36n)])), 12n);
});
test("real power via exp∘log agrees with Math.pow", () => {
  const { ctx } = fullCtx();
  close(asReal(ctx.apply("power", [real(2), real(0.5)])), Math.SQRT2, 1e-6);
});
// ─────────────────────────────────────────────────────────────────────────────
// 4 — Arithmetic: polynomial / vector / matrix / linsolve (structured arith).
// ─────────────────────────────────────────────────────────────────────────────
test("polyEval (Horner), dot, matMul", () => {
  // 1 + 2x + 3x^2 at x=2 → 1 + 4 + 12 = 17
  close(polyEval([1, 2, 3], 2), 17);
  close(dot([1, 2, 3], [4, 5, 6]), 32);
  assert.deepEqual(matMul([[1, 2], [3, 4]], [[5, 6], [7, 8]]), [
    [19, 22],
    [43, 50],
  ]);
});
test("linsolve solves a 3x3 system (Gaussian elimination)", () => {
  // x + y + z = 6 ; 2y + 5z = -4 ; 2x + 5y - z = 27  → (5, 3, -2)
  const x = linsolve([[1, 1, 1], [0, 2, 5], [2, 5, -1]], [6, -4, 27]);
  assert.ok(x);
  close(x[0], 5);
  close(x[1], 3);
  close(x[2], -2);
});
test("linsolve returns null for a singular matrix", () => {
  assert.equal(linsolve([[1, 2], [2, 4]], [3, 6]), null);
});
// ─────────────────────────────────────────────────────────────────────────────
// 5 — Numerical: the limit layer.  Each op is a converge instance.
// ─────────────────────────────────────────────────────────────────────────────
test("converge reaches a contraction's fixed point", () => {
  // x ← (x + 2/x)/2 converges to √2.
  const fp = converge((x) => (x + 2 / x) / 2, 1, 1e-12, 1000);
  close(fp, Math.SQRT2, 1e-9);
});
test("diff ≈ analytic derivative", () => {
  close(diff((x) => x * x, 3, 1e-10, 200), 6, 1e-4);
  close(diff(Math.sin, 0, 1e-10, 200), 1, 1e-4);
});
test("integrate ≈ closed form", () => {
  close(integrate((x) => x, 0, 1, 1e-10, 50), 0.5, 1e-6);
  close(integrate((x) => x * x, 0, 3, 1e-10, 50), 9, 1e-5);
});
test("solve (Newton) finds a root", () => {
  close(solve((x) => x * x - 2, 1, 1e-12, 200), Math.SQRT2, 1e-8);
});
test("exp/log/sin/cos/sqrt converge to the right limits", () => {
  const { ctx } = fullCtx();
  const f = (name, x) => asReal(ctx.apply(name, [real(x)]));
  close(f("exp", 0), 1, 1e-9);
  close(f("exp", 1), Math.E, 1e-7);
  close(f("log", Math.E), 1, 1e-7);
  close(f("sin", 0), 0, 1e-9);
  close(f("sin", Math.PI / 2), 1, 1e-7);
  close(f("cos", 0), 1, 1e-9);
  close(f("sqrt", 2), Math.SQRT2, 1e-8);
  close(f("sqrt", 144), 12, 1e-8);
});
test("optimize finds a minimum; odeSolve integrates y'=y", () => {
  close(optimize((x) => (x - 3) * (x - 3), 0, 1e-12, 500), 3, 1e-4);
  close(odeSolve((_t, y) => y, 0, 1, 1, 2000), Math.E, 1e-4);
});
test("regress recovers a known line; interpolate is linear", () => {
  // y = 2x + 1 sampled exactly → coeffs [1, 2].
  const xs = [0, 1, 2, 3];
  const ys = xs.map((x) => 2 * x + 1);
  const c = regress(xs, ys, 1);
  assert.ok(c);
  close(c[0], 1, 1e-6);
  close(c[1], 2, 1e-6);
  close(interpolate([0, 10], [0, 100], 5), 50);
});
test("powerEig / topSingular by power iteration", () => {
  // Diagonal(5, 2): dominant eigenvalue 5.
  const { value } = powerEig([[5, 0], [0, 2]], 1e-12, 1000);
  close(value, 5, 1e-6);
  // Largest singular value of diag(3,4) is 4.
  close(topSingular([[3, 0], [0, 4]], 1e-12, 1000), 4, 1e-6);
});
// ─────────────────────────────────────────────────────────────────────────────
// 6 — The Operation model: derived is indistinguishable; one-line extension.
// ─────────────────────────────────────────────────────────────────────────────
test("a derived op has the same record shape as a primitive", () => {
  const { r } = fullCtx();
  const nand = r.get("nand");
  const sub = r.get("subtract");
  assert.equal(nand.primitive, true);
  assert.equal(sub.primitive, false);
  // Same fields; a caller cannot tell them apart structurally.
  for (const k of ["name", "arity", "primitive", "forms", "fn"]) {
    assert.ok(k in nand && k in sub);
  }
});
test("a brand-new derived op is registered in one call and computes", () => {
  const { r, ctx } = fullCtx();
  r.derive("hypot", 2, ["hypot"], (args, c) =>
    c.apply("sqrt", [
      c.apply("add", [
        c.apply("multiply", [args[0], args[0]]),
        c.apply("multiply", [args[1], args[1]]),
      ]),
    ]));
  close(asReal(ctx.apply("hypot", [real(3), real(4)])), 5, 1e-7);
});
// ─────────────────────────────────────────────────────────────────────────────
// 7 — Values: parse, the codec round-trip, and the polymorphic inverse.
// ─────────────────────────────────────────────────────────────────────────────
test("parseValue: ints, reals, and symbols", () => {
  assert.deepEqual(parseValue(enc("42")), int(42n));
  assert.deepEqual(parseValue(enc("-7")), int(-7n));
  assert.deepEqual(parseValue(enc("3.5")), real(3.5));
  assert.deepEqual(parseValue(enc("1e3")), real(1000));
  // A token that merely begins with a digit stays a symbol.
  assert.equal(parseValue(enc("3dogs")).domain, "symbol");
  assert.equal(parseValue(enc("large")).domain, "symbol");
});
test("decimalCodec round-trips and formats reals deterministically", () => {
  const codec = decimalCodec(6);
  assert.equal(dec(codec.encode(int(42n))), "42");
  assert.equal(dec(codec.encode(real(0.5))), "0.5");
  assert.equal(dec(codec.encode(real(2))), "2"); // trailing zeros trimmed
  assert.equal(dec(codec.encode(real(-0))), "0"); // -0 normalised
  // round-trip
  const v = codec.decode(enc("8"));
  assert.deepEqual(v, int(8n));
});
test("inverse is polymorphic: number negates, symbol resonates to its opposite", () => {
  // Stub resonance: "large" ↔ "small", modality-agnostic over bytes.
  const opposites = new Map([["large", "small"]]);
  const stub = {
    opposite: (b) => {
      const o = opposites.get(dec(b));
      return o ? enc(o) : null;
    },
    recogniseOp: () => null,
  };
  const { ctx } = fullCtx(stub);
  // numeric inverse = negate
  assert.equal(N(ctx.apply("inverse", [int(3n)])), -3n);
  // symbol inverse = resonant opposite
  const r = ctx.apply("inverse", [symbol(enc("large"))]);
  assert.equal(r.domain, "symbol");
  assert.equal(dec(r.bytes), "small");
  // a symbol with no known opposite is left unchanged (never fabricated)
  const u = ctx.apply("inverse", [symbol(enc("zorp"))]);
  assert.equal(dec(u.bytes), "zorp");
});
// ─────────────────────────────────────────────────────────────────────────────
// 8 — The Alu facade: the synchronous scanner and applyBytes.
// ─────────────────────────────────────────────────────────────────────────────
test("scan finds numeric operands and symbolic operators in raw bytes", () => {
  const u = new Alu();
  const { operands, operators } = u.scan(enc("12+30"));
  assert.deepEqual(operands.map((o) => [o.i, o.j]), [[0, 2], [3, 5]]);
  assert.equal(operands[0].value.domain, "int");
  assert.equal(operators.length, 1);
  assert.equal(operators[0].name, "add");
  assert.deepEqual([operators[0].i, operators[0].j], [2, 3]);
});
test("scan keeps a multi-digit / decimal number whole, ignores a bare trailing dot", () => {
  const u = new Alu();
  const a = u.scan(enc("3.14"));
  assert.equal(a.operands.length, 1);
  assert.equal(a.operands[0].value.domain, "real");
  // a trailing "." is not part of the numeral
  const b = u.scan(enc("2+2."));
  assert.deepEqual(b.operands.map((o) => o.j - o.i), [1, 1]);
});
test("scan resolves the longest symbolic operator form", () => {
  const u = new Alu();
  const { operators } = u.scan(enc("3<=4"));
  assert.equal(operators.length, 1);
  assert.equal(operators[0].name, "le"); // "<=" beats "<"
});
test("applyBytes computes the canonical result bytes", () => {
  const u = new Alu();
  assert.equal(dec(u.applyBytes("add", [enc("2"), enc("2")])), "4");
  assert.equal(dec(u.applyBytes("multiply", [enc("6"), enc("7")])), "42");
  assert.equal(dec(u.applyBytes("subtract", [enc("10"), enc("3")])), "7");
  assert.equal(dec(u.applyBytes("divide", [enc("7"), enc("2")])), "3.5");
  // an unknown op or an unparseable operand → null (the rule simply won't fire)
  assert.equal(u.applyBytes("nope", [enc("1"), enc("2")]), null);
});
test("a computed result is itself an operand (composition for free)", () => {
  const u = new Alu();
  const first = u.applyBytes("add", [enc("2"), enc("3")]); // "5"
  const second = u.applyBytes("multiply", [first, enc("4")]); // "20"
  assert.equal(dec(second), "20");
});
// ─────────────────────────────────────────────────────────────────────────────
// 9 — Expressions: a numerical op acts on a FUNCTION, evaluated by a recursive
//     application of the same ALU (the "recursive call" case).
// ─────────────────────────────────────────────────────────────────────────────
test("evalExpression evaluates through the kernel, auto-detecting the variable", () => {
  const u = new Alu();
  // x^2 + 1 at x=3 → 10; variable auto-detected.
  close(u.evalExpression(enc("x^2 + 1"), "", 3), 10);
  // a different one-letter variable, any script, still auto-detected
  close(u.evalExpression(enc("t*t"), "", 4), 16);
  // a named function resolves against the kernel
  close(u.evalExpression(enc("sin(x)"), "x", Math.PI / 2), 1, 1e-6);
  // constants
  close(u.evalExpression(enc("2*pi"), "", 0), 2 * Math.PI);
  // a malformed expression declines
  assert.equal(u.evalExpression(enc("x +"), "x", 1), null);
});
test("freeVariables lists candidates, excluding function names", () => {
  const u = new Alu();
  const isFn = (n) => u.arityOf(n) === 1 && u.has(n);
  assert.deepEqual(freeVariables("sin(x) + x", isFn), ["x"]);
  assert.deepEqual(freeVariables("a*b + c", isFn).sort(), ["a", "b", "c"]);
});
test("diff: the derivative op acts on an expression operand", () => {
  const u = new Alu();
  // d/dx (x^2) at 3 = 6.  Operand 0 is the expression symbol, operand 1 the point.
  const r = u.apply("diff", [symbol(enc("x^2")), real(3)]);
  assert.ok(r);
  close(asReal(r), 6, 1e-4);
});
test("integrate: definite integral over an expression", () => {
  const u = new Alu();
  // ∫₀¹ x dx = 0.5 ; ∫₀³ x^2 dx = 9
  close(
    asReal(u.apply("integrate", [symbol(enc("x")), real(0), real(1)])),
    0.5,
    1e-5,
  );
  close(
    asReal(u.apply("integrate", [symbol(enc("x^2")), real(0), real(3)])),
    9,
    1e-4,
  );
});
test("solve: a root of an expression near a guess", () => {
  const u = new Alu();
  // root of x^2 - 2 near 1 → √2
  close(
    asReal(u.apply("solve", [symbol(enc("x^2 - 2")), real(1)])),
    Math.SQRT2,
    1e-6,
  );
});
test("limit: the value an expression approaches (a converge instance)", () => {
  const u = new Alu();
  // lim_{x→0} sin(x)/x = 1 — the removable singularity is skirted by sampling.
  close(asReal(u.apply("limit", [symbol(enc("sin(x)/x")), real(0)])), 1, 1e-4);
});
test("optimize: a minimiser of an expression", () => {
  const u = new Alu();
  // min of (x-3)^2 is at x=3
  close(
    asReal(u.apply("optimize", [symbol(enc("(x-3)^2")), real(0)])),
    3,
    1e-3,
  );
});
test("an expression op declines (null) when no evaluator can read the operand", () => {
  const u = new Alu();
  // a non-expression symbol → the evaluator fails → apply returns null
  assert.equal(u.apply("diff", [symbol(enc("@@@")), real(1)]), null);
});
// ─────────────────────────────────────────────────────────────────────────────
// 10 — The operation CONCEPT vocabulary (the generic, resonant recognition seed).
// ─────────────────────────────────────────────────────────────────────────────
test("conceptAnchors exposes the operation vocabulary for resonant recognition", () => {
  const u = new Alu();
  const dec = new TextDecoder();
  const byName = new Map();
  for (const { name, form } of u.conceptAnchors()) {
    const a = byName.get(name) ?? [];
    a.push(dec.decode(form));
    byName.set(name, a);
  }
  // The numerical ops a query would NOT spell with a symbol still have named
  // concepts a host can resonate against — generic over operations, not a fixed
  // symbol table.
  assert.ok(byName.get("integrate").includes("integral"));
  assert.ok(byName.get("diff").includes("derivative"));
  assert.ok(byName.get("limit").includes("limit"));
  assert.ok(byName.get("add").includes("plus"));
  // Forms the literal scanner already reads in full are NOT anchors: pure
  // operator symbols and numerals stay on the literal path.
  for (const forms of byName.values()) {
    assert.ok(!forms.includes("<="));
    assert.ok(!forms.includes("0"));
  }
});
test("prefetchRecognisedOps bridges async recognition to a sync map", async () => {
  // A stub host resonance: "the rate of change of" means a derivative.
  const stub = {
    recogniseOp: async (b) => dec(b).includes("rate of change") ? "diff" : null,
    opposite: async () => null,
  };
  const map = await prefetchRecognisedOps(stub, [
    enc("the rate of change of"),
    enc("nonsense"),
  ]);
  assert.equal(map.get("the rate of change of"), "diff");
  assert.equal(map.has("nonsense"), false);
});
// ─────────────────────────────────────────────────────────────────────────────
// 11 — N-dimensional values: the recursive container.  Representation + codec.
// ─────────────────────────────────────────────────────────────────────────────
/** A full registry with the nd kernel too — the substrate for the nd tests. */
function ndCtx(resonance = NO_RESONANCE) {
  const r = new OperationRegistry();
  registerLogic(r);
  registerBits(r);
  registerArith(r);
  registerNumeric(r);
  registerNd(r);
  return { r, ctx: r.context(resonance, { tol: 1e-12, maxIter: 2000 }) };
}
test("nd is the recursive container: nested, ragged, heterogeneous", () => {
  // A list of any element values — including other lists (nesting) of unequal
  // length (ragged) and mixed domains (heterogeneous).
  const v = nd([
    int(1n),
    real(3.5),
    symbol(enc("large")),
    nd([int(2n), int(3n)]), // a nested sub-list, shorter than the outer
  ]);
  assert.equal(tagOf(v), "nd");
  assert.ok(isNd(v));
  assert.equal(v.items.length, 4);
  assert.equal(tagOf(v.items[3]), "nd");
  // a scalar is NOT an nd, even a numeric one
  assert.equal(isNd(int(1n)), false);
});
test("decimalCodec encodes an nd to its canonical bracket spelling (nested, mixed)", () => {
  // The bracket literal is the kernel's canonical OUTPUT spelling of a list — one
  // deterministic form (the analogue of decimal for a number), so two derivations
  // of the same list agree byte-for-byte.  The kernel BUILDS the Value (the host
  // recognised its structure); the codec only spells it.
  const codec = decimalCodec(6);
  const out = (v) => dec(codec.encode(v));
  // flat
  assert.equal(out(V([1, 2, 3])), "[1,2,3]");
  // nested (a matrix) and ragged
  assert.equal(out(V([[1, 2], [3, 4, 5]])), "[[1,2],[3,4,5]]");
  // heterogeneous: int, real, symbol all spell their own form
  assert.equal(out(V([1, 3.5, "large"])), "[1,3.5,large]");
  // empty list
  assert.equal(out(V([])), "[]");
});
test("parseValue reads only SCALARS — a bracket literal decodes to an opaque symbol", () => {
  // The kernel no longer parses list STRUCTURE from bytes (that is the host's
  // meaning-level job — src/mind/mind.ts recogniseValue).  So decode is scalar-only: a
  // bracket literal is not a list to the kernel, it is an opaque symbol, exactly
  // like any other form that merely contains a bracket.
  assert.equal(parseValue(enc("[1,2,3]")).domain, "symbol");
  assert.equal(parseValue(enc("[1,2")).domain, "symbol");
  assert.equal(parseValue(enc("[1,,2]")).domain, "symbol");
  assert.equal(parseValue(enc("not a list")).domain, "symbol");
  // the scalar floor still grounds a numeral
  assert.deepEqual(parseValue(enc("42")), int(42n));
});
// ─────────────────────────────────────────────────────────────────────────────
// 12 — Broadcast: EVERY scalar op lifts over nd automatically (one mechanism).
// ─────────────────────────────────────────────────────────────────────────────
test("arithmetic broadcasts: list∘list zips, list∘scalar holds the scalar", () => {
  const { ctx } = ndCtx();
  const out = (r) => dec(decimalCodec(6).encode(r));
  // element-wise over two lists
  assert.equal(out(ctx.apply("add", [V([1, 2, 3]), V([4, 5, 6])])), "[5,7,9]");
  assert.equal(
    out(ctx.apply("multiply", [V([1, 2, 3]), V([10, 10, 10])])),
    "[10,20,30]",
  );
  // a scalar operand is held constant against the list
  assert.equal(out(ctx.apply("add", [V([1, 2, 3]), int(10n)])), "[11,12,13]");
  assert.equal(out(ctx.apply("subtract", [int(10n), V([1, 2, 3])])), "[9,8,7]");
});
test("broadcast RECURSES through nesting (a matrix op is the same code)", () => {
  const { ctx } = ndCtx();
  const out = (r) => dec(decimalCodec(6).encode(r));
  // nd-of-nd lifts twice with no extra machinery
  assert.equal(
    out(ctx.apply("add", [V([[1, 2], [3, 4]]), V([[10, 20], [30, 40]])])),
    "[[11,22],[33,44]]",
  );
  // scalar against a matrix reaches every leaf
  assert.equal(
    out(ctx.apply("multiply", [V([[1, 2], [3, 4]]), int(2n)])),
    "[[2,4],[6,8]]",
  );
});
test("broadcast spans op classes: logic, comparison, transcendental, inverse", () => {
  const opposites = new Map([["hot", "cold"], ["up", "down"]]);
  const stub = {
    opposite: (b) => opposites.has(dec(b)) ? enc(opposites.get(dec(b))) : null,
    recogniseOp: () => null,
  };
  const { ctx } = ndCtx(stub);
  const out = (r) => dec(decimalCodec(6).encode(r));
  // logic gate over a bit-list
  assert.equal(out(ctx.apply("not", [V([1, 0, 1])])), "[0,1,0]");
  // comparison → a list of truth bits
  assert.equal(out(ctx.apply("gt", [V([1, 5, 3]), int(2n)])), "[0,1,1]");
  // a transcendental over a list
  assert.equal(out(ctx.apply("sqrt", [V([1, 4, 9])])), "[1,2,3]");
  // the POLYMORPHIC INVERSE broadcasts: numbers negate, symbols resonate, in one
  // heterogeneous list — each element dispatched on its own domain.
  assert.equal(
    out(ctx.apply("inverse", [V(["hot", 3, "up"])])),
    "[cold,-3,down]",
  );
});
test("broadcast over lists of unequal length declines (no silent truncation)", () => {
  const { ctx } = ndCtx();
  assert.throws(() => ctx.apply("add", [V([1, 2, 3]), V([4, 5])]));
});
// ─────────────────────────────────────────────────────────────────────────────
// 13 — The nd core: nd / length / at are the only ops that touch `items`.
// ─────────────────────────────────────────────────────────────────────────────
test("core: nd packs, length counts, at projects (negative = from end)", () => {
  const { ctx } = ndCtx();
  const out = (r) => dec(decimalCodec(6).encode(r));
  // pack
  assert.equal(out(ctx.apply("nd", [int(1n), int(2n), int(3n)])), "[1,2,3]");
  assert.equal(out(ctx.apply("nd", [])), "[]");
  // length
  const xs = V([5, 6, 7, 8]);
  assert.equal(N(ctx.apply("length", [xs])), 4n);
  // at, forward and from the end
  assert.equal(N(ctx.apply("at", [xs, int(0n)])), 5n);
  assert.equal(N(ctx.apply("at", [xs, int(-1n)])), 8n);
  // out of range declines (throws → the facade maps it to "rule does not fire")
  assert.throws(() => ctx.apply("at", [xs, int(9n)]));
});
// ─────────────────────────────────────────────────────────────────────────────
// 14 — Higher-order ops: the FUNCTION ARGUMENT is ANY existing operation.
// ─────────────────────────────────────────────────────────────────────────────
test("reduce folds by ANY binary op — +, *, max are sum, product, maximum", () => {
  const { ctx } = ndCtx();
  const xs = V([3, 1, 4, 1, 5, 9, 2, 6]);
  // The op argument is a Value naming an operation; resolveOp turns it into the
  // canonical op, so reduce reuses the whole scalar vocabulary as folds.
  assert.equal(N(ctx.apply("reduce", [xs, symbol(enc("+"))])), 31n); // sum
  assert.equal(
    N(ctx.apply("reduce", [V([1, 2, 3, 4]), symbol(enc("*"))])),
    24n,
  );
  assert.equal(N(ctx.apply("reduce", [xs, symbol(enc("max"))])), 9n); // maximum
  assert.equal(N(ctx.apply("reduce", [xs, symbol(enc("min"))])), 1n); // minimum
  // a seed makes the fold total over an empty list
  assert.equal(N(ctx.apply("reduce", [V([]), symbol(enc("+")), int(0n)])), 0n);
});
test("reduce by a binary op BROADCASTS — a column sum falls out of nesting", () => {
  const { ctx } = ndCtx();
  const out = (r) => dec(decimalCodec(6).encode(r));
  // reduce(rows, +) folds the row-LISTS with "+", and "+" itself broadcasts over
  // them — so summing a list of rows yields the column sums, no matrix code.
  assert.equal(
    out(ctx.apply("reduce", [
      V([[1, 2, 3], [4, 5, 6]]),
      symbol(enc("+")),
    ])),
    "[5,7,9]",
  );
});
test("map applies a unary op to each element; works over nesting", () => {
  const { ctx } = ndCtx();
  const out = (r) => dec(decimalCodec(6).encode(r));
  assert.equal(
    out(ctx.apply("map", [V([1, 2, 3]), symbol(enc("negate"))])),
    "[-1,-2,-3]",
  );
  assert.equal(
    out(ctx.apply("map", [V([1, 4, 9]), symbol(enc("sqrt"))])),
    "[1,2,3]",
  );
});
test("filter keeps elements a unary predicate accepts; find returns the first", () => {
  const { ctx } = ndCtx();
  const out = (r) => dec(decimalCodec(6).encode(r));
  const xs = V([0, 5, 0, 3, 0, 8]);
  // "sign" is 0 for zero, 1 for positive → a truthiness predicate
  assert.equal(out(ctx.apply("filter", [xs, symbol(enc("sign"))])), "[5,3,8]");
  assert.equal(N(ctx.apply("find", [xs, symbol(enc("sign"))])), 5n);
  // find with no match returns the empty nd (graph-evidenced "nothing"), not a guess
  const none = ctx.apply("find", [
    V([0, 0, 0]),
    symbol(enc("sign")),
  ]);
  assert.ok(isNd(none) && none.items.length === 0);
});
test("structural plumbing: concat, reverse, flatten, zip, range, rank, shape", () => {
  const { ctx } = ndCtx();
  const out = (r) => dec(decimalCodec(6).encode(r));
  assert.equal(out(ctx.apply("concat", [V([1, 2]), V([3, 4])])), "[1,2,3,4]");
  assert.equal(out(ctx.apply("reverse", [V([1, 2, 3])])), "[3,2,1]");
  assert.equal(out(ctx.apply("flatten", [V([[1, 2], [3, 4]])])), "[1,2,3,4]");
  assert.equal(
    out(ctx.apply("zip", [
      V([1, 2, 3]),
      V([4, 5, 6]),
    ])),
    "[[1,4],[2,5],[3,6]]",
  );
  assert.equal(out(ctx.apply("range", [int(4n)])), "[0,1,2,3]");
  assert.equal(out(ctx.apply("range", [int(2n), int(5n)])), "[2,3,4]");
  // rank = nesting depth; shape = size down the first axis
  assert.equal(N(ctx.apply("rank", [V([[1, 2], [3, 4]])])), 2n);
  assert.equal(N(ctx.apply("rank", [int(7n)])), 0n);
  assert.equal(out(ctx.apply("shape", [V([[1, 2, 3], [4, 5, 6]])])), "[2,3]");
});
// ─────────────────────────────────────────────────────────────────────────────
// 15 — resolveOp: the function argument is resolved by the SAME machinery as any
//      operator — a surface form, then (when not literal) its resonant meaning.
// ─────────────────────────────────────────────────────────────────────────────
test("resolveOp: a literal surface form names its canonical op", () => {
  const { ctx } = ndCtx();
  // canonical name, a synonym spelling, and a glyph all name the same op
  assert.equal(ctx.resolveOp(symbol(enc("add"))), "add");
  assert.equal(ctx.resolveOp(symbol(enc("plus"))), "add");
  assert.equal(ctx.resolveOp(symbol(enc("+"))), "add");
  assert.equal(ctx.resolveOp(symbol(enc("max"))), "max");
  // nothing that names an op → null (the higher-order op then declines)
  assert.equal(ctx.resolveOp(symbol(enc("zzz"))), null);
});
test("resolveOp disambiguates a shared surface form by arity", () => {
  // Build a registry where one surface "@" is claimed by both a unary and a
  // binary op, to exercise the arity tie-break directly (the kernel happens to
  // share no surface across arities today, so this proves the mechanism).
  const r = new OperationRegistry();
  r.prim("u_at", 1, ["@"], (a) => a[0]);
  r.prim("b_at", 2, ["@"], (a) => a[0]);
  const ctx = r.context(NO_RESONANCE, { tol: 1e-10, maxIter: 100 });
  assert.equal(ctx.resolveOp(symbol(enc("@")), 1), "u_at");
  assert.equal(ctx.resolveOp(symbol(enc("@")), 2), "b_at");
  // no arity hint → the first claimant (registration order)
  assert.equal(ctx.resolveOp(symbol(enc("@"))), "u_at");
});
test("resolveOp falls through to RESONANCE when the bytes are not a literal form", () => {
  // The host's resonance maps a meaning ("grand total of") to an op; resolveOp
  // uses it exactly as the scan would for an operator a query does not spell.
  const stub = {
    opposite: () => null,
    recogniseOp: (b) => dec(b).includes("grand total") ? "add" : null,
  };
  const { ctx } = ndCtx(stub);
  assert.equal(ctx.resolveOp(symbol(enc("the grand total of"))), "add");
  // and a reduce driven by that meaning folds correctly
  assert.equal(
    N(ctx.apply("reduce", [
      V([10, 20, 30]),
      symbol(enc("the grand total of")),
    ])),
    60n,
  );
});
test("a higher-order op declines (throws) when its operation argument is unrecognised", () => {
  const { ctx } = ndCtx();
  // no surface form, no resonance → resolveFn throws → the Alu facade would map
  // this to "rule does not fire".
  assert.throws(() =>
    ctx.apply("reduce", [
      V([1, 2, 3]),
      symbol(enc("flibbertigibbet")),
    ])
  );
});
// ─────────────────────────────────────────────────────────────────────────────
// 16 — The Alu facade over nd: applyValues (Values in, canonical bytes out).
//      The kernel computes on Values the HOST built — it does NOT parse list
//      structure from bytes (src/mind/mind.ts recogniseValue does), so a list reaches the
//      facade as an already-assembled Value, never as a bracket byte string.
// ─────────────────────────────────────────────────────────────────────────────
test("applyValues computes nd results: broadcast, reduce, and a composed pipeline", () => {
  const u = new Alu();
  // broadcast — two list Values in, the canonical bracket spelling out
  assert.equal(
    dec(u.applyValues("add", [V([1, 2, 3]), V([4, 5, 6])])),
    "[5,7,9]",
  );
  // reduce with an operator surface form (the op argument is a symbol Value)
  assert.equal(
    dec(u.applyValues("reduce", [V([1, 2, 3, 4]), symbol(enc("+"))])),
    "10",
  );
  // a computed nd is itself a valid operand (composition for free): map then reduce
  const mapped = u.applyValues("map", [
    V([1, 2, 3, 4]),
    symbol(enc("negate")),
  ]);
  assert.equal(dec(mapped), "[-1,-2,-3,-4]");
  // an unknown op or a declining computation → null (the rule does not fire)
  assert.equal(
    u.applyValues("reduce", [V([1, 2]), symbol(enc("nonexistent-op"))]),
    null,
  );
});
test("applyBytes is SCALAR-only: it does not read list structure from bytes", () => {
  const u = new Alu();
  // applyBytes decodes operands through the codec, which is scalar-only — a
  // bracket literal becomes an opaque symbol, so arithmetic over it declines.
  // Reading list STRUCTURE from bytes is recogniseValue's job (§17), not the
  // codec's; applyBytes stays the pure scalar-operand path the search uses.
  assert.equal(u.applyBytes("add", [enc("[1,2,3]"), enc("[4,5,6]")]), null);
  // scalar arithmetic through the byte facade is unaffected
  assert.equal(dec(u.applyBytes("add", [enc("2"), enc("2")])), "4");
});
// ─────────────────────────────────────────────────────────────────────────────
// 17 — recogniseValue: the bytes→Value boundary.  A span is a scalar, or a LIST
//      (a run of element values joined by a CONSISTENT separator) — and no
//      separator spelling is privileged.  This is where structure is recognised,
//      layered over scan, so the kernel itself only ever computes on Values.
// ─────────────────────────────────────────────────────────────────────────────
test("recogniseValue reads a SCALAR — a numeral, or an opaque symbol", () => {
  const u = new Alu();
  assert.deepEqual(u.recogniseValue(enc("42")), int(42n));
  assert.deepEqual(u.recogniseValue(enc("3.5")), real(3.5));
  // a single word / learnt form / operator name stays an opaque symbol
  assert.equal(u.recogniseValue(enc("large")).domain, "symbol");
  assert.equal(u.recogniseValue(enc("+")).domain, "symbol");
  // surrounding whitespace is trimmed before the reading
  assert.deepEqual(u.recogniseValue(enc("  7  ")), int(7n));
});
test("recogniseValue reads a CONTAINER list, separator spelling not privileged", () => {
  const u = new Alu();
  const enc6 = decimalCodec(6);
  const to = (s) => dec(enc6.encode(u.recogniseValue(enc(s))));
  // comma, comma+space, or bare space inside the brackets — all the same list
  for (const s of ["[1,2,3]", "[1, 2, 3]", "[1 2 3]"]) {
    assert.equal(to(s), "[1,2,3]", s);
  }
  // nested (a matrix), ragged, and heterogeneous all recurse element-wise
  assert.equal(to("[[1,2],[3,4,5]]"), "[[1,2],[3,4,5]]");
  assert.equal(to("[1,3.5,large]"), "[1,3.5,large]");
  assert.equal(to("[]"), "[]"); // empty container → the empty list
  // a parsed container really is an nd with the right element domains
  const v = u.recogniseValue(enc("[1,3.5,large]"));
  assert.ok(isNd(v));
  assert.deepEqual(v.items.map(tagOf), ["int", "real", "symbol"]);
});
test("recogniseValue reads a bare SEQUENCE by ANY consistent connective", () => {
  const u = new Alu();
  const enc6 = decimalCodec(6);
  const to = (s) => dec(enc6.encode(u.recogniseValue(enc(s))));
  // space, comma, comma+space, or the word " and " between ≥2 numeric operands
  for (const s of ["1 2 3", "1,2,3", "1, 2, 3", "1 and 2 and 3"]) {
    assert.equal(to(s), "[1,2,3]", s);
  }
});
test("recogniseValue does NOT over-read: inconsistent or wordy spans stay scalar", () => {
  const u = new Alu();
  // a single numeral is a scalar, never a one-element list
  assert.equal(u.recogniseValue(enc("5")).domain, "int");
  // an INCONSISTENT separator ("space" then "comma") is not one sequence → symbol
  assert.equal(u.recogniseValue(enc("1 2,3")).domain, "symbol");
  // leftover material at an edge (a trailing word) is not a clean sequence
  assert.equal(u.recogniseValue(enc("1 2 buckle")).domain, "symbol");
  // a bare run of words (no numeric operands) stays an opaque symbol
  assert.equal(u.recogniseValue(enc("large tall")).domain, "symbol");
  // a stray unbalanced bracket is not a container → opaque symbol
  assert.equal(u.recogniseValue(enc("[1,2")).domain, "symbol");
});
