// 38-reason-restate-guard.test.mjs — reason()'s multi-hop chain
// (absorbForward/pivotStep) must not walk onto a fixpoint whose bytes are
// ALREADY PRESENT in the query.
//
// Traced live (analyze_training.ts, dialogue D): a scaffolding-dominated
// query ("Can you help me with something?", accumulated on top of "Hello,
// how are you today?Hello! How can I assist you today?") legitimately
// grounds (recallByResonance tier 2, consensus-floor-gated) on an unrelated
// but well-corroborated anchor.  reason() then hops FORWARD from that
// grounding across two further, ungated steps and lands on the literal
// bytes "Hello" — content already sitting in the query's own first turn.
// The final answer is that bare, contextless echo.
//
// recallByResonance already refuses exactly this shape at grounding time —
// three separate guards (`restates`, tier 2's subspan check, tier 0b's
// argument-binding subspan check) all reject a candidate whose bytes are a
// proper byte-subspan of the query, because voicing them back only restates
// part of the question.  reason() is the one place that walks MULTIPLE
// additional hops past the initial (already-vetted) grounding, and it had
// no equivalent guard — every hop only checked structural novelty
// (`consumed`), never whether the result had drifted onto something the
// query already contains.  Fix: apply the same restates/subspan guard,
// verbatim, to reason()'s own hop candidates — no new tuned constant, just
// the existing convention applied where it was missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { reason } from "../dist/src/mind/reasoning.js";
import { gistOf, resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

const mk = (seed) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

test("reason(): a forward hop landing on bytes already present in the query is refused", async () => {
  const m = mk(1);
  // "bridge context" is a learnt fact SOURCE whose continuation is "Hello" —
  // the multi-hop chain's next, and only, forward step.
  await m.ingest([["ask topic", "bridge context"], [
    "bridge context",
    "Hello",
  ]]);

  // The query already contains "Hello" verbatim — e.g. a prior turn's own
  // greeting, exactly the accumulated-conversation shape from the live
  // trace.  The grounded starting answer is "bridge context" (as if some
  // upstream mechanism already grounded it) — reason()'s job is only to
  // decide whether to hop FURTHER from it.
  const query = enc("Hello, ask topic what happens next");
  const answer = enc("bridge context");
  const pre = {
    guide: gistOf(m, query),
    queryResolved: resolve(m, query),
  };

  const out = await reason(m, query, answer, new Set(), pre);
  assert.equal(
    dec(out),
    "bridge context",
    `must not hop onto "Hello" — it already restates content the query itself contains, got "${
      dec(out)
    }"`,
  );
  await m.store.close();
});

test("reason(): an ordinary forward hop onto genuinely new content is unaffected", async () => {
  const m = mk(1);
  await m.ingest([["ask topic", "bridge context"], [
    "bridge context",
    "a wholly new fact never mentioned in any query",
  ]]);

  const query = enc("Hello, ask topic what happens next");
  const answer = enc("bridge context");
  const pre = {
    guide: gistOf(m, query),
    queryResolved: resolve(m, query),
  };

  const out = await reason(m, query, answer, new Set(), pre);
  assert.equal(
    dec(out),
    "a wholly new fact never mentioned in any query",
    `an ordinary hop onto genuinely new content must still fire, got "${
      dec(out)
    }"`,
  );
  await m.store.close();
});
