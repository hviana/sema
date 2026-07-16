import { type Value } from "./value.js";
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
export declare const NO_RESONANCE: ResonanceSync;
/** The collection of operations, indexed by canonical name and by surface form.
 *  Building a kernel is a sequence of {@link prim}/{@link derive} calls; the
 *  registry then resolves names at apply time, so registration order need only
 *  respect the dependency DAG loosely (a derived op may reference an op
 *  registered later, since resolution is lazy). */
export declare class OperationRegistry {
  private readonly ops;
  /** Surface form → the canonical names that claim it.  A form may be shared
   *  (e.g. "-" is both subtract and negate); the caller disambiguates by arity
   *  and position, so the index keeps every claimant. */
  private readonly formIndex;
  /** Register an operation record directly. */
  register(op: Operation): void;
  /** Register a PRIMITIVE op (hand-written callback), with optional {@link
   *  OpTraits} — structural (consumes an nd whole, exempt from broadcast),
   *  infix binding, expression-operand — declared here, next to the op. */
  prim(
    name: string,
    arity: Arity,
    forms: string[],
    fn: OpFn,
    traits?: OpTraits,
  ): void;
  /** Register a DERIVED op (callback composes other ops via ctx).  `traits`
   *  as in {@link prim}. */
  derive(
    name: string,
    arity: Arity,
    forms: string[],
    fn: OpFn,
    traits?: OpTraits,
  ): void;
  /** The op with this canonical name, or undefined. */
  get(name: string): Operation | undefined;
  has(name: string): boolean;
  /** The canonical names a surface form maps to (empty if none).  Several ops
   *  can share one surface (unary vs binary "-"), so this returns all. */
  lookupForm(form: string): readonly string[];
  /** Every (surface form → canonical name) pair — the host enumerates these to
   *  seed its operator recogniser. */
  formEntries(): Iterable<{
    form: string;
    name: string;
  }>;
  /** Every registered canonical name. */
  names(): Iterable<string>;
  /** Build a context bound to a resonance and runtime — the object derived
   *  callbacks call back into.  `apply` validates arity-vs-presence and surfaces
   *  a clear error rather than letting an undefined op silently produce NaN.
   *  An optional expression evaluator lets the numerical layer act on functions
   *  (see {@link EvalExpr}). */
  context(
    resonance: ResonanceSync,
    rt: OpRuntime,
    evalExpr?: EvalExpr,
  ): OpContext;
  /** Resolve an operation-denoting value to a canonical op name — the shared
   *  machinery behind {@link OpContext.resolveOp}.  Tries, in order: a literal
   *  surface form (the registry's own index, arity-disambiguated), the meaning
   *  via `resonance.recogniseOp`, then a bare canonical name / decimal reading.
   *  Returns null when nothing resolves.  Static-shaped (takes the resonance
   *  explicitly) so both the context closure and callers can use it. */
  resolveOp(op: Value, resonance: ResonanceSync, arity?: number): string | null;
}
