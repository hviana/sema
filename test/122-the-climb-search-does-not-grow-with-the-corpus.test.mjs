// 122-the-climb-search-does-not-grow-with-the-corpus.test.mjs — the climb's own
// search must be flat in the corpus too.
//
// THE LAW, applied to the last path that was not measured.  test/119 pins the
// DERIVATION's work, test/121 the post-grounding extension.  The consensus climb
// runs a search of its own (`lightestDerivation` over a pooling DeductionSystem,
// attention.ts) and until item 3 of the open list that search was not even
// timed — its cost was invisible.  It is now a phase (`climb.derivation`), and
// the phase carries work-counter deltas, which is the honest growth measure: a
// millisecond reading is noise, a read count is work.
//
// MEASURED BEFORE THIS TEST EXISTED, one call per size, byte-identical answer:
//
//     N= 250 → climb.derivation: calls=1, counters {edgeProbes: 3, prevReads: 23}
//     N= 500 → climb.derivation: calls=1, counters {edgeProbes: 3, prevReads:  7}
//     N=1000 → climb.derivation: calls=1, counters {edgeProbes: 3, prevReads:  7}
//     N=2000 → climb.derivation: calls=1, counters {edgeProbes: 3, prevReads:  7}
//     searchPops = 338 at every size
//
// THE ASSERTION IS NON-GROWTH, WHICH IS WHAT THE LAW SAYS (`bounded-reads.md`: no
// per-query read grows with N) — not equality of counters, because `prevReads` is
// genuinely smaller at the larger sizes (23 → 7).  `searchPops` IS asserted equal,
// because that is what the measurement shows for this fixture.
//
// THE ANTI-VACUITY GUARD: `calls >= 1` at every size.  A flat curve for a phase
// that never ran would prove nothing, and a walk with no pivot does not enter it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const WORDS =
  ("alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima " +
    "mike november oscar papa").split(" ");

/** test/109's two-fact chain — the pivot is what crosses the hop — plus `n`
 *  unrelated pairs, exactly the fixture whose numbers are recorded above. */
const QUERY = "What is the capital of France famous for";

async function measure(n) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  const pairs = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
  ];
  for (let i = 0; i < n; i++) {
    pairs.push([
      `note ${i} about ${WORDS[i % 16]} ${WORDS[(i * 3) % 16]}`,
      `the ${WORDS[i % 16]} of ${WORDS[(i * 5) % 16]} is ${
        WORDS[(i * 7) % 16]
      } ${i}`,
    ]);
  }
  await mind.ingest(pairs);
  const answer = String(await mind.respondText(QUERY)).trim();
  const c = mind.lastCost;
  await store.close();
  const phase = (c.phases ?? {})["climb.derivation"];
  return {
    answer,
    calls: phase?.calls ?? 0,
    counters: phase?.counters ?? {},
    pops: c.counters?.searchPops ?? 0,
  };
}

test("a bigger corpus does not buy the climb's search more work", async () => {
  const base = 250;
  const runs = [];
  for (const mult of [1, 2, 4, 8]) {
    const r = await measure(base * mult);
    runs.push(r);
    console.log(
      `    N=${base * mult} → climb.derivation calls=${r.calls}, ` +
        `counters ${JSON.stringify(r.counters)}, pops ${r.pops}`,
    );
  }

  // ANTI-VACUITY: the phase must actually run at every size.
  for (const [i, r] of runs.entries()) {
    assert.ok(
      r.calls >= 1,
      `the climb's search must run at N=${base * 2 ** i} (calls=${r.calls})`,
    );
  }
  assert.equal(
    new Set(runs.map((r) => r.answer)).size,
    1,
    `the answer must not move with the corpus (got ${
      JSON.stringify(runs.map((r) => r.answer))
    })`,
  );

  // NON-GROWTH, counter by counter: what the search reads at 8N must not exceed
  // what it reads at N.  (A counter absent at the small size counts as 0.)
  const first = runs[0].counters;
  const last = runs[runs.length - 1].counters;
  for (const name of new Set([...Object.keys(first), ...Object.keys(last)])) {
    const a = first[name] ?? 0;
    const b = last[name] ?? 0;
    assert.ok(
      b <= a,
      `${name} grew with the corpus: ${a} at N=${base} → ${b} at N=${base * 8}`,
    );
  }

  // And the agenda pops of the whole response are identical across sizes.
  assert.equal(
    new Set(runs.map((r) => r.pops)).size,
    1,
    `agenda pops must not move (got ${
      JSON.stringify(runs.map((r) => r.pops))
    })`,
  );
});
