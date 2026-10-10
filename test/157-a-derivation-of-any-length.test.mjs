// 157-a-derivation-of-any-length.test.mjs — a derivation read off other
// instances is a PATH of whatever length the corpus shows, replayed in order
// from what the question's slot names.
//
// THE READING (traverse.ts, `pathSteps`, `replayOf`, `slotSteps`,
// `describedSteps`; evidence.md).  An instance `Who is the paternal
// great-grandmother of Z?` answered `The mother of Y2 is W.` is reached from
// `Z` through facts that each hold the entity the next one stands on: `Z
// father` → `The father of Z is Y1.`, `Y1 father` → `The father of Y1 is
// Y2.`, `Y2 mother` → the answer.  The path is searched breadth first under
// the exact tier's read allowance, so its length comes from the corpus; the
// relation is the sequence of frames, kept only where two instances spell it
// alike, and replayed from the question's own entity, a step at a time, each
// only where the replay of the steps before it stands.  What a slot says of
// its entity — a description other forms hold, or one fact it witnesses — is
// applied first: stripped from an instance's derivation, prefixed to the
// question's.
//
// MEASURED on a constructed genealogical world (version 3: 2,276 people, 66
// instances, 172 questions): 59 → 137 correct; depth 3–5 from 0 to 42 of 42; a
// frame composed with a description no instance asks, 0 → 7 of 12; wrong
// first hops 52 → 12.  With the instances' answers scrambled, so that no path
// joins filler and answer, the reading transfers nothing.
//
// Pinned:
//   157.1 three steps: a paternal great-grandmother is read off three instances;
//   157.2 four steps across kinds: the country the paternal grandmother was
//         born in;
//   157.3 each frame by its own sequence, in order: with both families of
//         instances present, each question gets its own ancestor;
//   157.4 the reading that explains more of the question names the step: three
//         instances of `grandma on the father's side` outrank the `father` the
//         question also spells;
//   157.5 the derivation starts at what the slot names — the paternal
//         grandmother of `Z's father` is his, not Z's;
//   157.6 …and a remainder that names nothing only qualifies the entity;
//   157.7 a fact holds its entity whole — the walk does not step from a
//         shorter entity inside it;
//   157.8 traced and untraced responses agree (a pick made before the climb is
//         provisional);
//   157.10 the frame that shares more of the question names the step: three
//         instances of `Who is Y's dad?` (9 bytes of the question) do not
//         outvote the grandparent derivation (36 bytes) at the father;
//   157.11 a description in an instance's slot is read off the forms that hold
//         it: `Where was Y's dad born?` spells what `Where was Y born?` does;
//   157.12 a description in the question composes with the frame read off
//         another family of instances;
//   157.13 a description nothing reads determines no start: the frame is not
//         applied to the slot's own entity.
// Control (no mutation of the reading short of inventing a path breaks it):
//   157.9 an instance answered with a fact its filler does not reach carries no
//         derivation: scrambled answers transfer nothing.

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

