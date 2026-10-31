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
//         question names one;
//   154.6 …and neither does recall's argument binding, when the fragment is the
//         query's sole argument;
//   154.7 a comparison needs the question to name two things: an analog
//         evidenced only by windows the dominant holds, or by scaffolding, is
//         not compared (it used to glue its bare question onto the answer);
//   154.8 an argument the question holds only under the response's
//         equivalence (`Man At Bath` for the stored `Man at Bath`, inside the
//         question) still binds: the climb proposes it, canonical containment
//         decides;
//   154.9 a fragment with ONE continuation answers another question too when
//         it never was a context itself: suffix inheritance gave `ther` the
//         fact of the context it first found reused (`Otto the Great
//         mother`), and the cover voiced it for `Anne of Kiev's grandmother`.
//         (A form learnt as a context keeps its one continuation: the
//         definition, bridge and ALU suites fail without that exception.)
//   154.12 …and is found among ALL the climb's points: a title cased otherwise
//         shares few windows with its stored form and ranks low.
//   154.21 a subject of several questions answers none it is not asked by
//         name: not through the cover, an anchor, a precedent or a piece of
//         its name; asked by name, or alone, it answers.
//   154.22 a question that asks a relation the form holds no fact of is not
//         answered by the form's one fact; asked its own relation, or alone,
//         the form answers.
//   154.23 a run is read where the corpus holds it: 154.13 answers at any
//         flush cadence.
//   154.24 a span's use is the company of the contexts holding the span: a
//         window shared with another word (`ied `) lends it nothing.

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
  // The grounding on the argument `Frederick II` (the cover's site, its edge
  // followed) crosses the father fact — the one whose own question `Frederick
  // II father` the asker's bytes witness — not the citizenship fact popularity
  // prefers; and it voices that fact alone, the question's ask left out.
  const lifted = steps.find((s) => s.name === "liftAnswer");
  assert.ok(lifted, "the cover must ground on the argument");
  assert.equal(lifted.outputs[0], FATHER);
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

test("154.6 a fragment the question names nothing of is not bound", async () => {
  const mind = await fixture();
  // Subjects ending in a parenthesis (2Wiki's own titles) let the fold intern
  // `director` as a node of its own, which inherits every director fact.
  await mind.ingest(deposits([
    ["Vasantha Sena (1967 film)", "director", "B. S. Ranga"],
    ["Guilty of Treason (film)", "director", "Felix E. Feist"],
  ]));
  const steps = [];
  const answer = await mind.respondText(
    "When was the director of film Jinpa born?",
    (st) => {
      if (
        st.mechanism.includes("recallByResonance") ||
        st.mechanism.at(-1) === "unaskedFragments"
      ) {
        steps.push({
          name: st.mechanism.at(-1),
          outputs: st.outputs.map((o) => o.text ?? ""),
        });
      }
    },
  );
  // `director` — the only constituent long enough to bind — leads to every
  // director fact, and the binding voiced the most-poured stranger's.
  assert.ok(
    steps.some((s) => s.name === "unaskedFragments"),
    "the binding is refused",
  );
  for (const s of steps.filter((s) => s.name === "recallByResonance")) {
    for (const o of s.outputs) assert.doesNotMatch(o, /Vasantha|Guilty/);
  }
  assert.equal(answer, "The director of Jinpa is Pema Tseden.");
  await mind.store.close();
});

test("154.7 a comparison needs the question to name two things", async () => {
  const mind = await fixture();
  const notes = [];
  const answer = await mind.respondText(
    "Tell me the father of Frederick II.",
    (st) => {
      if (st.mechanism.at(-1) === "validateAnalogy") notes.push(st.note ?? "");
    },
  );
  // `Peter III of Aragon father` is reached through ` father` (the dominant
  // `Frederick II father` holds it) and ` of ` (scaffolding): one structure
  // named, so nothing is compared.
  assert.ok(
    notes.some((n) => /names one structure, not two/.test(n)),
    "the comparison is refused",
  );
  assert.equal(answer, FATHER);
  await mind.store.close();
});

test("154.8 an argument held only under the response's equivalence still binds", async () => {
  const mind = await fixture();
  await mind.ingest(deposits([
    ["Man at Bath", "director", "Christophe Honoré"],
    ["At the End of the Tunnel", "director", "Rodrigo Grande"],
  ]));
  // The trainer builds the canonical-form index after training (progress.ts).
  await mind.buildCanonIndex();
  // 2Wiki title-cases its questions; the title sits inside the question,
  // where no fold boundary of the query lines up with the stored form.
  assert.equal(
    await mind.respondText(
      "Where does the director of film Man At Bath work at?",
    ),
    "The director of Man at Bath is Christophe Honoré.",
  );
  assert.equal(
    await mind.respondText(
      "Where did the director of film At The End Of The Tunnel work?",
    ),
    "The director of At the End of the Tunnel is Rodrigo Grande.",
  );
  await mind.store.close();
});

