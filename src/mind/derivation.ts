// derivation.ts — the derivation unit and the one closure law it is governed by.
//
// THE LAW, in the quantities this engine already has:
//
//   A derivation is CLOSED for a query when the structure it built accounts for
//   the query's REMAINDER under the engine's own identity and admission rules,
//   and every step is priced on the one ladder.
//
// It is written ONCE, here, because that is where a rule has to live — in the
// behaviour of the code and at the sites it governs (this repository's own
// history records the same conclusion: a law written as a document was deleted,
// and the reason given was that the rule belongs in the code).  The tiers that
// can evaluate it ask it; the tiers that cannot say so and are named below.
//
// WHAT THE LAW READS, AND WHAT IT NEVER READS.  It reads the state and the
// proposed continuation, and nothing else: no mechanism, no store, no context,
// no producer.  Its whole purpose is that a product may be consumed by ANY
// transition the law admits, so that composition is the next transition of the
// same state rather than an operation with its own dispatch.
//
// THE TWO WITNESSES ARE THE LAYER'S.  `contains` (does the transition's
// structure hold the product?  a node in its tree, or one contiguous byte run)
// and `moves` (does it reach structure this derivation has not consumed?) are
// resolved by the layer that knows the structure, and handed in.  The law never
// re-derives them, and never probes the store to ask: a predicate that would
// scan the store for every candidate would raise the cost of a step, which is
// why `traverse.ts`'s own admission predicate is LENT to the chart rather than
// called through it.
//
// THE UNIT: product, accounted, remainder, cost, and the two declarations a
// producer makes about its own result (`fixed`, `used`).  No identity field
// (the product is content-addressed, so its identity is `resolve(product)` — a
// pure function, and a cache is not a field); no structure field (that is what
// identity is computed over); no frontier field (a continuation is computed by
// the layer that can offer one); no producer field (docs/architecture's own
// contract: `provenance` is observability and nothing compares it); and no
// count of any kind — no depth, hop, visited, once or cap.
//
// FIVE QUESTIONS, FIVE OWNERS — and no two of them may be answered by one fact:
//
//   ENGAGEMENT   does the step touch the question's material?   `carries`: admits,
//                                                              consumes nothing
//   PROGRESS     does it reach structure not yet consumed?      `reaches`: admits
//                                                              AND consumes what the
//                                                              step's window carries
//   ACCOUNTING   what does the step price?                      the span, into
//                                                              `accounted`
//   CLOSURE      is the question's material all accounted for?  `closed` — the law
//   TERMINATION  why does the walk stop at all?                 the LAYER: its offer
//                                                              ends, or the law refuses
//                                                              one; never a depth
//   CYCLES       why is a loop not a walk?                      the LAYER's consumed
//                                                              set; the law only sees
//                                                              that a cycle never
//                                                              closes it (test/138.1)
//
// A step can progress without closing the derivation; a derivation can be closed
// with no further transition (the grounding built it closed); and neither of those
// is termination.
//
// THE REMAINDER TRAVELS UNCHANGED, and this was measured, not assumed: letting
// `advance` drain the witness made a step that engaged the gap CLOSE the
// derivation, the next step was admitted unconstrained, and test/110's
// three-link chain drifted one hop past its satisfying answer.  A step ENGAGES
// the question's leftover; it does not consume it.  Termination is therefore not
// the law's: it is the walker's cycle protection over a finite graph.
//
// TWO LIMITS ARE PROVED AND LEFT OUT (test/136 pins both, with the measurements):
//   1. the CHART cannot evaluate accounting — its interface has no parameter for
//      it, and carrying it per chart item was measured and rejected.  The chart
//      evaluates the same law read off an item: identity is the item's `key`,
//      continuation is the rule's existence, progress is the frontier advancing,
//      closure is the goal test, and `fix` is `fixed`.
//   2. closure by the QUERY'S POSITION in the graph is not a term of the unit:
//      `reason`'s echo guards stop a derivation although the remainder is not
//      empty, and recall's reverse-recall tiers close it with an empty
//      accounting.  That is a fact about the asker's material in the store,
//      available only to the layer holding it — recorded as a limit, not patched
//      into the unit as a foreign key.
//
// LAYERING: this module imports `../bytes.js` only.  It sits BELOW
// `graph-search.ts`, `match.ts`, `rationale.ts` and `pipeline.ts`, so each may
// ask it and none may be asked by it.  The span algebra lives here too: it is
// the law's vocabulary — gap arithmetic over the asker's bytes — and not the
// tracer's, which is why it moved out of `rationale.ts`.

