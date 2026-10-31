// 47-cast-comparison-coverage.test.mjs — CAST's analogical-comparison schema
// must not fire when its own accounted evidence leaves a substantial,
// contiguous stretch of the query untouched — the same half-dominance bar
// CAST's own frame gate and liftAnswer already apply, PLUS a topic-scale
// bar (see cast.ts's comparison-gate comment for why one alone isn't enough).
//
// Traced live (analyze_training.ts, dialogue D geography thread): "And what
// is the capital of Spain?" answered "The capital of France is Paris.What is
// the capital of Japan?\nTokyo is the capital of Japan." — a wrong analog.
// Root-caused directly against the live store: recognise() never finds a
// site for "capital of Spain" at all (a genuine extra word, "And ", not
// boundary noise — see the session's own investigation), so the consensus
// climb commits only ONE root (France) and CAST's comparison schema treats
// the query as "about one thing."
//
// The live numbers are the important part of this test: comparison's own
// accounted spans (dominant [0,30) + analog [77,88)) leave a 47-byte gap in
// the 94-byte query — exactly HALF, so the query-relative bar alone
// (dominates: strictly more than half) does NOT decisively refuse it; only
// the topic-relative bar (47 ≥ dominant's own 30-byte context) does.  This
// test pins the EXACT borderline shape, not an easier, more comfortably
// over-half one — a fix that only handled a clear majority-gap would still
// leave the live bug live.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { counterfactualTransfer } from "../dist/src/mind/mechanisms/cast.js";
import { gistOf, resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

test("CAST comparison: refuses to fire when its own accounted evidence leaves an exactly-half, topic-scale gap", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    [
      "some other prompt",
      "What is the capital of Japan? Tokyo is the capital of Japan.",
    ],
    [
      "What is the capital of Japan? Tokyo is the capital of Japan.",
      "Unrelated next quiz question.",
    ],
  ]);

  // The real accumulated multi-turn shape: dominant covers only the FIRST
  // 30 bytes (the France sentence); the rest of the query — including the
  // whole "And what is the capital of Spain?" tail — is never aligned to
  // anything beyond a bare 5-byte "Spain" token, mirroring the live case
  // where recognise() found nothing bigger for that span.
  const query = enc(
    "What is the capital of France?The capital of France is Paris." +
      "And what is the capital of Spain?",
  );
  const franceId = resolve(m, enc("What is the capital of France?"));
  const japanId = resolve(
    m,
    enc("What is the capital of Japan? Tokyo is the capital of Japan."),
  );
  assert.ok(franceId !== null && japanId !== null, "corpus must resolve");

  const dominant = {
    anchor: franceId,
    vote: 100,
    ctx: enc("What is the capital of France?"),
    runs: [{ qs: 0, qe: 30, cs: 0, weight: 1 }],
  };
  // Directly aligned, but its OWN evidence is just "capital of" (bytes
  // 77..88 of the 94-byte query) — the exact live span — not the whole
  // clause and not even the word "Spain" itself.
  const japanPoint = {
    anchor: japanId,
    vote: 50,
    ctx: enc("What is the capital of Japan? Tokyo is the capital of Japan."),
    runs: [{ qs: 77, qe: 88, cs: 0, weight: 1 }],
  };

  const pre = {
    attention: async () => ({
      roots: [
        {
          anchor: franceId,
          vote: 100,
          start: 0,
          end: 30,
          breadth: 1,
          clusters: 1,
        },
      ],
      ranked: [
        {
          anchor: franceId,
          vote: 100,
          start: 0,
          end: 30,
          breadth: 1,
          clusters: 1,
        },
        {
          anchor: japanId,
          vote: 50,
          start: 77,
          end: 88,
          breadth: 0.5,
          clusters: 1,
        },
      ],
    }),
    weave: async () => ({
      points: [dominant, japanPoint],
      depth: new Float64Array(query.length),
    }),
    rec: { sites: [] },
    guide: gistOf(m, query),
    k: 24,
  };

  const results = await counterfactualTransfer(m, query, pre);
  const comparison = results.find((r) =>
    dec(r.bytes).includes("Tokyo is the capital of Japan")
  );
  assert.ok(
    !comparison,
    `comparison should refuse when the largest gap (47 bytes) is exactly ` +
      `half the 94-byte query and at least as large as the 30-byte ` +
      `dominant, but fired: ${
        comparison ? JSON.stringify(dec(comparison.bytes)) : ""
      }`,
  );
  await m.store.close();
});

test("a comparison does not seat the question with one piece swapped as an analog", async () => {
  // `What is the largest planet in our solar system?` is the question `… the
  // largest country in our solar system?` with `planet` for `country` — a swap
  // the corpus licenses no equivalence for, so it is another question, not
  // something this one is about.  Seated against `The largest country is
  // Russia.` it voiced "The largest planet is Jupiter.The largest country is
  // Russia." in every earlier version.
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    [
      "What is the largest planet in our solar system?",
      "The largest planet is Jupiter.",
    ],
    [
      "What is the biggest ocean on Earth?",
      "The biggest ocean is the Pacific.",
    ],
    ["What is the largest country by area?", "The largest country is Russia."],
    [
      "What is the biggest mammal on Earth?",
      "The biggest mammal is the blue whale.",
    ],
    [
      "What is the largest desert in the world?",
      "The largest desert is the Sahara.",
    ],
    ["What is the biggest city in Japan?", "The biggest city is Tokyo."],
  ]);
  const got = new TextDecoder().decode(
    (await m.respond("What is the largest country in our solar system?")).bytes,
  );
  assert.ok(!got.includes("Jupiter"), `got "${got}"`);
  await m.store.close();
});

