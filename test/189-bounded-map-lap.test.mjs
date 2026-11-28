// 189-bounded-map-lap.test.mjs — a "clock" cache keeps admitting what is new.
//
// `BoundedMap` under `recency: "clock"` records a hit as a bit and gives the
// entry a second chance: the eviction cursor passes it and leaves it BEHIND.
// Each second chance therefore brings the cursor one step nearer the tail of
// the map, and a Map iterator standing at the tail is not done — it yields the
// next key appended.  Eviction only runs right after an append, so the cursor
// never saw the end: once at the tail it evicted every key as it arrived, and
// the cache held the population it had, forever, admitting nothing.
//
// MEASURED on a live training run (store of 22,285,195 node ids, read through
// the inspector): `_lenCache` held 1,250,000 keys, all ≤ 1,723,440;
// `_recCache` 290,400 keys, all ≤ 448,887; 99% of the CPU was the near dedup
// re-deriving lengths it had just derived, at 0.5 deposits/s.  The moment the
// cursors wrapped, the same process on the same rows ran at 162, then 200–270.
// A fresh process never accumulates the second chances — one per entry of the
// budget — which is why the slowdown never reproduced in one.
//
// The law pinned here: a sweep is over the entries that were there when it
// began; the first key appended since ends it (`_lapEnd`), and the next sweep
// starts from the front.  A cache is only a memo, so every assertion below is
// about what it KEEPS, never about what it answers — and the last test pins
// that too: whatever it returns is what was last set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoundedMap } from "../dist/src/store.js";

const CAP = 1000;

/** A deposit-shaped workload: every step appends one new key, then re-reads
 *  what it appended 1, 5 and 50 steps ago — all well inside a budget of
 *  `CAP` entries, so an LRU of that size answers every one of them.  Returns
 *  the hit rate over the LAST half of the run. */
function recentReuse(map, steps) {
  let hits = 0, reads = 0;
  for (let i = 0; i < steps; i++) {
    map.set(i, i);
    for (const back of [1, 5, 50]) {
      if (i < back) continue;
      const v = map.get(i - back);
      if (i >= steps / 2) {
        reads++;
        if (v !== undefined) hits++;
      }
    }
  }
  return hits / reads;
}

for (const evict of ["lru", "smallest"]) {
  test(`clock/${evict}: recent keys stay cached past any number of second chances`, () => {
    // 200,000 steps give 600,000 hits against a budget of 1,000 entries: six
    // hundred times the second chances that used to bring the cursor to the
    // tail (the old build answers 0% here; exact LRU answers 100%).
    const clock = new BoundedMap(CAP, () => 1, evict, "clock");
    const exact = new BoundedMap(CAP, () => 1, evict, "reorder");
    const got = recentReuse(clock, 200_000);
    const ref = recentReuse(exact, 200_000);
    assert.equal(ref, 1, "the reference LRU answers every recent re-read");
    assert.ok(
      got >= 0.99,
      `clock answered ${(100 * got).toFixed(1)}% of re-reads an LRU of the ` +
        `same budget answers in full`,
    );
    assert.ok(clock.size <= CAP && clock.bytes <= CAP, "the budget holds");
  });
}

test("clock: with no hits it is a FIFO — the newest budget's worth is what it holds", () => {
  const m = new BoundedMap(CAP, () => 1, "lru", "clock");
  const N = 10 * CAP + 37;
  for (let i = 0; i < N; i++) m.set(i, i);
  assert.equal(m.size, CAP);
  for (let i = N - CAP; i < N; i++) assert.ok(m.has(i), `key ${i} is held`);
});

test("clock: a key that was hit outlives one sweep, not two", () => {
  const m = new BoundedMap(CAP, () => 1, "lru", "clock");
  for (let i = 0; i < CAP; i++) m.set(i, i);
  m.get(0); // one hit, never again
  for (let i = CAP; i < 2 * CAP - 1; i++) m.set(i, i);
  assert.ok(m.has(0), "second chance: the sweep passed it by");
  for (let i = 2 * CAP - 1; i < 4 * CAP; i++) m.set(i, i);
  assert.ok(!m.has(0), "unused since, the next sweep takes it");
});

test("clock: the lap survives its end being set again or deleted", () => {
  // The lap's end is a KEY, and a key can be set again (it moves to the tail)
  // or deleted before the cursor reaches it.  Either must end the lap — never
  // leave the cursor to run on into what is new.
  const m = new BoundedMap(CAP, () => 1, "lru", "clock");
  let hits = 0, reads = 0;
  for (let i = 0; i < 100_000; i++) {
    m.set(i, i);
    if (i % 3 === 0) m.set(i, i); // set again at once
    if (i % 7 === 0) m.delete(i - 2); // a recent key deleted
    if (i >= 60) {
      // i − 60 is deleted for one i in seven (it was some j − 2 with 7 | j).
      const gone = (i - 60 + 2) % 7 === 0;
      if (!gone && i >= 50_000) {
        reads++;
        if (m.get(i - 60) !== undefined) hits++;
      } else m.get(i - 60);
    }
    assert.ok(m.size <= CAP);
  }
  assert.ok(
    hits / reads >= 0.99,
    `answered ${(100 * hits / reads).toFixed(1)}% of recent re-reads`,
  );
});

test("clock: whatever it answers is what was last set", () => {
  // Byte-budgeted, variable sizes, both eviction rules: a hit returns the
  // value last set under that key, a miss returns undefined, and the byte
  // account never exceeds the budget.
  for (const evict of ["lru", "smallest"]) {
    const m = new BoundedMap(4096, (v) => v.length, evict, "clock");
    const truth = new Map();
    let x = 12345;
    const rnd = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 2 ** 32;
    for (let i = 0; i < 50_000; i++) {
      const k = Math.floor(rnd() * 3000);
      if (rnd() < 0.4) {
        const v = new Uint8Array(1 + Math.floor(rnd() * 64)).fill(i & 255);
        m.set(k, v);
        truth.set(k, v);
      } else {
        const v = m.get(k);
        if (v !== undefined) assert.equal(v, truth.get(k));
      }
      assert.ok(m.bytes <= 4096);
    }
  }
});
