// 154-the-question-names-the-step.test.mjs — a stored structure is identified
// by the material at hand, wherever the pieces of that material came from.
//
// THE OPERATION (src/mind/evidence.ts).  A stored form is WITNESSED by some
// material when every one of its bytes lies in a W-window the material holds —
// in any order, at any place.  The corpus writes down, for every continuation,
// the questions that establish it (its predecessors).  A continuation is NAMED
// when one of those questions is witnessed by the asker's bytes plus the node
// being followed.
//
// THE DEFECTS IT CLOSES, measured on the 31.7M-node store and on 5,236 held-out
// 2WikiMultihopQA compositional questions deposited exactly as the trainer
// deposits their evidence triples (example/train_base/corpora/wiki2.ts):
//   • the forward choice among a node's continuations read popularity only, so
//     `Who is the father of Frederick II?` answered the most-poured of his
//     eight facts (his citizenship) — the father fact's own establishing
//     question `Frederick II father` lay wholly inside the question;
//   • the walk consumed EVERY form recognised inside the first hop's answer, the
//     entity the hop introduced included, so the chain could not step past it
//     (3 pivot steps over 133 compositional questions);
//   • the second hop's establishing question is held by neither the question
//     (1% of the 5,236) nor the first hop's fact, only by both (41%).
//
// Pinned:
//   154.1 witnessing is order-free, complete or nothing, credits a window to the
//         last source that holds it, and refuses a form below one window;
//   154.2 the continuation the question names wins over the most-poured one;
//   154.3 the second hop is named by question material plus the entity the
//         first hop introduced — neither alone holds it;
//   154.4 a question that names no further step is not extended: the material
//         that named the first hop cannot name a second;
//   154.5 a fragment (`director`, inside every `… director` question) answers
//         other questions: the cover voices none of its continuations unless the
//         question names one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { windowIndex, witness } from "../dist/src/mind/evidence.js";

const enc = (s) => new TextEncoder().encode(s);

/** Deposit triples as the trainer does: the relation fact under both the
 *  subject-relation key and the bare subject (wiki2.ts). */
function deposits(triples) {
  const items = [];
  for (const [s, r, o] of triples) {
    const fact = `The ${r} of ${s} is ${o}.`;
    items.push([`${s} ${r}`, fact], [s, fact]);
  }
  return items;
}

const TRIPLES = [
  // Distractors deposited FIRST: every relation the questions name has older,
  // unrelated instances, so neither first-insertion nor popularity can land on
  // the asked fact by accident.
  ["Marius", "place of death", "Marseille"],
  ["Jinpa", "director", "Pema Tseden"],
  ["Kalippava", "place of death", "Kochi"],
  ["Le Guignolo", "director", "Georges Lautner"],
  // Frederick II: the citizenship fact first and repeated, so popularity and
  // first-insertion both pick it.
  ["Frederick II", "country of citizenship", "Holy Roman Empire"],
  ["Frederick II", "place of death", "Wartburg"],
  ["Frederick II", "father", "Peter III of Aragon"],
  ["Peter III of Aragon", "father", "James I of Aragon"],
  ["Peter III of Aragon", "place of birth", "Valencia"],
  // A two-hop chain.
  ["Beat Girl", "director", "Edmond T. Gréville"],
  ["Edmond T. Gréville", "place of death", "Nice"],
  ["Edmond T. Gréville", "place of birth", "Nice"],
  ["Polish-Russian War", "director", "Xawery Żuławski"],
  ["Xawery Żuławski", "mother", "Małgorzata Braunek"],
  ["Juan Carlos Gumucio", "spouse", "Marie Colvin"],
  ["Marie Colvin", "place of death", "Homs"],
  ["Ronnie Rocket", "director", "David Lynch"],
  ["Who...", "performer", "Ayumi Hamasaki"],
  ["Ayumi Hamasaki", "place of birth", "Fukuoka"],
  ["David Lynch", "place of birth", "Missoula, Montana"],
];

