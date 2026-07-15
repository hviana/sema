// kernel-bits.ts — the "everything derives from nand" bootstrap, made exact.
//
// This is the EXHIBIT that proves the kernel's central claim: arithmetic is not
// a new primitive, it is a derivation over the logic layer.  Here `full_adder`
// is built from the xor/and/or exposed in kernel-logic.ts (themselves derived
// from nand alone), and from one full_adder the whole integer field follows:
//
//   full_adder → ripple add → two's-complement negate → shift-add multiply
//             → sign → compare → (and, with control flow, everything else).
//
// It operates on EXACT integers (bigint) so the proof holds past 2^53 where a
// double would round.  Every gate call goes through ctx.apply, so the dependency
// edges back to nand are literal, runnable source — the tests cross-check each
// op against native bigint, and the integration arithmetic (kernel-arith.ts)
// uses native bigint on the hot path, having been proven equal to this here.
//
// These ops are registered under a "bits." namespace, distinct from the
// polymorphic arithmetic of kernel-arith.ts, precisely so the bootstrap is an
// inspectable, separately-tested artifact and never silently the substrate of a
// real-number computation.

import { asInt, bit, int } from "./value.js";
import type { OpContext, OperationRegistry } from "./operation.js";

/** Width-bounded two's-complement little-endian bit array (index 0 = LSB).
 *  Width is chosen by the caller wide enough that the signed result cannot
 *  overflow, so interpreting the top bit as the sign is always correct. */
function toBits(n: bigint, width: number): (0 | 1)[] {
  const mod = 1n << BigInt(width);
  let u = ((n % mod) + mod) % mod; // two's-complement representation
  const bits: (0 | 1)[] = new Array(width);
  for (let i = 0; i < width; i++) {
    bits[i] = Number(u & 1n) as 0 | 1;
    u >>= 1n;
  }
  return bits;
}

/** Interpret a two's-complement little-endian bit array as a signed bigint. */
function fromBits(bits: (0 | 1)[]): bigint {
  const width = bits.length;
  let u = 0n;
  for (let i = 0; i < width; i++) if (bits[i]) u |= 1n << BigInt(i);
  const signBitSet = bits[width - 1] === 1;
  return signBitSet ? u - (1n << BigInt(width)) : u;
}

/** Bits needed to hold |n| (at least 1). */
function magnitudeBits(n: bigint): number {
  const a = n < 0n ? -n : n;
  return a === 0n ? 1 : a.toString(2).length;
}

/** A single full adder built from the logic gates: sum = a⊕b⊕cin, carry =
 *  (a∧b) ∨ (cin ∧ (a⊕b)).  Every gate goes through ctx.apply → nand. */
function fullAdder(
  ctx: OpContext,
  a: 0 | 1,
  b: 0 | 1,
  cin: 0 | 1,
): { sum: 0 | 1; cout: 0 | 1 } {
  const A = bit(a), B = bit(b), C = bit(cin);
  const axb = ctx.apply("xor", [A, B]);
  const sum = ctx.apply("xor", [axb, C]);
  const cout = ctx.apply("or", [
    ctx.apply("and", [A, B]),
    ctx.apply("and", [C, axb]),
  ]);
  return {
    sum: sum.domain === "bit" ? sum.b : 0,
    cout: cout.domain === "bit" ? cout.b : 0,
  };
}

/** Ripple-carry add of two two's-complement bit arrays (equal width). */
function rippleAdd(ctx: OpContext, x: (0 | 1)[], y: (0 | 1)[]): (0 | 1)[] {
  const width = x.length;
  const out: (0 | 1)[] = new Array(width);
  let carry: 0 | 1 = 0;
  for (let i = 0; i < width; i++) {
    const { sum, cout } = fullAdder(ctx, x[i], y[i], carry);
    out[i] = sum;
    carry = cout;
  }
  return out;
}

/** Bitwise NOT of a bit array, via the not gate. */
function notBits(ctx: OpContext, x: (0 | 1)[]): (0 | 1)[] {
  return x.map((b) => {
    const r = ctx.apply("not", [bit(b)]);
    return (r.domain === "bit" ? r.b : 0) as 0 | 1;
  });
}

/** Two's-complement negate: invert every bit, then add one. */
function negateBitsArr(ctx: OpContext, x: (0 | 1)[]): (0 | 1)[] {
  const width = x.length;
  const one = toBits(1n, width);
  return rippleAdd(ctx, notBits(ctx, x), one);
}

