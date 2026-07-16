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
 * Find a lightest derivation of a goal item, or `null` if none exists.
 * `cost` on the returned root is the total derivation cost.
 */
export function lightestDerivation(system) {
  const g = new Map(); // best known cost per item
  const proof = new Map(); // producing rule per item
  const items = new Map(); // key → the item it stands for
  const hCache = new Map();
  const agenda = new MinHeap();
  const heuristic = system.heuristic;
  const h = (item, key) => {
    if (!heuristic) {
      return 0;
    }
    let v = hCache.get(key);
    if (v === undefined) {
      v = heuristic(item);
      hCache.set(key, v);
    }
    return v;
  };
  const costOf = (item) => g.get(system.key(item)) ?? Infinity;
  const relax = (item, cost, rule) => {
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
  for (const { item, cost } of system.axioms()) {
    relax(item, cost, null);
  }
  while (agenda.size > 0) {
    const { value } = agenda.pop();
    const key = value.key;
    // Lazy deletion: an entry is stale if a cheaper derivation has since been
    // recorded for the same item.
    if (value.g !== g.get(key)) {
      continue;
    }
    const item = items.get(key);
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
      if (ready) {
        relax(rule.conclusion, sum, rule);
      }
    }
  }
  return null;
}
function reconstruct(item, system, g, proof) {
  // Iterative post-order over the derivation hypergraph.  In the rewrite
  // search every rule has one premise, so the derivation is a chain whose
  // length equals the number of frontier edges — which, with long inputs,
  // can exceed the call stack.  Multi-premise rules (the test-suite bridge
  // case) are handled by the same explicit stack.
  const done = new Map();
  const stack = [item];
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
      const kids = premises.map((p) => done.get(system.key(p)));
      done.set(key, {
        item: cur,
        cost: g.get(key),
        rule,
        premises: kids,
      });
    }
  }
  return done.get(system.key(item));
}
