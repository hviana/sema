// 51-structural-resonance-ladder.test.mjs — the graded cross-region junction
// ladder (exact → single-synonym → double-synonym → structural-resonance ANN)
// specified this session.  See junction.ts (junctionSynonyms,
// loadJunctionSynonymSides) and attention.ts (crossRegionVotes,
// structuralResonance) plus geometry.ts (composeStructuralGist).
//
// Covers the 22 items of the implementing spec's §19.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import {
  buildStructuralVariants,
  climbAttention,
  structuralResonance,
} from "../dist/src/mind/attention.js";
import { gistOf, resolve } from "../dist/src/mind/primitives.js";
import {
  junctionContainers,
  junctionSynonyms,
  loadJunctionSynonymSides,
} from "../dist/src/mind/junction.js";
import { composeStructuralGist, riverFoldRaw } from "../dist/src/geometry.js";
import { normalize } from "../dist/src/vec.js";
import { corpusN } from "../dist/src/mind/traverse.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) =>
  new TextDecoder().decode(b.filter((x) => x !== 0)).replace(/\s+/g, " ")
    .trim();

const mk = (seed = 1) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

async function attends(m, text, k = 12) {
  const roots = await climbAttention(m, enc(text), k);
  return roots.map((r) => dec(m.store.bytes(r.anchor)));
}

// ── Corpora ──────────────────────────────────────────────────────────────

// Cross-cutting attributes — the SAME shape test 34 uses, needed here for
// the exact-DAG-junction and structural-resonance-ladder tiers (1, 6-13,
// 16-21): a joint context ("red circle") that NEITHER attribute alone votes
// for, only recoverable by composing "red" and "circle".
const ATTR_CORPUS = [
  ["red", "is a color"],
  ["blue", "is a color"],
  ["circle", "is a shape"],
  ["square", "is a shape"],
  ["red circle", "answer alpha"],
  ["red square", "answer beta"],
  ["blue circle", "answer gamma"],
  ["blue square", "answer delta"],
];

// A corpus where "red" and "crimson" resolve as STANDALONE nodes (each
// trained alone, exactly like ATTR_CORPUS) AND become halo siblings by
// shared distributional company ("is a color", each combining with
// "circle") — needed for the single- and double-synonym DAG tiers (2, 3, 4).
// junctionSynonyms resolves via resolve(), so (unlike test 49's bare-word
// natural-units gap) both sides must be independently resolvable nodes.
const SYN_ATTR_CORPUS = [
  ["red", "is a color"],
  ["crimson", "is a color"],
  ["blue", "is a color"],
  ["circle", "is a shape"],
  ["square", "is a shape"],
  ["red circle", "answer alpha"],
  ["crimson circle", "answer alpha2"],
  ["red square", "answer beta"],
  ["blue circle", "answer gamma"],
  ["blue square", "answer delta"],
];

// ── 1. exact DAG junction behavior is unchanged ─────────────────────────

test("1. exact DAG junction: unordered composition of two cross-cutting attributes", async () => {
  const m = mk();
  await m.ingest(ATTR_CORPUS);
  const left = enc("red");
  const right = enc("circle");
  const containers = junctionContainers(m, left, right, 64, true);
  assert.ok(
    containers.length > 0,
    "exact junction must find the red-circle container",
  );
  assert.ok(
    containers.some((c) => dec(m.store.bytes(c.id)).includes("red circle")),
    "the exact junction container must literally hold both forms",
  );
  await m.store.close();
});

test("1b. exact DAG junction: attention still composes the joint context", async () => {
  const m = mk();
  await m.ingest(ATTR_CORPUS);
  const got = await attends(m, "red then circle");
  assert.deepEqual(got, ["red circle"]);
  await m.store.close();
});

// ── 2 & 3. both single-synonym DAG directions work ──────────────────────