const NAMES = [
  "Aldric Fenwick",
  "Beatrix Holloway",
  "Cedric Ashcombe",
  "Delphine Marlowe",
  "Edmund Thornbury",
  "Felicity Crane",
  "Godfrey Wetherby",
  "Harriet Locksley",
  "Ignatius Pemberton",
  "Juliana Ravensworth",
  "Konrad Mayhew",
  "Lavinia Stroud",
  "Mortimer Vance",
  "Nerissa Blackwood",
  "Oswin Kettering",
  "Prudence Hale",
  "Quentin Fairfax",
  "Rosalind Ashby",
  "Sebastian Wolcott",
  "Theodora Lindqvist",
  "Ulric Penhallow",
  "Vivienne Carrow",
  "Wendell Ormsby",
  "Ximena Duarte",
  "Yorick Selwyn",
  "Zenobia Harcourt",
  "Ambrose Tilney",
  "Bronwen Gaskell",
  "Crispin Haversham",
  "Drusilla Wendover",
  "Everard Quill",
  "Fenella Royce",
  "Gideon Marchbanks",
  "Honoria Treadwell",
  "Isidore Langley",
  "Jessamine Pike",
  "Lucius Brandon",
  "Marigold Easton",
  "Nathaniel Corbyn",
  "Octavia Rennick",
  "Percival Danvers",
  "Rowena Ellery",
  "Silas Whitcombe",
  "Tabitha Morland",
  "Valentine Ashford",
  "Winifred Talbot",
  "Barnaby Ingram",
  "Clementine Voss",
  "Desmond Purcell",
  "Eleanor Fitzroy",
  "Florian Gage",
  "Georgiana Bexley",
  "Horatio Linwood",
  "Imogen Carrick",
  "Jasper Whitlock",
  "Leopold Hartigan",
  "Millicent Dorset",
  "Nigel Ainsworth",
  "Ophelia Sandoval",
  "Peregrine Mott",
  "Reginald Coyle",
  "Seraphina Vale",
  "Tobias Merriweather",
  "Ursula Kinsey",
  "Victor Hollis",
  "Wilhelmina Strand",
  "Alistair Nayland",
  "Cordelia Brisco",
  "Damaris Lyle",
  "Evander Groves",
  "Fabian Coldwell",
  "Gwendolyn Parry",
  "Hamish Bellweather",
  "Isolde Varga",
  "Jerome Stanhope",
  "Katarina Holm",
  "Lysander Croft",
  "Maximilian Dorn",
  "Philippa Garrow",
  "Rupert Ellingham",
  "Sabine Corliss",
  "Thaddeus Wren",
  "Lorcan Abernethy",
  "Mirabel Oakes",
  "Cosimo Leventis",
  "Henrietta Brook",
  "Ivo Castellan",
  "Juno Ridley",
  "Kasimir Ostrow",
  "Leonie Fairburn",
  "Magnus Thorne",
  "Nadia Wolfram",
  "Orlando Quint",
  "Pandora Kell",
  "Raffaele Monti",
  "Signe Halvorsen",
];
const PLACES = [
  "Ravenmoor",
  "Eastwick Vale",
  "Glenhollow",
  "Marrowby",
  "Thistlecombe",
  "Oakhurst Bay",
];
const COUNTRY = {
  Ravenmoor: "Norway",
  "Eastwick Vale": "Portugal",
  Glenhollow: "Hungary",
  Marrowby: "Chile",
  Thistlecombe: "Kenya",
  "Oakhurst Bay": "Peru",
};

/** A deterministic world: `subject(depth)` gives a person with every ancestor
 *  `depth` generations up, each born somewhere. */
function world() {
  let n = 0, b = 0;
  const people = new Map();
  const triples = [];
  const born = (x) => {
    const p = PLACES[b++ % PLACES.length];
    triples.push([x, "place of birth", p]);
    return p;
  };
  const subject = (depth, name = NAMES[n++]) => {
    const p = { name, born: born(name) };
    people.set(name, p);
    if (depth > 0) {
      p.father = subject(depth - 1).name;
      p.mother = subject(depth - 1).name;
      triples.push([name, "father", p.father], [name, "mother", p.mother]);
    }
    return p;
  };
  const up = (x, path) =>
    path.reduce(
      (at, r) =>
        r === "country"
          ? COUNTRY[at]
          : r === "born"
          ? people.get(at).born
          : people.get(at)[r],
      x,
    );
  const places = () =>
    Object.entries(COUNTRY).map(([p, c]) => [p, "country", c]);
  return { subject, up, triples, places, people };
}

const lastFact = (w, x, path) => {
  const before = w.up(x, path.slice(0, -1));
  const r = path.at(-1);
  const rel = { born: "place of birth", country: "country" }[r] ?? r;
  return `The ${rel} of ${before} is ${w.up(x, path)}.`;
};

async function ask(build, questions, trace = false) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest(build);
  await mind.buildCanonIndex();
  const out = [];
  for (const q of questions) {
    out.push(
      trace ? await mind.respondText(q, () => {}) : await mind.respondText(q),
    );
  }
  await store.close();
  return out;
}

/** Instances of `tpl` (`{X}` the subject) about three other subjects. */
function instances(w, tpl, path, depth, k = 3, answer = lastFact) {
  const items = [];
  for (let i = 0; i < k; i++) {
    const s = w.subject(depth).name;
    items.push([tpl.replace("{X}", s), answer(w, s, path)]);
  }
  return items;
}

const GGM = ["father", "father", "mother"];
const GGF_M = ["mother", "mother", "father"];

test("157.1 three steps: a derivation of three facts is read off three instances", async () => {
  const w = world();
  const tpl = "Who is the paternal great-grandmother of {X}?";
  const inst = instances(w, tpl, GGM, 3);
  const z = w.subject(3).name;
  const [a] = await ask(
    [...deposits(w.triples), ...inst],
    [tpl.replace("{X}", z)],
  );
  assert.match(a, new RegExp(w.up(z, GGM)), `answered "${a}"`);
});

test("157.2 four steps across kinds: the country a paternal grandmother was born in", async () => {
  const w = world();
  const path = ["father", "mother", "born", "country"];
  const tpl = "In which country was the paternal grandmother of {X} born?";
  const inst = instances(w, tpl, path, 2);
  const z = w.subject(2).name;
  const [a] = await ask(
    [...deposits([...w.triples, ...w.places()]), ...inst],
    [tpl.replace("{X}", z)],
  );
  assert.match(a, new RegExp(`is ${w.up(z, path)}\\.`), `answered "${a}"`);
});

