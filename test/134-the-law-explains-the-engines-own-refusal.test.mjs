// 134-the-law-explains-the-engines-own-refusal.test.mjs — the law, coupled to the
// engine's own observed behaviour rather than to itself.
//
// WHAT THIS PINS, and why it is not a restatement of test/133:
//
//   133 says the state is rendered where it is decided, that the law reads no
//   producer, and that it has one home.  This file says the LAW'S OWN MEASURE
//   EXPLAINS WHAT THE ENGINE DID: on a real fixture the reasoner takes one step
//   and refuses the next, and the two products are in the corpus, so the law's
//   `carries` can be evaluated on them and must agree with the trace — the
//   admitted product carries a quantum of the remainder, the refused one carries
//   none.  A test that only checked the law against itself would prove nothing
//   about the engine; this one couples the two through the OFFICIAL
//   instrumentation (`inspectRationale` for the products and the refusal, the
//   meter for the remainder's own counts).
//
// It also pins the two invariants a reader of the extraction relies on: the law
// is TOTAL over states x continuations and every clause holds, and `advance` is
// the transition it says it is — including that the remainder TRAVELS UNCHANGED,
// the reading that was implemented and refuted (draining it let test/110's chain
// drift one hop past its satisfying answer).

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const law = await import("../dist/src/mind/derivation.js");
const { Mind, SQliteStore } = await import("../dist/src/index.js");

const enc = (s) => new TextEncoder().encode(s);

/** The chain of test/110 and of the report's §16 example 3. */
const LINKS = [
  ["What is the capital of France", "The capital of France is Paris"],
  ["Paris", "Paris is famous for the Eiffel Tower"],
  ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
];
const QUERY = "What is the capital of France famous for";

async function run() {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(LINKS);
  const steps = [];
  const answer = String(await mind.respondText(QUERY, (s) => steps.push(s)))
    .trim();
  const out = {
    mind,
    store,
    steps,
    answer,
    counters: mind.lastCost?.counters ?? {},
  };
  return out;
}

test("134.1 the law is total, and every clause holds over the matrix", async () => {
  const query = enc(QUERY);
  const W = 4;
  const none = enc("qqqqqqqqqqqqqqqq");
  const owed = law.remainderOf(query.length, [], W);
  assert.ok(
    owed.length > 0,
    "the fixture must owe material, else this pins nothing",
  );
  const states = {
    open: { product: query, accounted: [], remainder: owed, cost: 0 },
    closed: {
      product: none,
      accounted: [[0, query.length]],
      remainder: [],
      cost: 3,
    },
    fixed: {
      product: query,
      accounted: [],
      remainder: owed,
      cost: 0,
      fixed: true,
    },
  };
  const conts = {
    carries: { product: query.subarray(0, 3 * W), contains: true, cost: 1 },
    moves: { product: none, contains: true, moves: true, cost: 1 },
    plain: { product: none, contains: true, cost: 1 },
    alien: { product: none, contains: false, cost: 1 },
  };
  for (const sn of Object.keys(states)) {
    for (const cn of Object.keys(conts)) {
      const v = law.admissible(states[sn], conts[cn], query, W);
      assert.ok(
        v === null || Array.isArray(v),
        `${sn} x ${cn} produced ${String(v)}, neither a witness nor a refusal`,
      );
    }
  }
  for (const cn of Object.keys(conts)) {
    assert.equal(
      law.admissible(states.fixed, conts[cn], query, W),
      null,
      `a supplied fixed point stops every continuation (${cn})`,
    );
  }
  for (const sn of Object.keys(states)) {
    assert.equal(
      law.admissible(states[sn], conts.alien, query, W),
      null,
      `identity comes before progress: an alien structure (state ${sn})`,
    );
  }
  for (const cn of ["carries", "moves", "plain"]) {
    assert.notEqual(
      law.admissible(states.closed, conts[cn], query, W),
      null,
      `a closed derivation admits every contained continuation (${cn})`,
    );
  }
  assert.equal(law.closed(states.closed), true);
  assert.equal(law.closed(states.open), false);
  // progress is EITHER the material carried OR the structure moved to
  assert.notEqual(law.admissible(states.open, conts.carries, query, W), null);
  assert.notEqual(law.admissible(states.open, conts.moves, query, W), null);
  assert.equal(
    law.admissible(states.open, conts.plain, query, W),
    null,
    "a step that neither carries the remainder nor moves is refused",
  );
});

