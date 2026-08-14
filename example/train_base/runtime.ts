// train_base/runtime.ts — the RUN: counters, the live panel, the deposit gate,
// checkpointing, file acquisition, and the two ways a run can end.
//
// Everything a training stage needs is reachable through ONE explicit context
// object. That is the same shape the engine uses for its own machinery — free
// functions over a `MindContext` rather than methods with hidden `this` state
// (AGENTS.md §3) — and it is what lets a stage be written, read and moved
// without dragging a closure the size of a file behind it.
//
// The counters live on `ctx.counters` rather than as closure variables for one
// concrete reason: a stage must be able to read the running total (to honour
// MAX_MB) and add to it (per deposit) from another module. A captured `let`
// cannot cross that boundary; a field on a shared object can.

import { type CachedIngest, type Mind, type Store } from "../../src/index.js";
import {
  CACHE_DIR,
  CHECKPOINT_BYTES,
  DB_PATH,
  DOWNLOAD_TRIES,
  INFER_TIMEOUT_MS,
  MAX_BYTES,
  PROGRESS_MS,
  STALL_MS,
} from "./config.js";
import type { TrainingItem } from "./items.js";
import {
  headSize,
  type HttpOptions,
  throttleNotifier,
  withTimeout,
} from "./http.js";
import { cacheSize, downloadFile, ensureCacheRoom } from "./cache.js";
import type { ReadContext } from "./readers.js";
import {
  loadProgress,
  runIndexMaintenance,
  type SavedProgress,
  saveProgress,
} from "./progress.js";
import {
  bytes,
  CYAN,
  DIM,
  dur,
  GRN,
  int,
  Progress,
  type ProgState,
  promptOf,
  R,
  RED,
  renderInferenceBox,
  SHOW,
  YEL,
} from "./ui.js";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";

/** A single process-wide abort signal. SIGINT/SIGTERM aborts it, which cancels
 *  every in-flight fetch immediately (instead of waiting out a slow socket), so
 *  Ctrl+C is responsive even mid-download. The deposit loop also polls it to
 *  stop cleanly at the next item boundary, leaving the store consistent. */
export const shutdown = new AbortController();

/** The totals a run accumulates. Mutable BY DESIGN — see the file header. */
export interface Counters {
  depositCount: number;
  trainedContentBytes: number;
  totalBytesProcessed: number;
  totalCorpusBytes: number;
  langTally: Record<string, number>;
  /** Rows a BUDGETED corpus has already taken, by corpus id, counting only
   *  units it finished. A budget is a property of the STORE, not of a run, so
   *  it has to survive a resume — see the budget notes in stage.ts. Absent from
   *  an older store, which reads as 0 and reproduces the previous behaviour. */
  rowsTaken: Record<string, number>;
}

export interface TrainCtx {
  readonly store: Store;
  readonly mind: Mind;
  readonly ci: CachedIngest;
  readonly progress: Progress;
  readonly state: ProgState;
  readonly counters: Counters;
  /** Network options for a LISTING call: cancellable, and its throttle waits
   *  are surfaced into the run log. Downloads and HEAD probes deliberately do
   *  NOT carry the notifier — they wait silently, as they always have. */
  readonly http: HttpOptions;

  /** Set once a stop has been requested (a signal, or the MAX_MB cap). Every
   *  stage checks it at its file and item boundaries. */
  stopRequested: boolean;
  stopReason: string;

  /** Repaint the panel. `force` bypasses the frame-rate limiter. */
  tick(force?: boolean): void;
  /** Offer an item to the reservoir behind the checkpoint recall box. */
  sample(it: TrainingItem): void;
  /** The per-deposit gate: counts, checkpoints, and returns false to stop. */
  onDeposit(contentBytes: number): Promise<boolean>;
  /** Bind a reader to this run, for the unit recorded as `unitId`, resuming at
   *  `startRow`. `shouldStop` is a stage BUDGET; the MAX_MB cap and the
   *  shutdown signal reach the reader by other routes.
   *
   *  Naming the unit is what makes the cursor meaningful: a cursor is only ever
   *  applied to the unit it was taken from. */
  readCtx(opts: {
    unitId: string;
    /** Which corpus these deposits are tallied to. */
    corpusId: string;
    startRow?: number;
    shouldStop?: () => boolean;
    /** Live budget count for this corpus, for the cursor snapshot only. */
    rowsTakenNow?: () => number;
  }): ReadContext;