test("157.3 each frame by its own sequence, in order", async () => {
  const w = world();
  const t1 = "Who is the paternal great-grandmother of {X}?";
  const t2 = "Who is the maternal great-grandfather of {X}?";
  // Two instances each — the agreement a derivation needs.
  const inst = [
    ...instances(w, t1, GGM, 3, 2),
    ...instances(w, t2, GGF_M, 3, 2),
  ];
  const z = w.subject(3).name;
  const [a, b] = await ask(
    [...deposits(w.triples), ...inst],
    [t1.replace("{X}", z), t2.replace("{X}", z)],
  );
  assert.match(a, new RegExp(w.up(z, GGM)), `answered "${a}"`);
  assert.match(b, new RegExp(w.up(z, GGF_M)), `answered "${b}"`);
  // No other great-grandparent: a step out of order lands on one of them.
  const others = [
    ["father", "father", "father"],
    ["father", "mother", "mother"],
    ["mother", "father", "father"],
    ["mother", "mother", "mother"],
  ].map((p) => w.up(z, p));
  for (const o of others) {
    assert.ok(!a.includes(o) && !b.includes(o), `${o} in "${a}" / "${b}"`);
  }
});

test("157.4 the reading that explains more of the question names the step", async () => {
  // `father's side` spells `father`, which witnesses `Y father` at the
  // father Y; three instances of the whole frame spell `· mother` there.
  const w = world();
  const tpl = "Who is {X}'s grandma on the father's side?";
  const inst = instances(w, tpl, ["father", "mother"], 2);
  const z = w.subject(2).name;
  const [a] = await ask(
    [...deposits(w.triples), ...inst],
    [tpl.replace("{X}", z)],
  );
  assert.match(a, new RegExp(w.up(z, ["father", "mother"])), `answered "${a}"`);
});

test("157.5 the derivation starts at what the slot names", async () => {
  const w = world();
  const tpl = "Who is the paternal grandmother of {X}?";
  const inst = instances(w, tpl, ["father", "mother"], 3);
  const z = w.subject(3).name;
  const [a] = await ask(
    [...deposits(w.triples), ...inst],
    [`Who is the paternal grandmother of ${z}'s father?`],
  );
  const theirs = w.up(z, ["father", "father", "mother"]);
  const mine = w.up(z, ["father", "mother"]);
  assert.match(a, new RegExp(theirs), `answered "${a}"`);
  assert.doesNotMatch(a, new RegExp(`is ${mine}\\.`), "not Z's own");
});

test("157.6 a remainder that names nothing only qualifies the entity", async () => {
  const w = world();
  const tpl = "Who is the paternal grandmother of {X}?";
  const inst = instances(w, tpl, ["father", "mother"], 3);
  const z = w.subject(2).name;
  const [a] = await ask(
    [...deposits(w.triples), ...inst],
    [`Who is the paternal grandmother of ${z} (1612–1671)?`],
  );
  assert.match(a, new RegExp(w.up(z, ["father", "mother"])), `answered "${a}"`);
});

test("157.7 a fact holds its entity whole", async () => {
  // Z's father is spelled `King Lucius Brandon the Elder of Marrowby`, and
  // `Lucius Brandon` is a person of his own, with a mother of his own.
  const w = world();
  const tpl = "Who is the paternal grandmother of {X}?";
  const inst = instances(w, tpl, ["father", "mother"], 3);
  const z = "Ottoline Varnsworth-Delacourt";
  const f = "Lucius Brandon the Elder of Marrowby";
  const extra = [
    [z, "father", `King ${f}`],
    [`King ${f}`, "mother", "Agatha Pennyworth"],
    ["Lucius Brandon", "mother", "Cressida Moorcroft"],
  ];
  const [a] = await ask(
    [...deposits([...w.triples, ...extra]), ...inst],
    [`Who is the paternal grandmother of ${z}?`],
  );
  assert.match(a, /Agatha Pennyworth/, `answered "${a}"`);
  assert.doesNotMatch(a, /Cressida/, "no step from the shorter name inside");
});

test("157.8 traced and untraced responses agree", async () => {
  const w = world();
  const path = ["father", "mother", "born", "country"];
  const tpl = "In which country was the paternal grandmother of {X} born?";
  const inst = instances(w, tpl, path, 2);
  const z = w.subject(2).name;
  const items = [...deposits([...w.triples, ...w.places()]), ...inst];
  const [plain] = await ask(items, [tpl.replace("{X}", z)]);
  const [traced] = await ask(items, [tpl.replace("{X}", z)], true);
  assert.equal(plain, traced);
});