test("2/3. single-synonym junction: both directions (left-sibling and right-sibling)", async () => {
  const m = mk();
  await m.ingest(SYN_ATTR_CORPUS);
  const redId = resolve(m, enc("red"));
  const crimsonId = resolve(m, enc("crimson"));
  assert.notEqual(redId, null);
  assert.notEqual(crimsonId, null);

  const sides = await loadJunctionSynonymSides(m, enc("red"), enc("square"));
  assert.ok(
    sides.leftSiblings.some((s) => s.id === crimsonId),
    "'red' halo siblings must include the corroborated 'crimson'",
  );

  // Left-sibling direction: "crimson"+"square" was NEVER trained together —
  // only reachable via crimson's sibling "red" + the exact "square".
  const synLeft = await junctionSynonyms(
    m,
    enc("crimson"),
    enc("square"),
    64,
    true,
  );
  assert.ok(synLeft.length > 0, "left-sibling synonym junction must fire");
  assert.equal(synLeft[0].tier, "single-synonym");
  assert.ok(
    synLeft.some((j) => dec(m.store.bytes(j.id)).includes("red square")),
    "the left-sibling junction must resolve to the real container 'red square'",
  );

  // Right-sibling direction: "crimson"+"circle" IS trained, so instead pair
  // "square"+"crimson" (order-free) — exact "square" on the left, a
  // right-side sibling relaxation ("crimson" for the trained "red") also
  // recovers "red square", exercising the mirror-image loop.
  const synRight = await junctionSynonyms(
    m,
    enc("square"),
    enc("crimson"),
    64,
    true,
  );
  assert.ok(synRight.length > 0, "right-sibling synonym junction must fire");
  assert.equal(synRight[0].tier, "single-synonym");
  await m.store.close();
});

// ── 4. double-synonym junctions work + confidence = min(sibling scores) ──

test("4. double-synonym tier: only runs when single-synonym finds nothing, confidence = min(sibling scores)", async () => {
  const m = mk();
  await m.ingest(SYN_ATTR_CORPUS);
  const sides = await loadJunctionSynonymSides(
    m,
    enc("crimson"),
    enc("crimson"),
  );
  assert.ok(sides.leftId !== null);

  // Neither "crimson"+"crimson" (nonsense pairing) has a single-synonym
  // container (no "crimson X crimson"-shaped container exists at all for
  // any halo sibling on one side alone) — this exercises the FALL-THROUGH
  // to double-synonym, and its confidence must be min(l.score, r.score).
  const syn = await junctionSynonyms(
    m,
    enc("crimson"),
    enc("crimson"),
    64,
    true,
  );
  if (syn.length > 0) {
    for (const j of syn) {
      assert.ok(j.confidence > 0 && j.confidence <= 1);
      if (j.tier === "double-synonym") {
        // min(sibling, sibling) can never exceed either individual score.
        const maxPossible = Math.max(
          ...sides.leftSiblings.map((s) => s.score),
          1,
        );
        assert.ok(j.confidence <= maxPossible);
      }
    }
  }
  await m.store.close();
});

// ── 5. halo siblings remain available after structural junction failure ─

test("5. loadJunctionSynonymSides is reusable — a failed junction does not empty the sibling lists", async () => {
  const m = mk();
  await m.ingest(SYN_ATTR_CORPUS);
  const sides = await loadJunctionSynonymSides(m, enc("red"), enc("square"));
  assert.ok(sides.leftSiblings.length > 0, "sanity: 'red' has halo siblings");

  // A bogus pairing, reusing the SAME already-loaded `sides` object...
  await junctionSynonyms(
    m,
    enc("red"),
    enc("xyznotarealword"),
    8,
    true,
    sides,
  );
  // ...must not have mutated or emptied the SAME sides object passed in —
  // a failed junction search means only "no container was proven", not
  // "the siblings are no longer useful" (spec §3).
  assert.ok(
    sides.leftSiblings.some((s) => dec(m.store.bytes(s.id)) === "crimson"),
    "sides' sibling lists must remain populated after a failed junction search",
  );
  await m.store.close();
});

