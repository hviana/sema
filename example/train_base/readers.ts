// train_base/readers.ts — bytes on disk → rows → deposits.
//
// A READER knows a container format (newline-delimited JSON, a JSON array, a
// Parquet file) and nothing about any corpus. It is handed a row ADAPTER and
// deposits whatever that adapter returns. The pairing is free: any corpus can
// use any reader, which is the whole point of separating them.
//
// Every reader stops at an ITEM boundary — never mid-deposit — on any of three
// signals: the run's abort signal, `shouldStop` (a stage budget), or `onExample`
// returning false (the MAX_MB cap). A stopped read leaves its file un-completed
// so a resume re-reads it from the top, which is safe because deposition is
// idempotent.
//
// THE ONLY THIRD-PARTY CODE IN THIS REPOSITORY IS BELOW, and it is LAZILY
// LOADED. Sema itself imports nothing outside `node:` — that is a product
// property, not an accident (AGENTS.md §6) — and this trainer is an EXAMPLE,
// not part of the library. hyparquet (+ its Snappy codec) is therefore a dev
// dependency, and it is loaded by a dynamic import the first time a Parquet
// corpus is actually read: a curriculum with no Parquet stage (SmolSent,
// oasst2, Taskmaster, General-Knowledge) runs with the package absent
// entirely, and one that needs it fails with a sentence instead of a module
// resolution error.

import type { CachedIngest } from "../../src/index.js";
import { isEpisode, itemBytes, type TrainingItem } from "./items.js";
import { PARQUET_BATCH_BYTES } from "./config.js";
import { openAsBlob } from "node:fs";

/** Turn ONE raw row into deposits, or null/[] when the row carries nothing
 *  usable. Pure: no I/O, no counters, no logging. */
export type RowAdapter = (row: unknown) => TrainingItem[] | null;

/** What a read produced. `skipped` and `unusable` are deliberately SEPARATE:
 *  a line that failed to parse is a defect in the file, while a row the adapter
 *  declined is a normal, expected outcome for a corpus being filtered (oasst2
 *  drops every single-turn tree by design). Collapsing them — as the two
 *  original line readers each did, in opposite directions — makes one of the
 *  two log lines a lie. */
export interface FileResult {
  examples: number; // deposits made
  rowsUsed: number; // rows that produced at least one deposit
  skipped: number; // malformed / oversize records — a defect in the file
  unusable: number; // rows the adapter declined — normal filtering
  stopped: boolean; // stopped early by a cap, a budget, or a signal
}

/** Everything a reader needs from the run: where to deposit, what to count,
 *  and how to be stopped. */
export interface ReadContext {
  ci: CachedIngest;
  /** Called once per deposit with its UTF-8 content size. Returns false to
   *  stop the read (the MAX_MB cap, or a pending shutdown). */
  onExample: (contentBytes: number) => Promise<boolean>;
  /** Feeds the reservoir behind the checkpoint recall box. */
  sample: (it: TrainingItem) => void;
  signal: AbortSignal;
  /** A stage-level budget. Checked per row and before each Parquet batch is
   *  decoded — a budget must STOP the read rather than reject rows: left to
   *  reject, a budgeted stage still DECODES every remaining row-group (143,346
   *  rows of one 86.7 MB SODA shard) and reports them as "unusable" when
   *  nothing was wrong with them, which is a lie in the run log.
   *
   *  Measured honestly: on that shard the wall time did NOT improve (2m 35s ->
   *  2m 37s), because a budgeted run is dominated by depositing the rows it DID
   *  take, not by scanning past the ones it did not. The win here is a truthful
   *  log and the CPU/allocation of ~143k skipped row decodes, not elapsed time.
   *  A larger shard past a small budget is where the decode cost would show. */
  shouldStop?: () => boolean;
}

/** A reader: read `filePath`, deposit every row `toItems` accepts. */
export type Reader = (
  filePath: string,
  toItems: RowAdapter,
  rc: ReadContext,
) => Promise<FileResult>;

/** Deposit a row's items: an experience via ingest(text), an episode via
 *  ingest(context, continuation). After each, the per-example callback receives
 *  the item's UTF-8 content size — the quantity the scaling suite
 *  (14-scaling.test.mjs) reports as a constant KB/s — then gates the global
 *  example count and checkpointing (returns false to stop). */
export async function ingestItems(
  ci: CachedIngest,
  items: TrainingItem[],
  onItem: (contentBytes: number) => Promise<boolean>,
  sample?: (it: TrainingItem) => void,
): Promise<boolean> {
  for (const it of items) {
    if (isEpisode(it)) await ci.ingest(it.context, it.continuation);
    else await ci.ingest(it);
    sample?.(it);
    if (!(await onItem(itemBytes(it)))) return false; // stop requested
  }
  return true;
}