  /** The durable position a previous run reached inside a unit it did not
   *  finish, or null. A stage applies it only to the matching unit. */
  readonly resumeCursor: UnitCursor | null;
  /** Reuse a cached copy, else download into the cache. Null on failure.
   *  `cached` says which happened — the stages disagree about whether a file
   *  they did not download is theirs to delete afterwards, so the answer has
   *  to reach the caller rather than being decided here. */
  acquire(
    url: string,
    destName: string,
    label: string,
  ): Promise<AcquiredFile | null>;
  /** Persist the resume record: completed units, counters, per-corpus tally,
   *  and the in-flight unit's cursor. `unitDone` CLEARS the cursor — the unit
   *  is recorded in `completedFiles` now, so a position inside it is meaningless
   *  and must not be left behind for the next run to apply. */
  persist(completedFiles: string[], unitDone?: boolean): Promise<void>;
  /** Restore counters and the tally from the store, and announce the resume. */
  restore(): Promise<SavedProgress>;
  /** Final checkpoint, summary line, and exit. */
  finish(why: string): Promise<void>;
}

/** A durable position inside a unit that is not finished, together with the
 *  counters that describe exactly the data behind it.
 *
 *  The counters travel WITH the position for one reason: they have to agree. A
 *  resume that restored the store's running totals but re-read the unit from the
 *  top counted the same deposits twice, and every interruption inflated the
 *  figures again — measured at +77% (16,000 examples reported as 28,283) after
 *  six interruptions of one corpus. Restoring the pair together makes the
 *  reported numbers describe the store, however many times it was interrupted.
 *
 *  `rows` is what the reader counts, so its unit is reader-specific — non-blank
 *  lines for `lines`, array index for `jsonArray`, absolute file row for
 *  `parquet`. That is safe because a corpus never changes reader, and it is why
 *  a cursor names the unit it came from. */
export interface UnitCursor {
  unitId: string;
  rows: number;
  depositCount: number;
  trainedContentBytes: number;
  totalBytesProcessed: number;
  langTally: Record<string, number>;
  rowsTaken: Record<string, number>;
}

/** The outcome of {@link TrainCtx.acquire}. */
export interface AcquiredFile {
  path: string;
  /** True when the file was already in the cache and nothing was fetched. */
  cached: boolean;
}

export interface RuntimeOptions {
  store: Store;
  mind: Mind;
  ci: CachedIngest;
  /** Names the curriculum in the panel header. */
  title: string;
}