/** Filler facts in the same template, lexically varied (the test/99 recipe):
 *  without them the store is too small for any window to be SCAFFOLDING, and
 *  ` is `, `The `, ` of ` would read as owed question material — a regime the
 *  trained store never is in. */
const WORDS =
  ("alpha bravo charlie delta echo foxtrot golf hotel india juliet " +
    "kilo lima mike november oscar papa quebec romeo sierra tango uniform " +
    "victor whiskey xray yankee zulu amber bronze copper dahlia ember fjord " +
    "gossamer harbour indigo jasmine kestrel lantern marigold nectar opal")
    .split(" ");
const RELATIONS = ["award received", "employer", "director", "performer"];
function fillers(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = (k) => WORDS[(i * 7 + k * 13) % WORDS.length];
    out.push([
      `${w(0)} ${w(1)}`,
      RELATIONS[i % RELATIONS.length],
      `${w(2)} ${w(3)}`,
    ]);
  }
  return out;
}

async function fixture() {
  const mind = new Mind({
    seed: 7,
    profile: true,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest(deposits(fillers(120)));
  await mind.ingest(deposits(TRIPLES));
  // Pour the citizenship fact again, so the distributional ladder prefers it.
  await mind.ingest([[
    "Frederick II",
    "The country of citizenship of Frederick II is Holy Roman Empire.",
  ]]);
  return mind;
}

test("154.1 witnessing is order-free, complete or nothing, and credits the last holder", () => {
  const W = 4;
  const question = enc("What is the country of citizenship of Frederick II?");
  const node = enc("Frederick II");
  const qi = windowIndex(question, W);
  const ni = windowIndex(node, W);
  // Reordered pieces are witnessed; the question is credited only with what
  // the node does not hold.
  const w = witness(enc("Frederick II country of citizenship"), [qi, ni], W);
  assert.equal(w.complete, true);
  const said = w.spans.map(([s, e]) =>
    new TextDecoder().decode(question.subarray(s, e))
  );
  assert.deepEqual(said, [" country of citizenship"]);
  // One byte no source holds refuses the whole form.
  assert.equal(
    witness(enc("Frederick II country of citizenshop"), [qi, ni], W).complete,
    false,
  );
  // Below one window nothing is witnessed.
  assert.equal(witness(enc("Fre"), [qi, ni], W).complete, false);
});

/** The answer plus the rationale steps the assertions read. */
async function ask(mind, question) {
  const steps = [];
  const answer = await mind.respondText(question, (st) => {
    const name = st.mechanism.at(-1);
    if (
      name === "recallByResonance" || name === "askedContinuation" ||
      name === "pivotStep" || name === "liftAnswer"
    ) {
      steps.push({
        name,
        note: st.note ?? "",
        inputs: st.inputs.map((o) => o.text ?? ""),
        outputs: st.outputs.map((o) => o.text ?? ""),
      });
    }
  });
  return { answer, steps };
}

const FATHER = "The father of Frederick II is Peter III of Aragon.";
const DEATH = "The place of death of Edmond T. Gréville is Nice.";

test("154.2 the continuation the question names wins over the most-poured one", async () => {
  const mind = await fixture();
  const { answer, steps } = await ask(
    mind,
    "Who is the father of Frederick II?",
  );
  // The projection that grounds on the argument `Frederick II` crosses the
  // father fact — the one whose own question `Frederick II father` the asker's
  // bytes witness — not the citizenship fact popularity prefers.
  const bound = steps.find((s) =>
    s.name === "recallByResonance" && /argument binding/.test(s.note)
  );
  assert.ok(bound, "the argument binding must ground");
  assert.equal(bound.outputs[0], FATHER);
  const named = steps.find((s) =>
    s.name === "askedContinuation" && s.inputs[1] === "Frederick II father"
  );
  assert.ok(named, "the rationale names the witnessed question");
  assert.deepEqual(named.outputs, [FATHER]);
  assert.match(answer, /The father of Frederick II is Peter III of Aragon\./);
  await mind.store.close();
});

test("154.3 the second hop is named by the question plus the entity the first hop introduced", async () => {
  const mind = await fixture();
  const { answer, steps } = await ask(
    mind,
    "Where was the place of death of the director of film Beat Girl?",
  );
  const pivot = steps.find((s) => s.name === "pivotStep");
  assert.ok(pivot, "the chain must step past the first hop");
  assert.equal(pivot.inputs[1], "Edmond T. Gréville");
  assert.equal(pivot.outputs[0], DEATH);
  // …through the question neither source holds alone.
  assert.ok(
    steps.some((s) =>
      s.name === "askedContinuation" &&
      s.inputs[1] === "Edmond T. Gréville place of death" &&
      s.outputs.includes(DEATH)
    ),
    "the hop is named by `Edmond T. Gréville place of death`",
  );
  assert.match(answer, /The place of death of Edmond T\. Gréville is Nice\./);
  // The same chain whatever grounded the first hop: a CAST substitution, which
  // declares the anchor it voices — whose continuation IS the answer, voiced and
  // not withheld — and a cover, which declares nothing, so what it spoke for is
  // what of the answer the question already holds, never the entity it added.
  for (
    const [question, fact] of [
      [
        "What is the place of birth of the performer of song Who...?",
        "The place of birth of Ayumi Hamasaki is Fukuoka.",
      ],
      [
        "Where was the place of death of Juan Carlos Gumucio's wife?",
        "The place of death of Marie Colvin is Homs.",
      ],
    ]
  ) {
    const chained = await ask(mind, question);
    assert.equal(chained.answer, fact, question);
  }
  await mind.store.close();
});

test("154.4 a question that names no further step is not extended", async () => {
  const mind = await fixture();
  const { answer, steps } = await ask(
    mind,
    "Who is the father of Frederick II?",
  );
  // `Peter III of Aragon father` is a stored question too — but `father` was
  // said by the hop that reached Peter III, so nothing names the grandfather.
  assert.equal(
    steps.filter((s) => s.name === "pivotStep").length,
    0,
    "no further step is taken",
  );
  assert.doesNotMatch(answer, /James I/);
  assert.doesNotMatch(answer, /Valencia/);
  // …and a one-hop question whose answer introduces an entity with facts of
  // its own stops at that answer: nothing the asker still owes is discriminative
  // (`Who is the` is frame), so no step can claim to pay it by restating ` is `.
  // The material that named a hop names no second one, however the question
  // is phrased: `Who was Frederick II's father?` says `father` once.
  const again = await ask(mind, "Who was Frederick II's father?");
  assert.equal(again.answer, FATHER);
  const one = await ask(mind, "Who is the director of Beat Girl?");
  assert.equal(one.answer, "The director of Beat Girl is Edmond T. Gréville.");
  assert.equal(one.steps.filter((s) => s.name === "pivotStep").length, 0);
  await mind.store.close();
});

test("154.5 a fragment answers other questions unless the question names one", async () => {
  const mind = await fixture();
  const { steps } = await ask(
    mind,
    "Where did the director of film Beat Girl die?",
  );
  // The cover's own composition: `director` sits inside every `… director`
  // question, so its continuations are the directors of OTHER films — voicing
  // one of them by popularity glued a stranger's fact onto the answer.
  const composed = steps.filter((s) => s.name === "liftAnswer").map((s) =>
    s.outputs[0]
  );
  assert.ok(composed.length > 0, "the cover composed");
  for (const c of composed) {
    assert.equal(c, "The director of Beat Girl is Edmond T. Gréville.");
  }
  assert.ok(mind.lastCost.counters.unaskedFragments > 0);
  await mind.store.close();
});
