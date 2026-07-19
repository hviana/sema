// 41-seatofnode-direction.test.mjs — CAST's seatOfNode (comparison schema)
// must seat a node by its own FORWARD identity when it has one, not by an
// incidental predecessor.
//
// Traced live (analyze_training.ts, dialogue D geography thread): "And what
// is the capital of Spain?" answered with "Create an example of a types of
// questions a GPT model can answer.?And what is the capital of the Moon?"
// — CAST's comparison schema correctly identified "What is the capital of
// France?" as the dominant structure and a genuine analog ("capital of
// Japan"), but seated the dominant by REVERSE context instead of forward:
// seatOfNode's old test (`prevCount(id) === 0`) skipped the forward branch
// because that exact question happens to have ONE coincidental predecessor
// elsewhere in the corpus (a generic "generate example questions"
// meta-prompt) — even though its own forward edge unambiguously resolves
// to "The capital of France is Paris."
//
// A broad sample of this store's own question-shaped nodes showed this
// isn't rare: ~71% have at least one predecessor, the large majority from
// a handful of generic, high-fan-out sentences that recur as incidental
// neighbours to dozens of unrelated destinations — a SmolSent-style
// adjacency artifact, not a real identity-establishing lead-in.  There is
// no reliable way to tell a meaningful predecessor from an incidental one
// by count alone (the same category error already found and removed from
// chooseNext), so the fix restores the ONE priority every other consumer
// of follow()/reverseContext() already uses (project(), pivotInto, cast's
// own substitution schema): forward first, reverse only as a fallback when
// forward doesn't resolve.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { seatOfNode } from "../dist/src/mind/mechanisms/cast.js";
import { gistOf, resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

const mk = (seed) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

test("seatOfNode: a node with a strong forward identity is seated forward despite a coincidental predecessor", async () => {
  const m = mk(7);
  // "the question" has both a genuine forward answer AND one coincidental
  // predecessor — exactly the live shape (prevCount > 0, hasNext true).
  await m.ingest([
    ["the question", "the real answer"],
    ["a generic template prompt", "the question"],
  ]);

  const id = resolve(m, enc("the question"));
  assert.ok(id !== null, "corpus must resolve");
  assert.ok(m.store.prevCount(id) > 0, "must have a coincidental predecessor");
  assert.ok(m.store.hasNext(id), "must have a forward continuation");

  const guide = gistOf(m, enc("the question"));
  const seat = await seatOfNode(m, id, guide, enc("fallback"));
  assert.equal(
    dec(seat),
    "the real answer",
    `must seat by forward identity, not the coincidental predecessor, got "${
      dec(seat)
    }"`,
  );
  await m.store.close();
});

test("seatOfNode: a node with NO forward identity still falls back to its reverse context", async () => {
  const m = mk(7);
  await m.ingest([["known as", "the entity"]]);

  const id = resolve(m, enc("the entity"));
  assert.ok(id !== null, "corpus must resolve");
  assert.equal(m.store.hasNext(id), false, "must have no forward continuation");

  const guide = gistOf(m, enc("the entity"));
  const seat = await seatOfNode(m, id, guide, enc("fallback"));
  assert.equal(
    dec(seat),
    "known as",
    `an entity with no forward edge must still fall back to its reverse ` +
      `context, got "${dec(seat)}"`,
  );
  await m.store.close();
});
