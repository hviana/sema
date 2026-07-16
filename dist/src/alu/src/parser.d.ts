import type { Alu } from "./alu.js";
import { type ConceptAnchor } from "./resonance.js";
/** A half-open byte range. */
export interface Span {
    i: number;
    j: number;
}
/** A computation the parser recognised and evaluated: the query span [i, j) it
 *  is authoritative for, and the canonical result bytes. */
export interface ComputedSpan extends Span {
    bytes: Uint8Array;
}
/** The port through which the parser reaches its host.  This interface is the
 *  ENTIRE coupling surface between the ALU and any host: the ALU imports
 *  nothing from a mind or store, and every member is a GENERIC capability the
 *  host already has — nothing here mentions operations, vocabularies, or any
 *  ALU notion, so the host holds no ALU-specific logic either.
 *
 *  MEANING (resonance):
 *   • meaningOf — which of the given labelled forms does a span MEAN?  The ALU
 *     supplies the anchors (its own concept vocabulary); the host only answers
 *     nearness in its meaning space, above its own threshold, or null.  This
 *     is what recognises an operation the bytes do not literally spell — an
 *     "∫" drawn, a "plus" spoken — in any modality.
 *   • continuation — the grounded form the host's corpus continues a form to
 *     (the same grounding its recall uses), or null.  The ALU is the one that
 *     READS this as the resonant opposite: it asks for the continuation of an
 *     operand under an inverse, and a corpus that learnt "opposite of large →
 *     small" grounds exactly that.  The host stays neutral — it only ever
 *     answers "where does this form lead?".
 *
 *  GEOMETRY (perception):
 *   • segment — coherent runs by the host's own geometric perception.  The
 *     parser uses this to ask "is this gap pure separator?" (one segment or
 *     none) — never a character class of its own.
 *   • reach — how far (in bytes) an operator may look for its operand: the
 *     host's own grouping capacity, so adjacency is judged by the same
 *     geometry that groups the host's perception. */
export interface AluHost {
    meaningOf(bytes: Uint8Array, anchors: ReadonlyArray<ConceptAnchor>): Promise<string | null>;
    continuation(bytes: Uint8Array): Promise<Uint8Array | null>;
    segment(bytes: Uint8Array): Span[];
    reach: number;
}
/** A host that knows nothing beyond structure: no resonance, whitespace-run
 *  segmentation, unbounded reach.  This is what "the ALU runs fully decoupled"
 *  means — the parser still reads literal notation, and only the meaning-based
 *  paths stay silent. */
