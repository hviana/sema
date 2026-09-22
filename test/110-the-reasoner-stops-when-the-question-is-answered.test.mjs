// 110-the-reasoner-stops-when-the-question-is-answered.test.mjs — EXTENSION: a
// further chain link must not change the answer to a question already answered.
//
// THE GAP THIS CLOSES.  Every stopping condition in the pivot loop judged the
// ANSWER; none asked whether the QUESTION was satisfied (reasoning.ts says so
// in its own words).  Measured on a three-link chain, the reasoner took ONE hop
// MORE than the question needed and REPLACED the satisfying answer:
//
//   elos=2  pivots=1 → "Paris is famous for the Eiffel Tower"   (the answer)
//   elos=3  pivots=2 → "the Eiffel Tower is in Paris"           (one hop past it)
//
// THE INVARIANT (and the acceptance test, relational — no magic string):
//
//   adding a link to the corpus must NOT change the answer to a question the
//   shorter corpus already answered.
//
// WHAT MAKES IT PRINCIPLED, and what each candidate cost.  Eight formulations
// were measured and refuted before this one — including a count of extensions,
// which is not a reason.  This one uses two data the mind already has:
//   • the cost ladder's own `unaccounted` spans (what the grounding left
//     uncovered) — passed to the reasoner by the pipeline;
//   • the mind's own line between chance and evidence — one W-byte window —
//     so an extension counts as progress only if it carries a window of the
//     uncovered material;
//   • and the pipeline's EXISTING condition for who owns a shape: "only a
//     mechanism carrying its own `used` set (cast/join) gets this" — which is
//     exactly `voiced.length > 0`, since `voiced` is what the mechanism
//     withheld.  A producer owns its answer (test/29 C3's hop inside the
//     comparison's seat fires); the reasoner's own extensions do not.
//
// It terminates by a real argument — the uncovered material is finite and each
// taken extension must carry some of it — never by a depth limit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const QUERY = "What is the capital of France famous for";

/** The chain with `n` links: each fact's subject continues into the next. */
const LINKS = [
  ["What is the capital of France", "The capital of France is Paris"],
  ["Paris", "Paris is famous for the Eiffel Tower"],
  ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
];

async function chain(n) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(LINKS.slice(0, n));
  return mind;
}

const text = (resp) => new TextDecoder().decode(resp.bytes).replace(/\0+/g, "");

test("a longer corpus does not change an answer already given", async () => {
  const short = await chain(2);
  const long = await chain(3);
  const answered = text(await short.respond(QUERY)).trim();
  const extended = text(await long.respond(QUERY)).trim();
  assert.equal(
    extended,
    answered,
    "adding a link must not push the chain past the answer",
  );
  assert.equal(answered, "Paris is famous for the Eiffel Tower");
  await short.store.close();
  await long.store.close();
});

test("the counters agree: one hop, not two — with no rationale attached", async () => {
  const mind = await chain(3);
  await mind.respond(QUERY);
  assert.equal(
    mind.lastCost?.counters.pivotSteps ?? 0,
    1,
    "the satisfying hop is taken and the drift is not",
  );
  await mind.store.close();
});

test("a question the first link already answers still takes no hop", async () => {
  const mind = await chain(3);
  const out = text(await mind.respond("What is the capital of France"));
  assert.equal(out.trim(), "The capital of France is Paris");
  assert.equal(mind.lastCost?.counters.pivotSteps ?? 0, 0);
  await mind.store.close();
});
