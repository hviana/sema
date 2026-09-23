// 119-the-work-does-not-grow-with-the-corpus.test.mjs — the derivation's work
// must be FLAT in the corpus for a byte-identical answer.
//
// THE LAW.  bounded-reads.md forbids per-query work that grows with N: a bigger
// store may answer differently (a better derivation can exist), but it must not
// buy arbitrary COMPUTATION for the same answer.  test/89 measures this for the
// completion recursion against real prose, test/14 for recall reads; this closes
// the loop for the derivation as a whole after the F3/F4 migrations, where the
// hop allowance stopped deciding depth and the pivot's probe sweep got its own
// capacity.
//
// THE BARS ARE THE REPO'S OWN, not new numbers (trap 4).  test/89 asserts
// `k < 0.6` for its `searches` (nested solve() calls — the recursion, which its
// fix governs end to end; measured 1.28 unfixed → 0.38 fixed) and `k < 1` for
// agenda pops — "only outright linear growth is the forbidden case … so this
// asserts the law itself", measured 1.40 unfixed → 0.54 fixed.  Same helper as
// test/14 (`logLogSlope`), copied because suites here are standalone.
//
// MEASURED BEFORE THIS TEST EXISTED, on the fixture below, one call per size:
// pops 338 / 338 / 338 / 338 (k = 0.000), searches 2 everywhere, one pivot, and
// a byte-identical answer — flat, and flat by a wide margin.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

/** Power-law exponent k in t ≈ c·n^k, by log–log least squares.
 *  k≈0 flat · k≈1 linear · k≈2 quadratic.  (test/14's helper.) */
function logLogSlope(sizes, times) {
  const n = sizes.length;
  const xs = sizes.map(Math.log), ys = times.map(Math.log);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return num / den;
}

const WORDS =
  ("alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima " +
    "mike november oscar papa").split(" ");

/** A three-fact chain the query closes through (test/110's LINKS), plus `n`
 *  unrelated pairs so the corpus grows without touching the derivation. */
const QUERY = "What is the capital of France famous for";

async function measure(n) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  const pairs = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
  ];
  for (let i = 0; i < n; i++) {
    pairs.push([
      `note ${i} about ${WORDS[i % 16]} ${WORDS[(i * 3) % 16]}`,
      `the ${WORDS[i % 16]} of ${WORDS[(i * 5) % 16]} is ${
        WORDS[(i * 7) % 16]
      } ${i}`,
    ]);
  }
  await mind.ingest(pairs);
  const answer = String(await mind.respondText(QUERY)).trim();
  const c = mind.lastCost.counters;
  await store.close();
  return { answer, pops: c.searchPops ?? 0, searches: c.searches ?? 0 };
}

test("a bigger corpus does not buy more work for the same answer", async () => {
  const base = 250;
  const sizes = [];
  const pops = [];
  const searches = [];
  const answers = [];
  for (const mult of [1, 2, 4, 8]) {
    const n = base * mult;
    const r = await measure(n);
    sizes.push(n);
    pops.push(r.pops);
    searches.push(r.searches);
    answers.push(r.answer);
    console.log(
      `    N=${n} → pops ${r.pops}, searches ${r.searches}, ` +
        `answer "${r.answer.slice(0, 32)}"`,
    );
  }

  // The answer is the CONTROL: same answer, eight times the corpus.  Without
  // this the exponents below could be flat because the query stopped being
  // answered at all.
  assert.equal(
    new Set(answers).size,
    1,
    `the answer must not move with the corpus (got ${JSON.stringify(answers)})`,
  );

  const kSearches = logLogSlope(sizes, searches);
  const kPops = logLogSlope(sizes, pops);
  console.log(
    `    growth exponents over N→8N: searches k=${kSearches.toFixed(2)}, ` +
      `pops k=${kPops.toFixed(2)}`,
  );

  assert.ok(
    kSearches < 0.6,
    `nested searches grew with exponent k=${kSearches.toFixed(2)} in corpus ` +
      `size (${searches.join(" → ")}) for a byte-identical answer`,
  );
  assert.ok(
    kPops < 1,
    `agenda pops grew with exponent k=${kPops.toFixed(2)} in corpus size ` +
      `(${
        pops.join(" → ")
      }) for a byte-identical answer — k≈1 is work LINEAR ` +
      `in the corpus, which bounded-reads.md forbids outright`,
  );
});
