// 64-two-ended-thresholds.test.mjs — changing the coordinate frame must not
// silently retune the geometry's statistical and structural decision bars.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimatorNoise,
  identityBar,
  mergeThreshold,
  reachThreshold,
  significanceBar,
} from "../dist/src/geometry.js";
import { fold } from "../dist/src/sema.js";
import { cosine, makeKeyring, randomUnit, rng } from "../dist/src/vec.js";

const D = 1024;
const W = 4;
const space = {
  D,
  seats: makeKeyring(D, 8, rng(1)),
  rand: rng(2),
  maxGroup: W,
};

const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

test("the two-ended coordinate frame preserves the one-child overlap law", () => {
  const rand = rng(991);
  const replacements = [];
  const unrelated = [];

  for (let trial = 0; trial < 128; trial++) {
    const original = Array.from({ length: W }, () => randomUnit(D, rand));
    const changed = original.slice();
    changed[trial % W] = randomUnit(D, rand);
    const other = Array.from({ length: W }, () => randomUnit(D, rand));

    replacements.push(cosine(fold(space, original), fold(space, changed)));
    unrelated.push(cosine(fold(space, original), fold(space, other)));
  }

  const oneChildOverlap = 1 - 1 / W;
  assert.ok(
    Math.abs(mean(replacements) - oneChildOverlap) < estimatorNoise(D),
    "renaming seats must preserve the expected 1 - 1/W overlap",
  );
  assert.ok(
    replacements.every((score) => score < reachThreshold(W)),
    "reach must remain stricter than replacing one complete child",
  );
  assert.ok(
    Math.abs(mean(unrelated)) < estimatorNoise(D),
    "unrelated folds must remain centred on zero",
  );
  assert.ok(
    unrelated.every((score) => Math.abs(score) < significanceBar(D)),
    "the seeded unrelated sample must remain inside the 3-sigma noise band",
  );
});

test("identity, reach, and significance remain derived laws", () => {
  assert.equal(mergeThreshold(D), 1 - 1 / Math.sqrt(D));
  assert.equal(reachThreshold(W), 1 - 1 / (2 * W));
  assert.equal(significanceBar(D), 3 / Math.sqrt(D));
  assert.equal(
    identityBar(D, W, 64),
    Math.max(mergeThreshold(D), 1 - W / 64),
  );

  const rand = rng(1234);
  const children = Array.from({ length: W }, () => randomUnit(D, rand));
  assert.ok(
    cosine(fold(space, children), fold(space, children)) >= mergeThreshold(D),
    "an identical structural form must still clear the identity floor",
  );
});
