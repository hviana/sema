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
  // The expected answer is the fixture's OWN second link — the relation the
  // question asked for — not a string copied into the test.
  assert.equal(answered, LINKS[1][1]);
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

test("a cycle of facts repeating the answer's own scaffolding is not walked", async () => {
  // Six people, each the father of the next and the last of the first.  The
  // cover answers `The father of Aldric Fenwick is Beatrix Holloway.`, and the
  // walk once pivoted five times round the cycle back to Aldric: every next
  // fact holds ` of `, a window the question still owed, so each step was
  // admitted for CARRYING it — though the answer in hand already held it.
  // What the derivation already said is not carried again (derivation.ts).
  const fact = (s, r, o) => `The ${r} of ${s} is ${o}.`;
  const people = [
    "Aldric Fenwick",
    "Beatrix Holloway",
    "Cedric Ashcombe",
    "Delphine Marlowe",
    "Edmund Thornbury",
    "Felicity Wetherby",
  ];
  const pairs = [];
  people.forEach((p, i) => {
    const f = people[(i + 1) % people.length];
    const c = ["Ravenmoor", "Glenhollow", "Marrowby"][i % 3];
    pairs.push([`${p} father`, fact(p, "father", f)], [
      p,
      fact(p, "father", f),
    ]);
    pairs.push([`${p} place of birth`, fact(p, "place of birth", c)]);
    pairs.push([`Where was ${p} born?`, fact(p, "place of birth", c)]);
  });
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(pairs);
  assert.equal(
    await m.respondText("Who is the father of Aldric Fenwick?"),
    fact("Aldric Fenwick", "father", "Beatrix Holloway"),
  );
});
