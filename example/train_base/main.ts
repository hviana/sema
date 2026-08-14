//This file uses the Google SMOL dataset, made available under the CC BY 4.0 license.
//This file uses Aya and oasst2 datasets, made available under the apache-2.0 license.
//
//A trained Sema store retains its training text VERBATIM, so distributing a
//store distributes these corpora and every upstream licence applies to it in
//full. Read DATASETS.md before adding a corpus here or publishing a store:
//it carries the per-corpus attribution a distributed store is required to
//travel with, and the two rules a candidate corpus must pass (no NonCommercial
//term, no ShareAlike term — checked against what the corpus was BUILT FROM,
//not merely against the repository's licence tag).

//This file is a more appropriate training example for Sema.
//Sema does not learn through repetition;
//it does not require a massive database.
//It needs fundamental datasets that teach basic cognitive concepts such as conversation, logic, relationships, behaviors and feelings.
//The focus is on covering fundamental patterns, not repetition.
//Tip: ontology-based adapted training datasets could be an interesting path.

// train_base/main.ts — streaming trainer for the SmolSent + Aya + oasst2 +
//                  Taskmaster + 2Wiki + SODA base.
//
// Training IS deposition: every source datum is translated into SEMA facts (or,
// for genuine dialogue, accumulated-context episodes), then stored in one pass.
// There are no gradients or epochs, and there is no LLM in the loop — the only
// "model" is the SEMA store itself.
//
// Every source here is commercially licensable (cc-by-4.0 / apache-2.0).
//
// WHERE THINGS LIVE (this file is the folder's entry point and nothing else):
//
//   config.ts     RUN-level knobs — store, checkpoint cadence, cache ceiling,
//                 MAX_MB, the Parquet read budget.
//   items.ts      the REPRESENTATION core: what a training item is (fact /
//                 experience / accumulated walk) and the policy governing
//                 which shape a datum may take.
//   http.ts       network policy: wait out throttling, retry what is
//                 transient, give up at once on what is not.
//   cache.ts      the durable disk cache and the atomic download sink — the
//                 sole irreducible Node dependency.
//   readers.ts    container formats: newline-delimited JSON (plain or
//                 gzipped), JSON arrays, Parquet.
//   discovery.ts  where a work-list comes from: an HF repo tree, the
//                 auto-converted Parquet branch, a GitHub directory, a local
//                 directory.
//   progress.ts   the resume record inside the store, and the index passes
//                 that keep a checkpoint queryable.
//   ui.ts         the live panel, the formatters, the recall box.
//   runtime.ts    the RUN: counters, the deposit gate, file acquisition,
//                 checkpointing, shutdown.
//   stage.ts      ONE loop, run once per corpus.
//   corpora/      ONE FILE PER CORPUS: its knobs, its row adapter, its stage
//                 descriptor, and the evidence that fixed each default.
//                 corpora/index.ts is the curriculum, in order.
//
// Adding a corpus is therefore one new file in corpora/ and one line in
// corpora/index.ts — no change to the loop, the readers, or the run.
//
// Every source is DOWNLOADED as a file and streamed from disk (never paged
// row-by-row over an HTTP API — that was slow and rate-limited). Resume is
// per-file: a fully-consumed file is marked complete; an interrupted one
// re-reads from the top (re-deposition is idempotent). LOCAL_PATH may hold
// pre-downloaded files.
//
// The store IS the model: memories, training metadata, and the config snapshot
// all live in {DB_PATH}.sqlite, so a run resumes from the store alone.
//
// Built on web standards. All I/O except the durable disk cache uses platform
// primitives — fetch, WHATWG ReadableStream/WritableStream/TransformStream,
// DecompressionStream, TextDecoderStream, Blob, AbortController. The sole
// third-party code is hyparquet (+ its Snappy codec): a DEV dependency of this
// example, never of the library, and loaded by a dynamic import inside
// readers.ts the first time a Parquet corpus is read — so a curriculum with no
// Parquet stage needs it not at all. Consistency guarantees:
//   • Resume from the store alone — completed stage-units, example count,
//     learned-content bytes, and processed-byte total are persisted in
//     {DB_PATH}.sqlite and reloaded.
//   • Atomic cache — a download streams to "<file>.part", is fsync'd, then
//     renamed into place; a file at its final path is, by construction,
//     complete, so an interrupted download can never be mistaken for a cached
//     one.
//   • Bounded cache — a download blocks under the MAX_CACHE_GB ceiling and the
//     fully-processed file is deleted immediately.
//   • Interruptible — Ctrl+C (SIGINT/SIGTERM) aborts in-flight network at once,
//     stops at the next item boundary, writes a final checkpoint, and exits; an
//     un-finished stage-unit is NOT marked complete, so resume re-reads it (re-
//     deposition is idempotent). A second Ctrl+C, or a 60s watchdog, force-exits.
//
// Run:
//   npx tsc && node dist/example/train_base/main.js
//   MAX_MB=500 node dist/example/train_base/main.js
//   CHECKPOINT_MB=250 node dist/example/train_base/main.js
//   SMOLSENT_PAIRS=ha_en,zu_en node dist/example/train_base/main.js  # a subset of pairs
//   SMOLSENT_DIRECTIONS=both node dist/example/train_base/main.js  # also English->foreign
//   SMOLSENT=0 node dist/example/train_base/main.js           # skip SmolSent stage
//   AYA=0 node dist/example/train_base/main.js                # skip Aya stage
//   OASST=0 node dist/example/train_base/main.js              # skip oasst2 stage
//   OASST_MIN_TURNS=6 node dist/example/train_base/main.js    # deeper multi-turn only
//   GENKNOW=1 node dist/example/train_base/main.js            # General-Knowledge (see DATASETS.md §3.2)
//   PARQUET_BATCH_MB=8 node dist/example/train_base/main.js   # smaller Parquet reads on a tight host
//   TASKMASTER=0 node dist/example/train_base/main.js         # skip Taskmaster stage
//   TASKMASTER_SETS=TM-3-2020 node dist/example/train_base/main.js  # one Taskmaster set
//   WIKI2=0 node dist/example/train_base/main.js               # skip 2Wiki triples stage
//   SODA=0 node dist/example/train_base/main.js                # skip the SODA stage
//   MASSIVE=1 node dist/example/train_base/main.js             # enable MASSIVE (off by default)
//   SODA_MAX_DIALOGS=0 node dist/example/train_base/main.js    # lift the SODA budget
//   WIKI2_MAX_ROWS=50000 node dist/example/train_base/main.js  # budget the 2Wiki stage
//   LOCAL_PATH=./base node dist/example/train_base/main.js    # offline: *.jsonl/.parquet/.jsonl.gz/.json
//   DB_PATH=./data/sema node dist/example/train_base/main.js

