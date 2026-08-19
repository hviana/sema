// 93-regime-prediction.test.mjs — the retrieval/composition regime (R8) is
// exposed as a structured trace step, without changing inference.
//
// After the FIRST mechanism runs (cover, which §2.6 places first and floors at
// 0), the market's whole outcome is already determined by the one cost ladder:
// `worthRunning(CONCEPT + STEP)` is false exactly when every remaining floor
// prunes (retrieval — the consensus climb will not run), and true otherwise
// (composition — the full market and the climb run).  The step is purely
// observational: it is built only under a trace (optional-chaining short-
// circuits it otherwise), and it never alters which candidate wins.  The
// assertions here check the payload's STRUCTURE and its consistency with the
// actual market outcome, never that inference itself changed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = (seed = 7) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:", D: 256 }) });

/** Collect the full step stream for one traced query. */
async function trace(mind, q) {
  const steps = [];
  const ans = await mind.respondText(q, (s) => steps.push(s));
  return { steps, ans };
}

function regimeStep(steps) {
  return steps.filter((s) => s.mechanism.at(-1) === "regimePrediction");
}

test("1. a fully-grounding query predicts retrieval, and the market prunes", async () => {
  const m = mk();
  await m.ingest([
    [
      "who wrote romeo and juliet",
      "William Shakespeare wrote Romeo and Juliet.",
    ],
  ]);
  const { steps } = await trace(m, "who wrote romeo and juliet");
  await m.store.close();

  const r = regimeStep(steps);
  assert.equal(r.length, 1, "exactly one regimePrediction step per response");
  const d = r[0].data;
  assert.equal(d.version, 1);
  assert.equal(d.regime, "retrieval");
  assert.ok(
    d.incumbentGrade <= d.maxFloorGrade,
    "incumbent grade at or under the max floor",
  );
  assert.equal(d.maxFloorGrade, 11, "CONCEPT + STEP = 11, in grade units");
});

test("2. an ungroundable query predicts composition with no incumbent", async () => {
  const m = mk();
  await m.ingest([["alpha", "beta"]]);
  const { steps } = await trace(m, "qzx zzjf vbnm plkj");
  await m.store.close();

  const r = regimeStep(steps);
  assert.equal(r.length, 1);
  assert.equal(r[0].data.regime, "composition");
  assert.equal(
    r[0].data.incumbentGrade,
    null,
    "nothing grounded — no incumbent",
  );
});

test("3. a partially-grounding query predicts composition (one unexplained byte outbids every floor)", async () => {
  const m = mk();
  await m.ingest([
    ["the capital of france", "The capital of France is Paris."],
  ]);
  const { steps } = await trace(m, "what is the capital of france");
  await m.store.close();

  const r = regimeStep(steps);
  assert.equal(r[0].data.regime, "composition");
  assert.ok(
    r[0].data.incumbentGrade > r[0].data.maxFloorGrade,
    `incumbent grade ${r[0].data.incumbentGrade} must exceed the max floor ` +
      `${r[0].data.maxFloorGrade} — PASS prices each unexplained byte at 1000`,
  );
});

test("4. the prediction is observational — an untraced response is byte-identical", async () => {
  const mk2 = () =>
    new Mind({
      seed: 7,
      store: new SQliteStore({ path: ":memory:", D: 256 }),
    });
  const q = "who wrote romeo and juliet";
  const corpus = [[
    "who wrote romeo and juliet",
    "William Shakespeare wrote Romeo and Juliet.",
  ]];

  const a = mk2();
  await a.ingest(corpus);
  const plain = await a.respondText(q);
  await a.store.close();

  const b = mk2();
  await b.ingest(corpus);
  const traced = await b.respondText(q, () => {});
  await b.store.close();

  assert.equal(traced, plain, "attaching a trace must not change the answer");
});
