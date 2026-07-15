import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const D = 1024;
const mk = async (facts = []) => {
  const m = new Mind({ seed: 7 });
  if (facts.length) await m.ingest(facts);
  return m;
};

const FACTS = [
  ["what is ice?", "ice is frozen water"],
  ["what is fire?", "fire is hot plasma"],
];

test("embedding of an empty store / empty input is null", async () => {
  const m = await mk();
  assert.equal(await m.embedding("anything at all"), null);
  const trained = await mk(FACTS);
  assert.equal(await trained.embedding(""), null);
});

test("embedding is a unit-length D-vector", async () => {
  const m = await mk(FACTS);
  const v = await m.embedding(FACTS[0][0]);
  assert.ok(v !== null, "known query must embed");
  assert.equal(v.length, D);
  let sq = 0;
  for (const x of v) sq += x * x;
  assert.ok(
    Math.abs(Math.sqrt(sq) - 1) < 1e-4,
    `expected unit norm, got ${Math.sqrt(sq)}`,
  );
});

test("embedding IS the gist of respond()'s root (same vector)", async () => {
  const m = await mk(FACTS);
  const emb = await m.embedding(FACTS[0][0]);
  const resp = await m.respond(FACTS[0][0]);
  assert.ok(emb !== null && resp.v !== null);
  assert.deepEqual([...emb], [...resp.v], "embedding must equal respond().v");
});

test("embedding is deterministic for the same input", async () => {
  const m = await mk(FACTS);
  const a = await m.embedding(FACTS[1][0]);
  const b = await m.embedding(FACTS[1][0]);
  assert.deepEqual([...a], [...b]);
});

test("a query embeds to the gist of its recalled answer", async () => {
  // embedding = gist of the answer's root, so a question's embedding coincides
  // with perceiving its learnt answer text directly.
  const m = await mk(FACTS);
  const q = await m.embedding("what is ice?");
  const answerGist = m.perceive("ice is frozen water").v;
  assert.ok(q !== null);
  assert.ok(
    cosine(q, answerGist) > 0.99,
    `expected answer gist, cosine=${cosine(q, answerGist)}`,
  );
});

test("distinct concepts embed apart", async () => {
  const m = await mk(FACTS);
  const ice = await m.embedding("what is ice?");
  const fire = await m.embedding("what is fire?");
  assert.ok(ice !== null && fire !== null);
  assert.ok(
    cosine(ice, fire) < 0.9,
    `expected separation, cosine=${cosine(ice, fire)}`,
  );
});
