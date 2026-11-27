// 188-a-form-with-a-span-left-out.test.mjs — the question writes a stored
// form's opening and its close, one after the other.
//
// THE READING (traverse.ts, `heldPoints`, `leftOut`; evidence.md).  A stored
// form the question spells with one span missing is no site of recognition,
// which reads bytes: `Frances Carpenter` is not `Frances Aretta Carpenter`,
// and an exchange asked without one of its words is not that exchange.  The
// consensus climb proposes the form (its points) and the question's bytes
// decide: they open as the form opens and close as it closes, each side at
// least one window, and what is held is most of the form.  Every byte the
// question writes there is the form's own, so it is held at that span and the
// cover takes it as a site — as it takes a form held only under the
// response's equivalence.  The span left out names nothing by itself: where
// another proposed form opens and closes the same way around something else
// and leads elsewhere, the corpus tells the position apart and the question
// names neither (`discriminates`); and where the bytes the question writes
// are themselves a form that leads somewhere, the exact reading stands.
//
// MEASURED.  2Wiki fixtures (240 two-hop questions, the second fixture never
// read while this was written): 204 → 213, none lost — nine people asked by
// a shorter name.  The trained store's gate (188 stored exchanges asked
// perturbed, the second draw held out): 149 → 165, none lost; one byte
// deleted 26 → 32 of 32, one word removed 13 → 23 of 30.
//
// Pinned:
//   188.1 a name with a part left out is the stored name, and the chain goes
//         on from it;
//   188.2 an exchange asked without one of its words is that exchange;
//   188.3 two stored forms that differ where the question is silent: neither
//         is named;
//   188.4 what the question writes is itself a form that leads somewhere:
//         the exact reading stands;
//   188.5 holding less than most of the form is holding two pieces of it;
//   188.6 another form holds what the question writes byte for byte: the
//         left-out span cannot say which is meant.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";

const people = [
  ["Frances Aretta Carpenter", "Frank G. Carpenter", "Nanking"],
  ["Helena Winifred Carroll", "Paul Vincent Carroll", "Bromley"],
  ["Jorge Sapag", "Elías Sapag", "Neuquén"],
  ["Caleb Stark", "John Stark", "Manchester"],
];
/** Each fact under its entity alone and under the entity with its relation,
 *  as the trained store holds them; two instances of the question's frame. */
async function world(extra = []) {
  const mind = new Mind({ seed: 7, profile: true });
  for (const [child, father, place] of [...people, ...extra]) {
    const f1 = `The father of ${child} is ${father}.`;
    const f2 = `The place of death of ${father} is ${place}.`;
    await mind.ingest(child, f1);
    await mind.ingest(`${child} father`, f1);
    await mind.ingest(father, f2);
    await mind.ingest(`${father} place of death`, f2);
  }
  for (const [child, father, place] of people.slice(2)) {
    await mind.ingest(
      `Where was the place of death of ${child}'s father?`,
      `The place of death of ${father} is ${place}.`,
    );
  }
  return mind;
}

test("188.1 a name with a part left out is the stored name, and the chain goes on", async () => {
  const mind = await world();
  const notes = [];
  const answer = await mind.respondText(
    "Where was the place of death of Frances Carpenter's father?",
    (s) => {
      if (s.mechanism.at(-1) === "heldLeftOut") notes.push(s);
    },
  );
  assert.equal(answer, "The place of death of Frank G. Carpenter is Nanking.");
  assert.ok(notes.length > 0, "the reading is in the rationale");
  assert.equal(notes[0].inputs[0].text, "Frances Aretta Carpenter");
  assert.equal(notes[0].outputs[0].text, "Frances Carpenter");
  await mind.respondText(
    "Where was the place of death of Frances Carpenter's father?",
  );
  assert.ok((mind.lastCost.counters.heldLeftOut ?? 0) >= 1, "and metered");
  await mind.store.close();
});