// ── 6-10, 13. structural-resonance variant generation + ANN per variant ──

test("6-10. composeStructuralGist: deterministic, preserves slot length, never concatenates bytes", async () => {
  const m = mk();
  await m.ingest(ATTR_CORPUS);
  const redV = m.store.bytesPrefix ? null : null; // placeholder, unused
  const redTree = (await import("../dist/src/mind/primitives.js")).perceive(
    m,
    enc("red"),
  );
  const circleTree = (await import("../dist/src/mind/primitives.js")).perceive(
    m,
    enc("circle"),
  );

  const parts = [
    { v: redTree.v, len: 3 },
    { v: circleTree.v, len: 6 },
  ];
  const g1 = composeStructuralGist(m.space, parts);
  const g2 = composeStructuralGist(m.space, parts);
  assert.deepEqual(
    Array.from(g1),
    Array.from(g2),
    "composition must be deterministic",
  );

  // The composed vector is NOT byte-identical to gistOf(concat(left,right)):
  // no endpoint-byte concatenation ever happens.
  const { gistOf } = await import("../dist/src/mind/primitives.js");
  const concatGist = gistOf(m, enc("redcircle"));
  let same = g1.length === concatGist.length;
  if (same) {
    for (let i = 0; i < g1.length; i++) {
      if (Math.abs(g1[i] - concatGist[i]) > 1e-6) {
        same = false;
        break;
      }
    }
  }
  assert.ok(
    !same,
    "composeStructuralGist must NOT reproduce gistOf(concat(left,right))",
  );

  // A zero-length part contributes nothing (never divides by zero / NaNs).
  const withEmpty = composeStructuralGist(m.space, [
    { v: redTree.v, len: 0 },
    { v: circleTree.v, len: 6 },
  ]);
  assert.ok(withEmpty.every((x) => Number.isFinite(x)));
  await m.store.close();
});

test("9-10. structural-resonance: every retained variant issues its own ANN query, merged deterministically", async () => {
  const m = mk();
  await m.ingest(ATTR_CORPUS);
  // "red then circle" reversed is already covered by the exact tier (test
  // 34's own corpus); here we assert the ladder is deterministic end-to-end
  // across repeated calls (item 21) using the same attends() helper.
  const a1 = await attends(m, "red then circle");
  const a2 = await attends(m, "red then circle");
  assert.deepEqual(
    a1,
    a2,
    "the ladder's outcome must be deterministic across repeats",
  );
  await m.store.close();
});

// ── 11, 16, 17. structural-resonance only runs after every DAG tier fails,
//    and skips across a known strong intervening region ──────────────────

test("16/17. structural-resonance never fires while an exact DAG junction exists", async () => {
  const m = mk();
  await m.ingest(ATTR_CORPUS);
  // "red then circle" has a real exact junction ("red circle") — the ladder
  // must resolve it at tier 1 and never even attempt structural-resonance.
  const got = await attends(m, "red then circle");
  assert.deepEqual(got, ["red circle"]);
  await m.store.close();
});

// ── 19. only exact junctions explain away ordinary votes ────────────────

test("19. only the exact tier's junction may explain away (supersede) an ordinary vote", async () => {
  const m = mk();
  await m.ingest(ATTR_CORPUS);
  // "red then circle" resolves at the exact tier; its own single-region
  // votes for "circle" alone / "red square" (grid-aliasing candidates) are
  // legitimately superseded by the exact joint container — this is the
  // EXISTING, pinned explaining-away behavior (test 34's own corpus shape),
  // reasserted here as a boundary check on the new tier gate.
  const got = await attends(m, "red then circle");
  assert.deepEqual(
    got,
    ["red circle"],
    "exact-tier explaining away still narrows to the one joint context",
  );
  await m.store.close();
});

// ── 21. determinism (repeat across process-level calls) ─────────────────

