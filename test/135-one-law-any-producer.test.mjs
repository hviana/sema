// 135-one-law-any-producer.test.mjs — the law over REAL states, from different
// producers, with the same verdicts.
//
// THE CLAIM THE EXTRACTION HAS TO EARN, and the one test/133 and test/134 do not
// reach: composition means a product is consumable by ANY transition the law
// admits, and the law never asks who produced it.  133 shows that over synthetic
// states and one provenance label each; 134 shows it against the engine's own
// refusal on ONE fixture.  This file takes the states the ENGINE actually
// produced, across five fixtures whose winners are DIFFERENT mechanisms, and asks
// the law about them:
//
//   • the winners must really span several mechanisms — otherwise nothing here is
//     exercised;
//   • for every fixture, the state's own published fields (the remainder's spans
//     and bytes, the supplied fixed point) decide every continuation, and the
//     verdicts follow the law's clauses and nothing else;
//   • and re-labelling a state with every other mechanism's provenance changes NO
//     verdict — the invariant, over real states rather than synthetic ones.
//
// The observed behaviour is then read back through the same law: a fixture that
// was extended took a step the law admits, one that was stopped had a supplied
// fixed point (FIXED), and one that was never extended had no continuation
// offered.

import { test } from "node:test";
import assert from "node:assert/strict";

const law = await import("../dist/src/mind/derivation.js");
const { Mind, SQliteStore } = await import("../dist/src/index.js");
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b).replace(/\s+/g, " ").trim();

const FIVE = [
  {
    name: "join chain (test/120)",
    pairs: (() => {
      const F = [
        "The director of Eva is Gustaf Molander.",
        "The country of Gustaf Molander is Sweden.",
        "The capital of Sweden is Stockholm.",
        "The mayor of Stockholm is Karin Wanngard.",
        "The party of Karin Wanngard is the Social Democrats.",
      ];
      const K = [["eva director", 0], ["gustaf molander country", 1],
        ["sweden capital", 2], ["stockholm mayor", 3], ["karin wanngard party", 4]];
      const out = [];
      for (const [key, i] of K) {
        out.push([key.split(" ").slice(0, -1).join(" "), F[i]], [key, F[i]]);
      }
      return out;
    })(),
    query: "eva director country capital mayor party",
  },
  {
    name: "nested completion (test/98)",
    pairs: [["a", "p q"], ["p", "r"], ["q", "s"], ["r s", "m n"]],
    query: "a",
  },
  {
    name: "the brake (test/110)",
    pairs: [
      ["What is the capital of France", "The capital of France is Paris"],
      ["Paris", "Paris is famous for the Eiffel Tower"],
      ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
    ],
    query: "What is the capital of France famous for",
  },
  {
    name: "declared fixed point (test/100)",
    pairs: [
      ["How do I compile hello.c?", "Run gcc hello.c"],
      ["How do I compile server.c?", "Run gcc server.c"],
      ["How do I compile parser.c?", "Run gcc parser.c"],
    ],
    query: "How do I compile program.c?",
  },
  {
    name: "two topics",
    pairs: [
      ["What is the capital of France", "The capital of France is Paris"],
      ["Paris", "Paris is famous for the Eiffel Tower"],
      ["2+2", "2+2 equals 4"],
      ["Gustaf Molander", "Gustaf Molander was a Swedish film director"],
    ],
    query: "What is the capital of France? And what is 2 + 2?",
  },
];

const WALK = new Set(["pivotStep", "absorbForward", "pivotRefused", "fuseAttention"]);

async function observe(f) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(f.pairs);
  const steps = [];
  const answer = String(await mind.respondText(f.query, (s) => steps.push(s))).trim();
  // The winner's provenance is read from the POST-GROUNDING step, which every
  // response emits.  It is deliberately NOT read from the decision payload: that
  // step is `narrowDecision` (which carries only a margin) when the market held
  // one candidate, so reading it left the producer null on two of these five
  // fixtures -- and a `Set` of producers then counted that null as a producer,
  // which is how an earlier version of this file passed for the wrong reason.
  const pg = steps.filter((s) => s.data && s.data.fixed !== undefined).pop()?.data;
  const counters = mind.lastCost?.counters ?? {};
  const observed = {
    name: f.name,
    query: f.query,
    answer,
    provenance: pg?.provenance ?? null,
    remainderSpans: pg?.remainderSpans ?? 0,
    remainderBytes: pg?.remainderBytes ?? 0,
    fixed: pg?.fixed === true,
    walk: steps.map((s) => s.mechanism.at(-1)).filter((m) => WALK.has(m)),
    pivotSteps: counters.pivotSteps ?? 0,
    W: mind.space.maxGroup,
  };
  await store.close();
  return observed;
}

