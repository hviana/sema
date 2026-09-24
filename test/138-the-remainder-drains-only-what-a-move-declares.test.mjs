// 138 — the remainder drains only on a declared move.
//
// THE TWO MEASUREMENTS THIS PINS, both taken against the built law:
//
//   a cycle re-offering the SAME product (no new structure, no declared move)
//   carried the question's own bytes, step after step, and closed the
//   derivation in TWO steps with `remainder: []` — a false closure, bought by
//   repetition.  Under the law as it stands the same cycle never closes, and its
//   remainder is untouched.
//
//   a step that MOVES (structure this derivation has not consumed) and declares
//   the span it accounts for drains exactly that span, and closes the
//   derivation when the question's material is spent — by the law, with no
//   mechanism outside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, admissible, closed } from "../dist/src/mind/derivation.js";

/** The question, in bytes: ten of them, one quantum being four. */
const QUERY = new TextEncoder().encode("ABCDEFGHIJ");
const W = 4;

const start = () => ({
  product: new Uint8Array(0),
  accounted: [],
  remainder: [[0, 10]],
  cost: 0,
});

test("138.1 a cycle cannot close the derivation by carrying the question's bytes", () => {
  let d = start();
  const t = { product: QUERY, contains: true, cost: 1 };
  for (let i = 0; i < 50 && !closed(d); i++) {
    const witness = admissible(d, t, QUERY, W);
    if (witness === null) break;
    d = advance(d, t, witness);
  }
  assert.equal(closed(d), false, "carrying question material is engagement, not progress");
  assert.deepEqual(d.remainder, [[0, 10]]);
});

test("138.2 a declared move drains what it accounts for and closes the derivation", () => {
  let d = start();
  for (let i = 0; i < 50 && !closed(d); i++) {
    const t = {
      product: QUERY,
      contains: true,
      moves: true,
      explains: [[i * W, (i + 1) * W]],
      cost: 1,
    };
    const witness = admissible(d, t, QUERY, W);
    if (witness === null) break;
    d = advance(d, t, witness);
  }
  assert.equal(closed(d), true, "the law closes it — no mechanism outside it");
});