const ORDER = [
  "Hi, I would like to order a large pepperoni pizza for tonight.",
  "Sure. Thin crust or deep dish?",
  "Thin crust, please, and well done.",
  "Any toppings besides the pepperoni?",
];
const RIDE = [
  "Hello, can you book me a ride to the airport tomorrow morning?",
  "Of course. What time is your flight?",
  "It leaves at nine, so around six would be good.",
  "A car will be at your door at six.",
];

test("188.2 an exchange asked without one of its words is that exchange", async () => {
  const mind = new Mind({ seed: 7 });
  for (const turns of [ORDER, RIDE]) {
    let context = "";
    for (let i = 0; i + 1 < turns.length; i++) {
      context += (i > 0 ? "\n" : "") + turns[i];
      await mind.ingest(context, turns[i + 1]);
    }
  }
  const asked = ORDER.slice(0, 3).join("\n");
  assert.equal(await mind.respondText(asked), ORDER[3], "verbatim");
  // One word gone from the first turn; one byte gone from the second.
  assert.equal(
    await mind.respondText(asked.replace("a large pepperoni", "a pepperoni")),
    ORDER[3],
  );
  assert.equal(
    await mind.respondText(asked.replace("deep dish", "dep dish")),
    ORDER[3],
  );
  await mind.store.close();
});

test("188.3 two forms that differ where the question is silent: neither is named", async () => {
  // `Frances Jane Carpenter` opens and closes as `Frances Aretta Carpenter`
  // does, and her father died elsewhere: the corpus tells the position apart.
  const mind = await world([
    ["Frances Jane Carpenter", "Amos Carpenter", "Leeds"],
  ]);
  const notes = [];
  const answer = await mind.respondText(
    "Where was the place of death of Frances Carpenter's father?",
    (s) => {
      if (s.mechanism.at(-1) === "heldLeftOut") notes.push(s);
    },
  );
  assert.equal(notes.length, 0, "no form is held with a span left out");
  assert.ok(!answer.includes("Nanking") && !answer.includes("Leeds"), answer);
  await mind.store.close();
});

test("188.4 what the question writes is itself a form that leads somewhere: it stands", async () => {
  const mind = await world([
    ["Frances Carpenter", "Silas Carpenter", "Dover"],
  ]);
  const notes = [];
  const answer = await mind.respondText(
    "Where was the place of death of Frances Carpenter's father?",
    (s) => {
      if (s.mechanism.at(-1) === "heldLeftOut") notes.push(s);
    },
  );
  assert.equal(notes.length, 0);
  assert.equal(answer, "The place of death of Silas Carpenter is Dover.");
  await mind.store.close();
});

test("188.5 holding less than most of a form is holding two pieces of it", async () => {
  // `Anna Lind` opens and closes `Anna Sofia Charlotta Wilhelmina Lind`, and
  // holds a quarter of it.
  const mind = await world([
    ["Anna Sofia Charlotta Wilhelmina Lindqvist", "Olof Lindqvist", "Lund"],
  ]);
  const notes = [];
  await mind.respondText(
    "Where was the place of death of Anna Lindqvist's father?",
    (s) => {
      if (s.mechanism.at(-1) === "heldLeftOut") notes.push(s);
    },
  );
  assert.equal(notes.length, 0);
  await mind.store.close();
});

test("188.6 another form holds what the question writes: neither is named", async () => {
  // `Frances Carpenter Jr.` holds `Frances Carpenter` byte for byte; the
  // question may be short for either.
  const mind = await world();
  await mind.ingest(
    "Frances Carpenter Jr.",
    "The occupation of Frances Carpenter Jr. is surgeon.",
  );
  const notes = [];
  const answer = await mind.respondText(
    "Where was the place of death of Frances Carpenter's father?",
    (s) => {
      if (s.mechanism.at(-1) === "heldLeftOut") notes.push(s);
    },
  );
  assert.equal(notes.length, 0);
  assert.ok(!answer.includes("Nanking"), answer);
  await mind.store.close();
});
