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

import { isNd, nd, type Value } from "./value.js";

/** Arity: a fixed operand count, or "variadic" for a fold (and/or of many,
 *  dot, min/max, polynomial evaluation). */
export type Arity = number | "variadic";

/** Synchronous resonance an op callback may consult, pre-resolved by the host.
 *  This is the only path by which a computation reads MEANING from a symbol's
 *  opaque bytes; numbers never touch it. */
export interface ResonanceSync {
  /** The resonant opposite of a symbol's bytes — its antonym / inverse in the
   *  resonance space, of whatever modality — or null if none is known.  Found
   *  by the host's halo resonance and handed in pre-resolved (see
   *  resonance.ts). */
  opposite(bytes: Uint8Array): Uint8Array | null;
  /** The canonical operation a symbol's bytes MEAN, found by resonance over the
   *  operation concepts — the GENERIC, modality-agnostic recognition path, the
   *  same one the host uses to recognise an operator a query does not literally
   *  spell.  Pre-resolved by the host; null when nothing resonates.  This is how
   *  the FUNCTION ARGUMENT of a higher-order nd op (the "+" of a reduce, the
   *  predicate of a filter) is resolved when it is not a literal surface form —
   *  see {@link OpContext.resolveOp}. */
  recogniseOp(bytes: Uint8Array): string | null;
}

/** Runtime knobs the numerical kernel reads (the limit layer's tolerance and
 *  iteration ceiling).  Carried on the context so a derived op never closes
 *  over global state. */
export interface OpRuntime {
  /** Convergence tolerance ε: a refinement stops when successive results agree
   *  within this. */
  tol: number;
  /** Hard iteration ceiling, so a non-converging step still terminates. */
  maxIter: number;
}

/** Evaluate a symbolic EXPRESSION at a binding of its free variable, returning a
 *  plain number, or null when the expression cannot be evaluated (unparseable,
 *  or no evaluator wired in).  This is the bridge that lets a NUMERICAL op act
 *  on a function: an integral, a derivative, a limit (or any refinement) needs
 *  to sample its integrand/argument at many points, and the integrand is itself
 *  a sub-expression with a free variable — evaluating it is a RECURSIVE
 *  application of the same ALU.  Injected by the host (the {@link
 *  "./alu.js".Alu} facade); absent in a bare registry, where expression-ops
 *  simply decline. */
export type EvalExpr = (
  bytes: Uint8Array,
  variable: string,
  at: number,
) => number | null;

/** The context a callback runs in: the means to call sibling ops by name, the
 *  runtime knobs, pre-resolved resonance, and (when wired) an expression
 *  evaluator.  This is what makes derivations compose without import cycles
 *  between kernel files. */
export interface OpContext {
  /** Apply another registered op by canonical name. */
  apply(name: string, args: Value[]): Value;
  /** Whether an op is registered (lets a derivation pick a fast path when an
   *  optional sibling exists). */
  has(name: string): boolean;
  /** Resolve an operation-denoting VALUE to a canonical op name — the
   *  intelligent callback resolution the higher-order nd ops (map/reduce/filter/
   *  find) use for their FUNCTION ARGUMENT.  An operation is named the SAME way
   *  any operation is recognised anywhere in the kernel, reusing the existing
   *  machinery rather than a bespoke table:
   *
   *   1. a literal SURFACE FORM — the op-value's bytes are a registered spelling
   *      ("+", "plus", "add", "*", "max", …) → the registry's own form index;
   *   2. else its MEANING — {@link ResonanceSync.recogniseOp} over the same
   *      operation concepts, so a synonym or a multimodal gesture the bytes do
   *      not literally spell still resolves (pre-resolved by the host);
   *   3. else a bare canonical NAME already (a symbol whose bytes equal an op
   *      name), or an int/bit treated as its decimal name — last resort.
   *
   *  `arity` (when given) disambiguates a surface a unary and a binary op share
   *  (e.g. "-" is both negate and subtract): the claimant of that arity wins.
   *  Returns null when nothing resolves, so a higher-order op declines. */
  resolveOp(op: Value, arity?: number): string | null;
  /** The numerical runtime knobs. */
  rt: OpRuntime;
  /** Pre-resolved resonance for the polymorphic inverse and op recognition. */
  resonance: ResonanceSync;
  /** Evaluate a symbolic expression at a variable binding (see {@link
   *  EvalExpr}); undefined in a bare registry with no host evaluator. */
  evalExpr?: EvalExpr;
}

