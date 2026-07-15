# derive

A small, dependency-free library for computing the **lightest derivation** in a
weighted deduction system — equivalently, an implicit **AND/OR hypergraph** — by
A\* search. It is the generic graph-exploration core of symbolic processing: the
engine knows nothing about what its items _are_, only how to canonicalise them,
enumerate their rules, score them, and recognise the goal. Anything that can be
phrased as "derive a global structure from weighted rules" — parsing, shortest
paths, segmentation, rewriting, planning — is one call to the same search.

It has no dependency on the rest of the codebase and is intended to be reused
across mechanisms, in the spirit of a self-contained sublibrary.

## The algorithm

The library implements **adapted A\* Lightest Derivation (adapted A\*LD)**:

> P. F. Felzenszwalb and D. McAllester. _The Generalized A\* Architecture._
> Journal of Artificial Intelligence Research 29 (2007) 153–190.

adapted A\*LD generalises A\* from shortest paths to the problem of computing a
lightest derivation of a goal from a set of weighted rules, searching an AND/OR
graph bottom-up. It rests on two classical results and unifies them:

- **Knuth (1977)**, _A generalization of Dijkstra's algorithm_ — the
  lightest-derivation problem and its Dijkstra-like solution: process items in
  priority order, and an item's cost is final the instant it is removed from the
  agenda.
- **A\* parsing** (Klein & Manning, 2003) — adding an admissible heuristic so
  that partial derivations which cannot lead cheaply to the goal are never
  expanded.

For a problem that happens to be a shortest path, adapted A\*LD reduces exactly
to A\*. With a small number of antecedents per rule it runs in **O(M log N)** (M
rules, N items), and — crucially — it is **output-sensitive**: only items `B`
with `ℓ(B) ≤ ℓ(goal)` are ever expanded, where `ℓ(B)` is the cost of `B`'s
lightest derivation. Work is proportional to the goal, not to the size of the
implicit graph, so there is no need for length caps or other artificial bounds
to keep it tractable.

> **Evidence pooling via semiring generalization.** The `derive` engine is no
> the pure classic A\*LD algorithm. It has been extended with **additive
> evidence accumulation** — a second combining mode (`combine: "sum"`) that
> operates in the **arithmetic (+, +) semiring** instead of the standard
> **tropical (min, +) semiring** of shortest-path search. Under the min-cost
> regime, only the single cheapest route to a conclusion survives; under the
> arithmetic semiring, every independent line of evidence corroborating the same
> conclusion is **pooled** — its cost is summed, its contribution is recorded,
> and nothing is discarded for not being the cheapest. This is how Sema forms
> consensus votes from multiple independent query regions: each region
> contributes its evidence, and the pooled aggregate is the conclusion's total
> evidential support. A pooled conclusion never competes in the min-cost chart,
> never re-enters the agenda, and is read back by the caller once the search
> exhausts its axioms — making evidence pooling a zero-cost opt-in that coexists
> with the classic algorithm in a single search.

## What "lightest derivation" means

A **weighted deduction system** is a set of _items_ combined by inference rules

```
premise₁ ∧ … ∧ premiseₖ  --localCost-->  conclusion
```

A _derivation_ of an item is a tree: the root is a rule, its children are
derivations of that rule's premises, and the leaves are axioms. A derivation's
cost is the sum of the local costs of the rules it uses. `ℓ(B)` is the minimum
such cost over all derivations of `B`. The search returns a derivation achieving
`ℓ(goal)`, or `null` if the goal is underivable.

A rule with one premise is an ordinary (OR) edge; a rule with several premises
is an **AND** node that _composes_ its premises — this is what makes the
structure a hypergraph rather than a plain graph, and it is how partial results
are joined (for example, combining two recognised spans into one).

### Bridges: composing premises into a coherent whole

A multi-premise rule is a **bridge**: it derives a conclusion from two (or more)
already-derived items and charges a local cost for the join. Bridges are the
mechanism by which independently-derived parts are assembled — and because a
bridge's conclusion is itself an ordinary item, it can serve as a premise of a
_further_ bridge, so bridges chain associatively: `A∧B → AB`, then `AB∧C → ABC`,
all within one search. The cost of the join is paid inside the derivation, so
the lightest derivation is the globally most coherent assembly of the parts, not
a left-to-right stitch decided after the fact.