test("154.9 a fragment's one inherited continuation answers another question", async () => {
  const mind = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
  });
  // `ther` closes every `… mother` context; the gate that lets a reused piece
  // inherit admitted it only once two deposits had reused it, so it carries
  // the fact of the LAST context alone — one continuation, and no company
  // of its own, because it was never learnt as a context.
  await mind.ingest(deposits([
    ["Anne of Kiev", "mother", "Ingegerd"],
    ["Yaroslav the Wise", "mother", "Rogneda"],
    ["Charles the Bald", "mother", "Judith"],
    ["Otto the Great", "mother", "Matilda"],
  ]));
  for (
    const q of [
      "Who is Anne of Kiev's grandmother?",
      "Who is Anne of Kiev's stepmother?",
    ]
  ) {
    const answer = await mind.respondText(q);
    assert.doesNotMatch(answer, /Otto|Matilda/, `${q} → ${answer}`);
    assert.match(answer, /Anne of Kiev/, `${q} → ${answer}`);
  }
  await mind.store.close();
});

test("154.10 a paraphrase names the step: the use proposes, the bytes decide", async () => {
  // `pass away` and ` end` share no window, and no instance spells
  // `In which town did · pass away?`; but the contexts holding each led to
  // the same kind of fact, so the question names `Z end` by its use.  Where no
  // context holds a word of it, nothing does.
  const SYL = ["ba", "ko", "ri", "ten", "mar", "lo", "vi", "sun", "del", "ga"];
  const name = (n) =>
    `${SYL[n % 10][0].toUpperCase()}${SYL[n % 10].slice(1)}${
      SYL[(3 * n + 7) % 10]
    } ${SYL[(7 * n + 1) % 10][0].toUpperCase()}${
      SYL[(7 * n + 1) % 10].slice(1)
    }${SYL[Math.floor(n / 10) % 10]}`;
  const towns = ["Ashgrove", "Brindle", "Coldmere", "Dunmarsh", "Elmstead"];
  const origin = (x, t) => `${x} — origin: ${t}.`;
  const end = (x, t) => `${x} — end: ${t}.`;
  const ask = async (company) => {
    const items = [];
    for (let i = 1; i <= 40; i++) {
      const x = name(i), o = towns[i % 5], e = towns[(3 * i + 1) % 5];
      items.push([x, origin(x, o)], [x, end(x, e)]);
      items.push([`${x} origin`, origin(x, o)], [`${x} end`, end(x, e)]);
      items.push([`Where was ${x} born?`, origin(x, o)]);
      if (company) {
        items.push([`Where did ${x} die?`, end(x, e)]);
        items.push([`Did ${x} pass away in ${e}?`, end(x, e)]);
      } else items.push([`Where was ${x} buried?`, end(x, e)]);
    }
    const z = name(41);
    items.push([z, origin(z, "Fenmoor")], [z, end(z, "Gladwick")]);
    items.push([`${z} origin`, origin(z, "Fenmoor")]);
    items.push([`${z} end`, end(z, "Gladwick")]);
    const m = new Mind({ seed: 7 });
    await m.ingest(items);
    let named = 0;
    const answer = await m.respondText(
      `In which town did ${z} pass away?`,
      (st) => {
        if (
          st.mechanism.at(-1) === "askedByUse" &&
          st.inputs[0].text === z
        ) named++;
      },
    );
    return { answer, named };
  };
  const used = await ask(true);
  assert.match(used.answer, /end: Gladwick/);
  assert.ok(used.named > 0, "named by its use");
  assert.equal((await ask(false)).named, 0, "no word of it is used");
});

