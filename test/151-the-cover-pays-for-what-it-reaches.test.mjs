// 151-the-cover-pays-for-what-it-reaches.test.mjs — the cover's expensive
// premises are resolved where the search REACHES them, and a span's cheapest
// completion dominates the rest.
//
// THE TRAP, four times.  Each of these paid for every candidate the search
// could have used, before (or regardless of whether) it used it:
//   • connectors — every touching pair of recognised sites was bridged before
//     the search ran (measured on the 31.7M-node store: a 262-byte query
//     recognised whole paid 23 bridges, 143,520 junction pops, 7.3 s of 7.9 s);
//   • concept hops — every edge-less site paid a halo lookup, though the hop is
//     priced at CONCEPT and the whole's own edge closes the cover at one STEP;
//   • fusion — the post-grounding fusion climbed for a second point of
//     attention even when primary's evidence spans the whole query, where no
//     root can stand a quantum apart from it (3.7 s for an exact dialogue turn);
//   • alternatives — a greeting's thousands of replies were each a completion of
//     the same span, each fused and canonically resolved with its neighbours
//     (122,096 pops, 5.4 s of an 8.6 s cover, to stand in the end on two hops).
//
// Pinned:
//   151.1 a query recognised whole bridges no connector for its parts;
//   151.2 an edge-less part's concept hop is not looked up when the whole
//         closes the cover first;
//   151.3 a grounding standing on the whole query pays no fusion climb;
//   151.4 the work the cover generates does not grow with a hub's degree — the
//         replies past the first are dominated, and the answer is unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

async function fixture(pairs) {
  const mind = new Mind({
    seed: 7,
    profile: true,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest(pairs);
  return mind;
}

const sitesOf = (mind, text) => {
  mind.beginResponse();
  try {
    return mind.recogniseSpan(new TextEncoder().encode(text)).sites.map((
      s,
    ) => [s.start, s.end]);
  } finally {
    mind.endResponse();
  }
};

test("151.1 a query recognised whole bridges no connector for its parts", async () => {
  // `ab` and `cd` both continue and TOUCH in the query, so they are an offered
  // connector pair; `abcd` is learnt whole and closes the cover at one STEP,
  // before either part's rewrite (a STEP each) leaves the agenda.
  const mind = await fixture([
    ["ab", "x"],
    ["cd", "y"],
    ["abcd", "the whole"],
  ]);
  const sites = sitesOf(mind, "abcd");
  assert.ok(
    sites.some(([s, e]) => s === 0 && e === 2) &&
      sites.some(([s, e]) => s === 2 && e === 4),
    `the touching parts must be recognised for the pair to be offered: ${
      JSON.stringify(sites)
    }`,
  );
  assert.equal(await mind.respondText("abcd"), "the whole");
  assert.equal(mind.lastCost.counters.coverBridges ?? 0, 0);
  await mind.store.close();
});

test("151.2 an unreached concept hop is not looked up", async () => {
  // `ab` and `cd` are learnt only as CONTINUATIONS: they lead somewhere (a halo)
  // but have no edge of their own, so each is offered a concept hop.
  const mind = await fixture([
    ["abcd", "the whole"],
    ["first", "ab"],
    ["second", "cd"],
  ]);
  const sites = sitesOf(mind, "abcd");
  assert.ok(
    sites.length > 1,
    `the edge-less parts must be recognised: ${JSON.stringify(sites)}`,
  );
  assert.equal(await mind.respondText("abcd"), "the whole");
  assert.equal(mind.lastCost.counters.haloQueries ?? 0, 0);
  await mind.store.close();
});

test("151.3 a grounding standing on the whole query pays no fusion climb", async () => {
  // The answer carries none of the query's bytes, so the derivation stays open
  // and the fusion layer engages — but primary's evidence is the whole query.
  const mind = await fixture([
    ["ab", "x"],
    ["cd", "y"],
    ["abcd", "the whole"],
  ]);
  assert.equal(await mind.respondText("abcd"), "the whole");
  assert.equal(mind.lastCost.counters.climbs ?? 0, 0);
  await mind.store.close();
});

/** "hello" → "hi there", then "hi there" forks across `n` replies — each a
 *  fixpoint completing the same span.  The filler raises N so the hop's READ
 *  cap (√N) admits all `n`. */
async function hub(n) {
  const pairs = [["hello", "hi there"]];
  for (let k = 0; k < 1200; k++) {
    pairs.push([`filler question ${k}`, `filler answer ${k}`]);
  }
  for (let k = 0; k < n; k++) {
    pairs.push(["hi there", `reply number ${k} talks about topic ${k}.`]);
  }
  return await fixture(pairs);
}

test("151.4 a hub's degree does not grow the work the cover generates", async () => {
  const generated = [];
  const answers = [];
  for (const n of [8, 32]) {
    const mind = await hub(n);
    // The tail is bytes nothing learnt, so the goal is PASS-priced and, before
    // dominance, the search fused every reply with its neighbours.
    answers.push(await mind.respondText("hello zqxv wbjk"));
    const c = mind.lastCost.counters;
    assert.ok(
      c.searchDominated > 0,
      "the replies past the first are dominated",
    );
    generated.push(c.searchPops - c.searchDominated);
    await mind.store.close();
  }
  assert.equal(
    generated[1],
    generated[0],
    `rule-generating pops grew with the hub's degree: ${generated.join(" → ")}`,
  );
  assert.equal(answers[1], answers[0]);
});
