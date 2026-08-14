// 87-codominant-commitment.test.mjs — when the estimator cannot separate two
// anchors, the climb must not pick one of them by coin flip.
//
// THE DEFECT THIS PINS. `commitVotes` exempts the DOMINANT anchor from both
// vote gates ("the first non-overlapping root is dominant and bypasses the two
// vote thresholds — it always grounds"), and holds every later anchor to
// `naturalBreak` AND an absolute `consensusFloor(N) = ln N + 1/2`. Which anchor
// gets the exemption is decided by a sort over ESTIMATED quantities. When the
// two are within the estimator's own resolution that sort is a coin flip — and
// the loser is then refused by a floor the winner never had to clear.
//
// MEASURED on the corpus below, 60 seeds per D. True separation of the two
// anchors is 0.54s / 0.75s / 1.04s (s = estimatorNoise(D) = 1/sqrt(D)):
//
//     D      s=1/sqrt(D)   vote SD (estimated anchor)   SD/s   top flips
//     256    0.0625        0.0561                       0.90   19/60
//    1024    0.0313        0.0268                       0.86   12/60
//    4096    0.0156        0.0074                       0.48    2/60
//
// The SD tracks 1/sqrt(D) and the flip rate collapses with it, so the
// reordering is the ESTIMATOR's, not the corpus's. One anchor's vote is
// constant across all 60 seeds (exact, content-addressed evidence); the other's
// varies. Meanwhile `consensusFloor(3) = 1.599` and neither anchor exceeds
// ~1.01, so the runner-up could NEVER commit: the query was allowed exactly one
// point of attention, chosen by noise.
//
// THE FIX is the co-dominant band: an anchor whose margin from the dominant is
// inside sqrt(k)*s inherits the dominant's exemption. sqrt(k) because a vote is
// a SUM over the anchor's k contributing regions, so its noise grows as
// sqrt(k) — a bare s would be the same category error as pricing an
// N-invariant count against an N-growing threshold. Both quantities are already
// in hand (`regionAxioms`, `estimatorNoise(D)`), so no constant is introduced.
//
// WHAT THIS FILE ASSERTS, AND WHY NOT THE OUTCOME. test/29 D2 asserts
// `provenance === "cast"` — a PROXY. It passed while the property its own title
// names ("site-aware climb is seed-independent") was false, because CAST voiced
// the runner-up regardless of what the climb committed. So this file asserts
// the commitment itself, read from the trace.
//
// NOT "the same anchors commit at every seed" — that was tried and it is FALSE,
// which is worth recording. At seed 7 the noise puts the two anchors 0.049
// apart while the runner-up's band is sqrt(2)*s = 0.044, so it is genuinely
// separated and correctly rejected. The band is a statement about resolution,
// not a promise of a fixed root set. The exact invariant is the one below: an
// anchor inside its own band of the dominant is never rejected by a gate the
// dominant was exempt from.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const D = 1024;
const SIGMA = 1 / Math.sqrt(D); // estimatorNoise(D), by its own definition

// test/29 D1's corpus: "steel is frigid" aligns "steel is " with one context
// and "frigid" with another, and the two score within noise of each other.
const ANALOGY = [
  ["ice is cold so ice is brittle", "brittle"],
  ["steel is hard so steel is strong", "strong"],
  ["water is frigid so water is freezing", "freezing"],
];

/** The climb's per-anchor commit record for one query. */
async function commitRecord(seed, train, query) {
  const store = new SQliteStore({ path: ":memory:", D });
  const mind = new Mind({ seed, store });
  await mind.ingest(train);
  let anchors = [];
  await mind.respondText(query, (s) => {
    if (s.mechanism[s.mechanism.length - 1] !== "climbConsensus") return;
    anchors = s.data?.anchors ?? anchors;
  });
  await store.close();
  return anchors;
}

/** The anchor's own band: sqrt(k) * sigma, k = its contributing-vote count. */
const bandOf = (a) => Math.sqrt(Math.max(1, a.contributingVotes ?? 1)) * SIGMA;

