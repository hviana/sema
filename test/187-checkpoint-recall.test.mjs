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
