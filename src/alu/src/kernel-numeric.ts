// kernel-numeric.ts — the limit layer.
//
// A classical ALU stops at logic + arithmetic: exact, finite computation.  The
// ONE thing that makes this a numerical engine is a single new primitive —
// `converge(step, tol)`: iterate a refinement until successive results agree
// within ε.  Everything else here is a `converge` instance or a derivation over
// it plus the arithmetic already built:
//
//   diff       = converge a shrinking central difference (Richardson-style)
//   solve      = Newton: converge on x − f(x)/f′(x)   (f′ via diff)
//   integrate  = converge an adaptive partition (Simpson, refine until stable)
//   sqrt       = solve t² − x = 0
//   exp/log/sin/cos = converge their series / a Newton inverse
//   optimize   = solve(diff f = 0)
//   ode_solve  = step + (implicit) solve
//   regress    = linsolve on the normal equations
//   eig/svd    = power iteration = converge
//
// Direct methods (Gaussian elimination in kernel-arith.linsolve) are NOT new
// primitives — they are arithmetic plus the control flow layer 1 gave us.  Only
// convergence-to-tolerance is irreducible here.
//
// Scalar transcendentals are registered as ops (they have surface forms a query
// can name); the matrix routines (regress, eig, svd, interpolate) are exported
// pure functions, composed from the same primitives and tested directly, never
// auto-fired from an arbitrary query span.

import { asReal, real, type Value } from "./value.js";
import type { OpContext, OperationRegistry } from "./operation.js";
import { linsolve } from "./kernel-arith.js";

/** The convergence primitive: iterate `step` from `x0` until successive iterates
 *  agree within `tol` (absolute, or relative for large magnitudes), or until
 *  `maxIter` is reached.  Returns the last iterate — the refinement's fixed
 *  point.  This is the single irreducible operator of the numerical layer. */
export function converge(
  step: (x: number) => number,
  x0: number,
  tol: number,
  maxIter: number,
): number {
  let x = x0;
  for (let i = 0; i < maxIter; i++) {
    const next = step(x);
    const scale = Math.max(1, Math.abs(next), Math.abs(x));
    if (Math.abs(next - x) <= tol * scale) return next;
    x = next;
  }
  return x;
}

/** Numerical derivative f′(a) by a central difference refined as h → 0 — a
 *  `converge` instance over shrinking step sizes (Richardson-style halving). */
export function diff(
  f: (x: number) => number,
  a: number,
  tol: number,
  maxIter: number,
): number {
  let h = Math.max(1e-2, Math.abs(a) * 1e-2) || 1e-2;
  let prev = (f(a + h) - f(a - h)) / (2 * h);
  for (let i = 0; i < maxIter; i++) {
    h /= 2;
    const cur = (f(a + h) - f(a - h)) / (2 * h);
    const scale = Math.max(1, Math.abs(cur), Math.abs(prev));
    if (Math.abs(cur - prev) <= tol * scale) return cur;
    prev = cur;
    if (h < 1e-13) break; // floor: finer steps amplify round-off
  }
  return prev;
}

/** A root of f near x0, by Newton's method: converge x − f(x)/f′(x), with f′
 *  from {@link diff}.  Falls back to a secant step if the derivative vanishes. */
export function solve(
  f: (x: number) => number,
  x0: number,
  tol: number,
  maxIter: number,
): number {
  return converge(
    (x) => {
      const fx = f(x);
      let d = diff(f, x, tol, maxIter);
      if (Math.abs(d) < 1e-14) {
        // Derivative ~0: nudge with a secant over a small offset.
        const h = 1e-6 * (Math.abs(x) + 1);
        d = (f(x + h) - fx) / h;
        if (Math.abs(d) < 1e-14) return x;
      }
      return x - fx / d;
    },
    x0,
    tol,
    maxIter,
  );
}

/** Definite integral of f over [a, b], by composite Simpson refined until the
 *  estimate stops moving — a `converge` over partition count. */
export function integrate(
  f: (x: number) => number,
  a: number,
  b: number,
  tol: number,
  maxIter: number,
): number {
  const simpson = (n: number): number => {
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += (i % 2 === 0 ? 2 : 4) * f(a + i * h);
    return (s * h) / 3;
  };
  let n = 2;
  let prev = simpson(n);
  for (let i = 0; i < maxIter; i++) {
    n *= 2;
    const cur = simpson(n);
    const scale = Math.max(1, Math.abs(cur), Math.abs(prev));
    if (Math.abs(cur - prev) <= tol * scale) return cur;
    prev = cur;
  }
  return prev;
}

