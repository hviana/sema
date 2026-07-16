import type { OpContext, OperationRegistry } from "./operation.js";
/** Exact addition through the ripple of full_adders. */
export declare function addBits(ctx: OpContext, a: bigint, b: bigint): bigint;
/** Exact two's-complement negation. */
export declare function negateBits(ctx: OpContext, a: bigint): bigint;
/** Exact shift-add multiplication: for each set bit i of b, add (a << i) to the
 *  accumulator.  The per-bit gate is an AND mask of the shifted a with bᵢ; the
 *  accumulation is rippleAdd — so multiply traces entirely to nand. */
export declare function mulBits(ctx: OpContext, a: bigint, b: bigint): bigint;
/** Sign of an integer as {-1, 0, 1}: zero when every bit is zero, −1 when the
 *  two's-complement sign bit is set, +1 otherwise — read off the bit array. */
export declare function signBits(ctx: OpContext, a: bigint): bigint;
/** Compare via sign(subtract): −1 if a<b, 0 if a=b, +1 if a>b, where subtract is
 *  add ∘ negate — so comparison is structured arithmetic, not a new primitive. */
export declare function compareBits(ctx: OpContext, a: bigint, b: bigint): bigint;
/** Register the bit-bootstrap ops (int domain) into `r`.  They have no surface
 *  forms — they are an internal exhibit, exercised by the tests and by anyone
 *  who wants to walk the nand→arithmetic chain, not matched from a query. */
export declare function registerBits(r: OperationRegistry): void;
