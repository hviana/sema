// 48-recognise-turn-connective.test.mjs — recognise() must find a trained
// form even when the asker prepends a real discourse connective ("And ")
// to a follow-up turn — not boundary noise, a genuine extra word.
//
// Traced live (analyze_training.ts, dialogue D geography thread):
// "What is the capital of France?" then "And what is the capital of
// Spain?" answered with an unrelated CAST analog (Japan/Moon) instead of
// "Madrid is the capital of Spain." — root-caused directly against the
// live store: the turn "And what is the capital of Spain?" canon-misses as
// ONE 33-byte node (turn/segment scale); canonResolve on the WHOLE turn
// fails because "and " is real content, not an equivalence the injected
// canonicalizer folds away.  The shipped ±1/k-trim fallbacks are bounded to
// chunk-scale (<= W²) specifically to avoid rediscovering a smaller
// subtree's own content as a duplicate, overlapping site at root scale
// (see test/46's regression case) — but that bound also blocked recovering
// this turn, which is naturally larger than one chunk.
//
// Fix: a canon-miss composite ALSO tries canonResolve from every position
// UP TO W chunk-widths from its own left edge that the query's OWN
// structural fold already treats as a chunk boundary (`starts` — the same
// set the canonical pass privileges with full chain reach).  This is NOT a
// blind offset guess (the size-bounded k-trim loop above it already covers
// that): `starts.has(p)` is fold EVIDENCE the query itself produced —
// "And " is a genuine W=4-byte leaf-parent chunk, so its own end (byte 65)
// is already a `starts` boundary before this code ever runs (foldTree
// visits children before parents).  Unbounded in the NODE's size (turn/
// segment scale is fine), bounded in candidate COUNT (at most W probes,
// each an O(1) starts.has() before paying for the real canonResolve fold).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind, SQliteStore } from "../dist/src/index.js";
import { textCanon } from "../dist/src/canon.js";
import { recognise } from "../dist/src/mind/recognition.js";
import { latin1Key, perceive, resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b).replace(/\0+$/, "");

test("recognise(): a real leading connective word ('And ') still finds the trained follow-up form", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    ["What is the capital of Spain?", "Madrid is the capital of Spain."],
  ]);
  await m.buildCanonIndex(textCanon);
  m.canon = m._canonFor(textCanon);
  m.canonMemo = new Map();

  const query = enc(
    "What is the capital of France?The capital of France is Paris." +
      "And what is the capital of Spain?",
  );
  const expected = resolve(m, enc("What is the capital of Spain?"));
  assert.ok(
    expected !== null,
    "sanity: the trained fact must resolve standalone",
  );

  // The live shape is STABLE-PREFIX folded (each turn folds independently
  // from its own local offset 0 — see mind.ts's _growContext) so "And "
  // lands on a genuine chunk boundary; a plain fold of the whole query (no
  // boundaries) radix-aligns from byte 0 instead, which happens to reduce
  // this particular query to the already-shipped ±1 case and would not
  // exercise this fix at all.  Priming perceiveMemo with the boundary-aware
  // tree (content-keyed, exactly what _growContext itself does) makes this
  // recognise() call see what the real multi-turn pipeline sees, without
  // going through respondTurn's own memo (a second recognise() call on the
  // same bytes is deliberately non-idempotent — see recognise()'s own
  // doc comment — so this must be the FIRST call on this content).
  const boundaries = [30, 61];
  m.perceiveMemo = new Map();
  m.perceiveMemo.set(
    latin1Key(query),
    perceive(m, query, undefined, undefined, boundaries),
  );

  const rec = recognise(m, query);
  const hit = rec.sites.find((s) => s.payload === expected);
  assert.ok(
    hit,
    `expected a recognised site for the trained Spain fact despite the ` +
      `leading "And " connective, got sites: ` +
      JSON.stringify(rec.sites.map((s) => [s.start, s.end, s.payload])),
  );
  await m.store.close();
});

test("multi-turn: a follow-up turn prefixed with a real connective word grounds the NEW fact, not a CAST analog", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    ["What is the capital of Spain?", "Madrid is the capital of Spain."],
    [
      "some other prompt",
      "What is the capital of Japan? Tokyo is the capital of Japan.",
    ],
  ]);
  // The live store builds this at training time; respondTurn's own
  // automatic canon wiring (_canonFor) only wraps the canonicalizer
  // function — the INDEX canonResolve searches is a separate, opt-in
  // build step, same as test 44/46.
  await m.buildCanonIndex(textCanon);

  const conv = m.beginConversation();
  await m.respondTurn(conv, "What is the capital of France?");
  const r2 = await m.respondTurn(conv, "And what is the capital of Spain?");
  const got = dec(r2.response.bytes);

  assert.ok(
    got.includes("Madrid") && got.includes("Spain"),
    `expected the NEW Spain fact to ground the answer, got ${
      JSON.stringify(got)
    } (provenance: ${r2.response.provenance})`,
  );
  assert.ok(
    !got.includes("Japan") && !got.includes("Tokyo"),
    `must not fall back to an unrelated CAST analog, got ${
      JSON.stringify(got)
    }`,
  );

  m.endConversation(conv);
  await m.store.close();
});
