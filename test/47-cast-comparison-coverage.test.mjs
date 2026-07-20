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
