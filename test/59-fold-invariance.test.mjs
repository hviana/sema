// 59-fold-invariance.test.mjs — the fold's segmentation must be decided by
// CONTENT, not by a byte's absolute position.
//
// `riverFold` groups fixed arity from byte 0 and permutes item k by seats[k],
// k = index mod W.  Under that rule a byte's contribution — and therefore the
// subtree its content sits in — is a function of where it happens to fall, so
// the same content is a different node at a different offset.  Measured
// consequences before this changed: recognition's site set moved with the
// query's phase (period W); `What is the capital of France?` answered at pad
// 0, 1, 4 and went silent at 2, 3, 5, 6, 7; and at pad 3 `In which country is
// the Eiffel Tower?` answered with unrelated Malagasy text instead of
// abstaining.  Semantic identity must not depend on W at all.
//
// `contentBoundaries` decides cuts with a rolling hash, so a change upstream
// moves only the cut it falls inside.  These are the properties that buys, and
// they are cheap to lose by accident — capping the segment length at W, for
// instance, makes forced cuts dominate and silently restores the grid while
// LEAVING EVERY OTHER TEST GREEN (it was measured at 14.3%, exactly the grid,
// with the rest of the suite passing).  That is why invariance is asserted
// here as a number rather than left implicit.
//
// Floors are set well under the measured values so ordinary drift does not
// fail the suite, and far above the grid's 14.3% so a regression to positional
// segmentation cannot pass.  Measured at the time of writing:
//
//     deposit-like text     96.7% cuts held / 94.5% segments identical
//     non-Latin scripts     97.4% / 95.8%
//     random binary         98.6% / 97.4%
//     the arithmetic grid   14.3%   (only shifts of k ≡ 0 mod W survive)

import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToTree, contentBoundaries } from "../dist/src/geometry.js";
import { Alphabet } from "../dist/src/alphabet.js";
import { makeKeyring, rng } from "../dist/src/vec.js";

const D = 256;
const W = 4;
const mkSpace = () => ({
  D,
  seats: makeKeyring(D, Math.max(8, W), rng(1)),
  rand: rng(2),
  maxGroup: W,
});
const space = mkSpace();
const alphabet = new Alphabet(7, D, { roughness: 0.65, seedMask: 0xa1fa17 });
const enc = (s) => new TextEncoder().encode(s);

const SAMPLES = [
  "The Eiffel Tower is a wrought iron lattice tower located in Paris, France.",
  "What is the capital of France? The capital of France is Paris.",
  "Photosynthesis is the process by which plants convert light into energy.",
  "Was ist die Hauptstadt von Deutschland? Die Hauptstadt ist Berlin.",
  "Qual é a capital do Brasil? A capital do Brasil é Brasília.",
  "水は水素と酸素からできています。これは化学の基本です。",
];

const segmentsOf = (bytes) => {
  const edges = [0, ...contentBoundaries(space, bytes), bytes.length];
  const out = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    out.push(bytes.subarray(edges[i], edges[i + 1]));
  }
  return out;
};
const keyOf = (b) => Array.from(b).join(",");

/** Shift each sample by 1..2W bytes and measure how much of the segmentation
 *  downstream of the disturbance survives. */
function invariance(samples) {
  let cuts = 0, held = 0, segs = 0, segsHeld = 0;
  for (const bytes of samples) {
    const base = contentBoundaries(space, bytes);
    const baseSegs = new Set(segmentsOf(bytes).map(keyOf));
    for (let k = 1; k <= 2 * W; k++) {
      const padded = new Uint8Array(k + bytes.length);
      padded.set(enc(" ".repeat(k)));
      padded.set(bytes, k);
      const moved = new Set(contentBoundaries(space, padded));
      // Only cuts past the disturbed head are expected to survive.
      const expected = base.filter((c) => c > 2 * W).map((c) => c + k);
      cuts += expected.length;
      held += expected.filter((c) => moved.has(c)).length;
      // Segment identity, skipping the two segments covering the change.
      for (const s of segmentsOf(padded).slice(2)) {
        segs++;
        if (baseSegs.has(keyOf(s))) segsHeld++;
      }
    }
  }
  return { cutRatio: held / cuts, segRatio: segsHeld / segs };
}

