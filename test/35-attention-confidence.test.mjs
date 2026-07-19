// 35-attention-confidence.test.mjs — SCALE-INVARIANT CONFIDENCE for a point
// of attention (Attention.breadth).
//
// commitVotes always admits the DOMINANT root regardless of its IDF-weighted
// vote (attention.ts: "roots.length === 0 || ..." — the first root is never
// floor-gated).  That is correct for the common case ("give me your best
// guess"), but it means a query's SOLE root can be either:
//
//   (a) genuine consensus — most of the query's own regions independently
//       corroborate it (a real fact, or a real cross-region binding), or
//   (b) a coincidental echo — ONE region's resonance happened to land
//       somewhere, with the rest of the query silent on it.
//
// The raw IDF vote cannot tell these apart: it is an ABSOLUTE quantity that
// scales with ln(corpus size), so the same vote means "strong" on a small
// store and "weak" on a large one (see the session's earlier finding: a
// genuine root on a 325K-context store scored BELOW its own consensus floor,
// while a spurious echo on a 15-fact store scored comfortably above its own —
// much smaller — floor).  A SCALE-INVARIANT measure is needed instead: what
// FRACTION of the query's own regions this root's evidence accounts for —
// the "N of M sub-regions voted" the rationale already reports, but read
// PER-ANCHOR instead of globally, and tested against the same half-dominance
// convention (`dominates`, part*2 > whole) the rest of the codebase already
// uses for every other "is this real signal or noise" decision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const enc = (s) => new TextEncoder().encode(s);
const mk = (seed) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

// ═══════════════════════════════════════════════════════════════════════════
// GENUINE CONSENSUS — a real cross-region binding (test/34's own corpus).
// Most of the query's regions agree on the joint context; breadth must
// DOMINATE (> half of the query's own regions corroborate it).
// ═══════════════════════════════════════════════════════════════════════════

const BINDING_CORPUS = [
  ["red", "is a color"],
  ["blue", "is a color"],
  ["circle", "is a shape"],
  ["square", "is a shape"],
  ["red circle", "answer alpha"],
  ["red square", "answer beta"],
  ["blue circle", "answer gamma"],
  ["blue square", "answer delta"],
];

test("breadth: a genuine cross-region binding dominates the query's regions", async () => {
  const m = mk(1);
  await m.ingest(BINDING_CORPUS);
  const roots = await m.climbAttention(enc("red then circle"), 24);
  assert.equal(roots.length, 1, "expected exactly one committed root");
  assert.ok(
    typeof roots[0].breadth === "number",
    "Attention must carry a breadth field",
  );
  assert.ok(
    roots[0].breadth > 0.5,
    `genuine binding must dominate (> half the query's own regions), got breadth=${
      roots[0].breadth
    }`,
  );
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// SPURIOUS ECHO — a short arithmetic query whose consensus climb lands on an
// UNRELATED fact by coincidental byte-pattern resonance (observed directly
// this session: "2+2 equals what?" climbs to "1+1", not "2+2").  Only a
// minority of the query's regions support it; breadth must NOT dominate.
// ═══════════════════════════════════════════════════════════════════════════

const ARITH_CORPUS = [
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

test("breadth: a coincidental single-region echo does not dominate", async () => {
  const m = mk(1);
  await m.ingest(ARITH_CORPUS);
  const roots = await m.climbAttention(enc("2+2 equals what?"), 24);
  assert.equal(roots.length, 1, "expected exactly one committed root");
  assert.ok(
    typeof roots[0].breadth === "number",
    "Attention must carry a breadth field",
  );
  assert.ok(
    roots[0].breadth <= 0.5,
    `a coincidental echo must NOT dominate the query's own regions, got breadth=${
      roots[0].breadth
    }`,
  );
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// SCALE INVARIANCE — the whole point: the SAME breadth bar must separate
// signal from noise whether the corpus has 15 facts or many more, unlike the
// raw IDF vote (which is an absolute, ln(N)-scaled quantity — see the header
// comment).  Doubling the corpus (more unrelated arithmetic facts) must not
// flip either verdict merely by changing N.
// ═══════════════════════════════════════════════════════════════════════════

test("breadth: the same bar holds as the corpus grows (scale invariance)", async () => {
  const bigArith = [...ARITH_CORPUS];
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      bigArith.push([`${a}x${b}`, String(a * b)]);
    }
  }
  const m = mk(1);
  await m.ingest(bigArith);
  const roots = await m.climbAttention(enc("2+2 equals what?"), 24);
  assert.equal(roots.length, 1, "expected exactly one committed root");
  assert.ok(
    roots[0].breadth <= 0.5,
    `a coincidental echo must still not dominate on a larger corpus, got breadth=${
      roots[0].breadth
    }`,
  );
  await m.store.close();
});
