// train_base/config.ts — RUN-LEVEL configuration, all from the environment.
//
// Only knobs that describe the RUN live here: the store, the checkpoint cadence,
// the cache ceiling, the read budgets, the caps. A knob that describes ONE
// CORPUS (which pairs of SmolSent, how many SODA dialogues, how long an Aya
// field may be) belongs next to that corpus's adapter, together with the
// evidence that fixed its default — see AGENTS.md §2.16: a comment carries the
// constraint, and a constraint is only readable beside the code it constrains.

import { join } from "node:path";

/** Read an environment variable, or `d` when it is unset. */
export const env = (k: string, d: string): string => process.env[k] ?? d;

export const DB_PATH = env("DB_PATH", "sema"); // → {DB_PATH}.sqlite
export const D = Number(env("D", "1024"));
export const SEED = Number(env("SEED", "7"));

// Checkpoint cadence is measured in LEARNED CONTENT, not deposits: a snapshot
// every CHECKPOINT_MB megabytes of trained UTF-8 content (decimal MB, matching
// the bytes() helper). A floor of 1 MB: a zero/NaN value must not make every
// deposit checkpoint, nor silently disable checkpointing. The tail (a run that
// learns less than one interval, or the remainder past the last interval) is
// always saved by finish() at exit — a complete point.
export const CHECKPOINT_BYTES = Math.max(
  1_000_000,
  Math.floor(Number(env("CHECKPOINT_MB", "100")) * 1_000_000) || 100_000_000,
);

// Target size of ONE materialised Parquet read, in uncompressed source bytes.
// A row-GROUP is a layout choice made by whoever wrote the file, not a memory
// budget: Aya ships 203 groups of 1,000 rows (~1 MB each), while SODA ships ONE
// group of 1,191,582 rows (1.19 GB uncompressed) and 2Wiki ONE of 167,454
// (666 MB). Reading "exactly one row-group" is therefore safe for the first and
// fatal for the others, so reads are sized in BYTES instead — see
// `parquetBatchRows`. Materialised JS objects cost several times their source
// bytes, hence a default well under available memory.
export const PARQUET_BATCH_BYTES = Math.max(
  1_000_000,
  Math.floor(Number(env("PARQUET_BATCH_MB", "32")) * 1_000_000) || 32_000_000,
);

export const LOCAL_PATH = env("LOCAL_PATH", ""); // train from a local dir
export const CACHE_DIR = env("CACHE_DIR", join(process.cwd(), "cache"));
export const MAX_CACHE_BYTES = Number(env("MAX_CACHE_GB", "100")) * 1e9;
export const PROGRESS_MS = Number(env("PROGRESS_MS", "250")); // panel cadence

// Index maintenance at checkpoints: compact (remove garbage), repair (fill
// gaps), then refresh the canonical-form index (equivalence-class resolution —
// src/canon.ts). All three are idempotent batch operations (the canon build is
// additionally incremental via the store's `canon.upto` cursor);
// INDEX_MAINTENANCE=0 disables.
export const INDEX_MAINTENANCE = env("INDEX_MAINTENANCE", "1") !== "0";
export const DOWNLOAD_TRIES = 5;

// In-progress downloads are written to a sibling "<dest>.part" and atomically
// renamed into place only after the bytes are fully flushed to disk. The cache
// invariant is therefore absolute: a file at its final path is, by definition,
// complete. Partial transfers (a crash, a kill, a dropped socket) leave only a
// .part file, which is never fed to the parser and is swept at startup by
// cache.ts's sweepPartials() — without which the debris would consume cache
// ceiling that nothing frees.
export const PART_SUFFIX = ".part";

// The checkpoint recall is a best-effort diagnostic — it must NEVER stall
// training. We bound it so a slow/large store cannot freeze the deposit loop.
export const INFER_TIMEOUT_MS = Number(env("INFER_TIMEOUT_MS", "15000"));

// How long the run may make NO progress before it gives up and exits non-zero.
//
// A long training run's worst failure is not a crash — a crash resumes. It is a
// HANG: the uncaught-exception handler deliberately swallows dropped-connection
// errors so a long run survives them, and the keep-alive timer deliberately
// holds the process open; together, an error that escapes and leaves an await
// unsettled produces a live process that will never do anything again. No error,
// no exit, and a supervisor that sees a healthy pid. Exiting instead turns that
// into a resume, which costs at most the work since the last checkpoint.
//
// "Progress" is any deposit, downloaded chunk, or rate-limit wait; time inside
// index maintenance and the checkpoint recall does not count against it, since
// those legitimately deposit nothing. Generous by default — this is a
// last-resort backstop, not a latency budget. 0 disables it.
export const STALL_MS = Math.max(
  0,
  Math.floor(Number(env("STALL_MIN", "15")) * 60_000) || 900_000,
);

// How long a download may wait for room under the cache ceiling before failing
// the unit instead of waiting forever. The wait exists so a bounded cache can
// throttle a fast source; it is not meant to outlast the run. The unit stays
// resumable, so a genuine ceiling problem costs a retry, not the corpus.
export const CACHE_WAIT_MS = Math.max(
  60_000,
  Math.floor(Number(env("CACHE_WAIT_MIN", "10")) * 60_000) || 600_000,
);

// The vector indices' memory knob (MiB) — each index's SQLite page cache.
// The IVF index routes inserts through a RAM-resident pivot table and
// appends to chunk blobs, so this cache mostly serves query-time cluster
// scans; 256 MiB comfortably covers the probed working set of a trained
// store.  Override with VECTOR_CACHE_MB (64 is the library default).
export const VECTOR_CACHE_MB = Math.max(
  0,
  Number(env("VECTOR_CACHE_MB", "256")),
);

// Page cache for the MAIN DAG database (node/kid/edge/contain tables).
// Training issues millions of content-addressed point probes per session
// against a GB-scale file; the library default (64 MiB) is sized for a
// small machine — a training box affords more.  Override with
// SQLITE_CACHE_MB.
export const SQLITE_CACHE_MB = Math.max(
  0,
  Number(env("SQLITE_CACHE_MB", "256")),
);

// Optional ceiling on how much LEARNED CONTENT to train, in megabytes (decimal,
// like CHECKPOINT_MB). Default Infinity = unbounded. The cap is checked against
// trainedContentBytes after each deposit, so a run stops at the first item that
// carries the running total to/past the ceiling (that item is still counted).
export const MAX_MB = Number(env("MAX_MB", "Infinity"));
if (isNaN(MAX_MB) || MAX_MB < 0) {
  process.stderr.write(
    `fatal: MAX_MB must be a non-negative number or "Infinity"\n`,
  );
  process.exit(1);
}
export const MAX_BYTES = MAX_MB * 1_000_000; // Infinity stays Infinity
