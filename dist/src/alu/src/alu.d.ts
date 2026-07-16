import { type Value, type ValueCodec } from "./value.js";
import { OperationRegistry, type ResonanceSync } from "./operation.js";
import { ExprGrammar } from "./expr.js";
import type { ConceptAnchor } from "./resonance.js";
import { type AluHost, type ComputedSpan } from "./parser.js";
/** A numeric literal found in the byte stream, with its parsed value. */
export interface OperandSpan {
    i: number;
    j: number;
    value: Value;
}
/** A recognised operator span: the byte range and the canonical op it names. */
export interface OperatorSpan {
    i: number;
    j: number;
    name: string;
    /** Operand count for INFIX use — a fixed arity as registered, or 2 for a
     *  variadic op used as a binary infix operator. */
    arity: number;
}
/** Options for assembling an {@link Alu}. */
export interface AluOptions {
    /** Decimal places a real result is rounded to before encoding (determinism). */
    precision?: number;
    /** Numerical convergence tolerance and iteration ceiling. */
    tol?: number;
    maxIter?: number;
}
export declare class Alu {
    readonly registry: OperationRegistry;
    readonly codec: ValueCodec;
    private readonly rt;
    /** Symbolic operator forms (no ASCII letter/digit), as byte patterns, sorted
     *  longest-first so the scanner matches "<=" before "<". */
    private readonly symbolicForms;
    private _grammar?;
    private _anchors?;
    /** How many {@link apply} calls ended in a caught throw this session, and
     *  the most recent caught error.  A caught throw is USUALLY a routine
     *  decline (a symbol fed to arithmetic — the "rule does not fire"
     *  contract), but the same catch would also swallow a genuine kernel bug;
     *  these two fields make that observable instead of silent.  Zero cost when
     *  nothing throws. */
    applyCaught: number;
    lastApplyError: unknown;
    private readonly decoder;
    /** The query parser, wired to the host port — internal; hosts reach it only
     *  through {@link parse} and {@link compute}. */
    private readonly parser;
    constructor(opts?: AluOptions, host?: AluHost);
    /** Recognise and evaluate every computation `query` invokes — infix
     *  arithmetic runs, and operations named literally or by meaning (through the
     *  host port).  All async resonance is resolved inside, so the caller
     *  receives finished spans it can fold synchronously into its search.  See
     *  {@link "./parser.js".QueryParser.parse}. */
    parse(query: Uint8Array): Promise<ComputedSpan[]>;
    /** Apply an operation to operand byte spans — operand STRUCTURE recognised
     *  into Values, every reachable symbol's resonance pre-resolved through the
     *  host port — and encode the result canonically; null when the computation
     *  declines.  See {@link "./parser.js".QueryParser.compute}. */
    compute(name: string, operandBytes: Uint8Array[], asSymbol?: (idx: number) => boolean): Promise<Uint8Array | null>;
    /** Infix arity of an op: its fixed arity, or 2 for a variadic op (an infix
     *  operator binds two operands; the registry's variadic fold still accepts
     *  the pair). */
    private infixArity;
    /** Collect the symbolic surface forms (punctuation, no letters/digits) as
     *  UTF-8 byte patterns.  Each maps to the binary claimant when one exists, so
     *  an infix scan resolves a shared symbol to its two-operand reading. */
    private buildSymbolicForms;
    /** The canonical op name(s) a literal surface form names (exact lookup). */
    lookupOperator(form: string): readonly string[];
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
    conceptAnchors(): ReadonlyArray<ConceptAnchor>;
    /** The registry-derived expression grammar, built once: infix binding and
     *  prefix/function/constant resolution all read off the registered ops, and
     *  every evaluation step routes back through this registry's own arithmetic —
     *  recursion all the way down (see expr.ts). */
    get grammar(): ExprGrammar;
    /** Evaluate an expression's bytes at a variable binding, through this
     *  registry's own arithmetic (see {@link grammar}). */
    evalExpression(bytes: Uint8Array, variable: string, at: number): number | null;
    /** Whether a name is a registered operation. */
    has(name: string): boolean;
    /** The infix arity of a registered op (for the host to size a rule), or 0. */
    arityOf(name: string): number;
    /** Whether an op acts on an EXPRESSION (a function) rather than plain numbers
     *  — declared by the op itself at registration (the `expression` trait), so
     *  there is no side table of names here. */
    isExpressionOp(name: string): boolean;
    /** Scan a byte span for operand (numeric) and operator (symbolic) spans.  A
     *  pure, deterministic left-to-right lexer: at each position take a numeral if
     *  one starts there, else the longest symbolic operator form, else skip one
     *  byte.  Numerals and operator symbols are disjoint character classes, so the
     *  two never overlap. */
    scan(bytes: Uint8Array): {
        operands: OperandSpan[];
        operators: OperatorSpan[];
    };
    private matchSymbolic;
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
    recogniseValue(bytes: Uint8Array): Value;
    /** Split a CONTAINER's interior into its element values — top-level (bracket-
     *  depth aware) spans divided by separator RUNS (maximal runs of {@link
     *  isSepByte}).  The brackets are the explicit delimiter, so the divider's
     *  spelling is not privileged (`[1,2,3]`, `[1, 2, 3]`, `[1 2 3]` are the same
     *  list).  Each element is recognised in turn, so a nested `[ … ]` element
     *  recurses and a symbol element stays opaque.  An empty interior is `[]`. */
    private recogniseContainer;
    /** Recognise a bare SEQUENCE — ≥2 numeric operands separated by a consistent
     *  connective, with no leftover material at the edges — or null when the span
     *  is not such a sequence.  The operands are exactly the ones {@link scan}
     *  finds; the bytes between consecutive operands are the separator, which need
     *  only be the SAME throughout (a space, a comma, " and ", …) — its spelling is
     *  not constrained, so no separator is privileged. */
    private recogniseSequence;
    /** Apply an op to operand values, with the given pre-resolved resonance.
     *  Returns the result value, or null if the op is unknown or the computation
     *  throws (e.g. a symbol fed to arithmetic) — the caller treats null as "this
     *  rule does not fire", never as a wrong answer. */
    apply(name: string, operands: Value[], resonance?: ResonanceSync): Value | null;
    /** The expression evaluator handed to op contexts, bound to the cached {@link
     *  grammar}: the numerical layer's integrand is evaluated by a recursive
     *  application of the same derived-from-nand arithmetic. */
    private makeEvalExpr;
    /** Decode operand byte spans, apply `name`, and encode the result — the pure
     *  computation the graph rule materialises into an output span.  Returns null
     *  on any failure (unknown op, undecodable operand, thrown computation), so a
     *  rule that cannot compute simply does not fire.  The result bytes are
     *  canonical (see {@link decimalCodec}), so two derivations of the same value
     *  agree byte-for-byte — required for the search's chart memoization. */
    applyBytes(name: string, operandBytes: Uint8Array[], resonance?: ResonanceSync): Uint8Array | null;
    /** Apply `name` to operand VALUES (a scalar, or an `nd` recognised by {@link
     *  recogniseValue}), and encode the result canonically.  This is the entry
     *  point for computation over STRUCTURE: the scalar kernel and the nd kernel
     *  both consume Values, so once a span is recognised the computation is the
     *  same whether the operand came in as a number or a list.  Returns null on any
     *  failure (unknown op, thrown computation), the same "this rule does not fire"
     *  contract as {@link applyBytes}. */
    applyValues(name: string, operands: Value[], resonance?: ResonanceSync): Uint8Array | null;
    /** Like {@link applyBytes}, but `asSymbol(idx)` marks operand positions that
     *  must be kept as an opaque SYMBOL (not parsed as a number) — the convention
     *  the numerical layer needs, where operand 0 is an EXPRESSION (a function's
     *  bytes) the kernel samples via the expression evaluator, not a numeral. */
    applyBytesTyped(name: string, operandBytes: Uint8Array[], asSymbol: (idx: number) => boolean, resonance?: ResonanceSync): Uint8Array | null;
}
