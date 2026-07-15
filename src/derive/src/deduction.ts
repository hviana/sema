/**
 * Knuth's lightest-derivation algorithm with an A* outside bound.
 *
 * A *weighted deduction system* (equivalently an implicit AND-OR hypergraph) is
 * a set of items combined by inference rules
 *
 *     premise₁ ∧ … ∧ premiseₖ  --localCost-->  conclusion
 *
 * where a derivation's cost is the sum of the local costs of the rules used.
 * {@link lightestDerivation} finds a minimum-cost derivation of a goal item.
 * The engine is the Dijkstra-like core of Knuth (1977) — an item's cost is
 * final the moment it is popped — extended with an admissible heuristic so that
 * partial derivations which cannot lead cheaply to the goal are never expanded
 * (A* parsing). It is completely generic: it knows nothing of what items are,
 * only how to canonicalise them, enumerate their rules, score them, and test
 * the goal.
 *
 * The four reductions the search relies on:
 *   1. **Canonical chart memoization** — items are keyed by {@link
 *      DeductionSystem.key}; equivalent partial derivations collapse to one
 *      chart entry, the cheapest.
 *   2. **Backward demand filtering** — {@link DeductionSystem.rules} only emits
 *      rules whose conclusion can still reach the goal, so work unrelated to the
 *      goal is never generated.
 *   3. **A* lower-bound pruning** — {@link DeductionSystem.heuristic} keeps the
 *      agenda ordered by g + h, so only competitive items are expanded.
 *   4. **Lazy hyperedge generation** — rules (including bridges) are produced by
 *      `rules` only when one of their premises is finalised, never up front.
 *
 * Correctness conditions (the caller must uphold these):
 *   - Local costs are non-negative (more generally, monotone / superior).
 *   - The heuristic never overestimates the remaining cost to a goal
 *     (admissible) and is hyperedge-consistent:
 *         h(conclusion) ≤ ruleCost + Σ h(premiseᵢ)
 *     i.e. relaxing a rule cannot decrease f. The default heuristic (0) is
 *     trivially consistent and turns the search into plain Knuth/Dijkstra.
 *   - {@link DeductionSystem.key} preserves every part of an item that can
 *     affect how it later combines (its "boundary signature"); anything the key
 *     drops is asserted to be irrelevant to future composition.
 */

import { MinHeap } from "./priority-queue.js";

/**
 * A weighted deduction rule (a hyperedge): the conjunction of `premises`
 * derives `conclusion` at an additional `cost`.
 */
export interface Rule<I> {
  premises: readonly I[];
  conclusion: I;
  /** Local (edge) cost added on top of the premises' costs. Non-negative. */
  cost: number;
  /** The combinator this rule's firing uses at its conclusion:
   *   • `"min"` (default, omitted) — Knuth/A* proper: the conclusion's cost is
   *     the CHEAPEST of any rule that reaches it, every other route discarded.
   *     The shortest-path monoid (min, +) that makes the search admissible and
   *     output-sensitive.
   *   • `"sum"` — evidence pooling: EVERY firing of a sum rule contributes its
   *     cost to the SAME conclusion (accumulated in {@link
   *     DeductionSystem.pool}), instead of competing to be the one cheapest
   *     route.  The (+, +) monoid a consensus vote needs — several
   *     independent premises corroborating one conclusion — kept deliberately
   *     OUT of the min-cost chart: a pooled conclusion is never relaxed into
   *     `g`, never enters the agenda, and is never itself a premise — it is a
   *     terminal aggregate the caller reads out of `pool` once the search is
   *     done. */
  combine?: "min" | "sum";
}

/** One rule's contribution to a pooled (`combine: "sum"`) conclusion — the
 *  firing rule and the already-finalised derivations of its premises, so a
 *  caller can render each contribution exactly as it would a min-cost step. */
export interface PooledContribution<I> {
  rule: Rule<I>;
  premises: Array<Derivation<I>>;
}

/** The running aggregate at one pooled conclusion: every sum-mode rule that
 *  has fired for it, accumulated. */
export interface PooledConclusion<I> {
  item: I;
  cost: number;
  contributions: Array<PooledContribution<I>>;
}

/** The problem the solver is given: items, rules, a goal, and a heuristic. */
export interface DeductionSystem<I> {
  /** Canonical key for chart memoization (the item's boundary signature). */
  key(item: I): string;

  /** Axioms: the atomic items and their base costs (the search's seeds). */
  axioms(): Iterable<{ item: I; cost: number }>;

  /**
   * Lazily generate the demanded rules that have `item` among their premises.
   * Called once, when `item` is finalised. `costOf` returns the finalised cost
   * of any item (Infinity if not yet known) — use it for backward-demand /
   * boundary filtering, e.g. drop a rule whose other premises are still open or
   * whose conclusion can no longer beat the best goal.
   */
  rules(item: I, costOf: (other: I) => number): Iterable<Rule<I>>;

  /** Whether `item` satisfies the goal. The first finalised goal wins. */
  isGoal(item: I): boolean;

