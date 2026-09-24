// 136-the-two-named-limits.test.mjs — the two sites the extraction LEAVES ALONE,
// pinned so that changing them requires the measurement the report says is
// missing.
//
// The investigation found two places where the architecture's own reading and
// the code's reading differ, and the plan's rule is: register, prove, decide
// whether it is a bug, decide whether it is a consequence, and ONLY THEN propose
// a change.  Neither has been proven a bug, so neither was changed -- and these
// two assertions exist so that the next person cannot change them by accident,
// believing they are tidying up:
//
//   136.1 THE FUSE GATE KEEPS ITS OWN READING.  It decides with the TOTAL
//   unaccounted bytes against one quantum, while the state's `remainder` is
//   per-span by construction.  The two readings AGREE unless every gap is below
//   one quantum and their sum is at or above it -- and that construction is what
//   nobody has built, so switching the gate to the state's own `closed` would
//   change an answer no one has measured.  The assertion therefore pins both
//   halves: that the two readings DO differ on that construction (so the reason
//   lives in the test and not only in a comment), and that the gate still uses
//   the total.
//
//   136.2 THE EXTENSION IS NOT PRICED.  The reasoner reports what its steps cost
//   and what they accounted for, and the caller never folds that into the
//   decided candidate: the candidate's weight is the ladder formula alone.  This
//   is a DIVERGENCE between the documented intent and the implementation, on
//   purpose un-fixed: pricing it would change which grounding wins, and that
//   comparison has not been measured.  The assertion pins the current arithmetic
//   on a fixture where the walk really takes a step (guarded), so folding the
//   cost in breaks it and forces the measurement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const law = await import("../dist/src/mind/derivation.js");
const { STEP, PASS } = await import("../dist/src/mind/graph-search.js");
const { Mind, SQliteStore } = await import("../dist/src/index.js");

test("136.1 the fuse gate keeps its own reading, and the two readings differ", async () => {
  // THE DISCRIMINATING CONSTRUCTION, from the law's own functions: a query whose
  // accounted spans leave only sub-quantum gaps, whose SUM is at or above one
  // quantum.  The total reading opens the gate; the per-span reading closes it.
  const W = 4;
  const len = 12;
  const explained = [[0, 3], [6, 9]];
  const gaps = law.unexplainedSpans(len, explained);
  assert.deepEqual(
    gaps,
    [[3, 6], [9, 12]],
    "the construction must leave exactly the two sub-quantum gaps",
  );
  const total = law.unaccountedBytes(gaps);
  const perSpan = law.remainderOf(len, explained, W);
  assert.ok(total >= W, `the total reading opens the gate: ${total} >= ${W}`);
  assert.deepEqual(
    perSpan,
    [],
    "the per-span reading closes it — which is the whole reason this is not a cleanup",
  );

  // AND THE GATE STILL USES THE TOTAL.  A source-shape pin, in the shape test/126
  // and test/123 already establish: the gate's condition must not be the state's
  // `closed`.
  const src = await readFile(join(here, "..", "src", "mind", "pipeline.ts"), "utf8");
  assert.match(
    src,
    /const remainder = unaccounted\(explained\);/,
    "the fuse gate's own reading (TOTAL unaccounted bytes) is gone — if it was " +
      "replaced by the state's per-span `closed`, build the discriminating " +
      "fixture above in a real corpus, measure both readings' answers, and then " +
      "update this test",
  );
  const gate = src.slice(src.indexOf("const remainder = unaccounted(explained);"));
  const fused = gate.slice(0, gate.indexOf("? reasoned"));
  assert.ok(
    !/closed\(/.test(fused),
    "the fuse gate now asks the state's `closed`, which is the per-span reading: " +
      "that is a BEHAVIOUR change on the construction above, and it needs the " +
      "measurement before the test",
  );
});

test("136.2 the extension is not priced", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
  ]);
  const steps = [];
  await mind.respondText("What is the capital of France famous for", (s) => steps.push(s));
  const counters = mind.lastCost?.counters ?? {};
  const dg = steps.filter((s) => Array.isArray(s.data?.candidates)).pop()?.data;
  const winner = dg?.candidates.find((c) => c.decided);
  await store.close();

  // THE VACUITY GUARD: the walk must really have taken a step, or the equality
  // below would hold for a response that never extended anything.
  assert.ok(
    (counters.reasonSteps ?? 0) >= 1,
    `the fixture must take at least one extension step, got ${counters.reasonSteps}`,
  );
  assert.ok(winner, "the response must publish its decided candidate");
  assert.equal(
    winner.weight,
    STEP + PASS * winner.unexplainedBytes,
    "the winning candidate's weight is now something other than the ladder " +
      "formula on its own accounting — most likely the extension's cost was " +
      "folded in.  That is a behaviour change: measure what pricing the " +
      "extension does to the suite's answers and counters, then update this test",
  );
});