/** The callback that executes an operation on resolved operands. */
export type OpFn = (args: Value[], ctx: OpContext) => Value;

/** How tightly an INFIX operation binds, and to which side — declared at
 *  registration, next to the op it describes, so the expression grammar is
 *  read off the registry rather than hardcoded in any parser.  Higher
 *  `precedence` binds tighter. */
export interface InfixSyntax {
  precedence: number;
  rightAssoc?: boolean;
}

/** Optional syntactic/structure traits of an operation, declared where the op
 *  is registered.  Every parser-facing distinction the ALU makes is one of
 *  these traits — there is no side table of names anywhere. */
export interface OpTraits {
  /** Consumes an n-dimensional value WHOLE (exempt from broadcast). */
  structural?: boolean;
  /** Usable as an infix operator, with the given binding. */
  infix?: InfixSyntax;
  /** The FIRST operand is an EXPRESSION (a function's bytes) rather than a
   *  value; the remaining `arity − 1` operands are its points/bounds.  The
   *  numerical layer's diff/integrate/solve/limit/optimize declare this. */
  expression?: boolean;
}

/** An operation — primitive or derived, indistinguishable by type. */
export interface Operation extends OpTraits {
  /** Canonical id, e.g. "add", "nand", "converge", "sin". */
  name: string;
  /** Operand count (fixed) or "variadic". */
  arity: Arity;
  /** True only for the kernel's irreducible roots. */
  primitive: boolean;
  /** Surface forms this op answers to — the spellings resonance maps to it,
   *  e.g. add ← ["+", "plus", "sum", "add"].  May be empty for an internal op
   *  that has no user-facing surface. */
  forms: string[];
  /** The callback. */
  fn: OpFn;
}

/** A resonance that knows nothing — the default when no host is wired in, so
 *  the pure kernel and its tests run with zero coupling.  Op recognition then
 *  falls back to literal surface forms / canonical names only. */
export const NO_RESONANCE: ResonanceSync = {
  opposite: () => null,
  recogniseOp: () => null,
};

/** The collection of operations, indexed by canonical name and by surface form.
 *  Building a kernel is a sequence of {@link prim}/{@link derive} calls; the
 *  registry then resolves names at apply time, so registration order need only
 *  respect the dependency DAG loosely (a derived op may reference an op
 *  registered later, since resolution is lazy). */
export class OperationRegistry {
  private readonly ops = new Map<string, Operation>();
  /** Surface form → the canonical names that claim it.  A form may be shared
   *  (e.g. "-" is both subtract and negate); the caller disambiguates by arity
   *  and position, so the index keeps every claimant. */
  private readonly formIndex = new Map<string, string[]>();

  /** Register an operation record directly. */
  register(op: Operation): void {
    this.ops.set(op.name, op);
    for (const f of op.forms) {
      const a = this.formIndex.get(f);
      if (a) {
        if (!a.includes(op.name)) a.push(op.name);
      } else this.formIndex.set(f, [op.name]);
    }
  }

  /** Register a PRIMITIVE op (hand-written callback), with optional {@link
   *  OpTraits} — structural (consumes an nd whole, exempt from broadcast),
   *  infix binding, expression-operand — declared here, next to the op. */
  prim(
    name: string,
    arity: Arity,
    forms: string[],
    fn: OpFn,
    traits: OpTraits = {},
  ): void {
    this.register({ name, arity, primitive: true, forms, fn, ...traits });
  }