test("154.11 a comparison names each of its two things apart", async () => {
  // `Did W come into the world in X?` is reached only by ` come into the
  // world`, which every such question holds: it is a frame, not a thing the
  // question names, and a comparison set W's birthplace beside Z's other fact.
  let seed = 1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const C = "bcdfghjklmnprstvwz", V = "aeiouy";
  const word = (n) => {
    let w = "";
    for (let i = 0; i < n; i++) {
      w += i % 2
        ? V[Math.floor(rnd() * V.length)]
        : C[Math.floor(rnd() * C.length)];
    }
    return w[0].toUpperCase() + w.slice(1);
  };
  const names = Array.from(
    { length: 9 },
    () =>
      `${word(4 + Math.floor(rnd() * 3))} ${word(5 + Math.floor(rnd() * 3))}`,
  );
  const towns = ["Ashgrove", "Brindle", "Coldmere", "Dunmarsh", "Elmstead"];
  const origin = (x, t) => `${x} — origin: ${t}.`;
  const end = (x, t) => `${x} — end: ${t}.`;
  const items = [];
  for (let i = 1; i <= 8; i++) {
    const x = names[i - 1], o = towns[i % 5], e = towns[(3 * i + 1) % 5];
    items.push([x, origin(x, o)], [x, end(x, e)]);
    items.push([`${x} origin`, origin(x, o)], [`${x} end`, end(x, e)]);
    items.push([`Where was ${x} born?`, origin(x, o)]);
    items.push([`Where was ${x} buried?`, end(x, e)]);
    items.push([`Did ${x} pass away in ${e}?`, end(x, e)]);
    items.push([`Did ${x} come into the world in ${o}?`, origin(x, o)]);
  }
  const z = names[8];
  items.push([z, origin(z, "Fenmoor")], [z, end(z, "Gladwick")]);
  items.push([`${z} origin`, origin(z, "Fenmoor")]);
  items.push([`${z} end`, end(z, "Gladwick")]);
  const m = new Mind({ seed: 7 });
  await m.ingest(items);
  const answer = await m.respondText(
    `In which town did ${z} come into the world?`,
  );
  assert.equal(answer, origin(z, "Fenmoor"));
});

test("154.12 an argument held under the equivalence is read among all the climb's points", async () => {
  // Real 2Wiki deposits, minimised by ddmin (2,775 → 29) on what reading
  // every point changes: `House in the Sun` is the climb's 41st point of 145
  // in the full store, past the 16 the binding used to read, and the question
  // grounded nothing.
  const mind = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest([
    [
      "The House of Pulcini",
      "The director of The House of Pulcini is Mario Camerini.",
    ],
    ["Cast Up by the Sea", "The director of Cast Up by the Sea is John Gavin."],
    [
      "Henry King (director) date of death",
      "The date of death of Henry King (director) is June 29, 1982.",
    ],
    [
      "House in the Sun director",
      "The director of House in the Sun is Gaston Roudès.",
    ],
    ["House in the Sun", "The director of House in the Sun is Gaston Roudès."],
    ["Gaston Roudès", "The place of birth of Gaston Roudès is Béziers."],
    [
      "Where was the place of death of Donna Summer (Donna Summer Song)?",
      "The place of death of Donna Summer is Naples.",
    ],
    ["Jean Gimpel", "The father of Jean Gimpel is René Gimpel."],
    [
      "Where did René Gimpel die?",
      "The place of death of René Gimpel is Neuengamme.",
    ],
    [
      "Belle Toujours director",
      "The director of Belle Toujours is Manoel de Oliveira.",
    ],
    ["Belle Toujours", "The director of Belle Toujours is Manoel de Oliveira."],
    [
      "Manoel de Oliveira place of birth",
      "The place of birth of Manoel de Oliveira is Porto.",
    ],
    [
      "Manoel de Oliveira",
      "The place of birth of Manoel de Oliveira is Porto.",
    ],
    [
      "Where was Manoel de Oliveira born?",
      "The place of birth of Manoel de Oliveira is Porto.",
    ],
    [
      "Harvest: 3,000 Years director",
      "The director of Harvest: 3,000 Years is Haile Gerima.",
    ],
    [
      "Where did Michael Howard study at?",
      "The educated at of Michael Howard is Peterhouse.",
    ],
    [
      "Where was the place of death of Jim O'Connolly?",
      "The place of death of Jim O'Connolly is Hythe.",
    ],
    [
      "Teamster Boss: The Jackie Presser Story director",
      "The director of Teamster Boss: The Jackie Presser Story is Alastair Reid.",
    ],
    ["Sarah Burns father", "The father of Sarah Burns is Ken Burns."],
    ["Fire-Eater director", "The director of Fire-Eater is Pirjo Honkasalo."],
    ["Fire-Eater", "The director of Fire-Eater is Pirjo Honkasalo."],
    [
      "Pirjo Honkasalo spouse",
      "The spouse of Pirjo Honkasalo is Pirkko Saisio.",
    ],
    ["Pirjo Honkasalo", "The spouse of Pirjo Honkasalo is Pirkko Saisio."],
    [
      "Who is the spouse of Pirjo Honkasalo?",
      "The spouse of Pirjo Honkasalo is Pirkko Saisio.",
    ],
    ["Axiliad director", "The director of Axiliad is Witold Leszczyński."],
    ["Axiliad", "The director of Axiliad is Witold Leszczyński."],
    [
      "Witold Leszczyński place of birth",
      "The place of birth of Witold Leszczyński is Łódź.",
    ],
    ["Witold Leszczyński", "The place of birth of Witold Leszczyński is Łódź."],
    [
      "Where was Witold Leszczyński born?",
      "The place of birth of Witold Leszczyński is Łódź.",
    ],
  ]);
  await mind.buildCanonIndex();
  assert.equal(
    await mind.respondText(
      "Where was the director of film House In The Sun born?",
    ),
    "The place of birth of Gaston Roudès is Béziers.",
  );
  await mind.store.close();
});

