// 159-two-things-meet.test.mjs — a question about TWO things whose instances
// agree on the derivation each thing takes to their answer is met where those
// derivations, replayed from the question's own things, end on one answer.
//
// THE READING (traverse.ts, `convergenceOf`, `instanceConvergence`,
// `convergenceMeets`; confluence.ts).  `Who is the shared grandfather of A and
// B?` answered `The answer is G.` is read as the question's frame around two
// things, parted where the two forms share a run (` and `), each a thing
// learnt whole.  Each thing's derivation is the shortest path of facts to one
// holding the answer (`· father → · father` from A, `· mother → · father` from
// B), and the bytes around the entity it stood on and the answer are that
// fact's answer frame.  Two instances spelling the same pair agree.  At the
// question, each derivation is replayed from its own thing, each last fact's
// answer read off its frame, and the two compared byte for byte.
//
// MEASURED on the constructed world gen6: with instances answered `The answer
// is E.`, every same-phrasing two-thing question (mother∧spouse, shared
// birthplace, shared grandfather) answered by the meet, the grandfather 0 → 3
// of 3, in both deposit orders; with the answers scrambled nothing changes; the
// 2Wiki fixtures change no answer and pay at most 0.5% more branch lookups.
//
// Pinned:
//   159.1 a two-step convergence meets at the shared grandfather, in either
//         deposit order;
//   159.2 the answer is met whole: two grandfathers sharing a first name do not
//         meet;
//   159.3 instances whose names share letters at the parting still agree;
//   159.4 an empty meet refutes nothing: a shared grandfather by another
//         route, or a meeting fact past the read bound, does not silence the
//         response;
//   159.5 instances answered with a fact holding two things teach the part of
//         it both sides reach, in either deposit order;
//   159.6 a frame word is not a thing: each side's thing is LEARNT WHOLE (on
//         the 2Wiki fixtures, without it, one-thing instances parted on `t's `
//         were read for about 0.5% more branch lookups and no answer);
//   159.7 the meet explains the frame the instances share, the parting and
//         the two things, and no more.
// Control: with the instances' answers scrambled, nothing meets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const FIRST = [
  "Aldric",
  "Beatrix",
  "Cedric",
  "Delphine",
  "Edmund",
  "Felicity",
  "Godfrey",
  "Harriet",
  "Ignatius",
  "Juliana",
  "Konrad",
  "Lavinia",
  "Mortimer",
];
const LAST = [
  "Fenwick",
  "Holloway",
  "Ashcombe",
  "Marlowe",
  "Thornbury",
  "Wetherby",
  "Locksley",
  "Pemberton",
  "Ravensworth",
];

function names() {
  let k = 0;
  return () => {
    const n = `${FIRST[k % FIRST.length]} ${
      LAST[Math.floor(k / FIRST.length) % LAST.length]
    }`;
    k += 5;
    return n;
  };
}

const fact = (s, r, o) => `The ${r} of ${s} is ${o}.`;
const deposit = (items, s, r, o) =>
  items.push([`${s} ${r}`, fact(s, r, o)], [s, fact(s, r, o)]);

/** Cousins x and y: x's father and y's mother share a father, `g` unless
 *  `apart` names the second grandfather. */
function cousins(items, nm, apart) {
  const x = nm(), y = nm(), fx = nm(), my = nm(), g = nm();
  const g2 = apart ? apart(g) : g;
  deposit(items, x, "father", fx);
  deposit(items, y, "mother", my);
  deposit(items, fx, "father", g);
  deposit(items, my, "father", g2);
  deposit(items, fx, "mother", nm());
  deposit(items, my, "mother", nm());
  return { x, y, fx, my, g, g2 };
}

const ask = (c) => `Who is the shared grandfather of ${c.x} and ${c.y}?`;

async function respond(items, q, reverse = false) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(reverse ? [...items].reverse() : items);
  await mind.buildCanonIndex();
  const steps = [];
  const a = await mind.respondText(q, (s) => steps.push(s));
  const counters = { ...(mind.lastCost?.counters ?? {}) };
  await store.close();
  return {
    a,
    steps,
    counters,
    met: steps.some((s) => s.mechanism.at(-1) === "convergeDerivations"),
  };
}

/** Three instances answered with their grandfather, and the question's own
 *  cousins. */
function world(answer = (c) => c.g, apart, mutate, apartAll = false) {
  const nm = names();
  const items = [];
  const inst = [0, 1, 2].map(() => cousins(items, nm));
  inst.forEach((c, i) =>
    items.push([ask(c), `The answer is ${answer(c, i, inst)}.`])
  );
  const c = cousins(items, nm, apartAll ? () => nm() : apart);
  mutate?.(items, c, nm);
  return { items, c };
}

test("159.1 a two-step convergence meets at the shared grandfather", async () => {
  const { items, c } = world();
  for (const reverse of [false, true]) {
    const { a, met } = await respond(items, ask(c), reverse);
    assert.ok(met, `${reverse ? "reversed: " : ""}no meet`);
    assert.ok(
      a.includes(c.g) && !a.includes(c.fx) && !a.includes(c.my),
      `${reverse ? "reversed: " : ""}${a}`,
    );
  }
});

test("159.2 the answer is met whole: a shared first name is no meet", async () => {
  // The question's cousins have two grandfathers whose names share their
  // first word: the facts' answers differ, and nothing meets.
  const { items, c } = world(undefined, (g) => `${g.split(" ")[0]} Quill`);
  const { met, a } = await respond(items, ask(c));
  assert.ok(!met, `two grandfathers met: ${a}`);
});

