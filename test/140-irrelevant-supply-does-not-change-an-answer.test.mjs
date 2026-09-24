// 140 — irrelevant supply does not change an answer already given.
//
// The sixth acceptance criterion of the derivation audit: adding facts that have
// nothing to do with the question must not move the answer, merely by enlarging
// what the market has to offer.  Measured relationally against the fixture's own
// link, not against a string copied into the test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const QUERY = "What is the capital of France famous for";

const LINKS = [
  ["What is the capital of France", "The capital of France is Paris"],
  ["Paris", "Paris is famous for the Eiffel Tower"],
];

/** Facts with no bearing on the question, and enough bytes to be real nodes. */
const IRRELEVANT = [
  ["Coffee", "Coffee is brewed from roasted beans"],
  ["The Moon", "The Moon orbits the Earth once a month"],
  ["Basalt", "Basalt is a fine-grained volcanic rock"],
  ["Trumpet", "The trumpet is a brass instrument"],
  ["Saffron", "Saffron is a spice from the crocus flower"],
  ["Tide", "The tide rises twice in a lunar day"],
];

async function corpus(facts) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(facts);
  return mind;
}

const text = (resp) => new TextDecoder().decode(resp.bytes).replace(/\0+/g, "");

test("140.1 the answer survives a corpus enlarged with unrelated facts", async () => {
  const lean = await corpus(LINKS);
  const fat = await corpus([...LINKS, ...IRRELEVANT]);
  const answer = text(await lean.respond(QUERY)).trim();
  const withNoise = text(await fat.respond(QUERY)).trim();
  assert.equal(answer, LINKS[1][1], "the fixture's own second link");
  assert.equal(withNoise, answer, "irrelevant supply must not displace it");
  await lean.store.close();
  await fat.store.close();
});
