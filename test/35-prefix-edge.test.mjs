// test/35-prefix-edge.test.mjs — RC7: right-edge suffix inheritance
//
// When ingestPair learns C → D, every right-aligned byte suffix of C
// that is already a known form inherits the edge.  Gate: ≥ 2 structural
// parents, or (halo > 0 ∧ already an edge source).  Pure answers do
// not qualify — they are destinations, not sources.
//
// All phrases verified via instrumentation first (see MISTAKES.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { resolve } from "../dist/src/mind/primitives.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const text = (b) => dec.decode(b.filter((x) => x !== 0));
const mk = (s = 7) =>
  new Mind({ seed: s, store: new SQliteStore({ path: ":memory:" }) });

// Establish via pair (gives halo mass).  The second deposit where the
// form appears as a fold-tree constituent gives ≥ 1 structural parent.
async function establish(m, phrase) {
  await m.ingest([phrase, "established"]);
}

test("A1 — right-aligned known suffix gains edge", async () => {
  const m = mk();
  await establish(m, "planet in our solar system");
  const sid = resolve(m, enc.encode("planet in our solar system"));

  await m.ingest([
    "What is the largest planet in our solar system",
    "Jupiter.",
  ]);
  const next = m.store.nextFirst(sid, 10).map((n) => text(m.store.bytes(n)));
  assert.ok(next.some((s) => s.includes("Jupiter")));
  await m.store.close();
});

test("A2 — suffix NOT previously known gets NO edge", async () => {
  const m = mk();
  const before = m.store.edgeSourceCount();
  await m.ingest(["What is the largest planet", "Jupiter."]);
  assert.equal(m.store.edgeSourceCount() - before, 1);
  await m.store.close();
});

test("A3 — unestablished ≥ W suffix does NOT inherit", async () => {
  const m = mk();
  const before = m.store.edgeSourceCount();
  // "prefix abcd" has "abcd" as a ≥W suffix, but it was never established.
  await m.ingest(["prefix abcd", "answer"]);
  // Only the full context should be a new edge source — no suffix edge.
  assert.equal(m.store.edgeSourceCount() - before, 1);
  await m.store.close();
});

test("B1 — inherited edge is present after propagation", async () => {
  const m = mk();
  await establish(m, "largest planet in our solar system");
  await m.ingest([
    "What is the largest planet in our solar system",
    "Jupiter.",
  ]);
  const sid = resolve(m, enc.encode("largest planet in our solar system"));
  const next = m.store.nextFirst(sid, 10).map((n) => text(m.store.bytes(n)));
  assert.ok(next.some((s) => s.includes("Jupiter")));
  await m.store.close();
});

test("B2 — bidirectional pair via suffix inheritance", async () => {
  const m = mk();
  await establish(m, "thank you");
  await establish(m, "merci");
  await m.ingest(["translates to merci", "thank you"]);
  await m.ingest(["translates to thank you", "merci"]);

  const sid = resolve(m, enc.encode("thank you"));
  const next = m.store.nextFirst(sid, 10).map((n) => text(m.store.bytes(n)));
  // The establish edge ("established") is still there, but the inherited
  // edge ("merci") must ALSO be present.
  assert.ok(next.some((s) => s.includes("merci")));
  await m.store.close();
});
