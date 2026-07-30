// 66-query-edge-whitespace.test.mjs — a query's leading/trailing whitespace is
// presentation, not part of the question, and must not decide whether a trained
// fact is reachable.
//
// canon.ts's contract: "a span's leading or trailing separator belongs BETWEEN
// forms, not to the form".  canon itself PRESERVES edge whitespace, and must,
// because the hazard it cites is a recognised SUB-span swallowing the boundary
// byte that separates it from its neighbour ("ice " matching the stored "ice").
// At the outer edges of a WHOLE input there is no neighbour, so that hazard
// cannot arise — which is why respond() may trim there and canon may not.
// test/44 already relies on the same reading for recognise()'s miss path.
//
// THE GAP THIS CLOSES (measured on the 15.7M-node trained store): ONE leading
// space took `Who wrote Romeo and Juliet?` and `What is the chemical symbol for
// water?` from answered to silent, because a shift re-seats every fold boundary
// (cos(query, query shifted 1 byte) = 0.68 against a 0.875 reach bar).  That was
// the whole of analyze_training.ts's K2 phase-robustness gap: 15/18 → 18/18.
//
// WHY A RETRY AND NOT A PRE-FILTER — the regression this file pins.  Trimming
// the query up front is ASYMMETRIC: it normalises the query but not the stored
// forms, so it breaks byte-exact identity for a form trained WITH edge
// whitespace.  Verified: pre-filtering broke test/04's ["  ice  ", "cold"] case.
// The exact bytes are therefore tried FIRST and the trim is reached only when
// they grounded nothing — which also means the retry costs nothing on any
// answering path.
//
// NOTE ON WHAT IS AND IS NOT TESTABLE HERE.  The padded-query WIN cannot be
// reproduced in a miniature fixture: a small store answers a padded query on the
// first pass anyway (an earlier tier catches it), so the retry never fires and
// an end-to-end assertion passes with or without the fix — verified, an earlier
// version of this file did exactly that and guarded nothing.  What a fixture CAN
// pin is the trim's own contract and the asymmetry regression, which is what
// these tests do; the win itself is evidenced on the real store.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { trimEdgeSeparators } from "../dist/src/bytes.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = new TextDecoder();
const trim = (s) => dec.decode(trimEdgeSeparators(enc(s)));

test("1. trimEdgeSeparators drops only the outer separator run", () => {
  assert.equal(trim("  ice  "), "ice");
  assert.equal(trim("\tice\n"), "ice");
  assert.equal(trim("ice"), "ice");
  // INTERIOR whitespace is content and is never touched.
  assert.equal(trim("  a  b  "), "a  b");
  // All-separator and empty inputs collapse to empty rather than throwing.
  assert.equal(trim("   "), "");
  assert.equal(trim(""), "");
  // The untouched case must return the SAME object (no copy on the hot path).
  const b = enc("ice");
  assert.equal(trimEdgeSeparators(b), b);
});

test("2. a form trained WITH edge whitespace still answers when asked exactly", async () => {
  // The asymmetry regression: trimming the query but not the store would make
  // this query miss its own deposited form.
  const m = new Mind({ seed: 7 });
  await m.ingest([["  ice  ", "cold"]]);
  assert.equal(await m.respondText("  ice  "), "cold");
});

test("3. whitespace-only and empty queries are silent, not errors", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([["what is ice?", "ice is frozen water"]]);
  for (const q of ["", " ", "   ", "\t\n"]) {
    assert.equal(
      await m.respondText(q),
      "",
      `expected silence for ${JSON.stringify(q)}`,
    );
  }
  await m.store.close();
});

test("4. a padded query never answers something the unpadded one would not", async () => {
  // The retry may add REACH, never licence: whatever padding does, it must not
  // ground a fact for a question the store cannot answer.
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["what is the capital of France?", "The capital of France is Paris."],
    ["what is the capital of Spain?", "Madrid is the capital of Spain."],
  ]);
  for (const q of ["  Who wrote the Iliad?  ", "  xyzzy plugh quux  "]) {
    const a = await m.respondText(q);
    assert.doesNotMatch(
      a,
      /Paris|Madrid/,
      `padding manufactured an answer for ${JSON.stringify(q)}: ${
        JSON.stringify(a)
      }`,
    );
  }
  await m.store.close();
});
