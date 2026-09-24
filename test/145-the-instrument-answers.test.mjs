// 145-the-instrument-answers.test.mjs — a measurement must move what it claims to measure.
//
// WHY THIS FILE EXISTS.  During the derivation audit four probes were run and four times the
// instrument, not the engine, was wrong: a local import map that could not resolve the engine's
// types; a call I believed deposited text and deposited nothing; a trace note that never fired
// because the corpus did not reach it; and a two-hop question that grounded on one hop.  Every
// time the output looked like a result.  The guards that caught them lived inside the probes,
// and a probe is thrown away — so the two quantities this suite measures with are pinned here,
// where the next person will find them (AGENTS 6: close the gap in the instrumentation, once).
//
// WHAT IS PINNED.  `edgeSourceCount()` must MOVE when a deposit adds structure, and must NOT
// move when the same text is deposited again.  Positive and negative together are what make it
// an instrument: the first says it is alive, the second says it discriminates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mind, SQliteStore } from "../dist/src/index.js";

async function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "sema-145-"));
  const store = new SQliteStore({ path: join(dir, "store") });
  try {
    return await fn(new Mind({ seed: 7, store }), store);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("145.1 the instrument is alive: a deposit moves the edge-source count", async () => {
  await withStore(async (mind, store) => {
    const before = store.edgeSourceCount();
    await mind.ingest("a b c");
    const after = store.edgeSourceCount();
    assert.ok(
      after > before,
      `a deposit must move the count (was ${before}, now ${after}) — if it does not, ` +
        `every probe that reads this number measures the wrong quantity`,
    );
  });
});

test("145.2 the instrument discriminates: the same text moves nothing", async () => {
  await withStore(async (mind, store) => {
    await mind.ingest("a b c");
    const once = store.edgeSourceCount();
    await mind.ingest("a b c");
    assert.equal(
      store.edgeSourceCount(),
      once,
      "the same text again must not move the count — otherwise the number cannot tell " +
        "new structure from repeated text, and F of the audit would be unmeasurable",
    );
  });
});
