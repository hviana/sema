// kernel-logic.ts — the completeness layer.
//
// One primitive: nand.  It is functionally complete on its own, so EVERY other
// gate is a derivation over it, registered with `derive` and composing only
// through ctx.apply — the dependency edges are the literal source.  This is the
// irreducible root of the whole library: arithmetic's bit bootstrap
// (kernel-bits.ts) builds full_adder from the xor/and/or exposed here, and from
// there add → multiply → everything.
//
//   not(a)        = nand(a, a)
//   and(a, b)     = not(nand(a, b))
//   or(a, b)      = nand(not a, not b)            (De Morgan)
//   nor(a, b)     = not(or(a, b))
//   xor(a, b)     = or(and(a, not b), and(not a, b))
//   xnor(a, b)    = not(xor(a, b))
//   implies(a, b) = or(not a, b)
//   iff(a, b)     = xnor(a, b)
//   mux(s, a, b)  = or(and(not s, a), and(s, b))  — select b when s, else a;
//                   the bridge to control flow (conditional selection).
//
// `not`, `and`, `or` are exposed for ergonomics but are themselves derived —
// only nand is primitive.

import { asBit, bit } from "./value.js";
import type { OperationRegistry } from "./operation.js";

/** Register the logic layer into `r`.  Idempotent in effect (re-registering
 *  overwrites with the same definitions). */
export function registerLogic(r: OperationRegistry): void {
  // The one irreducible gate.  ¬(a ∧ b).
  r.prim("nand", 2, [], (args) => {
    const a = asBit(args[0]);
    const b = asBit(args[1]);
    return bit(a & b ? 0 : 1);
  });

  // Exposed-but-derived basic gates.
  r.derive(
    "not",
    1,
    ["not", "!", "~", "¬"],
    (args, ctx) => ctx.apply("nand", [args[0], args[0]]),
  );

  r.derive(
    "and",
    2,
    ["and", "&", "&&", "∧"],
    (args, ctx) => ctx.apply("not", [ctx.apply("nand", [args[0], args[1]])]),
  );

  r.derive("or", 2, ["or", "|", "||", "∨"], (args, ctx) => {
    const na = ctx.apply("not", [args[0]]);
    const nb = ctx.apply("not", [args[1]]);
    return ctx.apply("nand", [na, nb]);
  });

  // Fully derived gates.
  r.derive(
    "nor",
    2,
    ["nor", "⊽"],
    (args, ctx) => ctx.apply("not", [ctx.apply("or", [args[0], args[1]])]),
  );

  r.derive("xor", 2, ["xor", "^", "⊕"], (args, ctx) => {
    const a = args[0], b = args[1];
    const left = ctx.apply("and", [a, ctx.apply("not", [b])]);
    const right = ctx.apply("and", [ctx.apply("not", [a]), b]);
    return ctx.apply("or", [left, right]);
  });

  r.derive(
    "xnor",
    2,
    ["xnor", "⊙"],
    (args, ctx) => ctx.apply("not", [ctx.apply("xor", [args[0], args[1]])]),
  );

  r.derive(
    "implies",
    2,
    ["implies", "=>", "→", "⇒"],
    (args, ctx) => ctx.apply("or", [ctx.apply("not", [args[0]]), args[1]]),
  );

  r.derive(
    "iff",
    2,
    ["iff", "<=>", "↔", "⇔"],
    (args, ctx) => ctx.apply("xnor", [args[0], args[1]]),
  );

  // mux(s, a, b): select a when s = 0, b when s = 1.  The bridge to control
  // flow — conditional selection, and (with recursion in the caller) looping.
  r.derive("mux", 3, ["mux", "select", "?:"], (args, ctx) => {
    const s = args[0], a = args[1], b = args[2];
    const lo = ctx.apply("and", [ctx.apply("not", [s]), a]);
    const hi = ctx.apply("and", [s, b]);
    return ctx.apply("or", [lo, hi]);
  });
}
