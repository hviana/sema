// 108-the-join-chains.test.mjs — DIRECTION, the other half: the result of one
// join feeds the next.
//
// THE GAP THIS CLOSES.  The join's conclusion covered the WHOLE remaining tail
// (`j = queryLen`), so it consumed everything and could only ever conclude: a
// three-relation query got one join and stopped.  The whole-tail key was the
// same defect seen from the key side — a two-relation tail names no learnt key
// at all.
//
// THE FIX, and the measurement that found the last piece of it.  The key is the
// SHORTEST tail prefix that BOTH resolves and leads somewhere, and the
// conclusion covers only that prefix, leaving the rest of the tail for the next
// step.  Resolving is not enough: a dry run of these very primitives showed the
// first prefix that resolves for the candidate `Sweden` is the key `Sweden `
// (trailing space) — which leads NOWHERE — while the key that names the fact
// (`sweden capital`) sat one prefix further; accepting the first resolving key
// refused the join.
//
// WHAT IS PINNED, untraced (a rationale perturbs the search — test/107):
//   1. the answer is the THIRD fact, reached through two joins;
//   2. `joinFired` counts exactly two — the counters are the untraced view;
//   3. the two-relation query still counts exactly one, so chaining did not
//      turn every join into a chain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const F1 = "The director of Eva is Gustaf Molander.";
const F2 = "The country of Gustaf Molander is Sweden.";
const F3 = "The capital of Sweden is Stockholm.";

async function chain() {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["eva", F1],
    ["eva director", F1],
    ["gustaf molander", F2],
    ["gustaf molander country", F2],
    ["sweden", F3],
    ["sweden capital", F3],
  ]);
  return mind;
}

const text = (resp) => new TextDecoder().decode(resp.bytes).replace(/\0+/g, "");

test("a three-relation query reaches the third fact, through two joins", async () => {
  const mind = await chain();
  const out = text(await mind.respond("eva director country capital"));
  assert.equal(out.trim(), F3, "the chain must reach the capital fact");
  await mind.store.close();
});

test("the counters agree, with no rationale attached", async () => {
  const mind = await chain();
  await mind.respond("eva director country capital");
  assert.equal(
    mind.lastCost?.counters.joinFired ?? 0,
    2,
    "two joins reached it — the untraced view must agree with the answer",
  );
  await mind.store.close();
});

test("a two-relation query still joins exactly once", async () => {
  const mind = await chain();
  const out = text(await mind.respond("eva director country"));
  assert.equal(out.trim(), F2);
  assert.equal(
    mind.lastCost?.counters.joinFired ?? 0,
    1,
    "chaining must not turn a single join into a chain",
  );
  await mind.store.close();
});