test("154.13 a step the walk reaches is named by a use the corpus licenses", async () => {
  // `In which town did the father of Z pass away?`: `father` names the first
  // hop by its bytes; the second — `F end`, from the father reached — no
  // window of the question names, but `pass away` is used as ` end` is, and
  // the corpus licenses that use (`substitutionGrade`).  The walk once named
  // no step by use (the whole question only), and stopped at the father.
  // Where nothing uses `pass away` like ` end`, nothing names it.
  const SYL = ["ba", "ko", "ri", "ten", "mar", "lo", "vi", "sun", "del", "ga"];
  const name = (n) =>
    `${SYL[n % 10][0].toUpperCase()}${SYL[n % 10].slice(1)}${
      SYL[(3 * n + 7) % 10]
    } ${SYL[(7 * n + 1) % 10][0].toUpperCase()}${
      SYL[(7 * n + 1) % 10].slice(1)
    }${SYL[Math.floor(n / 10) % 10]}`;
  const towns = ["Ashgrove", "Brindle", "Coldmere", "Dunmarsh", "Elmstead"];
  const origin = (x, t) => `${x} — origin: ${t}.`;
  const end = (x, t) => `${x} — end: ${t}.`;
  const father = (x, f) => `${x} — father: ${f}.`;
  const ask = async (company) => {
    const items = [];
    for (let i = 1; i <= 40; i++) {
      const x = name(i), o = towns[i % 5], e = towns[(3 * i + 1) % 5];
      items.push([x, origin(x, o)], [x, end(x, e)]);
      items.push([`${x} origin`, origin(x, o)], [`${x} end`, end(x, e)]);
      items.push([`Where was ${x} born?`, origin(x, o)]);
      if (company) {
        items.push([`Where did ${x} die?`, end(x, e)]);
        items.push([`Did ${x} pass away in ${e}?`, end(x, e)]);
      } else items.push([`Where was ${x} buried?`, end(x, e)]);
    }
    const z = name(41), f = name(42);
    items.push([z, origin(z, "Fenmoor")], [z, end(z, "Gladwick")]);
    items.push([`${z} origin`, origin(z, "Fenmoor")]);
    items.push([`${z} end`, end(z, "Gladwick")]);
    items.push([z, father(z, f)], [`${z} father`, father(z, f)]);
    items.push([f, origin(f, "Harrowgate")], [f, end(f, "Ivybridge")]);
    items.push([`${f} origin`, origin(f, "Harrowgate")]);
    items.push([`${f} end`, end(f, "Ivybridge")]);
    const m = new Mind({ seed: 7 });
    await m.ingest(items);
    return await m.respondText(
      `In which town did the father of ${z} pass away?`,
    );
  };
  assert.match(await ask(true), /end: Ivybridge/);
  assert.doesNotMatch(await ask(false), /Ivybridge/);
});