import { indexOf } from "../bytes.js";

/** A half-open `[start, end)` span of the asker's own bytes. */
export type Span = readonly [number, number];

// ── The span algebra: the law's vocabulary ──────────────────────────────────

/** The BYTE COUNT of a span list — what the currency calls `unaccounted` in
 *  `weight = moves + PASS·unaccounted`.  ONE definition: this was four copies of
 *  the same `reduce` before the architecture audit collapsed them. */
export function unaccountedBytes(spans: ReadonlyArray<Span>): number {
  let total = 0;
  for (const [a, b] of spans) total += b - a;
  return total;
}

/** The `[start, end)` gaps of `[0, queryLen)` NOT covered by `accounted` — the
 *  union-of-spans reading the ladder prices at PASS per byte, and the raw
 *  material every closure decision measures.  Clipped to the question, sorted
 *  and merged, so two overlapping spans account for their union once. */
export function unexplainedSpans(
  queryLen: number,
  accounted: ReadonlyArray<Span>,
): Array<[number, number]> {
  const sorted = accounted
    .map(([s, e]) =>
      [Math.max(0, s), Math.min(queryLen, e)] as [number, number]
    )
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const gaps: Array<[number, number]> = [];
  let reach = 0;
  for (const [s, e] of sorted) {
    if (s > reach) gaps.push([reach, s]);
    if (e > reach) reach = e;
  }
  if (reach < queryLen) gaps.push([reach, queryLen]);
  return gaps;
}

/** THE REMAINDER: what no step has accounted for, with every span below one
 *  river-fold quantum dropped.  `W` is the mind's own line between bridging
 *  punctuation and a substantive phrase — the same floor `liftedScaffolding`
 *  and the honesty-density bar use — so a remainder under it licenses nothing
 *  and blocks nothing.  This is the law's measure. */
export function remainderOf(
  queryLen: number,
  explained: ReadonlyArray<Span>,
  W: number,
): Array<[number, number]> {
  return unexplainedSpans(queryLen, explained).filter(([a, b]) => b - a >= W);
}

/** A WITNESS — what a transition carries, in one reading: the SPAN it accounts
 *  for, and the WINDOW of the question the product itself holds.  The window is
 *  present only when the product holds question material, and it is the ONLY
 *  thing the question's remainder may be consumed by. */
export interface Witness {
  readonly span: Span;
  readonly window?: Span;
}

/** The window of `span` that `product` holds, or null: the ONE reading of
 *  coverage — used by {@link carries}, by the move branch, and by the GROUNDING
 *  when it decides what its answer has actually paid for. */
export function windowOf(
  span: Span,
  product: Uint8Array,
  query: Uint8Array,
  W: number,
): Span | null {
  const [a, b] = span;
  for (let i = a; i + W <= b; i++) {
    if (indexOf(product, query.subarray(i, i + W), 0) >= 0) return [i, i + W];
  }
  return null;
}

/** PROGRESS, by coverage: the first member of `remainder` that `product` carries
 *  a whole quantum of, or null when it carries none.  The window is taken from
 *  `query`, the asker's own bytes, so the test is "this product restates a
 *  quantum of what was left unaccounted", never a similarity score.
 *
 *  One witness per step, deterministically the FIRST in remainder order: the
 *  measure stays a single member of a finite list, which is what makes the walk
 *  reviewable — and, because the remainder is not drained, it is the walker's
 *  cycle protection (not this) that terminates a chain. */
export function carries(
  remainder: ReadonlyArray<Span>,
  product: Uint8Array,
  query: Uint8Array,
  W: number,
): Array<Witness> | null {
  for (const span of remainder) {
    const window = windowOf(span, product, query, W);
    if (window !== null) return [{ span, window }];
  }
  return null;
}

// ── The restatement reading ─────────────────────────────────────────────────

