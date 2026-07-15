import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// =========================================================================
// THE ALU — arithmetic / logic / numerical computation as learned facts
// =========================================================================
// The ALU is not "hard-coded" logic masquerading as intelligence.
// It is a proof of concept: the symbolic component of Sema allows manual rules to be used alongside derived rules.
// The `alu` sub-lib gives the mind a minimal computational kernel — one logic
// gate (nand), the field-and-order primitives, and one limit operator
// (converge) — from which arithmetic, logic, and numerical analysis all derive.
// Its operations are MANUAL rules that compose in the SAME lightest-derivation
// search as learned facts (see src/mind/graph-search.ts / the ALU MindExtension): a query's
// operation is recognised (literally or, generically, by resonance), evaluated,
// and folded into the cover as a recognised completion.
//
// Two properties these tests pin down:
//   • COMPUTATION where the corpus is silent — the mind answers "2+2" with "4"
//     having learned no arithmetic, because the ALU rule grounds it.
//   • THE ALU ALWAYS WINS — a computation the query invokes is authoritative for
//     its span: it OVERRIDES any learned fact for the same bytes (even a
//     deliberately-trained "2+2"→"5" yields "4").  This overrides only the
//     colliding span, not the rest of thinking: a query with no operation
//     behaves exactly as before, and a computation composes with an unrelated
//     rewrite in one answer (the rest of the pre-ALU baseline is unchanged; see
//     the other test files, all still green).

const mk = () => new Mind({ seed: 7 });

// ── 1. Arithmetic with NO training — pure computation ────────────────────

test("computes a sum with no arithmetic ever trained", async () => {
  const m = mk();
  // The store is empty of arithmetic facts; "4" comes from the ALU rule alone.
  assert.equal(await m.respondText("2+2"), "4");
  await m.store.close();
});

test("computes product, difference, quotient", async () => {
  const m = mk();
  assert.equal(await m.respondText("6*7"), "42");
  assert.equal(await m.respondText("10-3"), "7");
  assert.equal(await m.respondText("100/4"), "25");
  await m.store.close();
});

test("multi-digit operands the chunker would split are read whole", async () => {
  const m = mk();
  assert.equal(await m.respondText("12+30"), "42");
  assert.equal(await m.respondText("123+456"), "579");
  await m.store.close();
});

// ── 2. The computation inside the asker's framing ────────────────────────

test("a computation fires inside a question, like a learned part would", async () => {
  const m = mk();
  assert.equal(await m.respondText("what is 2+2"), "4");
  assert.equal(await m.respondText("compute 6*7 now"), "42");
  await m.store.close();
});

test("punctuation around a computation is preserved", async () => {
  const m = mk();
  assert.equal(await m.respondText("2+2."), "4.");
  assert.equal(await m.respondText("2+2?"), "4?");
  await m.store.close();
});

// ── 3. Composition: chaining and precedence (the recursive ALU) ──────────

test("chained arithmetic reduces fully (composition for free)", async () => {
  const m = mk();
  assert.equal(await m.respondText("1+2+3"), "6");
  assert.equal(await m.respondText("7-2-1"), "4");
  await m.store.close();
});

test("precedence is honoured by the recursive expression evaluator", async () => {
  const m = mk();
  assert.equal(await m.respondText("2+3*4"), "14"); // not 20
  await m.store.close();
});

test("spaced arithmetic is the same as packed — the separator is bridged, not required", async () => {
  const m = mk();
  // "3 + 3" and "3+3" are one expression: the run tolerates a bridged separator
  // (whitespace), exactly as the cover bridges the space in "ice fire".  No
  // spelling is privileged — recognising 3+3 but not 3 + 3 was the absurd lexer.
  assert.equal(await m.respondText("3 + 3"), "6");
  assert.equal(await m.respondText("2 + 3 * 4"), "14");
  assert.equal(await m.respondText("10 - 3"), "7");
  await m.store.close();
});

// ── 4. Unary operations recognised by their NAME ─────────────────────────