test("154.15 a sole continuation is named by a licensed use", async () => {
  // 154.13's world with the father holding ONE fact.  One continuation has
  // nothing to be told apart from, so the use once named nothing there and the
  // walk stopped at the father; nothing to rank is no reason to refuse what the
  // corpus licenses.  Where nothing uses `pass away` like ` end`, it names
  // nothing still.  (The 2Wiki shape: `Where did the presenter of Tim Russert
  // (Talk Show) die?` reaches `Tim Russert`, whose one fact `Tim Russert place
  // of death` establishes — there the corpus never shows ` die` for ` place of
  // death`, so the step stays unnamed.)
  const SYL = ["ba", "ko", "ri", "ten", "mar", "lo", "vi", "sun", "del", "ga"];
  const name = (n) =>
    `${SYL[n % 10][0].toUpperCase()}${SYL[n % 10].slice(1)}${
      SYL[(3 * n + 7) % 10]
    } ${SYL[(7 * n + 1) % 10][0].toUpperCase()}${
      SYL[(7 * n + 1) % 10].slice(1)
    }${SYL[Math.floor(n / 10) % 10]}`;
  const towns = ["Ashgrove", "Brindle", "Coldmere", "Dunmarsh", "Elmstead"];
  const origin = (x, t) => `${x} — origin: ${t}.`;
  const end = (x, t) => `${x} — end: ${t}.`;
  const father = (x, f) => `${x} — father: ${f}.`;
  const ask = async (company) => {
    const items = [];
    for (let i = 1; i <= 40; i++) {
      const x = name(i), o = towns[i % 5], e = towns[(3 * i + 1) % 5];
      items.push([x, origin(x, o)], [x, end(x, e)]);
      items.push([`${x} origin`, origin(x, o)], [`${x} end`, end(x, e)]);
      items.push([`Where was ${x} born?`, origin(x, o)]);
      if (company) {
        items.push([`Where did ${x} die?`, end(x, e)]);
        items.push([`Did ${x} pass away in ${e}?`, end(x, e)]);
      } else items.push([`Where was ${x} buried?`, end(x, e)]);
    }
    const z = name(41), f = name(42);
    items.push([z, origin(z, "Fenmoor")], [z, end(z, "Gladwick")]);
    items.push([`${z} origin`, origin(z, "Fenmoor")]);
    items.push([`${z} end`, end(z, "Gladwick")]);
    items.push([z, father(z, f)], [`${z} father`, father(z, f)]);
    items.push([f, end(f, "Ivybridge")], [`${f} end`, end(f, "Ivybridge")]);
    const m = new Mind({ seed: 7 });
    await m.ingest(items);
    return await m.respondText(
      `In which town did the father of ${z} pass away?`,
    );
  };
  assert.match(await ask(true), /end: Ivybridge/);
  assert.doesNotMatch(await ask(false), /Ivybridge/);
});

test("154.14 company alone names no step: a use the corpus never shows", async () => {
  // `mother` and `father` keep the same company — each leads to `The … of X
  // is Y.` — but no context with one leads where a context with the other
  // does: the corpus never shows one standing for the other.  A use is itself
  // a reading of company, so company cannot license it; the walk must not
  // step from Z's father to HIS father for `Who is the mother of Z?`.
  const SYL = ["ba", "ko", "ri", "ten", "mar", "lo", "vi", "sun", "del", "ga"];
  const name = (n) =>
    `${SYL[n % 10][0].toUpperCase()}${SYL[n % 10].slice(1)}${
      SYL[(3 * n + 7) % 10]
    } ${SYL[(7 * n + 1) % 10][0].toUpperCase()}${
      SYL[(7 * n + 1) % 10].slice(1)
    }${SYL[Math.floor(n / 10) % 10]}`;
  const fact = (x, r, y) => `The ${r} of ${x} is ${y}.`;
  const items = [];
  for (let i = 1; i <= 30; i++) {
    const x = name(i), f = name(i + 100), mo = name(i + 200);
    items.push([`${x} father`, fact(x, "father", f)], [
      x,
      fact(x, "father", f),
    ]);
    items.push([`${x} mother`, fact(x, "mother", mo)], [
      x,
      fact(x, "mother", mo),
    ]);
    items.push([`Who is the father of ${x}?`, fact(x, "father", f)]);
    items.push([`Who is the mother of ${x}?`, fact(x, "mother", mo)]);
  }
  const z = name(41), f = name(42), g = name(43);
  items.push([`${z} father`, fact(z, "father", f)], [z, fact(z, "father", f)]);
  items.push([`${f} father`, fact(f, "father", g)], [f, fact(f, "father", g)]);
  items.push([`${f} spouse`, fact(f, "spouse", name(44))]);
  items.push([f, fact(f, "spouse", name(44))]);
  const m = new Mind({ seed: 7 });
  await m.ingest(items);
  const a = await m.respondText(`Who is the mother of ${z}?`);
  assert.ok(!a.includes(`of ${f} is ${g}`), `stepped to the grandfather: ${a}`);
});

test("154.16 a convergent pair licenses the span that stands where the stored one stands", async () => {
  // `Where was W born?` and `W place of birth` lead to one fact: the corpus
  // shows ` born?` standing where ` place of birth` stands — after W, as the
  // stored span is.  The same pair once licensed `Where was ` too, which
  // stands before W: one pair was every unshared span's evidence, and a use
  // could name a step by the question's frame.
  const { licensedSubstitution } = await import(
    "../dist/src/mind/traverse.js"
  );
  const people = [
    "Odalric Venn",
    "Mireille Sarkany",
    "Tobiah Quell",
    "Ysolde Harrowgate",
    "Casimir Blau",
  ];
  const towns = ["Ashgrove", "Brindle", "Coldmere", "Dunmarsh", "Elmstead"];
  const items = [];
  people.forEach((p, i) => {
    const fact = `The place of birth of ${p} is ${towns[i]}.`;
    items.push([`Where was ${p} born?`, fact], [`${p} place of birth`, fact]);
    items.push([p, fact]);
  });
  const mind = new Mind({ seed: 7 });
  await mind.ingest(items);
  await mind.respondText("Where was Odalric Venn born?");
  mind.beginResponse(undefined, null);
  const enc = (s) => new TextEncoder().encode(s);
  const licence = (a, b) => licensedSubstitution(mind, enc(a), enc(b));
  assert.equal(licence(" place of birth", " born?"), "shown");
  assert.notEqual(licence(" place of birth", "Where was "), "shown");
});

