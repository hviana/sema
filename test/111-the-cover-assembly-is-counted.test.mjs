// 111-the-cover-assembly-is-counted.test.mjs — the connector assembly is
// countable without a rationale.
//
// WHY THIS EXISTS.  LIMIT (the study's gap 4): a hub query's `cover.run` is 91%
// of its time (`"Hello."`: 2.7 s of 3.0 s) and holds its ~270 MB peak, and none
// of it was countable — `searchPushes` (3130) and `candidates` (2) do not see
// the connector assembly, and the rationale perturbs the search.  `meter.ts` is
// the untraced view and the one home for a counter name (AGENTS §6).
//
// WHAT THE COUNTERS IMMEDIATELY SETTLED, and it is why they exist: `"Hello."`
// makes TWO bridge calls with 59 bytes of allowance — three orders of magnitude
// below its ~270 MB peak — so the connector assembly is NOT that peak.  A
// hypothesis dies to a counter instead of to an afternoon of profiling.
//
// WHAT IS PINNED.  Both counters are published, exercised by a fixture small
// enough to be a fixture (two touching contexts), and deterministic across
// identical calls.  They stay true whatever the LIMIT fix turns out to be.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

async function fixture(pairs) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(pairs);
  return mind;
}

test("the pairwise assembly is counted, with no rationale attached", async () => {
  // Two contexts that TOUCH in the query (`ab`|`cd`), so the cover must bridge
  // them pairwise.
  const mind = await fixture([
    ["ab", "x"],
    ["cd", "y"],
  ]);
  const out = await mind.respondText("abcd");
  const c = mind.lastCost?.counters ?? {};
  assert.ok(
    (c.coverBridges ?? 0) > 0,
    "the cover bridged touching sites, so the calls must be counted",
  );
  assert.ok(out.length > 0, "and the answer still composes");
  await mind.store.close();
});

test("the n-ary interior's allowance is counted", async () => {
  // Three sites in one query: the n-ary path passes an allowance that grows
  // with the intermediate answers' bytes — the quantity that would grow with a
  // hub query's answers.
  const mind = await fixture([
    ["ab", "x"],
    ["cd", "y"],
    ["ab cd", "z"],
  ]);
  await mind.respondText("ab cd");
  const c = mind.lastCost?.counters ?? {};
  assert.ok(
    (c.coverAllowanceBytes ?? 0) > 0,
    "the n-ary interior ran, so its allowance must be counted",
  );
  await mind.store.close();
});

test("the counters are deterministic across identical calls", async () => {
  const a = await fixture([["ab", "x"], ["cd", "y"]]);
  const b = await fixture([["ab", "x"], ["cd", "y"]]);
  await a.respondText("abcd");
  await b.respondText("abcd");
  assert.deepEqual(a.lastCost?.counters, b.lastCost?.counters);
  await a.store.close();
  await b.store.close();
});
