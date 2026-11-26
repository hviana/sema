// train_base/recall.ts — the checkpoint recall, in a worker of its own.
//
// WHY A WORKER. `mind.respond` holds the event loop for its whole run: its
// awaits resolve as microtasks, which drain before any timer. In the training
// thread a timeout therefore cannot interrupt it, and the deposit loop stands
// still until it returns — measured on the 900 MB store: a 26.7 s recall
// "returned in time" under the 15 s timeout, ingestion stopped throughout. A
// worker has its own loop: training keeps depositing, and the deadline ends it
// for real (`terminate`).
//
// READ-ONLY BY CONSTRUCTION. The worker opens the store only after the
// checkpoint committed, so the derived layer is current and opening writes
// nothing; the training thread deposits again only once that open is done; and
// asking never writes (memoization.md). The worker never closes the store —
// close() persists filters, a write — it just ends.

import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import { Mind, SQliteStore } from "../../src/index.js";

/** What the worker needs to answer as the training Mind would. */
export interface RecallJob {
  path: string;
  D: number;
  seed: number;
  prompt: string;
}

/** A running recall: `opened` settles once the worker holds the store (or
 *  failed), `answer` with the recalled bytes, or rejects on error/deadline. */
export interface Recall {
  opened: Promise<void>;
  answer: Promise<Uint8Array>;
}

/** Start a recall in a worker, ended by `timeoutMs` whatever it is doing. */
export function recallInWorker(job: RecallJob, timeoutMs: number): Recall {
  const w = new Worker(new URL(import.meta.url), { workerData: job });
  w.unref(); // a diagnostic never holds the process open
  let opened!: () => void;
  const openedP = new Promise<void>((r) => (opened = r));
  const answer = new Promise<Uint8Array>((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error(`recall timed out after ${timeoutMs}ms`));
      void w.terminate();
    }, timeoutMs);
    deadline.unref();
    const settle = (err: Error) => {
      clearTimeout(deadline);
      opened();
      reject(err);
    };
    w.on("message", (m: { opened?: true; bytes?: Uint8Array }) => {
      if (m.opened) return opened();
      clearTimeout(deadline);
      resolve(m.bytes!);
      void w.terminate();
    });
    w.on("error", settle);
    w.on("exit", (code) => settle(new Error(`recall worker exited (${code})`)));
  });
  return { opened: openedP, answer };
}

if (!isMainThread && parentPort !== null) {
  const job = workerData as RecallJob;
  const store = new SQliteStore({ path: job.path, D: job.D });
  const mind = new Mind({ seed: job.seed, store });
  await store.getMeta("train.D"); // the open completes here
  parentPort.postMessage({ opened: true });
  const r = await mind.respond(job.prompt);
  parentPort.postMessage({ bytes: r.bytes });
}
