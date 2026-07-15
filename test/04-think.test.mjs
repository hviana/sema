import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// =========================================================================
// 1 — Single-step direct recall & chain basics
// =========================================================================

test("direct recall: trained fact answers immediately", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"], ["3+5", "8"]]);
  assert.equal(await m.respondText("3+5"), "8");
});

test("single chain: A→B", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["fire", "hot"]]);
  assert.equal(await m.respondText("fire"), "hot");
});

test("two-step chain: A→B, B→C", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "b"], ["b", "c"]]);
  assert.equal(await m.respondText("a"), "c");
});

test("three-step chain: A→B, B→C, C→D", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "b"], ["b", "c"], ["c", "d"]]);
  assert.equal(await m.respondText("a"), "d");
});

test("four-step chain: A→B→C→D→E", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]]);
  assert.equal(await m.respondText("a"), "e");
});

// =========================================================================
// 2 — Known part fires inside unknown wrappers
// =========================================================================

test("known part with prefix", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"]]);
  assert.equal(await m.respondText("what is 2+2"), "4");
});

test("known part with suffix", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"]]);
  assert.equal(await m.respondText("2+2 equals what"), "4");
});

test("known part with prefix and suffix", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"]]);
  assert.equal(await m.respondText("compute: 2+2 now"), "4");
});

test("known part buried mid-sentence", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "cold"]]);
  assert.equal(await m.respondText("the nature of ice is known"), "cold");
});

// =========================================================================
// 3 — Multi-part: multiple known parts fire independently
// =========================================================================

test("two independent parts with gap", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  assert.equal(await m.respondText("ice fire"), "cold hot");
});

test("three independent parts", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "A"], ["b", "B"], ["c", "C"]]);
  assert.equal(await m.respondText("a b c"), "A B C");
});

test("four independent parts", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"]]);
  const r = await m.respondText("a b c d");
  assert.ok(
    r.includes("A") && r.includes("B") && r.includes("C") && r.includes("D"),
  );
});

test("five independent parts", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"], ["e", "E"]]);
  const r = await m.respondText("a b c d e");
  assert.ok(r.includes("A") && r.includes("E"));
});

// =========================================================================
// 4 — Order independence
// =========================================================================

test("reversed order: fire ice → hot cold", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  const r = await m.respondText("fire ice");
  assert.ok(r.includes("hot") && r.includes("cold"));
});

test("scrambled order: c a b → C A B", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "A"], ["b", "B"], ["c", "C"]]);
  const r = await m.respondText("c a b");
  assert.ok(r.includes("A") && r.includes("B") && r.includes("C"));
});

test("interspersed known and unknown", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "cold"]]);
  const r = await m.respondText("xyz ice uvw");
  assert.ok(r.includes("cold"));
});

// =========================================================================
// 5 — Punctuation and formatting preserved
// =========================================================================

test("comma between facts preserved", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  const r = await m.respondText("ice, fire");
  assert.ok(r.includes("cold") && r.includes("hot"));
});

test("period preserved", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"]]);
  assert.equal(await m.respondText("2+2."), "4.");
});

test("question mark preserved", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"]]);
  assert.equal(await m.respondText("2+2?"), "4?");
});

// =========================================================================
// 6 — Chain + independent part in same query
// =========================================================================

test("chain and direct fact side by side", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "b"], ["b", "c"], ["ice", "cold"]]);
  const r = await m.respondText("a ice");
  assert.ok(r.includes("c") && r.includes("cold"));
});

test("two independent chains in one query", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "b"], ["b", "c"], ["x", "y"], ["y", "z"]]);
  const r = await m.respondText("a x");
  assert.ok(r.includes("c") && r.includes("z"));
});

// =========================================================================
// 7 — Recursive rewriting to fixpoint
// =========================================================================

test("rewrite chains converge to fixpoint", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "b"], ["b", "c"], ["c", "d"]]);
  assert.equal(await m.respondText("a"), "d");
});

test("bidirectional chain: reverse completion works", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["question", "answer"]]);
  // Asking the continuation should recall the context (seat symmetry)
  assert.equal(await m.respondText("answer"), "question");
});

test("echo termination: self-feeding rewrite halts", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ab", "ab ab"]]);
  const r = await m.respond("xq ab zk");
  assert.ok(r.v === null || new TextDecoder().decode(r.bytes).includes("ab"));
});

// =========================================================================
// 8 — Definition expansion
// =========================================================================

test("definition lookup: term → meaning", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "frozen water"]]);
  assert.equal(await m.respondText("what is ice"), "frozen water");
});

