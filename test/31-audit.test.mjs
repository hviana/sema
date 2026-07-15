// 31-audit.test.mjs — flip points pinned by the inference-path audit.
//
// Each section freezes a decision boundary the audit found unguarded:
//   A. Response provenance (honesty read-out, incl. the recall-echo marker)
//   B. express() confidence floor (no fabrication from unrelated vectors)
//   C. Perfect-self-match reverse recall with MULTIPLE predecessors
//   D. The reason() echo gate (a query that is itself a learnt continuation)
//   E. consensusFloor — one derived formula, shared by its two consumers
//
// The assertions describe BEHAVIOUR only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { consensusFloor, Mind } from "../dist/src/index.js";

const newMind = () => new Mind({ seed: 7 });
const text = (r) => new TextDecoder().decode(r.bytes.filter((b) => b !== 0));

// ═══════════════════════════════════════════════════════════════════════
// Section A — provenance
// ═══════════════════════════════════════════════════════════════════════

test("A1: a grounded fact carries a non-echo provenance", async () => {
  const m = newMind();
  await m.ingest([
    ["what is ice?", "ice is frozen water"],
    ["what is fire?", "fire is hot plasma"],
  ]);
  const r = await m.respond("what is ice?");
  assert.equal(text(r), "ice is frozen water");
  assert.ok(
    ["cast", "join", "cover", "extract", "recall"].includes(r.provenance),
    `grounded answer must not be an echo (got ${r.provenance})`,
  );
  await m.store.close();
});

test("A2: silence carries no provenance", async () => {
  const m = newMind();
  await m.ingest([["what is a cat?", "a cat is a small feline"]]);
  const r = await m.respond("explain quantum chromodynamics");
  assert.equal(r.v, null);
  assert.equal(r.provenance, undefined);
  await m.store.close();
});