test("134.2 advance is the transition it says it is", async () => {
  const query = enc(QUERY);
  const W = 4;
  const before = {
    product: query,
    accounted: [],
    remainder: law.remainderOf(query.length, [], W),
    cost: 2,
    used: new Set([1, 2]),
  };
  const t = { product: query.subarray(0, 3 * W), contains: true, cost: 1 };
  const witness = law.admissible(before, t, query, W);
  assert.ok(witness !== null);
  const after = law.advance(before, t, witness);
  assert.equal(after.product, t.product, "the product moves");
  assert.equal(after.cost, before.cost + t.cost, "the cost accumulates");
  assert.deepEqual(
    after.remainder,
    before.remainder,
    "CARRIES ENGAGES: a step that carries question material consumes none of it",
  );
  assert.equal(
    after.fixed,
    undefined,
    "the result is no longer a supplied fixed point",
  );
  assert.equal(after.used, before.used, "the declaration travels");
  assert.deepEqual(
    after.accounted,
    [...before.accounted, ...witness.map((w) => w.span)],
    "the accounting accumulates what the step accounted for",
  );
  // A DECLARED MOVE CONSUMES WHAT IT CARRIES, and only that (test/138): the same
  // product, offered this time by a step that moves and accounts for the span it
  // holds.  This is the one thing the remainder responds to.
  const movedT = {
    product: t.product,
    contains: true,
    moves: true,
    explains: [[0, 3 * W]],
    cost: 1,
  };
  const movedWitness = law.admissible(before, movedT, query, W);
  assert.ok(movedWitness !== null);
  const drained = law.advance(before, movedT, movedWitness);
  assert.notDeepEqual(
    drained.remainder,
    before.remainder,
    "a declared move consumes the question material it carries",
  );
  // and the state it came from is untouched (the law is pure)
  assert.deepEqual(before.accounted, []);
  assert.equal(before.product, query);
});

test("134.3 the engine's own refusal is the law's refusal", async () => {
  const { mind, store, steps, answer, counters } = await run();
  const W = mind.space.maxGroup;
  const query = enc(QUERY);

  // THE TRACE'S OWN PRODUCTS: what the walk produced and what it declined.
  const pivots = steps.filter((s) => s.mechanism.at(-1) === "pivotStep");
  const refusals = steps.filter((s) => s.mechanism.at(-1) === "pivotRefused");
  assert.equal(
    pivots.length,
    1,
    `the fixture takes exactly one extension step (got ${pivots.length}; answer "${answer}")`,
  );
  assert.equal(refusals.length, 1, "and declines the next one");
  assert.equal(
    counters.pivotSteps,
    pivots.length,
    "the meter agrees with the trace",
  );
  const admitted = pivots[0].outputs[0].bytes;
  assert.ok(
    admitted && admitted.length > 0,
    "the admitted step reports its product",
  );

  // THE REMAINDER, from the meter's own counts and the fixture's structure: the
  // grounding accounts for "What is the capital of France" and owes the rest.
  assert.equal(counters.postGroundingRemainderSpans, 1);
  const owedSpan = [
    QUERY.length - counters.postGroundingRemainderBytes,
    QUERY.length,
  ];
  const remainder = [owedSpan];

  // THE LAW ON THE ENGINE'S OWN TWO PRODUCTS.
  assert.notEqual(
    law.carries(remainder, admitted, query, W),
    null,
    "the step the engine TOOK is one the law admits: its product carries a " +
      "quantum of what the grounding left unaccounted",
  );
  // The step it declined is the corpus's own next link — the drift test/110 pins.
  const drift = enc(LINKS[2][1]);
  assert.equal(
    law.carries(remainder, drift, query, W),
    null,
    "the step the engine DECLINED carries none of that material — which is " +
      "exactly the law's refusal the trace reports",
  );
  await store.close();
});
