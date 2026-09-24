// 144-identity-is-content.test.mjs — two nodes with the same payload do not exist.
//
// WHAT IS PINNED.  Two of the audit's ten discriminating tests look like identity
// gaps and are not: F ("same payload in two nodes") and G ("the same structure by
// different paths").  The store is content-addressed, so the same text deposited
// twice adds NO structure at all, and the second deposit resolves to the very node
// the first one interned.  That is measured here, on the public surface, rather
// than argued.
//
// WHY IT MATTERS FOR THE LAW.  The layer's cycle control is a set of NODE IDS, so
// if identical content could live at two ids, the set would miss the second — which
// is what the audit suspected.  It cannot: identity IS the content.  The consequence
// is the audit's answer to G — "the same structure by another path" is the same
// node, and calling its re-reach a cycle is correct, because that node's content was
// already accounted for.
//
// The measurement also carries its own sanity: the first deposit MUST move the
// count, or the probe is measuring the wrong quantity and proves nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mind, SQliteStore } from "../dist/src/index.js";

test("144.1 depositing the same text twice adds no structure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sema-144-"));
  const stem = join(dir, "store");
  const store = new SQliteStore({ path: stem });
  try {
    const mind = new Mind({ seed: 7, store });
    const before = store.edgeSourceCount();
    await mind.ingest("a b c");
    const once = store.edgeSourceCount();
    await mind.ingest("a b c");
    const twice = store.edgeSourceCount();

    // SANITY FIRST: the quantity has to be one the deposit moves, otherwise the
    // assertion below is true for the wrong reason and pins nothing.
    assert.ok(
      once > before,
      `the first deposit must add structure (was ${before}, now ${once}) — ` +
        `if it does not, this test is measuring the wrong quantity`,
    );
    assert.equal(
      twice,
      once,
      "the same text deposited twice must not add structure: identity IS content",
    );
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
