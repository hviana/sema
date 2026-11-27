// 187-checkpoint-recall.test.mjs — the trainer's checkpoint recall is bounded
// for real, and reads without writing.
//
// The recall used to run `mind.respond` in the training thread under a
// setTimeout.  A respond holds the event loop for its whole run (its awaits
// resolve as microtasks, which drain before any timer), so the timeout could
// not fire and the deposit loop stood still until the answer came: on the
// 900 MB store a 26.7 s recall "returned in time" under the 15 s bound.  It now
// runs in a worker (example/train_base/recall.ts): its deadline terminates it,
// and the worker must answer as the training Mind would without writing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mind, SQliteStore } from "../dist/src/index.js";
import { recallInWorker } from "../dist/example/train_base/recall.js";

const D = 256, seed = 7;
const prompt = "Ada Lovelace date of birth";

/** A committed store, as a checkpoint leaves it, and its training Mind. */
async function trained() {
  const dir = mkdtempSync(join(tmpdir(), "recall-"));
  const path = join(dir, "s");
  const store = new SQliteStore({ path, D });
  const mind = new Mind({ seed, store });
  await mind.ingest(prompt, "The date of birth of Ada Lovelace is 1815.");
  await mind.ingest(
    "Ada Lovelace",
    "The date of birth of Ada Lovelace is 1815.",
  );
  await mind.ingest(
    "Alan Turing date of birth",
    "The date of birth of Alan Turing is 1912.",
  );
  store.commit();
  return { dir, path, store, mind };
}

test("a deadline shorter than the answer ends the recall", async () => {
  const { dir, path, store } = await trained();
  const job = recallInWorker({ path, D, seed, prompt }, 1);
  await assert.rejects(job.answer, /timed out after 1ms/);
  await job.opened; // settles even when the worker never opened
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("the worker answers as the training Mind, and writes nothing", async () => {
  const { dir, path, store, mind } = await trained();
  const files = ["sqlite", "derived.sqlite", "content.vec", "halo.vec"]
    .flatMap((f) => [`${path}.${f}`, `${path}.${f}-wal`]);
  const stamp = () =>
    files.map((f) => {
      try {
        const s = statSync(f);
        return `${f}:${s.size}:${s.mtimeMs}`;
      } catch {
        return `${f}:absent`;
      }
    }).join("\n");
  const before = stamp();
  const job = recallInWorker({ path, D, seed, prompt }, 60_000);
  await job.opened;
  const bytes = await job.answer;
  assert.equal(stamp(), before, "the recall wrote nothing to the store");
  const own = await mind.respond(prompt);
  assert.ok(bytes.length > 0, "it answered");
  assert.deepEqual(Buffer.from(bytes), Buffer.from(own.bytes));
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("187.3 the run's journal tells a suspended machine from a busy run", async () => {
  // A store keeps no clock, so a run that was slow could not say when, nor
  // whether it was running: the 2026-11 run lost three and a half hours to a
  // suspended machine inside a sixteen-hour stage, and only the system's own
  // journal showed it.  The trainer's journal reads two clocks: the wall
  // clock moving alone is the machine asleep (`slept`); both moving with no
  // deposit between is the run busy elsewhere (`quiet`).
  const { openJournal } = await import(
    "../dist/example/train_base/journal.js"
  );
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "sema-journal-"));
  const path = join(dir, "run.train.jsonl");
  let wall = Date.UTC(2026, 10, 3, 9, 0, 0), mono = 0;
  const pass = (ran, slept = 0) => {
    mono += ran * 1000;
    wall += (ran + slept) * 1000;
  };
  const journal = openJournal(path, 60_000, {
    wall: () => wall,
    mono: () => mono,
    memory: () => ({ rss: 1e9, heap: 2e8 }),
    free: () => 6.1e9,
  });
  journal.event("start", { deposits: 0, bytes: 0 });
  pass(30);
  journal.beat({ deposits: 9000, bytes: 700_000 }); // inside the interval
  pass(30);
  journal.beat({ deposits: 18_000, bytes: 1_400_000 }); // an ordinary minute
  pass(1, 3.5 * 3600);
  journal.beat({ deposits: 18_300, bytes: 1_420_000 }); // the lid was closed
  pass(1500);
  journal.beat({ deposits: 18_301, bytes: 1_420_100 }); // 25 busy minutes
  const lines = readFileSync(path, "utf8").trim().split("\n").map((l) =>
    JSON.parse(l)
  );
  rmSync(dir, { recursive: true });
  assert.deepEqual(lines.map((l) => l.kind), ["start", "beat", "beat", "beat"]);
  const [, minute, asleep, busy] = lines;
  assert.equal(minute.depPerS, 300);
  assert.equal(minute.kbPerS, 23.3);
  assert.equal(minute.slept, undefined);
  assert.equal(minute.freeGB, 6.1, "and the disk's room is on every line");
  assert.equal(asleep.slept, 12600, "the wall clock moved alone");
  assert.equal(asleep.depPerS, 300, "and the rate is of the time it ran");
  assert.equal(asleep.t, "2026-11-03T12:31:01.000Z");
  assert.equal(busy.quiet, 1440, "both clocks moved, with no deposit");
  assert.equal(busy.slept, undefined);
  // Disabled, it writes nothing and costs nothing.
  openJournal(join(dir, "none.jsonl"), 0).beat({ deposits: 1, bytes: 1 });
});
