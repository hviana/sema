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

  /** Rows to SKIP before depositing anything — the position a previous run
   *  reached, taken from the durable cursor (see runtime.ts). Resume used to
   *  mean "re-read this unit from the top", which was safe but re-deposited
   *  everything already stored and counted it a second time; the store then
   *  reported up to 77% more examples than it held.
   *
   *  Skipping is only sound because the cursor is written in the SAME COMMIT
   *  that flushes the deposits it counts, so a row before the cursor is
   *  necessarily durable. A skipped row is neither parsed nor counted, so a
   *  resumed read's log line describes what THIS read did and nothing else. */
  startRow?: number;

  /** "Row `rows` is FULLY dealt with" — every item it produced is deposited, or
   *  it produced none. Called at ROW BOUNDARIES ONLY, and never for a row the
   *  read stopped in the middle of.
   *
   *  That boundary is the whole point. A checkpoint fires per DEPOSIT, and a row
   *  can produce many (2Wiki emits ~5 facts per row, a dialogue one per turn),
   *  so a position recorded when a row STARTS would mark it consumed while some
   *  of its items were still unwritten — and the resume would skip them. Data
   *  loss, silently. Advancing only here means the worst case is re-depositing
   *  one row, which is idempotent and counted once. */
  onRowDone?: (rows: number) => void;
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

  // A "row" here is a non-blank line, counted whether or not it parses — so the
  // position is a property of the FILE, reproducible on a later run.
  const skip = rc.startRow ?? 0;
  let rowIndex = 0;

  const processLine = async (line: string): Promise<boolean> => {
    if (!line.trim()) return true;
    rowIndex++;
    // Already deposited by an earlier run: advance the position, touch nothing
    // else. Not parsed and not counted, so this read's numbers describe only
    // the rows it actually trained.
    if (rowIndex <= skip) {
      rc.onRowDone?.(rowIndex);
      return true;
    }
    if (rc.shouldStop?.()) return false;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      res.skipped++;
      rc.onRowDone?.(rowIndex); // nothing to deposit — the row is dealt with
      return true;
    }
    const ok = await depositRow(row, toItems, rc, res);
    if (ok) rc.onRowDone?.(rowIndex); // every item landed
    return ok;
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
    // CANCEL, not releaseLock: a read that returns early (a budget, the MAX_MB
    // cap, a signal) leaves the file source open otherwise, to be closed
    // whenever the collector gets to it. Measured, that is tidiness rather than
    // a leak — 300 abandoned reads peaked at 42 open descriptors against 38
    // with cancel — but "closed when we are done with it" is the cheaper thing
    // to reason about, and cancel releases the lock too.
    try {
      await reader.cancel();
    } catch { /* already closed */ }
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
  // A file that parses but is not an array is a DIFFERENT CONTAINER, not an
  // empty one, so it is an error rather than zero rows. Silently reading it as
  // empty marked the unit complete, logged "0 facts", and never looked again —
  // and the live path to that is a LOCAL_PATH run, where the Taskmaster stage
  // takes every *.json in the directory while the remote listing filters out
  // exactly the two files (ontology.json, sample.json) that are not arrays of
  // conversations. Throwing leaves the unit un-completed and says which file.
  if (!Array.isArray(arr)) {
    throw new Error(
      `expected a JSON array of rows, got ${
        arr === null ? "null" : Array.isArray(arr) ? "array" : typeof arr
      }`,
    );
  }
  const rows: unknown[] = arr;
  const skip = rc.startRow ?? 0;
  for (let i = 0; i < rows.length; i++) {
    if (i < skip) { // deposited by an earlier run — see ReadContext
      rc.onRowDone?.(i + 1);
      continue;
    }
    if (rc.signal.aborted || rc.shouldStop?.()) {
      res.stopped = true;
      return res;
    }
    if (!(await depositRow(rows[i], toItems, rc, res))) {
      res.stopped = true;
      return res;
    }
    rc.onRowDone?.(i + 1);
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

/** The top-level column names a Parquet file actually carries, taken from the
 *  chunk metadata (`path_in_schema[0]` is the top-level name, which is exactly
 *  what hyparquet matches a `columns` request against). */
const columnsOf = (
  meta: {
    row_groups: Array<
      { columns: Array<{ meta_data?: { path_in_schema: string[] } }> }
    >;
  },
): Set<string> => {
  const out = new Set<string>();
  for (const rg of meta.row_groups) {
    for (const c of rg.columns) {
      const top = c.meta_data?.path_in_schema?.[0];
      if (top) out.add(top);
    }
  }
  return out;
};

/** Reject a column projection that names a column the file does not have.
 *
 *  hyparquet ignores an unknown name in `columns` rather than complaining, so a
 *  typo would read NO columns, hand every adapter an empty row, and finish with
 *  "0 facts" and no error at all. A projection is a claim about the file, so a
 *  wrong claim is worth stopping for — and the message names both what is
 *  missing and what is there, which is what you need to fix it. */
function checkColumns(available: Set<string>, want: string[]): string[] {
  const missing = want.filter((c) => !available.has(c));
  if (missing.length > 0) {
    throw new Error(
      `column(s) not in this file: ${missing.join(", ")} — ` +
        `it carries ${[...available].join(", ")}`,
    );
  }
  return want;
}

/** Parquet, read in bounded row batches with hyparquet (+Snappy from
 *  hyparquet-compressors) over a web-standard Blob byte source. At most
 *  `batchBytes` of source rows are materialised at a time, so neither a
 *  multi-hundred-MB file nor a file written as ONE giant row-group loads whole
 *  into memory.
 *
 *  Batching also makes a single-group file INTERRUPTIBLE: the abort check runs
 *  per batch, where before a 1.19M-row group could not be cancelled at all.
 *
 *  `columns` PROJECTS the read down to the columns the adapter actually uses.
 *  That is not only a memory economy: 2Wiki's `context` column holds the
 *  Wikipedia prose the adapter exists to avoid depositing, and naming the
 *  columns makes that exclusion structural — the bytes are never decoded at
 *  all — in the same way reading only `utterances[].text` structurally excludes
 *  Taskmaster's `instructions` scaffolding. Absent ⇒ every column, as before. */
export const parquet = (
  opts: { batchBytes?: number; columns?: string[] } = {},
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
  const columns = opts.columns
    ? checkColumns(columnsOf(meta), opts.columns)
    : undefined;
  // A "row" here is the file's ABSOLUTE row index, which is what hyparquet's
  // rowStart/rowEnd already speak in — so resuming is not merely cheaper than
  // re-reading, it decodes nothing at all before the cursor.
  const skip = rc.startRow ?? 0;
  let rowStart = 0;
  for (const rg of meta.row_groups) {
    const rgRows = Number(rg.num_rows);
    const rgEnd = rowStart + rgRows;
    if (rgEnd <= skip) {
      // Entirely behind the cursor: never fetched, never decompressed.
      rowStart = rgEnd;
      rc.onRowDone?.(rowStart);
      continue;
    }
    // `total_byte_size` covers EVERY column, including ones a projection skips,
    // so a projected read materialises less than the budget rather than more.
    // Erring small is the safe direction for a memory budget, and correcting it
    // per-column would tie the batch size to a layout detail for no gain.
    const batchRows = parquetBatchRows(
      rgRows,
      Number(rg.total_byte_size ?? 0),
      budget,
    );
    if (batchRows <= 0) continue; // empty group
    // Resume inside a group: begin at the cursor, not at the group's first row.
    if (rowStart < skip) rowStart = skip;
    // Materialise one bounded batch at a time, then deposit its rows.
    while (rowStart < rgEnd) {
      if (rc.signal.aborted || rc.shouldStop?.()) {
        res.stopped = true;
        return res;
      }
      const batchStart = rowStart;
      const rowEnd = Math.min(rowStart + batchRows, rgEnd);
      const rows = await readObjects({
        file,
        // Hand back the footer we already parsed: without it every batch
        // re-reads and re-parses the file's metadata, which on a large shard
        // means dozens of redundant footer parses per file.
        metadata: meta,
        compressors,
        columns,
        rowStart,
        rowEnd,
      });
      rowStart = rowEnd;
      for (let i = 0; i < rows.length; i++) {
        if (rc.shouldStop?.()) {
          res.stopped = true;
          return res;
        }
        if (!(await depositRow(rows[i], toItems, rc, res))) {
          res.stopped = true;
          return res;
        }
        rc.onRowDone?.(batchStart + i + 1);
      }
    }
  }
  return res;
};
