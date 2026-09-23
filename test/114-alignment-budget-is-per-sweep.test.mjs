// 114-alignment-budget-is-per-sweep.test.mjs — each alignment sweep owns its
// budget, so the NEAREST continuation survives either side's exhaustion.
//
// THE DEFECT THIS CLOSES (found by an adversarial review of the E3 commit).
// `alignAround` bounds the work it may spend on (queryGap, contextGap) pairs.
// The counter was shared between the RIGHT sweep and the LEFT sweep, so once the
// right side spent the whole budget the left loop's guard was false on entry:
// zero iterations, and the NEAREST left continuation was lost — the exact
// opposite of the law the commit states ("an exhausted budget drops the FAR
// continuations and never the near ones").  It was a regression against the
// pre-change tree, which bounded each sweep independently.
//
// WHAT IS PINNED, structurally and with no magic number: a pair whose two
// divergent flanks both exceed the work budget still aligns on BOTH sides of the
// anchor — the left match is present as its own query span, and so is the right.
// Before the fix the left one is missing, whatever the budget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { alignAround } from "../dist/src/mind/match.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The minimal context `alignAround` reads: `space.maxGroup`, `cfg.alignGapPairs`. */
const ctxWith = (gapPairs) => ({
  space: { maxGroup: 4 },
  cfg: { alignGapPairs: gapPairs },
});

/** A shared head, a shared anchor, and divergent flanks on both sides. */
function pair(flankLen) {
  const q = `MATCH${"a".repeat(6)}SEED${"Q".repeat(flankLen)}`;
  const c = `MATCH${"b".repeat(11)}SEED${"W".repeat(flankLen)}`;
  return { q, c, at: q.indexOf("SEED") };
}

const spansOf = (res, text, needle) => {
  const target = enc.encode(needle);
  return res.matched.filter(([s, e]) => {
    const got = enc.encode(text).subarray(s, e);
    return got.length >= target.length &&
      dec.decode(got).includes(needle);
  });
};

test("both sides of the anchor align even when each flank exceeds the budget", () => {
  // The budget must be reachable for the NEAR left continuation (its own
  // 6+11-byte gap costs on the order of a hundred pair-explorations) and must be
  // EXHAUSTED by the right flank (40x40 divergent bytes cost many hundreds).
  // 512 sits between the two: it is the range where a shared counter starves the
  // left sweep and a per-sweep one does not.
  const { q, c, at } = pair(40);
  for (const budget of [512, 4096]) {
    const res = alignAround(ctxWith(budget), enc.encode(q), enc.encode(c), at, at);
    assert.ok(
      spansOf(res, q, "MATCH").length > 0,
      `the nearest LEFT continuation must survive the right sweep's budget ` +
        `(budget ${budget}, matched ${JSON.stringify(res.matched)})`,
    );
    assert.ok(
      spansOf(res, q, "SEED").length > 0,
      "and the anchor itself is of course still matched",
    );
  }
});

test("an ample budget finds the same spans as a tight one", () => {
  const { q, c, at } = pair(40);
  const tight = alignAround(ctxWith(512), enc.encode(q), enc.encode(c), at, at);
  const ample = alignAround(ctxWith(1_000_000), enc.encode(q), enc.encode(c), at, at);
  for (const side of ["MATCH", "SEED"]) {
    assert.equal(
      spansOf(tight, q, side).length,
      spansOf(ample, q, side).length,
      `${side} must not depend on how much budget the OTHER sweep spent`,
    );
  }
});