This is what backs the connector ("bridge") mechanism in the surrounding mind:
two rewritten spans are joined by a bridge whose local cost reflects how well a
learned connector fits between them, and a third span chains onto the result by
the same rule — so a multi-part answer is found as one whole, with no
accumulated gaps, and never as a post-processing pass.

Two properties make bridges safe to lean on:

- **Lazy, order-free firing.** A bridge is emitted from `rules` when _either_
  premise is finalised; the engine fires it only once _all_ its premises are
  known (see `lightestDerivation`'s readiness check). So a bridge may be yielded
  twice — once from each side — and the engine deduplicates by waiting for the
  full conjunction. The caller need not know which premise finalises first.
- **Robust reconstruction.** Recovering the derivation tree is iterative (an
  explicit post-order stack), so it handles both arbitrarily long single-premise
  chains — which, on long inputs, would overflow a recursive walk — and
  multi-premise bridges uniformly. A bridged conclusion's `premises` array holds
  one `Derivation` per premise, in rule order.

## The four mechanisms

The search stays proportional to the goal because of four reductions, three of
which the caller participates in through the `DeductionSystem` interface:

1. **Canonical chart memoization** — items are keyed by `key(item)`; equivalent
   partial derivations collapse to a single chart entry, the cheapest one.
2. **Backward demand filtering** — `rules` only emits rules whose conclusion can
   still reach the goal, so work unrelated to the goal is never generated.
3. **A\* lower-bound pruning** — `heuristic` keeps the agenda ordered by
   `g + h`, so only competitive items are expanded.
4. **Lazy hyperedge generation** — rules are produced by `rules` only when one
   of their premises is finalised, never enumerated up front.

## API

```ts
import {
  type DeductionSystem,
  type Derivation,
  lightestDerivation,
  type Rule,
} from "derive";
```

### `lightestDerivation<I>(system: DeductionSystem<I>): Derivation<I> | null`

Runs the search and returns the root of a lightest derivation tree (`null` if
the goal cannot be derived). `root.cost` is the total derivation cost; the tree
is walked through `root.premises`.

### `DeductionSystem<I>`

The problem you hand the solver. `I` is your item type — anything at all.

```ts
interface DeductionSystem<I> {
  // Canonical key for chart memoization (the item's "boundary signature":
  // everything that can affect how it later combines).
  key(item: I): string;

  // The atomic items and their base costs — the search's seeds.
  axioms(): Iterable<{ item: I; cost: number }>;

  // Lazily yield the rules that have `item` among their premises. Called once,
  // when `item` is finalised. `costOf(other)` returns another item's finalised
  // cost (Infinity if not yet known) — use it to drop rules whose other
  // premises are still open or whose conclusion can no longer beat the goal.
  rules(item: I, costOf: (other: I) => number): Iterable<Rule<I>>;

  // Whether `item` satisfies the goal. The first finalised goal wins.
  isGoal(item: I): boolean;

  // Optional admissible, consistent lower bound on the cost from `item` to a
  // goal. Omit it (or return 0) for plain Knuth/Dijkstra.
  heuristic?(item: I): number;
}
```

### `Rule<I>` and `Derivation<I>`

```ts
interface Rule<I> {
  premises: readonly I[]; // the conjunction (one premise = an OR edge; many = an AND node)
  conclusion: I;
  cost: number; // local cost, non-negative
}

interface Derivation<I> {
  item: I;
  cost: number; // this item's lightest-derivation cost (its g)
  rule: Rule<I> | null; // the producing rule, or null for an axiom
  premises: Array<Derivation<I>>; // derivations of the rule's premises
}
```

## Example: shortest path is a special case

A weighted directed graph is a deduction system in which every node is an item
and every edge is a one-premise rule. The lightest derivation of the target is
the shortest path — adapted A\*LD collapses to A\*.

```ts
import { type DeductionSystem, lightestDerivation } from "derive";

const edges: Record<string, Array<[string, number]>> = {
  a: [["b", 1], ["c", 4]],
  b: [["c", 1], ["d", 5]],
  c: [["d", 1]],
  d: [],
};

const shortestPath: DeductionSystem<string> = {
  key: (n) => n,
  *axioms() {
    yield { item: "a", cost: 0 };
  },
  *rules(node) {
    for (const [to, w] of edges[node] ?? []) {
      yield { premises: [node], conclusion: to, cost: w };
    }
  },
  isGoal: (n) => n === "d",
  heuristic: () => 0, // any admissible lower bound focuses the search
};

const best = lightestDerivation(shortestPath);
// best.cost === 3, and a → b → c → d is recovered from best.premises
```

To compose rather than merely traverse, give a rule **several** premises: the
search will derive each one and only fire the rule once they are all finalised,
charging `cost` on top of their combined cost.

## Example: a bridge composes two parts into one

Two axioms `A` (3) and `B` (4) and a bridge `A ∧ B → AB` (1). The bridge is
yielded from _either_ premise; the engine waits until both are finalised, then
charges the join. The only derivation of `AB` costs `3 + 4 + 1 = 8`, and its
`premises` array holds the derivations of `A` and `B`.

```ts
import { type DeductionSystem, lightestDerivation } from "derive";

const system: DeductionSystem<string> = {
  key: (s) => s,
  axioms: () => [{ item: "A", cost: 3 }, { item: "B", cost: 4 }],
  isGoal: (s) => s === "AB",
  *rules(item) {
    // Fired from either side; the engine composes once both are known.
    if (item === "A") yield { premises: ["A", "B"], conclusion: "AB", cost: 1 };
    if (item === "B") yield { premises: ["A", "B"], conclusion: "AB", cost: 1 };
  },
};

const best = lightestDerivation(system);
// best.cost === 8, best.premises.length === 2 — it really used the bridge.
```

Add a rule `AB ∧ C → ABC` and the bridge chains: the lightest derivation of
`ABC` composes all three parts, the join cost paid inside the search.

## Correctness conditions

The engine is correct provided the caller upholds the conditions adapted A\*LD
requires:

- **Non-negative local costs** (more generally, monotone): adding a rule never
  lowers a derivation's cost.
- **Admissible, consistent heuristic**: `heuristic` never overestimates the cost
  remaining to a goal, and is hyperedge-consistent,
  `h(conclusion) ≤ ruleCost + Σ h(premiseᵢ)`. The default (`0`) is trivially
  consistent and yields plain Knuth/Dijkstra.
- **Faithful `key`**: two items with the same key must be interchangeable in
  every rule. The key must preserve every part of an item that can affect future
  composition; anything it drops is asserted irrelevant.

## Companion utilities

Three small, independently useful pieces share the package, all aligned with the
same "only the work the goal demands" philosophy:

- **`Trie<P>`** — a forward prefix matcher used as a _lazy recognition index_.
  `matchesAt(seq, pos)` walks forward from the root and reports every stored
  pattern beginning at `pos` in time proportional to the longest match; a
  position with nothing learned dead-ends at once, and no length bound is
  imposed — the structure of what was inserted is the bound. A cursor API
  (`root`, `step`, `terminal`) supports incremental walks; `scan(seq)` reports
  all matches across all positions.

- **`coverSequence<P>(length, candidates)`** — the segmentation primitive: the
  lightest set of non-overlapping spans covering a sequence, computed on the
  engine. It is the principled, corpus-independent replacement for "scan with an
  automaton, then greedily keep the longest non-overlapping matches" — the same
  linear cost, but the _optimal_ cover.

- **`MinHeap<T>`** — the allocation-light binary heap the agenda is built on.

## Layout

```
derive/
├── README.md            this file
└── src/
    ├── deduction.ts      lightestDerivation — the adapted A*LD engine
    ├── trie.ts           Trie — lazy forward prefix matcher
    ├── rewrite.ts        coverSequence — optimal sequence cover
    ├── priority-queue.ts MinHeap — the agenda's heap
    └── index.ts          public surface
```
