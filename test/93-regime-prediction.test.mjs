// 93-regime-prediction.test.mjs — the retrieval/composition regime (R8) is
// exposed as a structured trace step, without changing inference.
//
// After the FIRST mechanism runs (cover, which §2.6 places first and floors at
// 0), the market's whole outcome is already determined by the one cost ladder:
// the consensus climb runs exactly when `worthRunning(2 * STEP)` is true —
// CAST (floor 2·STEP) is the cheapest mechanism that first-touches it.  An
// incumbent at or below that floor prunes CAST and, with it, the climb
// (retrieval); anything above — or no incumbent — runs the full market and the
// climb (composition).  The step is purely observational: it is built only
// under a trace (optional-chaining short-circuits it otherwise), and it never
// alters which candidate wins.  The assertions here check the payload's
// STRUCTURE and its consistency with the actual market outcome, never that
// inference itself changed.

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
    d.incumbentGrade <= d.climbFloorGrade,
    "incumbent grade at or under the climb floor",
  );
  assert.equal(
    d.climbFloorGrade,
    2,
    "2·STEP = 2 (CAST's floor), in grade units",
  );
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
    r[0].data.incumbentGrade > r[0].data.climbFloorGrade,
    `incumbent grade ${r[0].data.incumbentGrade} must exceed the climb floor ` +
      `${
        r[0].data.climbFloorGrade
      } — PASS prices each unexplained byte at 1000`,
  );
});

test("5. a fully-covered multi-move query (grade above the climb floor) still predicts composition", async () => {
  // Three contiguous trained forms cover the whole query with three STEP moves
  // and NO unexplained bytes — incumbent grade 3, which the old
  // `worthRunning(CONCEPT + STEP)` boundary (≤ 11) mislabelled "retrieval"
  // even though CAST's 2·STEP floor still runs the consensus climb.  The
  // regime must follow the climb, not the market's maximum floor.
  const m = mk();
  await m.ingest([
    ["abcdefgh", "ABCDEFGH"],
    ["ijklmnop", "IJKLMNOP"],
    ["qrstuvwx", "QRSTUVWX"],
  ]);
  const { steps } = await trace(m, "abcdefghijklmnopqrstuvwx");
  await m.store.close();

  const r = regimeStep(steps);
  assert.equal(r.length, 1);
  const d = r[0].data;
  assert.equal(d.regime, "composition", "the climb runs, so it is composition");
  assert.ok(
    d.incumbentGrade > d.climbFloorGrade,
    `incumbent grade ${d.incumbentGrade} must exceed the climb floor ${d.climbFloorGrade}`,
  );
  // The prediction's own premise: the climb DID run (CAST first-touched it).
  const climbed = steps.some((s) => s.mechanism.at(-1) === "climbConsensus");
  assert.ok(climbed, "the consensus climb must actually run in this regime");
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
