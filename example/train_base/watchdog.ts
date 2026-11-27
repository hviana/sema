// train_base/watchdog.ts — the stall watchdog, watching from OUTSIDE the loop
// it watches.
//
// A hang must become a resume, never a zombie (runtime.ts).  The check used to
// be a timer in the training thread, and that thread is the thing that hangs:
// ingestion holds the event loop for minutes at a time (83 s measured), a
// blocked loop runs no timer, and so the one failure the watchdog exists for
// was the one it could not see.  It also read the wall clock, so a machine
// back from three hours of suspend looked like three hours without progress.
//
// Here the check runs in a worker.  The run's beats are a counter in shared
// memory, written by a plain store — no message, no await, so a thread that
// never yields still shows its progress; the worker reads it against the
// MONOTONIC clock, which does not move while the machine sleeps.  On a stall
// it first asks the training thread to end the run (the clean exit, with its
// exit code); if that thread does not answer within one more look it is
// blocked, and the worker ends the process itself.

import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import { writeSync } from "node:fs";

/** The shared words: beats so far, depth of deposit-free work the run
 *  declared, the stop request, and the training thread's answer to a stall. */
const BEATS = 0, QUIET = 1, STOP = 2, ANSWERED = 3;

export interface Watchdog {
  /** Any progress at all: a deposit, a downloaded chunk, a rate-limit wait. */
  beat(): void;
  /** Enter (+1) or leave (−1) work that legitimately deposits nothing. */
  quiet(by: 1 | -1): void;
  /** End the watch (the run is finishing). */
  stop(): void;
}

/** Watch for `stallMs` without a beat.  `onStall(minutes)` runs in the
 *  calling thread when it can still answer — it should end the run; where it
 *  cannot, the process is killed, `blocked` naming why on stderr first. */
export function startWatchdog(
  stallMs: number,
  onStall: (minutes: number) => void,
  blocked: string,
): Watchdog {
  if (!(stallMs > 0)) return { beat() {}, quiet() {}, stop() {} };
  const words = new Int32Array(new SharedArrayBuffer(16));
  const w = new Worker(new URL(import.meta.url), {
    workerData: { words, stallMs, blocked, pid: process.pid },
  });
  w.unref(); // the watch never holds the process open
  w.on("message", (minutes: number) => {
    Atomics.store(words, ANSWERED, 1);
    onStall(minutes);
  });
  // A watchdog that fails must not end the run — and must not fail unseen.
  w.on("error", (e) => {
    process.stderr.write(
      `\n⚠ the stall watchdog stopped (${
        e instanceof Error ? e.message : String(e)
      }); the run goes on unwatched.\n`,
    );
  });
  return {
    beat() {
      Atomics.add(words, BEATS, 1);
    },
    quiet(by) {
      Atomics.add(words, QUIET, by);
      Atomics.add(words, BEATS, 1);
    },
    stop() {
      Atomics.store(words, STOP, 1);
      Atomics.notify(words, STOP);
    },
  };
}

if (!isMainThread && parentPort !== null && workerData?.words) {
  const { words, stallMs, blocked, pid } = workerData as {
    words: Int32Array;
    stallMs: number;
    blocked: string;
    pid: number;
  };
  // Looked at four times per allowance, and at least every half minute.
  const look = Math.min(30_000, Math.max(1, Math.floor(stallMs / 4)));
  let seen = Atomics.load(words, BEATS);
  let since = performance.now(); // monotonic: a sleeping machine is no stall
  // `Atomics.wait` is the sleep: it returns early only when asked to stop.
  while (Atomics.wait(words, STOP, 0, look) === "timed-out") {
    const beats = Atomics.load(words, BEATS);
    if (beats !== seen || Atomics.load(words, QUIET) > 0) {
      seen = beats;
      since = performance.now();
      continue;
    }
    const silent = performance.now() - since;
    if (silent < stallMs) continue;
    // Ask the training thread first: alive, it ends the run cleanly.
    parentPort.postMessage(Math.round(silent / 60_000));
    if (Atomics.wait(words, STOP, 0, look) !== "timed-out") break;
    if (Atomics.load(words, ANSWERED) !== 0) break;
    if (Atomics.load(words, BEATS) !== seen) { // it moved after all
      seen = Atomics.load(words, BEATS);
      since = performance.now();
      continue;
    }
    // No answer: that thread is blocked, and nothing it scheduled will run.
    writeSync(2, blocked);
    process.kill(pid, "SIGKILL");
    break;
  }
}
