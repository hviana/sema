// 113-the-rationale-payload-is-bounded.test.mjs — a step reports a BOUNDED
// sample and the COUNT, never the whole field.
//
// THE GAP THIS CLOSES.  The study measured a rationale step carrying 1082 items
// and another 1559 — the hub's degree and `hubBound`'s own size, both on the
// trained store.  The step that does it is `disambiguate`: it weighed a hub's
// continuations and emitted EVERY candidate it considered as an output item.
// A rationale that carries the entire field is not an explanation, it is a dump:
// what explains the choice is the pick, the count that says how wide the field
// was, and a bounded sample of what it was chosen from.
//
// WHAT IS PINNED, and neither number is invented here:
//   1. the sample is bounded by the DECLARED candidate budget (`recallQueryK`,
//      config.ts — a capacity/budget, which is all that file holds);
//   2. the note still carries the TOTAL, so nothing is lost — measured in the
//      fixture below: 27 continuations weighed, 12 itemised;
//   3. the choice itself is untouched (the inputs still name the pick).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { DEFAULT_CONFIG } from "../dist/src/config.js";

// The DECLARED capacity, read from the config — no number is copied here.
const BUDGET = DEFAULT_CONFIG.rationaleSampleK;

const WORDS =
  ("alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima " +
    "mike november oscar papa quebec romeo sierra tango uniform victor whiskey " +
    "xray yankee zulu amber bronze copper dahlia ember fjord gossamer harbour " +
    "indigo jasmine kestrel lantern marigold nectar opal pewter quartz ripple " +
    "saffron thistle umber violet willow xenon yarrow").split(" ");

/** A hub of 40 continuations, plus filler so `hubBound` exceeds the budget. */
async function hub() {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  // RECALL's budget is deliberately enormous: the rationale's sample must not
  // follow it (found by an adversarial review — sharing `recallQueryK` meant
  // this very setting un-bounded the payload).
  const mind = new Mind({
    seed: 7,
    store,
    profile: true,
    recallQueryK: 100000,
  });
  const w = (i, n) => WORDS[(i * 7 + n * 13) % WORDS.length];
  const pairs = [];
  for (let i = 0; i < 40; i++) {
    pairs.push(["beta", `continuation number ${i} of this hub`]);
  }
  for (let i = 0; i < 900; i++) {
    pairs.push([
      `${w(i, 1)} ${w(i, 2)} ${w(i, 3)} ${i}`,
      `${w(i, 4)} ${w(i, 5)} ${w(i, 6)} ${w(i, 7)} ${i}`,
    ]);
  }
  await mind.ingest(pairs);
  return mind;
}

test("a step reports a bounded sample, and the count of the whole field", async () => {
  const mind = await hub();
  const steps = [];
  await mind.respondText("beta", (s) => steps.push(s));
  const dis = steps.filter((s) => s.mechanism.at(-1) === "disambiguate");
  assert.ok(dis.length > 0, "the fixture must make the decider weigh a hub");
  const step = dis[0];
  const outs = step.outputs ?? [];
  assert.ok(
    outs.length <= BUDGET,
    `the sample must fit the declared budget, got ${outs.length}`,
  );
  const total = Number(
    /(\d+)\s+continuations/.exec(String(step.note))?.[1] ?? 0,
  );
  assert.ok(total > 0, "the note must say how wide the field was");
  assert.ok(
    total >= outs.length,
    "the count is the WHOLE field, not the sample",
  );
  assert.equal((step.inputs ?? []).length, 1, "the pick is still named");
  await mind.store.close();
});
