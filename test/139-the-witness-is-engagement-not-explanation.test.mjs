// 139 — the witness is ENGAGEMENT, not EXPLANATION.
//
// The law admits a transition on CARRIES when the product holds a window of the
// question's material.  Both directions are measured here, because they are what
// settles the witness's role:
//
//   a product that HOLDS the window answers nothing — "ZZZZABCDZZ" carries the
//   question's bytes and says nothing about the question.  The law admits it.
//
//   a product that ANSWERS without holding the window — the answer's own words,
//   none of them the question's — carries nothing, and the law refuses it on that
//   ground.  A step of that kind must arrive by MOVES, or not at all.
//
// That asymmetry is why the question's remainder cannot drain on CARRIES: a
// window of the question is held by any repetition, whether or not anything was
// ever answered, so consuming it would buy closure with repetition.  It drains on
// a declared MOVE instead (test/138).

import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, carries, closed } from "../dist/src/mind/derivation.js";

const QUERY = new TextEncoder().encode("ABCDEFGHIJ");
const W = 4;
const REMAINDER = [[0, 10]];

test("139.1 holding the question's window admits the step, and answers nothing", () => {
  const product = new TextEncoder().encode("ZZZZABCDZZ");
  const witness = carries(REMAINDER, product, QUERY, W);
  assert.notEqual(witness, null, "the window is held");
  assert.deepEqual(witness, [{ span: [0, 10], window: [0, 4] }]);
  // The law takes the step — and the question is no better answered for it, so
  // the remainder is untouched.
  const after = advance(
    {
      product: new Uint8Array(0),
      accounted: [],
      remainder: REMAINDER,
      cost: 0,
    },
    { product, contains: true, cost: 1 },
    witness,
  );
  assert.deepEqual(after.remainder, REMAINDER);
  assert.equal(closed(after), false);
});

test("139.2 answering without holding the window carries nothing", () => {
  const answer = new TextEncoder().encode("Paris");
  assert.equal(carries(REMAINDER, answer, QUERY, W), null);
});
