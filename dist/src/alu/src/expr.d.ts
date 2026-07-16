import type { OperationRegistry } from "./operation.js";
/** Apply a scalar kernel op by canonical name to numeric arguments, returning a
 *  number.  The expression evaluator routes every step through this, so the
 *  arithmetic inside an integrand is the kernel's own. */
export type ApplyScalar = (name: string, args: number[]) => number;
/** Whether a name is a registered unary function the evaluator may call. */
export type IsUnaryFn = (name: string) => boolean;
export interface Token {
    kind: "num" | "name" | "op" | "lparen" | "rparen";
    text: string;
    value?: number;
}
/** Tokenize an expression string: numerals (the irreducible floor), operator
 *  tokens (matched longest-first against `operators` — the registry's own
 *  symbolic surface forms), identifiers, and parentheses.  When no operator
 *  vocabulary is given, each symbolic character stands alone (enough for name
 *  extraction).  Returns null when a character fits none of these — the span is
 *  not a clean expression. */
export declare function tokenize(s: string, operators?: readonly string[]): Token[] | null;
/** The identifiers in `s` that are NOT known unary functions and NOT registered
 *  constants — the free-variable candidates.  Used to auto-detect the variable
 *  when the caller did not name one. */
export declare function freeVariables(s: string, isUnaryFn: IsUnaryFn, isConstant?: (name: string) => boolean): string[];
/** The expression grammar, read off an operation registry once and reused for
 *  every evaluation.  It resolves each token through the registry's own form
 *  index — infix binding from the `infix` trait, a prefix operator as the
 *  arity-1 claimant of a shared symbol, functions as arity-1 ops, constants as
 *  arity-0 ops — so the grammar and the kernel can never drift apart. */
export declare class ExprGrammar {
    private readonly registry;
    private readonly applyScalar;
    /** Symbolic operator tokens, longest first (so "<=" wins over "<"). */
    private readonly operatorTokens;
    /** token → the infix op it names and its declared binding. */
    private readonly infixTable;
    /** token → the arity-1 (prefix) op it names. */
    private readonly prefixTable;
    /** The tightest infix tier — a prefix operator binds its operand up through
     *  it, so "-x^2" reads -(x^2) without a hardcoded rule. */
    private readonly maxPrecedence;
    constructor(registry: OperationRegistry, applyScalar: ApplyScalar);
    /** Resolve an identifier to a registered op of the given arity: a surface
     *  form claimant of that arity first, else the canonical name itself. */
    private resolveName;
    /** Whether an identifier names a unary function. */
    isFunction(name: string): boolean;
    /** Whether an identifier names a nullary constant (an arity-0 op). */
    isConstant(name: string): boolean;
    /** Tokenize with this grammar's operator vocabulary. */
    tokenize(s: string): Token[] | null;
    /** The free-variable candidates of `s` under this grammar. */
    freeVariables(s: string): string[];
    /** Evaluate expression `s` with `variable` bound to `at`.  Returns a number,
     *  or null if `s` is not a well-formed expression.  Every binary/function/
     *  constant step is applied through the kernel, so the arithmetic is the
     *  kernel's own.  When `variable` is empty, the single free variable is
     *  auto-detected; if there is more than one and none was named, evaluation
     *  declines (null) — a genuinely multivariate expression needs an explicit
     *  binding. */
    eval(s: string, variable: string, at: number): number | null;
}
