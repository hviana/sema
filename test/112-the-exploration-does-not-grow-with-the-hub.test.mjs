// 112-the-exploration-does-not-grow-with-the-hub.test.mjs — LIMIT: what a hop
// OFFERS is bounded by the question, not by the corpus's fan-out.
//
// THE GAP THIS CLOSES.  `hubBound` = √N is the READ cap — every read stays
// inside it — but it is not an EXPLORATION bound.  Measured on the trained
// store: a hub of degree 1083 sits BELOW √N = 1559, so a chain hop offered all
// 1083 continuations, the chart grew to 3113 outs for a two-word question, and
// because every out with an uncovered tail probes its tail's prefixes, that one
// query spent 16 885 canonical probes (87% of its work), a 270 MB peak and an
// OOM at a 256 MB heap.  The cost came from OFFERING, not from reading.
//
// THE RULE, derived and not tuned: a derivation of L hops consumes ~L units of
// the question, so a hop cannot be paid for by offering more continuations than
// the question has units — `ceil(queryLen / W)`, floored at 2 for plurality.  It
// is QUERY-sized (invariant 5: no per-query read grows with N), it changes no
// read, and `hubBound` keeps its formula.
//
// WHAT IS PINNED, relationally and with no magic number: giving a hub ten times
// more continuations must not cost more than the QUERY's own size in extra
// chart work.  Before the fix the work grew with the hub (offering every
// continuation); after it, the two runs are the same size.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const QUERY = "alpha beta gamma";

/** `alpha` leads to `beta`, and `beta` is a hub of `degree` continuations —
 *  exactly the shape a chain hop meets, and the shape the trained store has at
 *  degree 1083. */
async function hub(degree) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  const pairs = [
    ["alpha", "beta"],
    ["beta", "gamma"],
  ];
  for (let i = 0; i < degree; i++) {
    pairs.push(["beta", `continuation number ${i} of this hub`]);
  }
  await mind.ingest(pairs);
  return mind;
}

const offers = (mind) => mind.lastCost?.counters.chainOffers ?? 0;

test("ten times the hub's continuations is not ten times the offered work", async () => {
  const small = await hub(4);
  const big = await hub(40);
  await small.respond(QUERY);
  await big.respond(QUERY);
  // The slack IS the rule's own derived quantity — a hop may offer up to
  // `ceil(queryLen / W)` continuations — so the assertion needs no magic
  // number: ten times the hub may cost at most the question's own units more.
  // `W` is the fixture's own geometry (the Mind's default maxGroup), the same W
  // the rule derives with.
  const W = 4;
  const slack = Math.ceil(QUERY.length / W);
  assert.ok(
    offers(small) > 0 && offers(big) > 0,
    "the hop must actually be taken, or this test proves nothing: " +
      `small=${offers(small)} big=${offers(big)}`,
  );
  assert.ok(
    offers(big) <= offers(small) + slack,
    "what a chain hop OFFERS must be bounded by the question, not by the " +
      `corpus's fan-out: small=${offers(small)} big=${offers(big)} slack=${slack}`,
  );
  await small.store.close();
  await big.store.close();
});

test("and the hub still leads somewhere the chain can use", async () => {
  const mind = await hub(40);
  const out = (await mind.respondText(QUERY)).replace(/\0+/g, "").trim();
  assert.ok(out.length > 0, `the hub must still be reachable, got ${JSON.stringify(out)}`);
  assert.ok(offers(mind) > 0, "and the chain hop must have been taken");
  await mind.store.close();
});