test("content cuts survive a byte shift; the arithmetic grid does not", () => {
  const { cutRatio, segRatio } = invariance(SAMPLES.map(enc));
  assert.ok(
    cutRatio >= 0.85,
    `downstream cuts held ${
      (cutRatio * 100).toFixed(1)
    }% — below the 85% floor; ` +
      `at 14.3% the fold has degenerated to the arithmetic grid`,
  );
  assert.ok(
    segRatio >= 0.8,
    `segments byte-identical ${
      (segRatio * 100).toFixed(1)
    }% — below the 80% floor`,
  );

  // The grid, same corpus, as the control this floor is meaningful against.
  const gridCuts = (b) => {
    const out = [];
    for (let i = W; i < b.length; i += W) out.push(i);
    return out;
  };
  let gCuts = 0, gHeld = 0;
  for (const bytes of SAMPLES.map(enc)) {
    const base = gridCuts(bytes);
    for (let k = 1; k <= 2 * W; k++) {
      const padded = new Uint8Array(k + bytes.length);
      padded.set(bytes, k);
      const moved = new Set(gridCuts(padded));
      const expected = base.filter((c) => c > 2 * W).map((c) => c + k);
      gCuts += expected.length;
      gHeld += expected.filter((c) => moved.has(c)).length;
    }
  }
  const gridRatio = gHeld / gCuts;
  assert.ok(
    gridRatio < 0.3,
    `control: the grid should lose most cuts under a shift, got ${
      (gridRatio * 100).toFixed(1)
    }%`,
  );
  assert.ok(
    cutRatio > gridRatio * 2,
    `content cuts (${(cutRatio * 100).toFixed(1)}%) must beat the grid ` +
      `(${(gridRatio * 100).toFixed(1)}%) by a wide margin`,
  );
});

test("segmentation reads bytes, not text — random binary behaves like prose", () => {
  // Mind is not a text engine; the same fold carries grids and any other
  // modality.  A boundary rule that only worked on prose would be importing an
  // assumption the architecture rejects.
  let s = 12345;
  const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const binary = Array.from({ length: 40 }, () => {
    const n = 40 + Math.floor(rnd() * 300);
    return Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
  });
  const { cutRatio, segRatio } = invariance(binary);
  assert.ok(
    cutRatio >= 0.85,
    `random binary cuts held ${
      (cutRatio * 100).toFixed(1)
    }% — the rule must not depend on text`,
  );
  assert.ok(
    segRatio >= 0.8,
    `random binary segments ${(segRatio * 100).toFixed(1)}%`,
  );
});

test("segment lengths stay within the write side's declared unit scale", () => {
  // The minimum is W−1 (canonicalWindows' straddle neighbour, the write side's
  // own floor for a unit) and the maximum is the keyring's seat count, because
  // a segment folds as ONE flat node and `fold` has exactly that many seats.
  // A segment outside that range cannot be bound into seats at all.
  const maxLen = space.seats.length;
  for (const bytes of SAMPLES.map(enc)) {
    const segs = segmentsOf(bytes);
    for (const s of segs) {
      assert.ok(
        s.length <= maxLen,
        `segment of ${s.length} bytes exceeds the ${maxLen} available seats`,
      );
      assert.ok(s.length >= 1, "empty segment");
    }
    assert.equal(
      segs.reduce((a, x) => a + x.length, 0),
      bytes.length,
      "segments must tile the stream exactly",
    );
  }
});

test("the fold stays shallow — no left-nested spine", () => {
  // Joining segments left-nested costs a node per segment on ONE spine: at a
  // cut every ~6 bytes a 3 KB stream became a 450-deep chain of 450 fresh
  // D-vectors, ~1.8 MB for a single deposit, and every walker above inherited
  // the depth.  Grouping recurses by cut LEVEL instead, so depth stays
  // logarithmic in the stream length.
  const base = "The Eiffel Tower is a wrought iron lattice tower in Paris. ";
  for (const reps of [1, 8, 40]) {
    const bytes = enc(base.repeat(reps));
    const tree = bytesToTree(space, alphabet, bytes);
    let depth = 0, nodes = 0;
    const stack = [[tree, 1]];
    while (stack.length) {
      const [n, d] = stack.pop();
      nodes++;
      if (d > depth) depth = d;
      if (n.kids !== null) { for (const k of n.kids) stack.push([k, d + 1]); }
    }
    // Generous: 4x the ideal log_W depth still catches a linear spine by an
    // enormous margin (a 2.3 KB stream would spine to ~400).
    const ideal = Math.ceil(Math.log(bytes.length) / Math.log(W));
    assert.ok(
      depth <= ideal * 4,
      `depth ${depth} over ${bytes.length} bytes (river ideal ~${ideal}) — a spine, not a tree`,
    );
    assert.ok(
      nodes < bytes.length * 2,
      `${nodes} nodes for ${bytes.length} bytes — the fold should not multiply nodes`,
    );
  }
});

test("the fold is deterministic — identical bytes, identical cuts", () => {
  for (const bytes of SAMPLES.map(enc)) {
    const a = contentBoundaries(space, bytes);
    const b = contentBoundaries(mkSpace(), Uint8Array.from(bytes));
    assert.deepEqual(a, b, "the same bytes must always cut the same way");
  }
});
