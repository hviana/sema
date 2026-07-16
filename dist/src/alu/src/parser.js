// parser.ts — the ALU's query parser: recognise and evaluate every computation
// a raw byte query invokes.
//
// This is the intelligence layered over the Alu facade, and the ONLY module
// that reaches outside the kernel — through one narrow port, {@link AluHost}.
// The host (SEMA's Mind, or nothing) supplies exactly the two things bytes
// alone cannot answer:
//
//   • MEANING (resonance)  — which operation an opaque span names, and what the
//     resonant opposite of a symbol is.  Both are async (they hit the host's
//     gist/halo index) and both are pre-resolved here, before any synchronous
//     computation — the same hoisting discipline the host's search applies to
//     concept hops and connectors.
//   • GEOMETRY (segmentation) — where coherent runs begin and end.  The parser
//     never decides for itself whether the bytes between two tokens are "just a
//     separator": it asks the host's geometric segmenter (the same one the
//     perception tree uses), so what counts as spacing is a property of the
//     learnt alphabet space, not a hardcoded character class.  `reach` bounds
//     how far an operator may look for its operand — the host's own grouping
//     capacity, so "not … 4" across prose stays silent while "not 4" fires.
//
// Everything else — what a numeral is, which symbols are operators, how infix
// binds, which ops act on expressions — is read off the operation registry via
// the facade.  The parser therefore has NO vocabulary of its own: extend the
// registry and the parser understands the new notation; teach the host's
// resonance space and it understands new spellings of the old one.
//
// The parser LEXES the query once into a single ascending TOKEN stream —
// numeric OPERANDS and symbolic OPERATORS from the facade's scanner, and the
// unclaimed runs between them as TERMS — and every recogniser reads that one
// stream.  Tokens are disjoint and cover every non-spacing byte, so the gap
// between two consecutive tokens is pure spacing by construction.  What it finds (independent of any
// content-defined chunking, so a number a chunker would split is read whole):
//
//   1. INFIX ARITHMETIC RUNS — maximal alternations of numeric operands and
//      symbolic operators ("2+3*4", "3 + 3"), evaluated wholesale through the
//      registry-derived expression grammar, so chaining and precedence are a
//      recursive application of the same kernel.
//   2. OPERATIONS NAMED BY MEANING — a term (word, glyph, image/audio fragment)
//      that names an operation literally or by resonance, applied to a
//      following operand ("opposite large" → "small"), or, for the numerical
//      layer, to a following EXPRESSION ("derivative of x^2 at 3").
import { prefetchOpposites, prefetchResonance } from "./resonance.js";
import { NO_RESONANCE } from "./operation.js";
import { int, real, symbol, symbolSpans } from "./value.js";
import { nonSpaceRuns } from "./text.js";
import { bytesEqual, latin1 } from "../../bytes.js";
/** A host that knows nothing beyond structure: no resonance, whitespace-run
 *  segmentation, unbounded reach.  This is what "the ALU runs fully decoupled"
 *  means — the parser still reads literal notation, and only the meaning-based
 *  paths stay silent. */