test("159.3 instances whose names share letters at the parting still agree", async () => {
  // Against the question's `Aldric Holloway and …`, one instance parts on
  // `y and `, one on `lloway and `, one on ` and `: three partings, one
  // pair of things the instances are about.
  const nm = names();
  const items = [];
  const family = (x) => {
    const c = cousins(items, nm);
    const fx = c.fx;
    // Rename the cousin x: deposit x's own father fact under the given name.
    deposit(items, x, "father", fx);
    return { ...c, x };
  };
  const inst = ["Beatrix Ashby", "Cedric Galloway", "Delphine Marlowe"].map(
    family,
  );
  inst.forEach((c) => items.push([ask(c), `The answer is ${c.g}.`]));
  const c = family("Aldric Holloway");
  const { a, met } = await respond(items, ask(c));
  assert.ok(met && a.includes(c.g), a);
});

test("159.4 an empty meet refutes nothing", async () => {
  // A meet the replay does not find is no proof that the two things share no
  // answer: the shared grandfather may be reached by a route the instances
  // did not show, or the fact that meets may lie past the read bound.
  // Neither silences the response.
  const routed = world(undefined, undefined, (items, c, nm) => {
    // x's MOTHER's father is y's FATHER's father.
    const mx = nm(), fy = nm(), g = nm();
    deposit(items, c.x, "mother", mx);
    deposit(items, c.y, "father", fy);
    deposit(items, mx, "father", g);
    deposit(items, fy, "father", g);
  }, true);
  const far = world(undefined, undefined, (items, c) => {
    // Twenty-eight other fathers of y's mother are read before c.g.
    const K = ["Ravenmoor", "Glenhollow", "Marrowby", "Thistlecombe"];
    items.splice(
      items.findIndex(([ctx]) => ctx === `${c.my} father`),
      2,
    );
    for (let i = 0; i < 60; i++) {
      deposit(items, c.my, "father", `${K[i % 4]} Person${i}`);
    }
    deposit(items, c.my, "father", c.g);
  });
  for (
    const [label, w] of [["another route", routed], [
      "past the read bound",
      far,
    ]]
  ) {
    const { a, steps } = await respond(w.items, ask(w.c));
    assert.ok(
      !steps.some((s) => s.mechanism.at(-1) === "convergenceRefutes"),
      `${label}: an empty meet was taken as a refutation`,
    );
    assert.notEqual(a.trim(), "", `${label}: the response was silenced`);
  }
});

test("159.5 instances answered with a fact: the answer is the part both sides reach", async () => {
  // `The father of B's mother is G.` holds the mother and G: no fact reached
  // from A holds all of it, and the answer is what a fact from each side
  // spells — ` is G.`.
  const nm = names();
  const fresh = [];
  const inst = [0, 1, 2].map(() => cousins(fresh, nm));
  inst.forEach((i) => fresh.push([ask(i), fact(i.my, "father", i.g)]));
  const q = cousins(fresh, nm);
  for (const reverse of [false, true]) {
    const { a, met } = await respond(fresh, ask(q), reverse);
    assert.ok(met && a.includes(q.g) && !a.includes(q.my), a);
  }
});

test("159.6 a frame word is not a thing: one thing is not read as two", async () => {
  // `Who is Edmund West's child-in-law?` parts against `Who is Godfrey
  // Hart's father-in-law?` on `t's `: ` child`, the tail of every `… child`
  // context, holds continuations by inheritance and no company of its own,
  // and the slot holds one thing.
  const nm = names();
  const items = [];
  for (let i = 0; i < 30; i++) {
    const p = nm(), c = nm();
    deposit(items, p, "child", c);
    deposit(items, c, "spouse", nm());
  }
  for (
    const [x, r, o] of [
      ["Edmund West", "child", "Ottoline Vane"],
      ["Ottoline Vane", "spouse", "Peregrine Mott"],
      ["Juliana West", "child", "Rowena Ellery"],
      ["Rowena Ellery", "spouse", "Silas Whitcombe"],
      ["Godfrey Hart", "spouse", "Tabitha Morland"],
      ["Tabitha Morland", "father", "Ulric Penhallow"],
    ]
  ) deposit(items, x, r, o);
  items.push(
    ["Who is Edmund West's child-in-law?", "The answer is Peregrine Mott."],
    ["Who is Juliana West's child-in-law?", "The answer is Silas Whitcombe."],
  );
  const { counters } = await respond(
    items,
    "Who is Godfrey Hart's father-in-law?",
  );
  assert.equal(counters.convergenceReads ?? 0, 0);
});

test("159.7 the meet explains the frame and the two things, nothing more", async () => {
  // A condition the instances never asked (`, the one who is a surgeon`) is
  // not explained by the meet: the join leaves exactly those bytes for the
  // market to price.
  const { items, c } = world();
  const tail = ", the one who is a surgeon";
  const q = `Who is the shared grandfather of ${c.x} and ${c.y}${tail}?`;
  const { steps } = await respond(items, q);
  const decision = steps.find((s) => s.mechanism.at(-1) === "decideGrounding");
  const join = decision?.data?.candidates?.find((x) => x.provenance === "join");
  assert.ok(join, "the meet is a candidate");
  assert.equal(join.unexplainedBytes, tail.length);
  const plain = await respond(items, ask(c));
  const decided = plain.steps.find((s) =>
    s.mechanism.at(-1) === "decideGrounding"
  )
    ?.data?.candidates?.find((x) => x.provenance === "join");
  assert.equal(
    decided?.unexplainedBytes,
    0,
    "the instances' own question is explained",
  );
});

test("159.C control: scrambled answers meet nothing", async () => {
  const { items, c } = world((_, i, inst) => inst[(i + 1) % 3].g);
  const { met } = await respond(items, ask(c));
  assert.ok(!met, "a scrambled answer was met");
});
