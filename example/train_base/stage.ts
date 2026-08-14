// train_base/stage.ts — ONE loop, run once per corpus.
//
// Every stage in this trainer was the same seven steps — resume-check, build a
// work-list, acquire each unit, read it, tally it, mark it complete, persist —
// differing only in where the work-list comes from, what container the bytes
// are in, and how a row becomes deposits. Those three are now DATA (a
// `Corpus`), and this file is the loop they are fed to.
//
// THE RESUME IDS ARE A COMPATIBILITY SURFACE. A store records the units it has
// finished as strings, and a store trained by an earlier version must keep
// resuming, so `unitIdOf` below reproduces the original ids exactly — including
// their irregularities (a fixed `aya::dataset` beside a derived
// `smolsent::ha_en.jsonl`). Tidying them would silently re-train everything.

import { LOCAL_PATH, MAX_BYTES } from "./config.js";
import type { FileResult, Reader, RowAdapter } from "./readers.js";
import { loadProgress } from "./progress.js";
import type { TrainCtx } from "./runtime.js";
import { localFind } from "./discovery.js";
import { DIM, dur, GRN, int, R, RED, YEL } from "./ui.js";
import { statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** One file to train: a shard, a per-language file, or a whole single-file
 *  corpus. Exactly one of `url` / `local` is set. */
export interface Unit {
  /** Resume-id suffix — the corpus id and this form `${id}::${key}`. Part of
   *  the store's compatibility surface; see the file header. */
  key: string;
  /** How the run log names this unit once it is read. */
  name: string;
  /** How the live panel names it, and (unless `acquireLabel` overrides) how the
   *  download is labelled. Conventionally `${corpus.label} ${name}`. */
  display: string;
  url?: string;
  local?: string;
  /** Cache filename. Defaults to the resume id with unsafe characters folded. */
  dest?: string;
  /** Download label, when it differs from `display`. */
  acquireLabel?: string;
}

/** How one unit's outcome reads in the run log. All optional: the defaults are
 *  what every fact-shaped corpus prints. */
export interface LogStyle {
  /** What one deposit is called. Default "facts". */
  deposits?: string;
  /** When set, the line reports "from N <rows>" — the count of rows that
   *  actually produced deposits. */
  rows?: string;
  /** What an unusable record is called. Default "unusable row(s)". */
  bad?: string;
  /** Report only the reader's `skipped` (malformed records), not the rows the
   *  adapter declined. For a corpus that DECLINES records by design — oasst2
   *  drops every single-turn tree — counting those as damage would be a lie. */
  malformedOnly?: boolean;
}

export interface Corpus {
  /** langTally key AND resume-id prefix. Compatibility surface. */
  id: string;
  /** Human name: the panel, the skip notices, the listing-failure message. */
  label: string;
  /** The dim tag in the log line, e.g. "translation", "social dialogue". */
  kind: string;
  enabled: boolean;
  /** A FIXED resume id, for a corpus that is one unit and has always recorded
   *  itself under a name of its own ("aya::dataset"). Absent ⇒ `${id}::${key}`. */
  unitId?: string;
  /** The work-list. Return [] for "nothing found" (the runner says so), or
   *  null when the corpus has already logged a more specific reason. */
  discover(ctx: TrainCtx): Promise<Unit[] | null>;
  read: Reader;
  toItems: RowAdapter;
  /** Stage-wide row budget; 0/absent = unbounded. See the budget notes below. */
  maxRows?: number;
  /** Noun for the "N/M ___ to train" announcement. Absent ⇒ no announcement,
   *  which is what a single-unit corpus has always done. */
  unitNoun?: string;
  /** Keep a file that came from the CACHE after a complete read. Only oasst2
   *  does this: every other corpus deletes whatever acquire() handed it. */
  keepCached?: boolean;
  log?: LogStyle;
}

/** Rows a read could not use, as the log has always reported them: one number.
 *  The reader keeps malformed records and adapter-declined rows apart (see
 *  FileResult) because they mean different things, but only a corpus that
 *  declines records BY DESIGN needs the distinction on screen. */
const unusedRows = (r: FileResult, style?: LogStyle): number =>
  style?.malformedOnly ? r.skipped : r.skipped + r.unusable;

/** Local files live under `LOCAL_PATH/<sub>`, or directly in LOCAL_PATH when
 *  `sub` is empty. Kept here because the layout is a user-facing convention:
 *  the corpora that share an extension (.json, .parquet) are kept apart by a
 *  subdirectory so a local run cannot feed one corpus's files to another. */
export const localDir = (sub: string): string =>
  sub ? join(LOCAL_PATH, sub) : LOCAL_PATH;

export async function runStage(ctx: TrainCtx, corpus: Corpus): Promise<void> {
  const { progress, state, store, tick } = ctx;
  const c = ctx.counters;
  if (!corpus.enabled) return;
  if (c.trainedContentBytes >= MAX_BYTES || ctx.stopRequested) return;

  let units: Unit[] | null;
  try {
    units = await corpus.discover(ctx);
  } catch (e) {
    if (ctx.stopRequested || (e as Error)?.name === "AbortError") return;
    progress.log(
      `  ${RED}✗${R} ${corpus.label} file listing failed: ${
        (e as Error).message
      }`,
    );
    return;
  }
  if (units === null) return; // discover already said why
  if (units.length === 0) {
    progress.log(`  ${DIM}· no ${corpus.label} files found — skipping${R}`);
    return;
  }

  const unitIdOf = (u: Unit) => corpus.unitId ?? `${corpus.id}::${u.key}`;
  const maxRows = corpus.maxRows ?? 0;

  const p = await loadProgress(store);
  const done = new Set(p.completedFiles);

  // A budget-limited stage never marks its later shards complete — that is
  // what lets a raised budget resume instead of restarting. But it also means
  // "every shard complete" is NOT how such a stage finishes, so without a
  // marker of its own a satisfied budget would re-read and re-deposit its
  // rows on every subsequent run: harmless to the store (deposition is
  // idempotent) but it repeats the work and double-counts langTally.
  //
  // The marker carries the budget it was satisfied AT, so raising the budget
  // still resumes: a bigger budget does not match the marker and the stage
  // runs again, re-reading rows it already holds (idempotent) and adding the
  // new ones.
  const budgetMark = maxRows > 0 ? `${corpus.id}::budget=${maxRows}` : "";
  if (budgetMark && done.has(budgetMark)) {
    progress.log(
      `  ${DIM}· ${corpus.label} budget of ${
        int(maxRows)
      } row(s) already met — skipping${R}`,
    );
    return;
  }

  const remaining = units.filter((u) => !done.has(unitIdOf(u)));
  if (remaining.length === 0) {
    progress.log(`  ${DIM}· ${corpus.label} already trained — skipping${R}`);
    return;
  }
  state.fileTotal = units.length;
  if (corpus.unitNoun) {
    progress.log(
      `  ${GRN}✓${R} ${corpus.label}: ${remaining.length}/${units.length} ${corpus.unitNoun} to train` +
        (maxRows > 0 ? ` ${DIM}(budget ${int(maxRows)} rows)${R}` : ""),
    );
  }

  // The budget spans the whole stage, not one shard, so it is counted here.
  let rowsTaken = 0;
  const spent = () => maxRows > 0 && rowsTaken >= maxRows;
  const adapt: RowAdapter = maxRows > 0
    ? (row) => {
      const items = corpus.toItems(row);
      if (!items || items.length === 0) return null;
      rowsTaken++;
      return items;
    }
    : corpus.toItems;

  let idx = 0;
  for (const u of units) {
    if (c.trainedContentBytes >= MAX_BYTES || ctx.stopRequested) break;
    if (spent()) break;
    idx++;
    if (done.has(unitIdOf(u))) continue;

    // Acquire (download or reuse), then read.
    let path = u.local ?? "";
    let downloaded = false;
    if (!path) {
      const got = await ctx.acquire(
        u.url!,
        u.dest ?? unitIdOf(u).replace(/[^A-Za-z0-9._-]+/g, "_"),
        u.acquireLabel ?? u.display,
      );
      if (!got) {
        if (ctx.stopRequested) break;
        continue; // a single failed unit never aborts the stage
      }
      path = got.path;
      // A file that came from the cache is the corpus's to keep or to reclaim;
      // only oasst2 keeps it. See Corpus.keepCached.
      downloaded = corpus.keepCached ? !got.cached : true;
    }

    // Accumulate known corpus bytes so the progress bar shows a
    // meaningful ETA — grows as each file's size is discovered.
    try {
      c.totalCorpusBytes += statSync(path).size;
    } catch { /* best effort */ }

    state.activity = "process";
    state.fileIndex = idx;
    state.filePath = u.display;
    state.fileExamples = 0;
    tick(true);
    const p0 = Date.now();
    let res: FileResult;
    try {
      res = await corpus.read(
        path,
        adapt,
        ctx.readCtx(maxRows > 0 ? spent : undefined),
      );
    } catch (e) {
      if (ctx.stopRequested || (e as Error)?.name === "AbortError") break;
      progress.log(
        `  ${RED}✗${R} ${u.display} parse failed: ${(e as Error).message}`,
      );
      if (downloaded) {
        try {
          unlinkSync(path);
        } catch { /* best effort */ }
      }
      continue;
    }
    // A shard cut short by the BUDGET is not "done" — leave it resumable so a
    // later run with a bigger budget continues instead of starting over.
    const hitBudget = spent();
    c.langTally[corpus.id] = (c.langTally[corpus.id] ?? 0) + res.examples;

    const style = corpus.log;
    const bad = unusedRows(res, style);
    const badNoun = style?.malformedOnly
      ? "malformed line(s)"
      : style?.bad ?? "unusable row(s)";
    const fromRows = style?.rows
      ? `from ${int(res.rowsUsed)} ${style.rows} `
      : "";
    progress.log(
      `  ${GRN}✓${R} ${u.name} ${DIM}[${corpus.kind}]${R} → ${
        int(res.examples)
      } ${style?.deposits ?? "facts"} ${DIM}${fromRows}in ${
        dur((Date.now() - p0) / 1000)
      }${R}` +
        (bad ? ` ${YEL}· ${int(bad)} ${badNoun} skipped${R}` : "") +
        (hitBudget
          ? ` ${YEL}(budget reached)${R}`
          : res.stopped
          ? ` ${YEL}(stopped early)${R}`
          : ""),
    );

    if (!res.stopped && !hitBudget) {
      try {
        c.totalBytesProcessed += statSync(path).size;
      } catch { /* best effort */ }
      if (downloaded) {
        try {
          unlinkSync(path);
        } catch { /* best effort */ }
      }
      done.add(unitIdOf(u));
      p.completedFiles.push(unitIdOf(u));
    }
    await ctx.persist(p.completedFiles);
    // A budget stop is not a cap/signal stop: the stage is finished, so fall
    // out of the loop rather than treating it as an interruption.
    if (res.stopped && !hitBudget) break;
  }

  // Record a satisfied budget so the next run skips this stage instead of
  // re-reading it. Only when the budget was actually reached: a stage that
  // ran out of shards first is complete by the normal per-shard rule, and a
  // stage cut short by MAX_MB or Ctrl+C must stay resumable.
  if (budgetMark && spent() && !ctx.stopRequested && !done.has(budgetMark)) {
    p.completedFiles.push(budgetMark);
    await ctx.persist(p.completedFiles);
  }
}

/** A single-unit corpus: one fixed URL, or one local file matched by pattern.
 *  Factored out because the three corpora that are ONE file resolve it the
 *  same way — and their resume id is fixed (Corpus.unitId), so the empty `key`
 *  below is never read. */
export function singleUnit(opts: {
  label: string;
  display: string;
  url: string;
  dest: string;
  acquireLabel?: string;
  /** Patterns tried, in order, against LOCAL_PATH. */
  localMatch: RegExp[];
  /** How the "no local copy" notice describes what it looked for. */
  localWhat: string;
}): (ctx: TrainCtx) => Promise<Unit[] | null> {
  return async (ctx: TrainCtx) => {
    if (LOCAL_PATH) {
      const hit = localFind(LOCAL_PATH, ...opts.localMatch);
      if (!hit) {
        ctx.progress.log(
          `  ${DIM}· no ${opts.localWhat} in ${LOCAL_PATH} — skipping${R}`,
        );
        return null;
      }
      return [{
        key: "",
        name: opts.label,
        display: opts.display,
        local: join(LOCAL_PATH, hit),
      }];
    }
    return [{
      key: "",
      name: opts.label,
      display: opts.display,
      url: opts.url,
      dest: opts.dest,
      acquireLabel: opts.acquireLabel,
    }];
  };
}
