// 142 — the layer offers only what the law admits, which is what makes a refusal final.
//
// THE CONTRACT THIS PINS.  `closure` stops when the law refuses the continuation the layer
// offered, and reads that refusal as "no continuation exists".  That is valid only under
// ONE of two architectures: the layer searches for an admissible continuation and offers
// only a valid one (X), rather than offering candidates for the law to filter (Y).  Sema is
// X — the producer tries the forward absorb first and reaches for the pivot only when the
// absorb's guards fail, returning null when neither exists — so the one offer the law can
// still refuse is the pivot without ownership, and it is the layer's last.
//
// 142.1 pins the premise: the law CAN refuse (a continuation that neither carries question
// material nor declares a move), and admits the two species.  Without a refusal the contract
// would be vacuous.  142.2 pins the consequence in the engine: the walk ends at that refusal
// and the satisfying answer is untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { admissible, closure } from "../dist/src/mind/derivation.js";

const QUERY = new TextEncoder().encode("ABCDEFGHIJ");
const W = 4;
const state = () => ({
  product: new Uint8Array(0),
  accounted: [],
  remainder: [[0, 10]],
  cost: 0,
});

test("142.1 the law refuses what neither carries nor reaches, and admits both species", () => {
  // neither: no window held, no move declared
  assert.equal(
    admissible(
      state(),
      { product: new TextEncoder().encode("Paris"), contains: true, cost: 1 },
      QUERY,
      W,
    ),
    null,
    "an offer that neither carries nor reaches is refused — so offering one is not free",
  );
  // carries: the product holds a window of the remainder
  assert.notEqual(
    admissible(
      state(),
      {
        product: new TextEncoder().encode("ZZZZABCDZZ"),
        contains: true,
        cost: 1,
      },
      QUERY,
      W,
    ),
    null,
    "carrying admits",
  );
  // reaches: a declared move, which needs no question material
  assert.notEqual(
    admissible(
      state(),
      {
        product: new TextEncoder().encode("Paris"),
        contains: true,
        reaches: true,
        cost: 1,
      },
      QUERY,
      W,
    ),
    null,
    "a declared move admits on its own ground",
  );
});

test("142.2 the walk ends at the refusal, with the satisfying answer untouched", async () => {
  const LINKS = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
  ];
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(LINKS);
  const out = await mind.respond("What is the capital of France famous for");
  const text = new TextDecoder().decode(out.bytes).replace(/\0+/g, "").trim();
  await store.close();
  assert.equal(
    text,
    LINKS[1][1],
    "the layer's last offer was refused, and the answer stands",
  );
});

// B OF THE AUDIT'S TEN: what a refusal MEANS at the walk's boundary.
//
// The walk asks ONCE per round and stops when the law refuses it — it does not ask
// again.  That is the load-bearing half of the `Offer` contract: a refusal is read
// as "no continuation exists", and it is why the layer must offer only what the law
// will admit (model X, pinned by 142.1 and 142.2).  A layer that offered candidates
// for the law to filter would be wrong here, and its own fallbacks must therefore be
// INTERNAL to one offer call — which is what the engine's layer does.
//
// WHAT THIS DOES NOT SETTLE, and must not be read as settling: the walk reads every
// reason the layer stopped as exhaustion, and the audit found six of them (exhausted,
// candidate refused, cycle, read bound, no structure, layer done).  `enumerationExhausted`
// in reasoning.ts now makes that claim observable; proving the claim TRUE is the open
// decision the audit left (its section 18.6), not something this test asserts.
test("142.3 a refusal ends the walk, and is not retried", async () => {
  const enc = (t) => new TextEncoder().encode(t);
  // Refused on the law's own ground; admitted for carrying a window (both from 142.1).
  const REFUSED = { product: enc("Paris"), contains: true, cost: 1 };
  const ADMITTED = { product: enc("ZZZZABCDZZ"), contains: true, cost: 1 };

  // SANITY FIRST: the literals must be what this test says they are, or the walk
  // below would end for another reason and pin nothing.
  assert.equal(
    admissible(state(), REFUSED, QUERY, W),
    null,
    "REFUSED is refused by the law (as in 142.1)",
  );
  assert.notEqual(
    admissible(state(), ADMITTED, QUERY, W),
    null,
    "ADMITTED carries a window, so the law admits it (as in 142.1)",
  );

  const queued = [REFUSED, ADMITTED];
  const offered = [];
  const offer = async () => {
    const next = queued.length > 0 ? queued.shift() : null;
    offered.push(next);
    return next;
  };
  const taken = [];
  await closure(
    state(),
    QUERY,
    W,
    offer,
    (_before, after) => taken.push(after),
  );

  assert.equal(
    offered.length,
    1,
    "the law is asked once: a refusal is not retried",
  );
  assert.equal(
    taken.length,
    0,
    "nothing was taken — the walk ended at the refusal",
  );
  assert.equal(queued.length, 1, "the second candidate was never offered");
});
