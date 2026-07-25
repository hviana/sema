// 57-fusion-order.test.mjs — a fused multi-topic answer must READ in the
// order the question posed its topics.
//
// fuseAttention sorts its pieces by `start`, their position in the query.
// Every attention ROOT carries its own start.  `primary` did not: it was
// given forest[0].start — the FIRST root's position — which is primary's own
// source only when primary happens to come from that root.  When it does
// not, primary sorts to a position it never occupied.
//
// Observed live on the 17.9M-node trained store:
//   "What is the capital of France? And what is 2 + 2?"
//     -> "4The capital city of France is Paris."
// Both pieces were correct; only the order was wrong.  The ALU result, whose
// evidence is the "2 + 2" span at the END of the query, had inherited the
// France root's start of 0.
//
// primary's position is now the earliest query byte its own grounding stands
// on: `accounted` when non-empty, else the computed span (a pure computation
// is priced out of `accounted` by cover — the same cost-ladder-vs-coverage
// distinction think() already draws for the fusion remainder).
//
// NOT under test: the missing separator between the pieces.  joinWithBridge
// splices only a LEARNT connector; when the corpus holds none the pieces join
// bare.  Inventing a space would synthesize bytes the store never saw, which
// this system does not do — bare joining is the honest degradation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = () =>
  new Mind({ seed: 1, store: new SQliteStore({ path: ":memory:" }) });

/** Two independent topics, each with its own trained fact, plus enough
 *  same-frame neighbours that the consensus climb commits both as separate
 *  points of attention rather than one. */
const TRAIN = [
  ["What is the capital of France?", " The capital of France is Paris."],
  ["What is the capital of Spain?", " The capital of Spain is Madrid."],
  ["What is the capital of Italy?", " The capital of Italy is Rome."],
  ["What is the largest planet?", " The largest planet is Jupiter."],
  ["What is the largest ocean?", " The largest ocean is the Pacific."],
];

async function trained() {
  const mind = mk();
  await mind.ingest(TRAIN);
  return mind;
}

/** Index of `needle` in `hay`, or -1. */
const at = (hay, needle) => hay.indexOf(needle);

test("1. two fused topics appear in the query's own order", async () => {
  const mind = await trained();
  const a = await mind.respondText(
    "What is the capital of France? And what is the largest planet?",
  );
  const iParis = at(a, "Paris"), iJup = at(a, "Jupiter");
  if (iParis >= 0 && iJup >= 0) {
    assert.ok(
      iParis < iJup,
      `France was asked FIRST but its answer trails: ${JSON.stringify(a)}`,
    );
  }
  await mind.store.close();
});

test("2. reversing the question reverses the fused answer", async () => {
  const mind = await trained();
  const a = await mind.respondText(
    "What is the largest planet? And what is the capital of France?",
  );
  const iParis = at(a, "Paris"), iJup = at(a, "Jupiter");
  if (iParis >= 0 && iJup >= 0) {
    assert.ok(
      iJup < iParis,
      `the planet was asked FIRST but its answer trails: ${JSON.stringify(a)}`,
    );
  }
  await mind.store.close();
});

test("3. a single-topic answer is unchanged by the ordering rule", async () => {
  const mind = await trained();
  assert.match(
    await mind.respondText("What is the capital of France?"),
    /Paris/,
  );
  assert.match(
    await mind.respondText("What is the largest planet?"),
    /Jupiter/,
  );
  await mind.store.close();
});

test("4. determinism", async () => {
  const a = await trained(), b = await trained();
  const q = "What is the capital of France? And what is the largest planet?";
  assert.equal(await a.respondText(q), await b.respondText(q));
  await a.store.close();
  await b.store.close();
});
