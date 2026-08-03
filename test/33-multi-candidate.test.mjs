// 33-multi-candidate.test.mjs — the grounding decider's extended surface.
//
// Pins five refinements to think()'s grounding decider (pipeline.ts), each
// verified through the public respond()/inspectRationale API rather than by
// reaching into internals:
//
//   1. CAST's three internal schemas (substitution, redirection, comparison)
//      each contribute their OWN candidate to the decider, instead of the
//      first-fired schema shadowing the rest.
//   2. Every mechanism's candidate carries a diagnostic `unexplained` label —
//      never priced, only explanatory — surfaced in decideGrounding's trace.
//   3. A near-tie between the winner and the runner-up is surfaced as a
//      `narrowDecision` trace step.
//   4. A winning candidate that explains only a sliver of the query is
//      flagged `thinGrounding` — diagnostic, never suppressing the answer.
//   5. CAST and extraction are skipped outright (`skipMechanism`) when a
//      dynamic floor read from the (memoised) consensus climb shows the
//      mechanism cannot structurally fire.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = (seed = 7) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

async function trace(m, q) {
  const steps = [];
  const r = await m.respond(q, (s) => steps.push(s));
  return { r, steps };
}

const stepsNamed = (steps, name) =>
  steps.filter((s) => s.mechanism.at(-1) === name);

test("1 — CAST's schemas each contribute their own candidate to the decider", async () => {
  const m = mk(7);
  await m.ingest([
    ["Ice is cold", "cold"],
    ["Fire is hot", "hot"],
    ["Steel is hard", "hard"],
    ["Water is wet", "wet"],
  ]);
  const { r, steps } = await trace(m, "What if steel were cold?");
  assert.equal(r.provenance, "cast");

  const schemas = stepsNamed(steps, "castSchema");
  assert.ok(
    schemas.length >= 2,
    `expected at least two CAST schemas to fire, got ${schemas.length}`,
  );

  const decide = steps.find((s) => s.mechanism.at(-1) === "decideGrounding");
  assert.ok(
    decide,
    "decideGrounding must be traced when multiple candidates compete",
  );
  const castCandidates = decide.inputs.filter((i) => i.role.startsWith("cast"));
  assert.ok(
    castCandidates.length >= 2,
    `decideGrounding must show multiple CAST candidates, got ${castCandidates.length}`,
  );
  await m.store.close();
});

