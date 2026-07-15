// 32-confluence.test.mjs — the Confluence Join: conjunctive queries.
//
// THE CLASS: answers that are stored in NO single fact and exist only as the
// INTERSECTION of independent evidence streams.  "Which material is
// translucent and featherlight?" — each property reaches its own exemplars;
// the entity satisfying BOTH lives exactly where the streams meet.  A path-
// following mechanism cannot answer this (any one path grounds one
// constraint), and fusion answers it WRONG (one fact per constraint, from
// different entities).  Confluence intersects the aligned exemplars across
// constraints and returns the discriminative content they share, gated by
// the same structural IDF the attention climb derives — so it can only ever
// name content that byte-literally exists in two independently learnt facts:
// it cannot fabricate.
//
// Every filler in these corpora is ≥ maxGroup bytes (the literal-alignment
// quantum), the same constraint CAST's weave detection lives under.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = (seed = 7) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });
const ask = async (m, q) =>
  (await m.respondText(q)).replace(/\s+/g, " ").trim();

// A small materials corpus: each entity has two properties; every property
// is shared with a distractor entity, so NO single constraint identifies
// anything — only the intersection does.
const materials = [
  ["Porcelain is translucent", "translucent"],
  ["Porcelain is featherlight", "featherlight"],
  ["Aluminium is featherlight", "featherlight"],
  ["Aluminium is waterproof", "waterproof"],
  ["Cast iron is waterproof", "waterproof"],
  ["Cast iron is translucent", "translucent"],
];

// ═══════════════════════════════════════════════════════════════════════════
// Section A — two-constraint entity resolution
// ═══════════════════════════════════════════════════════════════════════════

test("A1 — the entity satisfying BOTH constraints is found, not a one-constraint distractor", async () => {
  const m = mk();
  await m.ingest(materials);

  // translucent ∩ featherlight = Porcelain (Aluminium is featherlight but
  // not translucent; Cast iron is translucent but not featherlight).
  const got = await ask(m, "Which material is translucent and featherlight?");
  assert.ok(
    /Porcelain/i.test(got),
    `expected the intersection entity Porcelain, got "${got}"`,
  );
  assert.ok(
    !/Aluminium|Cast iron/i.test(got),
    `a one-constraint distractor leaked into the answer: "${got}"`,
  );
  await m.store.close();
});

test("A2 — each pairing resolves to ITS intersection (the join is not a lucky top anchor)", async () => {
  const m = mk();
  await m.ingest(materials);

  const cases = [
    [/featherlight.*waterproof|waterproof.*featherlight/, "Aluminium"],
    [/waterproof.*translucent|translucent.*waterproof/, "Cast iron"],
  ];
  const got1 = await ask(m, "Which material is featherlight and waterproof?");
  assert.ok(/Aluminium/i.test(got1), `expected Aluminium, got "${got1}"`);
  assert.ok(!/Porcelain/i.test(got1), `distractor leaked: "${got1}"`);

  const got2 = await ask(m, "Which material is waterproof and translucent?");
  assert.ok(/Cast iron/i.test(got2), `expected Cast iron, got "${got2}"`);
  assert.ok(!/Aluminium/i.test(got2), `distractor leaked: "${got2}"`);
  await m.store.close();
});

test("A3 — constraint order does not change the intersection", async () => {
  const m = mk();
  await m.ingest(materials);

  const got = await ask(m, "Which material is featherlight and translucent?");
  assert.ok(
    /Porcelain/i.test(got),
    `expected Porcelain regardless of constraint order, got "${got}"`,
  );
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Section B — honesty: an empty intersection must not fabricate
// ═══════════════════════════════════════════════════════════════════════════

test("B1 — no entity satisfies both: the join must not invent a pairing", async () => {
  const m = mk();
  await m.ingest([
    ["Porcelain is translucent", "translucent"],
    ["Aluminium is waterproof", "waterproof"],
    ["Obsidian is razor sharp", "razor sharp"],
  ]);

  // Nothing is both translucent and waterproof — the intersection is empty.
  // Whatever fallback answers, it must not ASSERT the false conjunction.
  const got = await ask(m, "Which material is translucent and waterproof?");
  assert.ok(
    !/Porcelain is waterproof|Aluminium is translucent/i.test(got),
    `a fabricated conjunction was asserted: "${got}"`,
  );
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Section C — cross-domain: the same meet works on relational facts
// ═══════════════════════════════════════════════════════════════════════════

test("C1 — who did BOTH things: conjunctive resolution over biographical facts", async () => {
  const m = mk();
  await m.ingest([
    ["Leonardo painted the Mona Lisa", "the Mona Lisa"],
    ["Leonardo designed flying machines", "flying machines"],
    ["Raphael painted the School of Athens", "the School of Athens"],
    ["Brunelleschi designed the great dome", "the great dome"],
  ]);

  const got = await ask(
    m,
    "Who painted the Mona Lisa and designed flying machines?",
  );
  assert.ok(/Leonardo/i.test(got), `expected Leonardo, got "${got}"`);
  assert.ok(
    !/Raphael|Brunelleschi/i.test(got),
    `a one-constraint distractor leaked: "${got}"`,
  );
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Section D — non-interference: single-constraint queries keep their path
// ═══════════════════════════════════════════════════════════════════════════

test("D1 — a single-constraint query still answers through the ordinary pipeline", async () => {
  const m = mk();
  await m.ingest(materials);

  const got = await ask(m, "Porcelain is translucent");
  assert.ok(
    got.length > 0 && !/Aluminium|Cast iron/i.test(got),
    `single-fact query degraded: "${got}"`,
  );
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Section E — seed independence (approximate resonance must not decide)
// ═══════════════════════════════════════════════════════════════════════════

test("E1 — the intersection is seed-independent (it is exact, not resonant)", async () => {
  for (const seed of [1, 7, 42, 99]) {
    const m = mk(seed);
    await m.ingest(materials);
    const got = await ask(
      m,
      "Which material is translucent and featherlight?",
    );
    assert.ok(
      /Porcelain/i.test(got) && !/Aluminium|Cast iron/i.test(got),
      `seed ${seed}: expected Porcelain, got "${got}"`,
    );
    await m.store.close();
  }
});
