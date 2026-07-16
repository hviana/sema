import type { OperationRegistry } from "./operation.js";
/** The convergence primitive: iterate `step` from `x0` until successive iterates
 *  agree within `tol` (absolute, or relative for large magnitudes), or until
 *  `maxIter` is reached.  Returns the last iterate — the refinement's fixed
 *  point.  This is the single irreducible operator of the numerical layer. */
export declare function converge(step: (x: number) => number, x0: number, tol: number, maxIter: number): number;
/** Numerical derivative f′(a) by a central difference refined as h → 0 — a
 *  `converge` instance over shrinking step sizes (Richardson-style halving). */
export declare function diff(f: (x: number) => number, a: number, tol: number, maxIter: number): number;
/** A root of f near x0, by Newton's method: converge x − f(x)/f′(x), with f′
 *  from {@link diff}.  Falls back to a secant step if the derivative vanishes. */
export declare function solve(f: (x: number) => number, x0: number, tol: number, maxIter: number): number;
/** Definite integral of f over [a, b], by composite Simpson refined until the
 *  estimate stops moving — a `converge` over partition count. */
export declare function integrate(f: (x: number) => number, a: number, b: number, tol: number, maxIter: number): number;
/** e^x by its Taylor series, summed until a term is below tolerance — a
 *  `converge` over partial sums.  (Range-reduction-free; adequate for the
 *  arguments a query produces, and exact in the limit.) */
export declare function expSeries(x: number, tol: number, maxIter: number): number;
/** ln(x), x > 0, as the root of e^t − x = 0 (Newton via {@link solve}, with a
 *  good initial guess from the host log to keep iteration counts low). */
export declare function logNewton(x: number, tol: number, maxIter: number): number;
/** sin / cos by their Taylor series (a `converge` over partial sums), with
 *  argument reduction into [−π, π] for accuracy. */
export declare function sinSeries(x: number, tol: number, maxIter: number): number;
export declare function cosSeries(x: number, tol: number, maxIter: number): number;
/** √x as the positive root of t² − x = 0 (Newton via {@link solve}). */
export declare function sqrtNewton(x: number, tol: number, maxIter: number): number;
/** A local minimum of f near x0: a root of f′ = 0 (optimize = solve(diff f)). */
export declare function optimize(f: (x: number) => number, x0: number, tol: number, maxIter: number): number;
/** Integrate an ODE y′ = f(t, y) from (t0, y0) to t1 by classical RK4 stepping
 *  — explicit stepping is the layer's other use of refinement (here a fixed
 *  fine step; an implicit step would close with {@link solve}). */
export declare function odeSolve(f: (t: number, y: number) => number, t0: number, y0: number, t1: number, steps?: number): number;
/** Least-squares polynomial regression of degree `deg` over (x, y) samples:
 *  build the normal equations and solve them with {@link linsolve} — regression
 *  reduces to structured arithmetic.  Returns coefficients constant-first. */
export declare function regress(xs: number[], ys: number[], deg: number): number[] | null;
/** Linear interpolation of y at `xq` over sorted sample points (xs, ys). */
export declare function interpolate(xs: number[], ys: number[], xq: number): number;
/** Dominant eigenpair of a (preferably symmetric) matrix by POWER ITERATION —
 *  the canonical "iteration = converge" of this layer.  Returns the eigenvalue
 *  (Rayleigh quotient) and its unit eigenvector. */
export declare function powerEig(A: number[][], tol: number, maxIter: number): {
    value: number;
    vector: number[];
};
/** Largest singular value of A: √(dominant eigenvalue of AᵀA) — power iteration
 *  again, the prototypical `converge`. */
export declare function topSingular(A: number[][], tol: number, maxIter: number): number;
/** Register the scalar transcendentals as ops (they have surface forms).  The
 *  matrix routines stay exported functions — there is no infix surface for a
 *  matrix, and auto-firing them from query spans is neither wanted nor safe. */
export declare function registerNumeric(r: OperationRegistry): void;
