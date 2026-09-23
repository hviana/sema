// 105-derive-through-reports-its-refusal.test.mjs — the join rule says WHY it
// did not join.
//
// THE GAP THIS CLOSES.  DIRECTION (the study's gap 2): a produced fact carries
// the subject the query never wrote, and the query's remaining tail names the
// relation to follow FROM it — but on the measured chain the rule never fired
// and nothing said why.  `deriveThrough` yields no rule when it refuses, and a
// rule that yields nothing leaves no step, so the gate was invisible from
// outside: four fixtures changed the SYMPTOM (`"eva director country"` answered
// with the intermediate KEY's bytes glued to the fact) without ever reaching the
// rule.  AGENTS §6: a gap in instrumentation is a defect IN the instrumentation
// — close it there, once, through the rationale, never a channel of its own.
//
// WHAT IS PINNED.
//   1. the refusal is REPORTED, and it names the two pieces it tried (the fact
//      and the tail), so the gate is readable in the rationale;
//   2. it is reported ONLY for a form: the search asks this rule for every
//      finalized out with a node, one-byte outs included — measured, 68
//      refusals for a single 3-relation query, all letters.  W is the line the
//      mind already draws between a chance overlap and a form, and a report per
//      letter is noise, not instrumentation;
//   3. a fully covered query (no tail) is not a refusal at all — the rule does
//      not apply, and it must not be reported as a miss.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const F1 = "The director of Eva is Gustaf Molander.";
const F2 = "The country of Gustaf Molander is Sweden.";
const F3 = "The capital of Sweden is Stockholm.";

/** The measured chain: every relation filed under BOTH the entity and its key,
 *  which is how the real store files a fact (the study's round-3 dump). */
async function chain() {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([
    ["eva", F1],
    ["eva director", F1],
    ["gustaf molander", F2],
    ["gustaf molander country", F2],
    ["sweden", F3],
    ["sweden capital", F3],
  ]);
  return mind;
}

const misses = (steps) =>
  steps.filter((s) => s.mechanism.at(-1) === "deriveThroughMiss");

test("the join's refusal is reported, naming the candidate and tail it tried", async () => {
  const mind = await chain();
  // The THREE-relation query: the second join is still refused (the rule
  // concludes terminal — the study's other half), so this is where the refusal
  // is observable.  The two-relation one now JOINS (measured, and pinned by
  // test/99's spec), which is why this test moved here.
  const steps = [];
  await mind.respond("eva director country capital", (s) => steps.push(s));
  const got = misses(steps);
  assert.ok(got.length > 0, "the join must say why it did not join");
  const named = got.some((s) => {
    const parts = (s.inputs ?? []).map((i) => String(i.text));
    return parts.some((t) => t.includes("gustaf molander")) &&
      parts.some((t) => t.includes("country"));
  });
  assert.ok(named, "the report must name the candidate and the tail it tried");
  // …and WHERE the candidate came from: a refusal that names only bytes leaves
  // the next reader guessing which proposal path produced them (three chained-
  // join attempts were spent fixing paths that never proposed the offender).
  assert.ok(
    got.some((s) => /#\d+, from the .* source/.test(String(s.note))),
    "the report must name the candidate's node and its source",
  );
  await mind.store.close();
});

test("a report per LETTER is noise: only forms are reported", async () => {
  const mind = await chain();
  const steps = [];
  await mind.respond("eva director country capital", (s) => steps.push(s));
  const got = misses(steps);
  assert.ok(got.length > 0, "the real fact's refusal is still reported");
  // STRUCTURAL, not a count: a report is only made for a FORM, so every report
  // carries a piece at least one window long — no one-byte out reports a miss.
  // `W` is the fixture's own geometry (the Mind's default maxGroup), the same
  // line the rule uses.
  const W = 4;
  for (const m of got) {
    const longest = Math.max(
      0,
      ...(m.inputs ?? []).map((i) => String(i.text ?? "").length),
    );
    assert.ok(
      longest >= W,
      `a report must be about a form, got pieces of at most ${longest} bytes`,
    );
  }
  await mind.store.close();
});

test("a fully covered query is not a refusal", async () => {
  const mind = await chain();
  const steps = [];
  await mind.respond("eva director", (s) => steps.push(s));
  assert.equal(
    misses(steps).length,
    0,
    "with no tail there is nothing to join through — not a miss",
  );
  await mind.store.close();
});
