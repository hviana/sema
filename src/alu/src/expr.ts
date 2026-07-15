// expr.ts — evaluate a symbolic EXPRESSION at a binding of its free variable.
//
// A numerical operation (a derivative, an integral, a limit — or any refinement
// the kernel can express) does not act on a number; it acts on a FUNCTION, and a
// function is an expression with a free variable.  To refine such an operation,
// the engine must sample that expression at many points — and evaluating the
// expression is a RECURSIVE application of the very same ALU (its "+", "·",
// "sin", … are the registered ops).  This module is that recursion.
//
// The grammar is NOT hardcoded: it is READ OFF the operation registry.  An
// infix operator is any op registered with an `infix` trait (its precedence and
// associativity declared next to the op, kernel-arith.ts); a prefix operator is
// the arity-1 claimant of a shared symbol ("-" is negate before an operand,
// subtract between two); a function is any arity-1 op named by one of its
// surface forms; a CONSTANT is any arity-0 op (pi, e — registered like every
// other operation, kernel-numeric.ts).  So extending the notation is extending
// the registry — no parser edits, no operator tables, no magic characters
// beyond the irreducible numeral floor.
//
// The free variable can be given explicitly or AUTO-DETECTED: when none is
// named, the single identifier that resolves to no registered op is taken as
// the variable.  This keeps "x^2", "t*t", or a one-symbol form in any alphabet
// working without the caller having to spell out the variable.

import type { InfixSyntax, OperationRegistry } from "./operation.js";

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

const isDigit = (c: string) => c >= "0" && c <= "9";
// A "letter" for identifier purposes is any non-ASCII rune or an ASCII letter —
// so a variable or function name may be written in any script (multimodal /
// multilingual), not just A–Z.  Operator glyphs (registered symbolic forms)
// are claimed BEFORE identifiers, so "·" and "≤" never read as names.
const isLetter = (c: string) =>
  (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c.charCodeAt(0) > 127;
const isSpace = (c: string) =>
  c === " " || c === "\t" || c === "\n" || c === "\r";

/** Tokenize an expression string: numerals (the irreducible floor), operator
 *  tokens (matched longest-first against `operators` — the registry's own
 *  symbolic surface forms), identifiers, and parentheses.  When no operator
 *  vocabulary is given, each symbolic character stands alone (enough for name
 *  extraction).  Returns null when a character fits none of these — the span is
 *  not a clean expression. */
export function tokenize(
  s: string,
  operators?: readonly string[],
): Token[] | null {
  const toks: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (isDigit(c) || (c === "." && i + 1 < s.length && isDigit(s[i + 1]))) {
      let j = i;
      let seenDot = false;
      while (j < s.length) {
        if (isDigit(s[j])) j++;
        else if (s[j] === "." && !seenDot) {
          seenDot = true;
          j++;
        } else break;
      }
      // optional exponent
      if (j < s.length && (s[j] === "e" || s[j] === "E")) {
        let k = j + 1;
        if (k < s.length && (s[k] === "+" || s[k] === "-")) k++;
        if (k < s.length && isDigit(s[k])) {
          while (k < s.length && isDigit(s[k])) k++;
          j = k;
        }
      }
      const text = s.slice(i, j);
      const num = Number(text);
      if (!Number.isFinite(num)) return null;
      toks.push({ kind: "num", text, value: num });
      i = j;
      continue;
    }
    if (c === "(") {
      toks.push({ kind: "lparen", text: c });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ kind: "rparen", text: c });
      i++;
      continue;
    }
    // A registered symbolic operator form, longest first — claimed before the
    // identifier path so an operator GLYPH (·, ×, ≤, …) is an operator, not a
    // name.
    const op = operators?.find((f) => s.startsWith(f, i));
    if (op !== undefined) {
      toks.push({ kind: "op", text: op });
      i += op.length;
      continue;
    }
    if (isLetter(c)) {
      let j = i;
      while (j < s.length && (isLetter(s[j]) || isDigit(s[j]))) j++;
      toks.push({ kind: "name", text: s.slice(i, j) });
      i = j;
      continue;
    }
    // Fallback for a symbolic character outside any vocabulary: its own token,
    // so name extraction (freeVariables) still splits "a*b" without a grammar.
    if (operators === undefined) {
      toks.push({ kind: "op", text: c });
      i++;
      continue;
    }
    return null; // an unexpected character → not a clean expression
  }
  return toks;
}

/** The identifiers in `s` that are NOT known unary functions and NOT registered
 *  constants — the free-variable candidates.  Used to auto-detect the variable
 *  when the caller did not name one. */
export function freeVariables(
  s: string,
  isUnaryFn: IsUnaryFn,
  isConstant: (name: string) => boolean = () => false,
): string[] {
  const toks = tokenize(s);
  if (!toks) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind !== "name") continue;
    // A name immediately followed by "(" is a function call, not a variable.
    const isCall = k + 1 < toks.length && toks[k + 1].kind === "lparen";
    if (isCall || isUnaryFn(t.text) || isConstant(t.text)) continue;
    if (!seen.has(t.text)) {
      seen.add(t.text);
      out.push(t.text);
    }
  }
  return out;
}

/** The expression grammar, read off an operation registry once and reused for
 *  every evaluation.  It resolves each token through the registry's own form
 *  index — infix binding from the `infix` trait, a prefix operator as the
 *  arity-1 claimant of a shared symbol, functions as arity-1 ops, constants as
 *  arity-0 ops — so the grammar and the kernel can never drift apart. */