import { CachedIngest, Mind, SQliteStore } from "../../src/index.js";
import {
  D,
  DB_PATH,
  SEED,
  SQLITE_CACHE_MB,
  VECTOR_CACHE_MB,
} from "./config.js";
import { createRuntime } from "./runtime.js";
import { runStage } from "./stage.js";
import { CURRICULUM, enabledLabels } from "./corpora/index.js";
import { dur, num, R, RED, SHOW } from "./ui.js";

// The parser/representation surface this module used to define itself. Kept
// exported from here so importing `example/train_base/main.js` still reaches every
// row adapter (toSmolSentRow, wikiTriplesToItems, …) and the shapes they build.
export * from "./items.js";
export * from "./corpora/index.js";
export { parquetBatchRows } from "./readers.js";
// The name this helper had while it lived here. It is `mergeSpeakerTurns` now,
// because SODA merges by the same rule and the Taskmaster-specific name was a
// lie — but the old name stays reachable so nothing importing it breaks.
export { mergeSpeakerTurns as mergeTaskmasterTurns } from "./items.js";

async function main(): Promise<void> {
  const store = new SQliteStore({
    path: DB_PATH,
    D,
    vectorCacheMb: VECTOR_CACHE_MB,
    sqliteCacheMb: SQLITE_CACHE_MB,
  });

  // The store IS the model: memories, progress, and metadata all persist in
  // it, so a resumed run just reopens the same store and continues. Guard
  // against a changed D/SEED by comparing against what a previous run recorded.
  const mind = new Mind({ seed: SEED, store });

  // Pre-fill the vector indices' RAM caches with sequential scans (bounded by
  // VECTOR_CACHE_MB).  A resumed run over a large store otherwise spends its
  // first minutes warming those caches through random point reads — the
  // ingest hot path is cache-miss bound until then.  Seconds, once, up front.
  if (VECTOR_CACHE_MB > 0) {
    const t = Date.now();
    const warmed = await store.warmVectorCaches();
    if (warmed > 0) {
      process.stderr.write(
        `  warmed vector caches: ${num(warmed)} rows in ${
          dur((Date.now() - t) / 1000)
        }\n`,
      );
    }
  }
  const ci = new CachedIngest(mind);
  const prevD = await store.getMeta("train.D");
  const prevSeed = await store.getMeta("train.seed");
  if (
    (prevD && Number(prevD) !== D) || (prevSeed && Number(prevSeed) !== SEED)
  ) {
    process.stderr.write(
      `fatal: D/SEED changed (store has D=${prevD} seed=${prevSeed}, ` +
        `requested D=${D} seed=${SEED}). Delete ${DB_PATH}.sqlite ` +
        `to start fresh.\n`,
    );
    process.exit(1);
  }

  const dataset = enabledLabels();
  await store.setMeta("train.dataset", dataset);
  await store.setMeta("train.D", String(D));
  await store.setMeta("train.seed", String(SEED));
  await store.setMeta("train.createdAt", new Date().toISOString());

  const ctx = createRuntime({ store, mind, ci, title: dataset });
  ctx.tick(true);

  // ── resume — restore counters and the per-source tally from the store ──
  await ctx.restore();

  // Walk the curriculum. Each stage skips itself on a resume that already
  // finished it, and the walk stops at the first requested stop.
  for (const corpus of CURRICULUM) {
    if (ctx.stopRequested) break;
    await runStage(ctx, corpus);
  }

  await ctx.finish(ctx.stopRequested ? ctx.stopReason : "done");
}

// Only run when invoked directly, so importing the row adapters above (e.g.
// for a fixture check) never starts training.
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("train_base/main.js");
if (isMain) {
  main().catch((e) => {
    process.stderr.write(SHOW);
    console.error(`\n${RED}fatal:${R}`, e);
    process.exit(1);
  });
}
