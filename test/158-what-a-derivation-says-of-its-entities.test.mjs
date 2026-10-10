// 158-what-a-derivation-says-of-its-entities.test.mjs — a derivation read off
// other instances carries what EVERY instance's entity is, not only how the
// path leaves it, and every way the path reached it.
//
// THE READING (traverse.ts, `pathSearch`, `factFrames`, `relationFrames`,
// `byCoInstance`; evidence.md).  `Which child of Y is a medic?` answered `The
// occupation of C is surgeon.` is the derivation `· child → · occupation` from
// Y — and Y has other children.  What selects C is a fact of C the question
// never spells: every instance's child is a surgeon.  The facts each entity on
// an instance's path holds, with the entity cut out (`The occupation of · is
// surgeon.`), are intersected across the instances that ask what the question
// asks; once two agree, a step names only a fact holding an entity that holds
// them all, each an exact lookup of the whole fact.  An entity is stood on
// once per depth with every way the search reached it there, so two relations
// to one child (`child`, `heir`) are both read, whichever the corpus deposited
// first.
//
// MEASURED on a constructed world (examples answered with the deciding fact):
// selection by a condition the question does not spell, 1 and 4 of 6 by
// deposit order → 6 of 6 in both orders; with the answers scrambled nothing
// changes; the 2Wiki fixtures and the 31.7M-node battery are unchanged.
//
// Pinned:
//   158.1 the condition selects the branch, in either deposit order, traced or
//         not;
//   158.2 …on an entity before the answer: the spouse of the medic child;
//   158.3 two relations that reach one entity at one depth are both read:
//         instances deposited in different orders still agree;
//   158.4 a fact one instance's entity lacks is no condition (rationale).

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
];

/** Fictional names, each used once. */
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

/** Deposit a triple as the trainer does (wiki2.ts). */
const fact = (s, r, o) => `The ${r} of ${s} is ${o}.`;
const deposit = (items, s, r, o) =>
  items.push([`${s} ${r}`, fact(s, r, o)], [s, fact(s, r, o)]);

async function ask(items, questions, traced = false) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest(items);
  await mind.buildCanonIndex();
  const out = [];
  for (const q of questions) {
    const steps = [];
    const a = traced
      ? await mind.respondText(q, (s) => steps.push(s))
      : await mind.respondText(q);
    out.push({ a, steps });
  }
  await store.close();
  return out;
}

/** Three instances of `Which child of Y is a medic?`, each Y with a surgeon
 *  child and another; the question's X has the surgeon deposited `second` or
 *  first. */
function medics(second, jobs = ["surgeon", "surgeon", "surgeon"]) {
  const nm = names();
  const items = [];
  for (const job of jobs) {
    const y = nm(), c = nm(), d = nm();
    deposit(items, y, "child", d);
    deposit(items, y, "child", c);
    deposit(items, c, "occupation", job);
    deposit(items, d, "occupation", "lawyer");
    items.push([`Which child of ${y} is a medic?`, fact(c, "occupation", job)]);
  }
  const x = nm(), medic = nm(), other = nm();
  const kids = second ? [other, medic] : [medic, other];
  for (const k of kids) deposit(items, x, "child", k);
  deposit(items, medic, "occupation", "surgeon");
  deposit(items, other, "occupation", "painter");
  return { items, q: `Which child of ${x} is a medic?`, medic, other };
}

test("158.1 the condition every instance agrees on selects the branch", async () => {
  for (const second of [false, true]) {
    const w = medics(second);
    for (const traced of [false, true]) {
      const [{ a }] = await ask(w.items, [w.q], traced);
      assert.ok(
        a.includes(w.medic) && !a.includes(w.other),
        `${second ? "surgeon second" : "surgeon first"}${
          traced ? ", traced" : ""
        }: ${a}`,
      );
    }
  }
});

test("158.2 …on an entity before the answer: the spouse of the medic child", async () => {
  for (const second of [false, true]) {
    const nm = names();
    const items = [];
    const family = (medicFirst) => {
      const y = nm(), c = nm(), d = nm(), sc = nm(), sd = nm();
      for (const k of medicFirst ? [c, d] : [d, c]) {
        deposit(items, y, "child", k);
      }
      deposit(items, c, "occupation", "surgeon");
      deposit(items, d, "occupation", "lawyer");
      deposit(items, c, "spouse", sc);
      deposit(items, d, "spouse", sd);
      return { y, c, sc, sd };
    };
    for (let i = 0; i < 3; i++) {
      const f = family(i % 2 === 0);
      items.push([
        `Who is the spouse of the medic child of ${f.y}?`,
        fact(f.c, "spouse", f.sc),
      ]);
    }
    const x = family(!second);
    const [{ a }] = await ask(items, [
      `Who is the spouse of the medic child of ${x.y}?`,
    ]);
    assert.ok(
      a.includes(x.sc) && !a.includes(x.sd),
      `${second ? "medic second" : "medic first"}: ${a}`,
    );
  }
});

test("158.3 two relations to one entity at one depth are both read", async () => {
  // Each instance's child is also its heir; one instance deposits `heir`
  // first, the other `child`.  Read by the first way only, the two spell
  // different derivations and agree on none.
  const nm = names();
  const items = [];
  for (const heirFirst of [false, true]) {
    const y = nm(), c = nm(), d = nm();
    const rel = heirFirst ? ["heir", "child"] : ["child", "heir"];
    for (const r of rel) deposit(items, y, r, c);
    deposit(items, y, "child", d);
    deposit(items, c, "occupation", "surgeon");
    deposit(items, d, "occupation", "lawyer");
    items.push([
      `Which child of ${y} is a medic?`,
      fact(c, "occupation", "surgeon"),
    ]);
  }
  const x = nm(), medic = nm(), other = nm();
  deposit(items, x, "child", other);
  deposit(items, x, "child", medic);
  deposit(items, medic, "occupation", "surgeon");
  deposit(items, other, "occupation", "lawyer");
  const [{ a }] = await ask(items, [`Which child of ${x} is a medic?`]);
  assert.ok(a.includes(medic) && !a.includes(other), a);
});

test("158.4 a fact one instance's entity lacks is no condition", async () => {
  const agreed = medics(true);
  const split = medics(true, ["surgeon", "surgeon", "weaver"]);
  const condition = (steps) =>
    steps.filter((s) => s.mechanism.at(-1) === "relationFrames")
      .some((s) => s.note.includes("[1: The occupation of · is surgeon.]"));
  const [ok] = await ask(agreed.items, [agreed.q], true);
  const [none] = await ask(split.items, [split.q], true);
  assert.ok(condition(ok.steps), "three surgeons agree on the condition");
  assert.ok(!condition(none.steps), "a weaver among them leaves none");
});
