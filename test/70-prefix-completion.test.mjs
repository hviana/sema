// 70-prefix-completion.test.mjs — a query that IS the opening of one trained
// form is completed by that form's remainder; anything less is refused.
//
// WHAT THE MECHANISM DOES (src/mind/prefix-completion.ts): when every other
// tier has declined, scan the candidate list recall's refusal path has ALREADY
// fetched and look for a trained form whose bytes literally BEGIN with the whole
// query.  The answer is that form's own remainder — never an invention.
//
// WHY IT IS NEEDED, measured on the 15.7M-node trained store:
// `The capital of France is` grounded nothing, while
// `The capital of France is Paris.` is trained and reads back byte-exact.  Two
// independent reasons the earlier tiers cannot reach it:
//   * `resolve(prefix)` is null — a proper prefix has no branch of its own.
//   * the form is absent from `resonate(k)` at k = 24, 256 AND 2048, while forms
//     scoring LOWER are returned (cos 0.5752 for the target against Germany
//     0.5670, Yemen 0.5591).  `k` only reorders within the IVF clusters already
//     probed, so no k recovers it; with `exhaustive` it ranks 8.
// It is a RETRIEVABILITY gap, not a semantic one.
//
// COST — A/B on the trained store, counting resonate calls directly: the tier
// adds ZERO exhaustive calls.  F-prefix already made exactly one (for the
// substitution bridge) and returned silence; with the tier it makes the same one
// and answers.  Battery: F 0% → 25%, overall 76.2% → 78.6%, `0 weak`, all three
// honest-silence probes still silent, median latency 0.63s → 0.57s.
//
// Unlike test/69, a POSITIVE fixture IS constructible here: the mechanism keys
// on literal byte containment, not on corpus rarity, and rarity is the signal
// that collapses at fixture scale.
//
// The mechanism has NO notion of text: no separator, no character class, no
// "word".  Its only structural quantity is W, the river's grouping window.  So
// these fixtures are readable prose only for the reader's benefit -- every
// assertion below is about bytes and geometry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { prefixCompletion } from "../dist/src/mind/mechanisms/prefix-completion.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = new TextDecoder();

async function fixture(train) {
  const mind = new Mind({
    seed: 1,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest(train);
  return mind;
}
/** Call the tier the way recall does: the query plus a ranked hit list. */
async function tier(mind, q, k = 64) {
  const hits = await mind.store.resonate(mind.perceive(q).v, k);
  return prefixCompletion(mind, enc(q), hits.map((h) => h.id));
}

const FACTS = [
  "The capital of France is Paris.",
  "The capital of Japan is Tokyo.",
  "The capital of Germany is Berlin.",
];

test("1. the sole form opening with the query is completed by its remainder", async () => {
  const m = await fixture(FACTS);
  const hit = await tier(m, "The capital of France is");
  assert.notEqual(hit, null, "the trained form opens with the query");
  assert.equal(dec.decode(hit.form), "The capital of France is Paris.");
  await m.store.close();
});

test("2. AMBIGUITY is refused — the prefix trap", async () => {
  // Two trained forms open with the same words and continue differently.  The
  // corpus does not say which completion the asker means, so neither is
  // licensed.  This is the documented prefix trap, and it is real — it simply
  // does not hold for EVERY prefix, which is what test 1 pins.
  const m = await fixture([
    "The capital city is Paris.",
    "The capital city is Berlin.",
  ]);
  assert.equal(await tier(m, "The capital city is"), null);
  await m.store.close();
});

test("3. the same completion via two forms is ONE answer, not an ambiguity", async () => {
  // Uniqueness is judged on the remainder BYTES, not on the candidate id.
  const m = await fixture([
    "The capital of France is Paris.",
    "The capital of France is Paris.",
  ]);
  const hit = await tier(m, "The capital of France is");
  assert.notEqual(hit, null);
  assert.equal(dec.decode(hit.form), "The capital of France is Paris.");
  await m.store.close();
});

test("4. a SUB-QUANTUM continuation is refused", async () => {
  // Observed on the trained store: `What is the capital of France?` opens a
  // trained `What is the capital of France??`, which continues by ONE byte.
  // Below W the continuation is sub-quantum -- the fold groups nothing from it
  // -- and voicing it is the degenerate reply of the battery's section M.
  // The bar is the grouping window, not a punctuation class.
  const m = await fixture(["What is the capital of France??"]);
  assert.equal(await tier(m, "What is the capital of France?"), null);
  await m.store.close();
});

test("5. a query no trained form opens with is refused", async () => {
  const m = await fixture(FACTS);
  for (
    const q of [
      "The capital of Zamunda is",
      "xyzzy plugh quux",
      "Paris is the capital of",
    ]
  ) {
    assert.equal(await tier(m, q), null, q);
  }
  await m.store.close();
});

test("6. a query that is a whole trained form is not 'completed' by itself", async () => {
  // An exact form has an EMPTY remainder, which no guard should let through —
  // and the exact tiers own that query anyway.
  const m = await fixture(FACTS);
  assert.equal(await tier(m, "The capital of France is Paris."), null);
  await m.store.close();
});

test("7. the tier is deterministic and side-effect free", async () => {
  const m = await fixture(FACTS);
  const q = "The capital of France is";
  const before = m.store.nodeCount();
  const a = await tier(m, q);
  const b = await tier(m, q);
  assert.equal(dec.decode(a.form), dec.decode(b.form));
  assert.equal(a.id, b.id);
  assert.equal(
    m.store.nodeCount(),
    before,
    "the tier must not intern anything",
  );
  await m.store.close();
});

test("9. a form that continues past the read bound vetoes", async () => {
  // Reads are bounded (query.length * W).  A candidate that opens with the
  // query but SATURATES the read continues out of sight, so it is a standing
  // disagreement -- NOT something to skip.  Skipping it is what manufactures a
  // fragment: it removes the only evidence contradicting an interior fold node
  // that happens to fit under the cap.
  const q = "The capital of France is";
  const long = q + " Paris, and the country's largest city by a wide margin, " +
    "a global centre for art, fashion, gastronomy and culture.";
  assert.ok(long.length > q.length * 4, "the fixture must exceed the cap");
  const m = await fixture([long]);
  assert.equal(await tier(m, q), null);
  await m.store.close();
});

test("8. end to end, the fixture's own trained forms still answer", async () => {
  // The tier sits on the refusal path; it must not disturb normal grounding.
  const m = await fixture([
    "What is the capital of France?",
    "The capital of France is Paris.",
  ]);
  const r = await m.respond("What is the capital of France?");
  assert.ok(r.bytes.length > 0, "a trained question still answers");
  await m.store.close();
});
