// 147-the-witness-ladder.test.mjs — consumed ⊆ carried ⊆ accounted, non-vacuously.
//
// WHY THIS FILE EXISTS.  The audit's point 5 (E, partial) asks whether the accounting ever exceeds
// the window: the consumed window is where the remainder drains, the accounting registers the
// span, and `span != window` is the established reading.  Measured on the real corpus, the three
// counter families are ZERO on every roteiro question — the answers there come from grounding and
// derive-through, not from the reasoner's own extensions — and a ladder of zeroes proves nothing.
// So the ladder is pinned where the values cannot be zero: on a state built for the purpose.
//
// WHAT IS PINNED.  Given a step whose product carries a window of what is still owed:
//   • the law admits it and the witness carries a SPAN and a WINDOW (the two readings);
//   • the remainder shrinks by AT MOST the window — the consumed set is a subset of the carried one;
//   • and the accounting grows by AT LEAST the window — nothing consumed goes unaccounted.
// The sanity assertion is part of the pin: the window must be non-zero, or the two inequalities
// above hold for the wrong reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { admissible, advance } from "../dist/src/mind/derivation.js";

const QUERY = new TextEncoder().encode("ABCDEFGHIJ"); // W = 4 ⇒ one window is "ABCD"
const W = 4;
const bytesOf = (spans) => spans.reduce((n, [a, b]) => n + (b - a), 0);
const state = () => ({
  product: new Uint8Array(0),
  accounted: [],
  remainder: [[0, 10]],
  cost: 0,
});

test("147.1 consumed ⊆ carried ⊆ accounted, with a window that is not zero", () => {
  const step = {
    product: new TextEncoder().encode("ZZZZABCDZZ"),
    contains: true,
    cost: 1,
  };
  const before = state();
  const witnesses = admissible(before, step, QUERY, W);
  assert.notEqual(
    witnesses,
    null,
    "the law admits a step that carries a window",
  );

  const windows = witnesses.filter((x) => x.window !== undefined);
  assert.ok(
    windows.length > 0,
    "SANITY: at least one witness must carry a window, or the inequalities below are vacuous",
  );
  const windowBytes = windows.reduce(
    (n, x) => n + (x.window[1] - x.window[0]),
    0,
  );
  assert.ok(
    windowBytes > 0,
    `SANITY: the window must be non-zero (got ${windowBytes})`,
  );

  const after = advance(before, step, witnesses);
  const spanBytes = bytesOf(witnesses.map((x) => x.span));
  const drained = bytesOf(before.remainder) - bytesOf(after.remainder);
  const accounted = bytesOf(after.accounted) - bytesOf(before.accounted);

  assert.ok(
    drained <= windowBytes,
    `a step drains AT MOST what it carries: drained ${drained} > window ${windowBytes}`,
  );
  assert.ok(
    accounted >= windowBytes,
    `nothing consumed goes unaccounted: accounted ${accounted} < window ${windowBytes}`,
  );
  assert.ok(
    spanBytes > 0,
    "and the accounting is a span, which is why it may exceed the window",
  );
});