test("a named unary op applies to its operand", async () => {
  const m = mk();
  assert.equal(await m.respondText("sqrt 144"), "12");
  assert.equal(await m.respondText("negate 5"), "-5");
  await m.store.close();
});

// ── 5. The numerical limit layer over an EXPRESSION (recursive calls) ────
// A derivative / integral acts on a FUNCTION, evaluated by a recursive
// application of the same ALU.  The OPERATION is named in words the query
// carries; the expression and point/bounds are parsed from the rest.

test("derivative of an expression at a point", async () => {
  const m = mk();
  assert.equal(await m.respondText("derivative of x^2 at 3"), "6");
  await m.store.close();
});

test("definite integral of an expression over bounds", async () => {
  const m = mk();
  assert.equal(await m.respondText("integral of x from 0 to 1"), "0.5");
  await m.store.close();
});

// ── 6. The polymorphic inverse ───────────────────────────────────────────
// The inverse of a NUMBER is its negation; the inverse of a learnt FORM is its
// grounded opposite (the corpus's own opposition relation, recalled — never a
// fabricated antonym).

test("inverse of a number is its negation", async () => {
  const m = mk();
  assert.equal(await m.respondText("inverse 3"), "-3");
  assert.equal(await m.respondText("opposite 7"), "-7");
  await m.store.close();
});

test("inverse of a form is its grounded opposite", async () => {
  const m = mk();
  await m.ingest([["large", "small"]]); // the corpus grounds the opposition
  assert.equal(await m.respondText("inverse large"), "small");
  await m.store.close();
});

// ── 7. THE ALU ALWAYS WINS — computation overrides recall; rest unchanged ─

test("a computation overrides a learned fact (the ALU always wins)", async () => {
  const m = mk();
  await m.ingest([["2+2", "5"]]); // a deliberately wrong learnt fact
  // The ALU must override the recall: a computation is authoritative for its
  // span, so the computed answer wins over the corpus's stored one.
  assert.equal(await m.respondText("2+2"), "4");
  await m.store.close();
});

test("a computation and a learned rewrite compose in one answer", async () => {
  const m = mk();
  await m.ingest([["ice", "cold"]]);
  const r = await m.respondText("ice 2+2");
  assert.ok(r.includes("cold") && r.includes("4"), `got ${JSON.stringify(r)}`);
  await m.store.close();
});

test("the ALU wins only on its span — a colliding fact is overridden, an unrelated rewrite still composes", async () => {
  const m = mk();
  // "2+2"→"5" collides with the computation; "ice"→"cold" does not.
  await m.ingest([["2+2", "5"], ["ice", "cold"]]);
  const r = await m.respondText("ice 2+2");
  // The computation overrides "5" on its own span (→ "4"), yet the masking is
  // surgical: the unrelated "ice"→"cold" rewrite is untouched, and "5" never
  // leaks in.
  assert.ok(
    r.includes("cold") && r.includes("4") && !r.includes("5"),
    `got ${JSON.stringify(r)}`,
  );
  await m.store.close();
});

test("a query with no operation is untouched by the ALU", async () => {
  const m = mk();
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  // Exactly the pre-ALU behaviour (see 04-think): multi-part rewrite, no ALU.
  assert.equal(await m.respondText("ice fire"), "cold hot");
  await m.store.close();
});

// ── 8. Disabling the ALU restores exact pre-ALU behaviour ────────────────

test("alu.enabled=false makes computation inert", async () => {
  const m = new Mind({
    seed: 7,
    alu: { enabled: false },
  });
  // No arithmetic learnt and the ALU off → the query is not grounded as "4";
  // it falls through to the resonant path (never the computed answer).
  const r = await m.respondText("2+2");
  assert.notEqual(r, "4");
  await m.store.close();
});

// ── 9. Determinism (same seed/training → same answer) ────────────────────

test("computation is deterministic", async () => {
  const run = async () => {
    const m = mk();
    const r = await m.respondText("12+30");
    await m.store.close();
    return r;
  };
  assert.equal(await run(), await run());
});
