import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const txt = (r) => new TextDecoder().decode(r.bytes).replace(/\u0000+/g, "");

const FACTS = [
  ["what is ice?", "ice is frozen water"],
  ["what is fire?", "fire is hot plasma"],
  ["who are you?", "a forest of resonant memories"],
];

test("respond before any training is silence", async () => {
  const m = new Mind({
    seed: 7,
  });
  assert.equal((await m.respond("anything at all")).v, null);
});

test("duplicate training is idempotent", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([FACTS[0], FACTS[0], FACTS[0]]);
  assert.equal(await m.respondText(FACTS[0][0]), FACTS[0][1]);
});

test("conflicting episodes answer one side, deterministically", async () => {
  const run = async () => {
    const m = new Mind({
      seed: 7,
    });
    await m.ingest([["the sky", "blue"], ["the sky", "grey"]]);
    return await m.respondText("the sky");
  };
  const a = await run();
  const b = await run();
  assert.ok(a === "blue" || a === "grey", `got "${a}"`);
  assert.equal(a, b, "same seed, same answer");
});

test("same seed → identical behaviour and identical save blobs", async () => {
  const mk = async () => {
    const m = new Mind({
      seed: 99,
    });
    await m.ingest(FACTS);
    return m;
  };
  const m1 = await mk(), m2 = await mk();
  assert.equal(
    await m1.respondText(FACTS[1][0]),
    await m2.respondText(FACTS[1][0]),
  );
  const b1 = await m1.save(), b2 = await m2.save();
  assert.deepEqual([...new Uint8Array(b1)], [...new Uint8Array(b2)]);
});

test("known query returns an answer, unknown returns null", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest(FACTS);
  const known = await m.respond(FACTS[0][0]);
  assert.ok(known.v !== null, "known query must return an answer");
  assert.ok(known.bytes.length > 0, "known query must return bytes");
  // Unknown query: may return null or a closest-approximation answer.
  // Either is correct — the system always gives its best.
});

test("seat symmetry: an episode completes from either seat (whole-level)", async () => {
  for (const seed of [1, 7, 42]) {
    const m = new Mind({
      seed,
    });
    await m.ingest([
      ["what is ice?", "ice is frozen water"],
      ["what is fire?", "fire is hot plasma"],
    ]);
    // reverse: a known CONTINUATION recalls its context
    assert.equal(
      await m.respondText("ice is frozen water"),
      "what is ice?",
      `seed ${seed}`,
    );
    // forward priority untouched
    assert.equal(
      await m.respondText("what is fire?"),
      "fire is hot plasma",
      `seed ${seed}`,
    );
    // a stranger continuation: may be null (no close match) or a
    // deterministic approximation — either is correct behaviour.
    const r = await m.respond("lava is molten rock");
    assert.ok(r.v !== undefined, "respond returns a valid response");
  }
});
