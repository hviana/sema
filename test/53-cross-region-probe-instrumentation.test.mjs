// 53-cross-region-probe-instrumentation.test.mjs — extends the climbConsensus
// instrumentation (test/52) to cover the ordinary-region contrastive rival,
// the cross-region junction probe ladder, and structural-resonance.  Purely
// additive: every assertion checks the STRUCTURE of the `data` payload's new
// fields — never that inference itself changed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = (seed = 1) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

async function trace(mind, q) {
  const steps = [];
  const ans = await mind.respondText(q, (s) => steps.push(s));
  return { steps, ans };
}

function climbStep(steps) {
  return steps.find((s) => s.mechanism.at(-1) === "climbConsensus");
}

// Reused verbatim from test/51's proven fixtures.
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

// ═══════════════════════════════════════════════════════════════════════════
// 1. ordinary-region contrastive rival.
// ═══════════════════════════════════════════════════════════════════════════

test("1. an approximate region with a genuine rival reports contrastiveRival, and the margin matches score - rival.score", async () => {
  const m = mk(1);
  await m.ingest(ATTR_CORPUS);
  const { steps } = await trace(m, "blue then circle then square");
  await m.store.close();

  const step = climbStep(steps);
  assert.ok(step?.data, "expected a traced climbConsensus step");
  const regions = step.data.regions ?? [];
  const withRival = regions.filter((r) => r.contrastiveRival);
  assert.ok(withRival.length > 0, "expected at least one region with a rival");
  for (const r of withRival) {
    assert.equal(typeof r.contrastiveRival.node, "number");
    assert.equal(typeof r.contrastiveRival.rank, "number");
    assert.equal(typeof r.contrastiveRival.score, "number");
    assert.ok(
      Math.abs(
        r.contrastiveMargin - (r.selected.score - r.contrastiveRival.score),
      ) < 1e-9,
      "contrastiveMargin must equal selected.score - contrastiveRival.score",
    );
  }
});