/** e^x by its Taylor series, summed until a term is below tolerance — a
 *  `converge` over partial sums.  (Range-reduction-free; adequate for the
 *  arguments a query produces, and exact in the limit.) */
export function expSeries(x: number, tol: number, maxIter: number): number {
  let term = 1;
  let sum = 1;
  for (let n = 1; n < maxIter; n++) {
    term *= x / n;
    sum += term;
    if (Math.abs(term) <= tol * Math.max(1, Math.abs(sum))) break;
  }
  return sum;
}

/** ln(x), x > 0, as the root of e^t − x = 0 (Newton via {@link solve}, with a
 *  good initial guess from the host log to keep iteration counts low). */
export function logNewton(x: number, tol: number, maxIter: number): number {
  if (x <= 0) return NaN;
  return solve(
    (t) => expSeries(t, tol, maxIter) - x,
    Math.log(x),
    tol,
    maxIter,
  );
}

/** sin / cos by their Taylor series (a `converge` over partial sums), with
 *  argument reduction into [−π, π] for accuracy. */
export function sinSeries(x: number, tol: number, maxIter: number): number {
  const TWO_PI = 2 * Math.PI;
  let a = x % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a < -Math.PI) a += TWO_PI;
  let term = a;
  let sum = a;
  for (let n = 1; n < maxIter; n++) {
    term *= (-a * a) / ((2 * n) * (2 * n + 1));
    sum += term;
    if (Math.abs(term) <= tol) break;
  }
  return sum;
}

export function cosSeries(x: number, tol: number, maxIter: number): number {
  const TWO_PI = 2 * Math.PI;
  let a = x % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a < -Math.PI) a += TWO_PI;
  let term = 1;
  let sum = 1;
  for (let n = 1; n < maxIter; n++) {
    term *= (-a * a) / ((2 * n - 1) * (2 * n));
    sum += term;
    if (Math.abs(term) <= tol) break;
  }
  return sum;
}

/** √x as the positive root of t² − x = 0 (Newton via {@link solve}). */
export function sqrtNewton(x: number, tol: number, maxIter: number): number {
  if (x < 0) return NaN;
  if (x === 0) return 0;
  return solve((t) => t * t - x, Math.max(x, 1), tol, maxIter);
}

/** A local minimum of f near x0: a root of f′ = 0 (optimize = solve(diff f)). */
export function optimize(
  f: (x: number) => number,
  x0: number,
  tol: number,
  maxIter: number,
): number {
  return solve((x) => diff(f, x, tol, maxIter), x0, tol, maxIter);
}

/** Integrate an ODE y′ = f(t, y) from (t0, y0) to t1 by classical RK4 stepping
 *  — explicit stepping is the layer's other use of refinement (here a fixed
 *  fine step; an implicit step would close with {@link solve}). */
export function odeSolve(
  f: (t: number, y: number) => number,
  t0: number,
  y0: number,
  t1: number,
  steps = 1000,
): number {
  const h = (t1 - t0) / steps;
  let t = t0;
  let y = y0;
  for (let i = 0; i < steps; i++) {
    const k1 = f(t, y);
    const k2 = f(t + h / 2, y + (h / 2) * k1);
    const k3 = f(t + h / 2, y + (h / 2) * k2);
    const k4 = f(t + h, y + h * k3);
    y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    t += h;
  }
  return y;
}

/** Least-squares polynomial regression of degree `deg` over (x, y) samples:
 *  build the normal equations and solve them with {@link linsolve} — regression
 *  reduces to structured arithmetic.  Returns coefficients constant-first. */
export function regress(
  xs: number[],
  ys: number[],
  deg: number,
): number[] | null {
  const m = deg + 1;
  // Vandermonde-style normal matrix AᵀA and vector Aᵀy.
  const ata: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const aty: number[] = new Array(m).fill(0);
  for (let s = 0; s < xs.length; s++) {
    const pows = new Array(2 * deg + 1);
    pows[0] = 1;
    for (let p = 1; p <= 2 * deg; p++) pows[p] = pows[p - 1] * xs[s];
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) ata[i][j] += pows[i + j];
      aty[i] += pows[i] * ys[s];
    }
  }
  return linsolve(ata, aty);
}