test("an anchor inside its band of the dominant is never refused by the floor", async () => {
  // THE REGRESSION, stated exactly. Without the band, seed 1 rejects the
  // runner-up with ["below-natural-break","below-consensus-floor"] at a margin
  // of 0.013 — a third of its own resolution — while the dominant that beat it
  // by that margin was exempt from both gates. Measured at 6 of 24 seeds.
  let rescued = 0;
  for (const seed of [1, 7, 8, 18, 20, 22, 23, 42]) {
    const anchors = await commitRecord(seed, ANALOGY, "steel is frigid");
    const dom = anchors.find((a) => a.commit?.dominant);
    assert.ok(dom !== undefined, `seed ${seed}: no dominant anchor recorded`);
    for (const a of anchors) {
      if (a === dom || a.commit?.status === "overlap") continue;
      const margin = (dom.idfVote ?? 0) - (a.idfVote ?? 0);
      if (margin >= bandOf(a)) continue; // genuinely separated — may be rejected
      rescued++;
      assert.equal(
        a.commit?.status,
        "root",
        `seed ${seed}: anchor #${a.anchor} sits ${
          margin.toFixed(5)
        } from the ` +
          `dominant — inside its own band of ${
            bandOf(a).toFixed(5)
          } — yet was ` +
          `${a.commit?.status} for ${
            JSON.stringify(a.commit?.rejectionReasons)
          }, gates the dominant never had to clear`,
      );
    }
  }
  assert.ok(
    rescued > 0,
    "no anchor in the sweep landed inside its band — fixture no longer covers the defect",
  );
});

test("a band-admitted root is genuinely inside its own sqrt(k)*sigma", async () => {
  // WIDTH GUARD. The band must be exactly what it claims. Recomputed here from
  // the trace's OWN recorded numbers, so a widened band cannot pass silently.
  let checked = 0;
  for (const seed of [1, 7, 20, 22]) {
    const anchors = await commitRecord(seed, ANALOGY, "steel is frigid");
    const dom = anchors.find((a) => a.commit?.dominant);
    if (dom === undefined) continue;
    for (const a of anchors) {
      if (!a.commit?.tiedWithDominant) continue;
      checked++;
      const margin = (dom.idfVote ?? 0) - (a.idfVote ?? 0);
      assert.ok(
        margin < bandOf(a),
        `seed ${seed}: anchor #${a.anchor} admitted as tied with margin ${
          margin.toFixed(5)
        } but its band is only ${bandOf(a).toFixed(5)}`,
      );
    }
  }
  assert.ok(
    checked > 0,
    "no root was admitted by the band — fixture no longer covers it",
  );
});

test("the band does not admit a clearly separated anchor", async () => {
  // OVER-CORRECTION GUARD. The band is about indistinguishability, not
  // generosity. Measured on this fixture the climb commits ONE root at vote
  // 8.13 while its rivals sit at 0.57 and 0.15 — separations of 240s and 255s.
  // If this ever commits more than one root, the band has become a blanket
  // admission.
  const chain = [
    ["Eiffel Tower country", "The country of Eiffel Tower is France."],
    ["France capital", "The capital of France is Paris."],
    ["France", "The capital of France is Paris."],
  ];
  const filler = Array.from({ length: 50 }, (_, i) => [
    `What is the status of my request ${i}?`,
    `I have token number ${i} waiting.`,
  ]);
  const anchors = await commitRecord(
    7,
    [...chain, ...filler],
    "What is the capital of the country of Eiffel Tower?",
  );
  const roots = anchors.filter((a) => a.commit?.status === "root");
  assert.equal(
    roots.length,
    1,
    `expected the clearly dominant anchor alone; got ${
      roots.map((r) => `#${r.anchor}@${Number(r.idfVote).toFixed(3)}`).join(
        ", ",
      )
    }`,
  );
  assert.ok(
    !roots[0].commit?.tiedWithDominant,
    "the dominant root must not be marked as tied with itself",
  );
});
