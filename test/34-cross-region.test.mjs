// 34-cross-region.test.mjs — DIRECT REGION-TO-REGION INTERACTION (binding).
//
// Sema's attention lets each region of the query vote INDEPENDENTLY for the
// context it climbs to, then POOLS the votes additively (poolVotes).  Additive
// pooling is a soft conjunction: when two regions each cast a vote that
// includes a shared context, that context accumulates and wins.  But pooling
// can only ever surface a context that at least ONE region already votes for.
//
// The gap this exercises — the "binding problem": a context that NO single
// region votes for, reachable only by letting two regions interact DIRECTLY.
// With cross-cutting attributes (colour × shape → answer), each attribute
// alone is ambiguous across two contexts, and — crucially — each region's own
// resonance climbs to a DIFFERENT context than the joint one.  So the joint
// context receives zero independent votes and additive pooling can never
// reach it; only composing the two regions can.
//
//   red circle → alpha     red square → beta
//   blue circle → gamma    blue square → delta
//
// "red" alone attends to `red square`; "circle" alone attends to `circle`.
// Neither reaches `red circle`.  A query naming both, non-adjacently
// ("red then circle"), MUST attend to `red circle` — and that requires the
// two regions to interact.
//
// ── Why these assertions are on climbAttention, not respondText ────────────
// The mechanism lives IN attention: its contract is the set of contexts the
// query attends to.  Asserting there tests the mechanism itself, and — unlike
// an end-to-end respondText assertion — the assertion FLIPS with the
// mechanism: without region interaction the query provably attends to the
// wrong context (`red square`), with it to the joint one (`red circle`).
// (End-to-end voicing of a scattered-attribute query is a separate
// articulation concern and is deliberately not conflated here.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) =>
  new TextDecoder().decode(b.filter((x) => x !== 0)).replace(/\s+/g, " ")
    .trim();

// Attributes are trained as standalone forms too, so each is RECOGNISED as a
// whole-form region (a site) in the query — otherwise a 6-byte word like
// "circle" fragments across the 4-byte chunk grid and never forms one clean
// region to compose with.
const CORPUS = [
  ["red", "is a color"],
  ["blue", "is a color"],
  ["circle", "is a shape"],
  ["square", "is a shape"],
  ["red circle", "answer alpha"],
  ["red square", "answer beta"],
  ["blue circle", "answer gamma"],
  ["blue square", "answer delta"],
];

const mk = (seed) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

/** The contexts the query attends to, most-dominant first, as text. */
async function attends(m, q) {
  const roots = await m.climbAttention(enc(q), 24);
  return roots.map((r) => dec(m.store.bytesPrefix(r.anchor, 1e9)));
}

// The mechanism is content-addressed and therefore seed-independent; running
// several seeds guards against a fragile (seed-sensitive) approximation
// passing by luck.
const SEEDS = [1, 2, 3, 7, 11];

// ═══════════════════════════════════════════════════════════════════════════
// THE NEED — no single region reaches the joint context.
//
// If either attribute alone already attended to `red circle`, additive pooling
// would suffice and no interaction would be needed.  It does not: each single
// attribute climbs elsewhere.  This is what makes the binding query below
// UNREACHABLE without direct region interaction.
// ═══════════════════════════════════════════════════════════════════════════