/** Linear interpolation of y at `xq` over sorted sample points (xs, ys). */
export function interpolate(xs: number[], ys: number[], xq: number): number {
  if (xq <= xs[0]) return ys[0];
  const n = xs.length;
  if (xq >= xs[n - 1]) return ys[n - 1];
  for (let i = 0; i < n - 1; i++) {
    if (xq >= xs[i] && xq <= xs[i + 1]) {
      const t = (xq - xs[i]) / (xs[i + 1] - xs[i]);
      return ys[i] + t * (ys[i + 1] - ys[i]);
    }
  }
  return ys[n - 1];
}

/** Dominant eigenpair of a (preferably symmetric) matrix by POWER ITERATION —
 *  the canonical "iteration = converge" of this layer.  Returns the eigenvalue
 *  (Rayleigh quotient) and its unit eigenvector. */
export function powerEig(
  A: number[][],
  tol: number,
  maxIter: number,
): { value: number; vector: number[] } {
  const n = A.length;
  // Start from a normalised all-ones vector: deterministic (no PRNG), and
  // generically NOT aligned with any single eigenvector of a diagonal/symmetric
  // matrix, so iteration is not trapped on a non-dominant axis (a unit basis
  // vector would be, e.g. e₀ is fixed under diag(9,16) and converges to the
  // wrong eigenvalue).
  let v: number[] = new Array(n).fill(1 / Math.sqrt(n));
  let lambda = 0;
  for (let it = 0; it < maxIter; it++) {
    // w = A v
    const w = A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
    const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
    const vn = w.map((x) => x / norm);
    // Rayleigh quotient vᵀAv.
    const Av = A.map((row) => row.reduce((s, a, j) => s + a * vn[j], 0));
    const lam = vn.reduce((s, x, i) => s + x * Av[i], 0);
    if (Math.abs(lam - lambda) <= tol * Math.max(1, Math.abs(lam))) {
      return { value: lam, vector: vn };
    }
    lambda = lam;
    v = vn;
  }
  return { value: lambda, vector: v };
}

/** Largest singular value of A: √(dominant eigenvalue of AᵀA) — power iteration
 *  again, the prototypical `converge`. */
export function topSingular(
  A: number[][],
  tol: number,
  maxIter: number,
): number {
  const n = A[0].length;
  // AᵀA (n×n).
  const ata: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let r = 0; r < A.length; r++) s += A[r][i] * A[r][j];
      ata[i][j] = s;
    }
  }
  const { value } = powerEig(ata, tol, maxIter);
  return Math.sqrt(Math.max(0, value));
}

/** Register the scalar transcendentals as ops (they have surface forms).  The
 *  matrix routines stay exported functions — there is no infix surface for a
 *  matrix, and auto-firing them from query spans is neither wanted nor safe. */
