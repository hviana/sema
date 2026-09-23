// 129-the-trace-payload-shape.test.mjs — THE PAYLOAD'S SHAPE, PINNED
//
// The climb's trace payload (`ClimbConsensusData`, `version: 1`) is built by
// hand next to the internal `TraceDraft` that feeds it, and the pair has
// already drifted once (`visited?` — "Absent on payloads recorded before this
// field existed").  The draft is NOT exported, so a test cannot compare the two
// side by side (and exporting it just for a test would be new plumbing the
// architecture forbids).  What CAN be pinned from outside is the payload's
// SHAPE: a closed key set per section, so that a field added, removed or
// renamed on one side of the pair cannot pass unnoticed.
//
// The sets below are MEASURED from a real payload (printed before being
// written), not chosen.  If this test fails, the payload changed: update the
// section it names AND the draft that feeds it AND the note in attention.ts
// that says which fields older payloads lack.
//
// The sections are optional by design (that is what keeps recorded payloads
// valid); this query produces ALL of them, and the test asserts that too, so a
// section silently disappearing is caught rather than tolerated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const CORPUS = [
  ["red", "is a color"],
  ["blue", "is a color"],
  ["circle", "is a shape"],
  ["square", "is a shape"],
  ["red circle", "answer alpha"],
  ["red square", "answer beta"],
  ["blue circle", "answer gamma"],
  ["blue square", "answer delta"],
];

const TOP = [
  "anchors",
  "cache",
  "candidates",
  "config",
  "crossRegion",
  "pooling",
  "reaches",
  "regions",
  "result",
  "saturation",
  "version",
];
const REQUIRED = ["cache", "candidates", "config", "result", "version"];
const SECTIONS = {
  cache: ["detailAvailable", "hit"],
  config: [
    "annK",
    "consensusFloor",
    "corpusN",
    "crossRegionProbeLimit",
    "dimension",
    "estimatorNoise",
    "hubBound",
    "mode",
    "naturalBreak",
  ],
  candidates: ["perceived", "recognised", "total"],
  crossRegion: [
    "eligibleRegions",
    "junctionVotes",
    "maximalRegions",
    "probeLimit",
    "probes",
    "probesAttempted",
    "stopReason",
    "supersededOrdinaryVotes",
  ],
  saturation: ["hasLeading", "leadingEnd", "regionIntervals"],
  pooling: ["eligibleVotes", "inputVotes", "saturationMaskedVotes"],
};
const ANCHOR = [
  "anchor",
  "breadth",
  "candidateBreadth",
  "clusters",
  "commit",
  "contributingEvidence",
  "contributingSpans",
  "contributingVotes",
  "idfVote",
  "peak",
  "pooledVote",
  "rank",
];
const REGION = [
  "annHitsExamined",
  "annHitsReturned",
  "annQueried",
  "canonicalFailed",
  "canonicalId",
  "canonicalUsable",
  "chunk",
  "dfWeight",
  "focusWeightPerRoot",
  "idf",
  "index",
  "known",
  "mutualWeight",
  "ordinaryVoteProduced",
  "outcome",
  "reachNode",
  "selected",
  "source",
  "span",
  "superseded",
  "voteWeightPerRoot",
];

/** The payload, found the way a reader finds it: deep in the recorded steps. */
function findPayload(steps) {
  const walk = (o, depth) => {
    if (o === null || typeof o !== "object" || depth > 6) return null;
    if (o.version === 1 && o.config && o.result) return o;
    for (const v of Object.values(o)) {
      const hit = walk(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  for (const step of steps) {
    const hit = walk(step.data, 0);
    if (hit) return hit;
  }
  return null;
}

test("the climb trace payload keeps its published shape", async () => {
  const m = new Mind({ seed: 1, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(CORPUS);
  const steps = [];
  await m.respondText("red then circle", (step) => steps.push(step));
  const payload = findPayload(steps);
  assert.ok(payload, "no version:1 payload with config+result was recorded");

  assert.deepEqual(Object.keys(payload).sort(), TOP);
  for (const key of REQUIRED) {
    assert.ok(key in payload, `required section ${key} is missing`);
  }
  for (const [name, keys] of Object.entries(SECTIONS)) {
    assert.ok(payload[name] !== undefined, `section ${name} is absent`);
    assert.deepEqual(
      Object.keys(payload[name]).sort(),
      keys,
      `section ${name} changed shape`,
    );
  }
  assert.ok(payload.anchors.length > 0, "no anchors recorded");
  assert.deepEqual(Object.keys(payload.anchors[0]).sort(), ANCHOR);
  assert.ok(payload.regions.length > 0, "no regions recorded");
  assert.deepEqual(Object.keys(payload.regions[0]).sort(), REGION);
  assert.ok(
    Array.isArray(payload.anchors[0].commit.rejectionReasons),
    "an anchor's commit no longer carries its rejection reasons",
  );

  await m.store.close();
});
