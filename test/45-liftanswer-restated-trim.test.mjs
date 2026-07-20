// 45-liftanswer-restated-trim.test.mjs — cover's derivation must not be
// discarded WHOLESALE just because one of its segments restates content the
// query already contains; liftAnswer should TRIM the restating segment and
// keep the rest.
//
// Traced live (analyze_training.ts, dialogue D geography thread) and
// reproduced minimally here: in a multi-turn conversation, turn 1's own
// reply ("The capital of France is Paris.") becomes part of turn 2's
// accumulated query verbatim.  cover's search correctly answers turn 1's
// embedded question by FOLLOWING its edge to that same reply text — which
// now duplicates content already sitting later in the query (the prior
// turn's own answer, echoed back).  The OLD behaviour (cover.ts's
// `restatedSpan` check) detected this correctly but responded by discarding
// the ENTIRE candidate — throwing away the genuinely NEW answer (turn 2's
// own question) along with the stale restated one.  Root cause: node
// "The capital of France is Paris." has no forward edge and no concept
// sibling (a plain declarative answer, not itself a question), so cover's
// search also has to fall back to a very expensive byte-by-byte cover for
// its own re-occurrence — but that is a SEPARATE, already-documented
// concern; this test's fix is specifically about not discarding good
// content alongside restated content once a derivation IS found.
//
// Fix: liftAnswer (types.ts) now takes the query bytes and the geometry's
// quantum W, and excludes any recognised segment whose SUBSTITUTED bytes
// (not the segment's own literal text) already occur elsewhere in the
// query — from both the framing (lo/hi) decision AND the final
// concatenation — instead of cover.ts rejecting the whole derivation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const dec = (b) => new TextDecoder().decode(b).replace(/\0+$/, "");

test("cover: a restated segment is trimmed from the answer, not discarded wholesale", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    ["What is the capital of Spain?", "Madrid is the capital of Spain."],
  ]);

  const conv = m.beginConversation();
  await m.respondTurn(conv, "What is the capital of France?");
  const r2 = await m.respondTurn(conv, "What is the capital of Spain?");
  const got = dec(r2.response.bytes);

  assert.ok(
    got.length > 0,
    "expected a non-empty answer — the genuinely new Spain answer must not " +
      "be discarded just because the France answer restates itself",
  );
  assert.ok(
    got.includes("Madrid") || got.includes("Spain"),
    `expected the NEW answer (Spain) to survive, got ${JSON.stringify(got)}`,
  );

  m.endConversation(conv);
  await m.store.close();
});
