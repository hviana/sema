// 141 — the question is paid at construction; a post-grounding step faces no debt.
//
// WHAT THIS PINS, measured on the three archetypes the engine has: a query the
// FUSION answers (four entries, one fusion), a query the WALK extends (the
// three-link chain), and a query the JOIN reaches through a subject the question
// never wrote.  In all three the remainder AT THE DECISION POINT is empty — the
// grounding consumed the question when it built the state — so the law's drain
// (what a move CARRIES) has nothing to consume and reads zero.
//
// That is the architecture, not a defect: consumption belongs to the grounding,
// and the post-grounding tiers run over a paid question to improve the answer.
// The drain is the GUARD that keeps a step from consuming what it does not carry
// (test/138), and it fires exactly when a step does carry question material — a
// state this engine does not reach, which is why the number is zero and not
// because the reading fails.

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
  ["The tallest tower in Paris", "The tallest tower in Paris is the Eiffel Tower"],
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
  return { text: new TextDecoder().decode(out.bytes).replace(/\0+/g, "").trim(), c };
}

test("141.1 the fusion answers a query that was already paid for", async () => {
  const { text, c } = await counters(FUSING, "2+2 and the Eiffel Tower");
  assert.ok((c.fuseRuns ?? 0) >= 1, "the fusion ran");
  assert.equal(c.remainderBytes ?? 0, 0, "the question was paid at construction");
  assert.equal(c.closureDrainedBytes ?? 0, 0, "so nothing was consumed later");
  assert.match(text, /4/);
  assert.match(text, /Eiffel Tower/);
});

test("141.2 the walk extends an answer over a paid question", async () => {
  const { text, c } = await counters(CHAIN, "What is the capital of France famous for");
  assert.ok((c.reasonSteps ?? 0) >= 1, "the walk took a step");
  assert.equal(c.remainderBytes ?? 0, 0, "the question was paid at construction");
  assert.equal(c.closureDrainedBytes ?? 0, 0, "the step consumed none of it");
  assert.equal(text, "Paris is famous for the Eiffel Tower", "the chain answer");
});

test("141.3 the join reaches through a subject the question never wrote", async () => {
  const { text, c } = await counters(JOIN, "eva director country");
  assert.equal(c.remainderBytes ?? 0, 0, "the question was paid at construction");
  assert.equal(c.closureDrainedBytes ?? 0, 0);
  assert.equal(text, "The country of Gustaf Molander is Sweden.");
});
