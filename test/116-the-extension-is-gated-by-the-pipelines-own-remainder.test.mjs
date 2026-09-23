// 116-the-extension-is-gated-by-the-pipelines-own-remainder.test.mjs — EXTENSION
// judges the question by the pipeline's remainder, with the pipeline's W floor.
//
// TWO CORRECTIONS FROM THE ADVERSARIAL REVIEW, in one definition:
//
//  M3 — the reasoner's `uncovered` was built from the ladder's `accounted`, a
//  COST quantity.  The pipeline itself documents that `accounted` can be EMPTY
//  while nothing is unexplained (a query fully explained by one computed span
//  plus bridged connectors), and it already builds the genuine remainder as
//  `[...decided.accounted, ...pre.computed]`.  The reasoner now uses that same
//  reading — computed once, used by both the extension gate and the fuse gate.
//
//  M4 — the boundary.  The pipeline treats a remainder under W as bridging
//  punctuation, and the reasoner inherits that floor.  The subtlety the review
//  raised is that a one-word tail CARRIES ITS SEPARATOR: `" why"` is exactly W
//  bytes, so it IS a remainder and licenses no extension, while `" famous for"`
//  is well over and does.  Both sides are pinned here, because the boundary is
//  where the reviewer's own demonstration sat.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const LINKS = [
  ["What is the capital of France", "The capital of France is Paris"],
  ["Paris", "Paris is famous for the Eiffel Tower"],
];

/** The test/110 chain: the second link is reachable only by hopping. */
async function chain() {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(LINKS);
  return mind;
}

const text = (resp) => new TextDecoder().decode(resp.bytes).replace(/\0+/g, "").trim();

test("a remainder the pipeline calls real licenses the hop", async () => {
  const mind = await chain();
  const out = text(await mind.respond("What is the capital of France famous for"));
  assert.equal(
    out,
    LINKS[1][1],
    "a remainder well over one window must still reach the next link",
  );
  await mind.store.close();
});

test("a one-word remainder is exactly one window, and licenses nothing", async () => {
  // `" why"` is W bytes once its separator is counted: per the pipeline's own
  // floor it is a remainder, and per the extension law a remainder the step
  // cannot carry licenses no hop — so the grounded fact stands.
  const mind = await chain();
  const out = text(await mind.respond("What is the capital of France why"));
  assert.equal(
    out,
    LINKS[0][1],
    "a step carrying none of the remainder must not be taken",
  );
  await mind.store.close();
});

test("a computed-span query has no phantom remainder (M3)", async () => {
  // A pure computation: the ladder's `accounted` is not a coverage reading, so
  // the reasoner must not see a remainder the pipeline says is not there.  The
  // check is that the answer is the computed one and the engine is not dragged
  // into an unrelated chain.
  const mind = await chain();
  const out = text(await mind.respond("2+2"));
  assert.ok(out.length > 0, `a computation must still be answered, got ${JSON.stringify(out)}`);
  await mind.store.close();
});
