import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// A small test image: 4×4 grayscale, deterministic pixels.
const img = (seed) => {
  const d = new Uint8Array(16);
  for (let i = 0; i < 16; i++) d[i] = (i * 13 + seed * 41) & 0xff;
  return { width: 4, height: 4, channels: 1, data: d };
};

test("two names, one concept: knowledge crosses languages at recall time", async () => {
  const m = new Mind({
    seed: 7,
  });

  await m.ingest([
    ["ice", "ice is frozen water"],
    [img(1), "ice"],
    [img(2), "ice"],
    [img(1), "hielo"],
    [img(2), "hielo"],
  ]);

  assert.equal(await m.respondText("hielo"), "hielo is frozen water");
  assert.equal(await m.respondText("ice"), "ice is frozen water");
});

test("three names fuse and all transfer", async () => {
  const m = new Mind({
    seed: 7,
  });

  await m.ingest([
    ["ice", "ice is frozen water"],
    [img(1), "ice"],
    [img(2), "ice"],
    [img(1), "hielo"],
    [img(2), "hielo"],
    [img(1), "eis"],
    [img(2), "eis"],
  ]);

  for (const n of ["hielo", "eis"]) {
    assert.equal(await m.respondText(n), n + " is frozen water", n);
  }
});

test("no shared company, no concept: negatives stay strangers", async () => {
  const m = new Mind({
    seed: 7,
  });

  await m.ingest([
    ["ice", "ice is frozen water"],
    [img(1), "ice"],
    [img(2), "ice"],
    [img(7), "lava"],
    [img(8), "lava"],
  ]);

  const r = await m.respond("lava");
  assert.ok(r.v !== null, "lava echoes its own grounding");
  assert.equal(await m.respondText("ice"), "ice is frozen water");
});

test("concepts survive save/load", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const m = new Mind({ seed: 7, store });

  await m.ingest([
    ["ice", "ice is frozen water"],
    [img(1), "ice"],
    [img(2), "ice"],
    [img(1), "hielo"],
    [img(2), "hielo"],
  ]);

  await m.save();
  const m2 = await Mind.loadFromStore(store);
  assert.equal(await m2.respondText("hielo"), "hielo is frozen water");
  await store.close();
});