test("1b — different CAST schemas are weighed by their OWN explanatory power, not a shared span", async () => {
  // A 3-point weave: redirection transfers between the DOMINANT ("The Mona
  // Lisa..." exemplar) and the named substitute ("Pablo Picasso"), while
  // comparison pairs the dominant with a DIFFERENT analog reached through
  // the halo gate — two genuinely different point-pairs, so their accounted
  // spans (and hence weights) may legitimately differ by far more than any
  // fixed move-cost offset (at most CONCEPT + STEP ≈ 12). Before the fix,
  // every fired CAST schema shared ONE weave-wide `accounted` array
  // regardless of which points it actually used, so this spread was
  // impossible — schemas could only ever differ by move cost.
  const m = mk(2);
  await m.ingest([
    ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
    ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
    [
      "The Night Watch was painted by Rembrandt van Rijn.",
      "Rembrandt van Rijn",
    ],
    ["Pablo Picasso", "Pablo Picasso co-founded the Cubist movement"],
    ["Michelangelo", "Il Divino painted the Sistine Chapel ceiling"],
    ["a nickname meaning the divine one", "Michelangelo"],
    ["a nickname meaning the divine one", "Il Divino"],
    ["also called", "Michelangelo"],
    ["also called", "Il Divino"],
    ["known as", "Michelangelo"],
    ["known as", "Il Divino"],
    ["Il Divino", "Il Divino was a nickname coined by his contemporaries"],
  ]);
  const { r, steps } = await trace(
    m,
    "The Weeping Woman was painted by Pablo Picasso.",
  );
  // The correct answer is still reachable — the fix must not cost accuracy.
  const got = new TextDecoder().decode(r.bytes).replace(/\0/g, "");
  assert.ok(got.includes("Cubist"), `expected the Picasso fact, got "${got}"`);

  const decide = steps.find((s) => s.mechanism.at(-1) === "decideGrounding");
  const label = (i) => i.role.match(/unexplained: "([^"]*)"/)?.[1] ?? null;
  const cast = decide.inputs.filter((i) => i.role.startsWith("cast"));
  assert.ok(cast.length >= 1, "CAST must contribute a candidate at all");

  // THE PROPERTY, MEASURED WHERE IT IS STILL OBSERVABLE.  This test asserted
  // TWO CAST candidates whose weights diverge, and it can no longer: on this
  // fixture the comparison schema now honestly DECLINES (its analog is
  // frame-tier and dismisses stored query content, which is precisely what
  // test/50 pins), leaving redirection as the only schema that fires.  Three
  // replacement queries were measured hoping to reach a halo-tier comparison
  // here — "The Sistine Chapel ceiling was painted by Michelangelo.", "The
  // Pieta was sculpted by Michelangelo.", "How is Michelangelo like Il
  // Divino?" — and none produces a second CAST candidate either.  The junk
  // comparison that USED to supply it is the defect, not the coverage.
  //
  // What the shared-span bug would still show, with one schema, is this: a
  // CAST candidate carrying the whole WEAVE's alignment would account the same
  // query bytes as the mechanisms that read the whole query, and report the
  // same unexplained label.  Schema-specific accounting means it accounts what
  // ITS OWN two points cover — here redirection explains "The " that cover and
  // recall both leave unexplained, so its label is strictly SHORTER than
  // theirs and different in content.  That is the same property the weight
  // spread was evidence for, read directly off the accounting instead of
  // through two candidates.
  const castLabel = label(cast[0]);
  const others = decide.inputs
    .filter((i) => !i.role.startsWith("cast"))
    .map(label)
    .filter((x) => x !== null);
  assert.ok(castLabel !== null, "the CAST candidate must carry a label");
  assert.ok(
    others.length > 0 && others.every((o) => o !== castLabel),
    `CAST's accounted spans must be its OWN, not the weave's: its unexplained ` +
      `label "${castLabel}" must differ from every other mechanism's ` +
      `(${JSON.stringify(others)})`,
  );
  assert.ok(
    others.some((o) => o.length > castLabel.length),
    `redirection accounts query bytes the whole-query mechanisms do not, so ` +
      `its unexplained label must be shorter than theirs — got ` +
      `"${castLabel}" against ${JSON.stringify(others)}`,
  );
  await m.store.close();
});

test("2 — decideGrounding surfaces each candidate's unexplained label", async () => {
  const m = mk(7);
  await m.ingest([
    ["ice is cold so ice is brittle", "brittle"],
    ["steel is hard so steel is strong", "strong"],
    ["water is frigid so water is freezing", "freezing"],
  ]);
  const { steps } = await trace(m, "steel is frigid so steel is ???");
  const decide = steps.find((s) => s.mechanism.at(-1) === "decideGrounding");
  assert.ok(decide, "no decideGrounding step");
  assert.ok(
    decide.inputs.some((i) => i.role.includes("unexplained:")),
    "at least one candidate must carry a diagnostic unexplained label",
  );
  await m.store.close();
});

test("3 — a near-tie between the winner and runner-up emits narrowDecision", async () => {
  const m = mk(7);
  await m.ingest([
    ["ice is cold so ice is brittle", "brittle"],
    ["steel is hard so steel is strong", "strong"],
    ["water is frigid so water is freezing", "freezing"],
  ]);
  // The near-tie has to be REAL: two candidates whose accounted spans are the
  // same, separated by a single move.  `water is hard so water is ???` is that
  // — extraction and recall both explain the same span (grades 25011 and
  // 25010, margin 1).
  //
  // THIS FIXTURE HAS NOW BEEN REPLACED TWICE, BOTH TIMES FOR THE SAME REASON:
  // a mechanism that genuinely explains the query started firing, and a
  // decisive win is the opposite of what this test pins.
  //
  //   * `steel is frigid so steel is ???` was a near-tie only while CAST could
  //     not fire on it — CAST's subject gate used to reject any point whose
  //     alignment continued PAST the seat, which that fixture's recurrence
  //     guarantees.  With CAST firing it wins by 22008.
  //   * `steel is hard so steel is` was a near-tie only while prefix
  //     completion was a buried recall TIER.  As a market mechanism it grounds
  //     that query for what it is — the literal opening of exactly one trained
  //     form — at grade 1 against 21010, and answers `steel is hard so steel
  //     is strong`.  That is a better answer, not a regression.
  //
  // The lesson for whoever re-fixtures this next: pick a query no mechanism can
  // explain OUTRIGHT.  A trailing `???` is what keeps this one honest — it is
  // not the prefix of anything trained.
  const { steps } = await trace(m, "water is hard so water is ???");
  const narrow = stepsNamed(steps, "narrowDecision");
  assert.equal(narrow.length, 1, "expected exactly one narrowDecision step");
  assert.ok(/margin \d+ grade-unit/.test(narrow[0].note), narrow[0].note);
  assert.equal(narrow[0].inputs.length, 1);
  assert.equal(narrow[0].outputs.length, 1);
  await m.store.close();
});