test("need: neither attribute alone attends to the joint context", async () => {
  for (const seed of SEEDS) {
    const m = mk(seed);
    await m.ingest(CORPUS);
    const red = await attends(m, "red");
    const circle = await attends(m, "circle");
    assert.ok(
      !red.includes("red circle"),
      `seed ${seed}: "red" alone must not reach the joint context, got [${red}]`,
    );
    assert.ok(
      !circle.includes("red circle"),
      `seed ${seed}: "circle" alone must not reach the joint context, got [${circle}]`,
    );
    await m.store.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// THE REQUIREMENT — the binding query attends to the joint context.
//
// "red" and "circle" fall into non-adjacent regions; each individually climbs
// to a different context (`red square`, `circle`).  Only by composing the two
// regions does the JOINT context `red circle` become a point of attention.
// ═══════════════════════════════════════════════════════════════════════════

test("binding: two non-adjacent attributes attend to their JOINT context", async () => {
  for (const seed of SEEDS) {
    const m = mk(seed);
    await m.ingest(CORPUS);
    const got = await attends(m, "red then circle");
    assert.equal(
      got[0],
      "red circle",
      `seed ${seed}: "red then circle" must attend to the JOINT context ` +
        `"red circle" (the only fact with BOTH attributes), got [${got}]`,
    );
    await m.store.close();
  }
});

test("binding is symmetric: the other cross-cut also composes", async () => {
  for (const seed of SEEDS) {
    const m = mk(seed);
    await m.ingest(CORPUS);
    const got = await attends(m, "blue then square");
    assert.equal(
      got[0],
      "blue square",
      `seed ${seed}: "blue then square" must attend to "blue square", got [${got}]`,
    );
    await m.store.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// WRONG-WORLD GUARD — composition must not manufacture a context the two
// attributes do NOT jointly evidence.  "red then circle" shares "circle" with
// the blue world, but nothing red-and-blue was ever learnt together: the joint
// evidence is for the RED circle, never a blue one.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ORDER-FREEDOM — a junction evidences that two forms were LEARNT TOGETHER;
// which one the query happens to mention first is a fact about the query, not
// about the learnt whole.  "circle then red" reverses the stored order of
// `red circle` and must still compose to it.
// ═══════════════════════════════════════════════════════════════════════════

test("binding is order-free: reversed mention still composes", async () => {
  for (const seed of SEEDS) {
    const m = mk(seed);
    await m.ingest(CORPUS);
    const got = await attends(m, "circle then red");
    assert.equal(
      got[0],
      "red circle",
      `seed ${seed}: "circle then red" must attend to "red circle" even ` +
        `though the query reverses the stored order, got [${got}]`,
    );
    await m.store.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// N-ARY BINDING — binding is not intrinsically pairwise.  With THREE
// cross-cutting attributes every PAIR is still ambiguous (each pair appears in
// two contexts); only the triple picks out one.  A pairwise-only mechanism
// tops out at the two-context pair container; n-ary selection must reach the
// unique triple.
// ═══════════════════════════════════════════════════════════════════════════

const CORPUS3 = [
  ["red", "is a color"],
  ["blue", "is a color"],
  ["big", "is a size"],
  ["small", "is a size"],
  ["circle", "is a shape"],
  ["square", "is a shape"],
  ["red big circle", "answer a"],
  ["red big square", "answer b"],
  ["red small circle", "answer c"],
  ["red small square", "answer d"],
  ["blue big circle", "answer e"],
  ["blue big square", "answer f"],
  ["blue small circle", "answer g"],
  ["blue small square", "answer h"],
];

test("binding is n-ary: three cross-cutting attributes reach their unique triple", async () => {
  for (const seed of SEEDS) {
    const m = mk(seed);
    await m.ingest(CORPUS3);
    const got = await attends(m, "red then big then circle");
    assert.equal(
      got[0],
      "red big circle",
      `seed ${seed}: "red then big then circle" must attend to the unique ` +
        `TRIPLE context "red big circle" (every pair is ambiguous), got [${got}]`,
    );
    await m.store.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CORPUS INDEPENDENCE — binding must not require attributes to have been
// TRAINED STANDALONE.  Without the standalone rows no attribute is a
// recognised site: "circle" fragments across the 4-byte chunk grid.  But the
// fragments are stored chunks that vote, and their BYTES still compose — the
// junction ascent matches byte containment, so the fragment pair evidences
// the same joint container the whole word would.  (This also exercises
// explaining-away: the grid shard " cir" exists verbatim only in `blue
// circle` — pure alignment accident — and its aliased vote must be
// superseded by the exact joint evidence, not left to outvote it.)
// ═══════════════════════════════════════════════════════════════════════════

const CORPUS_FACTS_ONLY = [
  ["red circle", "answer alpha"],
  ["red square", "answer beta"],
  ["blue circle", "answer gamma"],
  ["blue square", "answer delta"],
];

test("corpus independence: binding composes from grid fragments, no standalone training", async () => {
  for (const seed of SEEDS) {
    const m = mk(seed);
    await m.ingest(CORPUS_FACTS_ONLY);
    const got = await attends(m, "red then circle");
    assert.equal(
      got[0],
      "red circle",
      `seed ${seed}: without standalone attribute rows, "red then circle" ` +
        `must still attend to "red circle" via fragment composition, got [${got}]`,
    );
    await m.store.close();
  }
});

test("guard: binding does not leak into a non-jointly-evidenced world", async () => {
  for (const seed of SEEDS) {
    const m = mk(seed);
    await m.ingest(CORPUS);
    const got = await attends(m, "red then circle");
    assert.ok(
      !got.some((c) => c.startsWith("blue")),
      `seed ${seed}: "red then circle" must not attend to any blue-world ` +
        `context, got [${got}]`,
    );
    await m.store.close();
  }
});