export function registerNumeric(r: OperationRegistry): void {
  const one = (
    name: string,
    forms: string[],
    f: (x: number, tol: number, maxIter: number) => number,
  ): void => {
    r.derive(
      name,
      1,
      forms,
      (args, ctx) => real(f(asReal(args[0]), ctx.rt.tol, ctx.rt.maxIter)),
    );
  };
  one("exp", ["exp", "e^"], expSeries);

  // ── named constants ───────────────────────────────────────────────────────
  // Nullary ops, so a constant is RESOLVED like any operation (registry forms),
  // never special-cased by a parser: the expression grammar reads "an arity-0
  // op" as "a constant" generically.
  r.derive("pi", 0, ["pi", "π"], () => real(Math.PI));
  r.derive("euler", 0, ["e"], () => real(Math.E));

  one("log", ["log", "ln"], logNewton);
  one("sin", ["sin"], sinSeries);
  one("cos", ["cos"], cosSeries);
  one("sqrt", ["sqrt", "√"], sqrtNewton);

  // ── operations over an EXPRESSION (the recursive-call case) ───────────────
  // A derivative, an integral, a limit, an optimisation — these act on a
  // FUNCTION, given as a symbol (the expression's bytes) plus point/bounds.  The
  // function is sampled by ctx.evalExpr, which evaluates the expression by a
  // RECURSIVE application of the same ALU (see expr.ts).  Their surface `forms`
  // are CONCEPT forms — words a query might literally carry ("derivative",
  // "integral", "limit") — but the GENERIC, modality-agnostic recognition is by
  // resonance over these same concepts (pipeline.ts's recogniseOp), so an operation
  // the bytes do not spell at all is still recognised by meaning.  These ops
  // decline (return their first operand unchanged is wrong; instead they throw,
  // which the Alu facade maps to "rule does not fire") when no evaluator is
  // wired or the expression is unparseable — synthesis stays evidence-based.
  const exprOf = (v: Value): Uint8Array => {
    if (v.domain === "symbol") return v.bytes;
    // A bare number is a constant expression — encode it back to bytes so the
    // evaluator sees a literal.
    throw new Error("expression operand expected");
  };
  const evalAt = (
    ctx: OpContext,
    expr: Uint8Array,
    vbl: string,
    at: number,
  ): number => {
    if (!ctx.evalExpr) throw new Error("no expression evaluator");
    const y = ctx.evalExpr(expr, vbl, at);
    if (y === null || !Number.isFinite(y)) throw new Error("expression failed");
    return y;
  };

  // diff: derivative of f at a point.  args = [expr, at].
  r.derive(
    "diff",
    2,
    ["derivative", "differentiate", "d/dx", "diff"],
    (args, ctx) => {
      const expr = exprOf(args[0]);
      const at = asReal(args[1]);
      return real(
        diff((x) => evalAt(ctx, expr, "", x), at, ctx.rt.tol, ctx.rt.maxIter),
      );
    },
    { expression: true },
  );

  // integrate: definite integral of f over [a, b].  args = [expr, a, b].
  r.derive("integrate", 3, ["integral", "integrate", "∫"], (args, ctx) => {
    const expr = exprOf(args[0]);
    const a = asReal(args[1]);
    const b = asReal(args[2]);
    return real(
      integrate(
        (x) => evalAt(ctx, expr, "", x),
        a,
        b,
        ctx.rt.tol,
        ctx.rt.maxIter,
      ),
    );
  }, { expression: true });

  // solve: a root of f near a guess.  args = [expr, guess].
  r.derive("solve", 2, ["solve", "root", "zero"], (args, ctx) => {
    const expr = exprOf(args[0]);
    const guess = asReal(args[1]);
    return real(
      solve((x) => evalAt(ctx, expr, "", x), guess, ctx.rt.tol, ctx.rt.maxIter),
    );
  }, { expression: true });

  // limit: the value f approaches as its variable → a, estimated by sampling
  // ever closer from both sides and converging (a limit IS a converge instance).
  r.derive("limit", 2, ["limit", "lim"], (args, ctx) => {
    const expr = exprOf(args[0]);
    const a = asReal(args[1]);
    const sample = (h: number): number => {
      // average of the two one-sided samples, skirting the point itself
      const left = evalAt(ctx, expr, "", a - h);
      const right = evalAt(ctx, expr, "", a + h);
      return (left + right) / 2;
    };
    let h = 0.1;
    let prev = sample(h);
    for (let i = 0; i < ctx.rt.maxIter; i++) {
      h /= 2;
      const cur = sample(h);
      const scale = Math.max(1, Math.abs(cur), Math.abs(prev));
      if (Math.abs(cur - prev) <= ctx.rt.tol * scale) return real(cur);
      prev = cur;
      if (h < 1e-13) break;
    }
    return real(prev);
  }, { expression: true });

  // optimize: a local minimiser of f near a guess (= solve(diff f)).  args =
  // [expr, guess].
  r.derive(
    "optimize",
    2,
    ["minimize", "minimise", "optimize", "argmin"],
    (args, ctx) => {
      const expr = exprOf(args[0]);
      const guess = asReal(args[1]);
      return real(
        optimize(
          (x) => evalAt(ctx, expr, "", x),
          guess,
          ctx.rt.tol,
          ctx.rt.maxIter,
        ),
      );
    },
    { expression: true },
  );

  // converge and the matrix routines (regress, eig, svd, interpolate) take
  // FUNCTION or ARRAY operands with no flat infix surface; they are offered
  // through the pure exports above and used internally (e.g. sqrt = solve(t²−x),
  // optimize = solve(diff f)).
}