/** Whether `bytes` RESTATES the question — says nothing the asker did not just
 *  say — and is therefore not an answer.  This is a closure condition: a
 *  derivation whose product is already the question has added nothing, and the
 *  engine asks it in five places.  ONE definition, asked everywhere, with the
 *  DIFFERENCES between those places supplied as WITNESSES by the caller — never
 *  as a mechanism or a producer.  If this function ever needs to know who
 *  produced the bytes to decide, the right conclusion is that a witness is
 *  missing, not that it should dispatch.
 *
 *  `floor` is one river-fold quantum: below it, byte overlap is chance, not
 *  evidence — the same line `identityBar`, the bridge's `attestedQ` and
 *  recognition's site floor all draw.  `0` disables the floor, which is the
 *  reading the callers that ask before any structure exists use.
 *
 *  THE THREE READINGS the callers need, and why each is a witness rather than a
 *  branch here:
 *
 *   • `proper` — a PROPER part of the question (strictly shorter).  This is the
 *     reading every tier that rejects a fragment uses.
 *   • `whole` — the EQUALITY reading: only "the answer IS the question" counts,
 *     because the caller has already handled a proper fragment elsewhere (a
 *     recall tier's own subspan tests).
 *   • `equate` — the response's own notion of "the same text" (whatever
 *     `src/canon.ts` equates: case, width, whitespace).  A caller that has one
 *     passes it; a caller that does not gets the byte-exact reading.  It is the
 *     same fallback `resolve` already makes when an exact lookup misses.
 *
 *  The LITERAL EXEMPTION is deliberately NOT here: whether a span is the site's
 *  own bytes at its own position is the CALLER's knowledge, and a caller states
 *  it by not asking (see `segRestatesQuery` in types.ts, which returns false for
 *  a literal span before reaching this). */
export function restates(
  query: Uint8Array,
  bytes: Uint8Array,
  floor = 0,
  witnesses: {
    equate?: ((b: Uint8Array) => Uint8Array) | null;
    proper?: boolean;
    whole?: boolean;
    /** THE POSITIONAL WITNESS: search from this offset, because the caller has
     *  established that only material at or after it counts.  A transcript pasted
     *  into a single response is the case that needs it — a caller's own prior
     *  answer lies LATER in the query, after the root that would restate it — and
     *  the reasoner's per-root `alreadyAnswered` guard asks exactly that question.
     *  Omitted, the search starts at 0 and the reading is the plain one. */
    from?: number;
  } = {},
): boolean {
  const equate = witnesses.equate ?? null;
  const from = witnesses.from ?? 0;
  const q = equate === null ? query : equate(query);
  const b = equate === null ? bytes : equate(bytes);
  if (b.length > q.length || b.length < floor) return false;
  if (witnesses.whole === true) {
    return b.length === q.length && indexOf(q, b, from) >= 0;
  }
  if (witnesses.proper === true && b.length === q.length) return false;
  return indexOf(q, b, from) >= 0;
}

/** Whether the query span `[from, to)` lies inside a COMPLETED ASSISTANT TURN —
 *  material the engine has already produced, so it is context rather than
 *  something the asker is asserting.  Recognition and attention still see the
 *  full transcript; what excludes these spans is the closure reading "this was
 *  already answered", and it is a closure reading rather than a budget: a window
 *  inside a prior reply is not a fresh constraint.
 *
 *  ONE definition of it.  `cursor` is the CALLER's own progress through `turns`
 *  (they are ascending and each caller scans its candidates in ascending order),
 *  so the amortised search is preserved exactly and a caller passes the same
 *  holder for a whole scan: extracting the reading must not cost the scan. */
export function insideAnsweredTurn(
  turns: ReadonlyArray<Span>,
  cursor: { at: number },
  from: number,
  to: number,
): boolean {
  while (cursor.at < turns.length && turns[cursor.at][1] <= from) cursor.at++;
  const turn = turns[cursor.at];
  return turn !== undefined && turn[0] <= from && to <= turn[1];
}

// ── The unit ────────────────────────────────────────────────────────────────

/** THE derivation state — the unit that crosses one inference.
 *
 *  Every field is read by the law or by the market's one cost ladder, and
 *  nothing else travels.  A count of steps is a consequence (the cost), and
 *  cycle protection belongs to the layer that walks a graph. */
