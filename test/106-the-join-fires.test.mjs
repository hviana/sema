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