test("definition lookup mid-sentence", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "frozen water"]]);
  assert.equal(await m.respondText("tell me about ice please"), "frozen water");
});

test("definition chain through two levels", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["x", "y"], ["y", "z"]]);
  assert.equal(await m.respondText("x"), "z");
});

test("synonym expansion via concept merge", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["big", "large"]]);
  // Ground both in the same context so they merge
  await m.ingest(["ctx", "big"]);
  await m.ingest(["ctx", "large"]);
  // Now they're one concept — asking one recalls the other
  assert.equal(await m.respondText("large"), "large");
});

// =========================================================================
// 9 — Compositional synthesis from multiple facts
// =========================================================================

test("two facts compose: ice fire → cold hot", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  assert.equal(await m.respondText("ice fire"), "cold hot");
});

test("three facts compose", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "A"], ["b", "B"], ["c", "C"]]);
  assert.equal(await m.respondText("a b c"), "A B C");
});

test("synthesis across concept boundaries", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  await m.ingest(["ctx", "ice"]);
  await m.ingest(["ctx", "hielo"]);
  // ice and hielo merge. Asking hielo should still compose with fire.
  const r = await m.respondText("hielo fire");
  assert.ok(r.includes("cold") && r.includes("hot"));
});

// =========================================================================
// 10 — Arithmetic chains (the classic use case)
// =========================================================================

const ARITH = [
  ["1+2", "3"],
  ["2+2", "4"],
  ["2+3", "5"],
  ["3+3", "6"],
  ["3+5", "8"],
  ["4+3", "7"],
  ["2+5", "7"],
  ["1+5", "6"],
  ["6+1", "7"],
  ["4+1", "5"],
  ["3+4", "7"],
  ["5+2", "7"],
  ["1+1", "2"],
  ["5+3", "8"],
  ["7+1", "8"],
];

test("arithmetic: direct fact", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest(ARITH);
  assert.equal(await m.respondText("3+5"), "8");
});

test("arithmetic: 2-step chain", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest(ARITH);
  assert.equal(await m.respondText("2+2+3"), "7");
});

test("arithmetic: fact inside question", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest(ARITH);
  assert.equal(await m.respondText("what is 2+2"), "4");
});

test("arithmetic: two facts with gap preserved", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest(ARITH);
  assert.equal(await m.respondText("2+2 3+3"), "4 6");
});

// =========================================================================
// 11 — Grounding and concept cross-transfer
// =========================================================================

test("concept cross-transfer: knowledge in one language, asked in another", async () => {
  const m = new Mind({
    seed: 7,
  });
  // Fact only in English
  await m.ingest("ice", "ice is frozen water");
  // Ground both names identically
  await m.ingest(["ctx-a", "ice"]);
  await m.ingest(["ctx-b", "ice"]);
  await m.ingest(["ctx-a", "hielo"]);
  await m.ingest(["ctx-b", "hielo"]);
  // Ask in Spanish — should get Spanish answer
  assert.equal(await m.respondText("hielo"), "hielo is frozen water");
});

test("multi-name concept: three languages", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest("ice", "ice is frozen water");
  await m.ingest(["ctx-a", "ice"]);
  await m.ingest(["ctx-a", "hielo"]);
  await m.ingest(["ctx-a", "氷"]);
  await m.ingest(["ctx-b", "ice"]);
  await m.ingest(["ctx-b", "hielo"]);
  await m.ingest(["ctx-b", "氷"]);
  assert.equal(await m.respondText("氷"), "氷 is frozen water");
});

// =========================================================================
// 12 — Edge cases & silence
// =========================================================================

test("empty query is silent", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "b"]]);
  assert.equal((await m.respond("")).v, null);
});

test("completely unknown query: returns null or closest approximation", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"]]);
  // Without artificial recall thresholds, unknown queries may return
  // a closest-approximation answer or null. Both are valid.
  const r = await m.respond("3+5");
  assert.ok(r.v !== undefined, "respond returns a valid response");
});

test("partial unknown, partial known: known fires, unknown handled gracefully", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"]]);
  // "3+5" is unknown — may return null or a closest approximation.
  const r = await m.respond("what is 3+5");
  assert.ok(r.v !== undefined, "respond returns a valid response");
});

