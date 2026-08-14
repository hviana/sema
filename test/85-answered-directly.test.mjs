// 85-answered-directly.test.mjs — a question that was answered DIRECTLY must not
// run on to a further hop.
//
// THE DEFECT THIS PINS. `reason()` loops to a fixpoint, extending while the
// current answer offers anywhere to go. Every stopping condition it had was
// about the ANSWER — `consumed`, `restatesQuery`, `bytesEqual` — and none asked
// whether the QUESTION had already been satisfied. So a single-hop question
// whose answer happens to name another learnt context stepped past a correct
// answer and replaced it with the next hop's:
//
//   asked : "<subject> father"
//   hop 1 : "The father of <subject> is Ernest I of Anhalt-Dessau."   <- correct
//   pivot : "Ernest I of Anhalt-Dessau"                <- a learnt context too
//   got   : "The date of death of Ernest I of Anhalt-Dessau is 12 June 1516."
//
// Any store holding a bare-entity context beside a relation fact has that shape.
//
// THE FIX is the echo guard's other half, and the same principle: the QUERY's
// own position in the graph says the read-out is complete. The echo guard
// handles a query that is itself a learnt CONTINUATION; this handles a query
// that is a learnt CONTEXT whose grounded answer is one of its own
// continuations. A genuine multi-hop query is not a deposited context at all —
// "What is the capital of the country of Eiffel Tower?" resolves to nothing —
// so the guard can never gate a real chain, which the last test asserts,
// because a fix that bought single-hop correctness by killing composition would
// be no fix at all.
//
// A REFUTED ALTERNATIVE, recorded so it is not retried: gating the pivot on
// "the QUERY still contains an unconsumed learnt context" (symmetric to
// `pivotInto` on the answer) looks natural and BREAKS composition — a two-hop
// query does not literally contain a learnt context, so the gate fires on every
// real chain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";

const SUBJECT = "John V of Anhalt-Zerbst";
const HOP1 = `The father of ${SUBJECT} is Ernest I of Anhalt-Dessau.`;
const HOP2 = "The date of death of Ernest I of Anhalt-Dessau is 12 June 1516.";

// Two chained facts, each deposited as a relation fact AND a bare-entity fact —
// the shape that makes the entity pivotable, and the run-on possible.
const DEPOSITS = [
  [`${SUBJECT} father`, HOP1],
  [SUBJECT, HOP1],
  ["Ernest I of Anhalt-Dessau date of death", HOP2],
  ["Ernest I of Anhalt-Dessau", HOP2],
];

async function chainStore() {
  const mind = new Mind({ seed: 7, D: 1024 });
  await mind.ingest(DEPOSITS);
  return mind;
}

test("a single-hop question keeps its own answer", async () => {
  // The regression itself. Without the guard this returns HOP2.
  const mind = await chainStore();
  const answer = await mind.respondText(`${SUBJECT} father`);
  assert.ok(
    answer.includes("Ernest I of Anhalt-Dessau"),
    `lost the answer entirely: ${JSON.stringify(answer)}`,
  );
  assert.ok(
    !answer.includes("12 June 1516"),
    `ran on to the second hop and replaced a correct answer: ${
      JSON.stringify(answer)
    }`,
  );
});

test("the bare-entity fact answers its own hop, and stops", async () => {
  // The bare-entity deposit is a context too, so it must behave the same way:
  // asking the entity yields ITS continuation, not the one after.
  const mind = await chainStore();
  const answer = await mind.respondText(SUBJECT);
  assert.ok(
    answer.includes("Ernest I of Anhalt-Dessau"),
    `lost the answer: ${JSON.stringify(answer)}`,
  );
  assert.ok(
    !answer.includes("12 June 1516"),
    `bare-entity context ran on a hop: ${JSON.stringify(answer)}`,
  );
});

test("the second hop is still reachable when actually asked", async () => {
  // The guard must not make hop 2 unreachable — it is a deposited fact and a
  // direct question about it must answer.
  const mind = await chainStore();
  const answer = await mind.respondText(
    "Ernest I of Anhalt-Dessau date of death",
  );
  assert.ok(
    answer.includes("12 June 1516"),
    `hop 2 became unreachable: ${JSON.stringify(answer)}`,
  );
});

test("a genuine two-hop question still composes", async () => {
  // THE OTHER HALF OF THE CONTRACT. The guard keys on the query being a
  // deposited context; a real multi-hop question is not one, so composition
  // must be untouched. If this fails, the guard is over-broad.
  const mind = new Mind({ seed: 7, D: 1024 });
  await mind.ingest([
    ["Eiffel Tower country", "The country of Eiffel Tower is France."],
    ["France capital", "The capital of France is Paris."],
    ["France", "The capital of France is Paris."],
  ]);
  const steps = [];
  const answer = await mind.respondText(
    "What is the capital of the country of Eiffel Tower?",
    (s) => steps.push(s.mechanism[s.mechanism.length - 1]),
  );
  assert.ok(
    steps.includes("pivotStep"),
    `the guard suppressed a genuine chain; answer was ${
      JSON.stringify(answer)
    }`,
  );
  assert.ok(
    answer.includes("Paris"),
    `two-hop chain did not compose: ${JSON.stringify(answer)}`,
  );
});
