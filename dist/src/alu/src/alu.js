// alu.ts — the assembled ALU: registry + the synchronous recogniser the search
// consults.
//
// `Alu` wires the kernels into one OperationRegistry and exposes exactly what a
// host needs to fold computation into its lightest-derivation search:
//
//   • scan(bytes)        — find OPERAND spans (numeric literals) and OPERATOR
//                          spans (literal symbolic forms) directly in the raw
//                          bytes, independent of any host chunking.
//   • recogniseValue     — read a byte span into a Value: a scalar, or a LIST (a
//                          run of element values joined by a consistent separator
//                          — `[1,2,3]`, `1 2 3`, `1, 2, 3`, none privileged).
//   • lookupOperator     — the canonical op(s) a literal surface form names.
//   • applyValues        — apply an op to operand VALUES, encode the result.
//   • applyBytes         — decode operand spans, apply an op, encode the result;
//                          the pure computation a graph rule materialises.
//   • grammar            — the registry-derived expression grammar (expr.ts),
//                          through which infix runs and integrands evaluate by
//                          a recursive application of the same kernel.
//
// The facade is also the sub-library's ONE doorway for a host: it is built
// over an {@link "./parser.js".AluHost} port (resonance + geometry — by default
// a structural stub, so the ALU runs fully decoupled) and exposes
//
//   • parse(query)       — recognise and evaluate every computation a raw byte
//                          query invokes (the query parser, parser.ts);
//   • compute(name, …)   — apply an operation to operand byte spans, structure
//                          recognised and resonance pre-resolved (the
//                          n-dimensional entry point).
//
// Operations recognised by MEANING — a synonym form ("plus", "increased by"), a
// glyph, or an operation the bytes do not spell at all (an integral, a limit) —
// are resolved only through the host port; the kernel itself stays a pure,
// deterministic machine over literal numerals and registered surface forms.
import { asReal, decimalCodec, nd, parseValue, real } from "./value.js";
import { NO_RESONANCE, OperationRegistry } from "./operation.js";
import { registerLogic } from "./kernel-logic.js";
import { registerBits } from "./kernel-bits.js";
import { registerArith } from "./kernel-arith.js";
import { registerNumeric } from "./kernel-numeric.js";
import { registerNd } from "./kernel-nd.js";
import { ExprGrammar } from "./expr.js";
import { QueryParser, STRUCTURAL_HOST } from "./parser.js";
import {
  CLOSE,
  DOT,
  isDigitByte,
  isSepByte,
  matchBracket,
  OPEN,
  trimEnd,
  trimStart,
} from "./text.js";
import { latin1 } from "../../bytes.js";
export class Alu {
  registry = new OperationRegistry();
  codec;
  rt;
  /** Symbolic operator forms (no ASCII letter/digit), as byte patterns, sorted
   *  longest-first so the scanner matches "<=" before "<". */
  symbolicForms;
  _grammar;
  _anchors;
  /** How many {@link apply} calls ended in a caught throw this session, and
   *  the most recent caught error.  A caught throw is USUALLY a routine
   *  decline (a symbol fed to arithmetic — the "rule does not fire"
   *  contract), but the same catch would also swallow a genuine kernel bug;
   *  these two fields make that observable instead of silent.  Zero cost when
   *  nothing throws. */
  applyCaught = 0;
  lastApplyError = null;
  decoder = new TextDecoder();
  /** The query parser, wired to the host port — internal; hosts reach it only
   *  through {@link parse} and {@link compute}. */
  parser;
  constructor(opts = {}, host = STRUCTURAL_HOST) {
    const precision = opts.precision ?? 6;
    this.codec = decimalCodec(precision);
    this.rt = { tol: opts.tol ?? 1e-10, maxIter: opts.maxIter ?? 1000 };
    registerLogic(this.registry);
    registerBits(this.registry);
    registerArith(this.registry);
    registerNumeric(this.registry);
    registerNd(this.registry);
    this.symbolicForms = this.buildSymbolicForms();
    this.parser = new QueryParser(this, host);
  }
  /** Recognise and evaluate every computation `query` invokes — infix
   *  arithmetic runs, and operations named literally or by meaning (through the
   *  host port).  All async resonance is resolved inside, so the caller
   *  receives finished spans it can fold synchronously into its search.  See
   *  {@link "./parser.js".QueryParser.parse}. */
  parse(query) {
    return this.parser.parse(query);
  }
  /** Apply an operation to operand byte spans — operand STRUCTURE recognised
   *  into Values, every reachable symbol's resonance pre-resolved through the
   *  host port — and encode the result canonically; null when the computation
   *  declines.  See {@link "./parser.js".QueryParser.compute}. */
  compute(name, operandBytes, asSymbol = () => false) {
    return this.parser.compute(name, operandBytes, asSymbol);
  }
  /** Infix arity of an op: its fixed arity, or 2 for a variadic op (an infix
   *  operator binds two operands; the registry's variadic fold still accepts
   *  the pair). */
  infixArity(op) {
    return op.arity === "variadic" ? 2 : op.arity;
  }
  /** Collect the symbolic surface forms (punctuation, no letters/digits) as
   *  UTF-8 byte patterns.  Each maps to the binary claimant when one exists, so
   *  an infix scan resolves a shared symbol to its two-operand reading. */
  buildSymbolicForms() {
    const enc = new TextEncoder();
    const isSymbolic = (s) => s.length > 0 && !/[A-Za-z0-9]/.test(s);
    const byForm = new Map();
    for (const { form, name } of this.registry.formEntries()) {
      if (!isSymbolic(form)) {
        continue;
      }
      const a = byForm.get(form);
      if (a) {
        a.push(name);
      } else {
        byForm.set(form, [name]);
      }
    }
    const out = [];
    for (const [form, names] of byForm) {
      // Prefer a binary/variadic claimant for infix matching.
      let chosen = names[0];
      let chosenArity = this.infixArity(this.registry.get(chosen));
      for (const n of names) {
        const a = this.infixArity(this.registry.get(n));
        if (a === 2) {
          chosen = n;
          chosenArity = a;
          break;
        }
      }
      out.push({ bytes: enc.encode(form), name: chosen, arity: chosenArity });
    }
    // Longest first so a longer form wins over a prefix of it ("<=" before "<").
    out.sort((a, b) => b.bytes.length - a.bytes.length);
    return out;
  }
  /** The canonical op name(s) a literal surface form names (exact lookup). */
  lookupOperator(form) {
    return this.registry.lookupForm(form);
  }
  /** The operation CONCEPT anchors: the (canonical name, form bytes) pairs a
   *  span's MEANING is resonated against, so an operation the bytes do not
   *  literally spell (an integral, a derivative, a limit, …, in any modality)
   *  is recognised by gist nearness to one of these forms.  This is what makes
   *  operation recognition generic and modality-agnostic rather than a fixed
   *  symbol table — and the ALU, not the host, decides which of its surface
   *  forms are anchors, using its own machinery:
   *
   *   • a form the SCANNER already reads in full (a pure operator symbol like
   *     "<=", a numeral like "0") is excluded — the literal path owns it, and
   *     its meaning-space image would only add noise;
   *   • a form must be COMPOUND (≥ 2 runes): a single atom's gist is a
   *     coordinate of the alphabet, not a distributional meaning, so there is
   *     nothing for resonance to read.
   *
   *  Cached once; the stable array identity lets the host memoise whatever
   *  representation (gists, indices) it derives from it. */
  conceptAnchors() {
    if (this._anchors) {
      return this._anchors;
    }
    const enc = new TextEncoder();
    const out = [];
    for (const { form, name } of this.registry.formEntries()) {
      if ([...form].length < 2) {
        continue; // a lone atom carries no gist
      }
      const bytes = enc.encode(form);
      // Fully claimed by the literal scanner → the literal path owns it.
      const { operands, operators } = this.scan(bytes);
      let claimed = 0;
      for (const t of [...operands, ...operators]) {
        claimed += t.j - t.i;
      }
      if (claimed === bytes.length) {
        continue;
      }
      out.push({ name, form: bytes });
    }
    return (this._anchors = out);
  }
  /** The registry-derived expression grammar, built once: infix binding and
   *  prefix/function/constant resolution all read off the registered ops, and
   *  every evaluation step routes back through this registry's own arithmetic —
   *  recursion all the way down (see expr.ts). */
  get grammar() {
    if (!this._grammar) {
      const scalarCtx = this.registry.context(NO_RESONANCE, this.rt);
      this._grammar = new ExprGrammar(
        this.registry,
        (name, args) => asReal(scalarCtx.apply(name, args.map(real))),
      );
    }
    return this._grammar;
  }
  /** Evaluate an expression's bytes at a variable binding, through this
   *  registry's own arithmetic (see {@link grammar}). */
  evalExpression(bytes, variable, at) {
    return this.grammar.eval(this.decoder.decode(bytes), variable, at);
  }
  /** Whether a name is a registered operation. */
  has(name) {
    return this.registry.has(name);
  }
  /** The infix arity of a registered op (for the host to size a rule), or 0. */
  arityOf(name) {
    const op = this.registry.get(name);
    return op ? this.infixArity(op) : 0;
  }
  /** Whether an op acts on an EXPRESSION (a function) rather than plain numbers
   *  — declared by the op itself at registration (the `expression` trait), so
   *  there is no side table of names here. */
  isExpressionOp(name) {
    return this.registry.get(name)?.expression === true;
  }
  /** Scan a byte span for operand (numeric) and operator (symbolic) spans.  A
   *  pure, deterministic left-to-right lexer: at each position take a numeral if
   *  one starts there, else the longest symbolic operator form, else skip one
   *  byte.  Numerals and operator symbols are disjoint character classes, so the
   *  two never overlap. */
  scan(bytes) {
    const operands = [];
    const operators = [];
    const n = bytes.length;
    let i = 0;
    while (i < n) {
      const c = bytes[i];
      // A numeral: a run of digits, with at most one interior decimal point that
      // is itself flanked by digits (so a trailing "." is left to the operators
      // / skip path, not swallowed).
      if (
        isDigitByte(c) || (c === DOT && i + 1 < n && isDigitByte(bytes[i + 1]))
      ) {
        let j = i;
        let seenDot = false;
        while (j < n) {
          if (isDigitByte(bytes[j])) {
            j++;
          } else if (
            bytes[j] === DOT && !seenDot && j + 1 < n &&
            isDigitByte(bytes[j + 1])
          ) {
            seenDot = true;
            j++;
          } else {
            break;
          }
        }
        operands.push({ i, j, value: parseValue(bytes.subarray(i, j)) });
        i = j;
        continue;
      }
      // The longest symbolic operator form starting here.
      const op = this.matchSymbolic(bytes, i);
      if (op) {
        operators.push({
          i,
          j: i + op.bytes.length,
          name: op.name,
          arity: op.arity,
        });
        i += op.bytes.length;
        continue;
      }
      i++;
    }
    return { operands, operators };
  }
  matchSymbolic(bytes, at) {
    for (const f of this.symbolicForms) {
      const len = f.bytes.length;
      if (at + len > bytes.length) {
        continue;
      }
      let ok = true;
      for (let k = 0; k < len; k++) {
        if (bytes[at + k] !== f.bytes[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        return f;
      }
    }
    return null;
  }
  /** Read a byte span into a {@link Value} by recognising its STRUCTURE — the
   *  byte⇄Value boundary the host computes across.  The kernel itself only knows
   *  the irreducible scalar floor (a numeral's digits → a quantity, via {@link
   *  parseValue}); recognising whether a span is one quantity or a LIST of them is
   *  layered here, over {@link scan}, so no caller re-implements it.
   *
   *  A LIST is a run of element values joined by a CONSISTENT separator.  No
   *  spelling is privileged: two complementary readings cover the forms a list
   *  takes —
   *
   *   • CONTAINER — an explicit `[ … ]` group delimits a list whose elements may
   *     be anything (symbols, nested groups, mixed): split its interior at the TOP
   *     level (bracket-depth aware) on separator runs, each element recognised in
   *     turn (so nesting and heterogeneity recurse for free).  This is also the
   *     codec's canonical OUTPUT spelling, so a computed list feeds straight back
   *     in as an operand.
   *   • SEQUENCE — a bare run of ≥2 numeric operands with a consistent connective
   *     between them (`1 2 3`, `1, 2, 3`, `1 and 2 and 3`): the operands {@link
   *     scan} finds are the elements, and whatever sits between them — a space, a
   *     comma, " and " — is the separator, accepted as long as it is the same
   *     throughout and the run has no leftover edges.
   *
   *  Anything else is a SCALAR ({@link parseValue}): a numeral, or an opaque
   *  symbol of any modality (a learnt form, an operator name a higher-order op
   *  will resolve, a single word). */
  recogniseValue(bytes) {
    const s = bytes.subarray(trimStart(bytes), trimEnd(bytes));
    // CONTAINER: a balanced [ … ] group spanning the whole (trimmed) span.
    if (s.length >= 2 && s[0] === OPEN && matchBracket(s, 0) === s.length - 1) {
      return nd(this.recogniseContainer(s.subarray(1, s.length - 1)));
    }
    // SEQUENCE: ≥2 numeric operands with a consistent connective between them.
    const seq = this.recogniseSequence(s);
    if (seq !== null) {
      return nd(seq);
    }
    // SCALAR floor.
    return parseValue(s);
  }
  /** Split a CONTAINER's interior into its element values — top-level (bracket-
   *  depth aware) spans divided by separator RUNS (maximal runs of {@link
   *  isSepByte}).  The brackets are the explicit delimiter, so the divider's
   *  spelling is not privileged (`[1,2,3]`, `[1, 2, 3]`, `[1 2 3]` are the same
   *  list).  Each element is recognised in turn, so a nested `[ … ]` element
   *  recurses and a symbol element stays opaque.  An empty interior is `[]`. */
  recogniseContainer(inner) {
    if (trimEnd(inner) <= trimStart(inner)) {
      return []; // empty / all space → []
    }
    const elements = [];
    let depth = 0;
    let start = 0;
    let p = 0;
    while (p < inner.length) {
      const c = inner[p];
      if (c === OPEN) {
        depth++;
      } else if (c === CLOSE) {
        depth--;
      }
      if (depth === 0 && isSepByte(c)) {
        let q = p;
        while (q < inner.length && isSepByte(inner[q])) {
          q++;
        }
        elements.push(inner.subarray(start, p));
        start = q;
        p = q;
        continue;
      }
      p++;
    }
    elements.push(inner.subarray(start));
    return elements.map((e) => this.recogniseValue(e));
  }
  /** Recognise a bare SEQUENCE — ≥2 numeric operands separated by a consistent
   *  connective, with no leftover material at the edges — or null when the span
   *  is not such a sequence.  The operands are exactly the ones {@link scan}
   *  finds; the bytes between consecutive operands are the separator, which need
   *  only be the SAME throughout (a space, a comma, " and ", …) — its spelling is
   *  not constrained, so no separator is privileged. */
  recogniseSequence(s) {
    const { operands } = this.scan(s);
    if (operands.length < 2) {
      return null;
    }
    // No leftover before the first operand or after the last (a clean sequence).
    if (trimStart(s) !== operands[0].i) {
      return null;
    }
    if (trimEnd(s) !== operands[operands.length - 1].j) {
      return null;
    }
    let sep = null;
    for (let k = 0; k + 1 < operands.length; k++) {
      const gap = latin1(s.subarray(operands[k].j, operands[k + 1].i));
      if (gap.length === 0) {
        return null; // operands must be separated
      }
      if (sep === null) {
        sep = gap;
      } else if (gap !== sep) {
        return null; // inconsistent → not one sequence
      }
    }
    return operands.map((o) => this.recogniseValue(s.subarray(o.i, o.j)));
  }
  /** Apply an op to operand values, with the given pre-resolved resonance.
   *  Returns the result value, or null if the op is unknown or the computation
   *  throws (e.g. a symbol fed to arithmetic) — the caller treats null as "this
   *  rule does not fire", never as a wrong answer. */
  apply(name, operands, resonance = NO_RESONANCE) {
    if (!this.registry.has(name)) {
      return null;
    }
    try {
      const ctx = this.registry.context(
        resonance,
        this.rt,
        this.makeEvalExpr(),
      );
      return ctx.apply(name, operands);
    } catch (err) {
      // The "rule does not fire" contract — but never invisibly: the counter
      // and lastApplyError let a debugger distinguish a routine decline from
      // a kernel bug that would otherwise read as "computation unknown".
      this.applyCaught++;
      this.lastApplyError = err;
      return null;
    }
  }
  /** The expression evaluator handed to op contexts, bound to the cached {@link
   *  grammar}: the numerical layer's integrand is evaluated by a recursive
   *  application of the same derived-from-nand arithmetic. */
  makeEvalExpr() {
    return (bytes, variable, at) =>
      this.grammar.eval(this.decoder.decode(bytes), variable, at);
  }
  /** Decode operand byte spans, apply `name`, and encode the result — the pure
   *  computation the graph rule materialises into an output span.  Returns null
   *  on any failure (unknown op, undecodable operand, thrown computation), so a
   *  rule that cannot compute simply does not fire.  The result bytes are
   *  canonical (see {@link decimalCodec}), so two derivations of the same value
   *  agree byte-for-byte — required for the search's chart memoization. */
  applyBytes(name, operandBytes, resonance = NO_RESONANCE) {
    return this.applyBytesTyped(name, operandBytes, () => false, resonance);
  }
  /** Apply `name` to operand VALUES (a scalar, or an `nd` recognised by {@link
   *  recogniseValue}), and encode the result canonically.  This is the entry
   *  point for computation over STRUCTURE: the scalar kernel and the nd kernel
   *  both consume Values, so once a span is recognised the computation is the
   *  same whether the operand came in as a number or a list.  Returns null on any
   *  failure (unknown op, thrown computation), the same "this rule does not fire"
   *  contract as {@link applyBytes}. */
  applyValues(name, operands, resonance = NO_RESONANCE) {
    const result = this.apply(name, operands, resonance);
    if (result === null) {
      return null;
    }
    return this.codec.encode(result);
  }
  /** Like {@link applyBytes}, but `asSymbol(idx)` marks operand positions that
   *  must be kept as an opaque SYMBOL (not parsed as a number) — the convention
   *  the numerical layer needs, where operand 0 is an EXPRESSION (a function's
   *  bytes) the kernel samples via the expression evaluator, not a numeral. */
  applyBytesTyped(name, operandBytes, asSymbol, resonance = NO_RESONANCE) {
    const operands = [];
    for (let i = 0; i < operandBytes.length; i++) {
      const b = operandBytes[i];
      const v = asSymbol(i)
        ? { domain: "symbol", bytes: b }
        : this.codec.decode(b);
      if (v === null) {
        return null;
      }
      operands.push(v);
    }
    const result = this.apply(name, operands, resonance);
    if (result === null) {
      return null;
    }
    return this.codec.encode(result);
  }
}