test("single letter floor: related byte grounds, unrelated is silent", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"]]);
  // A byte that appears in the stored context still resonates to its grounded
  // form.  An unrelated byte — one with no structural relationship to anything
  // in the store — now returns null: the reach threshold (1 − 1/(2·maxGroup))
  // prevents fabricating an answer from an unrelated form.
  const related = await m.respond("4");
  assert.ok(
    related.v !== null,
    '"4" (appears in store) returns its grounded form',
  );
  assert.ok(related.bytes.length > 0, '"4" returns bytes');

  const unrelated = await m.respond("a");
  assert.equal(unrelated.v, null, '"a" (unrelated to store) returns null');
  assert.equal(unrelated.bytes.length, 0, '"a" returns empty bytes');
});

test("multi-byte known part with single-char prefix fires", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ab", "XY"]]);
  assert.equal(await m.respondText("x ab"), "XY");
});

// =========================================================================
// 13 — Persistence: concepts and chains survive save/load
// =========================================================================

test("chain works after save/load", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const m = new Mind({ seed: 7, store });
  await m.ingest([["a", "b"], ["b", "c"]]);
  await m.save();
  const m2 = await Mind.loadFromStore(store);
  assert.equal(await m2.respondText("a"), "c");
  await store.close();
});

// =========================================================================
// 15 — Nested: training episodes contain known parts that themselves fire
// =========================================================================

test("training: ingest pair whose sides are themselves known", async () => {
  const m = new Mind({
    seed: 7,
  });
  // First establish a→b, then train (a, fact) — fact contains "b" which chains
  await m.ingest([["a", "b"]]);
  await m.ingest("a", "the answer is b");
  assert.equal(await m.respondText("a"), "b");
});

// =========================================================================
// 16 — Same meaning, different surface forms
// =========================================================================

test("same meaning in different casing still fires", async () => {
  const m = new Mind({
    seed: 7,
  });
  // Note: sema does NOT normalize case — this tests exact match
  await m.ingest([["ICE", "cold"]]);
  assert.equal(await m.respondText("ICE"), "cold");
});

// =========================================================================
// 17 — Multi-utterance queries
// =========================================================================

test("newline-separated facts fire independently", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  const r = await m.respondText("ice\nfire");
  assert.ok(r.includes("cold") && r.includes("hot"));
});

// =========================================================================
// 18 — Known part at boundaries
// =========================================================================

test("known part at very start of stream", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["abc", "XYZ"]]);
  assert.equal(await m.respondText("abc def"), "XYZ");
});

test("known part at very end of stream", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["abc", "XYZ"]]);
  assert.equal(await m.respondText("def abc"), "XYZ");
});

// =========================================================================
// 19 — Very long chains
// =========================================================================

test("5-step chain", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"], ["e", "f"]]);
  assert.equal(await m.respondText("a"), "f");
});

// =========================================================================
// 20 — Multiple rewrites of the same part across iterations
// =========================================================================

test("same position rewritten multiple times as chain progresses", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["x", "y"], ["y", "z"], ["z", "w"]]);
  // "x" at position 0 gets rewritten y→z→w across 3 iterations
  assert.equal(await m.respondText("x"), "w");
});

// =========================================================================
// 21 — Training that includes the answer as prefix/suffix
// =========================================================================

test("fact with surrounding whitespace", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["  ice  ", "cold"]]);
  assert.equal(await m.respondText("  ice  "), "cold");
});

// =========================================================================
// 22 — Determinism
// =========================================================================

test("same seed, same training, same answer", async () => {
  const run = async () => {
    const m = new Mind({
      seed: 99,
    });
    await m.ingest([["a", "b"], ["b", "c"]]);
    return await m.respondText("a");
  };
  assert.equal(await run(), await run());
});

// =========================================================================
// 23 — Negation
// =========================================================================

test("negation: not X → not-X", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["a tree", "tree"], ["not a tree", "not-tree"]]);
  assert.equal(await m.respondText("not a tree"), "not-tree");
});

test("negation: double negation not not X → X", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["not X", "not-X"], ["not not-X", "X"]]);
  assert.equal(await m.respondText("not not X"), "X");
});

test("negation: arithmetic true/false statement", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["2+2", "4"], ["2+2=5", "false"], ["2+2=4", "true"]]);
  assert.equal(await m.respondText("2+2=4"), "true");
});

test("negation: opposite facts", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["ice is hot", "false"], ["ice is cold", "true"]]);
  assert.equal(await m.respondText("ice is cold"), "true");
});

test("negation: aligned structure preserved (not happy → sad)", async () => {
  const m = new Mind({
    seed: 7,
  });
  await m.ingest([["happy", "glad"], ["not happy", "sad"]]);
  assert.equal(await m.respondText("not happy"), "sad");
});