test("154.17 a relation no context states of an entity is read off the fact itself", async () => {
  // The director `Hesper Valcourt` is established by the bare name alone, so
  // no context spells `Hesper Valcourt place of birth`: the co-instance frame
  // `· place of birth` looks it up and finds nothing, and the second hop of
  // `Where was the director of film Lantern Tide born?` was taken unnamed,
  // carrying only ` of ` (the drift's own warrant).  The co-instance's FACT
  // states the relation too — `The place of birth of ` before the entity — and
  // the director's one continuation opens with it: the hop is named.
  const fact = (r, x, y) => `The ${r} of ${x} is ${y}.`;
  const people = [
    ["Odalric Venn", "Ashgrove"],
    ["Mireille Sarkany", "Brindle"],
    ["Tobiah Quell", "Coldmere"],
  ];
  const items = [];
  for (const [p, t] of people) {
    const f = fact("place of birth", p, t);
    items.push([`Where was ${p} born?`, f], [`${p} place of birth`, f], [p, f]);
  }
  const film = "Lantern Tide", dir = "Hesper Valcourt";
  const d = fact("director", film, dir);
  items.push([`${film} director`, d], [film, d]);
  items.push([dir, fact("place of birth", dir, "Dunmarsh")]);
  const mind = new Mind({ seed: 7 });
  await mind.ingest(items);
  const named = [];
  const got = await mind.respondText(
    `Where was the director of film ${film} born?`,
    (s) => {
      const k = s.mechanism.at(-1);
      if (k === "askedByCoInstance" || k === "askedContinuation") {
        named.push(s.inputs?.[0]?.text);
      }
    },
  );
  assert.equal(got, fact("place of birth", dir, "Dunmarsh"));
  assert.ok(named.includes(dir), `the hop from ${dir} was not named`);
});

test("154.18 a window the other structure holds names no thing beside it", async () => {
  // On a store too small for ` of ` to be scaffolding, `Who is the father of
  // Frederick II?` reached his citizenship fact too, and ` of ` (held by no
  // other context) named it apart: the comparison glued `Frederick II country`
  // onto the father fact.  ` of ` is the father fact's own, as it spells the
  // relation the question asks, so it names nothing beside it.
  const mind = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest([
    ["thank you", "merci"],
    ["good morning", "bonjour"],
    ["Hello there.", "Hi! How can I help you?"],
    ...deposits([
      ["Frederick II", "father", "Peter III of Aragon"],
      ["Frederick II", "country of citizenship", "Kingdom of Sicily"],
    ]),
  ]);
  const schemas = [];
  const answer = await mind.respondText(
    "Who is the father of Frederick II?",
    (st) => {
      if (st.mechanism.at(-1) === "castSchema") schemas.push(st.note ?? "");
    },
  );
  assert.equal(answer, "The father of Frederick II is Peter III of Aragon.");
  assert.ok(
    !schemas.some((n) => /comparison/.test(n)),
    "no comparison is cast",
  );
  await mind.store.close();
});

test("154.19 a minimal pair read past its bound refutes nothing", async () => {
  // `red circle` and its twin `crimson circle` share one continuation, but
  // each holds more continuations than the read bound, and the shared one
  // lies past both pages.  Absence inside a cut read is no evidence the corpus
  // holds none: the pair is unread, never refuted.  With nothing else the two
  // lead to, it is shown.
  const { licensedSubstitution } = await import(
    "../dist/src/mind/traverse.js"
  );
  const enc = (s) => new TextEncoder().encode(s);
  const licence = async (n) => {
    const mind = new Mind({ seed: 7 });
    const items = [
      ["red", "is a color"],
      ["crimson", "is a color"],
      ["blue", "is a color"],
      ["circle", "is a shape"],
      ["square", "is a shape"],
      ["red square", "answer beta"],
      ["blue circle", "answer gamma"],
      ["blue square", "answer delta"],
    ];
    for (let i = 0; i < n; i++) {
      items.push(
        ["red circle", `answer alpha ${i}`],
        ["crimson circle", `answer crimson ${i}`],
      );
    }
    items.push(["red circle", "answer shared"], [
      "crimson circle",
      "answer shared",
    ]);
    await mind.ingest(items);
    await mind.respondText("square then crimson");
    mind.beginResponse(undefined, null);
    return licensedSubstitution(mind, enc("red"), enc("crimson"));
  };
  assert.equal(await licence(0), "shown");
  assert.equal(await licence(6), "unread");
});