export function createRuntime(opts: RuntimeOptions): TrainCtx {
  const { store, mind, ci } = opts;

  // ── counters & sampling ──
  const counters: Counters = {
    depositCount: 0,
    trainedContentBytes: 0,
    totalBytesProcessed: 0,
    totalCorpusBytes: 0,
    langTally: {},
    rowsTaken: {},
  };
  let bytesSinceCkpt = 0;
  let checkpointNum = 0;
  const t0 = Date.now();

  // Reservoir sample: one uniformly-random item from the current window, shown
  // in the recall box at each checkpoint.
  let sampleItem: TrainingItem | null = null;
  let seenInWindow = 0;
  const sample = (it: TrainingItem) => {
    seenInWindow++;
    if (Math.random() < 1 / seenInWindow) sampleItem = it;
  };

  // ── progress panel ──
  const progress = new Progress(opts.title);
  // Surface rate-limit waits from the low-level fetch retries into the live log,
  // so a 429 back-off reads as "waiting", never a silent hang or a dropped file.
  const onThrottle = throttleNotifier((ms, label) => {
    beat(); // being told to wait is the server answering, not a hang
    progress.log(
      `  ${YEL}⏳${R} rate-limited (${label}); waiting ${
        (ms / 1000).toFixed(1)
      }s and retrying — not skipping`,
    );
  });
  const http: HttpOptions = { signal: shutdown.signal, onThrottle };

  const state: ProgState = {
    exampleCount: 0,
    target: MAX_BYTES,
    elapsedS: 0,
    trainedBytes: 0,
    trainedRate: 0,
    bytesDone: 0,
    bytesTotal: 0,
    bytesRate: 0,
    fileIndex: 0,
    fileTotal: 0,
    unitNoun: "unit(s)",
    filePath: "",
    fileSize: 0,
    fileExamples: 0,
    activity: "idle",
    dlSpeed: 0,
    dlDone: 0,
    dlTotal: 0,
    storeEntries: 0,
    cacheBytes: 0,
    lastSample: null,
  };

  // store.size() is async; refresh it on a slow cadence so the hot loop and
  // the repaint never block on a query.
  let cachedEntries = 0;
  let sizeInFlight = false;
  const refreshSize = () => {
    if (sizeInFlight) return;
    sizeInFlight = true;
    void mind.store.size()
      .then((n) => (cachedEntries = n))
      .catch(() => undefined)
      .finally(() => (sizeInFlight = false));
  };

  // Cache size changes only at download/delete boundaries — recompute it
  // lazily rather than statting the dir on every deposit.
  let cachedCacheBytes = 0;
  let lastCacheUpdate = 0;

  // Live download progress for the panel.
  let dlSlot: { done: number; total: number; t0: number } | null = null;

  // Rolling throughput: a short EMA over wall-clock windows, so the headline
  // figures reflect CURRENT speed rather than a lifetime average diluted by the
  // listing and download phases (which train nothing).
  let rateT = t0;
  let rateTrained = 0;
  let rateBytes = 0;
  const syncState = () => {
    const now = Date.now();
    state.exampleCount = counters.depositCount;
    state.trainedBytes = counters.trainedContentBytes;
    state.elapsedS = (now - t0) / 1000;
    state.storeEntries = cachedEntries;
    state.bytesDone = counters.totalBytesProcessed;
    state.bytesTotal = counters.totalCorpusBytes;

    if (dlSlot && state.activity === "download") {
      state.dlDone = dlSlot.done;
      state.dlTotal = dlSlot.total;
      const ds = (now - dlSlot.t0) / 1000;
      state.dlSpeed = ds > 0.2 ? dlSlot.done / ds : 0;
    } else {
      state.dlDone = 0;
      state.dlTotal = 0;
    }

    const dt = (now - rateT) / 1000;
    if (dt >= 0.5) {
      const instTrained = (counters.trainedContentBytes - rateTrained) / dt;
      const instByte = (counters.totalBytesProcessed - rateBytes) / dt;
      const a = 0.3; // EMA weight on the newest sample
      state.trainedRate = state.trainedRate === 0
        ? instTrained
        : state.trainedRate * (1 - a) + instTrained * a;
      state.bytesRate = state.bytesRate === 0
        ? instByte
        : state.bytesRate * (1 - a) + instByte * a;
      rateT = now;
      rateTrained = counters.trainedContentBytes;
      rateBytes = counters.totalBytesProcessed;
    }

    if (now - lastCacheUpdate > 2000) {
      cachedCacheBytes = cacheSize();
      lastCacheUpdate = now;
    }
    state.cacheBytes = cachedCacheBytes;
  };

  const tick = (force = false) => {
    syncState();
    progress.render(state, force);
  };

  const paintTimer = setInterval(() => {
    refreshSize();
    tick(false);
  }, PROGRESS_MS);
  if (typeof paintTimer.unref === "function") paintTimer.unref();

  // ── keep-alive: the process must never exit on its own mid-training ──
  // The CPU-bound processing phase (perceive + intern + the batched vector-index
  // writes) hands control back to the event loop between batches via the store's
  // yieldToEventLoop(), which parks on an UNREF'd setImmediate so the library
  // never holds a process open by itself. node:sqlite is synchronous and the
  // vector index is in-memory, so the store's awaits resolve as microtasks with
  // no I/O handle, and the paint timer above is unref'd too. That leaves a window
  // — a batch flush that fires while we're processing an in-memory chunk, not
  // awaiting a disk read — in which the ONLY pending work is that unref'd
  // setImmediate and NOTHING is ref'd. Node's rule is to exit when only unref'd
  // handles remain, WITHOUT running them: the yield's continuation never fires,
  // the run is abandoned, and the process exits 0 silently mid-file — no error
  // for the fault-tolerance to catch. This one ref'd (NOT unref'd) timer
  // guarantees a live handle for the whole run, so the loop can never drain from
  // under a pending yield. Every real exit is an explicit process.exit()
  // (finish(), the shutdown watchdog, the second-signal path, the fatal catch),
  // so keeping this handle alive never delays a genuine shutdown; finish()
  // clears it before that final exit for tidiness. Same lesson as waitMs
  // (deliberately un-unref'd).
  const keepAlive = setInterval(() => {}, 1 << 30);

  // ── stall watchdog: a hang must become a resume, never a zombie ──
  //
  // The two deliberate design choices above — swallowing dropped-connection
  // errors so a long run survives them, and a ref'd keep-alive so the loop can
  // never drain from under a pending yield — combine into one failure mode:
  // an error that escapes to `uncaughtException` and leaves an await unsettled
  // gives a live process that will never make progress again. Nothing else in
  // the run can notice that, because noticing requires an outside view.
  //
  // So: any progress at all is a beat. If none arrives for STALL_MS, exit
  // non-zero. Resume costs at most the work since the last checkpoint, and the
  // durable cursor means that work is bounded and re-done exactly once.
  let lastBeat = Date.now();
  let quiet = 0; // depth of legitimately deposit-free work
  const beat = () => (lastBeat = Date.now());
  /** Run `fn` without the watchdog counting its silence. For work that is
   *  bounded and known to deposit nothing: index maintenance, the recall. */
  const unwatched = async <T>(fn: () => Promise<T>): Promise<T> => {
    quiet++;
    try {
      return await fn();
    } finally {
      quiet--;
      beat();
    }
  };
  let swallowed = 0; // uncaught errors the run chose to survive
  if (STALL_MS > 0) {
    const stallTimer = setInterval(() => {
      if (quiet > 0) return beat();
      if (Date.now() - lastBeat < STALL_MS) return;
      process.stderr.write(SHOW);
      process.stderr.write(
        `\n${RED}✗ no progress for ${
          Math.round((Date.now() - lastBeat) / 60_000)
        } min${R} — the run is not advancing, so it is exiting to be resumed.\n` +
          `  Nothing is lost: training continues from the last checkpoint.\n` +
          (swallowed > 0
            ? `  ${swallowed} error(s) were swallowed earlier; the last one` +
              ` probably left an operation unfinished.\n`
            : "") +
          `  Set STALL_MIN=0 to disable this check.\n`,
      );
      process.exit(75); // EX_TEMPFAIL: "try again", for a supervisor
    }, 30_000);
    if (typeof stallTimer.unref === "function") stallTimer.unref();
  }

  const checkpoint = () => mind.save();
  const maintain = () => runIndexMaintenance(mind, (m) => progress.log(m));

  // The checkpoint recall is a best-effort diagnostic. It is time-bounded so a
  // slow/large store can never freeze the deposit loop, and guarded so a still
  // running recall is never stacked on top of another.
  let inferBusy = false;
  const runRecall = async (item: TrainingItem, n: number): Promise<void> => {
    if (inferBusy) return;
    inferBusy = true;
    try {
      const info = promptOf(item);
      const r = await unwatched(() =>
        withTimeout(
          mind.respond(info.prompt),
          INFER_TIMEOUT_MS,
          "recall",
        )
      );
      const resp = new TextDecoder().decode(r.bytes).replace(/\u0000+/g, "");
      const box = renderInferenceBox(
        info.prompt,
        info.expected,
        resp,
        info.kind,
        n,
      );
      state.lastSample = box;
      if (!progress.interactive) progress.log(box);
      tick(true);
    } catch (err) {
      progress.log(
        `  ${DIM}· checkpoint #${n} recall skipped: ${
          err instanceof Error ? err.message : String(err)
        }${R}`,
      );
    } finally {
      inferBusy = false;
    }
  };

  // ── the in-flight unit, and the cursor that makes it resumable exactly ──
  const META_CURSOR = "train.cursor";
  /** The corpus currently depositing, so each deposit can be tallied to it as
   *  it happens rather than in a lump when the unit ends — a lump cannot be
   *  snapshotted mid-unit, and the cursor needs a tally that is true at the row
   *  it names. */
  let activeCorpus = "";
  /** Taken at a ROW BOUNDARY: the position, and the counters as they stood
   *  there. Both together, or the pair disagrees and the resume miscounts. */
  let pending: UnitCursor | null = null;
  let resumeCursor: UnitCursor | null = null;

  const snapCursor = (): UnitCursor | null => pending;

  /** Write the cursor and COMMIT.
   *
   *  The ordering here is the whole safety argument. `store.commit()` flushes
   *  the pending node/edge/halo buffers and only then commits the transaction
   *  the setMeta above joined — so the cursor and the deposits it counts become
   *  durable together, never the cursor first. A row behind the cursor is
   *  therefore always in the store, which is what makes skipping it on resume
   *  safe rather than a way to lose data. */
  const saveCursor = async (c: UnitCursor | null): Promise<void> => {
    if (c) await store.setMeta(META_CURSOR, JSON.stringify(c));
    else await store.setMeta(META_CURSOR, "");
    store.commit();
  };

  // ── the two per-corpus tallies, which persist and restore identically ──
  const META_LANG_TALLY = "train.langTally";
  const META_ROWS_TAKEN = "train.rowsTaken";

  /** Read a `{key: number}` meta map into `into`. A missing or corrupt value
   *  leaves `into` untouched, which is the fresh-store state. */
  const loadTally = async (key: string, into: Record<string, number>) => {
    try {
      const raw = await store.getMeta(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      for (const [k, v] of Object.entries(parsed)) into[k] = Number(v) || 0;
    } catch { /* fresh tally */ }
  };

  /** Write both tallies. `rowsTaken` is only written once something is IN it,
   *  so a curriculum with no budgeted corpus never grows the key at all. */
  const saveTallies = async () => {
    await store.setMeta(META_LANG_TALLY, JSON.stringify(counters.langTally));
    if (Object.keys(counters.rowsTaken).length > 0) {
      await store.setMeta(META_ROWS_TAKEN, JSON.stringify(counters.rowsTaken));
    }
  };

  // ── graceful shutdown (always leaves the store consistent) ──
  let finishing = false;

  const ctx: TrainCtx = {
    store,
    mind,
    ci,
    progress,
    state,
    counters,
    http,
    stopRequested: false,
    stopReason: "interrupted",
    tick,
    sample,

    // ── per-example callback: gates MAX_MB, drives checkpoints + samples ──
    async onDeposit(contentBytes: number): Promise<boolean> {
      beat(); // the primary sign of life
      counters.depositCount++;
      counters.trainedContentBytes += contentBytes;
      // Tallied HERE rather than added in a lump when the unit finishes: a lump
      // is invisible to a mid-unit cursor, and a resumed run would then restore
      // a tally missing everything before the cursor.
      if (activeCorpus) {
        counters.langTally[activeCorpus] =
          (counters.langTally[activeCorpus] ?? 0) + 1;
      }
      bytesSinceCkpt += contentBytes;
      state.fileExamples++;

      if (bytesSinceCkpt >= CHECKPOINT_BYTES) {
        bytesSinceCkpt %= CHECKPOINT_BYTES;
        const n = ++checkpointNum;
        const item = sampleItem;
        sampleItem = null;
        seenInWindow = 0;
        if (item) await runRecall(item, n);
        try {
          await unwatched(async () => {
            await maintain();
            await checkpoint();
          });
          // A checkpoint is the natural resume point: the data is flushed, so
          // the position and the counters that describe it can be recorded.
          // Without this a unit could only be resumed from its first row.
          await saveCursor(snapCursor());
        } catch (err) {
          progress.log(
            `  ${YEL}⚠ checkpoint failed${R}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        tick(true);
      } else {
        tick();
      }

      // Stop AFTER the deposit is counted/displayed so the final item is never
      // lost from the totals. A pending signal stops at this same boundary, so a
      // clean shutdown and a MAX_MB cap unwind through identical, tested code.
      return !ctx.stopRequested && counters.trainedContentBytes < MAX_BYTES;
    },

    get resumeCursor(): UnitCursor | null {
      return resumeCursor;
    },

    readCtx(opts: {
      unitId: string;
      corpusId: string;
      startRow?: number;
      shouldStop?: () => boolean;
      rowsTakenNow?: () => number;
    }): ReadContext {
      activeCorpus = opts.corpusId;
      const rowsTakenSnap = () =>
        opts.rowsTakenNow
          ? { ...counters.rowsTaken, [opts.corpusId]: opts.rowsTakenNow() }
          : { ...counters.rowsTaken };
      // Seed at the resume point, so a run interrupted again before its first
      // row boundary still records the skip it inherited rather than losing it.
      pending = {
        unitId: opts.unitId,
        rows: opts.startRow ?? 0,
        depositCount: counters.depositCount,
        trainedContentBytes: counters.trainedContentBytes,
        totalBytesProcessed: counters.totalBytesProcessed,
        langTally: { ...counters.langTally },
        rowsTaken: rowsTakenSnap(),
      };
      return {
        ci,
        onExample: ctx.onDeposit,
        sample,
        signal: shutdown.signal,
        shouldStop: opts.shouldStop,
        startRow: opts.startRow,
        // Position AND counters captured in the same breath. Snapshotting the
        // tallies costs two small object copies per row, against an ingest —
        // not a cost worth trading correctness for.
        onRowDone: (rows) => {
          pending = {
            unitId: opts.unitId,
            rows,
            depositCount: counters.depositCount,
            trainedContentBytes: counters.trainedContentBytes,
            totalBytesProcessed: counters.totalBytesProcessed,
            langTally: { ...counters.langTally },
            rowsTaken: rowsTakenSnap(),
          };
        },
      };
    },

    /** Acquire a source file: reuse a cached copy, else download `url` into the
     *  cache under `destName` (atomic, retried, rate-limit-tolerant, shows live
     *  byte progress). Returns the local path, or null on a non-abort failure
     *  (logged). `label` names the file in the panel/log. */
    async acquire(
      url: string,
      destName: string,
      label: string,
    ): Promise<AcquiredFile | null> {
      const dest = join(CACHE_DIR, destName);
      if (existsSync(dest)) {
        progress.log(`  ${GRN}✓${R} ${label} ${DIM}(cached)${R}`);
        return { path: dest, cached: true };
      }
      let size = 0;
      try {
        size = await headSize(url, { signal: shutdown.signal });
      } catch { /* unknown — proceed without a cache-room reservation */ }
      state.activity = "download";
      state.filePath = label;
      state.fileSize = size;
      const slot = { done: 0, total: size, t0: Date.now() };
      dlSlot = slot;
      tick(true);
      try {
        await ensureCacheRoom(
          size,
          shutdown.signal,
          (m) => progress.log(`  ${YEL}⚠${R} ${m}`),
        );
        slot.t0 = Date.now();
        await downloadFile(url, dest, {
          signal: shutdown.signal,
          tries: DOWNLOAD_TRIES,
          onFail: (n, e) =>
            progress.log(
              `  ${YEL}⚠${R} ${label} download attempt ${n}/${DOWNLOAD_TRIES}: ${e.message}`,
            ),
          onProgress: (done, total) => {
            beat(); // bytes arriving is progress; a stalled socket is not
            slot.done = done;
            if (total > 0) slot.total = total;
          },
        });
      } catch (e) {
        dlSlot = null;
        if (ctx.stopRequested || (e as Error)?.name === "AbortError") {
          return null;
        }
        progress.log(
          `  ${RED}✗${R} ${label} download failed: ${(e as Error).message}`,
        );
        try {
          unlinkSync(dest);
        } catch { /* best effort */ }
        return null;
      }
      dlSlot = null;
      const dlS = Math.max(0.001, (Date.now() - slot.t0) / 1000);
      const sz = statSync(dest).size;
      progress.log(
        `  ${CYAN}⬇${R} ${label} ${bytes(sz)} ${DIM}${dur(dlS)} @ ${
          bytes(sz / dlS)
        }/s${R}`,
      );
      return { path: dest, cached: false };
    },

    async persist(completedFiles: string[], unitDone = false): Promise<void> {
      // Best effort by contract: a failed write here is recoverable because
      // finish() writes the same record again, and a resume that re-reads from
      // the last durable cursor is harmless (deposition is idempotent).
      try {
        await saveProgress(store, {
          completedFiles,
          depositCount: counters.depositCount,
          trainedContentBytes: counters.trainedContentBytes,
          totalBytesProcessed: counters.totalBytesProcessed,
          totalCorpusBytes: counters.totalCorpusBytes,
        });
        await saveTallies();
        // A finished unit has no position inside it; an unfinished one records
        // exactly where it stopped, so a graceful stop resumes with no re-read
        // at all rather than from its last checkpoint.
        await saveCursor(unitDone ? null : snapCursor());
        if (unitDone) {
          pending = null;
          activeCorpus = "";
        }
      } catch { /* best effort — finish() will retry */ }
    },

    async restore(): Promise<SavedProgress> {
      const prog = await loadProgress(store);
      counters.depositCount = prog.depositCount;
      counters.trainedContentBytes = prog.trainedContentBytes;
      counters.totalBytesProcessed = prog.totalBytesProcessed;
      // NOT prog.totalCorpusBytes. This counter is the ETA's denominator and it
      // grows as each unit's size is discovered, so restoring the stored figure
      // and then adding to it counts every unit a resume RE-READS a second
      // time — the corpus percentage and the ETA drift further out with each
      // interruption. Seeding it from the bytes already processed is exact
      // instead of approximate: units finished in earlier runs are accounted
      // for by that total, and units this run opens add themselves as they are
      // opened. When a unit completes, both counters gain its size, so the
      // fraction closes on 1 rather than sliding.
      counters.totalCorpusBytes = prog.totalBytesProcessed;
      rateTrained = counters.trainedContentBytes;
      rateBytes = counters.totalBytesProcessed;
      await loadTally(META_LANG_TALLY, counters.langTally);
      await loadTally(META_ROWS_TAKEN, counters.rowsTaken);

      // A cursor for a unit that is NOT in completedFiles means the last run
      // stopped inside it. Its counters are the ones that describe the store at
      // that position, so they replace the running totals: the totals may
      // include deposits made after the cursor, and those rows are about to be
      // read again. Counting them from the totals AND from the re-read is
      // exactly the double-count that inflated every resumed store.
      try {
        const raw = await store.getMeta(META_CURSOR);
        const c = raw ? JSON.parse(raw) as UnitCursor : null;
        if (c?.unitId && !prog.completedFiles.includes(c.unitId)) {
          resumeCursor = c;
          counters.depositCount = c.depositCount;
          counters.trainedContentBytes = c.trainedContentBytes;
          counters.totalBytesProcessed = c.totalBytesProcessed;
          counters.totalCorpusBytes = c.totalBytesProcessed;
          counters.langTally = { ...c.langTally };
          counters.rowsTaken = { ...c.rowsTaken };
          rateTrained = counters.trainedContentBytes;
          rateBytes = counters.totalBytesProcessed;
          progress.log(
            `  ${CYAN}↻${R} resuming inside ${c.unitId} at row ${
              int(c.rows)
            } ${DIM}(no re-reading)${R}`,
          );
        }
      } catch { /* no cursor — resume at unit granularity, as before */ }

      if (prog.completedFiles.length > 0) {
        progress.log(
          `  ${CYAN}↻${R} resuming: ${prog.completedFiles.length} stage-unit(s) done, ` +
            `${int(counters.depositCount)} examples, ${
              bytes(counters.trainedContentBytes)
            } learned`,
        );
      }
      return prog;
    },

    async finish(why: string): Promise<void> {
      if (finishing) return;
      finishing = true;
      shutdown.abort(); // unblock any straggling fetch/pipeTo
      tick(true);
      // An interrupted run is not a completed one, in the store or in the exit
      // code. Both used to say otherwise: `completedAt` was stamped on every
      // path, and Ctrl+C exited 0, so nothing downstream — a supervisor, a
      // later inspection of the store — could tell a finished curriculum from
      // one that was killed halfway. A MAX_MB cap DOES count as finished: the
      // run stopped where it was asked to, which is why it reports "done".
      const completed = !ctx.stopRequested;
      await store.setMeta(
        completed ? "train.completedAt" : "train.interruptedAt",
        new Date().toISOString(),
      );
      await store.setMeta(
        "train.totalDeposits",
        String(counters.depositCount),
      );
      await store.setMeta(
        "train.totalTrainedBytes",
        String(counters.trainedContentBytes),
      );
      await store.setMeta(
        "train.totalBytes",
        String(counters.totalBytesProcessed),
      );
      await store.setMeta(
        "train.totalCorpusBytes",
        String(counters.totalCorpusBytes),
      );
      await saveTallies();
      if (swallowed > 0) {
        await store.setMeta("train.swallowedErrors", String(swallowed));
      }
      try {
        await unwatched(async () => {
          await maintain();
          await checkpoint();
        });
      } catch (err) {
        process.stderr.write(
          `\n  ${YEL}⚠ final checkpoint failed${R}: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
      clearInterval(paintTimer);
      clearInterval(keepAlive);
      progress.dispose();
      const elapsedS = (Date.now() - t0) / 1000;
      const elapsed = dur(elapsedS);
      const avgRate = elapsedS > 0
        ? counters.trainedContentBytes / elapsedS
        : 0;
      const tally = Object.entries(counters.langTally)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${int(v)}`)
        .join(", ");
      let entries = counters.depositCount;
      try {
        entries = await mind.store.size();
      } catch { /* best effort */ }
      console.log(
        `\n${GRN}✓${R} ${why}.  ${basename(DB_PATH)}.sqlite: ` +
          `${int(entries)} entries, ${int(counters.depositCount)} examples, ` +
          `${bytes(counters.trainedContentBytes)} content learned ` +
          `${DIM}(${bytes(avgRate)}/s avg)${R}, ` +
          `${
            bytes(counters.totalBytesProcessed)
          } corpus processed, ${elapsed} elapsed.` +
          (tally ? `\n  ${DIM}per language:${R} ${tally}` : ""),
      );
      try {
        await store.close();
      } catch { /* best effort */ }
      // 130 is the conventional "killed by SIGINT" code, and it is what the
      // second-signal and watchdog paths already exit with — so all three ways
      // an interrupted run can end now agree.
      process.exit(completed ? 0 : 130);
    },
  };

  const requestStop = (reason: string) => {
    if (ctx.stopRequested) {
      process.stderr.write(`\n${YEL}⚠ second signal — exiting now${R}\n`);
      process.stderr.write(SHOW);
      process.exit(130);
    }
    ctx.stopRequested = true;
    ctx.stopReason = reason;
    shutdown.abort();
    progress.log(`  ${YEL}⏸${R} ${reason} — finishing current item, saving…`);
    const watchdog = setTimeout(() => {
      process.stderr.write(
        `\n${YEL}⚠ shutdown watchdog fired — forcing exit${R}\n`,
      );
      process.stderr.write(SHOW);
      process.exit(130);
    }, 60_000);
    if (typeof watchdog.unref === "function") watchdog.unref();
  };
  process.on("SIGINT", () => requestStop("interrupted"));
  process.on("SIGTERM", () => requestStop("terminated"));

  // ── fail-safe: a dropped connection must never kill a long run ──
  process.on("unhandledRejection", (reason) => {
    progress.log(
      `  ${YEL}⚠ unhandled rejection${R}: ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
    );
  });
  process.on("uncaughtException", (err) => {
    const code = (err as any)?.code ?? (err as any)?.cause?.code;
    if (err.message === "terminated" || code === "UND_ERR_SOCKET") {
      // Survived on purpose — but COUNTED, because an error that leaves an
      // operation unfinished shows up later as silence, and the watchdog's
      // message should be able to say so.
      swallowed++;
      progress.log(
        `  ${YEL}⚠ connection error (ignored, ${swallowed} so far)${R}: ${err.message}`,
      );
      return;
    }
    process.stderr.write(
      `\n${RED}uncaught exception${R}: ${err.message}\n${err.stack ?? ""}\n`,
    );
    try {
      void store.setMeta("train.crashedAt", new Date().toISOString());
      void store.setMeta("train.crashError", err.message);
      void store.setMeta(
        "train.totalDeposits",
        String(counters.depositCount),
      );
    } catch { /* best effort */ }
    process.exit(1);
  });

  return ctx;
}
