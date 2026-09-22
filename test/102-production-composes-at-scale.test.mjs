// 102-production-composes-at-scale.test.mjs — a produced composite is
// decomposed by ITS OWN TREE, at every corpus size.
//
// THE GAP THIS CLOSES.  `recompleteNode` re-covers a node an edge produced, and
// it seeds that re-cover from `recogniseSpan(bytes)` filtered to the node's own
// kids.  Above the `atomIsHub` flip the recognition of a produced span returns
// the WHOLE and deliberately suppresses its atoms (the off-boundary
// suppression), so the kid filter admitted nothing and the chain ended at the
// intermediate composite.  Measured on
//
//     seed → "p q" → (p→r, q→s) → "r s" → "m n"
//
// below the flip it reached "m n" with `fuse`+`recompose`; above it stopped at
// "p q" with neither, and the trace showed `recognise("p q") ⇒ form "p q"`
// alone.  The node's own kids ARE its decomposition — the machine that built
// the composite stated its parts — so they seed the re-cover directly, and a
// kid recognition already offers is skipped (below the flip the seed set is
// byte-identical to what it was).
//
// WHY THE FIXTURE CROSSES THE FLIP.  The property was never false below it: the
// whole point is that composition must not depend on corpus size.  The flip sits
// between N = 3 658 (composes) and N = 4 174 (did not), so the fixture ingests
// 4 400 filler pairs, exactly as test/99 does for the join.
//
// WHAT IS PINNED.
//   1. the answer above the flip EQUALS the answer below it (scale invariance,
//      asserted as one comparison rather than two magic strings);
//   2. above the flip the composition is reported — `fuse` and `recompose`
//      appear in the rationale, so the fix is visible in the rationale and not
//      just in the bytes;
//   3. the chain still ends where the graph ends ("m n"), so the fix does not
//      invent depth.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const CHAIN = [
  ["seed", "p q"],
  ["p", "r"],
  ["q", "s"],
  ["r s", "m n"],
];

const WORDS =
  ("alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima " +
    "mike november oscar papa quebec romeo sierra tango uniform victor whiskey " +
    "xray yankee zulu amber bronze copper dahlia ember fjord gossamer harbour " +
    "indigo jasmine kestrel lantern marigold nectar opal pewter quartz ripple " +
    "saffron thistle umber violet willow xenon yarrow").split(" ");

/** One store, ingested past the atomIsHub flip (N > 4 174). */
async function atScale(fillers = 4400) {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store });
  const w = (i, n) => WORDS[(i * 7 + n * 13) % WORDS.length];
  await mind.ingest([
    ...CHAIN,
    ...Array.from({ length: fillers }, (_, i) => [
      `${w(i, 1)} ${w(i, 2)} ${w(i, 3)} ${i}`,
      `${w(i, 4)} ${w(i, 5)} ${w(i, 6)} ${w(i, 7)} ${i}`,
    ]),
  ]);
  return { store, mind };
}

/** The same chain BELOW the flip — the behaviour the scaled store must match. */
async function belowFlip() {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest(CHAIN);
  return { store, mind };
}

const text = (b) => b.replace(/\0+/g, "").trim();

test("a produced composite composes identically below and above the flip", async () => {
  const small = await belowFlip();
  const big = await atScale();
  const deep = text(await big.mind.respondText("seed"));
  const shallow = text(await small.mind.respondText("seed"));

  // The property: depth is a fact about the graph, not about the corpus size.
  assert.equal(deep, shallow, "scale must not change how deep the chain goes");
  assert.equal(deep, "m n", "and the graph ends at the composite's continuation");
});

test("above the flip the composition is reported, not just performed", async () => {
  const { mind } = await atScale();
  const steps = [];
  await mind.respondText("seed", (s) => steps.push(s));
  const moves = new Set(steps.map((s) => s.mechanism.at(-1)));
  assert.ok(moves.has("fuse"), "the fused pair must appear in the rationale");
  assert.ok(
    moves.has("recompose"),
    "and the recomposition that names the deeper form",
  );
});

test("the fix does not invent depth: the chain still ends at the graph's end", async () => {
  const { mind } = await atScale();
  const answer = text(await mind.respondText("seed"));
  assert.notEqual(answer, "r s", "it must not stop at the parts it followed");
  assert.notEqual(answer, "z", "nor reach a form the graph never licensed");
});