test("154.20 a learnt whole made only of scaffolding answers other questions", async () => {
  // The song `What`, learnt whole with one continuation, sits in a question
  // about Jerry Bock.  A learnt whole keeps its one continuation — but not a
  // form every window of which is scaffolding: held everywhere, it names
  // nothing, and its one continuation answers another question.
  const words = [
    "alpha",
    "bravo",
    "delta",
    "echo",
    "golf",
    "hotel",
    "india",
    "kilo",
    "lima",
    "oscar",
    "papa",
    "romeo",
    "tango",
    "victor",
    "zulu",
    "amber",
    "coral",
    "dune",
    "ember",
    "flint",
  ];
  const items = [
    ["What", "The performer of What is Melinda Marx."],
    ...deposits([["Jerry Bock", "country of citizenship", "American"]]),
  ];
  for (const a of words) {
    for (const b of words) {
      items.push([`${a} ${b}What ${b}${a}?`, `${b} ${a}.`]);
    }
  }
  const mind = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest(items);
  const fragments = [];
  const answer = await mind.respondText(
    "What country is Jerry Bock a citizen of?",
    (st) => {
      if (st.mechanism.at(-1) === "unaskedFragments") {
        for (const x of st.inputs ?? []) fragments.push(x.text);
      }
    },
  );
  assert.ok(fragments.includes("What"), "the song is a fragment here");
  assert.equal(answer, "The country of citizenship of Jerry Bock is American.");
  await mind.store.close();
});

test("154.21 a subject of several questions answers none it is not asked by name", async () => {
  // Each fact is also established by the subject alone, so `Ronald Neame`
  // leads to his death date and his birth date.  `born` witnesses neither
  // `… date of birth` nor `… date of death`: the pick was popularity, and the
  // death date — retold through the suffixes of every `… date of death` — won
  // (`When was Ronald Neame born?` → his death date, on the 100K replay 49
  // such misses in 300 natural questions).  `Robert`, another entity inside
  // `Robert Constantin`, stood in when the subject was refused.
  const mind = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest(deposits([
    ["Ronald Neame", "date of death", "16 June 2010"],
    ["Ronald Neame", "date of birth", "23 April 1911"],
    ["Robert", "father", "Alberico Gentili"],
    ["Robert Constantin", "date of death", "1 May 1950"],
    ["Robert Constantin", "date of birth", "2 June 1880"],
    ["Hal Ashby", "date of death", "27 December 1988"],
  ]));
  assert.equal(await mind.respondText("When was Ronald Neame born?"), "");
  assert.equal(await mind.respondText("When did Robert Constantin die?"), "");
  // Asked by name, the step is named; asked alone, the subject answers.
  assert.equal(
    await mind.respondText("What is the date of birth of Ronald Neame?"),
    "The date of birth of Ronald Neame is 23 April 1911.",
  );
  assert.notEqual(await mind.respondText("Ronald Neame"), "");
  await mind.store.close();
});

test("154.22 a relation the form holds no fact of is not answered by its one fact", async () => {
  // `Burt Reynolds` holds one fact, his citizenship, and the corpus writes
  // ` director` after other subjects (`The Paw director`).  Asked who directed
  // him, the one fact answered another question: the citizenship was voiced.
  // (Enough films for ` director` to recur, as it does in any real corpus.)
  const mind = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest(deposits([
    ["The Paw", "director", "Hans Steinhoff"],
    ["Sharky's Machine", "director", "Burt Reynolds"],
    ["Late Extra", "director", "Albert Parker"],
    ["Watan", "director", "Mehboob Khan"],
    ["Forbidden Love", "director", "Erik Lund"],
    ["Burt Reynolds", "country of citizenship", "American"],
  ]));
  const refused = [];
  const asked = await mind.respondText(
    "Who is the director of Burt Reynolds?",
    (st) => {
      if (st.mechanism.at(-1) === "unaskedFragments") {
        for (const x of st.inputs ?? []) refused.push(x.text);
      }
    },
  );
  assert.ok(refused.includes("Burt Reynolds"), "the subject is refused");
  assert.notEqual(
    asked,
    "The country of citizenship of Burt Reynolds is American.",
    "its one fact answers another question",
  );
  // Asked a relation it holds, or asked alone, the form answers.
  assert.equal(
    await mind.respondText("Who is the director of The Paw?"),
    "The director of The Paw is Hans Steinhoff.",
  );
  assert.equal(
    await mind.respondText("Burt Reynolds"),
    "The country of citizenship of Burt Reynolds is American.",
  );
  await mind.store.close();
});

