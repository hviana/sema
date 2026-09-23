// 112-the-exploration-does-not-grow-with-the-hub.test.mjs
//
// WHAT THIS PROVES, STATED HONESTLY.  A chain hop's offer does not grow with the
// hub's degree — but on a fixture the reason is the store's READ bound
// (`hubBound = √N`), not the exploration cap: measured, this file passes with
// `exploreCap` removed and with it in place, so it does NOT pin that cap.  The
// cap's only measured effect is in the trained store, where `hubBound` (1 559)
// exceeds the hub's degree (1 083) and the peak went from 270 MB (OOM at a
// 256 MB heap) to 98 MB — a regime a fixture cannot reach, since it needs
// N > degree² (about 1.4M nodes for a 1.2k hub).  What IS pinned here is the
// shape a corpus reader depends on (bounded offers, deterministic browse) and
// that the hop is actually taken, which is what makes the counters meaningful.
//
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
      `corpus's fan-out: small=${offers(small)} big=${
        offers(big)
      } slack=${slack}`,
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
