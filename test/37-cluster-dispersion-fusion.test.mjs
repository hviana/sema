// 37-cluster-dispersion-fusion.test.mjs — Category B of the multi-turn
// garbling investigation: a further point of attention corroborated from
// only ONE local neighbourhood of the query must not be trusted to fuse in,
// regardless of how strong its vote is.
//
// Two measures were tried and falsified before this one:
//   - Attention.breadth (dominance-fraction) starves a genuine, evenly-split
//     multi-topic query — no root in a real N-way split can exceed half the
//     vote (test/24 gap 3.1).
//   - raw regionSupport (corroboration COUNT, summed) doesn't separate a
//     genuine topic from a coincidental echo either — a short, structurally
//     simple echo racks up as many corroborating regions as a real topic
//     does (test/35's arithmetic echo: 4 regions, the same range as gap
//     3.1's real topics: 5-6).
//
// Both are MAGNITUDE measures over the SAME span.  The live defect (traced
// directly against the trained store) was different in kind: an unrelated
// node.js answer got fused in because the query's own short closing phrase
// ("Thank you very much!") happened to be byte-identical to how ONE other,
// wholly unrelated training conversation also ended — a single coincidental
// match, corroborated from exactly ONE place in the query.  Compared
// against gap 3.1's two GENUINE topics, each of which is corroborated from
// TWO distinct, widely separated clusters of the query (verified directly:
// "Dream Team" from spans [80,96] and [132,148]; "gender equality" from
// [96,112] and [116,120] — the query's own SYS-scaffolding regions plus the
// topic's own distinctive wording, never just one).
//
// The discriminator is therefore not "how much" evidence but "how many
// separate PLACES in the query" corroborate it: cluster the contributing
// regions by merging any two whose gap is strictly less than one river-fold
// quantum W (ctx.space.maxGroup — the same quantum thinBar, identityBar and
// reachThreshold already derive from; never a new tuned number) and require
// at least 2 clusters.  Verified against the boundary case directly: gap
// 3.1's "gender equality" clusters are exactly W apart, and `gap < W`
// (strict) is what keeps them separate — `gap <= W` would collapse them
// into one and break the pinned gap-3.1 requirement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { fuseAttention } from "../dist/src/mind/reasoning.js";
import { gistOf } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) =>
  new TextDecoder().decode(b.filter((x) => x !== 0)).replace(/\s+/g, " ")
    .trim();

// A genuine cross-region binding (test/34's corpus) mixed with a
// coincidental arithmetic echo (test/35's corpus) in the SAME climb —
// reusing the exact same real anchors test/36 verified project to
// "answer alpha" and "2" respectively.  The echo root's `end` is widened
// past the full "2+2" expression below (a harmless adjustment to a
// synthetic Attention object we already fabricate) so Fix A's own
// already-answered scan does not trip over the SECOND "2" digit sitting
// immediately after the echo's single-byte match — an unrelated collision
// specific to this corpus, not the mechanism under test here.
const CORPUS = [
  ["red", "is a color"],
  ["blue", "is a color"],
  ["circle", "is a shape"],
  ["square", "is a shape"],
  ["red circle", "answer alpha"],
  ["red square", "answer beta"],
  ["blue circle", "answer gamma"],
  ["blue square", "answer delta"],
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

const mk = (seed) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

async function setup() {
  const m = mk(1);
  await m.ingest(CORPUS);
  const q = enc("red circle then 2+2 equals what");
  const roots = await m.climbAttention(q, 24);
  const binding = roots.find((r) => r.start === 0); // "red circle" [0,10)
  const echo = roots.find((r) => r.start === 16); // "1+1" [16,17)
  assert.ok(binding, "expected the 'red circle' binding root");
  assert.ok(echo, "expected the '1+1' echo root");
  const guide = gistOf(m, q);
  return { m, q, binding, echo, guide };
}

// The gate is an OR of two independent measures (verified against the full
// suite: a plain AND-only cluster requirement broke test/34's own joint
// binding, whose crossRegionVotes conclusion is pooled from a single
// synthetic region — one cluster by construction — despite already, by
// design, accounting for BOTH original query mentions; `breadth` already
// recognises that case correctly, since a genuine joint binding dominates
// the query on its own).  These three tests cover the three quadrants a
// root can land in; breadth is set explicitly (these are already fabricated
// synthetic Attention objects) so each quadrant is tested precisely rather
// than relying on incidental corpus values.

test("fuseAttention: 2 clusters, low breadth — dispersion alone is enough (gap 3.1's shape)", async () => {
  const { m, q, binding, echo, guide } = await setup();
  const primary = enc("PRIMARYANCHORTEXT");
  const dispersedLowBreadth = { ...binding, clusters: 2, breadth: 0.12 };
  const placeholder = {
    ...binding,
    start: q.length,
    end: q.length,
    clusters: 1,
    breadth: 0.12,
  };
  const pre = {
    attention: async () => ({
      roots: [placeholder, dispersedLowBreadth],
      ranked: [placeholder, dispersedLowBreadth],
    }),
    guide,
  };
  const out = dec(await fuseAttention(m, q, primary, pre));
  assert.equal(
    out,
    "answer alpha" + dec(primary),
    `2 clusters must fuse in even with low breadth, got "${out}"`,
  );
  await m.store.close();
});

test("fuseAttention: 1 cluster, dominant breadth — dominance alone is enough (test/34's joint-binding shape)", async () => {
  const { m, q, binding, guide } = await setup();
  const primary = enc("PRIMARYANCHORTEXT");
  const tightButDominant = { ...binding, clusters: 1, breadth: 0.857 };
  const placeholder = {
    ...binding,
    start: q.length,
    end: q.length,
    clusters: 1,
    breadth: 0.857,
  };
  const pre = {
    attention: async () => ({
      roots: [placeholder, tightButDominant],
      ranked: [placeholder, tightButDominant],
    }),
    guide,
  };
  const out = dec(await fuseAttention(m, q, primary, pre));
  assert.equal(
    out,
    "answer alpha" + dec(primary),
    `dominant breadth must fuse in even with 1 cluster, got "${out}"`,
  );
  await m.store.close();
});

test("fuseAttention: 1 cluster, low breadth — neither measure saves it (the live coincidental-echo shape)", async () => {
  const { m, q, echo, guide } = await setup();
  const primary = enc("PRIMARYANCHORTEXT");
  const tightAndWeak = {
    ...echo,
    end: echo.end + 2,
    clusters: 1,
    breadth: 0.211,
  };
  const placeholder = { ...tightAndWeak, start: q.length, end: q.length };
  const pre = {
    attention: async () => ({
      roots: [placeholder, tightAndWeak],
      ranked: [placeholder, tightAndWeak],
    }),
    guide,
  };
  const out = dec(await fuseAttention(m, q, primary, pre));
  assert.equal(
    out,
    dec(primary),
    `1 cluster AND low breadth must not fuse in, got "${out}"`,
  );
  await m.store.close();
});
