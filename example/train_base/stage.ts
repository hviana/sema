// train_base/stage.ts — ONE loop, run once per corpus.
//
// Every stage in this trainer was the same seven steps — resume-check, build a
// work-list, acquire each unit, read it, tally it, mark it complete, persist —
// differing only in where the work-list comes from, what container the bytes
// are in, and how a row becomes deposits. Those three are now DATA (a
// `Corpus`, declared in corpus.ts), and this file is the loop they are fed to.
//
// Nothing but the loop lives here, so no corpus file needs to import it.

import { MAX_BYTES } from "./config.js";
import { type Corpus, type LogStyle, type Unit, unitIdOf } from "./corpus.js";
import type { FileResult, RowAdapter } from "./readers.js";
import { loadProgress } from "./progress.js";
import type { TrainCtx } from "./runtime.js";
import { DIM, dur, GRN, int, R, RED, YEL } from "./ui.js";
import { statSync, unlinkSync } from "node:fs";

/** Rows a read could not use, as the log has always reported them: one number.
 *  The reader keeps malformed records and adapter-declined rows apart (see
 *  FileResult) because they mean different things, but only a corpus that
 *  declines records BY DESIGN needs the distinction on screen. */
const unusedRows = (r: FileResult, style?: LogStyle): number =>
  style?.malformedOnly ? r.skipped : r.skipped + r.unusable;

export async function runStage(ctx: TrainCtx, corpus: Corpus): Promise<void> {
  const { progress, state, store, tick } = ctx;
  const c = ctx.counters;
  if (!corpus.enabled) return;
  if (c.trainedContentBytes >= MAX_BYTES || ctx.stopRequested) return;

  // Say what is actually happening. Discovery is a network call that can wait
  // out a rate limit for minutes, and until it is announced the panel keeps
  // displaying the PREVIOUS stage's file as though it were still processing.
  state.activity = "list";
  state.filePath = corpus.label;
  state.fileExamples = 0;
  // The unit counter belongs to the stage that is running, so it is cleared
  // here rather than left showing the previous stage's totals through this one.
  state.fileIndex = 0;
  state.fileTotal = 0;
  tick(true);

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

  const idOf = (u: Unit) => unitIdOf(corpus, u);
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
  // runs again, picking up from the rows it has already taken (below) rather
  // than from zero.
  const budgetMark = maxRows > 0 ? `${corpus.id}::budget=${maxRows}` : "";
  if (budgetMark && done.has(budgetMark)) {
    progress.log(
      `  ${DIM}· ${corpus.label} budget of ${
        int(maxRows)
      } row(s) already met — skipping${R}`,
    );
    return;
  }

  const remaining = units.filter((u) => !done.has(idOf(u)));
  if (remaining.length === 0) {
    progress.log(`  ${DIM}· ${corpus.label} already trained — skipping${R}`);
    return;
  }
  state.fileTotal = units.length;
  state.unitNoun = corpus.unitNoun ?? "unit(s)";

  // Fix the corpus denominator BEFORE reading anything. It used to grow as each
  // file was opened, so the bar ran to 100% at the end of every file and fell
  // back when the next was added — 100%, 50%, 100%, 66%. Both listings report
  // sizes, so the pending work is knowable up front. Units of unknown size
  // (a single-file corpus, whose size arrives with its HEAD) contribute 0 here
  // and are added when they are opened, as before.
  const pendingBytes = units
    .filter((u) => !done.has(idOf(u)))
    .reduce((n, u) => n + (u.bytes ?? 0), 0);
  c.totalCorpusBytes = c.totalBytesProcessed + pendingBytes;

  if (corpus.unitNoun) {
    const taken = c.rowsTaken[corpus.id] ?? 0;
    progress.log(
      `  ${GRN}✓${R} ${corpus.label}: ${remaining.length}/${units.length} ${corpus.unitNoun} to train` +
        (maxRows > 0
          ? ` ${DIM}(budget ${int(maxRows)} rows` +
            (taken > 0 ? `, ${int(taken)} already taken` : "") + `)${R}`
          : ""),
    );
  }

  // The budget spans the whole stage AND the whole STORE, not one shard and not
  // one run. It starts from the rows already taken by units this store has
  // finished, so an interrupted run resumes into the same budget instead of
  // being granted a fresh one — without that, every Ctrl+C between two shards
  // let a budgeted corpus deposit up to a full budget more than asked for, and
  // for SODA the budget IS the curriculum balance (see corpora/soda.ts).
  //
  // The persisted figure counts FINISHED units only. Rows read from a unit that
  // was cut short are deliberately not committed, because a resume re-reads
  // that unit from the top and re-deposits exactly those rows (idempotent); had
  // they been committed, the re-read would count them twice and the stage would
  // stop short of its budget.
  let rowsTaken = c.rowsTaken[corpus.id] ?? 0;
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
    if (done.has(idOf(u))) continue;

    // Acquire (download or reuse), then read.
    let path = u.local ?? "";
    let downloaded = false;
    if (!path) {
      const got = await ctx.acquire(
        u.url!,
        u.dest ?? idOf(u).replace(/[^A-Za-z0-9._-]+/g, "_"),
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

    // Only for a unit the listing could not size (a single-file corpus). One
    // whose size was declared is already in the denominator set above, and
    // adding it again is exactly the drift that made the bar bounce.
    if (!u.bytes) {
      try {
        c.totalCorpusBytes += statSync(path).size;
      } catch { /* best effort */ }
    }

    state.activity = "process";
    state.fileIndex = idx;
    state.filePath = u.display;
    state.fileExamples = 0;
    tick(true);
    const p0 = Date.now();
    let res: FileResult;
    // Pick up inside this unit if the last run stopped inside THIS one. A
    // cursor is never applied to a different unit: the row count means whatever
    // that unit's reader counts, and only there.
    const cur = ctx.resumeCursor;
    const startRow = cur && cur.unitId === idOf(u) ? cur.rows : 0;
    try {
      res = await corpus.read(
        path,
        adapt,
        ctx.readCtx({
          unitId: idOf(u),
          corpusId: corpus.id,
          startRow,
          shouldStop: maxRows > 0 ? spent : undefined,
          // The LIVE count, for the cursor snapshot only. It must not be
          // written into ctx.counters: those are what persist() records, and
          // recording a budget figure for a unit that has not finished would
          // charge the store for rows a resume is about to re-read.
          rowsTakenNow: maxRows > 0 ? () => rowsTaken : undefined,
        }),
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
    // The tally is accrued per deposit by the runtime now (see onDeposit), so
    // that a cursor taken mid-unit carries a true one. Adding res.examples here
    // as well would count this unit twice.

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
      done.add(idOf(u));
      p.completedFiles.push(idOf(u));
      // Commit this unit's rows against the budget — see the note above: only
      // a FINISHED unit's rows are committed, so a resume never counts a
      // re-read prefix twice.
      if (maxRows > 0) c.rowsTaken[corpus.id] = rowsTaken;
    }
    await ctx.persist(p.completedFiles, !res.stopped && !hitBudget);
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
