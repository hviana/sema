// 141 — what the construction owes, the transition that carries it pays.
//
// WHAT THIS PINS, measured on the three archetypes the engine has: a query the
// FUSION answers, a query the WALK extends, and a query the JOIN reaches through
// a subject the question never wrote.
//
//   the FUSION pays: the grounding priced a span of the question its answer does
//   not hold (the ALU's surface form is not in its result), so the derivation was
//   born OWING it, and the fused step — offered to the law as a transition —
//   carried a window of it and consumed it.  Four bytes, one quantum.
//
//   the WALK does not: its step follows the answer's own learnt continuation,
//   structure the question never wrote, so it carries nothing to consume.
//
// So consumption is not the grounding's alone any more: it belongs to whichever
// transition CARRIES the owed material, read by the one reading (windowOf), and
// test/138 keeps a step from consuming what it does not carry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const CHAIN = [
  ["What is the capital of France", "The capital of France is Paris"],
  ["Paris", "Paris is famous for the Eiffel Tower"],
  ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
];
const FUSING = [
  ["2+2", "2+2 equals 4"],
  [
    "The tallest tower in Paris",
    "The tallest tower in Paris is the Eiffel Tower",
  ],
];
const JOIN = [
  ["eva", "The director of Eva is Gustaf Molander."],
  ["eva director", "The director of Eva is Gustaf Molander."],
  ["gustaf molander", "The country of Gustaf Molander is Sweden."],
  ["gustaf molander country", "The country of Gustaf Molander is Sweden."],
];

async function counters(corpus, query) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(corpus);
  const out = await mind.respond(query);
  const c = mind.lastCost?.counters ?? {};
  await store.close();
  return {
    text: new TextDecoder().decode(out.bytes).replace(/\0+/g, "").trim(),
    c,
  };
}

test("141.1 the fusion answers a query that was already paid for", async () => {
  const { text, c } = await counters(FUSING, "2+2 and the Eiffel Tower");
  assert.ok((c.fuseRuns ?? 0) >= 1, "the fusion ran");
  assert.equal(
    c.remainderBytes ?? 0,
    0,
    "the question was paid at construction",
  );
  assert.ok(
    (c.closureDrainedBytes ?? 0) > 0,
    "the fusion carried a window of what the construction owed, and consumed it",
  );
  assert.match(text, /4/);
  assert.match(text, /Eiffel Tower/);
});

test("141.2 the walk extends over structure the question never wrote", async () => {
  const { text, c } = await counters(
    CHAIN,
    "What is the capital of France famous for",
  );
  assert.ok((c.reasonSteps ?? 0) >= 1, "the walk took a step");
  assert.equal(
    c.closureDrainedBytes ?? 0,
    0,
    "the step carried no question material",
  );
  assert.equal(
    text,
    "Paris is famous for the Eiffel Tower",
    "the chain answer",
  );
});

test("141.3 the join reaches through a subject the question never wrote", async () => {
  const { text, c } = await counters(JOIN, "eva director country");
  assert.equal(
    c.closureDrainedBytes ?? 0,
    0,
    "the join carries nothing to consume",
  );
  assert.equal(text, "The country of Gustaf Molander is Sweden.");
});
