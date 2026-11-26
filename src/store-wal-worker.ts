// store-wal-worker.ts — the store's WAL consolidation, off the writer's thread.
//
// A commit appends its pages to the write-ahead log; moving them into the
// database file (a checkpoint: scattered page writes, then a sync) is the
// slow half, and SQLite lets any connection do it while another writes.  Run
// inside a commit it stops the one thread that ingests.  Here it runs beside
// it: this thread holds its own connection to each file of the store and
// consolidates passively, so the writer mostly appends.  What the files come
// to hold is the same; only who waits for the disk changes.
//
// The store asks through one shared word: RUN, PAUSE (close every connection —
// a file is about to be replaced), STOP (close, and end).  Each is answered at
// the next pass.

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { workerData } from "node:worker_threads";

/** What the shared word says — the store writes the asks, this thread the
 *  answers. */
export const WAL_RUN = 0,
  WAL_PAUSE = 1,
  WAL_PAUSED = 2,
  WAL_STOP = 3,
  WAL_STOPPED = 4;

/** A pass that moved pages is followed at once; an idle one waits. */
const BUSY_MS = 20, IDLE_MS = 200;

interface Held {
  db: DatabaseSync;
  pass: ReturnType<DatabaseSync["prepare"]>;
  seen: string;
}

function consolidate(files: string[], flag: Int32Array): void {
  const held = new Map<string, Held>();
  const closeAll = (): void => {
    // The last connection to leave consolidates what is left and removes the
    // log: closing after the store's own connections is what leaves no WAL.
    for (const h of held.values()) h.db.close();
    held.clear();
  };
  const tick = (): void => {
    const asked = Atomics.load(flag, 0);
    if (asked === WAL_PAUSE || asked === WAL_STOP) {
      closeAll();
      Atomics.store(flag, 0, asked === WAL_STOP ? WAL_STOPPED : WAL_PAUSED);
      Atomics.notify(flag, 0);
      if (asked === WAL_STOP) return;
    }
    let moved = false;
    if (Atomics.load(flag, 0) === WAL_RUN) {
      for (const file of files) {
        let h = held.get(file);
        if (h === undefined) {
          // Never the first to open a file: its creator sets the page size.
          if (!existsSync(file)) continue;
          const db = new DatabaseSync(file);
          db.exec("PRAGMA synchronous = NORMAL;");
          h = {
            db,
            pass: db.prepare("PRAGMA wal_checkpoint(PASSIVE)"),
            seen: "",
          };
          held.set(file, h);
        }
        const r = h.pass.get() as { log: number; checkpointed: number };
        const now = `${r.log}:${r.checkpointed}`;
        if (now !== h.seen) moved = true;
        h.seen = now;
      }
    }
    setTimeout(tick, moved ? BUSY_MS : IDLE_MS);
  };
  tick();
}

if (workerData?.walFiles) {
  consolidate(
    workerData.walFiles as string[],
    new Int32Array(workerData.walFlag as SharedArrayBuffer),
  );
}
