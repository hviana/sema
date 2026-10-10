// 155-the-relation-read-off-another-instance.test.mjs — a question's relation
// is identified through ANOTHER INSTANCE of the same question.
//
// THE READING (traverse.ts, `byCoInstance`; evidence.md).  A stored context the
// question witnesses in every byte but ONE contiguous span is a CO-INSTANCE:
// the question's own frame around a different filler (`Where was Peter Jackson
// born?` against `Where was the director of film Beat Girl born?` leaves
// `Peter Jackson`).  The co-instance's continuation is established by other
// contexts too (`Peter Jackson place of birth`), and the one holding the filler
// spells the relation the way the corpus does — read only where two
// co-instances spell it alike, since one alignment agrees with nothing.
// Putting the node the
// derivation stands on where the filler was, and looking the result up by
// content, names that node's continuation for the same relation — `born`
// becomes `place of birth` without either equivalence or frame being stored.
//
// MEASURED on 2WikiMultihopQA: 58% of compositional questions phrase the
// second relation differently from its stored label.  With the evidence
// triples of 300 held-out rows plus 261 one-hop questions about OTHER entities
// (built from other rows by replacing the first hop's phrase with its
// referent), compositional answers went 35 → 65 of 133; no test entity had a
// one-hop question of its own.
//
// Pinned:
//   155.1 the second hop's relation is read off another instance of the frame;
//   155.2 without two instances that spell the relation alike nothing names
//         it, and the chain stops;
//   155.3 a frame the question shares only partly is no co-instance;
//   155.4 the same reading names the first hop when the entity is asked
//         directly;
//   155.5 another instance's own answer is never voiced: an attention point
//         that is a co-instance of the question is neither grounded (recall)
//         nor fused, and the pieces the instances share are no establishing
//         context of their facts;
//   155.6 a frame a product already said names no further step: `father`,
//         read off another instance for the second hop, does not name a third;
//   155.7 a record whose slot holds a description, not a thing the corpus
//         knows, is the same question about the frame's own subject;
//   155.8 fusion does not fuse a co-instance as a further topic;
//   155.9 a comparison's dominant that is a co-instance is not compared;
//   155.10 a form that only says more than the question — where the question
//         holds no thing of its own — is no other instance of it, and its
//         continuation answers.

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

const TRIPLES = [
  ["Marius", "place of death", "Marseille"],
  ["Jinpa", "director", "Pema Tseden"],
  ["Le Guignolo", "director", "Georges Lautner"],
  ["Beat Girl", "director", "Edmond T. Gréville"],
  // The death fact first and poured twice below, so neither first insertion
  // nor popularity lands on the birth fact by accident.
  ["Edmond T. Gréville", "place of death", "Paris"],
  ["Edmond T. Gréville", "place of birth", "Nice"],
  ["Edmond T. Gréville", "date of birth", "20 June 1906"],
  // Other instances of the same relations.
  ["Peter Jackson", "place of death", "Auckland"],
  ["Peter Jackson", "place of birth", "Wellington"],
  ["Taika Waititi", "place of birth", "Raukokore"],
  ["Nicki Minaj", "place of birth", "Port of Spain"],
  ["Stan Rogers", "place of birth", "Hamilton"],
];

/** One-hop questions about OTHER entities, answered with their facts. */
const INSTANCES = [
  [
    "Where was Peter Jackson born?",
    "The place of birth of Peter Jackson is Wellington.",
  ],
  [
    "Where was Taika Waititi born?",
    "The place of birth of Taika Waititi is Raukokore.",
  ],
  [
    "Where was Nicki Minaj (Nicki Minaj Song) born?",
    "The place of birth of Nicki Minaj is Port of Spain.",
  ],
  [
    "Where was Stan Rogers (Song) born?",
    "The place of birth of Stan Rogers is Hamilton.",
  ],
];

const WORDS =
  ("alpha bravo charlie delta echo foxtrot golf hotel india juliet " +
    "kilo lima mike november oscar papa quebec romeo sierra tango uniform " +
    "victor whiskey xray yankee zulu amber bronze copper dahlia ember fjord " +
    "gossamer harbour indigo jasmine kestrel lantern marigold nectar opal")
    .split(" ");
const RELATIONS = ["award received", "employer", "director", "performer"];
/** Lexically varied filler facts in the same template (test/154's recipe). */
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