/** Shared tail of every reader: deposit one row's items and keep the counts. */
async function depositRow(
  row: unknown,
  toItems: RowAdapter,
  rc: ReadContext,
  res: FileResult,
): Promise<boolean> {
  const items = toItems(row);
  if (!items || items.length === 0) {
    res.unusable++;
    return true;
  }
  res.rowsUsed++;
  return ingestItems(rc.ci, items, async (contentBytes) => {
    res.examples++;
    return rc.onExample(contentBytes);
  }, rc.sample);
}

const blank = (): FileResult => ({
  examples: 0,
  rowsUsed: 0,
  skipped: 0,
  unusable: 0,
  stopped: false,
});

/** Newline-delimited JSON, optionally gzipped.
 *
 *  ONE reader serves both the plain JSONL sources and the gzipped oasst2 tree
 *  dump: the only difference between them is a `DecompressionStream("gzip")` in
 *  the pipeline, and duplicating an 80-line splitter to express that was how
 *  the two copies drifted apart in the first place.
 *
 *  Lines are split without buffering the whole file OR an unbounded line: a
 *  record longer than `maxLineChars` is dropped (counted `skipped`) and the
 *  stream continues at the next newline, so a corrupt record can never exhaust
 *  memory or abort a good file. */
export const lines = (
  opts: { gzip?: boolean; maxLineChars: number },
): Reader =>
async (filePath, toItems, rc) => {
  const res = blank();
  const blob = await openAsBlob(filePath);
  // gzip is a web standard here too (DecompressionStream), so the compressed
  // and plain forms differ by exactly one pipe stage and nothing else.
  const reader = (opts.gzip
    ? blob.stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .pipeThrough(new TextDecoderStream())
    : blob.stream()
      .pipeThrough(new TextDecoderStream())).getReader();
  let leftover = "", dropping = false;

  const processLine = async (line: string): Promise<boolean> => {
    if (!line.trim()) return true;
    if (rc.shouldStop?.()) return false;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      res.skipped++;
      return true;
    }
    return depositRow(row, toItems, rc, res);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk = value;
      for (;;) {
        const nl = chunk.indexOf("\n");
        if (nl < 0) {
          if (!dropping) {
            if (leftover.length + chunk.length > opts.maxLineChars) {
              leftover = "";
              dropping = true;
              res.skipped++;
            } else leftover += chunk;
          }
          break;
        }
        const part = chunk.slice(0, nl);
        chunk = chunk.slice(nl + 1);
        if (dropping) {
          dropping = false;
          leftover = "";
          continue;
        }
        if (leftover.length + part.length > opts.maxLineChars) {
          leftover = "";
          res.skipped++;
          continue;
        }
        const line = leftover + part;
        leftover = "";
        if (!(await processLine(line))) {
          res.stopped = true;
          return res;
        }
      }
    }
    if (!dropping && leftover.trim()) {
      if (!(await processLine(leftover))) res.stopped = true;
    }
    return res;
  } finally {
    try {
      reader.releaseLock();
    } catch { /* best effort */ }
  }
};

/** A whole-file JSON ARRAY of rows. The arrays this reads are small enough
 *  (~16 MB) to parse whole; a huge file would be rejected by the cache ceiling
 *  long before this. */
export const jsonArray = (): Reader => async (filePath, toItems, rc) => {
  const res = blank();
  const blob = await openAsBlob(filePath);
  let arr: unknown;
  try {
    arr = JSON.parse(await blob.text());
  } catch (e) {
    throw new Error(`invalid JSON: ${(e as Error).message}`);
  }
  const rows: unknown[] = Array.isArray(arr) ? arr : [];
  for (const row of rows) {
    if (rc.signal.aborted || rc.shouldStop?.()) {
      res.stopped = true;
      return res;
    }
    if (!(await depositRow(row, toItems, rc, res))) {
      res.stopped = true;
      return res;
    }
  }
  return res;
};

