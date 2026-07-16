// Self-contained tests for the `derive` library: the lightest-derivation
// engine (including a multi-premise *bridge* rule), the on-demand trie matcher,
// and the optimal cover. Uses node:test; no dependency on sema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverSequence, lightestDerivation, Trie } from "../src/index.js";
// ── trie: on-demand matching, no length bound ──────────────────────────────
test("trie matchesAt reports forms beginning exactly at a position", () => {
  const t = new Trie();
  t.insert([1, 2], "ab");
  t.insert([1, 2, 3], "abc");
  t.insert([2, 3], "bc");
  const at0 = t.matchesAt([1, 2, 3, 4], 0).map((m) => m.payload);
  assert.deepEqual(at0, ["ab", "abc"]); // both forms starting at 0, shortest first
  const at1 = t.matchesAt([1, 2, 3, 4], 1).map((m) => m.payload);
  assert.deepEqual(at1, ["bc"]);
  const at3 = t.matchesAt([1, 2, 3, 4], 3).map((m) => m.payload);
  assert.deepEqual(at3, []); // nothing learned here → dead-ends immediately
});
test("trie scan finds every occurrence; duplicate inserts share an id", () => {
  const t = new Trie();
  const id1 = t.insert([7, 7], 1);
  const id2 = t.insert([7, 7], 2); // same content
  assert.equal(id1, id2);
  assert.equal(t.size, 1);
  const hits = t.scan([7, 7, 7]);
  assert.equal(hits.length, 2); // [0,2) and [1,3)
});
// ── engine: Dijkstra/Knuth core with a bridge (multi-premise) rule ─────────
test("lightestDerivation solves a hypergraph with a bridge premise", () => {
  // Items: "A", "B", "AB". Axioms A (3) and B (4). A binary bridge A ∧ B → AB
  // at cost 1. The only derivation of AB costs 3 + 4 + 1 = 8.
  const A = "A", B = "B", AB = "AB";
  const system = {
    key: (s) => s,
    axioms: () => [{ item: A, cost: 3 }, { item: B, cost: 4 }],
    isGoal: (s) => s === AB,
    *rules(item) {
      // Bridge fires from either premise; the engine waits until both are known.
      if (item === A) {
        yield { premises: [A, B], conclusion: AB, cost: 1 };
      }
      if (item === B) {
        yield { premises: [A, B], conclusion: AB, cost: 1 };
      }
    },
  };
  const d = lightestDerivation(system);
  assert.ok(d);
  assert.equal(d.item, AB);
  assert.equal(d.cost, 8);
  assert.equal(d.premises.length, 2); // it really used the bridge
});
test("lightestDerivation picks the cheaper of competing derivations", () => {
  // Two ways to reach the goal G from axiom S: S→G cost 10, or S→M→G cost 3+3.
  const system = {
    key: (s) => s,
    axioms: () => [{ item: "S", cost: 0 }],
    isGoal: (s) => s === "G",
    *rules(item) {
      if (item === "S") {
        yield { premises: ["S"], conclusion: "G", cost: 10 };
        yield { premises: ["S"], conclusion: "M", cost: 3 };
      }
      if (item === "M") {
        yield { premises: ["M"], conclusion: "G", cost: 3 };
      }
    },
  };
  const d = lightestDerivation(system);
  assert.ok(d);
  assert.equal(d.cost, 6); // via M, not the direct 10
  assert.equal(d.rule?.premises[0], "M");
});
test("lightestDerivation returns null when the goal is unreachable", () => {
  const system = {
    key: (n) => "" + n,
    axioms: () => [{ item: 0, cost: 0 }],
    isGoal: (n) => n === 99,
    *rules(n) {
      if (n < 3) {
        yield { premises: [n], conclusion: n + 1, cost: 1 };
      }
    },
  };
  assert.equal(lightestDerivation(system), null);
});
// ── cover: optimal, not greedy ─────────────────────────────────────────────
test("coverSequence maximises coverage, beating greedy longest-match", () => {
  // Over [0,4): one long span [1,4) (len 3) vs two short [0,2),[2,4) (cover 4).
  // Greedy-longest takes [1,4) and covers 3; the optimal cover takes the pair.
  const cover = coverSequence(4, [
    { start: 1, end: 4, payload: "long" },
    { start: 0, end: 2, payload: "left" },
    { start: 2, end: 4, payload: "right" },
  ]);
  assert.equal(cover.covered, 4);
  assert.equal(cover.uncovered, 0);
  assert.deepEqual(cover.spans.map((s) => s.payload), ["left", "right"]);
});
test("coverSequence prefers fewer, longer spans on ties (unit weight)", () => {
  // [0,3) covers the same as [0,1)+[1,3) but in one span → preferred.
  const cover = coverSequence(3, [
    { start: 0, end: 3, payload: "whole" },
    { start: 0, end: 1, payload: "a" },
    { start: 1, end: 3, payload: "b" },
  ]);
  assert.deepEqual(cover.spans.map((s) => s.payload), ["whole"]);
});
test("coverSequence leaves genuinely uncovered gaps uncovered", () => {
  const cover = coverSequence(10, [
    { start: 0, end: 3, payload: "x" },
    { start: 6, end: 9, payload: "y" },
  ]);
  assert.equal(cover.covered, 6);
  assert.equal(cover.uncovered, 4);
  assert.deepEqual(cover.spans.map((s) => s.payload), ["x", "y"]);
});
test("coverSequence honours weights when coverage ties", () => {
  // Both single-span covers cover all 2 symbols; the lighter weight wins.
  const cover = coverSequence(2, [
    { start: 0, end: 2, weight: 5, payload: "heavy" },
    { start: 0, end: 2, weight: 1, payload: "light" },
  ]);
  assert.deepEqual(cover.spans.map((s) => s.payload), ["light"]);
});