test("157.9 scrambled answers carry no derivation", async () => {
  const w = world();
  const tpl = "Who is the paternal great-grandmother of {X}?";
  const subjects = [0, 1, 2].map(() => w.subject(3).name);
  // Each instance answered with the NEXT one's fact: no path from its filler.
  const inst = subjects.map((s, i) => [
    tpl.replace("{X}", s),
    lastFact(w, subjects[(i + 1) % 3], GGM),
  ]);
  const z = w.subject(3).name;
  const [a] = await ask(
    [...deposits(w.triples), ...inst],
    [tpl.replace("{X}", z)],
  );
  assert.doesNotMatch(a, new RegExp(w.up(z, GGM)), `answered "${a}"`);
});

test("157.10 the frame that shares more of the question names the step", async () => {
  // `Who is Y's dad?` shares only `Who is ` and `?` with a grandparent
  // question, yet each of its instances spells `· father` — at the father as
  // much as anywhere, with as many instances as the whole frame's derivation
  // has for its own second step.
  const w = world();
  const fams = [
    ["Who is the paternal grandmother of {X}?", ["father", "mother"]],
    ["Who is the paternal grandfather of {X}?", ["father", "father"]],
    ["Who is the maternal grandfather of {X}?", ["mother", "father"]],
    ["Who is the maternal grandmother of {X}?", ["mother", "mother"]],
  ];
  const inst = [
    ...fams.flatMap(([tpl, path]) => instances(w, tpl, path, 2, 2)),
    ...instances(w, "Who is {X}'s dad?", ["father"], 1),
  ];
  const z = w.subject(2).name;
  const answers = await ask(
    [...deposits(w.triples), ...inst],
    fams.map(([tpl]) => tpl.replace("{X}", z)),
  );
  fams.forEach(([, path], i) => {
    const gold = w.up(z, path);
    assert.match(
      answers[i],
      new RegExp(`is ${gold}\\.`),
      `answered "${answers[i]}"`,
    );
  });
});

test("157.11 a description in an instance's slot is read off the forms that hold it", async () => {
  // `Where was Y's dad born?` applies `· father` to Y before its frame does:
  // the forms holding `'s dad` (`Who is Z's dad?`) read it, so the frame
  // `Where was · born?` keeps only `· place of birth` — X's own birthplace.
  const w = world();
  const inst = [
    ...instances(w, "Where was {X} born?", ["born"], 0),
    // More `dad` instances than plain ones: unread, `Y's dad` would take the
    // walk to the father.
    ...instances(w, "Where was {X}'s dad born?", ["father", "born"], 1, 4),
    ...instances(w, "Who is {X}'s dad?", ["father"], 1),
  ];
  const z = w.subject(1).name;
  const [a] = await ask(
    [...deposits(w.triples), ...inst],
    [`Where was ${z} born?`],
  );
  assert.match(
    a,
    new RegExp(`of ${z} is ${w.up(z, ["born"])}\\.`),
    `answered "${a}"`,
  );
  // …and nothing of the father's: the `dad` instances do not move the frame.
  assert.doesNotMatch(a, new RegExp(w.up(z, ["father"])), `answered "${a}"`);
});

test("157.12 a description in the question composes with the frame", async () => {
  // No instance asks where a grandmother was born: the frame `Where was ·
  // born?` is read off one family, the description `the paternal
  // grandmother of ·` off another, and the question is the one, then the
  // other, from Z.
  const w = world();
  const inst = [
    ...instances(w, "Where was {X} born?", ["born"], 0),
    ...instances(w, "Who is the paternal grandmother of {X}?", [
      "father",
      "mother",
    ], 2),
  ];
  const z = w.subject(2).name;
  const [a] = await ask(
    [...deposits(w.triples), ...inst],
    [`Where was the paternal grandmother of ${z} born?`],
  );
  const g = w.up(z, ["father", "mother"]);
  assert.match(
    a,
    new RegExp(`of ${g} is ${w.up(z, ["father", "mother", "born"])}\\.`),
    `answered "${a}"`,
  );
});

test("157.13 a description nothing reads determines no start", async () => {
  // No form holds `the maternal great-grandmother of ·`: the entity found at
  // the slot's close leaves the forms parting on what nobody read, and the
  // frame is not applied to Z itself.
  const w = world();
  const inst = instances(w, "Where was {X} born?", ["born"], 0);
  const z = w.subject(3).name;
  const [a] = await ask(
    [...deposits(w.triples), ...inst],
    [`Where was the maternal great-grandmother of ${z} born?`],
  );
  assert.doesNotMatch(
    a,
    new RegExp(`place of birth of ${z} is`),
    `answered "${a}"`,
  );
});
