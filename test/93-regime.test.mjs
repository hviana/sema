// 93-regime.test.mjs — the retrieval/composition regime (R8) is exposed as a
// structured trace step, read off the response itself.
//
// Composition is the response whose market ran the consensus climb; retrieval
// decided without it.  The step names no mechanism and predicts from no
// mechanism's floor: it reports what the response did, so it holds whatever
// mechanisms the market registers.  It is purely observational — built only
// under a trace — and never alters which candidate wins.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = (seed = 7) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:", D: 256 }) });

/** The regime step of one traced query, checked against the climb itself. */
async function regimeOf(corpus, q) {
  const m = mk();
  await m.ingest(corpus);
  const steps = [];
  await m.respondText(q, (s) => steps.push(s));
  await m.store.close();
  const r = steps.filter((s) => s.mechanism.at(-1) === "regime");
  assert.equal(r.length, 1, "exactly one regime step per response");
  const d = r[0].data;
  assert.equal(d.version, 2);
  const climbed = steps.some((s) => s.mechanism.at(-1) === "climbConsensus");
  assert.equal(d.regime, climbed ? "composition" : "retrieval");
  return d;
}

test("1. a fully-grounding query is retrieval: no climb ran", async () => {
  const d = await regimeOf(
    [[
      "who wrote romeo and juliet",
      "William Shakespeare wrote Romeo and Juliet.",
    ]],
    "who wrote romeo and juliet",
  );
  assert.equal(d.regime, "retrieval");
  assert.ok(d.incumbentGrade !== null && d.incumbentGrade <= 2);
});

test("2. an ungroundable query is composition with no incumbent", async () => {
  const d = await regimeOf([["alpha", "beta"]], "qzx zzjf vbnm plkj");
  assert.equal(d.regime, "composition");
  assert.equal(d.incumbentGrade, null, "nothing grounded — no incumbent");
});

test("3. a partially-grounding query is composition (an unexplained byte outbids the climb)", async () => {
  const d = await regimeOf(
    [["the capital of france", "The capital of France is Paris."]],
    "what is the capital of france",
  );
  assert.equal(d.regime, "composition");
});

test("4. the regime is observational — an untraced response is byte-identical", async () => {
  const q = "who wrote romeo and juliet";
  const corpus = [[q, "William Shakespeare wrote Romeo and Juliet."]];
  const a = mk();
  await a.ingest(corpus);
  const plain = await a.respondText(q);
  await a.store.close();
  const b = mk();
  await b.ingest(corpus);
  const traced = await b.respondText(q, () => {});
  await b.store.close();
  assert.equal(traced, plain, "attaching a trace must not change the answer");
});

test("5. a fully-covered multi-move query still climbs, and says so", async () => {
  const d = await regimeOf(
    [["abcdefgh", "ABCDEFGH"], ["ijklmnop", "IJKLMNOP"], [
      "qrstuvwx",
      "QRSTUVWX",
    ]],
    "abcdefghijklmnopqrstuvwx",
  );
  assert.equal(d.regime, "composition");
});
