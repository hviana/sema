import type { OperationRegistry } from "./operation.js";
/** Register the arithmetic layer into `r`. */
export declare function registerArith(r: OperationRegistry): void;
/** Horner evaluation of a polynomial whose coefficients run constant-first
 *  (`coeffs[0]` is the constant term).  Pure arithmetic over add/multiply. */
export declare function polyEval(coeffs: number[], x: number): number;
/** Dot product of two equal-length vectors — a fold of add over multiply. */
export declare function dot(a: number[], b: number[]): number;
/** Matrix · vector. */
export declare function matVec(m: number[][], v: number[]): number[];
/** Matrix · matrix. */
export declare function matMul(a: number[][], b: number[][]): number[][];
/** Solve A·x = b by Gaussian elimination with partial pivoting — structured
 *  arithmetic (add / multiply / divide / compare for the pivot), not a new
 *  primitive.  Returns x, or null if A is singular to tolerance `tol`. */
export declare function linsolve(
  A: number[][],
  b: number[],
  tol?: number,
): number[] | null;