// ── public pure functions (used by the tests and the explicit ops) ──────────

/** Exact addition through the ripple of full_adders. */
export function addBits(ctx: OpContext, a: bigint, b: bigint): bigint {
  const width = Math.max(magnitudeBits(a), magnitudeBits(b)) + 2;
  return fromBits(rippleAdd(ctx, toBits(a, width), toBits(b, width)));
}

/** Exact two's-complement negation. */
export function negateBits(ctx: OpContext, a: bigint): bigint {
  const width = magnitudeBits(a) + 2;
  return fromBits(negateBitsArr(ctx, toBits(a, width)));
}

/** Exact shift-add multiplication: for each set bit i of b, add (a << i) to the
 *  accumulator.  The per-bit gate is an AND mask of the shifted a with bᵢ; the
 *  accumulation is rippleAdd — so multiply traces entirely to nand. */
export function mulBits(ctx: OpContext, a: bigint, b: bigint): bigint {
  const width = magnitudeBits(a) + magnitudeBits(b) + 2;
  const aBits = toBits(a, width);
  const bBits = toBits(b, width);
  let acc: (0 | 1)[] = toBits(0n, width);
  for (let i = 0; i < width; i++) {
    if (bBits[i] === 0) continue;
    // a shifted left by i (within width), masked by bᵢ (= 1 here).
    const shifted: (0 | 1)[] = new Array(width);
    for (let k = 0; k < width; k++) {
      const src = k - i >= 0 ? aBits[k - i] : 0;
      const m = ctx.apply("and", [bit(src as 0 | 1), bit(bBits[i])]);
      shifted[k] = (m.domain === "bit" ? m.b : 0) as 0 | 1;
    }
    acc = rippleAdd(ctx, acc, shifted);
  }
  return fromBits(acc);
}

/** Sign of an integer as {-1, 0, 1}: zero when every bit is zero, −1 when the
 *  two's-complement sign bit is set, +1 otherwise — read off the bit array. */
export function signBits(ctx: OpContext, a: bigint): bigint {
  if (a === 0n) return 0n;
  const width = magnitudeBits(a) + 2;
  const bits = toBits(a, width);
  return bits[width - 1] === 1 ? -1n : 1n;
}

/** Compare via sign(subtract): −1 if a<b, 0 if a=b, +1 if a>b, where subtract is
 *  add ∘ negate — so comparison is structured arithmetic, not a new primitive. */
export function compareBits(ctx: OpContext, a: bigint, b: bigint): bigint {
  return signBits(ctx, addBits(ctx, a, negateBits(ctx, b)));
}

/** Register the bit-bootstrap ops (int domain) into `r`.  They have no surface
 *  forms — they are an internal exhibit, exercised by the tests and by anyone
 *  who wants to walk the nand→arithmetic chain, not matched from a query. */
export function registerBits(r: OperationRegistry): void {
  // full_adder exposed as a 3-bit op returning the 2-bit {sum, carry} as an int
  // 0..3 (carry in bit 1, sum in bit 0) so it is callable/testable on its own.
  r.derive("bits.fullAdder", 3, [], (args, ctx) => {
    const s = fullAdder(
      ctx,
      asInt(args[0]) === 0n ? 0 : 1,
      asInt(args[1]) === 0n ? 0 : 1,
      asInt(args[2]) === 0n ? 0 : 1,
    );
    return int(BigInt(s.sum) | (BigInt(s.cout) << 1n));
  });
  r.derive(
    "bits.add",
    2,
    [],
    (args, ctx) => int(addBits(ctx, asInt(args[0]), asInt(args[1]))),
  );
  r.derive(
    "bits.negate",
    1,
    [],
    (args, ctx) => int(negateBits(ctx, asInt(args[0]))),
  );
  r.derive(
    "bits.multiply",
    2,
    [],
    (args, ctx) => int(mulBits(ctx, asInt(args[0]), asInt(args[1]))),
  );
  r.derive(
    "bits.sign",
    1,
    [],
    (args, ctx) => int(signBits(ctx, asInt(args[0]))),
  );
  r.derive(
    "bits.compare",
    2,
    [],
    (args, ctx) => int(compareBits(ctx, asInt(args[0]), asInt(args[1]))),
  );
}
