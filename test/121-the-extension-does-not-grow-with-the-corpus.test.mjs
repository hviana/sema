// 121-the-extension-does-not-grow-with-the-corpus.test.mjs — the POST-GROUNDING
// extension must be flat in the corpus too.
//
// THE LAW, applied one layer out.  test/119 pins that the DERIVATION's work does
// not grow with the corpus.  But the answer also passes through the post-grounding
// extension (`reason()`), and bounded-reads.md does not care which layer does the
// work: a bigger store may answer differently, never buy arbitrary computation for
// the same answer.
//
// MEASURED BEFORE THIS TEST EXISTED, one call per size:
//
//     N= 250 / 500 / 1000 / 2000  ⇒  reasonSteps 1, reasonCarriedBytes 11,
//                                     pops 338 (k = 0.000), same answer
//
// THE BARS ARE THE REPO'S OWN (trap 4 — no new numbers): test/89 asserts k < 1 for
// agenda pops ("only outright linear growth is the forbidden case … so this asserts
// the law itself", measured 1.40 unfixed → 0.54 fixed).  The exponent helper is
// test/14's `logLogSlope`, copied because suites here are standalone.
//
// THE ANTI-VACUITY GUARD IS THE POINT: `reasonSteps ≥ 1` at every size.  Most
// fixtures in this repository answer before the extension can run — measured five
// times over in the closure work — and a flat curve for an extension that never
// runs would prove nothing at all.

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

/** test/109's two-fact chain — the pivot is what crosses the hop — plus `n`
 *  unrelated pairs so the corpus grows without touching the extension. */
const QUERY = "What is the capital of France famous for";

async function measure(n) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  const pairs = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
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
  return {
    answer,
    steps: c.reasonSteps ?? 0,
    carried: c.reasonCarriedBytes ?? 0,
    pops: c.searchPops ?? 0,
  };
}

test("a bigger corpus does not buy more extension work for the same answer", async () => {
  const base = 250;
  const sizes = [];
  const pops = [];
  const steps = [];
  const answers = [];
  for (const mult of [1, 2, 4, 8]) {
    const n = base * mult;
    const r = await measure(n);
    sizes.push(n);
    pops.push(r.pops);
    steps.push(r.steps);
    answers.push(r.answer);
    console.log(
      `    N=${n} → reasonSteps ${r.steps}, reasonCarriedBytes ${r.carried}, ` +
        `pops ${r.pops}`,
    );
  }

  // ANTI-VACUITY: the extension must be what is being measured.  Without this,
  // a flat curve would just mean the reasoner never ran.
  assert.ok(
    steps.every((s) => s >= 1),
    `the extension must run at every size (got ${JSON.stringify(steps)})`,
  );
  assert.equal(
    new Set(answers).size,
    1,
    `the answer must not move with the corpus (got ${JSON.stringify(answers)})`,
  );
  assert.equal(
    new Set(steps).size,
    1,
    `and the extension must take the same number of steps (got ${
      JSON.stringify(steps)
    })`,
  );

  const kPops = logLogSlope(sizes, pops);
  console.log(`    growth exponent over N→8N: pops k=${kPops.toFixed(2)}`);
  assert.ok(
    kPops < 1,
    `agenda pops grew with exponent k=${kPops.toFixed(2)} in corpus size ` +
      `(${
        pops.join(" → ")
      }) for a byte-identical answer — k≈1 is work LINEAR ` +
      `in the corpus, which bounded-reads.md forbids outright`,
  );
});
