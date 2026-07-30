// 69-frame-filler.test.mjs — the frame-filler tier must not fire without its
// evidence, and must refuse an ambiguous subject.
//
// WHAT THE MECHANISM DOES (src/mind/frame-filler.ts): when every other tier has
// declined, take the query's described span, put a corroborated filler from a
// trained context in its place, and require the STORE to already hold that key
// byte-exactly.  "We invent a lookup KEY, never an answer" — the answer is the
// trained continuation of a form the store verifiably has.
//
// THE WIN IS REAL-STORE EVIDENCE, NOT A FIXTURE.  On the 15.7M-node trained
// store, `What is the capital of the country where the Eiffel Tower is?` goes
// from silence to "The capital of France is Paris." (provenance `recall`), taking
// analyze_training.ts's section G from 33.3% to 66.7% and the battery from 73.8%
// to 76.2% with `0 weak` intact.  A/B on warm caches: +50 ms on that query,
// +16 ms on a refusing query that runs 480 probes, and +0 ms on
// `What is the capital of Zamunda?` (guard 1 exits before probing) and on every
// query that answers earlier.
//
// WHY NO POSITIVE FIXTURE TEST EXISTS — measured, not assumed.  The mechanism
// keys on corpus RARITY (container counts, the same reading the bridge's anchor
// picking uses).  At fixture scale that signal is absent and even inverted: in a
// 21-deposit store `capital` reports 1 container and `landmark` reports 9, while
// on the trained store `Eiffel` is 54 against `What` at 1,586.  So a fixture
// cannot make the query's rarest word land inside the description, which guard 1
// requires — three fixture shapes were tried (bare, 21-deposit, and one with an
// attested long word in the description) and none reached the positive path.
// What a fixture CAN pin is the refusal side, which is what this file does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { frameFillerSubstitution } from "../dist/src/mind/frame-filler.js";
import { textSegmenter } from "../dist/src/canon.js";

const enc = (s) => new TextEncoder().encode(s);
const FRAME = [
  ["What is the capital of France?", "Paris is the capital of France."],
  ["What is the capital of Spain?", "Madrid is the capital of Spain."],
  ["What is the capital of Italy?", "Rome is the capital of Italy."],
  ["What is the capital of Japan?", "Tokyo is the capital of Japan."],
];
const LINK = [
  "What is the most famous landmark in France?",
  "The most famous landmark in France is the Eiffel Tower.",
];
const LINK2 = [
  "What is the tallest structure in Spain?",
  "The tallest structure in Spain is the Eiffel Tower.",
];
const Q = "What is the capital of the country where the Eiffel Tower is?";

async function fixture(train) {
  const mind = new Mind({
    seed: 1,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest(train);
  return mind;
}
/** Call the tier the way recall does: the query plus recall's ranked hit ids. */
async function tier(mind, q) {
  // The tier asks the MODALITY where units are; respond() injects that on the
  // text path.  Calling the tier directly must inject it too, or the mechanism
  // correctly declines and these assertions would pass vacuously.
  mind.segmenter = textSegmenter;
  const hits = await mind.store.resonate(mind.perceive(q).v, 24);
  return frameFillerSubstitution(mind, enc(q), hits.map((h) => h.id));
}

test("1. no linking evidence — the tier does not fire", async () => {
  // The frame is attested, but nothing in the store ties the description's
  // content to any filler.  Guard 1 has nothing to qualify.
  const m = await fixture(FRAME);
  assert.equal(await tier(m, Q), null);
  await m.store.close();
});

test("2. an AMBIGUOUS subject is refused", async () => {
  // Two trained contexts hold the description's content and each proposes a
  // different filler.  Guard 4: neither is licensed.
  const m = await fixture([...FRAME, LINK, LINK2]);
  assert.equal(await tier(m, Q), null);
  await m.store.close();
});

test("3. an unrelated query never grounds a frame neighbour", async () => {
  // The fabrication shape: a fictional filler in an attested frame.  On the real
  // store this query resolves 24 keys (Chile, India, Japan, Italy …) once the
  // guards are weakened, so it is the case that most needs pinning.
  const m = await fixture([...FRAME, LINK]);
  for (
    const q of [
      "What is the capital of Zamunda?",
      "xyzzy plugh quux baz?",
      "qq8f3kz9 vv2m1x7w?",
    ]
  ) {
    assert.equal(await tier(m, q), null, `expected refusal for ${q}`);
  }
  await m.store.close();
});

test("4. the tier is deterministic and side-effect free", async () => {
  const m = await fixture([...FRAME, LINK]);
  const a = await tier(m, Q);
  const b = await tier(m, Q);
  assert.deepEqual(a, b);
  // Running it must not disturb the answers of forms that ground normally.
  assert.match(await m.respondText("What is the capital of France?"), /Paris/);
  await m.store.close();
});

test("5. end to end, the fixture's own trained forms still answer", async () => {
  const m = await fixture([...FRAME, LINK]);
  assert.match(await m.respondText("What is the capital of Spain?"), /Madrid/);
  assert.match(await m.respondText("What is the capital of Japan?"), /Tokyo/);
  assert.equal(await m.respondText("qq8f3kz9 vv2m1x7w?"), "");
  await m.store.close();
});
