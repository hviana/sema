// 150-the-join-is-output-sensitive.test.mjs — the join is priced for the facts
// a derivation STANDS ON, never for every fact the exploration REACHES.
//
// THE TRAP.  `deriveThrough` used to fire for every finalized out with a node.
// A chain hop forks across every continuation (trap 13: the offer is the
// corpus's own structure), so a form whose continuation is a hub reaches every
// one of that hub's fixpoints — and each paid an entity scan, and each join it
// fired was a new fact to scan.  Measured on the 31.7M-node store: a 46-byte
// dialogue query reached 2,000+ fixpoints in a minute and passed 10 GB.  It is
// the trap `recompleteNode` records, and the cure is `deepen`'s: the solve runs
// to its lightest derivation, licenses the facts THAT derivation stood on, and
// re-runs with their joins as ordinary rules, until no licensed fact joins.
//
// Pinned:
//   150.1 the facts priced do not grow with the hub's degree — the same query
//         over a hub of 8 continuations and of 32 prices the same facts;
//   150.2 the answer is unchanged by the degree (the derivation is the same).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

/** "hello" → "hi there" (one first hop), then "hi there" forks across `n`
 *  distinct replies — each a fixpoint fact the search reaches.  The filler
 *  raises the corpus scale N so the hop's READ cap (√N) admits all `n`: on a
 *  tiny store √N is 1–2 and no hub can be read at all.  Measured before the
 *  license: 35 facts scanned at n = 8, 59 at n = 32. */
async function hub(n) {
  const mind = new Mind({
    seed: 7,
    profile: true,
    store: new SQliteStore({ path: ":memory:" }),
  });
  const pairs = [["hello", "hi there"]];
  for (let k = 0; k < 1200; k++) {
    pairs.push([`filler question ${k}`, `filler answer ${k}`]);
  }
  for (let k = 0; k < n; k++) {
    pairs.push(["hi there", `reply number ${k} talks about topic ${k}.`]);
  }
  await mind.ingest(pairs);
  return mind;
}

test("150.1 the join prices the derivation's facts, not the hub's", async () => {
  const priced = [];
  const answers = [];
  for (const n of [8, 32]) {
    const mind = await hub(n);
    // The tail is bytes nothing learnt, so the cover is expensive and the
    // search reaches every fixpoint of the hub before it settles.
    answers.push(await mind.respondText("hello zqxv wbjk"));
    const c = mind.lastCost.counters;
    assert.ok(c.joinFacts > 0, "the derivation's facts are priced");
    priced.push(c.joinFacts);
    await mind.store.close();
  }
  assert.equal(
    priced[1],
    priced[0],
    `facts priced grew with the hub's degree: ${priced.join(" → ")}`,
  );
  // 150.2 — the degree changes what the search REACHES, not what it chose.
  assert.equal(answers[1], answers[0]);
});
