// 99-fact-join.test.mjs — DERIVE-THROUGH: derive the answer THROUGH a produced
// fact whose subject the query never names.
//
// THE MOVE THIS PINS.  A query like "Eiffel Tower country capital" names hop 1's
// key ("Eiffel Tower country") and hop 2's relation (" capital"), but never the
// intermediate subject ("France").  The cover alone can only juxtapose the two
// facts; the pivot needs the subject to surface as an unconsumed site inside the
// produced fact.  The `deriveThrough` rule in graph-search.ts closes the gap: it
// takes the entity the produced fact CONTAINS, combines it with the query's
// remaining tail, and asks the store for that key's continuation — a direct STEP
// on the ladder, reported as `derive-through` in the rationale.  (The operation
// is a relational join; the MOVE is named `derive-through` so it cannot be read
// as the confluence mechanism's `join` PROVENANCE.)
//
// WHY THE FIXTURE CROSSES N=4096.  Below the atomIsHub flip the interior subject
// surfaces anyway (small-store recognition) and the PIVOT alone reaches the
// chain, so a small fixture passes under the pre-change tree too — measured on a
// 3-deposit store, which answered "The father of Gustaf Molander is Harald
// Molander." with no derive-through move.  That rule is what carries the chain at corpus scale,
// so the fixture must sit past the flip, exactly as test/78 does.  The filler is
// lexically varied for the same reason test/78's is: a templated corpus folds to
// shared chunks and leaves the query uncontested.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const CHAIN = [
  ["Eiffel Tower country", "The country of Eiffel Tower is France."],
  ["France capital", "The capital of France is Paris."],
  // The pivot fact: the intermediate subject as a context of its own.
  ["France", "The capital of France is Paris."],
];

const WORDS =
  ("alpha bravo charlie delta echo foxtrot golf hotel india juliet " +
    "kilo lima mike november oscar papa quebec romeo sierra tango uniform " +
    "victor whiskey xray yankee zulu amber bronze copper dahlia ember fjord " +
    "gossamer harbour indigo jasmine kestrel lantern marigold nectar opal " +
    "pewter quartz ripple saffron thistle umber violet willow xenon yarrow")
    .split(" ");
const filler = (i) => {
  const w = (n) => WORDS[(i * 7 + n * 13) % WORDS.length];
  return [
    `${w(1)} ${w(2)} ${w(3)} ${i}`,
    `${w(4)} ${w(5)} ${w(6)} ${w(7)} ${i}`,
  ];
};

/** One store, ingested past the atomIsHub flip. */
async function pastTheFlip() {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest(CHAIN);
  await mind.ingest(Array.from({ length: 4300 }, (_, i) => filler(i)));
  return { store, mind };
}

test("derive-through: a produced fact whose subject the query never names", async () => {
  const { store, mind } = await pastTheFlip();
  const query = "Eiffel Tower country capital";
  assert.ok(
    !query.includes("France") && !query.includes("capital of France"),
    "sanity: the intermediate subject must NOT be named in the query",
  );

  const moves = [];
  const out = await mind.respondText(
    query,
    (s) => moves.push(s.mechanism[s.mechanism.length - 1]),
  );

  assert.equal(out.trim(), "The capital of France is Paris.");
  assert.ok(
    moves.includes("derive-through"),
    `expected derive-through to be the move that reached the answer, got: ${
      [...new Set(moves)].join(", ")
    }`,
  );
  await store.close();
});

test("naming the intermediate does not need derive-through — the cover reads it directly", async () => {
  // The contrast that keeps the move honest: when the subject IS written, the
  // cover already reaches the chain, so no derive-through is claimed.
  const { store, mind } = await pastTheFlip();
  const moves = [];
  const out = await mind.respondText(
    "Eiffel Tower country France capital",
    (s) => moves.push(s.mechanism[s.mechanism.length - 1]),
  );
  assert.ok(out.includes("The capital of France is Paris."));
  assert.ok(
    !moves.includes("derive-through"),
    "a named intermediate must not be reported as derive-through",
  );
  await store.close();
});