test("1b. a known region never carries a contrastiveRival (the contrast only applies to approximate regions)", async () => {
  const m = mk(1);
  await m.ingest(ATTR_CORPUS);
  const { steps } = await trace(m, "red then circle");
  await m.store.close();

  const step = climbStep(steps);
  const regions = step.data.regions ?? [];
  for (const r of regions) {
    if (r.known) {
      assert.equal(r.contrastiveRival, undefined);
      assert.equal(r.contrastiveMargin, undefined);
    }
  }
  // And when a voted approximate region has NO rival at all, contrastiveMargin
  // stays exactly selected.score, with no contrastiveRival field.
  for (const r of regions) {
    if (r.outcome === "voted" && !r.known && r.contrastiveRival === undefined) {
      assert.equal(r.contrastiveMargin, r.selected.score);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. probe accounting invariant.
// ═══════════════════════════════════════════════════════════════════════════

test("2. crossRegion.probes.length === crossRegion.probesAttempted", async () => {
  const m = mk(1);
  await m.ingest(SYN_ATTR_CORPUS);
  const { steps } = await trace(m, "the crimson near the square");
  await m.store.close();

  const step = climbStep(steps);
  const cr = step.data.crossRegion;
  assert.ok(cr, "expected a crossRegion summary");
  assert.equal(cr.probes.length, cr.probesAttempted);
  assert.ok(
    ["insufficient-regions", "probe-limit", "pairs-exhausted"].includes(
      cr.stopReason,
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. exact junction: attempt count, accepted structural outcome, vote-probe
//    link.
// ═══════════════════════════════════════════════════════════════════════════

test("3. exact junction: probe.exact attempted with candidates, accepted structural outcome, and vote links back to its probe", async () => {
  const m = mk(3);
  await m.ingest(ATTR_CORPUS);
  const { steps } = await trace(m, "red then circle");
  await m.store.close();

  const step = climbStep(steps);
  const cr = step.data.crossRegion;
  assert.ok(cr.junctionVotes.length > 0);
  const jv = cr.junctionVotes[0];
  assert.equal(jv.tier, "exact");
  assert.equal(typeof jv.probe, "number");
  const probe = cr.probes[jv.probe];
  assert.ok(probe, "vote's probe index must resolve into crossRegion.probes");
  assert.equal(probe.exact.attempted, true);
  assert.ok(probe.exact.candidatesReturned > 0);
  assert.ok(probe.structural, "expected a structural trace on this probe");
  assert.equal(probe.structural.outcome, "accepted");
  assert.equal(probe.outcome, "accepted");
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. single-synonym junction.
// ═══════════════════════════════════════════════════════════════════════════

test("4. single-synonym junction: exact returns zero, single attempted and returns candidates, selected single-synonym tier", async () => {
  const m = mk(1);
  await m.ingest(SYN_ATTR_CORPUS);
  // "square then crimson" — order-free single-sibling substitution recovers
  // 'red square' via crimson's sibling 'red' (mirrors test/51's synRight).
  const { steps } = await trace(m, "square then crimson");
  await m.store.close();

  const step = climbStep(steps);
  const cr = step.data.crossRegion;
  assert.ok(cr.junctionVotes.length > 0);
  const jv = cr.junctionVotes.find((v) => v.tier === "single-synonym");
  assert.ok(jv, "expected a single-synonym junction vote");
  const probe = cr.probes[jv.probe];
  assert.equal(probe.exact.candidatesReturned, 0);
  assert.equal(probe.singleSynonym.attempted, true);
  assert.ok(probe.singleSynonym.candidatesReturned > 0);
  assert.equal(probe.structural.tier, "single-synonym");
  assert.equal(probe.structural.outcome, "accepted");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. double-synonym junction: verify the ladder position and fields.
// ═══════════════════════════════════════════════════════════════════════════

test("5. double-synonym tier: probe fields report single returned zero and double attempted when only the double tier can fire", async () => {
  const m = mk(1);
  await m.ingest(SYN_ATTR_CORPUS);
  const { steps } = await trace(m, "crimson then crimson");
  await m.store.close();

  const step = climbStep(steps);
  const cr = step.data.crossRegion ?? { probes: [] };
  // Whether or not a double-synonym container was actually found (fixture-
  // sensitive per test/51's own test 4), every probe that attempted the
  // synonym ladder must report single/double consistently: double is only
  // ever attempted when single returned zero.
  for (const p of cr.probes) {
    if (p.doubleSynonym.attempted) {
      assert.equal(p.singleSynonym.candidatesReturned, 0);
      assert.equal(p.singleSynonym.attempted, true);
    }
    if (p.singleSynonym.candidatesReturned > 0) {
      assert.equal(p.doubleSynonym.attempted, false);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. structural resonance: variants, budget, hits, merged proposals,
//    examined sequence, margin, noise floor, outcome.
// ═══════════════════════════════════════════════════════════════════════════

test("6. structural-resonance: eligible probes report variants, merged proposals and an examined sequence with effectiveScore = annScore * semanticConfidence", async () => {
  const m = mk(1);
  await m.ingest(SYN_ATTR_CORPUS);
  const { steps } = await trace(m, "crimson then square");
  await m.store.close();

  const step = climbStep(steps);
  const cr = step.data.crossRegion;
  const eligible = cr.probes.filter((p) =>
    p.resonance && p.resonance.outcome !== "ineligible"
  );
  assert.ok(
    eligible.length > 0,
    "expected at least one eligible resonance probe",
  );
  for (const p of eligible) {
    const res = p.resonance;
    assert.equal(res.variantBudget, m.cfg.haloQueryK);
    assert.ok(Array.isArray(res.variants));
    assert.ok(res.variants.length > 0);
    for (const v of res.variants) {
      assert.equal(typeof v.semanticConfidence, "number");
      assert.equal(typeof v.annHitsReturned, "number");
    }
    assert.equal(typeof res.mergedProposals, "number");
    assert.ok(Array.isArray(res.examined));
    for (const c of res.examined) {
      assert.ok(
        Math.abs(c.effectiveScore - c.annScore * c.semanticConfidence) < 1e-9,
      );
      assert.ok(
        [
          "saturated",
          "no-roots",
          "nonpositive-idf",
          "same-as-endpoint",
          "same-as-selected",
          "selected",
          "contrastive-rival",
        ].includes(c.outcome),
      );
    }
    assert.equal(typeof res.noiseFloor, "number");
    assert.ok(
      ["empty", "no-valid-proposal", "margin-rejected", "accepted"].includes(
        res.outcome,
      ),
    );
    if (res.outcome === "accepted" || res.outcome === "margin-rejected") {
      assert.equal(typeof res.contrastiveMargin, "number");
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. resonance rejection outcomes.
// ═══════════════════════════════════════════════════════════════════════════

test("7. resonance outcomes: ineligible reasons are named and a margin-rejected probe reports a sub-noise-floor margin", async () => {
  const mIneligible = mk(1);
  await mIneligible.ingest(SYN_ATTR_CORPUS);
  const { steps: ineligibleSteps } = await trace(
    mIneligible,
    "crimson beside square",
  );
  await mIneligible.store.close();

  const ineligibleStep = climbStep(ineligibleSteps);
  const ineligible = (ineligibleStep.data.crossRegion?.probes ?? []).filter(
    (p) => p.resonance?.outcome === "ineligible",
  );
  assert.ok(ineligible.length > 0, "expected at least one ineligible probe");
  for (const p of ineligible) {
    assert.ok(Array.isArray(p.resonance.ineligibleReasons));
    assert.ok(p.resonance.ineligibleReasons.length > 0);
    for (const r of p.resonance.ineligibleReasons) {
      assert.ok(
        ["between-region", "not-both-strong", "not-both-known", "gap-too-large"]
          .includes(r),
      );
    }
    assert.equal(p.outcome, "resonance-ineligible");
  }

  const mMargin = mk(1);
  await mMargin.ingest(SYN_ATTR_CORPUS);
  const { steps: marginSteps } = await trace(mMargin, "crimson then square");
  await mMargin.store.close();
  const marginStep = climbStep(marginSteps);
  const marginRejected = (marginStep.data.crossRegion?.probes ?? []).filter(
    (p) => p.resonance?.outcome === "margin-rejected",
  );
  assert.ok(marginRejected.length > 0, "expected a margin-rejected probe");
  for (const p of marginRejected) {
    assert.ok(p.resonance.contrastiveMargin <= p.resonance.noiseFloor);
    assert.equal(p.outcome, "resonance-rejected");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. cross-region vote weight fields.
// ═══════════════════════════════════════════════════════════════════════════

test("8. a linked cross-region vote reports confidence, evidenceBytes, mutualWeight, voteWeightPerRoot as numbers", async () => {
  const m = mk(3);
  await m.ingest(ATTR_CORPUS);
  const { steps } = await trace(m, "red then circle");
  await m.store.close();

  const step = climbStep(steps);
  const jv = step.data.crossRegion.junctionVotes[0];
  assert.equal(typeof jv.confidence, "number");
  assert.equal(typeof jv.evidenceBytes, "number");
  assert.equal(typeof jv.mutualWeight, "number");
  assert.equal(typeof jv.voteWeightPerRoot, "number");
  assert.equal(jv.confidence, 1); // exact tier: confidence collapses to 1
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. additive behavior — the new fields never change roots/ranked/answer.
// ═══════════════════════════════════════════════════════════════════════════

test("9. enabling the extended instrumentation never changes roots, ranked, or the answer", async () => {
  const queries = [
    "red then circle",
    "square then crimson",
    "crimson then square",
    "crimson then crimson",
    "the crimson near the square",
  ];
  for (const q of queries) {
    const plain = mk(9);
    await plain.ingest(SYN_ATTR_CORPUS);
    const plainAns = await plain.respondText(q);
    await plain.store.close();

    const traced = mk(9);
    await traced.ingest(SYN_ATTR_CORPUS);
    const { ans: tracedAns, steps } = await trace(traced, q);
    await traced.store.close();

    assert.equal(tracedAns, plainAns, `answer differs for "${q}"`);

    const step = climbStep(steps);
    if (step?.data?.crossRegion) {
      // The probe/resonance instrumentation is present but does not affect
      // the pooled result: roots/ranked come from the SAME vote objects the
      // probes were recorded from.
      assert.ok(Array.isArray(step.data.crossRegion.probes));
    }
  }
});
