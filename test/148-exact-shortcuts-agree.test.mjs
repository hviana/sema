// 148-exact-shortcuts-agree.test.mjs — two shortcuts that are EXACT, pinned
// against the definitions they shortcut.
//
// 148.1 THE SEGMENT PROBE DECIDES A MISS EXACTLY.  `exactNode` (primitives.ts)
//       answers "which stored node are these bytes?" without building the fold
//       when a level-0 content segment is not a stored flat branch: a fold
//       names a branch only when every child is named, and a segment is one
//       flat node over single-byte atoms.  So the answer must equal
//       `foldTree(perceive(bytes))` on EVERY span — hits, misses, edges — and
//       this walks every sub-span of real deposits and of noise to show it.
//
// 148.3 THE IDENTITY FOLD HAS THE VECTOR FOLD'S SHAPE.  `exactNode` names a
//       stream through `contentIdentity` (geometry.ts), which groups the same
//       way the vector fold does but reads an item's gist only where the shape
//       does — the eight coordinates `itemKey` hashes inside an over-long row —
//       and computes those lazily.  Pinned with an interning namer, so every
//       node is named and the two folds must agree on EVERY node of the tree,
//       over streams long and repetitive enough to force over-long rows (low
//       entropy keeps the cut levels flat, so the split falls to `itemKey`).
//
// 148.2 THE ASCII CANON IS THE UNICODE CANON.  `textCanon` takes a byte loop
//       for ASCII input instead of decode → NFKC → lowercase → regex → encode.
//       NFKC is the identity on ASCII and the regex's ASCII whitespace is
//       TAB..CR and SPACE, so the two must agree byte for byte; the reference
//       here is the general reading, spelled out, over random ASCII drawn from
//       an alphabet that is mostly whitespace and case.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { exactNode, foldTree, perceive } from "../dist/src/mind/primitives.js";
import { textCanon } from "../dist/src/canon.js";
import { bytesToTree, contentIdentity } from "../dist/src/geometry.js";

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

/** Deterministic generator — the suite forbids Math.random in fixtures. */
function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

test("148.1 exactNode agrees with the full fold on every sub-span", async () => {
  const mind = new Mind({
    seed: 3,
    store: new SQliteStore({ path: ":memory:" }),
  });
  const facts = [
    ["The director of Eva is Gustaf Molander.", "Gustaf Molander"],
    ["gustaf molander country", "The country of Gustaf Molander is Sweden."],
    ["What is the capital of France", "The capital of France is Paris"],
    ["ice", "cold"],
  ];
  await mind.ingest(facts);

  const rand = lcg(148);
  const noise = Array.from(
    { length: 6 },
    () =>
      Array.from(
        { length: 24 },
        () => "abcdefghij ETAOIN.,"[Math.floor(rand() * 19)],
      ).join(""),
  );
  const streams = [...facts.flat(), ...noise].map((t) => enc.encode(t));

  let hits = 0, misses = 0;
  for (const bytes of streams) {
    for (let a = 0; a < bytes.length; a++) {
      for (let b = a + 1; b <= bytes.length; b++) {
        const span = bytes.subarray(a, b);
        const full = foldTree(mind, perceive(mind, span), 0).node;
        assert.equal(
          exactNode(mind, span),
          full,
          `span "${
            dec.decode(span)
          }": the segment probe disagrees with the fold`,
        );
        if (full === null) misses++;
        else hits++;
      }
    }
  }
  // Non-vacuity: both outcomes must be exercised, or agreement proves nothing.
  assert.ok(hits > 50, `too few hits to pin the agreement (${hits})`);
  assert.ok(misses > 1000, `too few misses to pin the agreement (${misses})`);
  await mind.store.close();
});

test("148.2 the ASCII canon equals the Unicode canon, byte for byte", () => {
  const reference = (bytes) =>
    enc.encode(
      dec.decode(bytes).normalize("NFKC").toLowerCase().replace(
        /(\S)\s+(?=\S)/g,
        "$1 ",
      ),
    );
  // Mostly the characters the rule is about: every ASCII whitespace, both
  // cases, punctuation, plus the control bytes JS's \s does NOT include.
  const alphabet = [
    0x20,
    0x09,
    0x0a,
    0x0b,
    0x0c,
    0x0d,
    0x1c,
    0x1f,
    0x00,
    0x7f,
    ..."aZ.,'Q9 ".split("").map((c) => c.charCodeAt(0)),
  ];
  const rand = lcg(2);
  const cases = [
    "",
    " ",
    "  lead",
    "trail  ",
    "a  b\t\tc\n\nD",
    "\t\v\f\r",
    "ALL CAPS",
  ].map((t) => enc.encode(t));
  for (let i = 0; i < 4000; i++) {
    const n = Math.floor(rand() * 14);
    cases.push(
      Uint8Array.from(
        { length: n },
        () => alphabet[Math.floor(rand() * alphabet.length)],
      ),
    );
  }
  for (const c of cases) {
    assert.deepEqual(
      [...textCanon(c)],
      [...reference(c)],
      `canon of ${JSON.stringify(dec.decode(c))} diverged`,
    );
  }
});

test("148.3 the identity fold groups exactly as the vector fold", () => {
  const mind = new Mind({
    seed: 5,
    store: new SQliteStore({ path: ":memory:" }),
  });
  const ids = new Map();
  const intern = (key) => {
    let id = ids.get(key);
    if (id === undefined) ids.set(key, id = ids.size);
    return id;
  };
  const atoms = (bytes) => Array.from(bytes, (b) => -(b + 1)).join(",");
  /** foldTree's naming, over the vector fold's tree. */
  const name = (n) =>
    n.kids === null ? -(n.leaf[0] + 1) : intern(n.kids.map(name).join(","));
  const rand = lcg(1483);
  const alphabets = ["ab", "aab", "abc ", "0123456789", "the quick brown fox "];
  let streams = 0;
  for (const alpha of alphabets) {
    for (let t = 0; t < 40; t++) {
      const n = 2 + Math.floor(rand() * 1500);
      const bytes = Uint8Array.from(
        { length: n },
        () => alpha.charCodeAt(Math.floor(rand() * alpha.length)),
      );
      const viaVectors = name(bytesToTree(mind.space, mind.alphabet, bytes));
      const viaIdentity = contentIdentity(
        mind.space,
        mind.alphabet,
        bytes,
        (from, to) =>
          to - from === 1
            ? -(bytes[from] + 1)
            : intern(atoms(bytes.subarray(from, to))),
        (kids) => intern(kids.join(",")),
      );
      assert.equal(viaIdentity, viaVectors, `${alpha} stream of ${n} bytes`);
      streams++;
    }
  }
  assert.equal(streams, 200);
});
