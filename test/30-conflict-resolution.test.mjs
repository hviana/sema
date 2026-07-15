// 30-conflict-resolution.test.mjs — distributional-evidence disambiguation
// for conflicting continuations (chooseNext).
//
// When a context node has MULTIPLE learnt continuations (e.g. the same question
// was answered differently across training samples), chooseNext resolves the
// conflict by comparing each candidate's distributional evidence: the number of
// distinct contexts that predict it (prevOf count).  This is the structural
// manifestation of the candidate's halo — each prevOf entry corresponds to a
// context whose signature was poured into the candidate's halo via pourHalo
// during ingestPair.
//
// A candidate predicted by more distinct contexts carries stronger support and
// wins regardless of insertion order.  When evidence is equal, first-inserted
// wins (backward compatible — insertion order is the correct default for equal
// support).  The gist-cosine comparison is NOT consulted here because for short
// answer candidates it is dominated by accidental byte-pattern correlations.
//
// These assertions pin the behaviour so it cannot silently regress:
//   • a single continuation still works (the common case — no overhead);
//   • equal evidence keeps first-inserted (backward compatible);
//   • MORE distributional evidence overrides insertion order;
//   • the tiebreak is deterministic and seed-stable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// ── §1  Single continuation (the common case — must not regress) ─────────────

test("single continuation: unchanged", async () => {
  const m = new Mind({ seed: 7 });
  await m.ingest([["fire", "hot"]]);
  assert.equal(await m.respondText("fire"), "hot");
});

test("single continuation with query wrapper", async () => {
  const m = new Mind({ seed: 7 });
  await m.ingest([["ice", "cold"]]);
  assert.equal(await m.respondText("the nature of ice is known"), "cold");
});

// ── §2  Equal evidence — first-inserted wins (backward compatible) ──────────

test("equal evidence: first-inserted wins", async () => {
  const m = new Mind({ seed: 7 });
  // Both continuations have exactly ONE prev context each — equal support.
  await m.ingest([["x", "first"]]);
  await m.ingest([["x", "second"]]);
  assert.equal(await m.respondText("x"), "first");
});

test("equal evidence, reversed insertion order", async () => {
  const m = new Mind({ seed: 7 });
  await m.ingest([["x", "second"]]);
  await m.ingest([["x", "first"]]);
  assert.equal(await m.respondText("x"), "second");
});

// ── §3  More distributional evidence overrides insertion order ───────────────

test("more corroborated answer wins despite being trained second", async () => {
  const m = new Mind({ seed: 7 });
  // Wrong answer, trained first — 1 context.
  await m.ingest([["a capital do Brasil é", "Rio de Janeiro"]]);
  // Correct answer, trained second — but 4 DISTINCT corroborating contexts.
  await m.ingest([["a capital do Brasil é", "Brasília"]]);
  await m.ingest([["qual a capital do Brasil?", "Brasília"]]);
  await m.ingest([["a capital brasileira é", "Brasília"]]);
  await m.ingest([["Brasil tem como capital", "Brasília"]]);

  assert.equal(await m.respondText("a capital do Brasil é"), "Brasília");
});

test("more corroborated answer wins with query wrapper", async () => {
  const m = new Mind({ seed: 7 });
  // The query must literally contain a trained context form so recognition
  // can find it — Sema's recognition is content-addressed, not semantic.
  await m.ingest([["speed of light is", "300 000 km/s"]]);
  await m.ingest([["speed of light is", "299 792 458 m/s"]]);
  await m.ingest([["light travels at", "299 792 458 m/s"]]);
  await m.ingest([["c equals", "299 792 458 m/s"]]);

  // "speed of light is" is a literal substring of this query.
  const r = await m.respondText("the speed of light is?");
  assert.ok(
    r.includes("299 792 458 m/s"),
    `expected answer to contain '299 792 458 m/s', got '${r}'`,
  );
});

test("corroboration from diverse formulations beats single-source wrong answer", async () => {
  const m = new Mind({ seed: 7 });
  // One source claims a wrong chemical symbol.
  await m.ingest([["water is", "Wo"]]);
  // Multiple diverse sources give the correct one.
  await m.ingest([["water is", "H2O"]]);
  await m.ingest([["the chemical formula for water is", "H2O"]]);
  await m.ingest([["water's molecular composition is", "H2O"]]);

  assert.equal(await m.respondText("water is"), "H2O");
});

// ── §4  Three-way conflict — most corroborated wins ─────────────────────────

test("three conflicting continuations: most evidenced wins", async () => {
  const m = new Mind({ seed: 7 });
  await m.ingest([["answer is", "alpha"]]); // 1 context
  await m.ingest([["answer is", "beta"]]); // 1 context
  await m.ingest([["answer is", "gamma"]]); // 1 context
  await m.ingest([["the answer is", "beta"]]); // +1 for beta
  await m.ingest([["correct answer is", "beta"]]); // +1 for beta
  await m.ingest([["desired answer is", "beta"]]); // +1 for beta

  // Beta: 4 prev contexts. Alpha: 1. Gamma: 1. Beta wins.
  assert.equal(await m.respondText("answer is"), "beta");
});

// ── §5  Single shared context, diverging answers ────────────────────────────

test("shared prefix with diverging continuations resolved by evidence", async () => {
  const m = new Mind({ seed: 7 });

  // "Paris is the capital of" has two continuations.  The wrong one (Germany)
  // slips in first with a single source.  The correct one (France) is
  // corroborated by multiple formulations that ALL predict "France".
  await m.ingest([["Paris is the capital of", "Germany"]]); // wrong, 1 source
  await m.ingest([["Paris is the capital of", "France"]]); // correct
  await m.ingest([["the capital of this country is", "France"]]); // corroboration
  await m.ingest([["which country has Paris? It is", "France"]]); // corroboration

  assert.equal(await m.respondText("Paris is the capital of"), "France");
});

// ── §6  Seed stability ──────────────────────────────────────────────────────

test("same result with different seeds", async () => {
  for (const seed of [7, 42, 123]) {
    const m = new Mind({ seed });
    await m.ingest([["color is", "red"]]);
    await m.ingest([["color is", "blue"]]);
    await m.ingest([["favorite color is", "blue"]]);
    await m.ingest([["preferred color is", "blue"]]);

    assert.equal(await m.respondText("color is"), "blue");
  }
});

// ── §7  Multi-hop chain with a conflicting intermediate node ────────────────

test("multi-hop chain with resolved conflict at intermediate node", async () => {
  const m = new Mind({ seed: 7 });

  // Wrong chain: A → wrong_intermediate
  await m.ingest([["start", "wrong middle"]]);
  // Correct chain: A → correct_intermediate → final_answer
  await m.ingest([["start", "correct middle"]]);
  await m.ingest([["correct middle", "final answer"]]);
  // Additional corroboration for the correct intermediate
  await m.ingest([["begin here", "correct middle"]]);
  await m.ingest([["the starting point is", "correct middle"]]);

  // Should follow the more corroborated intermediate to the final answer.
  const r = await m.respondText("start");
  assert.equal(r, "final answer");
});
