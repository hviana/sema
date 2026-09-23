// 112-the-exploration-does-not-grow-with-the-hub.test.mjs
//
// THE OFFER IS THE CORPUS'S STRUCTURE.  A chain hop offers the continuations the
// corpus holds, and the search pays for exploring them on the ladder (every hop
// costs STEP).  What must NOT happen is a combinatorial explosion: the work must
// not grow with the SQUARE of the hub's degree.
//
// This file used to pin an offer CAP (`exploreCap`, with its invented
// `PLURALITY` floor).  That cap is gone: it was a short-circuit — it bounded what
// a hop could OFFER instead of charging for it — and it was not needed.  In the
// regime where it used to bite (`hubBound = ceil(√N)` greater than the hub's
// degree, reached here by choosing the degree below √N, so no trained store is
// needed) the measured shape without it is LINEAR: degrees 35/70/120 gave offers
// 52/84/120, pushes 262/296/332, perceptions 530/592/757 — while the peak was
// identical with and without the cap (218/415/689 MB against 215/410/662),
// because the peak is set by the store, not by the fan-out.  What made that hop
// expensive was never the breadth of the offer: it was per-offer work, two
// duplicate/oversized computations since removed.
//
// The residual, stated: the trained store's hub (degree 1 083) is an
// EXTRAPOLATION from this linear shape, not a measurement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const QUERY = "alpha beta";

/** `alpha` leads to `beta`, and `beta` is a hub of `degree` continuations.
 *
 *  The filler keeps `edgeSourceCount()` above the square of the degree, so the
 *  READ bound (`hubBound = ceil(√N)`) exceeds the hub's degree — the regime in
 *  which the removed cap used to change the offer. */
async function hub(degree) {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store, profile: true });
  const pairs = [
    ["alpha", "beta"],
    ["beta", "gamma"],
  ];
  for (let i = 0; i < degree; i++) {
    pairs.push(["beta", `continuation number ${i} of this hub`]);
  }
  const filler = Math.ceil(degree * degree * 1.4);
  for (let i = 0; i < filler; i++) {
    pairs.push([`filler ${i} note`, `unrelated filler body ${i} here`]);
  }
  await mind.ingest(pairs);
  return mind;
}

const pushes = (mind) => mind.lastCost?.counters.searchPushes ?? 0;
const offers = (mind) => mind.lastCost?.counters.chainOffers ?? 0;

test("the work does not explode with the hub's degree", async () => {
  const small = await hub(20);
  const big = await hub(80);
  await small.respond(QUERY);
  await big.respond(QUERY);
  const a = pushes(small);
  const b = pushes(big);
  // The degree grows 4x.  An explosion multiplies the work by the SQUARE of
  // that ratio — 16x — so the bound needs no invented number: it is the ratio's
  // own square, and the measured shape is linear (about 4x).
  assert.ok(
    offers(big) > offers(small),
    "the offer must follow the corpus's continuations: " +
      `${offers(small)} → ${offers(big)}`,
  );
  assert.ok(
    b < a * 16,
    "work must not explode with the degree (4x degree would be 16x work): " +
      `${a} → ${b}`,
  );
  await small.store.close();
  await big.store.close();
});

test("and the hub still leads somewhere the chain can use", async () => {
  const mind = await hub(40);
  const out = (await mind.respondText(QUERY)).replace(/\0+/g, "").trim();
  assert.ok(
    out.length > 0,
    `the hub must still be reachable, got ${JSON.stringify(out)}`,
  );
  assert.ok(offers(mind) > 0, "and the chain hop must have been taken");
  await mind.store.close();
});
