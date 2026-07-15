// 26-cooperative.test.mjs — INGESTION MUST YIELD TO THE EVENT LOOP.
//
// A long ingest is CPU-bound work (perceive + intern + the synchronous vector-
// index writes at each batch flush). Node is single-threaded and cooperative:
// the ONLY way a timer callback, a pending I/O completion, or any other queued
// MACROTASK gets to run is if the running code returns to the event loop between
// units of work. `await` alone does NOT do this — a promise that is already
// resolved (or resolves synchronously, as every await inside the store's ingest
// path does) schedules its continuation on the MICROTASK queue, which the engine
// drains to EMPTY before it ever services a single macrotask. So a bulk ingest
// that only ever awaits already-settled promises monopolises the thread for its
// entire duration: nothing else scheduled can run until it finishes.
//
// This is the defect this file guards. It is a property of the CORE ingest path,
// not of any UI: a training driver that pins a 250ms progress timer, or overlaps
// downloading the next shard while depositing the current one, is silently
// starved — the timer does not fire, the socket is not drained — for as long as
// a deposit burst runs. The symptom a caller SEES is a frozen display and stalls
// in concurrent work; the CAUSE is here, so the guard is here.
//
// The test is deterministic and timing-jitter-free: it does NOT assert on wall
// clock. It arms a macrotask (setTimeout(…,0)) BEFORE a burst of ingests and
// checks whether it ran DURING the burst. A cooperative ingest path lets it run;
// a starving one does not. That yes/no fact is exact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// Genuinely novel content: distinctive tokens that intern fresh leaves/branches
// and index new gists every call, so the burst does REAL work (many batch
// flushes), the same expensive path a real corpus drives — never a dedup no-op.
function novel(i, salt) {
  const w = [];
  for (let k = 0; k < 16; k++) w.push(`${salt}z${i}q${k}u${(i * 97 + k * 7)}`);
  return w.join(" ");
}

test("ingestion yields to the event loop (a macrotask armed before a burst runs DURING it)", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });

  // Warm past the first batch flush so the burst measures steady state.
  for (let i = 0; i < 200; i++) {
    await mind.ingest(novel(i, "warm"), novel(i, "warmb"));
  }

  // A macrotask that records how many ingests had completed each time it ran.
  // Re-arms itself so we sample the WHOLE burst, not just the first gap.
  let ticks = 0;
  let done = 0;
  const firstTickAt = [];
  let stop = false;
  const arm = () => {
    if (stop) return;
    setTimeout(() => {
      ticks++;
      firstTickAt.push(done);
      arm();
    }, 0);
  };
  arm();

  // A burst big enough to span MANY batch flushes (batchSize=1024 vectors; a
  // 16-word pair indexes dozens of vectors, so ~600 pairs is tens of flushes).
  const BURST = 600;
  for (let i = 0; i < BURST; i++) {
    await mind.ingest(novel(i, "burst"), novel(i, "burstb"));
    done++;
  }
  stop = true;
  await store.close();

  console.log(
    `    during a ${BURST}-ingest burst, the 0ms macrotask ran ${ticks} time(s)` +
      (ticks > 0 ? ` (first after ${firstTickAt[0]} ingests)` : " — STARVED"),
  );

  // The contract: the event loop is serviced DURING the burst, not only after it.
  // A starving path leaves ticks === 0 (the timer callback is stuck behind the
  // whole burst's microtask chain). A cooperative path lets it fire repeatedly.
  assert.ok(
    ticks > 0,
    `a macrotask armed before a ${BURST}-ingest burst never ran during it — the ` +
      `ingest path monopolises the event loop (microtask-only awaits), starving ` +
      `timers, I/O completions, and any overlapped work for the burst's duration`,
  );
});
