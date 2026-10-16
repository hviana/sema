// 106-the-join-fires.test.mjs — DIRECTION: the join reaches the subject the
// query never wrote.
//
// THE GAP THIS CLOSES.  `deriveThrough` derives the answer THROUGH a produced
// fact: the fact carries the subject the query never named, and the query's
// remaining tail names the relation to follow FROM that subject.  Measured, the
// rule never fired — and the report added for it (test/105) named the gate:
// `leading.length === 0`.  The cause was then measured exactly: the recognition
// of the fact's bytes returns EXACTLY ONE site — the fact itself — because a
// STORED WHOLE stops the sweep, so the interior entity the join exists for was
// never proposed, and the query was answered by gluing the intermediate KEY to
// the fact (`The director of Eva is Gustaf Molander.gustaf molander country`).
//
// WHAT IS PINNED.
//   1. the join FIRES: the answer is the second fact, reached through the
//      subject the query never wrote (`The country of Gustaf Molander is
//      Sweden.`);
//   2. the rationale says so (`derive-through` is the move that reached it);
//   3. the intermediate KEY never appears in the answer — the glued reading is
//      what the query got before, and it is not an answer;
//   4. a query with no tail is not a join at all: it is answered directly, and
//      the move must not be claimed.
//
// The `canonicalQueryNodes` exclusion (the query's OWN subject, canonically) is
// what keeps test/99's TRAP refused: its `Eiffel Tower country` is a deposited
// node in canonical form while the query writes it capitalised, so a raw byte
// test re-admitted it and the answer came back about Eiffel Tower.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const F1 = "The director of Eva is Gustaf Molander.";
const F2 = "The country of Gustaf Molander is Sweden.";

/** The measured chain, filed the way the real store files a fact: under BOTH
 *  the entity and the key it was learnt with. */
async function chain() {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([
    ["eva", F1],
    ["eva director", F1],
    ["gustaf molander", F2],
    ["gustaf molander country", F2],
  ]);
  return mind;
}

const text = (resp) => new TextDecoder().decode(resp.bytes).replace(/\0+/g, "");

test("the join reaches the subject the query never wrote", async () => {
  const mind = await chain();
  const moves = [];
  const out = text(
    await mind.respond(
      "eva director country",
      (s) => moves.push(s.mechanism.at(-1)),
    ),
  );
  assert.equal(out.trim(), F2);
  assert.ok(
    moves.includes("derive-through"),
    `expected the join to be the move that reached it, got ${
      [...new Set(moves)].join(", ")
    }`,
  );
  await mind.store.close();
});

test("the intermediate key is never the answer", async () => {
  const mind = await chain();
  const out = text(await mind.respond("eva director country"));
  assert.ok(
    !out.includes("gustaf molander country"),
    `the key is not an answer, got ${JSON.stringify(out)}`,
  );
  await mind.store.close();
});

test("a query with no tail is answered directly, not by a join", async () => {
  const mind = await chain();
  const moves = [];
  const out = text(
    await mind.respond("eva director", (s) => moves.push(s.mechanism.at(-1))),
  );
  assert.equal(out.trim(), F1);
  assert.ok(
    !moves.includes("derive-through"),
    "there is nothing to join through when the query ends at the fact",
  );
  await mind.store.close();
});

test("the asker's wording that already holds the answer's form is not spliced into it", async () => {
  // Articulation revoices an answer form in the asker's words when the two
  // keep the same company (halo).  `eva` and `eva director` keep the SAME
  // company here — both lead to the same fact — but the asker's wording holds
  // the form plus a further word: splicing it in is not a re-voicing, it adds
  // the asker's other words to the answer.  The DAG cannot see the containment
  // (the fold cuts `eva director` as `eva d|irector`), so it is read off the
  // bytes.  Observed before: "The director of eva director is Gustaf Molander."
  const lower = "The director of eva is Gustaf Molander.";
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([
    ["eva", lower],
    ["eva director", lower],
    ["gustaf molander", F2],
    ["gustaf molander country", F2],
  ]);
  assert.equal(text(await mind.respond("eva director")).trim(), lower);
  await mind.store.close();
});

test("a halo mate the corpus tells apart is not spliced into the answer", async () => {
  // A father and his son keep the same company — each leads to `The father of
  // … is …` and `The place of birth of … is …` — so the son's name is a halo
  // mate of the father's.  Articulation once revoiced the answer's `John de
  // Vere, 16th Earl of Oxford` as the asker's `Edward De Vere, 17Th Earl Of
  // Oxford` (measured on the 2Wiki fixture): "The father of Edward … is Edward
  // …", and the grandfather voiced as the father.  The corpus refutes the
  // swap: `… father` with one name in the other's place is a stored context
  // leading to another fact (traverse.ts, `licensedSubstitution`).
  const name = (n) => `${n} Earl of Oxford`;
  const [ed, j16, j15] = [
    name("Edward de Vere, 17th"),
    name("John de Vere, 16th"),
    name("John de Vere, 15th"),
  ];
  const father = (x, y) => `The father of ${x} is ${y}.`;
  const born = (x) => `The place of birth of ${x} is Castle Hedingham.`;
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([
    [`${ed} father`, father(ed, j16)],
    [`${j16} father`, father(j16, j15)],
    [ed, father(ed, j16)],
    [j16, father(j16, j15)],
    [`${ed} place of birth`, born(ed)],
    [`${j16} place of birth`, born(j16)],
  ]);
  await mind.buildCanonIndex();
  const asked = "Edward De Vere, 17Th Earl Of Oxford";
  for (
    const q of [`${asked} father`, `Who is ${asked}'s paternal grandfather?`]
  ) {
    const got = text(await mind.respond(q));
    assert.ok(
      !got.includes(`of ${asked} is`) && !got.includes(`is ${asked}`),
      `${q}: the asker's name spliced over another person — got "${got}"`,
    );
  }
  assert.equal(
    text(await mind.respond(`${asked} father`)).trim(),
    father(ed, j16),
  );
  await mind.store.close();
});
