import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const txt = (r) => new TextDecoder().decode(r.bytes).replace(/\u0000+/g, "");
const img = (n) => {
  const g = { width: 4, height: 4, channels: 1, data: new Uint8Array(16) };
  for (let i = 0; i < 16; i++) g.data[i] = (i * 13 + n * 41) & 0xff;
  return g;
};

test("a 2KB document roundtrips exactly", async () => {
  const m = new Mind({
    seed: 7,
  });
  const doc = ("memory is the model. " + "the river cuts by content. ").repeat(
    45,
  ).slice(0, 2048);
  const bytes = new TextEncoder().encode(doc);
  const t = await m.ingest(bytes);
  const out = await m.express(t.v);
  assert.deepEqual([...out], [...bytes]);
});

test("respond accepts raw bytes", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["what is ice?", "ice is frozen water"]]);
  const r = await m.respond(new TextEncoder().encode("what is ice?"));
  assert.equal(txt(r), "ice is frozen water");
});

test("an image can be a context: respond(image) → caption", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([[img(3), "a small grey cat"]]);
  assert.equal(await m.respondText(img(3)), "a small grey cat");
  // Unknown image: may return null or a closest approximation.
  const r = await m.respond(img(4));
  assert.ok(r.v !== undefined, "respond returns a valid response");
});

test("train([]) is a no-op that does not throw", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([]);
  assert.equal((await m.respond("anything")).v, null);
});

test("very long single-token inputs roundtrip correctly", async () => {
  const m = new Mind({
    seed: 7,
  });
  for (const n of [513, 1025]) {
    const bytes = new TextEncoder().encode("z".repeat(n));
    const t = await m.ingest(bytes);
    const out = await m.express(t.v);
    assert.equal(out.length, n);
    assert.ok([...out].every((b) => b === 122));
  }
});
