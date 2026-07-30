// 67-climb-anchor-breadth.test.mjs — recall's scaffolding-dominated tier
// trusts a consensus-climb anchor on its SCALE-INVARIANT breadth as well as on
// its absolute IDF vote, and a breadth-qualified anchor must also be
// DISCRIMINATIVE.
//
// WHY THE ABSOLUTE VOTE IS NOT ENOUGH.  Attention.breadth's own contract
// (types.ts) already says it: the IDF vote is "an absolute, ln(N)-scaled
// quantity that means 'strong' on a small store and 'weak' on a large one for
// the SAME degree of genuine consensus", while breadth is "the fraction of the
// query's OWN regions whose evidence this point accounts for" and "a point
// whose breadth clears `dominates` … is real consensus".  Attention.peak's
// contract makes the same point from the other side: a floor that prices ONE
// region's evidence may not be compared against a POOLED SUM.
//
// Measured on the 15.7M-node trained store (N=325,615, floor = ln N + ½ =
// 13.19).  The climb picked the RIGHT context and the floor discarded it, while
// a junk attractor for a query that must stay SILENT outvoted every correct
// anchor:
//
//   anchor the climb picked             vote   breadth  correct?
//   "What is the chemical formula …"    10.60    0.556   RIGHT
//   "Qual é a capital de França?"        8.19    0.667   RIGHT
//   "Who wrote the play Romeo …?"        8.25    0.833   RIGHT
//   "How do you say "good morning" …"   10.77    0.800   RIGHT
//   "What is the commercial capital …"  12.69    0.333   Zamunda — MUST be silent
//   "Menene sunan ginin mafi tsayi …"   12.79    0.214   wrong (Hausa)
//
// No vote threshold separates those; breadth > ½ separates them exactly.  On
// that store the old floor was never cleared at all, so the tier was dead code
// and 12 probes fell through to silence.
//
// WHAT MUST NOT REGRESS, and why the gate is an OR of two guarded readings:
//
//   • REPLACING the vote test with the breadth test broke 7 tests.  On a small
//     store ln(N) is low, so the vote bar is the reading that legitimately
//     fires there; and Attention.clusters' contract warns that "breadth starves
//     a genuine, evenly-split multi-topic query, since no root in a real N-way
//     split can exceed half the vote" — the two-topic fusion tests are exactly
//     that shape.  Each reading is sufficient on its own evidence.
//   • BREADTH ALONE fabricates.  On a one-context store every region trivially
//     corroborates the only anchor there is, so breadth is 1 while the anchor's
//     IDF is 0 — test/31 A2 answered a lone cat fact for "explain quantum
//     chromodynamics".  Hence the companion condition: a region's IDF for an
//     anchor reached through c of N contexts is ln(N/c), so requiring it past
//     ln 2 requires c·2 < N — the same half-dominance reading in IDF units.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = () =>
  new Mind({ seed: 1, store: new SQliteStore({ path: ":memory:" }) });

test("1. a one-context store never grounds an unrelated query (breadth alone must not decide)", async () => {
  // Breadth is trivially 1 when there is only one anchor to corroborate, but
  // that anchor's IDF is 0 — it says nothing.  VERIFIED to bite: dropping the
  // `peak > ln 2` companion makes this fail (and test/31 A2 with it).  The
  // fixture matches A2's exactly — `new Mind({ seed: 7 })`, the default store —
  // because the same shape over a SQliteStore did NOT reproduce it.
  const m = new Mind({ seed: 7 });
  await m.ingest([["what is a cat?", "a cat is a small feline"]]);
  const r = await m.respond("explain quantum chromodynamics");
  assert.equal(
    r.v,
    null,
    "a lone low-IDF anchor must not ground a foreign query",
  );
  assert.equal(r.provenance, undefined);
});

test("2. an evenly-split multi-topic query still fuses (breadth must not be required)", async () => {
  // The shape Attention.clusters' contract says breadth starves: no root in a
  // real N-way split can hold more than half the query's regions, so a
  // breadth-only gate would refuse both topics.
  const m = mk();
  await m.ingest([
    ["ice", "cold"],
    ["fire", "hot"],
    ["what is ice?", "ice is frozen water"],
    ["what is fire?", "fire is rapid oxidation"],
  ]);
  const a = await m.respondText("ice fire");
  assert.ok(a.length > 0, "a two-topic query must still ground something");
  await m.store.close();
});

test("3. honest silence survives on an unrelated corpus", async () => {
  const m = mk();
  await m.ingest([
    ["what is the capital of France?", "The capital of France is Paris."],
    ["what is the capital of Spain?", "Madrid is the capital of Spain."],
    ["what is the capital of Italy?", "Rome is the capital of Italy."],
  ]);
  for (const q of ["xyzzy plugh quux baz?", "qq8f3kz9 vv2m1x7w?"]) {
    const a = await m.respondText(q);
    assert.equal(a, "", `gibberish must stay silent, got ${JSON.stringify(a)}`);
  }
  await m.store.close();
});

test("4. a trained fact still answers (the tier did not displace an earlier one)", async () => {
  const m = mk();
  await m.ingest([
    ["what is the capital of France?", "The capital of France is Paris."],
    ["what is the capital of Spain?", "Madrid is the capital of Spain."],
  ]);
  assert.match(
    await m.respondText("what is the capital of France?"),
    /Paris/,
  );
  await m.store.close();
});
