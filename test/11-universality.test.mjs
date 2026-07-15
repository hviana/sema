import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const img = (n) => {
  const g = { width: 4, height: 4, channels: 1, data: new Uint8Array(16) };
  for (let i = 0; i < 16; i++) g.data[i] = (i * 13 + n * 41) & 0xff;
  return g;
};

// The mechanism has no concept of language: perception cuts bytes by
// outline, recall completes episodes, thinking rewrites licensed parts.
// These tests assert the LAW — same behaviour regardless of script,
// script-mixing, or where in the stream a known part stands.

const TABLE = [
  ["1+2", "3"],
  ["2+2", "4"],
  ["2+3", "5"],
  ["3+3", "6"],
  ["3+5", "8"],
  ["4+3", "7"],
  ["2+5", "7"],
  ["1+5", "6"],
  ["6+1", "7"],
  ["4+1", "5"],
];
const txt = (r) => new TextDecoder().decode(r.bytes).replace(/\u0000+/g, "");

test("concepts fuse across scripts: 氷 + hielo + ice", async () => {
  for (const seed of [1, 7, 42]) {
    const m = new Mind({
      seed,
    });
    await m.ingest([
      ["ice", "ice is frozen water"],
      [img(1), "ice"],
      [img(2), "ice"],
      [img(1), "hielo"],
      [img(2), "hielo"],
      [img(1), "氷"],
      [img(2), "氷"],
    ]);
    assert.equal(
      await m.respondText("氷"),
      "氷 is frozen water",
      `seed ${seed}`,
    );
    assert.equal(
      await m.respondText("hielo"),
      "hielo is frozen water",
      `seed ${seed}`,
    );
  }
});

test("a known part answers wherever it stands, whatever surrounds it", async () => {
  // Frame language and fact position are irrelevant to the law. Before
  // the byte-window glance, mid-stream facts answered on ~2/8 seeds and
  // stream-initial on 8/8 — a position accident posing as capability.
  const frames = [
    "2+2 equals what?",
    "¿cuánto es 2+2 dime?",
    "2+2 は何ですか",
    "dime 2+2 は何 please",
  ];
  for (const seed of [1, 7, 42, 99]) {
    const m = new Mind({
      seed,
    });
    await m.ingest(TABLE);
    for (const q of frames) {
      assert.equal(txt(await m.respond(q)), "4", `seed ${seed} "${q}"`);
    }
  }
});

// ARTICULATION — the production-direction half of the concept law.
// Recognition settles any name onto its gist (comprehension crosses
// names inward); articulation chooses, among gist-equal forms, the
// ASKER's form (production crosses names outward). No translation
// machinery: the conceive merge read outward.

const ground = (name, a, b) => [
  [img(a), name],
  [img(b), name],
];

test("the answer speaks in the asker's name — across scripts", async () => {
  for (const seed of [1, 7, 42]) {
    const m = new Mind({
      seed,
    });
    await m.ingest([
      ["ice", "ice is frozen water"],
      ...ground("ice", 1, 2),
      ...ground("hielo", 1, 2),
      ...ground("氷", 1, 2),
    ]);
    assert.equal(
      await m.respondText("hielo"),
      "hielo is frozen water",
      `seed ${seed}`,
    );
    assert.equal(
      await m.respondText("氷"),
      "氷 is frozen water",
      `seed ${seed}`,
    );
    assert.equal(
      await m.respondText("ice"),
      "ice is frozen water",
      `seed ${seed} own name unchanged`,
    );
  }
});

test("a name inside a mixed-script frame voices the answer", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([
    ["ice", "ice is frozen water"],
    ...ground("ice", 1, 2),
    ...ground("氷", 1, 2),
  ]);
  assert.equal(await m.respondText("¿qué es 氷 ahora?"), "氷 is frozen water");
});

test("question-level + word-level concepts compose: cross-language QA, fully voiced", async () => {
  for (const seed of [1, 7, 42]) {
    const m = new Mind({
      seed,
    });
    await m.ingest([
      ["what is ice?", "ice is frozen water"],
      ...ground("what is ice?", 5, 6),
      ...ground("¿qué es hielo?", 5, 6),
      ...ground("ice", 1, 2),
      ...ground("hielo", 1, 2),
    ]);
    assert.equal(
      await m.respondText("¿qué es hielo?"),
      "hielo is frozen water",
      `seed ${seed}`,
    );
  }
});

test("the floor does not name: single-byte forms never voice", async () => {
  // digit answers can over-fuse by halo resemblance ({6,7}); a query's
  // operand must never re-voice the answer
  const TABLE = [
    ["1+2", "3"],
    ["2+2", "4"],
    ["2+3", "5"],
    ["3+3", "6"],
    ["3+5", "8"],
    ["4+3", "7"],
    ["2+5", "7"],
    ["1+5", "6"],
    ["6+1", "7"],
    ["4+1", "5"],
  ];
  for (const seed of [1, 7, 42]) {
    const m = new Mind({
      seed,
    });
    await m.ingest(TABLE);
    for (const [q, want] of [["6+1", "7"], ["2+5", "7"], ["1+5", "6"]]) {
      const r = await m.respond(q);
      const got = new TextDecoder().decode(r.bytes).replace(/\u0000+/g, "");
      assert.ok(
        r.v === null || got === want,
        `seed ${seed} "${q}" -> "${got}"`,
      );
    }
  }
});
