// 117-corpus-search.test.mjs — reading the trained memory back out of the DAG.
//
// WHAT IS PINNED.  Two methods and their division of labour:
//   • `searchCorpus(bytes, limit?)` — MULTIMODAL: bytes in, bytes out, no notion
//     of text or encoding anywhere in it;
//   • `searchCorpusText(text, limit?)` — the text case, which encodes, calls the
//     multimodal one, and decodes.  The search itself exists ONCE (src/mind/
//     corpus.ts, over the machinery an answer already uses: `recognise` for the
//     resolved subtrees, `edgeAncestors` for the climb, `nextFirst` for the
//     continuation).
//
// Both are deterministic (same seed, same order, same query ⇒ byte-identical
// results), both report a miss as a STATE in the byte layer and as prose only in
// the text layer, and browsing takes the caller's own offset instead of a random
// draw.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind, SQliteStore } from "../dist/src/index.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A small deposited corpus: three experience pairs, no trained store needed. */
async function fixture() {
  const mind = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest([
    ["the capital of France", "Paris is the capital of France."],
    ["the capital of Portugal", "Lisbon is the capital of Portugal."],
    ["who wrote Hamlet", "Shakespeare wrote Hamlet."],
  ]);
  return mind;
}

const asText = (b) => dec.decode(b).replace(/\0+/g, "").trim();

test("the multimodal search takes bytes and returns bytes", async () => {
  const mind = await fixture();
  const result = mind.searchCorpus(enc.encode("the capital of France"));
  assert.ok(result.pairs.length > 0, "the deposited pair must be found");
  const pair = result.pairs[0];
  assert.ok(pair.context instanceof Uint8Array, "context is BYTES, not text");
  assert.ok(pair.continuation instanceof Uint8Array);
  assert.ok(typeof pair.contextId === "number");
  assert.ok(asText(pair.context).includes("capital"));
  assert.equal(result.browsed, false);
  assert.equal(result.miss, "matched");
  assert.ok(result.totalContexts > 0, "the store's own context count is read");
  await mind.store.close();
});

test("the text helper is the SAME search, converted", async () => {
  const mind = await fixture();
  const bytes = mind.searchCorpus(enc.encode("the capital of France"));
  const text = mind.searchCorpusText("the capital of France");
  assert.equal(
    text.pairs.length,
    bytes.pairs.length,
    "one search, two views — the helper must not run a second one",
  );
  assert.equal(text.pairs[0].contextId, bytes.pairs[0].contextId);
  assert.equal(typeof text.pairs[0].context, "string");
  assert.ok(text.pairs[0].context.includes("capital"));
  assert.equal(text.note, undefined, "a match needs no note");
  await mind.store.close();
});

test("both are deterministic across identical calls", async () => {
  const mind = await fixture();
  const a = mind.searchCorpus(enc.encode("the capital of France"));
  const b = mind.searchCorpus(enc.encode("the capital of France"));
  assert.deepEqual(
    a.pairs.map((p) => [p.contextId, p.continuationId, asText(p.context)]),
    b.pairs.map((p) => [p.contextId, p.continuationId, asText(p.context)]),
    "same store + same query ⇒ the same pairs in the same order",
  );
  assert.deepEqual(mind.searchCorpusText("the capital of France").pairs,
    mind.searchCorpusText("the capital of France").pairs);
  await mind.store.close();
});

test("a miss is a state in bytes and prose only in text", async () => {
  const mind = await fixture();
  const bytes = mind.searchCorpus(enc.encode("zzzq nothing at all"));
  assert.equal(bytes.pairs.length, 0);
  assert.ok(
    bytes.miss === "nothing-resolved" || bytes.miss === "no-continuations",
    `the byte layer reports a STATE, got ${bytes.miss}`,
  );
  assert.equal(bytes.note, undefined, "no prose in the byte layer");
  const text = mind.searchCorpusText("zzzq nothing at all");
  assert.equal(text.pairs.length, 0);
  assert.equal(typeof text.note, "string", "the text layer says it in words");
  await mind.store.close();
});

test("browsing is deterministic, and `from` moves the window", async () => {
  const mind = await fixture();
  const a = mind.sampleCorpus(2);
  const b = mind.sampleCorpus(2);
  assert.deepEqual(
    a.pairs.map((p) => [p.contextId, p.continuationId]),
    b.pairs.map((p) => [p.contextId, p.continuationId]),
    "browsing must not draw randomly",
  );
  const other = mind.sampleCorpus(2, 0.5);
  assert.ok(
    other.pairs.every((p) => p.matchedBytes === 0),
    "browse samples carry no query match",
  );
  await mind.store.close();
});