export const STRUCTURAL_HOST = {
  meaningOf: async () => null,
  continuation: async () => null,
  segment: (bytes) => nonSpaceRuns(bytes),
  reach: Number.POSITIVE_INFINITY,
};
export class QueryParser {
  alu;
  host;
  /** The host's generic capabilities, specialised once into the {@link
   *  AluResonance} the prefetch bridges consume — the ONE place the ALU gives
   *  the host's neutral answers their computational reading: op recognition is
   *  meaningOf over the ALU's own concept anchors, and the polymorphic INVERSE
   *  of a symbol is the corpus's grounded continuation of it (a learnt
   *  opposition relation leads from a form to its opposite; the host never
   *  needs to know that is what it grounded). */
  resonance;
  /** Session memo of a term's meaning-based op reading, keyed by its bytes.
   *  `meaningOf` is a full river fold of the span — measured at ~a third of
   *  a plain-English respond's latency, paid per WORD per query — and it is
   *  a pure function of the bytes (perception is pure; the concept anchors
   *  are fixed for the Alu's lifetime), so the reading never changes.
   *  Bounded: cleared wholesale when full (words recur; a rare clear only
   *  re-pays folds, never changes a reading). */
  meaningMemo = new Map();
  static MEANING_MEMO_MAX = 4096;
  constructor(alu, host = STRUCTURAL_HOST) {
    this.alu = alu;
    this.host = host;
    this.resonance = {
      recogniseOp: (bytes) => host.meaningOf(bytes, alu.conceptAnchors()),
      opposite: (bytes) => host.continuation(bytes),
    };
  }
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
  async parse(query) {
    const tokens = this.lex(query);
    const runs = this.arithmeticRuns(query, tokens).map(([i, j]) => ({
      i,
      j,
      bytes: this.evalRun(query.subarray(i, j)),
    }));
    const spans = runs.filter((r) => r.bytes !== null);
    let stream = compose(tokens, runs);
    const readings = new Map();
    for (;;) {
      const fired = await this.operations(query, stream, readings);
      if (fired.length === 0) {
        break;
      }
      spans.push(...fired);
      stream = compose(stream, fired);
    }
    return authoritative(dedup(spans));
  }
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
  async compute(name, operandBytes, asSymbol = () => false) {
    const operands = [];
    const spans = [];
    for (let i = 0; i < operandBytes.length; i++) {
      const v = asSymbol(i)
        ? symbol(operandBytes[i])
        : this.alu.recogniseValue(operandBytes[i]);
      operands.push(v);
      symbolSpans(v, spans);
    }
    const resonance = await prefetchResonance(this.resonance, spans);
    return this.alu.applyValues(name, operands, resonance);
  }
  // ── the lex: one reading of the query every recogniser shares ────────────
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
  lex(query) {
    const { operands, operators } = this.alu.scan(query);
    const claimed = [
      ...operands.map((o) => ({ i: o.i, j: o.j, kind: "operand" })),
      ...operators.map((o) => ({ i: o.i, j: o.j, kind: "operator" })),
    ].sort((a, b) => a.i - b.i);
    const tokens = [];
    let p = 0;
    for (const c of [...claimed, END]) {
      for (const t of nonSpaceRuns(query, p, Math.min(c.i, query.length))) {
        tokens.push({ ...t, kind: "term" });
      }
      if (c !== END) {
        tokens.push(c);
      }
      p = c.j;
    }
    return tokens;
  }
  // ── (1) infix arithmetic ──────────────────────────────────────────────────
  /** The maximal infix-arithmetic runs in the query: an alternation of numeric
   *  operands and SYMBOLIC operators (e.g. "2+3*4"), returned as [start, end)
   *  ranges that begin and end on an operand.
   *
   *  Consecutive tokens may be SEPARATED — "3 + 3" is the same run as "3+3".
   *  The gap between two tokens is a bridgeable separator exactly when the
   *  host's geometric segmenter reads it as at most one coherent run — the
   *  same judgement the perception tree makes about spacing — so no character
   *  is privileged as "the" separator. */
  arithmeticRuns(query, tokens) {
    const bridged = (from, to) =>
      from >= to || this.host.segment(query.subarray(from, to)).length <= 1;
    const runs = [];
    let k = 0;
    while (k < tokens.length) {
      if (tokens[k].kind !== "operand") {
        k++;
        continue;
      }
      let end = k;
      while (
        end + 1 < tokens.length &&
        tokens[end + 1].kind !== "term" && // a term breaks the notation
        tokens[end + 1].kind !== tokens[end].kind && // alternates
        bridged(tokens[end].j, tokens[end + 1].i) // pure-spacing gap coheres
      ) {
        end++;
      }
      while (end > k && tokens[end].kind === "operator") {
        end--; // end on operand
      }
      if (end > k) {
        runs.push([tokens[k].i, tokens[end].j]);
      }
      k = end + 1;
    }
    return runs;
  }
  /** Evaluate an infix-arithmetic run to its canonical result bytes, through
   *  the kernel's recursive expression evaluator, or null if it does not
   *  evaluate.  A whole result stays an exact int; otherwise the canonical
   *  rounded real — deterministic, so the search's chart memoises identical
   *  results identically. */
  evalRun(runBytes) {
    const x = this.alu.evalExpression(runBytes, "", 0);
    if (x === null || !Number.isFinite(x)) {
      return null;
    }
    return this.alu.codec.encode(
      Number.isInteger(x) ? int(BigInt(x)) : real(x),
    );
  }
  // ── (2) operations named by NAME or MEANING ───────────────────────────────
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
  async operations(query, tokens, readings) {
    const terms = tokens.filter((t) => t.kind === "term");
    const anchors = this.alu.conceptAnchors();
    await Promise.all(terms.map(async (term) => {
      if (readings.has(term)) {
        return;
      }
      const span = query.subarray(term.i, term.j);
      const key = latin1(span);
      const literal = this.alu.lookupOperator(key);
      if (literal.length > 0) {
        readings.set(term, literal);
        return;
      }
      const hit = this.meaningMemo.get(key);
      if (hit !== undefined) {
        readings.set(term, hit);
        return;
      }
      const m = await this.host.meaningOf(span, anchors);
      const meant = m ? [m] : [];
      if (this.meaningMemo.size >= QueryParser.MEANING_MEMO_MAX) {
        this.meaningMemo.clear();
      }
      this.meaningMemo.set(key, meant);
      readings.set(term, meant);
    }));
    const out = [];
    for (const term of terms) {
      for (const name of readings.get(term)) {
        const result = this.alu.isExpressionOp(name)
          ? this.applyToExpression(query, name, term, tokens)
          : await this.applyToStream(query, name, term, tokens);
        if (result) {
          out.push(result);
          break; // the first claimant that fires owns the term
        }
      }
    }
    return out;
  }
  /** Apply a NUMERICAL-LAYER op — one whose first operand is an EXPRESSION (a
   *  function), declared by the op's own `expression` trait.  The registry's
   *  arity says how many trailing numeric operands are its points/bounds
   *  (arity − 1); the bytes between the operator and those points — with
   *  non-math filler stripped by {@link cleanExprText} — are the expression,
   *  evaluated by a recursive application of the kernel. */
  applyToExpression(query, name, term, tokens) {
    const operands = tokens.filter((t) =>
      t.kind === "operand" && t.i >= term.j
    );
    const arity = this.alu.arityOf(name);
    const points = arity - 1;
    const exprEnd = operands.length > points
      ? operands[operands.length - points].i
      : operands[0]?.i ?? query.length;
    const cleaned = this.cleanExprText(latin1(query.subarray(term.j, exprEnd)));
    if (cleaned.length === 0) {
      return null;
    }
    const args = [UTF8.encode(cleaned)];
    for (const o of operands.slice(-points)) {
      args.push(o.value ?? query.subarray(o.i, o.j));
    }
    if (args.length !== arity) {
      return null; // under-supplied → decline
    }
    const bytes = this.alu.applyBytesTyped(name, args, (idx) => idx === 0);
    if (bytes === null) {
      return null;
    }
    return { i: term.i, j: operands[operands.length - 1].j, bytes };
  }
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
  async applyToStream(query, name, term, tokens) {
    const arity = this.alu.arityOf(name);
    if (arity === 0) {
      return null; // a constant consumes nothing → not a rule
    }
    const picked = [];
    let from = term.j;
    for (const tok of tokens) {
      if (tok.i < term.j || tok.kind === "operator") {
        continue;
      }
      if (picked.length === arity) {
        break;
      }
      if (tok.i - from > this.host.reach) {
        break; // next token too far
      }
      picked.push(tok);
      from = tok.j;
    }
    // WORD-INFIX: borrow the numeric operand just before the operator.
    let start = term.i;
    if (picked.length === arity - 1) {
      let before;
      for (const t of tokens) {
        if (t.j > term.i) {
          break;
        }
        if (t.kind === "operand") {
          before = t;
        }
      }
      if (before && term.i - before.j <= this.host.reach) {
        picked.unshift(before);
        start = before.i;
      }
    }
    if (picked.length !== arity) {
      return null; // under-supplied → decline
    }
    const args = picked.map((t) => t.value ?? query.subarray(t.i, t.j));
    const symbols = picked.flatMap((t, k) =>
      t.kind === "term" ? [args[k]] : []
    );
    const resonance = symbols.length > 0
      ? await prefetchOpposites(this.resonance, symbols)
      : NO_RESONANCE;
    const bytes = this.alu.applyBytes(name, args, resonance);
    if (bytes === null) {
      return null;
    }
    if (
      symbols.length === args.length && args.some((a) => bytesEqual(bytes, a))
    ) {
      return null; // an all-symbol result echoing an operand grounded nothing
    }
    return { i: start, j: picked[picked.length - 1].j, bytes };
  }
  /** Strip non-math filler tokens from a raw expression string — keep numbers,
   *  operators, parens, names the GRAMMAR resolves (unary functions,
   *  registered constants), and single-RUNE identifiers.  The rune rule is the
   *  mirror of {@link "./alu.js".Alu.conceptAnchors}' compound rule: a compound
   *  name carries distributional meaning (it is either a resolvable operation
   *  or filler — "of", "at", "the"), while a bare atom carries none and can
   *  only be the expression's free variable.  Dropping the filler leaves the
   *  evaluator clean notation. */
  cleanExprText(raw) {
    const g = this.alu.grammar;
    const toks = g.tokenize(raw);
    if (!toks) {
      return ""; // not a tokenizable expression — stay silent
    }
    const keep = [];
    for (const t of toks) {
      if (
        t.kind !== "name" ||
        g.isFunction(t.text) || g.isConstant(t.text) || t.text.length === 1
      ) {
        keep.push(t.text);
      }
    }
    return keep.join("");
  }
}
const UTF8 = new TextEncoder();
/** Sentinel closing the lex walk (never emitted). */
const END = { i: Infinity, j: Infinity, kind: "operator" };
/** Collapse each EVALUATED arithmetic run into one virtual OPERAND token
 *  carrying the run's result — the composed stream named operations consume,
 *  so an infix sub-expression is a single finished operand ("sum 1*3 4"
 *  applies add(3, 4)) exactly as the grammar nests expressions.  A run that
 *  did not evaluate keeps its original tokens.  One ascending merge walk. */
