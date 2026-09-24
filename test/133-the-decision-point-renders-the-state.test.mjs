// 133-the-decision-point-renders-the-state.test.mjs — FAIL BEFORE, recorded first.
//
// THE CLAIM the extraction has to earn, from the acceptance file written and
// MEASURED BEFORE any line of the law existed (3 failures on a clean tree, each
// for its own reason).  The two assertions that are now green live here; the
// third — "the coverage scan exists exactly once in src/mind" — stays out of the
// tree until `reasoning.ts`'s brake is migrated onto the law, because until then
// it would be a red pin rather than a proof.
//
//   133.1 the state the pipeline decides on is RENDERED where it is decided —
//         remainder spans, their bytes, and the supplied fixed point — through
//         the official surface (inspectRationale's post-grounding step).  It
//         must fail today on the ASSERTION, not at import: the payload exists,
//         it simply does not carry the state.
//   133.2 the closure law is PRODUCER-FREE as an invariant: two states equal in
//         every field the law reads, differing only in a provenance label, get
//         identical verdicts for every continuation.  Fails today at import —
//         the law has no home yet.
//
// Nor does any accept `answer === expected` as proof: the first reads the
// official instrumentation and its agreement with the meter's own reading of the
// same remainder; the second is an invariant over states; the third reads the
// source.  The existing suites remain the GUARDS that the extractions change no
// answer — measured, before and after each step: answers, transition sequences
// and every meter counter identical.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { Mind, SQliteStore } = await import("../dist/src/index.js");

const CHAIN = [
  ["What is the capital of France", "The capital of France is Paris"],
  ["Paris", "Paris is famous for the Eiffel Tower"],
  ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
];
const CARRIED = [
  ["How do I compile hello.c?", "Run gcc hello.c"],
  ["How do I compile server.c?", "Run gcc server.c"],
  ["How do I compile parser.c?", "Run gcc parser.c"],
];

async function profile(facts, query) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(facts);
  const steps = [];
  await mind.respondText(query, (s) => steps.push(s));
  const out = { steps, counters: mind.lastCost?.counters ?? {} };
  await store.close();
  return out;
}

test("133.1 the decision point renders the state it decides on", async () => {
  const { steps, counters } = await profile(CHAIN, "What is the capital of France famous for");
  const pg = steps.filter((s) => s.data && s.data.preConsumed !== undefined);
  assert.ok(pg.length >= 1, "the post-grounding step must exist");
  const d = pg[pg.length - 1].data;
  assert.equal(
    typeof d.remainderSpans,
    "number",
    "the state's remainder must be rendered where it is decided — it is " +
      "today computed, used, and published only as an aggregate counter",
  );
  assert.equal(typeof d.remainderBytes, "number");
  assert.equal(typeof d.fixed, "boolean");
  assert.equal(
    d.remainderSpans,
    counters.postGroundingRemainderSpans,
    "the rendered state must agree with the meter's own reading of the same " +
      "remainder — one measure, rendered twice, never two measures",
  );
});

test("133.2 the law reads no producer, as an invariant over states", async () => {
  let law;
  try {
    law = await import("../dist/src/mind/derivation.js");
  } catch {
    assert.fail(
      "the closure law has no home yet: `admissible`/`advance`/`closed` must " +
        "live in one lowest-layer module so every tier can ask it",
    );
  }
  const query = new TextEncoder().encode("What is the capital of France famous for");
  const W = 4;
  const product = new TextEncoder().encode("qqqqqqqqqqqq");
  const open = {
    product,
    accounted: [],
    remainder: law.remainderOf(query.length, [], W),
    cost: 0,
  };
  const continuations = [
    { product, contains: true, cost: 1 },
    { product, contains: true, moves: true, cost: 1 },
    { product, contains: false, cost: 1 },
  ];
  for (const t of continuations) {
    const a = law.admissible(open, t, query, W);
    for (const label of ["cast", "cover", "recall", "reference", "alu", "prefix"]) {
      const b = law.admissible({ ...open, provenance: label }, t, query, W);
      assert.deepEqual(
        b,
        a,
        `the verdict changed when the state was labelled "${label}" — the law ` +
          `must be a function of the state and the continuation alone`,
      );
    }
  }
});


test("133.3 the law has one home and one definition", async () => {
  const mind = join(here, "..", "src", "mind");
  const files = await readdir(mind);
  assert.ok(
    files.includes("derivation.ts"),
    `the law's module must exist in the lowest mind layer; src/mind holds ${files.length} file(s)`,
  );
  const src = await readFile(join(mind, "derivation.ts"), "utf8");
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    imports,
    ["../bytes.js"],
    `the law may import byte helpers only — it imported ${JSON.stringify(imports)}`,
  );
  let scans = 0;
  for (const f of files) {
    if (!f.endsWith(".ts")) continue;
    const text = await readFile(join(mind, f), "utf8");
    scans += (text.match(/i \+ W <= b/g) ?? []).length;
  }
  assert.equal(
    scans,
    1,
    `the coverage scan (the law's own measure) must exist exactly once in ` +
      `src/mind — found ${scans}`,
  );
});