export declare const STRUCTURAL_HOST: AluHost;
export declare class QueryParser {
    private readonly alu;
    private readonly host;
    /** The host's generic capabilities, specialised once into the {@link
     *  AluResonance} the prefetch bridges consume — the ONE place the ALU gives
     *  the host's neutral answers their computational reading: op recognition is
     *  meaningOf over the ALU's own concept anchors, and the polymorphic INVERSE
     *  of a symbol is the corpus's grounded continuation of it (a learnt
     *  opposition relation leads from a form to its opposite; the host never
     *  needs to know that is what it grounded). */
    private readonly resonance;
    /** Session memo of a term's meaning-based op reading, keyed by its bytes.
     *  `meaningOf` is a full river fold of the span — measured at ~a third of
     *  a plain-English respond's latency, paid per WORD per query — and it is
     *  a pure function of the bytes (perception is pure; the concept anchors
     *  are fixed for the Alu's lifetime), so the reading never changes.
     *  Bounded: cleared wholesale when full (words recur; a rare clear only
     *  re-pays folds, never changes a reading). */
    private readonly meaningMemo;
    private static readonly MEANING_MEMO_MAX;
    constructor(alu: Alu, host?: AluHost);
    /** Recognise and evaluate every computation `query` invokes.  All async
     *  resonance is resolved in here, so the caller receives finished spans it
     *  can fold synchronously into its search.  Results are deduplicated; a span
     *  that fails to compute is simply absent (the "rule does not fire"
     *  contract).
     *
     *  The pipeline is one composition ladder, iterated to a FIXPOINT:
     *
     *   1. infix arithmetic RUNS are found and evaluated through the
     *      registry-derived grammar;
     *   2. every computed span — a run, or a fired operation — is COLLAPSED
     *      into a single virtual operand, so the next round consumes it as one
     *      finished value: "sum 1*3 4" is add(3, 4), and "sqrt sum 9 16" is
     *      sqrt(25) — nesting by iteration, exactly as the grammar nests
     *      expressions, with no recursion machinery of its own;
     *   3. rounds repeat while operations still fire (each round consumes at
     *      least one term, so the ladder is bounded by the term count).
     *
     *  One AUTHORITY law then reconciles the readings: a span strictly
     *  contained in a larger computed span is that computation's MATERIAL (the
     *  "2-4" inside a solve's "x^2-4", the inner sum under a sqrt), not a rival
     *  result — the same rule by which the host's search lets a computed span
     *  override colliding learned facts. */
    parse(query: Uint8Array): Promise<ComputedSpan[]>;
    /** Apply an ALU operation to operand byte spans, with the host's resonance
     *  wired in — the entry point for computation over n-dimensional values.
     *
     *  Unlike the in-query arithmetic rule (which hands the facade scalar operand
     *  bytes), this recognises each operand's STRUCTURE into a Value first and
     *  runs the kernel on the finished Values, with the full resonance snapshot
     *  pre-resolved — because an nd computation needs meaning in two places the
     *  bare facade cannot reach on its own:
     *
     *   • the polymorphic INVERSE inside a broadcast — `inverse [large, 3, tall]`
     *     lifts element-wise (operation.ts), and each symbol element's opposite
     *     is a resonant lookup, grounded in the host's corpus exactly as a scalar
     *     inverse is;
     *   • the FUNCTION ARGUMENT of a higher-order op — `reduce(xs, ‹+›)`,
     *     `map(xs, ‹negate›)`: the operator value is resolved by
     *     {@link "./operation.js".OpContext.resolveOp}, which falls through to
     *     resonance when the bytes are not a literal surface form.
     *
     *  Both are async, so every SYMBOL span reachable in the operands (recursing
     *  through nd nesting, see {@link "./value.js".symbolSpans}) is resolved ONCE
     *  up front into a synchronous snapshot, and the synchronous kernel computes
     *  against it.  Returns null when the op is unknown or the computation
     *  declines — the "this rule does not fire" contract.
     *
     *  `asSymbol(idx)` keeps an operand opaque (not read as structure or a
     *  number) — the numerical-layer convention where operand 0 is an
     *  expression's bytes; it defaults to "recognise everything", which is what
     *  an nd computation wants. */
    compute(name: string, operandBytes: Uint8Array[], asSymbol?: (idx: number) => boolean): Promise<Uint8Array | null>;
    /** Lex the query ONCE into a single ascending token stream: the facade's
     *  scanner claims numeric OPERANDS and symbolic OPERATORS, and every maximal
     *  unclaimed run between spacing bytes is a TERM — a word, glyph, or opaque
     *  fragment that may name an operation.  Terms are deliberately bounded by
     *  the spacing floor, not the host's geometric segmentation: perception may
     *  cut mid-word (its segments are grouping capacity, not word boundaries),
     *  while an operation NAME is a notation-level token.  Geometry still
     *  governs what happens BETWEEN tokens (gap bridging, operand reach).
     *
     *  Tokens are disjoint, ascending, and cover every non-spacing byte — so
     *  the gap between consecutive tokens is pure spacing BY CONSTRUCTION, a
     *  structural fact the run recogniser leans on. */
    private lex;
    /** The maximal infix-arithmetic runs in the query: an alternation of numeric
     *  operands and SYMBOLIC operators (e.g. "2+3*4"), returned as [start, end)
     *  ranges that begin and end on an operand.
     *
     *  Consecutive tokens may be SEPARATED — "3 + 3" is the same run as "3+3".
     *  The gap between two tokens is a bridgeable separator exactly when the
     *  host's geometric segmenter reads it as at most one coherent run — the
     *  same judgement the perception tree makes about spacing — so no character
     *  is privileged as "the" separator. */
    private arithmeticRuns;
    /** Evaluate an infix-arithmetic run to its canonical result bytes, through
     *  the kernel's recursive expression evaluator, or null if it does not
     *  evaluate.  A whole result stays an exact int; otherwise the canonical
     *  rounded real — deterministic, so the search's chart memoises identical
     *  results identically. */
    private evalRun;
    /** Recognise and apply the operations the query's TERMS name — the generic,
     *  multimodal path.  A term may name an operation literally (its bytes are a
     *  registered surface form — no resonance cost) or by RESONANCE (its gist
     *  lands on an operation's concept, any modality).
     *
     *  Recognition PROPOSES, application DISPOSES: a surface form may be shared
     *  by several operations ("zero" is both the constant and solve's
     *  root-finding), so every literal claimant is kept, in registration order,
     *  and the first whose application actually fires wins — disambiguation by
     *  what the query supplies, not by a precedence table.  Recognition runs
     *  CONCURRENTLY — each term's reading is independent — and is memoised in
     *  `readings` across fixpoint rounds (a surviving term is the same token
     *  object), so each term resonates at most once per parse.  Application is
     *  then ordered and deterministic: an EXPRESSION op takes the function that
     *  follows it ({@link applyToExpression}), any other op takes its arity's
     *  worth of operands from the stream ({@link applyToStream}).  Both read
     *  the same composed stream — an expression's TEXT comes from the raw query
     *  bytes by position, so composition never disturbs it, while a composed
     *  operand serves as a finished point/bound or argument. */
    private operations;
    /** Apply a NUMERICAL-LAYER op — one whose first operand is an EXPRESSION (a
     *  function), declared by the op's own `expression` trait.  The registry's
     *  arity says how many trailing numeric operands are its points/bounds
     *  (arity − 1); the bytes between the operator and those points — with
     *  non-math filler stripped by {@link cleanExprText} — are the expression,
     *  evaluated by a recursive application of the kernel. */
    private applyToExpression;
    /** Apply any other op to the OPERAND STREAM after the operator: the numeric
     *  operands and symbol terms that follow it, merged nearest-first, each
     *  within the host's reach of the token before it — so "sqrt 144",
     *  "gcd 12 18", and "opposite large" are one rule, and the NEAREST token is
     *  the operand ("opposite large 5" inverts "large", not the 5).
     *
     *  Two structural refinements make this read like notation rather than a
     *  special case:
     *
     *   • WORD-INFIX — an under-supplied operator borrows the numeric operand
     *     immediately BEFORE it (within reach), so "7 minus 2" applies
     *     subtract(7, 2) exactly as "7 - 2" would: a synonym is notation too.
     *   • GROUNDED-ONLY SYMBOLS — when every operand is a symbol, a result that
     *     merely echoes an operand means resonance grounded nothing (an inverse
     *     with no learnt opposition), and the rule stays silent rather than
     *     invent meaning.  Numeric identities ("max 3 7" → "7") are real
     *     results and pass.
     *
     *  A NULLARY op never fires from a bare term: a computation must consume
     *  something, or any prose word that happens to name a constant would be
     *  rewritten.  Symbol operands get their resonance (the opposite each may
     *  need) pre-resolved in one prefetch. */
    private applyToStream;
    /** Strip non-math filler tokens from a raw expression string — keep numbers,
     *  operators, parens, names the GRAMMAR resolves (unary functions,
     *  registered constants), and single-RUNE identifiers.  The rune rule is the
     *  mirror of {@link "./alu.js".Alu.conceptAnchors}' compound rule: a compound
     *  name carries distributional meaning (it is either a resolvable operation
     *  or filler — "of", "at", "the"), while a bare atom carries none and can
     *  only be the expression's free variable.  Dropping the filler leaves the
     *  evaluator clean notation. */
    private cleanExprText;
}
