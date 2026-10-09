// 156-the-derivation-read-off-other-instances.test.mjs — a question whose
// relation is a DERIVATION, read off other instances of the same question.
//
// THE READING (traverse.ts, `relationFrames`, `derivationSteps`; evidence.md).
// `Who is the paternal grandmother of Z?` answered `The mother of Y is W.` is a
// co-instance whose continuation no context holding `Z` establishes: it is the
// end of a derivation from `Z`.  Read as two hops meeting at an entity — `Z
// father` leads to `The father of Z is Y.`, which holds `Y`, and `Y mother`
// establishes the answer — the relation is the pair `· father`, `· mother`.
// Where two instances spell the pair alike, it is followed IN ORDER from the
// question's own entity: the first step from the thing the question names, the
// second only from an entity the first step's fact holds.  Nothing is stored,
// and every step is an exact lookup.
//
// MEASURED on 2WikiMultihopQA: inference questions (`paternal grandmother`,
// `maternal grandfather`, `father-in-law`) over the evidence of 300 held-out
// rows plus inference questions about OTHER entities went 6 → 21 of 37; no
// test entity had a question of its own.
//
// Pinned:
//   156.1 the derivation read off other instances answers a new entity's
//         question;
//   156.2 one instance agrees with nothing: the chain stops at the first hop;
//   156.3 the steps are followed in order, and each frame by its own pair: an
//         entity with both parents and both sets of grandparents gets its
//         paternal grandmother for one question and its maternal grandfather
//         for the other;
//   156.4 a filler the instance spells only under the response's equivalence
//         (`Henry Of Navarre` for the stored `Henry of Navarre`) is read through
//         the canonical class.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

/** Deposit triples as the trainer does (wiki2.ts). */
function deposits(triples) {
  const items = [];
  for (const [s, r, o] of triples) {
    const fact = `The ${r} of ${s} is ${o}.`;
    items.push([`${s} ${r}`, fact], [s, fact]);
  }
  return items;
}

// The entity asked about: both parents, and both parents' parents.
const ANNE = [
  ["Anne of Kiev", "father", "Yaroslav the Wise"],
  ["Anne of Kiev", "mother", "Ingegerd Olofsdotter"],
  ["Yaroslav the Wise", "father", "Vladimir the Great"],
  ["Yaroslav the Wise", "mother", "Rogneda of Polotsk"],
  ["Ingegerd Olofsdotter", "father", "Olof Skötkonung"],
  ["Ingegerd Olofsdotter", "mother", "Estrid of the Obotrites"],
];

/** Instances of `paternal grandmother`: father, then mother. */
const PATERNAL = [
  [
    "Henry Of Navarre",
    "Henry of Navarre",
    "Antoine of Navarre",
    "Françoise d'Alençon",
  ],
  [
    "Charles The Bald",
    "Charles the Bald",
    "Louis the Pious",
    "Hildegard of the Vinzgau",
  ],
  ["Otto II", "Otto II", "Otto the Great", "Matilda of Ringelheim"],
];

/** Instances of `maternal grandfather`: mother, then father. */
const MATERNAL = [
  ["Louis IX", "Louis IX", "Blanche of Castile", "Alfonso VIII of Castile"],
  [
    "Edward the Black Prince",
    "Edward the Black Prince",
    "Philippa of Hainault",
    "William I of Hainaut",
  ],
];

function paternal([asked, z, y, w]) {
  return {
    triples: [[z, "father", y], [y, "mother", w]],
    instance: [
      `Who is the paternal grandmother of ${asked}?`,
      `The mother of ${y} is ${w}.`,
    ],
  };
}
function maternal([asked, z, y, w]) {
  return {
    triples: [[z, "mother", y], [y, "father", w]],
    instance: [
      `Who is the maternal grandfather of ${asked}?`,
      `The father of ${y} is ${w}.`,
    ],
  };
}

async function mindWith(instances) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  const items = deposits(ANNE);
  for (const { triples, instance } of instances) {
    items.push(...deposits(triples), instance);
  }
  await mind.ingest(items);
  await mind.buildCanonIndex();
  return { mind, store };
}

async function ask(instances, q) {
  const { mind, store } = await mindWith(instances);
  try {
    return await mind.respondText(q);
  } finally {
    await store.close();
  }
}

const BOTH = [...PATERNAL.map(paternal), ...MATERNAL.map(maternal)];

test("156.1 the derivation read off other instances answers a new entity's question", async () => {
  const text = await ask(
    PATERNAL.map(paternal),
    "Who is the paternal grandmother of Anne Of Kiev?",
  );
  assert.match(text, /Rogneda of Polotsk/, `answered "${text}"`);
});

test("156.2 one instance agrees with nothing — the chain stops at the first hop", async () => {
  const text = await ask(
    PATERNAL.slice(2).map(paternal),
    "Who is the paternal grandmother of Anne Of Kiev?",
  );
  assert.doesNotMatch(text, /Rogneda/, `answered "${text}"`);
});

test("156.3 the steps are followed in order, each frame by its own pair", async () => {
  const grandmother = await ask(
    BOTH,
    "Who is the paternal grandmother of Anne Of Kiev?",
  );
  assert.match(grandmother, /Rogneda of Polotsk/, `answered "${grandmother}"`);
  assert.doesNotMatch(
    grandmother,
    /Estrid|Vladimir|Olof Sk/,
    "neither the other grandparents nor a step out of order",
  );
  const grandfather = await ask(
    BOTH,
    "Who is the maternal grandfather of Anne Of Kiev?",
  );
  assert.match(grandfather, /Olof Skötkonung/, `answered "${grandfather}"`);
  assert.doesNotMatch(grandfather, /Rogneda|Vladimir|Estrid/);
});

test("156.4 a filler spelled only under the response's equivalence is read through the canonical class", async () => {
  // Both instances spell their entity in title case (`Henry Of Navarre`,
  // `Charles The Bald`) against the stored `Henry of Navarre`, `Charles the
  // Bald`: no flat run spells either filler, and only the canonical class
  // makes them instances at all.
  const text = await ask(
    PATERNAL.slice(0, 2).map(paternal),
    "Who is the paternal grandmother of Anne Of Kiev?",
  );
  assert.match(text, /Rogneda of Polotsk/, `answered "${text}"`);
});
