// 146-the-contains-gate.test.mjs — `contains`, the one gate no producer ever closes.
//
// WHAT IS PINNED.  The formula above `admissible` is written with CONTAINS as a term, and the
// engine's three producers all declare it true (measured: the only `contains:` literals in src/
// are reasoning.ts's absorb, pivot and fusion — all constants).  So the gate cannot reject
// anything today, and this file makes that state explicit rather than accidental:
//
//   • the clause WORKS when it is told false — the law is not ignoring the field;
//   • and a layer that wants to END a walk does it by offering nothing (`null`), not by declaring
//     a step that is not a continuation.
//
// The second half is the contract; the first is the proof that the field is real.  A gate that
// neither fires nor is exercised is indistinguishable from a field that was forgotten.

import { test } from "node:test";
import assert from "node:assert/strict";
import { admissible } from "../dist/src/mind/derivation.js";

const QUERY = new TextEncoder().encode("ABCDEFGHIJ");
const W = 4;
const state = () => ({
  product: new Uint8Array(0),
  accounted: [],
  remainder: [[0, 10]],
  cost: 0,
});

test("146.1 the contains clause refuses when it is told false", () => {
  const admits = {
    product: new TextEncoder().encode("ZZZZABCDZZ"),
    contains: true,
    cost: 1,
  };
  assert.notEqual(
    admissible(state(), admits, QUERY, W),
    null,
    "with contains true and a window held, the law admits",
  );
  assert.equal(
    admissible(state(), { ...admits, contains: false }, QUERY, W),
    null,
    "with contains false the law refuses, whatever else the step carries — " +
      "so the field is read, not decorative",
  );
});

test("146.2 contains false is not how a walk ends", async () => {
  // The contract's own words, in the law's doc: a layer ends a walk by offering
  // nothing.  A step that declares itself not-a-continuation is refused, which is
  // what makes the declaration meaningful rather than a way to stop silently.
  const step = {
    product: new TextEncoder().encode("ZZZZABCDZZ"),
    contains: true,
    reaches: true,
    cost: 1,
  };
  assert.notEqual(
    admissible(state(), step, QUERY, W),
    null,
    "a declared move is admitted",
  );
  assert.equal(
    admissible(state(), { ...step, contains: false }, QUERY, W),
    null,
    "and the same move with contains false is refused — the claim gates everything",
  );
});
