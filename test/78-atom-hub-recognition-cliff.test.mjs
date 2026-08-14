// 78-atom-hub-recognition-cliff.test.mjs — recognition must not LOSE interior
// sites when the corpus crosses the atomIsHub threshold.
//
// THE BUG THIS PINS.  `atomIsHub` flips at exactly N = 4096 edge sources:
// atomReach = ⌈N·W/256⌉ = ⌈N/64⌉ exceeds boundFor = √N there (W = 4).
// recogniseImpl gated FOUR things on that flip, and one of them —
// tryChain's `!boundary && atomsAreHubs` — blanket-suppressed every
// off-boundary chain. A store crossing 4096 therefore silently stopped
// recognising interior forms it had recognised at 4095, with no error and no
// failing test. Measured on the two-hop fixture below: 4 sites including
// "France" at N = 3920, 2 sites without it at N = 4227.
//
// The fix asks whether the byte-exact branch tryChain ALREADY found is a
// deposited whole (`bearsEdge`) instead of whether its offset happened to land
// on a fold cut. So the discriminating assertion is: at N > 4096, an interior
// form that BEARS A CONTINUATION EDGE is still a recognised site.
//
// WHY THIS IS SLOW AND MUST STAY SO.  The threshold is a property of corpus
// scale, so the only honest fixture is one that actually crosses it — 4300
// deposits, ~6 s. A cheaper store would sit below the flip and pass under the
// old code too, which is exactly the hole this file exists to close.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { recognise } from "../dist/src/mind/recognition.js";
import { atomIsHub, corpusN } from "../dist/src/mind/traverse.js";

const CHAIN = [
  ["Eiffel Tower country", "The country of Eiffel Tower is France."],
  ["France capital", "The capital of France is Paris."],
  // The PIVOT: a bare entity that bears a continuation edge, and which occurs
  // INSIDE hop 1's answer at an offset the fold did not choose as a cut.
  ["France", "The capital of France is Paris."],
];
const ANSWER = "The country of Eiffel Tower is France.";

// Lexically VARIED filler. A single repeated template ("filler 12 alpha") folds
// to a handful of shared chunks and leaves the query almost uncontested, which
// was enough to let the two-hop chain compose even with the gate in place —
// i.e. a templated corpus makes the behavioural test non-discriminating. Real
// corpora are lexically diverse, so the filler must be too.
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

const dec = new TextDecoder();
const textOf = (store, id) =>
  dec.decode(store.bytes(id).filter((x) => x !== 0));

test("the fixture really is past the atomIsHub threshold", async () => {
  const { store, mind } = await pastTheFlip();
  const n = corpusN(mind);
  assert.ok(n > 4096, `fixture must cross N=4096, got ${n}`);
  assert.equal(
    atomIsHub(mind, n),
    true,
    "atoms must read as hubs, or this file tests nothing",
  );
});

test("an edge-bearing interior form is still recognised past the flip", async () => {
  const { store, mind } = await pastTheFlip();
  mind.beginResponse?.();
  const rec = recognise(mind, new TextEncoder().encode(ANSWER));
  mind.endResponse?.();
  const texts = rec.sites.map((s) => textOf(store, s.payload));
  assert.ok(
    texts.includes("France"),
    `interior form "France" was not recognised past the flip; sites = ${
      JSON.stringify(texts)
    }`,
  );
});

test("the interior form is reachable as a pivot, so the chain composes", async () => {
  // The behavioural consequence: reason() pivots on the longest unconsumed
  // learnt context the grounded answer CONTAINS. Lose the site and the hop is
  // structurally unreachable, whatever the rest of the pipeline does.
  const { mind } = await pastTheFlip();
  const steps = [];
  const out = await mind.respondText(
    "What is the capital of the country of Eiffel Tower?",
    (s) => steps.push(s.mechanism[s.mechanism.length - 1]),
  );
  assert.ok(
    steps.includes("pivotStep"),
    `no pivotStep past the flip; answer was ${JSON.stringify(out)}`,
  );
  assert.ok(
    out.includes("Paris"),
    `two-hop chain did not compose past the flip: ${JSON.stringify(out)}`,
  );
});

test("a fragment that leads nowhere is still NOT recognised", async () => {
  // The other half of the contract: the gate was protecting against
  // opportunistic byte-atom chains, and the fix must not have opened that door.
  // "owe" occurs inside "Eiffel Tower country" but was never deposited as a
  // form of its own, so it bears no edge and no halo.
  const { store, mind } = await pastTheFlip();
  mind.beginResponse?.();
  const rec = recognise(mind, new TextEncoder().encode(ANSWER));
  mind.endResponse?.();
  for (const s of rec.sites) {
    const t = textOf(store, s.payload);
    assert.ok(
      t.length >= 4,
      `sub-window fragment ${JSON.stringify(t)} was admitted as a site`,
    );
  }
  // And pure noise must still ground to nothing.
  assert.equal(await mind.respondText("qq8f3kz9 zzxq wvbn"), "");
});