export interface DerivationState {
  /** PRODUCT — the structure produced: what this derivation stands on. */
  readonly product: Uint8Array;
  /** ACCOUNTED — the asker's spans the producing transition priced.  A COST
   *  quantity, and the producing mechanism's own judgement of what its answer
   *  explains: cover leaves its computed spans out so the PASS-bridged bytes
   *  they account for stay charged, while a corroborated substitution DOES
   *  account for its span, because the mechanism paid a move for it. */
  readonly accounted: ReadonlyArray<Span>;
  /** REMAINDER — the asker's material no step has accounted for, each member at
   *  or above one quantum.  Empty means the derivation is CLOSED. */
  readonly remainder: ReadonlyArray<Span>;
  /** COST — position on the one ladder (`graph-search.ts`'s MICRO/STEP/CONCEPT/
   *  PASS); the market takes the lattice minimum over it. */
  readonly cost: number;
  /** FIXED — the producer SUPPLIED a fixed point: the query IS the context, so
   *  no transition may consume this state.  Declared, never inferred. */
  readonly fixed?: boolean;
  /** USED — what the product speaks for.  An EMPTY set is itself a declaration
   *  ("this answer voices nothing"); omitted means the layer must re-recognise
   *  the product to decide for itself. */
  readonly used?: ReadonlySet<number>;
}

/** A candidate continuation, as reported by the layer that knows the structure.
 *  The layer says what it has; the law decides. */
export interface Continuation {
  /** The structure the transition would make the derivation's product. */
  readonly product: Uint8Array;
  /** CONTAINS — the transition's structure holds the product: a node in its
   *  tree, or one contiguous byte run of it.  Resolved by the reporter.
   *
   *  SUFFICIENT FOR EVERY DECISION THIS CORE MAKES, and a boolean is the minimum:
   *  the law reads it ONCE, as the admission gate, and that decision is binary —
   *  may this state be consumed by this transition at all?  Every other decision
   *  is fed by other witnesses, never by this one: the product's identity is
   *  `resolve(product)`, progress is the window a move carries or the
   *  `reaches` declaration, accounting is the span.  Carrying the reporter's
   *  structure here would therefore be a dump of mechanism internals bought for
   *  nothing.  The producers make it true by construction — a continuation is
   *  built from the CURRENT product's own structure, never from a different one
   *  — and test/133 pins the refusal when a reporter declares false. */
  readonly contains: boolean;
  /** REACHES — the transition MOVES: it reaches structure this derivation has
   *  not consumed
   *  (a node outside the walker's own set).  The second species of progress: a
   *  step need not excuse itself with question material when it moves to new
   *  structure.  Resolved by the reporter, declared by the transition — never
   *  inferred from its producer. */
  readonly reaches?: boolean;
  /** What the transition accounts for, when it declares it.  A transition
   *  taken from a CLOSED state has nothing to progress on, so it is the one
   *  case that must say what it accounts for; a transition that carries the
   *  remainder declares nothing and the law's own witness is used. */
  readonly explains?: ReadonlyArray<Span>;
  /** The transition's own moves, in ladder units. */
  readonly cost: number;
}

/** CLOSED — nothing of the asker's material is left unaccounted. */
export function closed(d: DerivationState): boolean {
  return d.remainder.length === 0;
}

/** THE LAW, evaluated once.
 *
 *  Returns the spans the transition accounts for — the witness that lets it be
 *  taken — or `null` when it is inadmissible.  Evaluating it once and advancing
 *  the state with {@link advance} is the whole of a transition; asking twice for
 *  the same pair would repeat the scan, which this module must not make anyone
 *  do.
 *
 *      ¬FIXED  ∧  CONTAINS  ∧  ( CLOSED ∨ CARRIES ∨ MOVES )
 *
 *  Cost is not a term: it is the lattice order the market minimises over, and
 *  neither is any budget — a cap decides with a number of work, this decides
 *  with the remainder. */
export function admissible(
  d: DerivationState,
  t: Continuation,
  query: Uint8Array,
  W: number,
): ReadonlyArray<Witness> | null {
  if (d.fixed) return null;
  if (!t.contains) return null;
  if (closed(d)) return (t.explains ?? []).map((span) => ({ span }));
  // MOVES BEFORE CARRIES, and that order is not arbitrary: a transition that
  // DECLARES it moves (the walker's forward-absorb, and a pivot whose producing
  // mechanism declared the anchors it speaks for) is admitted on that ground
  // alone and records no coverage witness — which is exactly how the code it
  // replaces behaved, where the brake was skipped whenever the producer owned
  // the shape of its answer.  Reading coverage first would attribute to such a
  // step material it was never asked to account for.
  if (t.reaches) {
    // A MOVE IS ITS OWN GROUND — it needs no question material to be admitted.
    // What it CARRIES is nonetheless the one thing the question's remainder may
    // be consumed by, and it is read here by the SAME reading the carries
    // admission uses: one definition, so the law cannot be told a span it does
    // not hold.  A move that carries nothing consumes nothing.
    const carried = carries(d.remainder, t.product, query, W);
    if (carried !== null) return carried;
    return (t.explains ?? []).map((span) => ({ span }));
  }
  return carries(d.remainder, t.product, query, W);
}