test("A3: every answer's provenance is from the closed set", async () => {
  const m = newMind();
  await m.ingest([
    ["ice", "cold"],
    ["fire", "hot"],
    ["what is ice?", "ice is frozen water"],
  ]);
  const allowed = new Set([
    "cast",
    "join",
    "cover",
    "extract",
    "recall",
    "recall-echo",
  ]);
  for (const q of ["ice", "what is ice?", "ice fire", "icy things"]) {
    const r = await m.respond(q);
    if (r.v !== null) {
      assert.ok(allowed.has(r.provenance), `${q} → ${r.provenance}`);
    }
  }
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section B — express() confidence floor
// ═══════════════════════════════════════════════════════════════════════

test("B1: express of a related embedding returns bytes; of an unrelated vector, silence", async () => {
  const m = newMind();
  await m.ingest([
    ["what is ice?", "ice is frozen water"],
    ["what is fire?", "fire is hot plasma"],
  ]);
  const emb = await m.embedding("what is ice?");
  assert.notEqual(emb, null);
  const related = await m.express(emb);
  assert.ok(related.length > 0, "a related vector must still express");

  // A pseudo-random direction is (whp) far below the reach threshold of
  // every stored gist — expressing it would fabricate an answer.
  const rand = new Float32Array(emb.length);
  for (let i = 0; i < rand.length; i++) {
    rand[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  }
  const unrelated = await m.express(rand);
  assert.equal(unrelated.length, 0, "an unrelated vector must express nothing");
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section C — perfect self-match with multiple predecessors
// ═══════════════════════════════════════════════════════════════════════

test("C1: a shared answer asked verbatim reverse-recalls ONE of its contexts, not itself", async () => {
  const m = newMind();
  await m.ingest([
    ["what makes ice special?", "it stays frozen"],
    ["what makes glass special?", "it stays frozen"],
    ["what is fire?", "fire is hot plasma"],
  ]);
  const out = await m.respondText("it stays frozen");
  assert.ok(
    out === "what makes ice special?" || out === "what makes glass special?",
    `expected a predecessor context, got ${JSON.stringify(out)}`,
  );
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section D — the reason() echo gate
// ═══════════════════════════════════════════════════════════════════════

test("D1: a query that is itself a learnt continuation still answers deterministically", async () => {
  // "beta bridge" is the continuation of "alpha follows"; asking it back must
  // not echo the conversation — it grounds to its own chain fixpoint, the
  // same answer the chain head reaches.
  const m = newMind();
  await m.ingest([
    ["alpha follows", "beta bridge"],
    ["beta bridge", "gamma end"],
    ["gamma end", "delta done"],
  ]);
  assert.equal(await m.respondText("beta bridge"), "delta done");
  assert.equal(await m.respondText("alpha follows"), "delta done");
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section E — consensusFloor: one derived formula
// ═══════════════════════════════════════════════════════════════════════

test("E1: consensusFloor is ln(N) + 1/2", () => {
  for (const N of [2, 10, 1000, 1e6]) {
    assert.equal(consensusFloor(N), Math.log(N) + 1 / 2);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Section G — pass-2 flip points
// ═══════════════════════════════════════════════════════════════════════

test("G1: answerRunsInContext decomposes a sparse subsequence and rejects a non-subsequence", async () => {
  const { answerRunsInContext } = await import(
    "../dist/src/mind/mechanisms/extraction.js"
  );
  const enc = (s) => new TextEncoder().encode(s);
  const runs = answerRunsInContext(
    null,
    enc("the red fox jumps high"),
    enc("red high"),
  );
  assert.deepEqual(runs, [
    { start: 4, end: 8, ansLen: 4 },
    { start: 18, end: 22, ansLen: 4 },
  ]);
  assert.equal(answerRunsInContext(null, enc("abc"), enc("xyz")), null);
});

test("G2: detectSaturated — a saturated PARENT region cannot swallow an unsaturated chunk", async () => {
  const { detectSaturated } = await import("../dist/src/mind/attention.js");
  const ctx = { space: { maxGroup: 4 } };
  // collectRegions emits post-order: the parent (0-8) arrives AFTER its two
  // chunks and shares chunk 1's start.  With chunk 2 (4-8) unsaturated, the
  // saturated parent + saturated chunk 3 must NOT fuse into one interval
  // spanning 0-12 over the unsaturated middle.
  const regions = [
    { start: 0, end: 4, chunk: true },
    { start: 4, end: 8, chunk: true },
    { start: 0, end: 8, chunk: false }, // post-order parent
    { start: 8, end: 12, chunk: true },
  ];
  const sat = detectSaturated(ctx, regions, [true, false, true, true]);
  assert.deepEqual(sat.intervals, [
    { start: 0, end: 4 },
    { start: 8, end: 12 },
  ]);
  assert.equal(sat.leadingEnd, 4);
});

test("G3: poured halo mass breaks equal-diversity ties (repetition is evidence)", async () => {
  // Both continuations have ONE distinct predecessor context; the second is
  // reinforced across three episodes.  Insertion order must not decide —
  // the poured mass must.
  const m = newMind();
  await m.ingest([["the sky is", "blue today"]]);
  for (let i = 0; i < 3; i++) await m.ingest([["the sky is", "grey often"]]);
  assert.equal(await m.respondText("the sky is"), "grey often");
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section H — pass-3 flip points
// ═══════════════════════════════════════════════════════════════════════

test("H1: an ALU kernel decline is observable, not silent", async () => {
  const { Alu } = await import("../dist/src/alu/src/index.js");
  const alu = new Alu();
  const enc = (s) => new TextEncoder().encode(s);
  const v = alu.recogniseValue(enc("tall"));
  assert.equal(alu.applyCaught, 0);
  // A symbol fed to arithmetic: the rule declines (null) — and the decline
  // is counted with the error retained, so a genuine kernel bug can never
  // hide behind the same catch invisibly.
  assert.equal(alu.apply("add", [v, v]), null);
  assert.equal(alu.applyCaught, 1);
  assert.ok(alu.lastApplyError !== null);
});

test("H2: the ALU meaning-memo does not change answers across repeat responds", async () => {
  const m = newMind();
  await m.ingest([
    ["1+2", "3"],
    ["where do penguins live?", "penguins live in antarctica"],
  ]);
  // Arithmetic by word-operator (exercises meaningOf), literal infix, and a
  // plain-English query — each asked twice; the memoised second pass must
  // answer identically.
  for (const q of ["sum 3 4", "2+2 3+3", "where do penguins live?"]) {
    const first = await m.respondText(q);
    assert.equal(await m.respondText(q), first, q);
  }
  assert.equal(await m.respondText("sum 3 4"), "7");
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section I — pass-4 flip points
// ═══════════════════════════════════════════════════════════════════════

test("I1: containsSpan rejects a sparse subsequence that isSpanShaped accepts", async () => {
  const { containsSpan, isSpanShaped } = await import(
    "../dist/src/mind/mechanisms/extraction.js"
  );
  const m = newMind();
  await m.ingest([["what is ice?", "ice is frozen water"]]);
  const enc = (s) => new TextEncoder().encode(s);
  // "cold" is a gap-tolerant subsequence of this sentence (c…o…l…d in order)
  // but NOT a contiguous run nor a recognised subtree: the fusion gate
  // (containsSpan) must reject it while extraction's multi-piece reading
  // (isSpanShaped) still accepts it.
  const query = enc("since october, less daylight");
  const short = enc("cold");
  assert.equal(isSpanShaped(m, query, short), true);
  assert.equal(containsSpan(m, query, short), false);
  // A contiguous run passes both.
  assert.equal(containsSpan(m, enc("very cold night"), short), true);
  await m.store.close();
});

test("I2: a read of a dangling node id is empty, safe, and COUNTED", async () => {
  const m = newMind();
  await m.ingest([["a b", "c d"]]);
  assert.equal(m.store.danglingReads, 0);
  const out = await m.express(99_999_999);
  assert.equal(out.length, 0);
  assert.equal(m.store.danglingReads, 1);
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section F — rationale still traces a full respond (instrumentation path)
// ═══════════════════════════════════════════════════════════════════════

test("F1: inspectRationale sees the provenance-bearing pipeline end to end", async () => {
  const m = newMind();
  await m.ingest([
    ["what is ice?", "ice is frozen water"],
    ["what is fire?", "fire is hot plasma"],
  ]);
  const steps = [];
  const r = await m.respond("what is ice?", (s) => steps.push(s));
  assert.ok(r.provenance !== undefined);
  const names = new Set(steps.map((s) => s.mechanism ?? s.name));
  assert.ok(steps.length > 0, "rationale stream must not be empty");
  assert.ok(
    [...names].some((n) => String(n).includes("respond")) ||
      steps.some((s) => JSON.stringify(s).includes("respond")),
    "the respond mechanism must appear in the rationale",
  );
  await m.store.close();
});
