// 91-branch-bytes-cache.test.mjs — reconstructing a node twice must not
// re-walk it.
//
// `bytesPrefix` rebuilds a node's bytes by descending the DAG, one `store.get`
// per node visited.  `_prefix` consults `_bytesCache` for EVERY id but used to
// populate it only for leaves, so a BRANCH re-walked its entire subtree on every
// request — and because the DAG is hash-consed, the same children recur under
// many different parents.
//
// MEASURED on the trained store (18,938,834 nodes), ONE 1,314-byte query:
//   _prefix calls (all levels) : 20,021,474
//   distinct ids               :    469,083   → 42.7x reuse
//   avoidable by a cache       : 19,552,391   → 97.7%
//   top-level calls            :     87,789 over 76,849 distinct (1.1x)
//   hottest id                 : a single-byte leaf, 2,599,984 reconstructions
//
// The 1.1x at the top level is why this hid for so long: measured there, reuse
// looks absent and a cache looks worthless.  All of the reuse is one level down.
//
// `_bytesCache` was already the right home — a byte-accounted BoundedMap with
// "smallest"/"clock" eviction, the configuration this codebase reserves for a
// TRANSPARENT cache (evicting costs a re-read and nothing else).  Reconstruction
// is a pure function of the store, so it qualifies; only the population was
// missing.
//
// WHAT THIS FILE ACTUALLY GUARDS — read this before trusting it.
//
// The re-walk assertion routes through `_prefix` (a CAPPED read), because that
// is where the fix lives.  `bytesPrefix(id, ALL)` short-circuits to `bytes()`
// (store.ts `bytesPrefix`: `maxLen >= 0x7fffffff → this.bytes(id)`), and
// `bytes()` has its OWN, pre-existing branch cache — so a re-walk assertion
// built on the ALL sentinel stays green when the `_prefix` fix is reverted and
// guards nothing (this file once did exactly that, and its header claimed the
// cause was "the node carries `flat` bytes", which is false: `flat` is
// STRUCTURAL — a branch stores its bytes flat iff every kid is an implicit
// single-byte leaf (store.ts `flatKidsBytes`) — and the fixture's node is
// non-flat, kids of real chunk nodes.  There is no size threshold that drops
// `flat`).
//
// With the fix, a capped read that completes the node caches the BRANCH
// (`got < maxLen` guard), so a second capped read is a full-cache hit and costs
// 0 node reads; with the fix reverted it re-reads the root (1 node read) because
// only the LEAVES are cached.  The signal is small at fixture scale precisely
// because the fixture's tree is shallow (root → flat chunks → leaves); the real
// 5.4–7.7× nodeRecords reduction is verified on the trained store instead.
//
// The TRUNCATION assertion at the end IS a real guard, verified red: with the
// `got < maxLen` condition removed, it fails with "a capped read poisoned the
// cache: the full read came back 29 bytes instead of 59".  That is the
// dangerous half of this fix — a truncated prefix served as a node's whole
// content would silently corrupt every later reader — so that is the half worth
// having a test for.
//
// The fix's real effect is verified on the trained store instead: identical
// answers and identical `bytesRead`/`byteReads`/`junctionPops`, with
// `nodeRecords` falling 1,182,651 → 218,449 · 2,462,577 → 321,794 ·
// 2,492,035 → 381,020 (5.4–7.7×), and the 1,314-byte query 14.0 s → 9.4 s.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { Meter } from "../dist/src/meter.js";

const ALL = 0x7fffffff;

test("a branch's bytes are reconstructed once, not re-walked", async () => {
  const store = new SQliteStore({ path: ":memory:", D: 256 });
  const mind = new Mind({ seed: 7, store });
  // Long deposits, so the nodes have real interior structure to re-walk.
  await mind.ingest([
    ["alpha", "the quick brown fox jumps over the lazy dog again and again"],
    ["beta", "the quick brown fox jumps over the lazy cat again and again"],
    ["gamma", "a quick brown fox once jumped over a lazy dog and then rested"],
  ]);

  // A branch node with interior structure — the deposit's own root.
  const tree = mind.perceive(
    "the quick brown fox jumps over the lazy dog again and again",
  );
  const id = mind.resolve(new TextEncoder().encode(
    "the quick brown fox jumps over the lazy dog again and again",
  ));
  assert.ok(id !== null, "the deposited form resolves to a stored node");
  assert.ok(tree.kids && tree.kids.length > 1, "and it has interior structure");

  // Route through `_prefix`, not `bytes()`: the ALL sentinel short-circuits to
  // `bytes()`, whose branch cache is pre-existing and would keep the assertion
  // green even with the `_prefix` fix reverted.  A capped read past the node's
  // full length completes the walk (so the branch gets cached, `got < maxLen`)
  // while staying off the ALL fast path.  `contentLen` warms `_recCache`/`_lenCache`
  // only, never `_bytesCache`, so the first read below starts cold.
  const fullLen = store.contentLen(id);
  store.meter = new Meter();
  const capped = fullLen + 1;

  // FIRST reconstruction — this one legitimately walks the subtree.
  const first = store.bytesPrefix(id, capped);
  const walked = store.meter.nodeRecords;
  assert.ok(
    first.length > 0,
    "the node reconstructs to bytes",
  );
  // NON-VACUITY: if the first read did no node reads either, the store answered
  // from some other cache and this test proves nothing about re-walking.
  assert.ok(
    walked > 0,
    `the first reconstruction did no node reads at all (nodeRecords=${walked}), ` +
      `so there is no re-walk for this test to detect`,
  );

  // SECOND reconstruction of the SAME node — must be free.
  const before = store.meter.nodeRecords;
  const second = store.bytesPrefix(id, capped);
  const again = store.meter.nodeRecords - before;

  console.log(
    `    first reconstruction: ${walked} node reads; second: ${again}`,
  );
  assert.deepEqual(second, first, "the cached bytes are the same bytes");
  assert.equal(
    again,
    0,
    `re-reading the same node cost ${again} node reads (the first cost ` +
      `${walked}) — reconstruction is a pure function of the store, so the ` +
      `second request must be served from _bytesCache, not re-walked`,
  );

  // AND a truncated read must never be cached AS the whole node: serving a
  // prefix as the full content would silently corrupt every later reader.
  const cut = Math.max(1, first.length >> 1);
  const store2 = new SQliteStore({ path: ":memory:", D: 256 });
  const mind2 = new Mind({ seed: 7, store: store2 });
  await mind2.ingest([[
    "alpha",
    "the quick brown fox jumps over the lazy dog again and again",
  ]]);
  const id2 = mind2.resolve(new TextEncoder().encode(
    "the quick brown fox jumps over the lazy dog again and again",
  ));
  store2.bytesPrefix(id2, cut); // truncated FIRST, so a bad cache would poison
  const whole = store2.bytesPrefix(id2, ALL);
  assert.equal(
    whole.length,
    first.length,
    `a capped read poisoned the cache: the full read came back ${whole.length} ` +
      `bytes instead of ${first.length}`,
  );

  await store.close();
  await store2.close();
});
