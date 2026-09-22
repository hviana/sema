// 100-complete-grounding-trace.test.mjs — a declared-complete grounding SAYS
// SO in the rationale.
//
// THE GAP THIS CLOSES.  `pipeline.ts` ends the derivation when the winning
// grounding carries `MechanismResult.complete` — the mechanism's own claim that
// the query IS a stored context, so its continuation is the whole read-out and
// a further pivot could only chain PAST the fact that produced the answer.  The
// decision was correct and SILENT: no step, no note.  A reader of the rationale
// therefore could not tell
//
//     "the chain stopped because the query WAS the context"   (complete)
//
// apart from
//
//     "nothing followed"                                      (no continuation)
//
// which are different claims about the same answer.  AGENTS §6 makes that an
// instrumentation defect rather than a documentation gap: a bound that
// truncates must be reportable AT THE POINT it truncates, through the one
// surface that already exists.
//
// WHAT IS PINNED HERE.
//   1. the stop is REPORTED (step `completeGrounding`) when it happens;
//   2. the stop is REAL — the post-grounding extension did not run (no pivot or
//      forward-absorb step), so the report cannot rot into a lie;
//   3. the report does NOT appear for an ordinary grounding, so it names a
//      decision rather than decorating every response.
//
// The fixture is test/76's CARRIED frame: the continuation quotes its filler
// (`Run gcc <X>`), which is the shape the reference mechanism binds and
// declares complete.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const CARRIED = [
  ["How do I compile hello.c?", "Run gcc hello.c"],
  ["How do I compile server.c?", "Run gcc server.c"],
  ["How do I compile parser.c?", "Run gcc parser.c"],
];

/** The frame fixture — the same one test/76 pins the binding on. */
async function frame() {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(CARRIED);
  return m;
}

/** A grounding that is NOT declared complete: one plain learnt edge. */
async function plainChain() {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([["Eva director", "The director of Eva is Gustaf Molander."]]);
  return m;
}

const moves = (steps) => steps.map((s) => s.mechanism.at(-1));

test("a binding that declares itself complete reports the stop", async () => {
  const m = await frame();
  const steps = [];
  await m.respondText("How do I compile main.c?", (s) => steps.push(s));

  const stop = steps.find((s) => s.mechanism.at(-1) === "completeGrounding");
  assert.ok(stop, "the rationale must report the declared-complete stop");
  assert.match(
    stop.note,
    /declared complete/,
    "the note must carry the CLAIM, not a description of the answer",
  );
});

test("the reported stop is real: the extension did not run", async () => {
  const m = await frame();
  const steps = [];
  const answer = await m.respondText(
    "How do I compile main.c?",
    (s) => steps.push(s),
  );

  // The binding spliced the asker's referent (behaviour under test, asserted
  // WITHOUT a trace below — a trace can change an answer, so the step and the
  // bytes are pinned separately).
  assert.ok(answer.length > 0, "the binding must answer");
  const seen = moves(steps);
  assert.equal(
    seen.includes("pivotStep") || seen.includes("absorbForward"),
    false,
    "a complete grounding must not be extended",
  );
});

test("the non-traced answer is the spliced one", async () => {
  const m = await frame();
  const answer = await m.respondText("How do I compile main.c?");
  assert.equal(answer.replace(/\0+/g, "").trim(), "Run gcc main.c");
});

test("an ordinary grounding reports no complete-grounding stop", async () => {
  const m = await plainChain();
  const steps = [];
  await m.respondText("Eva director", (s) => steps.push(s));
  assert.equal(
    moves(steps).includes("completeGrounding"),
    false,
    "the step names a decision, not every response",
  );
});
