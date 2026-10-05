# derive

A small, dependency-free library that computes the **lightest derivation** in a
weighted deduction system, equivalently an implicit **AND/OR hypergraph**, by
A\* search. The engine knows nothing about what its items _are_. It only knows
how to key them, enumerate their rules, bound them and recognise the goal.
Parsing, shortest paths, segmentation, rewriting and planning are each one call
to the same search. It imports nothing from the rest of the codebase.

## The algorithm

The library implements an adapted A\* Lightest Derivation (A\*LD; P. F.
Felzenszwalb & D. McAllester, _The Generalized A\* Architecture_, JAIR 29,
2007). It unifies two classical results:

- **Knuth (1977)**, _A generalization of Dijkstra's algorithm_: process items in
  order of priority, and an item's cost is final the moment it leaves the
  agenda.
- **A\* parsing** (Klein & Manning, 2003): an admissible heuristic keeps partial
  derivations that cannot reach the goal cheaply from ever being expanded.

On a shortest-path problem it reduces exactly to A\*. With a small number of
premises per rule it runs in `O(M log N)`. It is **output-sensitive**: only
items whose lightest cost is at most the goal's are ever expanded, so its work
is proportional to the goal, not to the size of the implicit graph, and it needs
no length caps.

A **derivation** of an item is a tree: its root is a rule, its children derive
that rule's premises, and its leaves are axioms. Its cost is the sum of the
local costs of the rules it uses. A rule with one premise is an OR edge. A rule
with several premises is an AND node that **composes** them. That is what makes
the structure a hypergraph, and it is how separately derived parts are joined
(`A ∧ B → AB`, then `AB ∧ C → ABC`). Because the join is paid inside the search,
the lightest derivation is the most coherent assembly of the parts overall, not
a left-to-right stitch decided afterwards.

## Two combinators

| `Rule.combine`    | Semiring           | At the conclusion                                                                                                                    |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `"min"` (default) | (min, +), tropical | the cheapest route wins and every other is discarded. This is the search proper.                                                     |
| `"sum"`           | (+, +)             | every firing adds its cost to the same conclusion, in `system.pool`. Independent lines of evidence corroborate instead of competing. |

A pooled conclusion never enters the agenda and is never a premise. It is a
terminal aggregate the caller reads from `pool` once the search has exhausted
its axioms. A system without `pool` never takes this branch, so pooling costs
nothing to systems that do not use it.

## Why the search stays proportional to the goal

1. **Canonical chart memoization.** Items are keyed by `key(item)`, so
   equivalent partial derivations collapse to one entry, the cheapest.
2. **Backward demand filtering.** `rules` emits only rules whose conclusion can
   still reach the goal.
3. **A\* pruning.** `heuristic` orders the agenda by `g + h`.
4. **Lazy hyperedges.** A rule is produced only when one of its premises is
   finalised, and fires only once all of its premises are known. It may be
   yielded from either side, and the engine waits for the full conjunction.

The derivation tree is reconstructed iteratively, so very long chains cannot
overflow the stack.

## API

```ts
lightestDerivation<I>(system: DeductionSystem<I>, stats?: SearchStats): Derivation<I> | null

interface DeductionSystem<I> {
  key(item: I): string;                                   // chart key: everything that can affect later combination
  axioms(): Iterable<{ item: I; cost: number }>;          // the seeds
  rules(item: I, costOf: (other: I) => number): Iterable<Rule<I>>; // called once, when `item` is finalised
  isGoal(item: I): boolean;                               // the first finalised goal wins
  heuristic?(item: I): number;                            // admissible, consistent; omit for Knuth/Dijkstra
  pool?: Map<string, PooledConclusion<I>>;                // present only for `combine: "sum"` systems
}

interface Rule<I> { premises: readonly I[]; conclusion: I; cost: number; combine?: "min" | "sum" }
interface Derivation<I> { item: I; cost: number; rule: Rule<I> | null; premises: Derivation<I>[] }
interface SearchStats { pops: number; pushes: number }
```

`costOf(other)` returns another item's finalised cost, or `Infinity` if it is
not yet known. Use it to drop rules whose other premises are still open, or
whose conclusion can no longer beat the goal.

## Example — a bridge composes two parts

```ts
const system: DeductionSystem<string> = {
  key: (s) => s,
  axioms: () => [{ item: "A", cost: 3 }, { item: "B", cost: 4 }],
  isGoal: (s) => s === "AB",
  *rules(item) {
    if (item === "A" || item === "B") {
      yield { premises: ["A", "B"], conclusion: "AB", cost: 1 };
    }
  },
};
lightestDerivation(system); // cost 8 = 3 + 4 + 1; premises hold A's and B's derivations
```

A weighted graph is the special case where every rule has one premise. There,
the lightest derivation of the target is the shortest path.

## Correctness conditions

- **Local costs are non-negative,** or more generally monotone.
- **The heuristic is admissible and consistent:**
  `h(conclusion) ≤ ruleCost + Σ h(premiseᵢ)`. The default `0` is trivially so.
- **`key` is faithful:** two items with the same key must be interchangeable in
  every rule. Whatever the key drops is asserted to be irrelevant.

## Companions

- **`Trie<P>`** is a lazy forward prefix matcher. `matchesAt(seq, pos)` reports
  every stored pattern that starts at `pos`, in time proportional to the longest
  match, and `scan(seq)` reports all of them. A cursor API (`root`, `step`,
  `terminal`) walks incrementally.
- **`coverSequence(length, candidates)`** returns the lightest set of
  non-overlapping spans covering a sequence. It is the optimal replacement for
  "keep the longest matches greedily", at the same linear cost.
- **`MinHeap<T>`** is the agenda's heap.

## Layout

```
src/deduction.ts       lightestDerivation, the engine
src/trie.ts            Trie
src/rewrite.ts         coverSequence
src/priority-queue.ts  MinHeap
src/index.ts           public surface
test/derive.test.ts    self-contained tests
```
