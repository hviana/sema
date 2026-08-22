// 96-bytes-walk-termination.test.mjs — `bytes()` must TERMINATE when its
// traversal memo cannot hold the reconstruction's working set.
//
// `bytes()` is an iterative post-order walk: it peeks the top of an explicit
// stack, pushes any child that is not yet resolved, and concatenates once every
// child is.  Its termination argument needs a memo that only ever GROWS.  It
// used `_bytesCache` — a byte-accounted BoundedMap that EVICTS, and whose
// `"smallest"` policy deliberately prefers the cheapest-to-rebuild entries,
// i.e. exactly the small, freshly-resolved children the parents still sitting
// on the stack are waiting for.  The parent finds them unresolved again,
// re-pushes them, they are re-resolved, re-inserted and re-evicted.  No
// progress.  The loop never exits.
//
// It stayed hidden because it needs the cache to be SATURATED, which only a
// long run reaches.  OBSERVED IN THE FIELD: a training run at 19.9M nodes with
// the 20 MB cache pinned at 19,999,962 bytes spun for 8h45m of 100% CPU on one
// node — whose entire content was 124 bytes, with 5 kids, 2 of them
// perpetually re-evicted.  Sampled 45s apart through the V8 inspector, the
// walk's root id, the node's length and the cache's byte count were all
// identical; only the stack depth oscillated between 1 and 2.
//
// And the loop is SYNCHRONOUS, so nothing could observe it: the trainer's
// 15-minute stall watchdog is a timer, and a timer cannot fire while the
// microtask/JS stack is occupied.  The run looked alive for 9 hours.
//
// The fix makes the walk memoize into a LOCAL map (`_bytesCache` demoted to a
// warm hint whose hit is promoted into that map immediately), so each node
// resolves at most once per call and termination is structural.
//
// This test does NOT depend on the eviction cursor's position — the field case
// reached the defect stochastically, via the cursor sweeping the map's
// recently-inserted tail.  Here the subtree's children simply sum to more bytes
// than the ceiling, so no cursor position can save it: pre-fix this file hangs
// forever, and `node --test` reports it only as a timeout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const D = 64;
const gist = () => {
  const v = new Float32Array(D);
  v[0] = 1;
  return v;
};

test("bytes() terminates when its memo cannot hold the working set", async () => {
  // A ceiling small enough to saturate in milliseconds.  The mechanism is
  // scale-free: this is the only thing scaled down from the field case.
  const CEILING = 4096;
  const store = new SQliteStore({
    D,
    bytesCacheMax: CEILING,
    path: ":memory:",
  });

  // One ordinary 9,600-byte form: 300 distinct 32-byte children under a root.
  const KIDS = 300, WIDTH = 32;
  const kids = [];
  for (let b = 0; b < KIDS; b++) {
    const buf = new Uint8Array(WIDTH);
    for (let i = 0; i < WIDTH; i++) buf[i] = (b * 131 + i * 17) & 0xff;
    kids.push(await store.putLeaf(buf, gist()));
  }
  const root = await store.putBranch(kids, gist());
  const expected = store.contentLen(root);
  assert.equal(expected, KIDS * WIDTH);

  // Churn the subtree out of the memo and leave it AT its ceiling — the steady
  // state every long run reaches.
  for (let k = 0; k < 4000; k++) {
    const buf = new Uint8Array(48);
    for (let i = 0; i < 48; i++) buf[i] = (k * 7919 + i * 251) & 0xff;
    await store.putLeaf(buf, gist());
  }

  // The premise the guard rests on: the memo genuinely cannot hold the working
  // set.  If a future change grows the ceiling or shrinks the fixture, this
  // assertion fails LOUDLY rather than letting the test pass vacuously.
  assert.ok(
    KIDS * WIDTH > CEILING,
    `fixture must exceed the memo ceiling (${KIDS * WIDTH} vs ${CEILING})`,
  );

  // Pre-fix this call never returns.  Post-fix it is sub-millisecond.
  const out = store.bytes(root);
  assert.equal(out.length, expected);
  for (let b = 0; b < KIDS; b++) {
    for (let i = 0; i < WIDTH; i++) {
      assert.equal(out[b * WIDTH + i], (b * 131 + i * 17) & 0xff);
    }
  }
});

test("differsByOneWindow's reads are capped — no ALL-sentinel read on deposit", async () => {
  // §2.8: the near-dedup byte check used to open with
  // `bytesPrefix(k, Number.MAX_SAFE_INTEGER)` — the ALL sentinel, which routes
  // to the full materialising `bytes()` — and only THEN compare lengths.  A
  // candidate the length test was about to reject had already been rebuilt byte
  // for byte, and that read is what dragged the deposit path into the walk
  // above.  Lengths now decide first, from the `contentLen` memo.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/store.ts", import.meta.url), "utf8")
  );
  const body = src.slice(src.indexOf("private differsByOneWindow"));
  const end = body.indexOf("\n  }\n");
  const fn = body.slice(0, end);
  assert.ok(
    !fn.includes("MAX_SAFE_INTEGER"),
    "differsByOneWindow must not read with the ALL sentinel",
  );
  assert.ok(
    fn.includes("this.contentLen("),
    "differsByOneWindow must decide on lengths before reading bytes",
  );
});