/** ADVANCE — the transition itself: the state that results from consuming `t`
 *  with the witness {@link admissible} returned.  The product moves, the
 *  accounting accumulates what the step engaged, and the cost is added.
 *
 *  THE REMAINDER DRAINS ONLY ON A DECLARED MOVE, and that is measured, not
 *  assumed: a step admitted by CARRIES holds question material, which any
 *  repetition also holds — draining on it let a cycle empty the remainder and
 *  close a derivation whose product never changed.  A MOVE (structure this
 *  derivation has not consumed) cannot be produced by repetition, so it is the
 *  one evidence on which the question's leftover may be consumed.  The result is
 *  no longer a supplied fixed point. */
function drain(
  remainder: ReadonlyArray<Span>,
  explains: ReadonlyArray<Span>,
): Array<[number, number]> {
  return remainder.flatMap(([a, b]): Array<[number, number]> => {
    const cut = explains.find(([x, y]) => x >= a && y <= b);
    if (!cut) return [[a, b]];
    const [x, y] = cut;
    const w = y - x;
    const out: Array<[number, number]> = [];
    if (x - a >= w) out.push([a, x]);
    if (b - y >= w) out.push([y, b]);
    return out;
  });
}

export function advance(
  d: DerivationState,
  t: Continuation,
  explains: ReadonlyArray<Witness>,
): DerivationState {
  const spans = explains.map((w) => w.span);
  const carried = t.reaches === true
    ? explains.flatMap((w) => (w.window ? [w.window] : []))
    : [];
  return {
    product: t.product,
    accounted: spans.length === 0 ? d.accounted : [...d.accounted, ...spans],
    remainder: carried.length === 0 ? d.remainder : drain(d.remainder, carried),
    cost: d.cost + t.cost,
    used: d.used,
  };
}

/** What a layer offers the law: the next continuation of a state, or null when
 *  it has none.  A layer OFFERS; the law disposes.
 *
 *  ONE OFFER, AND IT IS THE LAYER'S LAST: {@link closure} stops when the law
 *  refuses what was offered, so a refusal is read as "no continuation exists".
 *  A layer must not offer candidates one at a time and expect the walk to
 *  continue after a refusal — its own fallbacks belong inside this function.
 *  The producers do exactly that: they choose between the forward absorb and the
 *  pivot before offering, and return null only when neither exists, which is why
 *  the one offer the law can still refuse (a pivot without ownership, whose
 *  material the answer does not carry) really is the last one. */
export type Offer = (d: DerivationState) => Promise<Continuation | null>;

/** THE CLOSURE — the walk of {@link advance} over the continuations `offer`
 *  proposes, run until the layer has nothing further to offer or the law refuses
 *  the one it offered.
 *
 *  ADMISSION is entirely the law's; TERMINATION is the layer's, and deliberately
 *  so.  The remainder does not descend (draining it was implemented and refuted
 *  — see the module note), so a walk cannot run forever only because the layer
 *  offering continuations keeps its own cycle protection over a finite graph.
 *  Nothing here counts steps, and nothing here decides admissibility. */
export async function closure(
  d: DerivationState,
  query: Uint8Array,
  W: number,
  offer: Offer,
  /** Called for each step the law admits, with the state before and after. */
  onTaken?: (before: DerivationState, after: DerivationState) => void,
  /** Called when the law refused the continuation the layer offered. */
  onRefused?: (at: DerivationState) => void,
): Promise<DerivationState> {
  for (;;) {
    const t = await offer(d);
    if (t === null) return d;
    const explains = admissible(d, t, query, W);
    if (explains === null) {
      onRefused?.(d);
      return d;
    }
    const next = advance(d, t, explains);
    onTaken?.(d, next);
    d = next;
  }
}
