// 107-the-join-is-counted.test.mjs — the join's outcome is observable WITHOUT a
// rationale.
//
// WHY THIS EXISTS.  Everything known about the fact join's refusals came from
// the rationale, and the rationale PERTURBS the search: appending text to a
// refusal note changed the answer of a traced response (measured, 386293e), and
// the "key leads nowhere" refusal chased for four rounds turned out to be a
// trace artifact — untraced, every refusal is a missing KEY, never a key whose
// continuation is missing: a key that leads nowhere is not the relation at all,
// so the scan moves on and there is no counter for it (the branch that reported
// it was unreachable, and an adversarial review said so).
// A work counter is the untraced view, and `meter.ts` is its one home
// (AGENTS §6: a counter name exists in exactly one place).
//
// WHAT IS PINNED.  The four outcomes are published in the cost report with no
// rationale attached.  The assertions stay TRUE when the join is fixed — they
// check that the counters exist, that a join that fires is counted as fired, and
// that a query whose join does not fire reports WHY in the counters — never that
// a particular refusal still happens.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const F1 = "The director of Eva is Gustaf Molander.";
const F2 = "The country of Gustaf Molander is Sweden.";
const F3 = "The capital of Sweden is Stockholm.";

async function chain() {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["eva", F1],
    ["eva director", F1],
    ["gustaf molander", F2],
    ["gustaf molander country", F2],
    ["sweden", F3],
    ["sweden capital", F3],
  ]);
  return mind;
}

const counters = (mind) => mind.lastCost?.counters ?? {};

test("a join that fires is counted, with no rationale attached", async () => {
  const mind = await chain();
  await mind.respondText("eva director country"); // no inspectRationale
  const c = counters(mind);
  assert.ok(
    (c.joinFired ?? 0) > 0,
    "the join reached the second fact, so it must be counted as fired",
  );
  await mind.store.close();
});

test("a query whose join does not fire reports WHY, untraced", async () => {
  const mind = await chain();
  await mind.respondText("eva director country capital"); // no rationale
  const c = counters(mind);
  const refusals = (c.joinNoKey ?? 0) + (c.joinNoEntity ?? 0);
  assert.ok(
    refusals > 0,
    "a join that did not fire must say so in the counters",
  );
  await mind.store.close();
});

test("the counters are deterministic across identical calls", async () => {
  const a = await chain();
  const b = await chain();
  await a.respondText("eva director country capital");
  await b.respondText("eva director country capital");
  assert.deepEqual(
    counters(a),
    counters(b),
    "same query + same store ⇒ same counted work",
  );
  await a.store.close();
  await b.store.close();
});
