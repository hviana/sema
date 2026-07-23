// 54-evidence-k-instrumentation.test.mjs — the three purely-additive
// read-outs added for evidence-breadth measurement tooling:
//   1. AncestorReach.visited / maxDepth (trace-gated, serialised into
//      ClimbConsensusData.reaches),
//   2. structured data payloads on "decideGrounding" / "narrowDecision",
//   3. ingest()'s optional onDeposit provenance callback.
//
// Every assertion here checks a READ-OUT; the final test pins that none of
// them changes the answer (the same invariant tests 52 §6 / 53 §9 pin for
// the climb instrumentation).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind, decodeText } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = (seed = 1) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

const CORPUS = [
  ["red", "is a color"],
  ["blue", "is a color"],
  ["circle", "is a shape"],
  ["square", "is a shape"],
  ["red circle", "answer alpha"],
  ["red square", "answer beta"],
  ["blue circle", "answer gamma"],
  ["blue square", "answer delta"],
];

async function trace(mind, q) {
  const steps = [];
  const ans = await mind.respondText(q, (s) => steps.push(s));
  return { steps, ans };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. climb read-out: visited / maxDepth
// ═══════════════════════════════════════════════════════════════════════════

test("1. traced climb reaches carry visited/maxDepth; untraced ones do not", async () => {
  const m = mk(1);
  await m.ingest(CORPUS);

  const { steps } = await trace(m, "red then circle");
  const climb = steps.find((s) => s.mechanism.at(-1) === "climbConsensus");
  assert.ok(climb?.data?.reaches?.length > 0, "expected reach traces");
  for (const r of climb.data.reaches) {
    assert.equal(typeof r.visited, "number");
    assert.equal(typeof r.maxDepth, "number");
    assert.ok(r.visited >= 0);
    assert.ok(r.maxDepth >= 0);
    // A climb that processed no node cannot have ascended.  (One processed
    // node can already sit at depth 1: containment seeds start one hop up.)
    if (r.visited === 0) assert.equal(r.maxDepth, 0);
    // Depth is bounded by the number of processed nodes plus any
    // transparent-chain interiors — sanity only: never negative, and zero
    // whenever nothing was climbed.
    assert.ok(r.maxDepth >= 0);
  }

  // Untraced (no respond in flight): the same contract as `saturation` —
  // instrumentation fields absent when no trace was requested.
  const someNode = climb.data.reaches[0].node;
  const reach = m.edgeAncestors(someNode, 8);
  assert.equal(reach.visited, undefined);
  assert.equal(reach.maxDepth, undefined);
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. decideGrounding / narrowDecision data payloads
// ═══════════════════════════════════════════════════════════════════════════

test("2. decideGrounding carries every candidate's weight/grade as data, exactly one decided", async () => {
  const m = mk(1);
  await m.ingest(CORPUS);
  const { steps, ans } = await trace(m, "red then circle");
  await m.store.close();

  const dg = steps.find((s) => s.mechanism.at(-1) === "decideGrounding");
  assert.ok(dg, "expected a decideGrounding step (≥2 candidates)");
  assert.ok(dg.data, "decideGrounding must carry a data payload");
  assert.equal(dg.data.version, 1);
  assert.equal(dg.data.candidates.length, dg.inputs.length);
  for (const c of dg.data.candidates) {
    assert.equal(typeof c.provenance, "string");
    assert.equal(typeof c.weight, "number");
    assert.equal(typeof c.grade, "number");
    assert.equal(typeof c.unexplainedBytes, "number");
    assert.ok(c.unexplainedBytes >= 0);
  }
  const decided = dg.data.candidates.filter((c) => c.decided);
  assert.equal(decided.length, 1, "exactly one candidate wins");
  // The winner's grade is minimal — the data restates the decision rule.
  const minGrade = Math.min(...dg.data.candidates.map((c) => c.grade));
  assert.equal(decided[0].grade, minGrade);
  assert.ok(ans.length > 0);

  if (dg.data.runnerUpMargin !== undefined) {
    assert.ok(dg.data.runnerUpMargin >= 0);
    const nd = steps.find((s) => s.mechanism.at(-1) === "narrowDecision");
    if (dg.data.runnerUpMargin <= 1) {
      assert.ok(nd, "margin ≤ 1 must emit narrowDecision");
      assert.equal(nd.data.version, 1);
      assert.equal(nd.data.margin, dg.data.runnerUpMargin);
    } else {
      assert.equal(nd, undefined);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. onDeposit provenance callback
// ═══════════════════════════════════════════════════════════════════════════

test("3. onDeposit reports one item-indexed record per ingested item, ids content-addressed", async () => {
  const m = mk(1);
  const reports = [];
  await m.ingest(CORPUS, undefined, (r) => reports.push(r));

  assert.equal(reports.length, CORPUS.length);
  reports.forEach((r, i) => {
    assert.equal(r.index, i);
    assert.equal(r.kind, "pair");
    assert.equal(typeof r.contextId, "number");
    assert.equal(typeof r.continuationId, "number");
    // The reported ids ARE the items' content-addressed nodes.
    assert.equal(decodeText(m.store.bytes(r.contextId)), CORPUS[i][0]);
    assert.equal(decodeText(m.store.bytes(r.continuationId)), CORPUS[i][1]);
  });
  // Content addressing: identical continuations share one node id.
  const colorIds = [reports[0], reports[1]].map((r) => r.continuationId);
  assert.equal(colorIds[0], colorIds[1]);
  await m.store.close();
});

test("3b. onDeposit reports bare items as kind 'one'; omitting it changes nothing", async () => {
  const m = mk(1);
  const reports = [];
  await m.ingest(["standalone note", ["ctx", "cont"]], undefined, (r) => reports.push(r));
  assert.deepEqual(reports.map((r) => [r.index, r.kind]), [[0, "one"], [1, "pair"]]);
  assert.equal(reports[1].continuationId !== undefined, true);
  assert.equal(reports[0].continuationId, undefined);
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. none of the read-outs changes the answer
// ═══════════════════════════════════════════════════════════════════════════

test("4. answers are identical with and without the new read-outs attached", async () => {
  const ask = async (withHooks) => {
    const m = mk(7);
    await m.ingest(CORPUS, undefined, withHooks ? () => {} : undefined);
    const out = [];
    for (const q of ["red then circle", "red circle blue square", "blue square"]) {
      out.push(
        withHooks
          ? await m.respondText(q, () => {})
          : await m.respondText(q),
      );
    }
    await m.store.close();
    return out;
  };
  assert.deepEqual(await ask(true), await ask(false));
});
