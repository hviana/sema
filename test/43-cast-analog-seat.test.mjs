// 43-cast-analog-seat.test.mjs — CAST's analogical-comparison schema must
// never chase an analog's own FORWARD continuation, whether the analog is
// a nextOf descendant or a directly aligned point.
//
// Traced live (analyze_training.ts, dialogue D geography thread): "And what
// is the capital of Spain?" answered "The capital of France is Paris.And
// what is the capital of the Moon?" — the comparison schema correctly
// identified "What is the capital of France?" as dominant and correctly
// found a genuine analog, "What is the capital of Japan?\nTokyo is the
// capital of Japan." (validated via analogyStrength, 0.7667) — a DIRECTLY
// aligned point (found in alignStructures' own output), not a nextOf
// descendant.  seatOfNode's forward branch fired on it: the analog node is
// already a complete, self-answering unit with prevCount 0 (no
// establishing predecessor either), and its SOLE forward edge is a wholly
// unrelated quiz question that happens to follow it in one training
// document ("And what is the capital of the Moon?") — landing one hop past
// the informative content that made it a genuine analog in the first
// place.
//
// Two related shapes, two fixes:
//   1. A nextOf DESCENDANT (AnalogCandidate.point === null, reached by
//      following another aligned point's own continuation edge — never
//      matched in the query) — its own bytes ARE its seat directly, no
//      projection at all (the module's own doc comment on the alignment
//      loop: "the hub's own [...] context will be the seat").
//   2. A DIRECTLY aligned point (point !== null, the live shape above) —
//      still goes through seatOfNode for its reverse-establishing check
//      (a bare entity NAME like "Leonardo da Vinci" needs it — test/29's
//      C2/C3), but with `allowForward: false`: the analog is only being
//      CITED for comparison, the query never asked about it, so chasing
//      its own further continuation is never appropriate — only reverse
//      context or its own bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { counterfactualTransfer } from "../dist/src/mind/mechanisms/cast.js";
import { gistOf, resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

test("CAST comparison: a nextOf-descendant analog is seated by its own bytes, not re-projected", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    // "some other prompt" stands in for whatever real aligned point's own
    // continuation edge reaches the self-contained analog below — in the
    // live trace this was reached through the query's own weave, not a
    // direct textual match, hence AnalogCandidate.point === null.
    ["some other prompt", "Japan capital is Tokyo."],
    // The coincidental further edge: the analog's OWN forward continuation,
    // unrelated to the comparison, mirroring "...capital of Japan?" being
    // followed by "...capital of the Moon?" in one training document.
    ["Japan capital is Tokyo.", "Unrelated next quiz question."],
  ]);

  const query = enc(
    "What is the capital of France? What is the capital of Spain?",
  );
  const franceId = resolve(m, enc("What is the capital of France?"));
  const spainAnalogSrcId = resolve(m, enc("some other prompt"));

  const dominant = {
    anchor: franceId,
    vote: 100,
    ctx: enc("What is the capital of France?"),
    runs: [{ qs: 0, qe: 30, cs: 0, weight: 1 }],
  };
  // The "Spain" point aligned in the query, whose OWN nextOf reaches the
  // self-contained Japan analog (via a real learnt edge) — this is what
  // makes the Japan node a nextOf descendant (point === null) rather than
  // a directly aligned point.
  const spainPoint = {
    anchor: spainAnalogSrcId,
    vote: 50,
    ctx: enc("some other prompt"),
    runs: [{ qs: 32, qe: 62, cs: 0, weight: 1 }],
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
          anchor: spainAnalogSrcId,
          vote: 50,
          start: 32,
          end: 62,
          breadth: 0.5,
          clusters: 1,
        },
      ],
    }),
    weave: async () => ({
      points: [dominant, spainPoint],
      depth: new Float64Array(query.length),
    }),
    rec: { sites: [] },
    guide: gistOf(m, query),
    k: 24,
  };

  const results = await counterfactualTransfer(m, query, pre);
  const comparison = results.find((r) =>
    dec(r.bytes).includes("Japan capital is Tokyo.")
  );
  assert.ok(
    comparison,
    `expected the comparison schema's own candidate among the results, got ` +
      results.map((r) => dec(r.bytes)),
  );
  assert.ok(
    !dec(comparison.bytes).includes("Unrelated next quiz question"),
    `the nextOf-descendant analog must not be re-projected past its own ` +
      `bytes, got "${dec(comparison.bytes)}"`,
  );
  await m.store.close();
});

test("CAST comparison: a DIRECTLY aligned analog is never re-projected past its own bytes", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    // The analog itself: an already-complete Q+A unit, mirroring the live
    // "What is the capital of Japan?\nTokyo is the capital of Japan." node
    // — matched DIRECTLY in the query this time (point !== null), not via
    // nextOf.
    [
      "some other prompt",
      "What is the capital of Japan? Tokyo is the capital of Japan.",
    ],
    // The analog's own coincidental further edge — an unrelated quiz
    // question, exactly the "capital of the Moon" shape.
    [
      "What is the capital of Japan? Tokyo is the capital of Japan.",
      "Unrelated next quiz question.",
    ],
  ]);

  // The query itself never mentions Japan at all — exactly the live shape:
  // "And what is the capital of Spain?" never contains Japan's text either;
  // the analog is found by STRUCTURAL (halo) similarity to the dominant,
  // not by a literal substring match — hence bestAnalog.point !== null
  // (a genuinely ALIGNED point, just not aligned by literal quotation).
  const query = enc(
    "What is the capital of France? What is the capital of Spain?",
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
  // Aligned to the "Spain" span of the query by halo similarity (not literal
  // quotation) — a directly aligned point, so bestAnalog.point !== null.
  const japanPoint = {
    anchor: japanId,
    vote: 50,
    ctx: enc("What is the capital of Japan? Tokyo is the capital of Japan."),
    runs: [{ qs: 32, qe: 62, cs: 0, weight: 1 }],
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
          start: 32,
          end: 62,
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
    comparison,
    `expected the comparison schema's own candidate among the results, got ` +
      results.map((r) => dec(r.bytes)),
  );
  assert.ok(
    !dec(comparison.bytes).includes("Unrelated next quiz question"),
    `a directly aligned analog must not be re-projected past its own ` +
      `bytes, got "${dec(comparison.bytes)}"`,
  );
  await m.store.close();
});
