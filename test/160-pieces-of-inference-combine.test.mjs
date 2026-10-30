// 160 — pieces of inference combine, whatever mechanism grounded them.
//
// A mechanism answers for the stretches of the question it explains.  One
// whose answer is a function of its one stretch alone declares it a PIECE
// (`MechanismResult.piece`), and the decider composes the question again with
// every piece in the one lightest-derivation search (composition.ts): the
// piece is fused, followed, recomposed or set beside a learnt rewrite exactly
// as a learnt form is.  The decider never asks which mechanism a piece came
// from — the first test registers a mechanism of its own, as any caller would.

import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultMechanisms, Mind } from "../dist/src/index.js";

const enc = (s) => new TextEncoder().encode(s);

/** A caller's mechanism: it reads `zz` as `XYZ`, a piece of the question. */
const zz = () => ({
  name: "zz",
  provenance: "zz",
  async floor(_ctx, query) {
    return new TextDecoder().decode(query).includes("zz") ? 1 : null;
  },
  async run(_ctx, query) {
    const at = new TextDecoder().decode(query).indexOf("zz");
    return [{ bytes: enc("XYZ"), accounted: [[at, at + 2]], moves: 1, piece: true }];
  },
});

test("160.1 a caller's piece and a learnt rewrite compose in one answer", async () => {
  const m = new Mind({ seed: 7, profile: true, mechanisms: [...defaultMechanisms, zz] });
  await m.ingest([["ice", "cold"]]);
  const r = await m.respond("ice zz");
  assert.equal(new TextDecoder().decode(r.bytes), "cold XYZ");
  assert.equal(r.provenance, "compose");
  assert.equal(m.lastCost.counters.composedGroundings, 1);
  await m.store.close();
});

test("160.2 a computation is a piece like any other: it composes and its node is followed", async () => {
  const m = new Mind({ seed: 7 });
  await m.ingest([["ice", "cold"]]);
  assert.equal(await m.respondText("ice 2+2"), "cold 4");
  await m.store.close();
  const n = new Mind({ seed: 7 });
  await n.ingest([["4", "four"]]);
  assert.equal(await n.respondText("2+2"), "four");
  await n.store.close();
});

test("160.3 an answer read off the whole question is no piece of it", async () => {
  // Recall answers `correct` for the stored `the answer is 4`, which the
  // question only resembles: composing it with the computed `4` voiced the 4
  // twice (`correct4`).  It stays whole, and wins whole.
  const m = new Mind({ seed: 7 });
  await m.ingest([["the answer is 4", "correct"]]);
  assert.equal(await m.respondText("the answer is 2+2"), "correct");
  await m.store.close();
});

test("160.4 a further topic is the market's answer to its own run of the question", async () => {
  // The fusion chooses the question's further topics (reasoning.ts); each is
  // answered by the market — every mechanism — over the run around its point
  // that primary did not price, never by one procedure chosen for topics.
  const corpus = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    ["The tallest tower in Paris", "The tallest tower in Paris is the Eiffel Tower"],
  ];
  const m = new Mind({ seed: 7 });
  await m.ingest(corpus);
  const asked = [];
  const ground = m.groundStretch.bind(m);
  m.groundStretch = async (q, run) => {
    const r = await ground(q, run);
    asked.push([
      new TextDecoder().decode(q.subarray(run[0], run[1])),
      r && new TextDecoder().decode(r),
    ]);
    return r;
  };
  const q = "2+2 and the Eiffel Tower";
  const first = await m.respondText(q);
  assert.deepEqual(asked, [[
    " and the Eiffel Tower",
    "The tallest tower in Paris is the Eiffel Tower",
  ]]);
  assert.ok(first.endsWith("The tallest tower in Paris is the Eiffel Tower"));
  // The nested question leaves the outer one's state as it found it.
  assert.equal(await m.respondText(q), first);
  await m.store.close();
});

test("160.5 a further topic is read with the question: no second climb", async () => {
  // The run's points are the question's within it (`attentionWithin`): the
  // nested question climbs nothing the question did not.  Read afresh, each
  // topic cost a climb of its own (and never nests: test/14).
  const corpus = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    ["The tallest tower in Paris", "The tallest tower in Paris is the Eiffel Tower"],
  ];
  const q = "2+2 and the Eiffel Tower";
  const run = async (topics) => {
    const m = new Mind({ seed: 7, profile: true });
    await m.ingest(corpus);
    if (!topics) m.groundStretch = async () => null;
    const a = await m.respondText(q);
    const c = m.lastCost.counters;
    await m.store.close();
    return { a, climbs: c.climbs, regions: c.climbRegions, topics: c.topicGroundings, fused: c.fuseRuns ?? 0 };
  };
  const [withTopic, without] = [await run(true), await run(false)];
  assert.equal(withTopic.a, "2+2 equals 4The tallest tower in Paris is the Eiffel Tower");
  assert.equal(withTopic.topics, 1);
  assert.equal(withTopic.fused, 1);
  assert.equal(withTopic.climbs, without.climbs);
  assert.equal(withTopic.regions, without.regions);
});