test("135. the law decides real states the same way, whoever produced them", async () => {
  const seen = [];
  for (const f of FIVE) seen.push(await observe(f));

  // (1) THE FIXTURES MUST EXERCISE SEVERAL PRODUCERS, or nothing below is a test.
  assert.ok(
    seen.every((o) => o.provenance !== null),
    `every fixture must report its winner: got ${JSON.stringify(seen.map((o) => o.provenance))}`,
  );
  const producers = new Set(seen.map((o) => o.provenance));
  assert.ok(
    producers.size >= 3,
    `the fixtures' winners must span several mechanisms, got ${
      JSON.stringify([...producers])
    }`,
  );
  // (1b) AND THE BRANCHES BELOW MUST FIRE.  A test whose every fixture fell
  // through the same branch would pass while pinning one clause.
  assert.ok(seen.some((o) => o.fixed), "one fixture must supply a fixed point");
  assert.ok(
    seen.some((o) => o.walk.includes("pivotRefused")),
    "one fixture must show a refusal",
  );
  assert.ok(
    seen.some((o) => o.remainderBytes > 0 && !o.fixed),
    "one fixture must owe material and not be fixed",
  );
  assert.ok(
    seen.some((o) => o.remainderBytes === 0 && !o.fixed),
    "one fixture must be closed with no supplied fixed point",
  );

  // (2) THE STATE'S OWN FIELDS DECIDE, over the same battery for every fixture.
  const battery = (o) => {
    const query = enc(o.query);
    const alien = enc("qqqqqqqqqqqqqqqq");
    return {
      carries: { product: query, contains: true, cost: 1 },
      moves: { product: alien, contains: true, moves: true, cost: 1 },
      plain: { product: alien, contains: true, cost: 1 },
      alien: { product: alien, contains: false, cost: 1 },
    };
  };
  const stateOf = (o) => {
    // The remainder as the fixture's own published counts describe it: the
    // grounding accounts for the query's head and owes its tail.
    assert.ok(
      o.remainderSpans <= 1,
      `${o.name}: this construction assumes at most one owed span, got ${o.remainderSpans}`,
    );
    const remainder = o.remainderBytes === 0
      ? []
      : [[o.query.length - o.remainderBytes, o.query.length]];
    return {
      product: enc(o.answer),
      accounted: [],
      remainder,
      cost: 0,
      fixed: o.fixed,
    };
  };
  for (const o of seen) {
    const query = enc(o.query);
    const state = stateOf(o);
    const conts = battery(o);
    const closed = state.remainder.length === 0;
    // the law's clauses, per fixture, on the fixture's own state
    for (const [cn, t] of Object.entries(conts)) {
      const verdict = law.admissible(state, t, query, o.W);
      if (o.fixed) {
        assert.equal(verdict, null, `${o.name}: a supplied fixed point stops ${cn}`);
        continue;
      }
      if (cn === "alien") {
        assert.equal(verdict, null, `${o.name}: identity comes before progress`);
        continue;
      }
      if (closed) {
        assert.notEqual(verdict, null, `${o.name}: a closed state admits ${cn}`);
        continue;
      }
      if (cn === "carries" || cn === "moves") {
        assert.notEqual(verdict, null, `${o.name}: ${cn} is progress`);
      } else {
        assert.equal(verdict, null, `${o.name}: ${cn} is neither progress nor closed`);
      }
    }

    // (2b) COST IS NOT A TERM.  The law says the ladder is the ORDER, not a
    // clause; a state's verdict must not move when its cost does.
    for (const c of [0, 1, 1e6]) {
      for (const [cn, t] of Object.entries(conts)) {
        assert.deepEqual(
          law.admissible({ ...state, cost: c }, t, query, o.W),
          law.admissible(state, t, query, o.W),
          `${o.name} x ${cn}: the verdict moved with the cost (${c})`,
        );
      }
    }

    // (3) RE-LABELLING CHANGES NOTHING, over real states this time.
    for (const label of producers) {
      const labelled = { ...state, provenance: label };
      for (const [cn, t] of Object.entries(conts)) {
        assert.deepEqual(
          law.admissible(labelled, t, query, o.W),
          law.admissible(state, t, query, o.W),
          `${o.name} x ${cn}: the verdict changed under the label "${label}"`,
        );
      }
    }
  }

  // (4) AND THE ENGINE'S OBSERVED WALK IS THE LAW'S CONSEQUENCE.
  for (const o of seen) {
    if (o.fixed) {
      assert.deepEqual(
        o.walk,
        [],
        `${o.name}: a supplied fixed point must stop the walk (saw ${o.walk})`,
      );
      continue;
    }
    if (o.walk.includes("pivotStep") || o.walk.includes("absorbForward")) {
      assert.ok(
        o.pivotSteps >= 1 || o.walk.includes("absorbForward"),
        `${o.name}: a taken step must be one the meter counts`,
      );
    }
    // a refusal, where it happened, is a step the law declined — and the fixture
    // that has one is the one whose remainder is not empty
    if (o.walk.includes("pivotRefused")) {
      assert.ok(
        o.remainderBytes > 0,
        `${o.name}: a refusal implies there was material left to engage`,
      );
    }
  }
});