test("a comparison does not seat the question itself", async () => {
  // `Who painted The Gleaners?` is `Who painted the gleaners?` under the
  // response's equivalence: the question restated, not a structure it weaves.
  // Seated as the dominant it voiced two stored questions as the answer
  // ("Who painted The Gleaners?Where did the director of film The Gleaners
  // work?"), and outweighed the fact because a restatement accounts the whole
  // question.
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["Man at Bath", "Man at Bath is a painting by Gustave Caillebotte."],
    ["The Gleaners", "The Gleaners is a painting by Jean-François Millet."],
    ["Where did the director of film The Gleaners work?", "Barbizon"],
    ["Who painted The Gleaners?", "Jean-François Millet"],
  ]);
  const r = await m.respond("Who painted the gleaners?");
  assert.notEqual(r.provenance, "cast");
  assert.match(new TextDecoder().decode(r.bytes), /Millet/);
  await m.store.close();
});

// THE HALO TIER STANDS ALONE ONLY AT THE BAR THAT CLAIMS COMPANY.  CAST
// exempts halo-tier analogy evidence from the ignored-known principle, so the
// tier is held to the concept threshold — the bar every other halo claim is
// held to — not significanceBar, whose 3σ is the null of independent vectors
// (halos share the corpus's common company: on two 300-question stores
// unrelated node pairs cleared significanceBar on 2–5% of draws).  Company in
// the band between the two is a proposal: the pair is read by the
// shared-frame tier, under the comparison's own gates.
test("CAST analogy: halo company stands alone only at the concept threshold", async () => {
  const { significanceBar, conceptThreshold, cosine } = await import(
    "../dist/src/index.js"
  );
  const { analogyStrength } = await import("../dist/src/mind/match.js");
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    ["What is the capital of Italy?", "The capital of Italy is Rome."],
    ["What is the capital of Spain?", "The capital of Spain is Madrid."],
    ["Who wrote Hamlet?", "Hamlet was written by William Shakespeare."],
    ["Who wrote the Iliad?", "The Iliad was written by Homer."],
  ]);
  const sig = significanceBar(m.store.D), ct = conceptThreshold(m.store.D);
  const id = (s) => resolve(m, enc(s));
  const pair = async (a, b) => {
    const [x, y] = [id(a), id(b)];
    assert.ok(x !== null && y !== null, `${a} / ${b} learnt whole`);
    return {
      company: cosine(m.store.halo(x), m.store.halo(y)),
      ev: await analogyStrength(m, x, y),
    };
  };
  // Company beyond the concept threshold: the halo tier stands.
  const shared = await pair(
    "The capital of France is Paris.",
    "The capital of Italy is Rome.",
  );
  assert.ok(shared.company >= ct, `company ${shared.company}`);
  assert.equal(shared.ev.halo, true);
  // Company beyond chance for independent vectors, short of the concept
  // threshold: a proposal — the frame tier reads the pair.
  const band = await pair(
    "Hamlet was written by William Shakespeare.",
    "The Iliad was written by Homer.",
  );
  assert.ok(
    band.company >= sig && band.company < ct,
    `company ${band.company} in [${sig}, ${ct})`,
  );
  assert.equal(band.ev.halo, false);
  assert.ok(band.ev.score > 0, "the shared frame still reads the analogs");
});

// A SEAT THE QUESTION HOLDS WINDOW FOR WINDOW ECHOES IT.  A conjunction elides
// what its parts share: `What is the capital of France and the largest
// planet?` holds every window of the stored `What is the largest planet?`,
// none of it in one run, so the contiguous echo test missed it and the
// comparison voiced the stored question as the analog's role (every version
// measured).  An echoing seat gives way to its continuation, the answer the
// question asked for.
test("a comparison seat the question holds window for window is not voiced", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", " The capital of France is Paris."],
    ["What is the capital of Spain?", " The capital of Spain is Madrid."],
    ["What is the capital of Italy?", " The capital of Italy is Rome."],
    ["What is the largest planet?", " The largest planet is Jupiter."],
    ["What is the largest ocean?", " The largest ocean is the Pacific."],
  ]);
  const got = await m.respondText(
    "What is the capital of France and the largest planet?",
  );
  assert.ok(!got.includes("What is the largest planet?"), `got "${got}"`);
  assert.match(got, /Paris/);
  assert.match(got, /Jupiter/);
});

test("halo siblings are decided by the stored halos, not the index's estimate", async () => {
  // The halo index proposes siblings; its score is a RaBitQ estimate, and its
  // entry is refreshed only on the geometric mass schedule.  The concept bar
  // is a claim of identity of company, so the stored halos decide it: every
  // sibling carries its exact cosine, at the bar or above.
  const { conceptThreshold, cosine } = await import("../dist/src/index.js");
  const { haloSiblings } = await import("../dist/src/mind/match.js");
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    ["What is the capital of Italy?", "The capital of Italy is Rome."],
    ["What is the capital of Spain?", "The capital of Spain is Madrid."],
    ["Who wrote Hamlet?", "Hamlet was written by William Shakespeare."],
    ["Who wrote the Iliad?", "The Iliad was written by Homer."],
  ]);
  const bar = conceptThreshold(m.store.D);
  let seen = 0;
  for (const s of ["The capital of France is Paris.", "Who wrote Hamlet?"]) {
    const id = resolve(m, enc(s));
    for (const sib of await haloSiblings(m, id)) {
      const exact = cosine(m.store.halo(id), m.store.halo(sib.id));
      assert.ok(Math.abs(sib.score - exact) < 1e-6, `${sib.score} vs ${exact}`);
      assert.ok(exact >= bar, `${exact} < ${bar}`);
      seen++;
    }
  }
  assert.ok(seen > 0, "no sibling read");
});
