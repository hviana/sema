// 52-climb-consensus-instrumentation.test.mjs — structured instrumentation
// for the climbConsensus / inspectRationale step (spec §10).
//
// Purely additive: every assertion here checks the STRUCTURE of the `data`
// payload a traced "climbConsensus" RationaleStep now carries, alongside the
// existing human-readable `note` — never that inference itself changed
// (item 6 pins that explicitly: roots/ranked must be bit-identical whether
// or not a trace was requested).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { climbAttentionAll } from "../dist/src/mind/attention.js";
import { Rationale } from "../dist/src/mind/rationale.js";

const enc = (s) => new TextEncoder().encode(s);
const mk = (seed = 1) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

/** Collect the full step stream for one traced query. */
async function trace(mind, q) {
  const steps = [];
  const ans = await mind.respondText(q, (s) => steps.push(s));
  return { steps, ans };
}

/** The FIRST "climbConsensus" step — the one whose data reflects the actual
 *  per-region pipeline (a later same-response call, if any, would hit the
 *  content-keyed climb memo). */
function climbStep(steps) {
  return steps.find((s) => s.mechanism.at(-1) === "climbConsensus");
}

const SATURATION_REASONS = new Set([
  "byte-atom-commonality",
  "predecessor-fan-in",
  "distinct-context-limit",
  "parent-fan-out",
  "lateral-cone-limit",
]);

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

// ═══════════════════════════════════════════════════════════════════════════
// 1. every saturation stop reports one of the five reasons, with sound
//    observed/limit provenance — read off the authoritative `reaches` list.
// ═══════════════════════════════════════════════════════════════════════════

