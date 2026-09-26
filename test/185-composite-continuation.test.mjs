// 185-composite-continuation.test.mjs — the interior-offset probe of `recognise`.
//
// THE CAPABILITY.  A question that names the PARTS of a stored composite reaches the fact whose SUBJECT is those parts
// and answers with that fact's own continuation.  Before the probe the recogniser proposed only spans aligned to the
// question's own fold, so a stored form whose two edges are not fold cuts was never offered to the engine: measured, the
// two-part question below answered "Alderman is a settlement" — the second part's own fact — instead of the composite's
// continuation, which is the defect recorded in test/181's regime-B entry.
//
// HOW.  The probe offers the offsets INTERIOR to the gaps between consecutive content-defined cuts, paired on both
// edges, gated by `findFlatBranch` (the allocation-free branch probe) and confirmed by `canonResolve`/`resolve`.
// It runs for the node that IS the whole byte stream, once per byte stream.
//
// WHAT THIS FILE PINS: the answers themselves, the determinism of the reading, and that the instrumented counters are
// wired — NOT their magnitudes, which are a cost matter with its own measurement.
import test from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const A = "the founder was born in Alderman";
const B = "the capital is Brackwater";

async function mind() {
  const m = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
    profile: true,
  });
  await m.ingest([
    [A, "Alderman is a settlement"],
    [B, "Brackwater is a province"],
    [`${A} and ${B}`, "that settlement is Cordelia"],
    ["the note is filed", "the note is in folder"],
  ]);
  return m;
}

test("recognise(): a question naming the parts of a composite answers with the composite's own continuation", async () => {
  const m = await mind();
  const got = String(await m.respondText(`I ask: ${B}, and ${A}.`, () => {}));
  assert.match(
    got,
    /that settlement is Cordelia/,
    `the composite's continuation must be reachable through its parts, got: ${
      JSON.stringify(got)
    }`,
  );
  assert.match(
    got,
    /Alderman is a settlement/,
    `and the other part of the question stays explained too, got: ${
      JSON.stringify(got)
    }`,
  );
  await m.store.close();
});

test("recognise(): ONE part of the composite is enough to reach it", async () => {
  const m = await mind();
  const got = String(await m.respondText(`I ask: ${B}.`, () => {}));
  assert.equal(got.trim(), "that settlement is Cordelia");
  await m.store.close();
});

test("recognise(): the parts may be named in either order", async () => {
  const m = await mind();
  const got = String(await m.respondText(`I ask: ${A}, and ${B}.`, () => {}));
  assert.match(
    got,
    /that settlement is Cordelia/,
    `the store's order decides, not the question's, got: ${
      JSON.stringify(got)
    }`,
  );
  await m.store.close();
});

test("recognise(): the reading is deterministic across two answers", async () => {
  const m = await mind();
  const one = String(await m.respondText(`I ask: ${B}, and ${A}.`, () => {}));
  const two = String(await m.respondText(`I ask: ${B}, and ${A}.`, () => {}));
  assert.equal(two, one);
  await m.store.close();
});

test("recognise(): the interior tier is instrumented, and the whole-stream guard is what runs it", async () => {
  const m = await mind();
  await m.respondText(`I ask: ${B}, and ${A}.`, () => {});
  const c = m.lastCost?.counters ?? {};
  for (const k of ["recogniseInteriorGaps", "recogniseInteriorPairs"]) {
    assert.ok(
      Object.hasOwn(c, k),
      `the meter must carry ${k} — a cost claim with no counter is a claim with no evidence (got: ${
        Object.keys(c).join(",")
      })`,
    );
  }
  assert.ok(
    c.recogniseInteriorPairs > 0,
    "the interior tier must have probed at least one gated pair",
  );
  await m.store.close();
});