async function fixture(instances = INSTANCES) {
  const mind = new Mind({
    seed: 7,
    profile: true,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest(deposits(fillers(120)));
  await mind.ingest(deposits(TRIPLES));
  await mind.ingest([[
    "Edmond T. Gréville",
    "The place of death of Edmond T. Gréville is Paris.",
  ]]);
  if (instances.length > 0) await mind.ingest(instances);
  return mind;
}

async function ask(mind, question) {
  const steps = [];
  const answer = await mind.respondText(question, (st) => {
    const name = st.mechanism.at(-1);
    if (name === "askedByCoInstance" || name === "pivotStep") {
      steps.push({
        name,
        inputs: st.inputs.map((o) => o.text ?? ""),
        outputs: st.outputs.map((o) => o.text ?? ""),
      });
    }
  });
  return { answer, steps };
}

const BIRTH = "The place of birth of Edmond T. Gréville is Nice.";

test("155.1 the second hop's relation is read off another instance of the frame", async () => {
  const mind = await fixture();
  const { answer, steps } = await ask(
    mind,
    "Where was the director of film Beat Girl born?",
  );
  const named = steps.find((s) =>
    s.name === "askedByCoInstance" && s.inputs[0] === "Edmond T. Gréville"
  );
  assert.ok(named, "a co-instance names the hop");
  assert.match(
    named.inputs[1],
    /^Where was (Peter Jackson|Taika Waititi) born\?$/,
  );
  assert.equal(named.inputs[2], "Edmond T. Gréville place of birth");
  assert.deepEqual(named.outputs, [BIRTH]);
  const pivot = steps.find((s) => s.name === "pivotStep");
  assert.ok(pivot, "the chain steps past the first hop");
  assert.equal(pivot.outputs[0], BIRTH);
  // …and the instances themselves are never the answer: `born?`, the piece
  // of both one-hop questions, is no establishing context of either fact.
  assert.equal(answer, BIRTH);
  assert.doesNotMatch(answer, /Wellington/);
  assert.ok(mind.lastCost.counters.coInstanceNamings > 0);
  await mind.store.close();
});

test("155.2 without two instances that agree nothing names the relation", async () => {
  // None at all, and one alone: a single alignment agrees with nothing, so it
  // is no evidence of what the frame means.
  for (const instances of [[], INSTANCES.slice(0, 1)]) {
    const mind = await fixture(instances);
    const { answer, steps } = await ask(
      mind,
      "Where was the director of film Beat Girl born?",
    );
    assert.equal(
      steps.filter((s) => s.name === "askedByCoInstance").length,
      0,
      `${instances.length} instance(s)`,
    );
    assert.doesNotMatch(answer, /place of birth/);
    await mind.store.close();
  }
});

test("155.3 a frame the question shares only partly is no co-instance", async () => {
  const mind = await fixture();
  // `When was … born?` asks for a date; `Where was Peter Jackson born?` leaves
  // `Where` and `Peter Jackson` unwitnessed — two residues, not one filler.
  const { answer, steps } = await ask(
    mind,
    "When was the director of film Beat Girl born?",
  );
  assert.equal(steps.filter((s) => s.name === "askedByCoInstance").length, 0);
  assert.doesNotMatch(answer, /Nice/);
  await mind.store.close();
});

test("155.4 the same reading names the first hop when the entity is asked directly", async () => {
  const mind = await fixture();
  const { answer, steps } = await ask(
    mind,
    "Where was Edmond T. Gréville born?",
  );
  assert.ok(
    steps.some((s) =>
      s.name === "askedByCoInstance" && s.outputs.includes(BIRTH)
    ),
    "a co-instance names the fact",
  );
  assert.equal(answer, BIRTH);
  // The co-instances come from the consensus climb, so the pick depends on
  // whether it has run — and an untraced response, which memoises picks, must
  // read exactly what a traced one does.
  const untraced = await fixture();
  assert.equal(
    await untraced.respondText("Where was Edmond T. Gréville born?"),
    BIRTH,
  );
  await untraced.store.close();
  await mind.store.close();
});

test("155.5 another instance's own answer is never voiced", async () => {
  const mind = await fixture();
  // Nothing is stored about the song `God`: the climb's best point is
  // `Where was Nicki Minaj (Nicki Minaj Song) born?` — the question's frame
  // around another filler.
  const notes = [];
  const answer = await mind.respondText(
    "Where was the performer of song God (John Lennon Song) born?",
    (st) => {
      const name = st.mechanism.at(-1);
      if (name === "coInstanceAnchor" || name === "coInstanceRoot") {
        notes.push(name);
      }
    },
  );
  assert.ok(notes.includes("coInstanceAnchor"), "the anchor is refused");
  assert.doesNotMatch(
    answer,
    /Nicki|Port of Spain|Wellington|Raukokore|Hamilton/,
  );
  // …and where the question IS answerable, no instance rides along with it.
  const known = await mind.respondText(
    "Where was the director of film Beat Girl born?",
  );
  assert.equal(known, BIRTH);
  await mind.store.close();
});

test("155.6 a frame a product already said names no further step", async () => {
  const mind = await fixture();
  await mind.ingest(deposits([
    ["Edmond T. Gréville", "father", "Louis Gréville"],
    ["Louis Gréville", "father", "Henri Gréville"],
    ["Peter Jackson", "father", "Bill Jackson"],
    ["Taika Waititi", "father", "Taika Cohen"],
  ]));
  await mind.ingest([
    [
      "Who is the father of Peter Jackson?",
      "The father of Peter Jackson is Bill Jackson.",
    ],
    [
      "Who is the father of Taika Waititi?",
      "The father of Taika Waititi is Taika Cohen.",
    ],
  ]);
  // The second hop's relation is read off `Who is the father of …?`; the fact
  // it reaches says `father`, so the same frame cannot name the grandfather.
  const answer = await mind.respondText(
    "Who is the father of the director of film Beat Girl?",
  );
  assert.equal(answer, "The father of Edmond T. Gréville is Louis Gréville.");
  await mind.store.close();
});

test("155.7 a description in the slot is not another instance", async () => {
  const mind = await fixture();
  const fact =
    "Photosynthesis captures sunlight in chlorophyll to bind carbon dioxide and water into sugar.";
  await mind.ingest([
    [
      "Explain how photosynthesis converts sunlight into chemical energy.",
      fact,
    ],
    [
      "Explain how a rainbow forms after rain.",
      "Sunlight refracts in raindrops and splits into colours.",
    ],
  ]);
  // Same opening and close, different slot — but `converts sunlight into
  // chemical energy` is no stored context: the record is about the frame's
  // own subject, and answers.
  assert.equal(
    await mind.respondText("Explain how photosynthesis works."),
    fact,
  );
  await mind.store.close();
});

test("155.8 fusion does not fuse a co-instance as a further topic", async () => {
  // Two one-hop questions that happen to share an answer value: the climb
  // commits `Where was Peter Jackson born?` as a second point of attention
  // on the frame windows, and fusing it voiced his birthplace beside the
  // answer.
  const mind = await fixture([]);
  await mind.ingest(
    deposits([["Jane Campion", "place of birth", "Wellington"]]),
  );
  await mind.ingest([
    [
      "Where was Peter Jackson born?",
      "The place of birth of Peter Jackson is Wellington.",
    ],
    [
      "Where was Jane Campion born?",
      "The place of birth of Jane Campion is Wellington.",
    ],
  ]);
  const notes = [];
  const answer = await mind.respondText(
    "Where was the director of film Beat Girl born?",
    (st) => {
      if (st.mechanism.at(-1) === "coInstanceRoot") notes.push(st);
    },
  );
  assert.equal(answer, BIRTH);
  assert.ok(notes.length > 0, "the co-instance point is refused");
  await mind.store.close();
});

test("155.9 a comparison's dominant that is a co-instance is not compared", async () => {
  const mind = await fixture();
  const singers = [
    ["Adele", "Tottenham"],
    ["Bjork", "Reykjavik"],
    ["Prince", "Minneapolis"],
    ["Sade", "Ibadan"],
    ["Shakira", "Barranquilla"],
    ["Rihanna", "Saint Michael"],
  ];
  await mind.ingest(
    deposits(singers.map(([s, o]) => [s, "place of birth", o])),
  );
  await mind.ingest(
    singers.map(([s, o]) => [
      `Where was ${s} (${s} Song) born?`,
      `The place of birth of ${s} is ${o}.`,
    ]),
  );
  await mind.ingest(deposits([
    ["Imagine", "performer", "John Lennon"],
    ["John Lennon", "place of birth", "Liverpool"],
  ]));
  // Nothing is stored about the song `God`.  The comparison used to set
  // `Where was Shakira (Shakira Song) born?` against `John Lennon` and voice
  // Shakira's birthplace.
  const answer = await mind.respondText(
    "Where was the performer of song God (Lennon Song) born?",
  );
  for (const [s, o] of singers) {
    assert.ok(!answer.includes(o), `${s}'s birthplace voiced: "${answer}"`);
  }
  await mind.store.close();
});

test("155.10 a form that only says more than the question is no other instance", async () => {
  // `Hey, buddy. What's up?` around `buddy` against `hey, what's up?`: the
  // question holds nothing where the form holds `buddy`, so the form is not
  // the question's frame around another filler.
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([
    [
      "Hey, buddy. What's up?\nNot much, just enjoying the day.",
      "Yeah, it's a beautiful day out. Perfect for a walk.",
    ],
    [
      "Hey, Sam. What's up?\nNot much, just reading a book.",
      "Nice, which book are you reading?",
    ],
    ["buddy", "a close friend"],
    ["Sam", "a name"],
    ["What's the weather like?", "It is sunny today."],
  ]);
  await mind.buildCanonIndex();
  const a = await mind.respondText(
    "hey, what's up?\nnot much, just enjoying the day",
  );
  await store.close();
  assert.ok(a.includes("beautiful day"), a);
});
