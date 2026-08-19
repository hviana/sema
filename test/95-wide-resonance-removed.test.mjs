// 95-wide-resonance-removed.test.mjs — the substitution bridge and prefix
// completion must propose from BOUNDED sources, never from the exhaustive-√N
// ANN scan that `Precomputed.wideResonance()` used to run (removed; see
// pipeline-mechanism.ts's REMOVED note).
//
// This is a PERFORMANCE regression test, not a behaviour test: the wide list
// was a PROPOSAL source whose consumers byte-verify every candidate (§2.3), so
// removing it is byte-identical wherever the bounded sources supply the same
// candidate set — and the meter's phase map is the only observable that says
// whether the exhaustive machinery still exists.  Red-on-revert: re-adding
// wideResonance re-creates the `wideResonance` phase (and, when the query's
// top hit clears conceptThreshold, a full-index ANN scan inside it), so the
// phase-absence assertion below fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const dec = (b) => new TextDecoder().decode(b).replace(/\0+$/, "");

// The test/49 resonance-proposed corpus: the query "what is the capital of
// france" resonates STRAIGHT to the trained "What is the capital of France?"
// (nearest whole-query hit, so its top hit clears conceptThreshold — the exact
// condition that made the old wideResonance go exhaustive) yet falls below the
// reach bar, so recall refuses and the bridge runs to recover the fact.
const CORPUS = [
  ["What is the capital of France?", "The capital of France is Paris."],
  ["What is the capital of Spain?", "The capital of Spain is Madrid."],
  ["What is the capital of Italy?", "The capital of Italy is Rome."],
  // Lowercase mid-sentence occurrences attest the case-folded windows the
  // substitution's corroboration gate requires.
  ["He wrote of france and of spain.", "Then he flew home to italy."],
  ["She spoke of france in her diary.", "Her diary told of france."],
];

test("the bridge's refusal path never descends the exhaustive-√N ANN scan", async () => {
  const m = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
    profile: true,
  });
  await m.ingest(CORPUS);

  const r = await m.respond("what is the capital of france");
  assert.ok(
    dec(r.bytes).includes("Paris"),
    `the bridge must still ground the fact through its bounded proposals, got ${
      JSON.stringify(dec(r.bytes))
    }`,
  );

  const c = m.lastCost;
  // The fixture actually ran the bridge — without this, a silently-skipped
  // fixture would pass the phase-absence assertion while asserting nothing.
  assert.ok(
    c.phases["substitutionBridge"],
    "the fixture must run the substitution bridge",
  );
  // The exhaustive-√N phase is gone.  Its removal is the whole point: the
  // bridge's proposal source is the response's ONE top-k read (memoized), and
  // every proposal is byte-verified downstream, so the full-index scan bought
  // recall at O(index) cost for an O(k) need.
  assert.equal(
    c.phases["wideResonance"],
    undefined,
    "wideResonance (the exhaustive √N scan) must be removed from the response",
  );
  // The bridge phase itself accrues no content-index ANN reads: proposals come
  // from the memoized `resonance()`, never a fresh exhaustive descend.
  const bridgeAnn = c.phases["substitutionBridge"].counters.annVectorReads ?? 0;
  assert.equal(
    bridgeAnn,
    0,
    "the substitution bridge must not descend the content ANN on its own",
  );

  await m.store.close();
});

test("prefix completion proposes from the write-side window index, not the ANN", async () => {
  const m = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
    profile: true,
  });
  await m.ingest(CORPUS);

  // A strict byte-prefix of the trained answer form.  Its gist cannot rank its
  // own continuation (cos falls below reachThreshold), so the content-addressed
  // window walk is the correct proposal source — and the one prefix-completion
  // now tries FIRST.
  const r = await m.respond("The capital of France is");
  assert.ok(
    dec(r.bytes).includes("Paris"),
    `expected the trained form through the content-addressed prefix supply, got ${
      JSON.stringify(dec(r.bytes))
    }`,
  );

  const c = m.lastCost;
  assert.equal(
    c.phases["wideResonance"],
    undefined,
    "wideResonance (the exhaustive √N scan) must be removed from the response",
  );

  await m.store.close();
});