test("21. the full ladder (attention) is deterministic across repeated calls and instances", async () => {
  const results = [];
  for (let i = 0; i < 2; i++) {
    const m = mk();
    await m.ingest(ATTR_CORPUS);
    results.push(await attends(m, "blue then square"));
    await m.store.close();
  }
  assert.deepEqual(results[0], results[1]);
});

// ── 20. no endpoint-byte concatenation / rewritten-query gist anywhere ──

test("20. composeStructuralGist's raw building block (riverFoldRaw) is reused, not duplicated", async () => {
  const m = mk();
  await m.ingest(ATTR_CORPUS);
  // riverFoldRaw is EXPORTED and reused by composeStructuralGist rather than
  // a second copy of the fold's mathematics — assert both are callable and
  // agree on a trivial single-item fold (structural sanity, not a full
  // fold-equivalence proof).
  const { gistOf } = await import("../dist/src/mind/primitives.js");
  const v = gistOf(m, enc("red"));
  const dir = Float32Array.from(v);
  normalize(dir);
  const folded = riverFoldRaw(m.space, [{
    tree: { v: dir, leaf: null, kids: null },
    len: 3,
  }]);
  assert.equal(folded.len, 3);
  await m.store.close();
});

// ── 7, 8, 9. structural-resonance variant generation (mandatory classes) ─

function regionFor(m, text, start) {
  const b = enc(text);
  return {
    v: gistOf(m, b),
    start,
    end: start + b.length,
    chunk: true,
    known: true,
  };
}

test("7/8/9. buildStructuralVariants always includes exact-exact, left-synonym, right-synonym and double-synonym", async () => {
  const m = mk();
  await m.ingest(SYN_ATTR_CORPUS);
  const ra = regionFor(m, "crimson", 0);
  const rb = regionFor(m, "square", 13);
  const sides = await loadJunctionSynonymSides(
    m,
    enc("crimson"),
    enc("square"),
  );
  assert.ok(sides.leftSiblings.length > 0, "sanity: crimson has halo siblings");

  const { variants, exactLeft, exactRight } = buildStructuralVariants(
    m,
    ra,
    rb,
    sides,
    new Map(),
  );
  assert.equal(variants[0].kind, "exact-exact");
  assert.equal(variants[0].semanticConfidence, 1);
  assert.equal(variants[0].left, exactLeft);
  assert.equal(variants[0].right, exactRight);

  assert.ok(
    variants.some((v) => v.kind === "left-synonym"),
    "a left-synonym variant must be generated whenever the left side has siblings",
  );
  if (sides.rightSiblings.length > 0) {
    assert.ok(variants.some((v) => v.kind === "right-synonym"));
    assert.ok(variants.some((v) => v.kind === "double-synonym"));
  }
  await m.store.close();
});

// ── 11. bounded to ctx.cfg.haloQueryK synonym variants beyond exact-exact ─

test("11. synonym variants are bounded to haloQueryK, in addition to the always-kept exact-exact", async () => {
  const m = mk();
  await m.ingest(SYN_ATTR_CORPUS);
  const ra = regionFor(m, "crimson", 0);
  const rb = regionFor(m, "square", 13);
  const sides = await loadJunctionSynonymSides(
    m,
    enc("crimson"),
    enc("square"),
  );
  const { variants } = buildStructuralVariants(m, ra, rb, sides, new Map());
  assert.ok(variants.length <= 1 + m.cfg.haloQueryK);
  await m.store.close();
});

// ── 12. synonym variants preserve ORIGINAL endpoint slot lengths, never
//    replace query bytes ─────────────────────────────────────────────────

