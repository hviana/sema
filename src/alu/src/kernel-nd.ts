// kernel-nd.ts — the n-dimensional (list-processing) layer.
//
// The scalar kernels compute on single quantities; this layer computes on the
// recursive `nd` container (see value.ts) — an ordered, ragged, heterogeneous
// list whose elements are themselves Values of any domain, nested arbitrarily.
//
// It stands on a tiny irreducible CORE of three STRUCTURAL primitives, exactly
// as logic stands on `nand` and the limit layer on `converge`:
//
//   • nd      — PACK its operands into a list value.           (construct)
//   • length  — the top-level element count, as an int.        (measure)
//   • at       — project the i-th element (negative = from end). (project)
//
// These three are the ONLY ops that read an nd's `items` directly.  Everything
// else is a derivation that composes them with the scalar kernels:
//
//   map(xs, f)        = nd( f(at xs 0), f(at xs 1), … )          over length xs
//   filter(xs, p)     = nd( the at xs i for which p(at xs i) )
//   reduce(xs, f[,z]) = f(… f(f(z, at xs 0), at xs 1) …)
//   find(xs, p)       = the first at xs i with p(at xs i), else the empty nd
//   …concat / reverse / flatten / zip / range / shape / rank likewise.
//
// THE FUNCTION ARGUMENT IS ANY EXISTING OPERATION.  A higher-order op does not
// take a bespoke callback enum; it takes an operation-denoting VALUE and resolves
// it through {@link OpContext.resolveOp} — the SAME machinery every operator goes
// through (a literal surface form, else its resonant meaning).  So `reduce(xs, +)`
// is a sum, `reduce(xs, *)` a product, `reduce(xs, max)` the maximum,
// `filter(xs, >0?)`… every scalar op the kernel already has becomes a fold /
// map / predicate.  That is why this layer adds almost no operations of its own:
// the scalar kernel IS the vocabulary, lifted over lists.  (And because reduce's
// `f(acc, elem)` re-enters `apply`, folding a list of LISTS broadcasts — a column
// sum is just `reduce(rows, +)`.)
//
// STRUCTURAL means broadcast-exempt: a reduce must see the whole list, not be
// lifted across the elements it folds (see operation.ts).  Every SCALAR op is
// non-structural and so broadcasts over an nd automatically — the two halves of
// "all operations support nd" meet exactly here.

import { asBit, asInt, int, isNd, nd, type Value } from "./value.js";
import type { OpContext, OperationRegistry } from "./operation.js";

/** The element list of an nd, or throw — so a structural op called on a non-list
 *  declines (the Alu facade maps the throw to "this rule does not fire"). */
function listOf(v: Value): Value[] {
  if (!isNd(v)) throw new Error("nd op: operand is not an n-dimensional value");
  return v.items;
}

/** Resolve an operation-value to a canonical name of the wanted arity, or throw
 *  (decline) when it names no known operation — the higher-order ops' shared
 *  front door, so an unrecognised function argument never silently no-ops. */
function resolveFn(ctx: OpContext, op: Value, arity: number): string {
  const name = ctx.resolveOp(op, arity);
  if (name === null) throw new Error("nd op: unrecognised operation argument");
  return name;
}

