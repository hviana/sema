// 22-multihop.test.mjs — REASONING THROUGH a partial result (the second half of
// "leverage the partial results of an experience").
//
// Test 21 pinned the first half: a query that is only a PORTION of a stored
// experience resolves to that experience (the interior of a fact/answer is a
// first-class resonance anchor, reachable by the structural climb). This file
// pins the harder half the task also asks for: the "think" rewrite must be able
// to USE a partial result as a BUILDING BLOCK — ground one fact, then take the
// piece of its answer the query still asks about and hop to the next fact.
//
// The shape is a two-fact chain that shares a pivot term:
//
//     A:  "What is the capital of France"  →  "The capital of France is Paris"
//     B:  "Paris"                          →  "Paris is famous for the Eiffel Tower"
//
// Neither fact alone answers "What is the capital of France famous for". Fact A
// yields the partial result "Paris"; that partial result is the PIVOT into fact
// B. A true reasoner over the DAG composes the two: A's answer is not the end, it
// is the bridge. This is pure structure — the pivot "Paris" ties the two
// experiences together in the graph the store already built — so the hop falls
// out of `Mind.reason`: ground fact A, find the longest UNCONSUMED learnt context
// whose bytes the answer literally CONTAINS ("Paris"), and complete it forward.
//
// Byte containment is the gate, and it is hard graph evidence (the same "the form
// actually runs these bytes" test `bridge` uses): a genuine bridge exists only
// when the produced answer literally holds another learnt context. A query
// satisfied by ONE fact — or one whose neighbours merely share a frame (test 17) —
// produces an answer that contains no other context, so nothing pivots and the
// answer is returned untouched. That is why multi-hop composes transparently with
// ordinary recall and never fabricates a bridge.
//
// Without the multi-hop step every probe here stops at the first fact's answer;
// with it, the chain completes to the second fact. The aggregate bar clears with
// the reasoner and collapses (to ~0) without it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// Each chain: factA (question → answer whose interior holds the PIVOT), factB
// (pivot → a further answer), a query that must cross the hop, and a distinctive
// marker of the SECOND fact's answer.
const CHAINS = [
  {
    a: ["What is the capital of France", "The capital of France is Paris"],
    b: ["Paris", "Paris is famous for the Eiffel Tower"],
    q: "What is the capital of France famous for",
    want: "Eiffel Tower",
  },
  {
    a: ["Who wrote Hamlet", "Hamlet was written by William Shakespeare"],
    b: ["William Shakespeare", "William Shakespeare was born in Stratford"],
    q: "Where was the writer of Hamlet born",
    want: "Stratford",
  },
  {
    a: ["What is the lightest metal", "The lightest metal is lithium"],
    b: ["lithium", "lithium is used in rechargeable batteries"],
    q: "What is the lightest metal used in",
    want: "batteries",
  },
  {
    a: ["Which planet is the largest", "The largest planet is Jupiter"],
    b: ["Jupiter", "Jupiter has a giant storm called the Great Red Spot"],
    q: "What does the largest planet have",
    want: "Great Red Spot",
  },
];

const norm = (s) => s.replace(/\s+/g, " ").trim();

async function chainMind(chain, seed) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed, store });
  await mind.ingest([chain.a, chain.b]);
  return { store, mind };
}

test("a query crosses a two-fact chain THROUGH the partial result", async () => {
  const seed = 7;
  const got = [];
  for (const c of CHAINS) {
    const { store, mind } = await chainMind(c, seed);
    const ans = norm(await mind.respondText(c.q));
    await store.close();
    got.push({ q: c.q, ok: ans.includes(c.want), ans });
  }

  const total = got.filter((g) => g.ok).length;
  // A reasoner that USES the partial result clears most of these; one that stops
  // at the first fact's answer (no hop) scores ~0. The bar is generous to absorb
  // ANN/codec jitter while still failing hard on a non-reasoning build.
  assert.ok(
    total >= 3,
    `only ${total}/${CHAINS.length} chains crossed the hop — expected ≥ 3 ` +
      `(the think rewrite must use a partial result as a building block)\n` +
      got.filter((g) => !g.ok).map((g) =>
        `  ✗ "${g.q}" → ${g.ans.slice(0, 52)}`
      ).join("\n"),
  );
});

// The gate: a query satisfied by the FIRST fact alone must NOT over-hop into the
// second. Asking exactly fact A's question returns fact A's answer, unchanged —
// the chain only fires when the query still asks for what the pivot leads to.
test("a single-fact query does not over-hop", async () => {
  const c = CHAINS[0];
  const { store, mind } = await chainMind(c, 7);
  const ans = norm(await mind.respondText(c.a[0])); // "What is the capital of France"
  await store.close();
  assert.ok(
    ans.includes("Paris") && !ans.includes("Eiffel"),
    `a single-fact query over-hopped: "${ans.slice(0, 60)}" ` +
      `(expected fact A's answer, not the chained fact B)`,
  );
});

// Determinism: the same chain query resolves identically across runs (the hop is
// a structural walk, not sampled).
test("the multi-hop answer is deterministic", async () => {
  const c = CHAINS[0];
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const { store, mind } = await chainMind(c, 7);
    runs.push(norm(await mind.respondText(c.q)));
    await store.close();
  }
  assert.equal(runs[0], runs[1], "multi-hop reasoning must be deterministic");
});