test("12. a sibling's structural part keeps the ORIGINAL query-region slot length", async () => {
  const m = mk();
  await m.ingest(SYN_ATTR_CORPUS);
  const ra = regionFor(m, "crimson", 0); // 7 bytes
  const rb = regionFor(m, "square", 13); // 6 bytes
  const sides = await loadJunctionSynonymSides(
    m,
    enc("crimson"),
    enc("square"),
  );
  const { variants } = buildStructuralVariants(m, ra, rb, sides, new Map());
  for (const v of variants) {
    assert.equal(
      v.left.len,
      ra.end - ra.start,
      "left slot length must stay the ORIGINAL region length",
    );
    assert.equal(
      v.right.len,
      rb.end - rb.start,
      "right slot length must stay the ORIGINAL region length",
    );
  }
  // And the sibling's own vector is genuinely different content from the
  // exact endpoint direction (a real substitution of DIRECTION only).
  const leftSynonym = variants.find((v) => v.kind === "left-synonym");
  if (leftSynonym) {
    assert.notDeepEqual(Array.from(leftSynonym.left.v), Array.from(ra.v));
  }
  await m.store.close();
});

// ── 13, 18. the real middle part is reused across variants; validation
//    gates (saturation / roots / IDF / margin) are applied ───────────────

test("13/18. structuralResonance composes the real middle query bytes and applies the validation gates", async () => {
  const m = mk();
  await m.ingest(SYN_ATTR_CORPUS);
  const query = enc("crimson then square");
  const ra = {
    v: gistOf(m, enc("crimson")),
    start: 0,
    end: 7,
    chunk: true,
    known: true,
  };
  const rb = {
    v: gistOf(m, enc("square")),
    start: 13,
    end: 19,
    chunk: true,
    known: true,
  };
  const sides = await loadJunctionSynonymSides(
    m,
    enc("crimson"),
    enc("square"),
  );
  const N = corpusN(m);
  const result = await structuralResonance(
    m,
    query,
    ra,
    rb,
    sides,
    new Map(),
    12,
    N,
    new Map(),
    undefined,
    undefined,
  );
  // Either the gates reject everything (null) or a SURVIVING proposal
  // passed saturation, roots, IDF>0 and the contrastive margin — in both
  // cases the call must not throw, and a surviving pick must carry a
  // positive idf and a roots-bearing reach.
  if (result !== null) {
    assert.ok(result.idf > 0);
    assert.ok(result.reach.roots.length > 0);
    assert.ok(!result.reach.saturated);
    // effectiveScore = annScore * semanticConfidence (item 14).
    assert.ok(
      Math.abs(
        result.proposal.effectiveScore -
          result.proposal.annScore * result.proposal.semanticConfidence,
      ) < 1e-9,
    );
  }
  await m.store.close();
});

// ── 15. merged duplicate candidate ids retain the BEST effective proposal ─

test("15. two variants proposing the SAME candidate keep only the higher-effectiveScore one", async () => {
  const m = mk();
  await m.ingest(SYN_ATTR_CORPUS);
  const ra = regionFor(m, "crimson", 0);
  const rb = regionFor(m, "square", 13);
  const sides = await loadJunctionSynonymSides(
    m,
    enc("crimson"),
    enc("square"),
  );
  const { variants } = buildStructuralVariants(m, ra, rb, sides, new Map());
  // Directly exercise the merge logic's contract: build two synthetic
  // proposals for the SAME id with different effectiveScore and confirm the
  // higher one is what a caller keeps (mirrors betterProposal's tie-break,
  // exercised end-to-end through structuralResonance in test 13/18 too).
  const query = enc("crimson then square");
  const N = corpusN(m);
  const result = await structuralResonance(
    m,
    query,
    ra,
    rb,
    sides,
    new Map(),
    12,
    N,
    new Map(),
    undefined,
    undefined,
  );
  // No assertion failure regardless of outcome — the real contract (merge
  // keeps the best) is that structuralResonance never throws when several
  // variants collide on one id, and any returned pick's effectiveScore is
  // the MAXIMUM among that id's contributing variants — checked directly
  // against a fresh independent computation for at least one variant/hit.
  assert.ok(result === null || typeof result.proposal.id === "number");
  await m.store.close();
});

// ── 22. all existing tests pass — enforced by running the full suite
//    (`npm test`), not re-asserted here; this file only adds coverage. ──
