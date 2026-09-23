// 109-the-pivot-is-counted.test.mjs — how far the reasoner hopped is a
// BEHAVIOUR, so it is observable without a rationale.
//
// WHY THIS EXISTS.  EXTENSION (the study's gap 3): the pivot does not stop when
// the question is already satisfied — it hops on while the answer still contains
// an unconsumed learnt context (`reasoning.ts`: the loop breaks only on a null
// pivot, a null forward step, an unchanged answer, or a restatement).  That is a
// property of how far the chain went, and until now it was visible only through
// `pivotStep` in the rationale — which PERTURBS the search (measured: appending
// text to a refusal note changed a traced answer).  `meter.ts` is the untraced
// view and the one home for a counter name (AGENTS §6).
//
// WHAT IS PINNED.  The pivot is counted on the fixture where the multi-hop
// genuinely needs it (test/23's two-fact chain), untraced.  The assertion is
// "at least one", so it stays true whether or not the EXTENSION fix changes how
// many hops a satisfied question takes — the drift itself gets its own test
// once the criterion for "satisfied" is measured.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

/** test/23's two-fact chain: the pivot is what crosses the hop. */
async function pivotFixture() {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
  ]);
  return mind;
}

test("the pivot is counted, with no rationale attached", async () => {
  const mind = await pivotFixture();
  const out = await mind.respondText(
    "What is the capital of France famous for",
  );
  assert.ok(
    out.includes("Eiffel"),
    `the multi-hop must still chain, got ${JSON.stringify(out)}`,
  );
  assert.ok(
    (mind.lastCost?.counters.pivotSteps ?? 0) > 0,
    "the hop was taken, so it must be counted",
  );
  await mind.store.close();
});

test("a query that needs no hop counts none", async () => {
  const mind = await pivotFixture();
  await mind.respondText("What is the capital of France");
  assert.equal(
    mind.lastCost?.counters.pivotSteps ?? 0,
    0,
    "a directly answered question pivots nowhere",
  );
  await mind.store.close();
});
