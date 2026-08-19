// 94-cross-region-budget.test.mjs — the cross-region junction ladder shares ONE
// k·W allowance per evidence tier once atoms are hubs, instead of letting each
// candidate pair spend its own √N·W drift budget (attention.ts crossRegionVotes,
// §2.17's derived gate = traverse.atomIsHub).
//
// This is a PERFORMANCE regression test, not a behaviour test: the shared
// budget is byte-identical at every scale — a pair whose container is not
// reached within the allowance falls through to the resonance tier exactly as a
// per-pair walk that exhausted its own budget would — so the only observable is
// the meter's junctionPops counter.  A ~4.3k-fact fixture is NOT optional:
// atomIsHub is false in every small-store suite, so a conventional fixture
// would pass while the per-pair drift (measured: 160k junction pops, 31% of
// think) is fully present.  The atomIsHub assertion below fails loudly if the
// crossover ever moves, so this suite can never silently stop covering the
// branch it exists for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { atomIsHub, corpusN } from "../dist/src/mind/traverse.js";

test("crossRegion shares one k·W allowance per tier once atoms are hubs", async () => {
  const m = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
    profile: true,
  });

  // Common windows, each in ≤ √N contexts so the hub guard does NOT abstain —
  // a non-hub cone is exactly the drift the shared budget must bound.  Three
  // such windows ("aaaa", "bbbb", "cccc") that never co-occur give the query
  // below three strong regions and three pairs, every one of whose junction
  // walks drifts through both windows' cones and finds no container.
  const per = 60;
  const corpus = [];
  for (const w of ["aaaa", "bbbb", "cccc"]) {
    for (let i = 0; i < per; i++) corpus.push([`${w} ${i}`, `a ${w} ${i}`]);
  }
  // Filler edge sources push N past atomIsHub (N > ~4096 at maxGroup=4).
  for (let i = 0; i < 4300; i++) corpus.push([`filler-${i}`, `f${i}`]);
  await m.ingest(corpus);

  const N = corpusN(m);
  assert.ok(
    atomIsHub(m, N),
    `fixture must cross atomIsHub (N=${N}); the shared budget is scale-gated ` +
      `and this suite would otherwise assert nothing`,
  );

  await m.respondText("aaaa bbbb cccc");

  const c = m.lastCost;
  const crossPops = c.phases["climb.crossRegion"]?.counters.junctionPops ?? 0;
  const k = m.cfg.recallQueryK * 2; // pre.k — the ladder's pair budget breadth
  const W = m.space.maxGroup;

  assert.ok(crossPops > 0, "the query must actually run cross-region walks");
  assert.ok(
    crossPops <= 2 * k * W,
    `crossRegion junction pops ${crossPops} must stay within the shared ` +
      `2·k·W = ${2 * k * W} allowance (exact + synonym tiers), not the ` +
      `per-pair √N·W drift`,
  );

  await m.store.close();
});
