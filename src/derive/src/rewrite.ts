/**
 * Sequence segmentation on the lightest-derivation engine.
 *
 * The only structure here is the **frontier**: the items are the positions
 * `0…length` of a sequence, and a derivation is a path through them. That is
 * what keeps the search linear in the input rather than quadratic — there is no
 * enumeration of span *pairs* and no chart of O(n²) sub-sequences.
 *
 * Candidate spans are produced **on demand**: when the search finalises a
 * position it asks a {@link Trie} which learned forms begin there. The trie walk
 * stops exactly where the data's patterns stop — a position with nothing learned
 * dead-ends immediately, a position inside a long form walks precisely that far.
 * Nothing is scanned ahead of demand and no length bound is imposed; the
 * structure of what was learned is the bound.
 *
 * {@link coverSequence} is the segmentation primitive: the lightest set of
 * non-overlapping spans covering a sequence. It is the principled,
 * corpus-independent replacement for "scan the whole stream with an automaton,
 * then greedily keep the longest non-overlapping matches" — same linear cost,
 * but the *optimal* cover and only the work the goal demands.
 */

import { type DeductionSystem, lightestDerivation } from "./deduction.js";

/** A candidate span over a sequence, carrying caller payload. */
export interface CandidateSpan<P> {
  /** Start offset (inclusive). */
  start: number;
  /** End offset (exclusive); must be > start. */
  end: number;
  /** Relative cost of using this span (default 1). Lower wins ties. */
  weight?: number;
  /** Caller data, returned on the chosen spans. */
  payload: P;
}

export interface Cover<P> {
  /** Chosen non-overlapping spans, left to right. */
  spans: Array<CandidateSpan<P>>;
  /** Symbols covered by the chosen spans. */
  covered: number;
  /** Symbols left uncovered. */
  uncovered: number;
}

/**
 * The lightest non-overlapping cover of `[0, length)` drawn from `candidates`.
 *
 * Primary objective: cover the most symbols (fewest left uncovered). Secondary:
 * least total span weight — with the default unit weight this prefers fewer,
 * longer spans, the optimal analogue of greedy longest-match, but it can return
 * a pair of shorter spans when together they cover more than one long one (which
 * greedy cannot). Modelled as a shortest path over frontier positions: from a
 * position you either leave one symbol uncovered (costly) or take a candidate
 * that starts there (cheap), reaching `length`.
 *
 * Cost: O((length + |candidates|) · log length) — the frontier has `length + 1`
 * items, each finalised once, with one "skip" edge plus the candidates that
 * start there. No quadratic span structure.
 */
export function coverSequence<P>(
  length: number,
  candidates: ReadonlyArray<CandidateSpan<P>>,
): Cover<P> {
  if (length <= 0) return { spans: [], covered: 0, uncovered: 0 };

  // Candidates indexed by where they start, and by their exact (start,end) edge
  // for reconstruction. Both are O(|candidates|) to build and to read.
  const byStart: Array<Array<CandidateSpan<P>>> = Array.from(
    { length },
    () => [],
  );
  const byEdge = new Map<number, CandidateSpan<P>>();
  let maxWeight = 1;
  for (const c of candidates) {
    if (c.end <= c.start || c.start < 0 || c.end > length) continue;
    const w = c.weight ?? 1;
    if (w > maxWeight) maxWeight = w;
    byStart[c.start].push(c);
    const edge = c.start * (length + 1) + c.end;
    const prev = byEdge.get(edge);
    if (!prev || w < (prev.weight ?? 1)) byEdge.set(edge, c);
  }

  // One uncovered symbol must outweigh any sum of span weights, so coverage is
  // strictly the primary objective and weight only breaks ties.
  const skipCost = maxWeight * length + 1;

  const system: DeductionSystem<number> = {
    key: (p) => "" + p,
    axioms: () => [{ item: 0, cost: 0 }],
    isGoal: (p) => p === length,
    // No nonzero admissible bound is available here: a single candidate can
    // cover the whole remainder for unit cost, so any per-symbol estimate would
    // overestimate. With h = 0 this is exact Knuth/Dijkstra over the frontier —
    // optimal, and linear in the positions. (The A* outside bound is for systems
    // whose remaining cost can be genuinely lower-bounded; see the engine.)
    *rules(p) {
      if (p >= length) return;
      yield { premises: [p], conclusion: p + 1, cost: skipCost }; // leave uncovered
      for (const c of byStart[p]) {
        yield { premises: [p], conclusion: c.end, cost: c.weight ?? 1 };
      }
    },
  };

  const best = lightestDerivation(system);
  if (!best) return { spans: [], covered: 0, uncovered: length };

  // Walk the frontier chain back to the axiom; an edge p→q is a chosen span iff
  // a candidate spans exactly [p, q) (a covering edge is always cheaper than the
  // skips it replaces, so it appears on the optimal path wherever it is used).
  const spans: Array<CandidateSpan<P>> = [];
  let node: typeof best | undefined = best;
  while (node && node.rule) {
    const to = node.item;
    const from = node.premises[0].item;
    const span = byEdge.get(from * (length + 1) + to);
    if (span) spans.push(span);
    node = node.premises[0];
  }
  spans.reverse();

  let covered = 0;
  for (const s of spans) covered += s.end - s.start;
  return { spans, covered, uncovered: length - covered };
}
