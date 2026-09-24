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
// THE REMAINDER TRAVELS UNCHANGED, and this was measured, not assumed: letting
// `advance` drain the witness made a step that engaged the gap CLOSE the
// derivation, the next step was admitted unconstrained, and test/110's
// three-link chain drifted one hop past its satisfying answer.  A step ENGAGES
// the question's leftover; it does not consume it.  Termination is therefore not
// the law's: it is the walker's cycle protection over a finite graph.
//
// TWO LIMITS ARE PROVED AND LEFT OUT (docs/architecture/closure.md, §13.3):
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
): Array<[number, number]> | null {
  for (const [a, b] of remainder) {
    for (let i = a; i + W <= b; i++) {
      if (indexOf(product, query.subarray(i, i + W), 0) >= 0) {
        const witness: [number, number] = [a, b];
        return [witness];
      }
    }
  }
  return null;
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
   *  tree, or one contiguous byte run of it.  Resolved by the reporter. */
  readonly contains: boolean;
  /** MOVES — the transition reaches structure this derivation has not consumed
   *  (a node outside the walker's own set).  The second species of progress: a
   *  step need not excuse itself with question material when it moves to new
   *  structure.  Resolved by the reporter, declared by the transition — never
   *  inferred from its producer. */
  readonly moves?: boolean;
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
): ReadonlyArray<Span> | null {
  if (d.fixed) return null;
  if (!t.contains) return null;
  if (closed(d)) return t.explains ?? [];
  // MOVES BEFORE CARRIES, and that order is not arbitrary: a transition that
  // DECLARES it moves (the walker's forward-absorb, and a pivot whose producing
  // mechanism declared the anchors it speaks for) is admitted on that ground
  // alone and records no coverage witness — which is exactly how the code it
  // replaces behaved, where the brake was skipped whenever the producer owned
  // the shape of its answer.  Reading coverage first would attribute to such a
  // step material it was never asked to account for.
  if (t.moves) return t.explains ?? [];
  return carries(d.remainder, t.product, query, W);
}

/** ADVANCE — the transition itself: the state that results from consuming `t`
 *  with the witness {@link admissible} returned.  The product moves, the
 *  accounting accumulates what the step engaged, the cost is added, and the
 *  remainder — the question's leftover — travels UNCHANGED (see the module note:
 *  draining it was implemented and refuted).  The result is no longer a supplied
 *  fixed point. */
export function advance(
  d: DerivationState,
  t: Continuation,
  explains: ReadonlyArray<Span>,
): DerivationState {
  return {
    product: t.product,
    accounted: explains.length === 0
      ? d.accounted
      : [...d.accounted, ...explains],
    remainder: d.remainder,
    cost: d.cost + t.cost,
    used: d.used,
  };
}

/** What a layer offers the law: the next continuation of a state, or null when
 *  it has none.  A layer OFFERS; the law disposes. */
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
