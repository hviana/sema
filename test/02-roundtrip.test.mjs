import { test } from "node:test";
import assert from "node:assert/strict";
import { hilbertBytes, Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const txt = (r) => new TextDecoder().decode(r.bytes).replace(/\u0000+/g, "");

test("random byte streams roundtrip exactly", async () => {
  const m = new Mind({
    seed: 11,
  });
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s % 256);
  for (let t = 0; t < 20; t++) {
    const len = 1 + (t * 17) % 180;
    const bytes = new Uint8Array(len);
    for (let j = 0; j < len; j++) bytes[j] = rnd();
    const tree = await m.ingest(bytes);
    const out = await m.express(tree.v);
    assert.deepEqual([...out], [...bytes], `trial ${t} len ${len}`);
  }
});

test("text roundtrips: unicode, emoji, whitespace, the full byte table, runs", async () => {
  const m = new Mind({
    seed: 7,
  });
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = i;
  const cases = [
    "hello world",
    "naïve café — émigré: ¿señor? Übermensch",
    "数据是雨水，记忆是河流。",
    "🌊🧠 memory is the model 🜁",
    "line one\nline two\ttabbed\r\nwindows line",
    "a".repeat(300),
    "ab".repeat(150),
  ];
  for (const c of cases) {
    const bytes = new TextEncoder().encode(c);
    const t = await m.ingest(bytes);
    const out = await m.express(t.v);
    assert.deepEqual([...out], [...bytes], JSON.stringify(c.slice(0, 20)));
  }
  const t = await m.ingest(table);
  const out = await m.express(t.v);
  assert.deepEqual([...out], [...table], "byte table");
});

test("images roundtrip through one root vector", async () => {
  const m = new Mind({
    seed: 7,
  });
  const mk = (w, h, ch) => {
    const g = {
      width: w,
      height: h,
      channels: ch,
      data: new Uint8Array(w * h * ch),
    };
    for (let i = 0; i < g.data.length; i++) g.data[i] = (i * 7 + 3) & 0xff;
    return g;
  };
  for (const g of [mk(8, 8, 1), mk(16, 16, 1), mk(8, 8, 3)]) {
    const want = hilbertBytes(g);
    const t = await m.ingest(g);
    const out = await m.express(t.v);
    assert.deepEqual(
      [...out],
      [...want],
      `${g.width}x${g.height}x${g.channels}`,
    );
  }
});

test("empty input is graceful silence", async () => {
  const m = new Mind({
    seed: 7,
  });
  const r = await m.respond("");
  assert.equal(r.v, null);
  assert.equal(r.bytes.length, 0);
});

test("content keys are injective for arbitrary bytes", async () => {
  // A separator byte between parts is not injective: with `\0` between them,
  // (`A\0`, `B`) and (`A`, `\0B`) share a key, and two different
  // substitutions would share one licence.  Every multi-part content key is
  // length-prefixed (`bytesKey`), and the perceive memo tags its two shapes.
  const { bytesKey } = await import("../dist/src/bytes.js");
  const { perceiveKey } = await import("../dist/src/mind/primitives.js");
  const b = (...xs) => new Uint8Array(xs);
  assert.notEqual(bytesKey(b(65, 0), b(66)), bytesKey(b(65), b(0, 66)));
  assert.notEqual(bytesKey(b(49), b()), bytesKey(b(), b(49)));
  assert.notEqual(perceiveKey(b(65, 0, 49)), perceiveKey(b(65), [1]));
  assert.notEqual(perceiveKey(b(49, 58, 65)), perceiveKey(b(65), [1]));
});
