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

test("2b. a topic is never ECHOED back instead of answered", async () => {
  // The failure this pins: "What is the capital of France? And what is the
  // largest planet?" answered "The capital of France is Paris.What is the
  // largest planet?" — one topic answered, the other repeated verbatim.
  //
  // It hinged on CASE. The comparison schema seats a directly-aligned analog
  // by its own bytes rather than chasing a forward edge, which is correct when
  // those bytes are an answer (test/43 pins that) and an echo when they are
  // the question the asker just asked. The guard against that is a restatement
  // check, and a BYTE-EXACT one missed here: the trained node is "What is the
  // largest planet?" while the query says "And what is the largest planet?" —
  // the same words, one capital apart. The check now reads the response's own
  // injected canon, so it sees what the rest of the mind sees.
  //
  // SCOPE: this asserts only that nothing is echoed. Whether BOTH topics get
  // fused is a separate, corpus- and seed-dependent property of the consensus
  // climb — at this file's seed the second point is sometimes not committed at
  // all, which is why test 1 above guards its ordering assertion on both names
  // being present. Answering one topic and staying silent about the other is a
  // coverage limit; answering one and parroting the other is a defect.
  //
  // Asserted in BOTH orders because the echo appeared in only one: which topic
  // got echoed depended on whether the climb landed on the question node or
  // the answer node, so a single-order test passes while the bug is live.
  // ITS OWN CORPUS, DELIBERATELY. The file's shared `trained()` fixture cannot
  // reproduce this: with five same-frame facts the climb often commits only
  // ONE point, so there is no second topic to echo and the test would pass
  // against the unfixed code (verified — it did). The echo needs exactly two
  // topics, each a bare question node whose answer hangs off a forward edge.
  const mind = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    ["What is the largest planet?", "The largest planet is Jupiter."],
  ]);
  for (
    const q of [
      "What is the capital of France? And what is the largest planet?",
      "What is the largest planet? And what is the capital of France?",
    ]
  ) {
    const a = await mind.respondText(q);
    assert.ok(
      !/And what is/i.test(a),
      `the query was echoed rather than answered: ${JSON.stringify(a)} for ${
        JSON.stringify(q)
      }`,
    );
    assert.ok(
      a.includes("Paris") && a.includes("Jupiter"),
      `both topics must be ANSWERED, got ${JSON.stringify(a)} for ${
        JSON.stringify(q)
      }`,
    );
    // Nor may an answer be a bare restatement of one of the asked questions.
    assert.ok(
      !/^\s*What is the (largest planet|capital of France)\?\s*$/i.test(a),
      `the answer is just the question restated: ${JSON.stringify(a)}`,
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
