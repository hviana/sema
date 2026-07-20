// 50-cast-analog-consensus-floor.test.mjs — CAST's analogical comparison
// must not voice content the query never named through a climb root whose
// consensus vote is below consensusFloor(N) = ln(N) + 1/2 — the SAME trust
// bar recallByResonance applies before grounding through a climb root.
//
// The live bug (traced on the real trained store, 325k edge sources, floor
// 13.2): "Tell me the name of the biggest planet orbiting our sun." shares
// only stopword scraps ("the", "our", generic bigrams) with an unrelated
// haiku exemplar; those scraps pooled a climb vote of just 1.92, yet the
// climb still committed the exemplar as FIRST root (the first root is
// deliberately floor-free in attention.ts — "the dominant one always
// grounds").  CAST's comparison schema then cited an analog reached through
// a continuation hop (never named by the query), and voiced the haiku's
// continuation ("Winds of change blow free…") as the answer — a wrong
// answer where recall, extraction, and the ALU all honestly refused.
//
// The gate (cast.ts): comparison may cite a hop-reached (unnamed) analog
// only when some committed root's vote clears consensusFloor(N); a
// DIRECTLY aligned analog (the query's own bytes evidence it, e.g. test/29
// C1's "Steel is hard") needs no floor.  Derived, never tuned — the floor
// is the one recall.ts already gates the same trust decision with.
//
// This miniature reproduces the exact shape: ~200 filler pairs whose LONG
// contexts (longer than the probe query) can never be direct analogs, so
// their short continuations arrive only as continuation-hop descendants;
// the exemplar's distinctive words also occur across fillers, diluting its
// root vote below the floor (measured: 4.24 and 5.51 against floor 5.81)
// while it still ranks first and commits floor-free.  Confirmed red at
// baseline: both probes echoed the haiku continuation with provenance
// "cast"; with the gate both are honest silence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const dec = (b) => new TextDecoder().decode(b).replace(/\0+$/, "");

const subjects = [
  "cat",
  "dog",
  "bird",
  "fish",
  "horse",
  "sheep",
  "goat",
  "duck",
  "frog",
  "deer",
  "wolf",
  "bear",
  "lion",
  "tiger",
  "mouse",
  "rabbit",
  "otter",
  "eagle",
  "shark",
  "whale",
];
const verbs = [
  "describes",
  "praises",
  "watches",
  "follows",
  "studies",
  "admires",
  "draws",
  "paints",
  "names",
  "sings",
];
const objects = [
  "freedom",
  "feeling",
  "titles",
  "songs",
  "times",
  "stories",
  "poems",
  "rivers",
  "shadows",
  "seasons",
];

const TRAIN = [];
for (const s of subjects) {
  for (const v of verbs) {
    const o =
      objects[(subjects.indexOf(s) + verbs.indexOf(v)) % objects.length];
    TRAIN.push([
      `The ${s} quietly ${v} the many ${o} it meets today in the wide green garden.`,
      `Indeed the ${s} ${v} ${o}.`,
    ]);
  }
}
TRAIN.push([
  "Create a haiku that describes the feeling of freedom.",
  "Winds of change blow free\nFeeling of lightness fills my soul",
]);

// SHORT filler contexts: continuations become directly ALIGNED points, so
// the junk analog arrives with frame-tier similarity as an aligned point —
// the configuration the consensusFloor/naming gates alone cannot separate
// from test/29 C1's legitimate small-corpus comparison.  The separator is
// the IGNORED-KNOWN principle (dismissedKnownContent): under an untrusted
// root, a frame-tier comparison must account for every STORED window of
// the query — here "songs"/"times"/"planet"-class trained content is left
// in gaps, so comparison refuses; C1's gaps ("How ", " like ") are
// untrained and stay tolerable.  Confirmed red at baseline: both probes
// echoed the haiku + a filler continuation with provenance "cast".
const SHORT_TRAIN = [];
for (const s of subjects) {
  for (const v of verbs) {
    const o =
      objects[(subjects.indexOf(s) + verbs.indexOf(v)) % objects.length];
    SHORT_TRAIN.push([
      `The ${s} ${v} the ${o} today.`,
      `Indeed the ${s} ${v} ${o}.`,
    ]);
  }
}
SHORT_TRAIN.push([
  "Create a haiku that describes the feeling of freedom.",
  "Winds of change blow free\nFeeling of lightness fills my soul",
]);

test("comparison refuses an aligned frame-tier analog that dismisses stored query content", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(SHORT_TRAIN);
  for (
    const q of [
      "Give me the title of the finest song describing our times.",
      "Tell me the name of the biggest planet orbiting our sun.",
    ]
  ) {
    const r = await m.respond(q);
    const t = dec(r.bytes);
    assert.equal(
      t,
      "",
      `expected honest silence for ${JSON.stringify(q)}, got ${
        JSON.stringify(t)
      }`,
    );
  }
  await m.store.close();
});

test("comparison refuses a hop-reached analog under a below-floor root", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(TRAIN);

  // Neither query names any trained fact — the corpus knows nothing about
  // songs, titles, or planets.  The only honest answer is silence; at
  // baseline both echoed the haiku exemplar's continuation via CAST.
  for (
    const q of [
      "Give me the title of the finest song describing our times.",
      "Tell me the name of the biggest planet orbiting our sun.",
    ]
  ) {
    const r = await m.respond(q);
    const t = dec(r.bytes);
    assert.ok(
      !t.includes("Winds of change"),
      `CAST voiced an unrelated exemplar's continuation off a below-floor ` +
        `root for ${JSON.stringify(q)}, got ${JSON.stringify(t)}`,
    );
    assert.equal(
      t,
      "",
      `expected honest silence for ${JSON.stringify(q)}, got ${
        JSON.stringify(t)
      }`,
    );
  }
  await m.store.close();
});