/** Register the n-dimensional layer into `r`.  All ops are STRUCTURAL. */
export function registerNd(r: OperationRegistry): void {
  // ── core primitives (the only ops that touch `items`) ────────────────────

  // nd: PACK operands into a list.  Variadic, so `nd(a, b, c)` = [a, b, c] and
  // `nd()` = the empty list.  An operand that is itself a list nests (a matrix
  // is `nd(row0, row1, …)`), so rank grows by composition, never a new type.
  r.prim(
    "nd",
    "variadic",
    ["nd", "list", "vector", "tuple", "array"],
    (args) => nd(args.slice()),
    { structural: true },
  );

  // length: the top-level element count, as an exact int.
  r.prim(
    "length",
    1,
    ["length", "size", "len"],
    (args) => int(BigInt(listOf(args[0]).length)),
    { structural: true },
  );

  // at: project the i-th element.  A negative index counts from the end
  // (−1 = last), Python-style; out of range throws (the rule declines).
  r.prim("at", 2, ["at", "nth", "elem", "index"], (args) => {
    const xs = listOf(args[0]);
    let i = Number(asInt(args[1]));
    if (i < 0) i += xs.length;
    if (i < 0 || i >= xs.length) throw new Error("at: index out of range");
    return xs[i];
  }, { structural: true });

  // ── derived: construction ────────────────────────────────────────────────

  // range(n) = [0, 1, …, n−1]; range(a, b) = [a, a+1, …, b−1].  The index
  // generator map/reduce iterate over when there is no input list yet.
  r.derive("range", "variadic", ["range", "iota", "upto"], (args) => {
    const lo = args.length >= 2 ? asInt(args[0]) : 0n;
    const hi = args.length >= 2 ? asInt(args[1]) : asInt(args[0]);
    const out: Value[] = [];
    for (let k = lo; k < hi; k++) out.push(int(k));
    return nd(out);
  }, { structural: true });

  // ── derived: the higher-order trio (op argument = any existing operation) ──

  // map(xs, f): apply the UNARY op f to each element.  Built on at/length/nd; f
  // is resolved by meaning, so `map(xs, negate)`, `map(xs, sqrt)`, `map(xs,
  // inverse)` all work, and (via broadcast) map over a list of lists is fine.
  r.derive("map", 2, ["map", "each"], (args, ctx) => {
    const xs = listOf(args[0]);
    const f = resolveFn(ctx, args[1], 1);
    return nd(xs.map((e) => ctx.apply(f, [e])));
  }, { structural: true });

  // filter(xs, p): keep the elements for which the UNARY predicate p is truthy
  // (its result read as a bit).  `filter(xs, isprime)`, `filter(xs, >0)`, … —
  // any op that returns a truth value is a predicate.
  r.derive("filter", 2, ["filter", "where", "keep"], (args, ctx) => {
    const xs = listOf(args[0]);
    const p = resolveFn(ctx, args[1], 1);
    return nd(xs.filter((e) => asBit(ctx.apply(p, [e])) === 1));
  }, { structural: true });

  // reduce(xs, f) / reduce(xs, f, z): left-fold the BINARY op f across the list,
  // optionally from a seed z.  `reduce(xs, +)` sums, `reduce(xs, *)` multiplies,
  // `reduce(xs, max)` is the maximum, `reduce(xs, or)` is "any", … — the scalar
  // kernel's whole binary vocabulary becomes a fold.  With no seed an empty list
  // declines (nothing to fold); with a seed it returns the seed.
  r.derive(
    "reduce",
    "variadic",
    ["reduce", "fold", "accumulate"],
    (args, ctx) => {
      if (args.length < 2) {
        throw new Error(
          "reduce: needs a list and an operation",
        );
      }
      const xs = listOf(args[0]);
      const f = resolveFn(ctx, args[1], 2);
      const hasSeed = args.length >= 3;
      let acc: Value;
      let start: number;
      if (hasSeed) {
        acc = args[2];
        start = 0;
      } else {
        if (xs.length === 0) throw new Error("reduce: empty list, no seed");
        acc = xs[0];
        start = 1;
      }
      for (let i = start; i < xs.length; i++) acc = ctx.apply(f, [acc, xs[i]]);
      return acc;
    },
    { structural: true },
  );

  // find(xs, p): the FIRST element satisfying the unary predicate p, or the
  // empty nd when none does (a graph-evidenced "nothing matched", never a guess).
  r.derive("find", 2, ["find", "first", "search"], (args, ctx) => {
    const xs = listOf(args[0]);
    const p = resolveFn(ctx, args[1], 1);
    for (const e of xs) if (asBit(ctx.apply(p, [e])) === 1) return e;
    return nd([]);
  }, { structural: true });

  // ── derived: shape-preserving plumbing ────────────────────────────────────

  // concat(a, b, …): join lists end to end into one list.
  r.derive("concat", "variadic", ["concat", "append", "join"], (args) => {
    const out: Value[] = [];
    for (const a of args) for (const e of listOf(a)) out.push(e);
    return nd(out);
  }, { structural: true });

  // reverse(xs): the list back to front.
  r.derive(
    "reverse",
    1,
    ["reverse", "flip"],
    (args) => nd(listOf(args[0]).slice().reverse()),
    { structural: true },
  );

  // flatten(xs): splice one level — each nd element is spliced in, each scalar
  // kept.  flatten ∘ flatten goes deeper; one level is the primitive step.
  r.derive("flatten", 1, ["flatten", "flat"], (args) => {
    const out: Value[] = [];
    for (const e of listOf(args[0])) {
      if (isNd(e)) { for (const sub of e.items) out.push(sub); }
      else out.push(e);
    }
    return nd(out);
  }, { structural: true });

  // zip(a, b, …): the lists braided into a list of tuples; length = the shortest
  // input (a ragged braid stops at the short one, never inventing elements).
  r.derive("zip", "variadic", ["zip", "braid"], (args) => {
    const lists = args.map(listOf);
    if (lists.length === 0) return nd([]);
    const m = Math.min(...lists.map((l) => l.length));
    const out: Value[] = [];
    for (let i = 0; i < m; i++) out.push(nd(lists.map((l) => l[i])));
    return nd(out);
  }, { structural: true });

  // rank(v): the nesting DEPTH — 0 for a scalar, 1 + the deepest element's rank
  // for a list (so a vector is 1, a matrix 2, ragged depth taken as the max).
  r.derive("rank", 1, ["rank", "depth", "ndim"], (args) => {
    const rank = (v: Value): bigint => {
      if (!isNd(v)) return 0n;
      let m = 0n;
      for (const e of v.items) {
        const rr = rank(e);
        if (rr > m) m = rr;
      }
      return m + 1n;
    };
    return int(rank(args[0]));
  }, { structural: true });

  // shape(v): the size along each axis, following the FIRST element down — the
  // regular-tensor shape (a ragged list is reported by its top length, the
  // recursion only descending the head).  Returns a list of ints.
  r.derive("shape", 1, ["shape", "dims"], (args) => {
    const dims: Value[] = [];
    let cur: Value = args[0];
    while (isNd(cur)) {
      dims.push(int(BigInt(cur.items.length)));
      if (cur.items.length === 0) break;
      cur = cur.items[0];
    }
    return nd(dims);
  }, { structural: true });
}
