// 115-the-canonical-query-scan-is-cached.test.mjs — the query's canonical-node
// scan is answered from its cache within a response (M8, adversarial review).
//
// THE DEFECT THIS CLOSES.  `canonicalQueryNodes` keyed its cache on the ARRAY
// IDENTITY of the query bytes.  A re-cover hands the method a FRESH array over
// the same bytes (`recompleteNode` builds its own), so the slot missed on every
// nested solve and the O(queryLen x form) scan re-ran each time.  Content is the
// convention every other memo in the mind uses (`perceiveMemo`, `canonMemo`), so
// it is keyed by content now, in one slot that cannot grow.
//
// WHAT IS PINNED, and what is NOT.  The meter publishes `canonQueryCacheHits`,
// so "the scan was answered from its cache" is observable and asserted here.
// The content-versus-identity distinction ITSELF is not observable from outside
// the search — the inner `canonMemo` absorbs the repeated `canonResolve` calls
// either way, which is also why an adversarial review could not measure a cost.
// This is therefore a PREVENTIVE fix: it removes a latent re-scan, and this test
// pins that the cache is live at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

/** A chain whose solve RE-COVERS produced composites (test/102's shape). */
async function chain() {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["seed", "p q"],
    ["p", "r"],
    ["q", "s"],
    ["r s", "m n"],
  ]);
  return mind;
}

const hits = (mind) => mind.lastCost?.counters.canonQueryCacheHits ?? 0;

test("the canonical-query scan is served from its cache, not re-run", async () => {
  const mind = await chain();
  await mind.respondText("seed");
  assert.ok(
    hits(mind) > 0,
    "the scan must be cacheable within a response (a cache that never hits is " +
      "a scan with extra bookkeeping)",
  );
  await mind.store.close();
});

test("a query that needs one grounding still resolves it (cache must not lie)", async () => {
  const mind = await chain();
  const out = (await mind.respondText("seed")).replace(/\0+/g, "").trim();
  assert.ok(out.length > 0, `the chain must still answer, got ${JSON.stringify(out)}`);
  await mind.store.close();
});
