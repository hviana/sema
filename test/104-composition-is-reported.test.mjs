// 104-composition-is-reported.test.mjs — every composition of an answer is
// VISIBLE in the rationale.
//
// THE GAP THIS CLOSES.  `joinWithBridge` (resonance.ts) is the composition step
// every out-of-search assembly shares: it asks the corpus for a learnt
// connector between two pieces, and on a miss it joins them BARE and emits a
// `bridgeMiss` step — never silent.  CAST's projection-to-continuation join
// bypassed it with a bare `concat2`, and that single bypass is the whole of the
// gluing the study measured: `"Steel is hard"` + `"wet"` came back as
// `"hardwet"`, `"eva director father"` + `"The father of Gustaf Molander…"` as
// `"fatherThe"`, the real store's `"Dutch.na"`.  The house rule is NOT "never
// join bare" — it is "joined bare, and REPORTED", so that a reader of the
// rationale can see the seam and its pieces.  The bypass made the seam
// invisible, which is why the gluing survived an audit that read rationales.
//
// WHAT IS PINNED.  On the fixture below the join IS a miss (this tiny corpus
// attests no connector between the two pieces), so the step must exist and must
// name BOTH pieces.  The answer must still USE the followed content — test/39
// pins that the follow is unaffected, and a fix that refuses the join instead
// of reporting it would silently drop the evidence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

/** test/39's corpus: a projection that must follow onto genuinely new content. */
async function fixture() {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([
    ["Ice is cold", "cold"],
    ["Fire is hot", "hot"],
    ["Steel is hard", "hard"],
    ["Water is wet", "wet"],
    ["Ice is cold", "Water is wet"],
    ["Something else entirely", "Water is wet"],
  ]);
  return mind;
}

const text = (resp) => new TextDecoder().decode(resp.bytes).replace(/\0+/g, "");

test("a composed seam is reported: the miss names its two pieces", async () => {
  const mind = await fixture();
  const steps = [];
  const answer = text(
    await mind.respond("What if steel were cold?", (s) => steps.push(s)),
  );

  const misses = steps.filter((s) => s.mechanism.at(-1) === "bridgeMiss");
  assert.ok(
    misses.length > 0,
    "the composition must be visible: the shared joiner reports a miss",
  );
  // The seam this lot exists for: the followed continuation is joined on.
  // The INTERNAL seam — the join the mechanism itself made — names the two
  // pieces as they were BEFORE the join: the projection and the followed
  // continuation, side by side.  The answer-level assembly can only report the
  // bytes it is handed, so this step is what makes the gluing auditable.
  const internal = misses.some((s) => {
    const parts = (s.inputs ?? []).map((i) => String(i.text));
    return parts.some((t) => t.trim() === "wet") &&
      parts.some((t) => t.includes("cold"));
  });
  assert.ok(internal, "the internal seam must be named, pre-join");
  // Reporting, not refusing: the follow's content is still used (test/39).
  assert.ok(
    answer.includes("wet"),
    `the followed content must still be used, got "${answer}"`,
  );
  await mind.store.close();
});

test("an in-search composition keeps its own trace (no report invented)", async () => {
  // A query the corpus answers directly composes nothing that needs a bridge:
  // cover's own steps are the report, so no `bridgeMiss` is fabricated.
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([["Ice is cold", "Water is wet"]]);
  const steps = [];
  await mind.respond("Ice is cold", (s) => steps.push(s));
  const misses = steps.filter((s) => s.mechanism.at(-1) === "bridgeMiss");
  assert.equal(misses.length, 0, "a stored answer is not a composition");
  assert.ok(
    steps.some((s) => s.mechanism.at(-1) === "ground"),
    "and the derivation that did answer is still traced",
  );
  await mind.store.close();
});
