// 186-embedded-middle.test.mjs — the CUT-PAIR probe of `recognise`: a stored form in the MIDDLE of a query.
//
// THE CAPABILITY.  A stored form embedded in the MIDDLE of a longer question is named, and its continuation is
// answered.  No tier reached it before: the two edge scans probe only prefixes and suffixes (`spend(0, prefixes[i])`,
// `spend(s, bytes.length)`), and the interior pass was capped at `reach` = W^2 + 2*radius.  Measured on the trained
// corpus, the SAME real contexts in three positions: opening 12/17, MIDDLE 0/17, end 12/17.
//
// HOW.  `startList` already holds the content-defined cuts, and both edges of such a form sit within `radius` of a
// cut.  The probe therefore pairs CUTS — the exact pair first, then a ±W trim — under a constant span bound derived
// from W (`chainReach(W) * W * W`, never a pinned number).  The bound is what keeps it linear: an unbounded cut-pair
// scan is O(cuts^2) and test/14 rejects it.
//
// WHAT THIS FILE PINS: the recognition and the ANSWER at all three positions, that an unstored form is still refused
// (the negative control that keeps the middle assertions from passing for the wrong reason), and the determinism of
// the reading.  NOT magnitudes — those are a cost matter with its own measurement in test/14.
import test from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { recognise } from "../dist/src/mind/recognition.js";

const dec = new TextDecoder();
// 64 B, so the form is TWICE `reach` (W^2 + 2*radius) — the dead zone the cut-pair probe exists to close.
const FORM = "the painter was born in Verano and the river runs through Verano";
const CONTINUATION = "that region is Calenta";
const OTHER = "the harbour master";
const OTHER_CONTINUATION = "the harbour is at Kestrel";

async function mind() {
  const m = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
    profile: true,
  });
  await m.ingest([
    [FORM, CONTINUATION],
    [OTHER, OTHER_CONTINUATION],
  ]);
  return m;
}

function named(m, query, form) {
  const bytes = new TextEncoder().encode(query);
  return recognise(m, bytes).sites.some((s) =>
    dec.decode(bytes.subarray(s.start, s.end)) === form
  );
}

test("recognise(): a stored form EMBEDDED IN THE MIDDLE of a longer query is named", async () => {
  const m = await mind();
  const query = `I ask: ${OTHER}, ${FORM}, and the note is filed.`;
  assert.equal(named(m, query, FORM), true);
});

test("the middle form is ANSWERED with its own continuation, not the surrounding fact's", async () => {
  const m = await mind();
  const answer = String(
    await m.respondText(
      `I ask: ${OTHER}, ${FORM}, and the note is filed.`,
      () => {},
    ),
  );
  assert.match(answer, /Calenta/);
});

test("the same form at the OPENING and at the END is still named — the edge tiers did not regress", async () => {
  const m = await mind();
  assert.equal(named(m, `${FORM}, and the note is filed.`, FORM), true);
  assert.equal(named(m, `I ask: ${OTHER}, and ${FORM}.`, FORM), true);
});

test("an UNSTORED form is still refused in the middle — the assertion above is not vacuous", async () => {
  const m = await mind();
  // Same LENGTH by construction (one word swapped), and never deposited: the middle assertions must not
  // pass merely because some longer span happens to cover the region.
  const unstored = FORM.replace("painter", "sculpto");
  assert.equal(
    unstored.length,
    FORM.length,
    "the control must be the same size as the form",
  );
  assert.notEqual(unstored, FORM);
  assert.equal(
    named(m, `I ask: ${OTHER}, ${unstored}, and the note is filed.`, unstored),
    false,
  );
});

test("the reading is deterministic, and the interior counter is wired", async () => {
  const first = await mind();
  const second = await mind();
  const query = `I ask: ${OTHER}, ${FORM}, and the note is filed.`;
  const a = String(await first.respondText(query, () => {}));
  const b = String(await second.respondText(query, () => {}));
  assert.equal(a, b);
  const counters = first.lastCost?.counters ?? {};
  assert.ok(
    (counters.recogniseInteriorPairs ?? 0) > 0,
    "recogniseInteriorPairs must be wired",
  );
});
