// 160 — pieces of inference combine, whatever mechanism grounded them.
//
// A mechanism answers for the stretches of the question it explains.  One
// whose answer is a function of its one stretch alone declares it a PIECE
// (`MechanismResult.piece`), and the decider composes the question again with
// every piece in the one lightest-derivation search (composition.ts): the
// piece is fused, followed, recomposed or set beside a learnt rewrite exactly
// as a learnt form is.  The decider never asks which mechanism a piece came
// from — the first test registers a mechanism of its own, as any caller would.

import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultMechanisms, Mind } from "../dist/src/index.js";

const enc = (s) => new TextEncoder().encode(s);

/** A caller's mechanism: it reads `zz` as `XYZ`, a piece of the question. */
const zz = () => ({
  name: "zz",
  provenance: "zz",
  async floor(_ctx, query) {
    return new TextDecoder().decode(query).includes("zz") ? 1 : null;
  },
  async run(_ctx, query) {
    const at = new TextDecoder().decode(query).indexOf("zz");
    return [{ bytes: enc("XYZ"), accounted: [[at, at + 2]], moves: 1, piece: true }];
  },
});

test("160.1 a caller's piece and a learnt rewrite compose in one answer", async () => {
  const m = new Mind({ seed: 7, profile: true, mechanisms: [...defaultMechanisms, zz] });
  await m.ingest([["ice", "cold"]]);
  const r = await m.respond("ice zz");
  assert.equal(new TextDecoder().decode(r.bytes), "cold XYZ");
  assert.equal(r.provenance, "compose");
  assert.equal(m.lastCost.counters.composedGroundings, 1);
  await m.store.close();
});

test("160.2 a computation is a piece like any other: it composes and its node is followed", async () => {
  const m = new Mind({ seed: 7 });
  await m.ingest([["ice", "cold"]]);
  assert.equal(await m.respondText("ice 2+2"), "cold 4");
  await m.store.close();
  const n = new Mind({ seed: 7 });
  await n.ingest([["4", "four"]]);
  assert.equal(await n.respondText("2+2"), "four");
  await n.store.close();
});

test("160.3 an answer read off the whole question is no piece of it", async () => {
  // Recall answers `correct` for the stored `the answer is 4`, which the
  // question only resembles: composing it with the computed `4` voiced the 4
  // twice (`correct4`).  It stays whole, and wins whole.
  const m = new Mind({ seed: 7 });
  await m.ingest([["the answer is 4", "correct"]]);
  assert.equal(await m.respondText("the answer is 2+2"), "correct");
  await m.store.close();
});