test("154.23 a run is read where the corpus holds it, at any flush cadence", async () => {
  // 154.13's world.  The question's run ran on to `ss away?`, whose last
  // window no deposit holds — no company to read, no holder to license it —
  // so the use stood only where repeated containment rows (the flush cadence)
  // marked those windows hubs and cut the run to ` awa`: at the default
  // batchSize, never at 1.  A window is evidence where the corpus holds it.
  const SYL = ["ba", "ko", "ri", "ten", "mar", "lo", "vi", "sun", "del", "ga"];
  const name = (n) =>
    `${SYL[n % 10][0].toUpperCase()}${SYL[n % 10].slice(1)}${
      SYL[(3 * n + 7) % 10]
    } ${SYL[(7 * n + 1) % 10][0].toUpperCase()}${
      SYL[(7 * n + 1) % 10].slice(1)
    }${SYL[Math.floor(n / 10) % 10]}`;
  const towns = ["Ashgrove", "Brindle", "Coldmere", "Dunmarsh", "Elmstead"];
  const fact = (x, r, t) => `${x} — ${r}: ${t}.`;
  const items = [];
  for (let i = 1; i <= 40; i++) {
    const x = name(i), o = towns[i % 5], e = towns[(3 * i + 1) % 5];
    items.push([x, fact(x, "origin", o)], [x, fact(x, "end", e)]);
    items.push([`${x} origin`, fact(x, "origin", o)]);
    items.push([`${x} end`, fact(x, "end", e)]);
    items.push([`Where was ${x} born?`, fact(x, "origin", o)]);
    items.push([`Where did ${x} die?`, fact(x, "end", e)]);
    items.push([`Did ${x} pass away in ${e}?`, fact(x, "end", e)]);
  }
  const z = name(41), f = name(42);
  for (const [x, r, t] of [[z, "origin", "Fenmoor"], [z, "end", "Gladwick"]]) {
    items.push([x, fact(x, r, t)], [`${x} ${r}`, fact(x, r, t)]);
  }
  items.push([z, fact(z, "father", f)], [`${z} father`, fact(z, "father", f)]);
  for (const [r, t] of [["origin", "Harrowgate"], ["end", "Ivybridge"]]) {
    items.push([f, fact(f, r, t)], [`${f} ${r}`, fact(f, r, t)]);
  }
  const answer = async (batchSize) => {
    const store = new SQliteStore({ path: ":memory:", batchSize });
    const m = new Mind({ seed: 7, store });
    await m.ingest(items);
    const a = await m.respondText(
      `In which town did the father of ${z} pass away?`,
    );
    await store.close();
    return a;
  };
  for (const batchSize of [1, 256]) {
    assert.match(
      await answer(batchSize),
      /end: Ivybridge/,
      `batch ${batchSize}`,
    );
  }
});

test("154.24 a span's use is the company of what holds the span, not of its windows", async () => {
  // `married ` and ` died ` share the window `ied `.  Read by its windows'
  // holders, the use of `married ` took every `… died …` context's company
  // (cosine 0.58 with ` died `): on 2Wiki, `Who was Alain Robbe-Grillet
  // married to?` named his date of death.  Read by the contexts holding the
  // span, the two are apart and `married ` keeps its own company.
  const { cosine, significanceBar } = await import("../dist/src/index.js");
  const { spanHalo } = await import("../dist/src/mind/traverse.js");
  const towns = ["Ashgrove", "Brindle", "Coldmere", "Dunmarsh", "Elmstead"];
  const items = [];
  for (let i = 0; i < 30; i++) {
    items.push([`Kel${i} died in ${towns[i % 5]}`, `burial ${i}`]);
    items.push([`Ana${i} married Bo${i}`, `wedding ${i}`]);
  }
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(items);
  const enc = (s) => new TextEncoder().encode(s);
  const married = spanHalo(m, enc("Who was Zed married to?"), 12, 20);
  const died = spanHalo(m, enc("Zed died in Ashgrove"), 3, 9);
  const again = spanHalo(m, enc("Ana3 married Bo3"), 4, 12);
  const bar = significanceBar(m.store.D);
  assert.ok(
    cosine(married, died) < bar,
    `married ~ died ${cosine(married, died)}`,
  );
  assert.ok(cosine(married, again) >= bar, "married keeps its own company");
  await m.store.close();
});