/** How many rows to materialise in one read from a row-group of `rgRows` rows
 *  occupying `groupBytes` uncompressed bytes, under a `budgetBytes` target.
 *
 *  The group's own footer statistics give the mean row width, so the batch
 *  follows the CORPUS's row size rather than the writer's layout: wide rows
 *  (SODA carries a whole dialogue per row) batch smaller than narrow ones at
 *  the same memory cost. Never exceeds the group — a batch is a subdivision of
 *  a group, never a span across two, because `parquetReadObjects` is given an
 *  absolute row range and column chunks are per-group. Never returns 0, or the
 *  read loop could not advance.
 *
 *  A writer that omits `total_byte_size` yields `groupBytes <= 0`; the batch is
 *  then the whole group, which is exactly the behaviour this replaced. That
 *  fallback is safe for every file we read today (all three report it) and
 *  degrades to the old memory profile rather than to a wrong result. */
export function parquetBatchRows(
  rgRows: number,
  groupBytes: number,
  budgetBytes: number,
): number {
  if (!(rgRows > 0)) return 0; // empty group — the caller skips it
  if (!(groupBytes > 0) || !Number.isFinite(groupBytes)) return rgRows;
  const perRow = groupBytes / rgRows;
  const fit = Math.floor(budgetBytes / perRow);
  return Math.min(rgRows, Math.max(1, fit));
}

/** hyparquet + its Snappy codec, resolved on FIRST USE and remembered.
 *
 *  A pure-JS, dependency-free Parquet reader driven over a web-standard Blob
 *  byte source. It is the one thing the web platform cannot do alone, and the
 *  one package this repository pulls in — so it is loaded here, where it is
 *  used, rather than at module scope, where it would become a load-time
 *  requirement of the whole trainer. */
let parquetLib:
  | Promise<{
    metadata: typeof import("hyparquet").parquetMetadataAsync;
    readObjects: typeof import("hyparquet").parquetReadObjects;
    compressors: typeof import("hyparquet-compressors").compressors;
  }>
  | null = null;

const loadParquet = () => (parquetLib ??= (async () => {
  try {
    const [hp, hc] = await Promise.all([
      import("hyparquet"),
      import("hyparquet-compressors"),
    ]);
    return {
      metadata: hp.parquetMetadataAsync,
      readObjects: hp.parquetReadObjects,
      compressors: hc.compressors,
    };
  } catch (e) {
    // A missing package here is a SETUP problem with a specific remedy, so say
    // the remedy. Anything else (a genuine load error inside the package) is
    // rethrown untouched.
    const code = (e as { code?: string })?.code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new Error(
        "this corpus ships as Parquet and needs the hyparquet reader, which " +
          "is a DEV dependency of this example (the library itself has none). " +
          "Run `npm install` in the repository, or disable the Parquet " +
          "stages: AYA=0 WIKI2=0 SODA=0 MASSIVE=0.",
      );
    }
    throw e;
  }
})());

/** Parquet, read in bounded row batches with hyparquet (+Snappy from
 *  hyparquet-compressors) over a web-standard Blob byte source. At most
 *  `batchBytes` of source rows are materialised at a time, so neither a
 *  multi-hundred-MB file nor a file written as ONE giant row-group loads whole
 *  into memory.
 *
 *  Batching also makes a single-group file INTERRUPTIBLE: the abort check runs
 *  per batch, where before a 1.19M-row group could not be cancelled at all. */
export const parquet = (
  opts: { batchBytes?: number } = {},
): Reader =>
async (filePath, toItems, rc) => {
  const { metadata, readObjects, compressors } = await loadParquet();
  const budget = opts.batchBytes ?? PARQUET_BATCH_BYTES;
  const res = blank();
  const blob = await openAsBlob(filePath);
  const file = {
    byteLength: blob.size,
    slice: async (start: number, end?: number) =>
      await blob.slice(start, end ?? blob.size).arrayBuffer(),
  };
  const meta = await metadata(file);
  let rowStart = 0;
  for (const rg of meta.row_groups) {
    const rgRows = Number(rg.num_rows);
    const rgEnd = rowStart + rgRows;
    const batchRows = parquetBatchRows(
      rgRows,
      Number(rg.total_byte_size ?? 0),
      budget,
    );
    if (batchRows <= 0) continue; // empty group
    // Materialise one bounded batch at a time, then deposit its rows.
    while (rowStart < rgEnd) {
      if (rc.signal.aborted || rc.shouldStop?.()) {
        res.stopped = true;
        return res;
      }
      const rowEnd = Math.min(rowStart + batchRows, rgEnd);
      const rows = await readObjects({
        file,
        compressors,
        rowStart,
        rowEnd,
      });
      rowStart = rowEnd;
      for (const row of rows) {
        if (rc.shouldStop?.()) {
          res.stopped = true;
          return res;
        }
        if (!(await depositRow(row, toItems, rc, res))) {
          res.stopped = true;
          return res;
        }
      }
    }
  }
  return res;
};
