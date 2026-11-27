// train_base/journal.ts — the run's own record of WHEN.
//
// A store keeps no clock. After a run that was slow, nothing in it says which
// hour was slow, how long a checkpoint took, or whether the process was
// running at all: the 2026-11 run spent sixteen hours on a stage a fresh
// process trains in minutes, three and a half of them with the machine
// suspended, and only the system journal — not the run — could say so.
//
// The journal appends one JSON line per interval and per event to
// `{DB_PATH}.train.jsonl`: the wall time, the deposits and bytes so far, the
// rate over the interval, the process's memory, the space left on the store's
// disk (a store writes hundreds of bytes per byte learnt, and a full disk ends
// a run as surely as a crash), and two silences told apart by the two clocks —
//   • `slept`: the wall clock moved and the monotonic clock did not — the
//     machine was suspended (or the process stopped) for that long;
//   • `quiet`: both moved with no deposit between — the run was busy with
//     something that deposits nothing (a checkpoint, a download, a hang).
// It is evidence, never control: nothing reads it back, and a failed write is
// dropped rather than allowed to stop a deposit.

import { appendFileSync, statfsSync } from "node:fs";
import { dirname } from "node:path";

/** What a line reports of the run so far. */
export interface JournalCounts {
  deposits: number;
  bytes: number;
}

/** The clocks and the memory reading, injectable so the two silences can be
 *  shown apart without suspending a machine. */
export interface JournalClocks {
  wall: () => number;
  mono: () => number;
  memory: () => { rss: number; heap: number };
  /** Bytes free on the filesystem holding `path`, or null where unknown. */
  free: (path: string) => number | null;
}

/** Bytes free where `path` lives (its directory: the file may not exist
 *  yet), or null where the platform does not say. */
export function freeBytes(path: string): number | null {
  try {
    const s = statfsSync(dirname(path));
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

const realClocks: JournalClocks = {
  wall: () => Date.now(),
  mono: () => performance.now(),
  memory: () => {
    const m = process.memoryUsage();
    return { rss: m.rss, heap: m.heapUsed };
  },
  free: freeBytes,
};

export interface Journal {
  /** Offer the counters after a deposit; a line is written at most once per
   *  interval, so the call costs one clock read. */
  beat(c: JournalCounts): void;
  /** Record something that happened, with what it took. */
  event(kind: string, c: JournalCounts, data?: Record<string, unknown>): void;
}

/** A silence is reported past this many seconds: below it the two clocks'
 *  own jitter and an ordinary commit are all it would show. */
const SILENCE_S = 5;

/** Open the journal at `path`, one line per `intervalMs` of deposits.  An
 *  interval of 0 (or less) disables it: every call is then a no-op. */
export function openJournal(
  path: string,
  intervalMs: number,
  clocks: JournalClocks = realClocks,
): Journal {
  if (!(intervalMs > 0)) return { beat() {}, event() {} };
  let lastWall = clocks.wall();
  let lastMono = clocks.mono();
  let last: JournalCounts = { deposits: 0, bytes: 0 };
  let started = false;
  const write = (
    kind: string,
    c: JournalCounts,
    data: Record<string, unknown> = {},
  ): void => {
    const wall = clocks.wall(), mono = clocks.mono();
    const ran = (mono - lastMono) / 1000;
    const slept = (wall - lastWall) / 1000 - ran;
    const memory = clocks.memory();
    const free = clocks.free(path);
    const line: Record<string, unknown> = {
      t: new Date(wall).toISOString(),
      kind,
      deposits: c.deposits,
      mb: +(c.bytes / 1e6).toFixed(3),
      ...(started && ran > 0
        ? {
          seconds: +ran.toFixed(1),
          depPerS: +((c.deposits - last.deposits) / ran).toFixed(1),
          kbPerS: +((c.bytes - last.bytes) / 1000 / ran).toFixed(1),
        }
        : {}),
      ...(started && slept > SILENCE_S ? { slept: +slept.toFixed(0) } : {}),
      rssMB: Math.round(memory.rss / 1e6),
      heapMB: Math.round(memory.heap / 1e6),
      ...(free !== null ? { freeGB: +(free / 1e9).toFixed(1) } : {}),
      ...data,
    };
    try {
      appendFileSync(path, JSON.stringify(line) + "\n");
    } catch {
      // Evidence, never control: a full disk must not stop the run here.
    }
    lastWall = wall;
    lastMono = mono;
    last = { ...c };
    started = true;
  };
  return {
    beat(c) {
      const mono = clocks.mono();
      if (started && mono - lastMono < intervalMs) {
        // …unless the wall clock ran far ahead of the monotonic one: a
        // suspend is reported when the run comes back, not an interval later.
        const slept = (clocks.wall() - lastWall - (mono - lastMono)) / 1000;
        if (slept <= SILENCE_S) return;
      }
      // A beat that arrives long after the interval was due found the run
      // busy elsewhere for that long.
      const quiet = started ? (mono - lastMono - intervalMs) / 1000 : 0;
      write("beat", c, quiet > SILENCE_S ? { quiet: +quiet.toFixed(0) } : {});
    },
    event(kind, c, data) {
      write(kind, c, data);
    },
  };
}