function compose(tokens, results) {
  if (results.length === 0) {
    return tokens;
  }
  const sorted = [...results].sort((a, b) => a.i - b.i);
  const out = [];
  let k = 0;
  for (const r of sorted) {
    while (k < tokens.length && tokens[k].i < r.i) {
      out.push(tokens[k++]);
    }
    const inside = [];
    while (k < tokens.length && tokens[k].j <= r.j) {
      inside.push(tokens[k++]);
    }
    if (r.bytes !== null) {
      out.push({ i: r.i, j: r.j, kind: "operand", value: r.bytes });
    } else {
      out.push(...inside);
    }
  }
  out.push(...tokens.slice(k));
  return out;
}
/** The AUTHORITY law: a span strictly contained in a larger computed span is
 *  that computation's material — the outer computation consumed it — so only
 *  the outermost readings survive.  Overlapping-but-not-nested spans are
 *  rival readings the host's search may still weigh against each other. */
function authoritative(spans) {
  return spans.filter((s) =>
    !spans.some((o) =>
      o !== s && o.i <= s.i && s.j <= o.j && o.j - o.i > s.j - s.i
    )
  );
}
/** Keep the first occurrence of each (span, bytes) result. */
function dedup(spans) {
  const seen = new Set();
  return spans.filter((s) => {
    const key = s.i + "," + s.j + "," + latin1(s.bytes);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
