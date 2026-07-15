// 28-unknowable.test.mjs — the reach threshold: silence for an unrelated query.
//
// When a query is structurally unrelated to everything in the store — its gist
// sits below the reach threshold (1 − 1/(2·maxGroup), half a river quantum) —
// the system returns null rather than fabricate an answer from spurious
// byte-level overlaps.  The validation is applied at every grounding site:
// consensus-climb anchors and last-resort whole-query hits alike.
//
// The assertions describe BEHAVIOUR only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";

const newMind = () => new Mind({ seed: 7 });

// ═══════════════════════════════════════════════════════════════════════
// Section A — a known query still answers (regression guard)
// ═══════════════════════════════════════════════════════════════════════

test("A1: a deposited fact is still recalled", async () => {
  const m = newMind();
  await m.ingest([
    ["what is ice?", "ice is frozen water"],
    ["what is fire?", "fire is hot plasma"],
    ["what is steam?", "steam is vaporised water"],
  ]);
  assert.equal(await m.respondText("what is ice?"), "ice is frozen water");
  await m.store.close();
});

test("A2: a paraphrased question still grounds", async () => {
  const m = newMind();
  await m.ingest([
    ["the capital of France is Paris", "Paris is the largest city in France"],
  ]);
  const r = await m.respond("what is the capital of France?");
  assert.notEqual(r.v, null);
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section B — an unrelated query returns null (the reach threshold)
// ═══════════════════════════════════════════════════════════════════════

test("B1: animal facts are silent on quantum physics", async () => {
  const m = newMind();
  await m.ingest([
    ["what is a cat?", "a cat is a small feline"],
    ["what is a dog?", "a dog is a loyal canine"],
    ["what do cats eat?", "cats eat meat and fish"],
  ]);
  const r = await m.respond("explain quantum chromodynamics");
  assert.equal(r.v, null);
  assert.equal(r.bytes.length, 0);
  await m.store.close();
});

test("B2: animal facts are silent on corporate finance", async () => {
  const m = newMind();
  await m.ingest([
    ["what is a cat?", "a cat is a small feline"],
    ["what is a dog?", "a dog is a loyal canine"],
    ["what do cats eat?", "cats eat meat and fish"],
  ]);
  const r = await m.respond(
    "describe the WACC calculation for cross-border M&A",
  );
  assert.equal(r.v, null);
  await m.store.close();
});

test("B3: determinism — same unrelated query, same silence, across runs", async () => {
  const run = async () => {
    const m = newMind();
    await m.ingest([
      ["roses are red", "violets are blue"],
      ["sugar is sweet", "and so are you"],
    ]);
    const r = await m.respond(
      "detailed analysis of relativistic time dilation in binary pulsar systems",
    );
    await m.store.close();
    return r.bytes.length;
  };
  assert.equal(await run(), 0);
  assert.equal(await run(), 0);
});