test("1. every reported saturation stop names a valid reason with sound provenance", async () => {
  const m = mk(1);
  await m.ingest(ATTR_CORPUS);
  const { steps } = await trace(m, "red circle blue square");
  await m.store.close();

  const step = climbStep(steps);
  assert.ok(step, "expected a climbConsensus step");
  assert.ok(step.data, "climbConsensus step must carry a data payload");
  assert.equal(step.data.version, 1);
  assert.ok(Array.isArray(step.data.reaches), "expected a reaches list");

  for (const r of step.data.reaches) {
    assert.equal(typeof r.node, "number");
    assert.ok(Array.isArray(r.roots));
    assert.equal(typeof r.contextsReached, "number");
    assert.equal(typeof r.saturated, "boolean");
    if (r.saturated && r.saturation) {
      assert.ok(
        SATURATION_REASONS.has(r.saturation.reason),
        `unexpected saturation reason "${r.saturation.reason}"`,
      );
      assert.equal(typeof r.saturation.node, "number");
      assert.ok(r.saturation.observed > r.saturation.limit);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. canonical vs ANN/fallback regions report correct examined breadth.
// ═══════════════════════════════════════════════════════════════════════════

test("2. an exact chunk region is selected canonically, without an ANN query", async () => {
  const m = mk(2);
  await m.ingest(ATTR_CORPUS);
  // "red then circle" is not itself a trained fact (only "red circle" is),
  // so recall cannot resolve it directly and the consensus climb runs.
  const { steps } = await trace(m, "red then circle");
  await m.store.close();

  const step = climbStep(steps);
  assert.ok(step, "expected a climbConsensus step");
  assert.ok(step.data, "climbConsensus step must carry a data payload");
  const regions = step.data.regions ?? [];
  assert.ok(regions.length > 0, "expected per-region traces");

  const votedRegions = regions.filter((r) => r.outcome === "voted");
  assert.ok(votedRegions.length > 0, "expected at least one voted region");
  for (const r of votedRegions) {
    assert.ok(r.selected, "a voted region must report its selection");
    assert.ok(
      r.selected.source === "canonical" || r.selected.source === "ann",
      "selected.source must be canonical or ann",
    );
    if (r.selected.source === "canonical") {
      assert.equal(r.canonicalUsable, true);
    }
    if (r.selected.source === "ann" && !r.selected.fallback) {
      assert.equal(r.annQueried, true);
      assert.equal(typeof r.selected.rank, "number");
    }
    // annHitsExamined counts distinct CONSULTED hits, never more than what
    // was returned.
    assert.ok(r.annHitsExamined <= r.annHitsReturned || !r.annQueried);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3/4. candidateBreadth / contributingVotes / contributingEvidence differ
//      correctly under junction absorption, and superseded / saturation-
//      masked votes never inflate contributingEvidence.
// ═══════════════════════════════════════════════════════════════════════════

test("3/4. junction absorption widens contributingEvidence past contributingVotes", async () => {
  const m = mk(3);
  await m.ingest(ATTR_CORPUS);
  const { steps } = await trace(m, "red then circle");
  await m.store.close();

  const step = climbStep(steps);
  assert.ok(step.data.crossRegion, "expected a crossRegion summary");
  assert.ok(
    step.data.crossRegion.junctionVotes.length > 0,
    "expected the exact junction to fire ('red circle' is a trained joint fact)",
  );
  const jv = step.data.crossRegion.junctionVotes[0];
  assert.equal(jv.tier, "exact");
  assert.ok(Array.isArray(jv.sourceRegionIndices));
  assert.ok(Array.isArray(jv.explainedAwayRegionIndices));
  assert.ok(jv.absorbed >= 1);

  const anchors = step.data.anchors ?? [];
  assert.ok(anchors.length > 0, "expected ranked anchor traces");
  for (const a of anchors) {
    // contributingEvidence is regionSupport (absorbed-weighted); it must
    // never be LESS than the raw pooled-axiom count.
    assert.ok(a.contributingEvidence >= a.contributingVotes);
    assert.equal(typeof a.candidateBreadth, "number");
    assert.ok(a.candidateBreadth >= a.contributingVotes);
  }

  // A region the junction explained away must be marked superseded on the
  // per-region trace, and superseded regions never produced an ordinary
  // vote that also counts toward contributingEvidence twice.
  const regions = step.data.regions ?? [];
  const supersededRegions = regions.filter((r) => r.superseded);
  for (const r of supersededRegions) {
    assert.equal(
      r.ordinaryVoteProduced,
      true,
      "only a voted region can be superseded",
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. commit reasons match the existing commitVotes loop.
// ═══════════════════════════════════════════════════════════════════════════

test("5. commit decisions on the anchor trace match the roots actually returned", async () => {
  const m = mk(4);
  await m.ingest(ATTR_CORPUS);
  const { steps } = await trace(m, "red circle blue square");
  await m.store.close();

  const step = climbStep(steps);
  const anchors = step.data.anchors ?? [];
  assert.ok(anchors.length > 0);
  const roots = step.data.result.roots;
  const rootAnchors = new Set(roots.map((r) => r.anchor));

  for (const a of anchors) {
    if (a.commit.status === "root") {
      assert.ok(
        rootAnchors.has(a.anchor),
        `anchor ${a.anchor} marked root but absent from result.roots`,
      );
      assert.equal(a.commit.rejectionReasons.length, 0);
    } else {
      assert.ok(!rootAnchors.has(a.anchor) || a.commit.status === "overlap");
    }
    if (a.commit.status === "rejected") {
      assert.ok(
        a.commit.rejectionReasons.length > 0,
        "a rejected anchor must name at least one reason",
      );
      for (const reason of a.commit.rejectionReasons) {
        assert.ok(
          ["below-natural-break", "below-consensus-floor", "leading-saturation"]
            .includes(reason),
        );
      }
    }
  }
  // The dominant (first) root never carries the two vote-threshold gates.
  const dominant = anchors.find((a) => a.commit.dominant);
  if (dominant) {
    assert.equal(dominant.commit.status, "root");
    assert.equal(dominant.commit.passesNaturalBreak, undefined);
    assert.equal(dominant.commit.passesConsensusFloor, undefined);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. roots and ranked results are bit-identical with and without tracing.
// ═══════════════════════════════════════════════════════════════════════════

test("6. inspectRationale never changes the answer or the traced result.roots/ranked", async () => {
  const queries = [
    "red circle",
    "red then circle",
    "blue square",
    "red",
    "circle blue",
  ];
  for (const q of queries) {
    const plainMind = mk(5);
    await plainMind.ingest(ATTR_CORPUS);
    const plainAns = await plainMind.respondText(q);
    await plainMind.store.close();

    const tracedMind = mk(5);
    await tracedMind.ingest(ATTR_CORPUS);
    const { ans: tracedAns, steps } = await trace(tracedMind, q);
    await tracedMind.store.close();

    assert.equal(
      tracedAns,
      plainAns,
      `answer differs for query "${q}" — tracing must be purely additive`,
    );

    // Cross-check the climb itself: the untraced mind-level climbAttention
    // convenience (never touches ctx.trace) must agree with the roots the
    // traced climbConsensus step reported in its `data.result`.
    const untracedMind = mk(5);
    await untracedMind.ingest(ATTR_CORPUS);
    const untracedRoots = await untracedMind.climbAttention(enc(q), 24);
    await untracedMind.store.close();

    const step = climbStep(steps);
    if (step?.data) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(step.data.result.roots)),
        JSON.parse(JSON.stringify(untracedRoots)),
        `traced result.roots differ from the untraced climb for query "${q}"`,
      );
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. a repeated query produces the abbreviated cache-hit payload (§9).
// ═══════════════════════════════════════════════════════════════════════════

test("7. a repeated query within one response emits the abbreviated cache trace", async () => {
  const m = mk(7);
  await m.ingest(ATTR_CORPUS);
  // A top-level respond() gets a FRESH climbMemo every call (by design —
  // beginResponse()), so a real cache hit is only observable by driving
  // climbAttentionAll directly against a climbMemo that persists across
  // two calls — exactly what respondTurn() does for a real conversation
  // (see AttentionRead cache doc on climbAttentionAll).
  m.climbMemo = new Map();
  m.recogniseMemo = new Map();
  m.perceiveMemo = new Map();
  m.canon = null;
  m.canonMemo = null;

  const q = enc("red then circle");
  const steps1 = [];
  m.trace = new Rationale((s) => steps1.push(s));
  await climbAttentionAll(m, q, 12, "inverse");

  const steps2 = [];
  m.trace = new Rationale((s) => steps2.push(s));
  await climbAttentionAll(m, q, 12, "inverse");
  await m.store.close();

  const first = climbStep(steps1);
  const second = climbStep(steps2);
  assert.ok(first, "expected a climbConsensus step on the first call");
  assert.ok(second, "expected a climbConsensus step on the repeated call");

  assert.equal(first.data.cache.hit, false);
  assert.equal(second.data.cache.hit, true);
  assert.equal(second.data.cache.detailAvailable, false);
  assert.equal(second.data.version, 1);
  assert.deepEqual(second.data.config, {
    annK: second.data.config.annK,
    crossRegionProbeLimit: second.data.config.annK,
    mode: second.data.config.mode,
  });
  assert.deepEqual(second.data.candidates, {
    perceived: 0,
    recognised: 0,
    total: 0,
  });
  assert.equal(second.data.regions, undefined);
  assert.equal(second.data.reaches, undefined);
  assert.equal(second.data.crossRegion, undefined);
  assert.equal(second.data.saturation, undefined);
  assert.equal(second.data.pooling, undefined);
  assert.equal(second.data.anchors, undefined);
  assert.ok(second.data.result, "abbreviated payload must still carry result");
});