  /** Register a DERIVED op (callback composes other ops via ctx).  `traits`
   *  as in {@link prim}. */
  derive(
    name: string,
    arity: Arity,
    forms: string[],
    fn: OpFn,
    traits: OpTraits = {},
  ): void {
    this.register({ name, arity, primitive: false, forms, fn, ...traits });
  }

  /** The op with this canonical name, or undefined. */
  get(name: string): Operation | undefined {
    return this.ops.get(name);
  }

  has(name: string): boolean {
    return this.ops.has(name);
  }

  /** The canonical names a surface form maps to (empty if none).  Several ops
   *  can share one surface (unary vs binary "-"), so this returns all. */
  lookupForm(form: string): readonly string[] {
    return this.formIndex.get(form) ?? [];
  }

  /** Every (surface form → canonical name) pair — the host enumerates these to
   *  seed its operator recogniser. */
  *formEntries(): Iterable<{ form: string; name: string }> {
    for (const [form, names] of this.formIndex) {
      for (const name of names) yield { form, name };
    }
  }

  /** Every registered canonical name. */
  names(): Iterable<string> {
    return this.ops.keys();
  }

  /** Build a context bound to a resonance and runtime — the object derived
   *  callbacks call back into.  `apply` validates arity-vs-presence and surfaces
   *  a clear error rather than letting an undefined op silently produce NaN.
   *  An optional expression evaluator lets the numerical layer act on functions
   *  (see {@link EvalExpr}). */
  context(
    resonance: ResonanceSync,
    rt: OpRuntime,
    evalExpr?: EvalExpr,
  ): OpContext {
    const self = this;
    const ctx: OpContext = {
      rt,
      resonance,
      evalExpr,
      has: (name) => self.ops.has(name),
      resolveOp: (op: Value, arity?: number) =>
        self.resolveOp(op, resonance, arity),
      apply(name: string, args: Value[]): Value {
        const op = self.ops.get(name);
        if (!op) throw new Error(`ALU: unknown operation "${name}"`);
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
            if (!isNd(a)) continue;
            if (len === -1) len = a.items.length;
            else if (a.items.length !== len) {
              throw new Error(
                `ALU: cannot broadcast "${name}" over lists of unequal length ` +
                  `(${len} vs ${a.items.length})`,
              );
            }
          }
          const out: Value[] = [];
          for (let i = 0; i < len; i++) {
            out.push(
              ctx.apply(name, args.map((a) => isNd(a) ? a.items[i] : a)),
            );
          }
          return nd(out);
        }
        if (op.arity !== "variadic" && args.length !== op.arity) {
          throw new Error(
            `ALU: "${name}" expects ${op.arity} operand(s), got ${args.length}`,
          );
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
  resolveOp(
    op: Value,
    resonance: ResonanceSync,
    arity?: number,
  ): string | null {
    // The op-value's surface text, if it has a byte reading.
    let text: string | null = null;
    if (op.domain === "symbol") {
      let s = "";
      for (let i = 0; i < op.bytes.length; i++) {
        s += String.fromCharCode(op.bytes[i]);
      }
      text = s.trim();
    } else if (op.domain === "int") text = op.n.toString();
    else if (op.domain === "bit") text = String(op.b);
    if (text === null || text.length === 0) return null;

    // (1) a literal SURFACE FORM, arity-disambiguated when asked.
    const claimants = this.formIndex.get(text);
    if (claimants && claimants.length > 0) {
      if (arity !== undefined) {
        for (const n of claimants) {
          const o = this.ops.get(n);
          const a = o && (o.arity === "variadic" ? 2 : o.arity);
          if (a === arity) return n;
        }
      }
      return claimants[0];
    }
    // (2) the MEANING, via pre-resolved resonance (synonym / multimodal gesture
    //     the bytes do not literally spell) — only a symbol carries meaning.
    if (op.domain === "symbol") {
      const byMeaning = resonance.recogniseOp(op.bytes);
      if (byMeaning && this.ops.has(byMeaning)) return byMeaning;
    }
    // (3) a bare canonical NAME already registered.
    if (this.ops.has(text)) return text;
    return null;
  }
}