export class ExprGrammar {
  /** Symbolic operator tokens, longest first (so "<=" wins over "<"). */
  private readonly operatorTokens: string[];
  /** token → the infix op it names and its declared binding. */
  private readonly infixTable = new Map<
    string,
    { name: string; syntax: InfixSyntax }
  >();
  /** token → the arity-1 (prefix) op it names. */
  private readonly prefixTable = new Map<string, string>();
  /** The tightest infix tier — a prefix operator binds its operand up through
   *  it, so "-x^2" reads -(x^2) without a hardcoded rule. */
  private readonly maxPrecedence: number;

  constructor(
    private readonly registry: OperationRegistry,
    private readonly applyScalar: ApplyScalar,
  ) {
    const tokens = new Set<string>();
    let maxPrec = 0;
    for (const { form, name } of registry.formEntries()) {
      const op = registry.get(name)!;
      const symbolic = form.length > 0 && !/[A-Za-z0-9]/.test(form);
      if (!symbolic) continue;
      tokens.add(form);
      if (op.infix && !this.infixTable.has(form)) {
        this.infixTable.set(form, { name, syntax: op.infix });
        maxPrec = Math.max(maxPrec, op.infix.precedence);
      }
      if (op.arity === 1 && !this.prefixTable.has(form)) {
        this.prefixTable.set(form, name);
      }
    }
    this.operatorTokens = [...tokens].sort((a, b) => b.length - a.length);
    this.maxPrecedence = maxPrec;
  }

  /** Resolve an identifier to a registered op of the given arity: a surface
   *  form claimant of that arity first, else the canonical name itself. */
  private resolveName(name: string, arity: number): string | null {
    for (const n of this.registry.lookupForm(name)) {
      if (this.registry.get(n)!.arity === arity) return n;
    }
    const own = this.registry.get(name);
    return own && own.arity === arity ? name : null;
  }

  /** Whether an identifier names a unary function. */
  isFunction(name: string): boolean {
    return this.resolveName(name, 1) !== null;
  }

  /** Whether an identifier names a nullary constant (an arity-0 op). */
  isConstant(name: string): boolean {
    return this.resolveName(name, 0) !== null;
  }

  /** Tokenize with this grammar's operator vocabulary. */
  tokenize(s: string): Token[] | null {
    return tokenize(s, this.operatorTokens);
  }

  /** The free-variable candidates of `s` under this grammar. */
  freeVariables(s: string): string[] {
    return freeVariables(
      s,
      (n) => this.isFunction(n),
      (n) => this.isConstant(n),
    );
  }

  /** Evaluate expression `s` with `variable` bound to `at`.  Returns a number,
   *  or null if `s` is not a well-formed expression.  Every binary/function/
   *  constant step is applied through the kernel, so the arithmetic is the
   *  kernel's own.  When `variable` is empty, the single free variable is
   *  auto-detected; if there is more than one and none was named, evaluation
   *  declines (null) — a genuinely multivariate expression needs an explicit
   *  binding. */
  eval(s: string, variable: string, at: number): number | null {
    const toks = this.tokenize(s);
    if (!toks || toks.length === 0) return null;

    let v = variable;
    if (v === "") {
      const fv = this.freeVariables(s);
      if (fv.length === 1) v = fv[0];
      else if (fv.length > 1) return null; // multivariate, no binding named
      // fv.length === 0: a constant expression is fine.
    }

    let pos = 0;
    const peek = () => toks[pos];
    const next = () => toks[pos++];
    const FAIL = Symbol("expr-fail");
    const fail = (): never => {
      throw FAIL;
    };
    const grammar = this;

    // Precedence climbing over the registry-declared infix tiers.
    function parseExpr(minPrec: number): number {
      let lhs = parseOperand();
      for (;;) {
        const t = peek();
        if (!t || t.kind !== "op") break;
        const infix = grammar.infixTable.get(t.text);
        if (!infix || infix.syntax.precedence < minPrec) break;
        next();
        const nextMin = infix.syntax.rightAssoc
          ? infix.syntax.precedence
          : infix.syntax.precedence + 1;
        const rhs = parseExpr(nextMin);
        lhs = grammar.applyScalar(infix.name, [lhs, rhs]);
      }
      return lhs;
    }

    // An operand: a prefix operator (the arity-1 claimant of its symbol,
    // binding up through the tightest infix tier), or an atom.
    function parseOperand(): number {
      const t = peek();
      if (t && t.kind === "op") {
        const prefix = grammar.prefixTable.get(t.text);
        if (prefix === undefined) return fail();
        next();
        return grammar.applyScalar(prefix, [parseExpr(grammar.maxPrecedence)]);
      }
      return parseAtom();
    }

    function parseAtom(): number {
      const t = peek();
      if (!t) fail();
      if (t.kind === "num") {
        next();
        return t.value!;
      }
      if (t.kind === "lparen") {
        next();
        const inner = parseExpr(0);
        if (!peek() || peek().kind !== "rparen") fail();
        next();
        return inner;
      }
      if (t.kind === "name") {
        next();
        // A function call: name "(" expr ")".
        if (peek() && peek().kind === "lparen") {
          const fn = grammar.resolveName(t.text, 1);
          if (fn === null) return fail();
          next(); // (
          const arg = parseExpr(0);
          if (!peek() || peek().kind !== "rparen") fail();
          next(); // )
          return grammar.applyScalar(fn, [arg]);
        }
        // Otherwise an identifier: the free variable, or a nullary constant
        // resolved through the registry like any other operation.
        if (t.text === v) return at;
        const konst = grammar.resolveName(t.text, 0);
        if (konst !== null) return grammar.applyScalar(konst, []);
        return fail();
      }
      return fail();
    }

    try {
      const result = parseExpr(0);
      if (pos !== toks.length) return null; // trailing tokens → malformed
      return Number.isFinite(result) ? result : null;
    } catch (err) {
      if (err === FAIL) return null;
      return null; // a kernel apply threw (e.g. ÷0 produced ∞) → decline
    }
  }
}
