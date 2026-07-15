// 21-partial.test.mjs — leveraging the PARTIAL results of an experience.
//
// Sema learns a fact or experience as a continuation EDGE between two interned
// trees, and answers by resonating a query to a learnt node and following the
// graph. The recall machinery has always treated a learnt CONTEXT as reachable
// down to its interior — `link` reach-indexes the whole `from` subtree, and the
// consensus climb (test 17) resonates a reworded QUESTION's distinctive
// sub-regions and climbs the parents-DAG to the context they agree on.
//
// The CONTINUATION seat was the missing half. A query that names only a PORTION
// of a stored answer — a distinctive interior slice of an experience, an
// intermediate node of the continuation's DAG — had nothing to resonate to: only
// the answer ROOT was indexed, so the answer's discriminative interior was
// invisible and a partial-answer query landed on noise. Yet this is exactly the
// symmetric case: an intermediate node of a fact/experience should be a
// first-class resonance anchor, reachable and climbable like any other, so the
// graph can reason from the part to the whole.
//
// The fix completes that symmetry with the machinery already there:
//   • `link` reach-indexes BOTH subtrees, so every experience's interior (context
//     AND continuation) is resonance-findable — while keeping each ROOT the sole
//     MERGE target, so enlarging reach never enlarges the merge candidate set
//     (the over-merge pathology the lazy index exists to avoid);
//   • `edgeAncestors` collects a node bearing an edge in EITHER direction, so the
//     climb grounds an answer-interior slice on the continuation that owns it,
//     exactly as it already grounds a question slice on its context.
//
// These assertions pin the capability: a query that is only an INTERIOR SLICE of
// a stored answer resolves to its own experience, not a random neighbour. The
// aggregate bar clears comfortably with the fix and collapses without it (whole-
// answer-root indexing answers essentially none of these), so a regression that
// re-buries the continuation interior fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// Each experience's ANSWER is a rich composite; its distinctive content lives in
// INTERIOR nodes of the continuation's DAG, never trained as a context of its own.
const FACTS = [
  [
    "Describe the Apollo 11 mission",
    "Apollo 11 landed Neil Armstrong and Buzz Aldrin on the Moon in 1969.",
  ],
  [
    "Describe the Voyager probes",
    "The Voyager probes left the solar system carrying a golden record of Earth.",
  ],
  [
    "Describe the Hubble telescope",
    "Hubble orbits Earth and has photographed galaxies billions of light years away.",
  ],
  [
    "Describe the theory of relativity",
    "Einstein's relativity showed that space and time bend around mass and energy.",
  ],
  [
    "Describe the Great Barrier Reef",
    "The Great Barrier Reef is the largest living structure made by tiny coral polyps.",
  ],
  [
    "Describe the printing press",
    "Gutenberg's printing press spread books and ideas across Europe in the fifteenth century.",
  ],
  [
    "Describe the human heart",
    "The human heart pumps blood through four chambers to feed every cell with oxygen.",
  ],
  [
    "Describe the Amazon rainforest",
    "The Amazon rainforest produces much of the planet's oxygen and shelters countless species.",
  ],
];

// [interior slice of the answer (NEVER a whole answer, NEVER a context), expected
//  FACT index]. Each is a fragment buried inside one continuation's DAG.
const PROBES = [
  ["Neil Armstrong and Buzz Aldrin", 0],
  ["landed on the Moon in 1969", 0],
  ["a golden record of Earth", 1],
  ["left the solar system carrying", 1],
  ["galaxies billions of light years away", 2],
  ["space and time bend around mass", 3],
  ["the largest living structure", 4],
  ["made by tiny coral polyps", 4],
  ["spread books and ideas across Europe", 5],
  ["pumps blood through four chambers", 6],
  ["feed every cell with oxygen", 6],
  ["shelters countless species", 7],
];

const norm = (s) => s.replace(/\s+/g, " ").trim();
// A partial-answer query is "resolved" when it lands on its OWN experience —
// either seat is correct (Sema may voice the question or the answer of the pair,
// by seat symmetry). Match a distinctive interior slice of either seat.
const resolvesTo = (ans, [q, a]) => {
  const g = norm(ans);
  return g.includes(norm(a).slice(1, 20)) || g.includes(norm(q).slice(1, 20));
};

async function build(seed) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed, store });
  await mind.ingest(FACTS);
  return { store, mind };
}

test("a slice of a stored answer's INTERIOR resolves to its own experience", async () => {
  const { store, mind } = await build(7);
  const got = [];
  for (const [q, idx] of PROBES) {
    const ans = await mind.respondText(q);
    got.push({ q, ok: resolvesTo(ans, FACTS[idx]), ans: norm(ans) });
  }
  await store.close();

  const total = got.filter((g) => g.ok).length;
  // The fix scores well over half here; whole-answer-root indexing (the old
  // behaviour) answers essentially none of these — every probe is an interior
  // slice, indexed only once its experience's whole subtree is reach-indexed.
  // The bar is set generously below the fix's score to absorb ANN/codec jitter
  // while a reversion (re-burying the continuation interior) drops to ~0 and
  // fails.
  assert.ok(
    total >= 5,
    `only ${total}/${PROBES.length} interior-slice queries resolved — ` +
      `expected ≥ 5 (the continuation interior must be a resonance anchor)\n` +
      got.filter((g) => !g.ok).map((g) =>
        `  ✗ "${g.q}" → ${g.ans.slice(0, 44)}`
      ).join("\n"),
  );
});

// The sharpest case: a distinctive interior slice must select ITS experience over
// the seven frame-sharing neighbours, not merely return SOME stored fact.
test("a distinctive answer-interior slice selects its own experience, not a neighbour", async () => {
  const { store, mind } = await build(42);
  const ans = norm(await mind.respondText("Neil Armstrong and Buzz Aldrin"));
  await store.close();
  assert.ok(
    resolvesTo(ans, FACTS[0]),
    `the Apollo-interior slice resolved to "${ans.slice(0, 52)}" — ` +
      `expected the Apollo 11 experience`,
  );
});

// The capability must not cost the whole-fact recall it generalises: asking a
// full context still answers with its trained continuation.
test("whole-fact recall is preserved alongside partial-result recall", async () => {
  const { store, mind } = await build(7);
  const whole = norm(await mind.respondText("Describe the Apollo 11 mission"));
  await store.close();
  assert.ok(
    whole.includes(norm(FACTS[0][1]).slice(1, 20)),
    `whole-fact recall regressed: "${whole.slice(0, 52)}"`,
  );
});