  /** Admissible, consistent lower bound on the cost from `item` to a goal. */
  heuristic?(item: I): number;

  /** Present only on a system that fires `combine: "sum"` rules — supplied
   *  empty, populated in place as the search runs, read back once it returns
   *  (typically `null`: a pooling system has no goal to reach, it exhausts its
   *  axioms instead — see {@link lightestDerivation}).  Absent on every
   *  ordinary min-cost system, which is what keeps pooling a zero-cost opt-in:
   *  `relax` only takes the pooling branch when a rule declares `combine:
   *  "sum"` AND this map is present. */
  pool?: Map<string, PooledConclusion<I>>;
}

/** A node of the reconstructed derivation tree. */
export interface Derivation<I> {
  /** The derived item. */
  item: I;
  /** This item's minimum derivation cost (its g value). */
  cost: number;
  /** The rule that produced it, or null if it is an axiom. */
  rule: Rule<I> | null;
  /** Derivations of the rule's premises (empty for an axiom). */
  premises: Array<Derivation<I>>;
}

/**
 * Find a lightest derivation of a goal item, or `null` if none exists.
 * `cost` on the returned root is the total derivation cost.
 */
export function lightestDerivation<I>(
  system: DeductionSystem<I>,
): Derivation<I> | null {
  const g = new Map<string, number>(); // best known cost per item
  const proof = new Map<string, Rule<I> | null>(); // producing rule per item
  const items = new Map<string, I>(); // key → the item it stands for
  const hCache = new Map<string, number>();
  const agenda = new MinHeap<{ key: string; g: number }>();

  const heuristic = system.heuristic;
  const h = (item: I, key: string): number => {
    if (!heuristic) return 0;
    let v = hCache.get(key);
    if (v === undefined) {
      v = heuristic(item);
      hCache.set(key, v);
    }
    return v;
  };

  const costOf = (item: I): number => g.get(system.key(item)) ?? Infinity;

  const relax = (item: I, cost: number, rule: Rule<I> | null): void => {
    const key = system.key(item);
    if (rule?.combine === "sum" && system.pool) {
      // Evidence pooling: accumulate this firing rather than compete for the
      // cheapest — see {@link Rule.combine}.  The premises are already
      // finalised (the caller only relaxes a rule once every premise's cost
      // is known), so their derivations can be read back immediately.
      const premises = rule.premises.map((p) =>
        reconstruct(p, system, g, proof)
      );
      const prior = system.pool.get(key);
      system.pool.set(key, {
        item,
        cost: (prior?.cost ?? 0) + cost,
        contributions: [...(prior?.contributions ?? []), { rule, premises }],
      });
      return;
    }
    const current = g.get(key);
    if (current === undefined || cost < current) {
      g.set(key, cost);
      proof.set(key, rule);
      items.set(key, item);
      agenda.push(cost + h(item, key), { key, g: cost });
    }
  };

  for (const { item, cost } of system.axioms()) relax(item, cost, null);

  while (agenda.size > 0) {
    const { value } = agenda.pop() as { value: { key: string; g: number } };
    const key = value.key;
    // Lazy deletion: an entry is stale if a cheaper derivation has since been
    // recorded for the same item.
    if (value.g !== g.get(key)) continue;

    const item = items.get(key) as I;
    if (system.isGoal(item)) {
      return reconstruct(item, system, g, proof);
    }

    for (const rule of system.rules(item, costOf)) {
      let sum = rule.cost;
      let ready = true;
      for (const p of rule.premises) {
        const pc = g.get(system.key(p));
        if (pc === undefined) {
          ready = false;
          break;
        }
        sum += pc;
      }
      if (ready) relax(rule.conclusion, sum, rule);
    }
  }
  return null;
}

function reconstruct<I>(
  item: I,
  system: DeductionSystem<I>,
  g: Map<string, number>,
  proof: Map<string, Rule<I> | null>,
): Derivation<I> {
  // Iterative post-order over the derivation hypergraph.  In the rewrite
  // search every rule has one premise, so the derivation is a chain whose
  // length equals the number of frontier edges — which, with long inputs,
  // can exceed the call stack.  Multi-premise rules (the test-suite bridge
  // case) are handled by the same explicit stack.
  const done = new Map<string, Derivation<I>>();
  const stack: I[] = [item];

  while (stack.length > 0) {
    const cur = stack[stack.length - 1]; // peek
    const key = system.key(cur);

    if (done.has(key)) {
      stack.pop();
      continue;
    }

    const rule = proof.get(key) ?? null;
    const premises = rule?.premises ?? [];

    // Push any unresolved premises (rightmost first → leftmost resolves first).
    let pending = false;
    for (let i = premises.length - 1; i >= 0; i--) {
      if (!done.has(system.key(premises[i]))) {
        stack.push(premises[i]);
        pending = true;
      }
    }

    if (!pending) {
      stack.pop(); // this item
      const kids = premises.map((p) => done.get(system.key(p))!);
      done.set(key, {
        item: cur,
        cost: g.get(key) as number,
        rule,
        premises: kids,
      });
    }
  }

  return done.get(system.key(item))!;
}