test("3b — a clean, well-separated decision does NOT emit narrowDecision", async () => {
  const m = mk(7);
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  const { steps } = await trace(m, "ice");
  assert.equal(
    stepsNamed(steps, "narrowDecision").length,
    0,
    "a single, uncontested grounding must not be flagged narrow",
  );
  await m.store.close();
});

test("4 — a thin winning candidate is flagged thinGrounding", async () => {
  const m = mk(42);
  const SYS = "You are a helpful and harmless assistant.\n\n" +
    "You are not allowed to use any tools.\n";
  await m.ingest([
    [
      SYS + "Describe the importance of gender equality in the workplace.",
      "Gender equality means equal chances to be hired and promoted.",
    ],
    [
      SYS + "Provide a summary of the 1992 Dream Team basketball squad.",
      "The Dream Team won gold in Barcelona in 1992.",
    ],
    [
      SYS + "Explain how photosynthesis converts sunlight into energy.",
      "Photosynthesis binds carbon dioxide and water into sugar.",
    ],
    [
      SYS + "Summarize the causes of the fall of the Western Roman Empire.",
      "The Western Roman Empire fell from overreach and migration.",
    ],
  ]);
  // FOUR topics, not two.  The flag fires on the winning candidate's
  // COVERAGE DENSITY, so the fixture has to leave most of the query
  // unaccounted for the assertion to mean anything: the two-topic query this
  // used to ask is now explained densely enough to clear 1/W outright, and
  // asserting `thin.length === 1` against it would have been asserting that
  // the grounding stays BAD.  Naming four topics while one candidate can
  // ground only one keeps the density genuinely low (0.015 across seeds
  // 42/1/7/99, against a 0.250 bar).  4b below pins the other direction.
  const { r, steps } = await trace(
    m,
    SYS +
      "Tell me about gender equality at work, and also the 1992 Dream Team, " +
      "and photosynthesis, and the Western Roman Empire.",
  );
  assert.ok(r.v !== null, "the query must still ground an answer");
  const thin = stepsNamed(steps, "thinGrounding");
  assert.equal(thin.length, 1, "a low-density grounding must be flagged thin");
  const density = Number(/density ([\d.]+) /.exec(thin[0].note)[1]);
  const bar = Number(/is below 1\/W \(([\d.]+)\)/.exec(thin[0].note)[1]);
  assert.ok(
    density < bar,
    `fixture premise broken: the winning grounding covers density ${density} ` +
      `against a ${bar} bar, so it is not thin and this test no longer ` +
      `exercises the flag — name more topics rather than relaxing it.`,
  );
  await m.store.close();
});

test("4b — a fully-covered answer is NOT flagged thinGrounding", async () => {
  const m = mk(7);
  await m.ingest([["what is ice?", "ice is frozen water"]]);
  const { r, steps } = await trace(m, "what is ice?");
  assert.ok(r.v !== null);
  assert.equal(stepsNamed(steps, "thinGrounding").length, 0);
  await m.store.close();
});

test("5 — CAST is skipped by a dynamic floor when the climb can't support a weave", async () => {
  const m = mk(7);
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  const { steps } = await trace(m, "ice");
  const skip = stepsNamed(steps, "skipMechanism");
  assert.ok(
    skip.some((s) => /cast skipped/.test(s.note)),
    `expected a cast skipMechanism step, got: ${skip.map((s) => s.note)}`,
  );
  // And no CAST schema should have run at all — the floor pruned it
  // BEFORE counterfactualTransfer's own alignment work.
  assert.equal(stepsNamed(steps, "castSchema").length, 0);
  await m.store.close();
});
