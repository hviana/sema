// derive — A* lightest-derivation rewrite search.
//
// A small, self-contained library for finding minimum-cost derivations in a
// weighted deduction system (an implicit AND-OR hypergraph), with on-demand
// (lazy) rule generation and an admissible A* outside bound. It has no
// dependency on the rest of the codebase and is reusable for any
// symbolic-rewriting mechanism. See ./../README.md for the design.
export { lightestDerivation } from "./deduction.js";
export { coverSequence } from "./rewrite.js";
export { Trie } from "./trie.js";
export { MinHeap } from "./priority-queue.js";
