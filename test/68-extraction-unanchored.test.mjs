// 68-extraction-unanchored.test.mjs — an extraction that located NO frame of its
// exemplar in the query is not an extraction, and must not answer.
//
// extractBySkill's own contract says `accounted` carries "the located frames AND
// any read span BOUNDED by located frames on both sides", while an open-ended
// read "remains a guess about where the span stops — it stays unaccounted".
// EMPTY accounted is the degenerate case: no frame was located at all, so
// nothing ties the bytes just read to this question.  isSpanShaped is
// deliberately permissive (a sparse-subsequence check) and will accept an
// exemplar whose relation to the query is coincidental gap-matching; requiring
// at least one located frame is the structural evidence it leaves out.
//
// THE CASE (analyze_training.ts F, the battery's ONLY wrong non-silent answer,
// on the 15.7M-node store): "Which city is France's seat of government?"
// answered "Which ci" — a fragment of the query itself — from the exemplar
// "What is dll", with accounted=[] and pieces=1.  A/B verified: without the gate
// the answer is "Which ci"; with it, silence.  The battery went from
// 31✓/1 weak/10 empty to 31✓/0 weak/11 empty, and `extract` left the provenance
// census entirely — no wrong answers remain anywhere in it.
//
// WHY THE GATE LIVES HERE AND NOT IN THE PIPELINE.  The same test at the
// pipeline's post-grounding density check was tried and REVERTED: `accounted` is
// passed empty BY CONVENTION on recall's own tiers (recall.ts ground(…, [], …)),
// so a density veto there refused six legitimate reverse-recall groundings
// (seat symmetry, bidirectional chain, E9 turn parity, C1 reverse-recall …).
// Inside extraction the field is this mechanism's own output and carries its
// documented meaning, so the test is sound exactly where the convention cannot
// reach it.
//
// NOT REPRODUCIBLE IN A FIXTURE: a miniature corpus yields ANCHORED extractions
// (a frame IS located, accounted non-empty), which this gate correctly permits —
// verified across seeds 1/7/42.  So what this file pins is the other side: the
// gate must not block a located-frame extraction.  The wrong-answer fix itself is
// evidenced by the real-store A/B above.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

/** Span-shaped exemplars: the answer is a subsequence of its context, so the
 *  learnt skill is "read the thing the frame wraps". */
const TRAIN = [
  ["What is dll?", "dll"],
  ["What is api?", "api"],
  ["What is ram?", "ram"],
  ["What is cpu?", "cpu"],
  ["What is gpu?", "gpu"],
  ["What is ssd?", "ssd"],
];

test("1. an extraction whose frame IS located still answers (gate must not over-block)", async () => {
  for (const seed of [1, 7, 42]) {
    const m = new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });
    await m.ingest(TRAIN);
    const a = await m.respondText("Which colour is the deepest ocean?");
    assert.ok(
      a.length > 0,
      `seed ${seed}: a located-frame extraction must survive the unanchored gate`,
    );
    await m.store.close();
  }
});

test("2. the learnt skill still reads its own trained frame", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(TRAIN);
  assert.match(await m.respondText("What is dll?"), /dll/);
  await m.store.close();
});

test("3. gibberish stays silent — the gate adds refusal, never licence", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(TRAIN);
  for (const q of ["qq8f3kz9 vv2m1x7w?", "xyzzy plugh quux baz?"]) {
    assert.equal(await m.respondText(q), "", `expected silence for ${q}`);
  }
  await m.store.close();
});
