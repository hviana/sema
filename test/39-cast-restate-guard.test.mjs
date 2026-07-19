// 39-cast-restate-guard.test.mjs — CAST's substitution schema
// (projectCounterfactual, cast.ts) must not append a forward-followed edge
// whose bytes are ALREADY PRESENT in the query — the same defect test/38
// fixed in reason(), found again in a sibling mechanism.
//
// Traced live (analyze_training.ts, dialogue D, turn 4): CAST's substitution
// schema transfers a displaced structure onto a filler ("Bitte spiele...");
// after building the substitution, it separately follows the displaced
// structure's OWN learnt forward-continuation edge and appends whatever
// that turns up — in the live trace, the literal bytes "Hello", because in
// the training corpus that structure happens to be followed, in some
// wholly unrelated conversation, by another dialogue opening with "Hello".
// The accumulated query's own first turn is "Hello, how are you today?", so
// the appended "Hello" restates content the query already contains — the
// SAME defect class as test/38, just reached through cast.ts's own
// `follow()` call (line ~299) instead of reason()'s hop loop.  The old
// guard there only checked the candidate wasn't already inside the
// PARTIALLY-BUILT ANSWER (`indexOf(answer, fwd, 0) < 0`) — never that it
// wasn't already in the QUERY.  Fix: reuse `restatesQuery` (exported from
// reasoning.ts, the exact function test/38 introduced) at the same call
// site — no new tuned constant, the existing convention extended to a
// second place it was missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = (seed) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

test("CAST substitution: a followed edge landing on bytes already present in the query is refused", async () => {
  const m = mk(7);
  // "Ice is cold" is CAST's displaced structure for "What if steel were
  // cold?" (mirrors test/33's own substitution corpus).  A second edge from
  // the SAME source, corroborated by a second, unrelated predecessor, makes
  // "Water is wet" — and, one further hop, "wet" — its resonance-preferred
  // forward continuation, exactly the "some other conversation continues
  // from the same node" shape the live trace showed.
  await m.ingest([
    ["Ice is cold", "cold"],
    ["Fire is hot", "hot"],
    ["Steel is hard", "hard"],
    ["Water is wet", "wet"],
    ["Ice is cold", "Water is wet"],
    ["Something else entirely", "Water is wet"],
  ]);

  const steps = [];
  // The query already contains "wet" verbatim (as if some earlier turn had
  // already mentioned it) — reason() and CAST both must recognise the
  // followed edge restates it, not append it a second time.
  const r = await m.respond(
    "What if steel were cold? Not wet.",
    (s) => steps.push(s),
  );
  const got = new TextDecoder().decode(r.bytes).replace(/\0/g, "");
  assert.ok(
    !got.includes("wet") || got.includes("Not wet"),
    `substitution must not append "wet" a second time — it already restates ` +
      `the query, got "${got}"`,
  );

  const proj = steps.find((s) =>
    s.mechanism.at(-1) === "projectCounterfactual" &&
    s.inputs.some((i) => i.role === "filler")
  );
  assert.ok(
    proj,
    "expected the substitution schema's projectCounterfactual step",
  );
  const projected = new TextDecoder().decode(
    new TextEncoder().encode(proj.outputs[0].text),
  );
  assert.ok(
    !projected.includes("wet"),
    `the substitution's own projection must stop before the restating hop, got "${projected}"`,
  );
  await m.store.close();
});

test("CAST substitution: an ordinary followed edge onto genuinely new content is unaffected", async () => {
  const m = mk(7);
  await m.ingest([
    ["Ice is cold", "cold"],
    ["Fire is hot", "hot"],
    ["Steel is hard", "hard"],
    ["Water is wet", "wet"],
    ["Ice is cold", "Water is wet"],
    ["Something else entirely", "Water is wet"],
  ]);

  const steps = [];
  const r = await m.respond("What if steel were cold?", (s) => steps.push(s));
  const got = new TextDecoder().decode(r.bytes).replace(/\0/g, "");
  assert.ok(
    got.includes("wet"),
    `an ordinary followed edge onto content the query never mentioned must ` +
      `still fire, got "${got}"`,
  );
  await m.store.close();
});
