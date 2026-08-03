// 74-prefix-trap-not-sprung-early.test.mjs — a query that is the OPENING of
// many trained forms must stay silent, at BOTH points where that decision can
// be made wrongly.
//
// THE SHAPE.  A corpus of templated facts ("what is the value of <i>?") holds
// thousands of forms sharing one long opening.  Asked the opening alone, the
// corpus does not say which one is meant, so the only honest answer is none.
// Two independent defects each voiced one anyway, and each is pinned here by a
// fixture the OTHER fix cannot rescue.
//
// 1. THE IDENTITY BRIDGE SPRANG THE PREFIX TRAP ITSELF.  With zero
//    substitutions the bridge claims "a trained context IS this query, up to
//    filler".  When the query is a strict byte PREFIX of that context, the
//    dismissed tail is exactly the discriminating part, and grounding through
//    it asserts a specification the asker never made.  It also PREEMPTED
//    prefixCompletion, which runs later and owns this decision.  Fixture 1
//    keeps every continuation at or above one grouping window, so guard 2b
//    below cannot fire and only the deferral can produce silence.
//
// 2. A SUB-QUANTUM CONTINUATION WAS DROPPED FROM THE UNIQUENESS TALLY.
//    prefixCompletion refuses to VOICE a below-window continuation, but it
//    also removed those candidates before counting, turning "many readings,
//    most unvoiceable" into "exactly one" — guard 3 then passed vacuously.
//    Fixture 2 makes the competing continuations sub-quantum and the survivor
//    voiceable, so ONLY guard 2b can produce silence.
//
// Both fixtures were measured before the fixes: fixture 1 answered "the value
// of 0 is 0", fixture 2 answered "the value of 10 is 20" — each an arbitrary
// pick from thousands of equally-good readings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { prefixCompletion } from "../dist/src/mind/mechanisms/prefix-completion.js";
import { resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);

const dec = new TextDecoder();
const say = async (m, q) => {
  const r = await m.respond(q);
  return dec.decode((r?.bytes ?? new Uint8Array()).filter((b) => b !== 0));
};

test("sub-quantum continuations still count as competing readings", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });

  // Continuations are " 0?", " 4?", " 8?" (3 bytes, sub-quantum at W=4) and
  // " 10?" (4 bytes, voiceable).  Dropping the short ones leaves exactly one
  // survivor — the vacuous uniqueness this test exists to prevent.
  const facts = [];
  for (let i = 0; i < 4300; i++) {
    facts.push([`what is the value of ${i}?`, `the value of ${i} is ${i * 2}`]);
  }
  await m.ingest(facts);

  const answer = await say(m, "what is the value of");
  assert.equal(
    answer,
    "",
    `forms opening with this query continue below one grouping window — ` +
      `they are competing readings, not absent ones; got ${
        JSON.stringify(answer.slice(0, 60))
      }`,
  );

  await m.store.close();
});

// GUARD 2b IN ISOLATION.  The end-to-end test above needs BOTH fixes (with the
// identity-bridge deferral disabled it fabricates before prefixCompletion is
// ever consulted), so it cannot attribute the silence to guard 2b alone.  This
// one calls the mechanism directly with a candidate list of exactly the shape
// that fooled it: several forms continuing below one grouping window and ONE
// continuing above it.  Dropping the short ones leaves a lone survivor and
// guard 3 passes vacuously — the defect — so a mechanism that answers here is
// counting evidence it discarded.
//
// Isolating the DEFERRAL the same way was attempted and is not achievable
// end-to-end: in every fixture whose continuations are all voiceable the
// bridge does not ground at all, so the deferral is unreachable and such a
// test asserts nothing.  It is pinned by the test above instead.
test("prefixCompletion refuses when dropped candidates were the disagreement", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });

  // W = 4.  " 0?"/" 4?"/" 8?" are 3 bytes — sub-quantum; " 10?" is 4.
  await m.ingest([
    ["what is the value of 0?", "zero"],
    ["what is the value of 4?", "four"],
    ["what is the value of 8?", "eight"],
    ["what is the value of 10?", "ten"],
  ]);

  const query = enc("what is the value of");
  const ranked = ["0?", "4?", "8?", "10?"].map((v) =>
    m.store.findLeaf(enc(`what is the value of ${v}`)) ??
      resolveForm(m, `what is the value of ${v}`)
  );

  const hit = prefixCompletion(m, query, ranked.filter((x) => x !== null));
  assert.equal(
    hit,
    null,
    `three forms open with this query and continue sub-quantum while one ` +
      `continues perceivably; the corpus offers competing readings, so no ` +
      `completion is licensed`,
  );

  await m.store.close();
});

function resolveForm(mind, text) {
  return resolve(mind, enc(text));
}
