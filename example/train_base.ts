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

// train_base.ts — streaming trainer for the SmolSent + Aya + oasst2 +
//                  General-Knowledge base.
//
// Training IS deposition: every source datum is translated into SEMA facts (or,
// for genuine dialogue, accumulated-context episodes), then stored in one pass.
// There are no gradients or epochs, and there is no LLM in the loop — the only
// "model" is the SEMA store itself. The ingestion structures, filtering,
// checkpointing, cache, and resume model are unchanged from the original LLM-
// base trainer; only corpus discovery and the row adapters are source-specific.
//
// Every source here is commercially licensable (cc-by-4.0 / apache-2.0).
//
// The curriculum runs in eight stages, into ONE store:
//   1. SmolSent (google/smol) — sentence-level TRANSLATION pairs across 100+
//      low-resource languages; see §6c. Each pair is "two names for one meaning"
//      → a foreign→English translation FACT, so every language's rendering of a
//      meaning converges on ONE English node — the cross-language concept SEMA
//      fuses (cf. test/05-concepts.test.mjs). The reverse binding is NOT
//      deposited by default; see SMOLSENT_DIRECTIONS for why.
//   2. Aya Dataset — ~204k human prompt→completion pairs, 70+ languages; see §6d
//      → one (question → answer) FACT each.
//   3. oasst2 — MULTI-TURN human↔assistant conversation trees; see §6e → the
//      accumulated-context walk (single-turn trees are skipped, by design).
//   4. Taskmaster 1–4 (google-research-datasets) — task-oriented DIALOGUE, the
//      best-scoring corpora on the fold-unit recurrence benchmark that predicts
//      halo health; see §6e′ → the accumulated-context walk, over turns merged
//      per speaker.
//   5. 2WikiMultihopQA — the `evidences` (subject, relation, object) TRIPLES,
//      the one stage aimed at COMPOSITION; see §6e″ → a relation fact plus a
//      bare-subject PIVOT fact each. Its Wikipedia passages and its composed
//      questions are deliberately NOT read.
//   6. SODA — social/commonsense DIALOGUE; see §6e‴ → the accumulated-context
//      walk. Budgeted: its train split alone would otherwise contribute ~8M
//      episodes against 662k for the whole current corpus.
//   7. MASSIVE — short intent utterances in 51 locales; see §6e⁗ → ONE bare
//      experience each. Contributes recurring fold units, nothing relational.
//      DISABLED BY DEFAULT — edge-less content was measured to manufacture
//      answers where the store should stay silent.
//   8. General-Knowledge (MuskumPillerum) — ~37.6k {Question, Answer} pairs; see
//      §6f → one (question → answer) FACT each. DISABLED BY DEFAULT on licence
//      grounds; see DATASETS.md §3.2.
// Each stage runs only after the previous one finishes, and is recorded in the
// same completed-files set, so a single store resumes the whole curriculum.
//
// Every source is DOWNLOADED as a file and streamed from disk (never paged
// row-by-row over an HTTP API — that was slow and rate-limited): SmolSent as
// per-pair JSONL, oasst2 as a gzipped JSONL, Taskmaster and General-Knowledge as
// JSON arrays,
// and Aya as Snappy-Parquet read row-group by row-group with hyparquet (the one
// case the web platform can't decode alone). Resume is per-file: a fully-
// consumed file is marked complete; an interrupted one re-reads from the top
// (re-deposition is idempotent). LOCAL_PATH may hold pre-downloaded files.
//
// REPRESENTATION POLICY (one datum → one form; no replication):
//   • FACTS are the default. A datum that is a RELATION (translation pair,
//     question → answer) is emitted as a (context → continuation) edge SEMA
//     points at and, by example across the corpus, generalizes from (cf.
//     example/demo.ts). SmolSent emits two facts (both directions); Aya one.
//   • EXPERIENCES (bare statements) are used only when a fact is NOT possible —
//     content with no natural relational split. (No current stage needs this;
//     it stays available for plain-text corpora.)
//   • CUMULATIVE CONTINUOUS CONTEXT is used only when truly necessary — genuine
//     MULTI-TURN dialogue, where a turn follows from the whole conversation so
//     far. Only oasst2 (§6e) uses it; the fact stages do NOT synthesize a multi-
//     turn walk, which would just replicate the facts (repetition SEMA avoids).
//
// The store IS the model: memories, training metadata, and the config snapshot
// all live in {DB_PATH}.sqlite, so a run resumes from the store alone.
//
// Built on web standards. All I/O except the durable disk cache uses platform
// primitives — fetch, WHATWG ReadableStream/WritableStream/TransformStream,
// DecompressionStream ("gzip" for the oasst2 file), TextDecoderStream, Blob,
// AbortController. The sole third-party code is hyparquet (+ its Snappy codec),
// used only to read Aya's Parquet over a web-standard Blob byte source. Node's
// stdlib is touched only for the filesystem (the cache), which the web platform
// does not expose. Consistency guarantees:
//   • Resume from the store alone — completed stage-units, example count,
//     learned-content bytes, and processed-byte total are persisted in
//     {DB_PATH}.sqlite and reloaded. API stages persist a page offset; the
//     oasst2 download is atomic (see below).
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
//   npx tsc && node dist/example/train_base.js
//   MAX_MB=500 node dist/example/train_base.js
//   CHECKPOINT_MB=250 node dist/example/train_base.js
//   SMOLSENT_PAIRS=ha_en,zu_en node dist/example/train_base.js  # a subset of pairs
//   SMOLSENT_DIRECTIONS=both node dist/example/train_base.js  # also English->foreign
//   SMOLSENT=0 node dist/example/train_base.js           # skip SmolSent stage
//   AYA=0 node dist/example/train_base.js                # skip Aya stage
//   AYA_SPLIT=test node dist/example/train_base.js       # small Aya slice
//   OASST=0 node dist/example/train_base.js              # skip oasst2 stage
//   OASST_MIN_TURNS=6 node dist/example/train_base.js    # deeper multi-turn only
//   GENKNOW=1 node dist/example/train_base.js            # General-Knowledge (see DATASETS.md §3.2)
//   PARQUET_BATCH_MB=8 node dist/example/train_base.js   # smaller Parquet reads on a tight host
//   TASKMASTER=0 node dist/example/train_base.js         # skip Taskmaster stage
//   TASKMASTER_SETS=TM-3-2020 node dist/example/train_base.js  # one Taskmaster set
//   WIKI2=0 node dist/example/train_base.js               # skip 2Wiki triples stage
//   SODA=0 node dist/example/train_base.js                # skip the SODA stage
//   MASSIVE=1 node dist/example/train_base.js             # enable MASSIVE (off by default)
//   SODA_MAX_DIALOGS=0 node dist/example/train_base.js    # lift the SODA budget
//   WIKI2_MAX_ROWS=50000 node dist/example/train_base.js  # budget the 2Wiki stage
//   LOCAL_PATH=./base node dist/example/train_base.js    # offline: *.jsonl/.parquet/.jsonl.gz/.json
//   DB_PATH=./data/sema node dist/example/train_base.js

import { CachedIngest, Mind, SQliteStore, type Store } from "../src/index.js";
// One Node module — node:fs — and nothing else. Everything else (HTTP, byte
// streams, (de)compression, text decoding, cancellation) is a web standard:
// fetch, WHATWG ReadableStream/WritableStream/TransformStream,
// DecompressionStream, TextDecoderStream, Blob, AbortController. Reading a file
// goes through openAsBlob, which returns a web Blob (`.stream()` → web streams);
// writing a file is the single capability the web platform does not expose, so
// the download sink uses the synchronous fs descriptor calls below. The durable
// disk cache is therefore the sole, irreducible Node dependency.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openAsBlob,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, join } from "node:path";
// The ONLY third-party dependencies, and only for the one source that ships
// exclusively as Snappy-compressed Parquet (Aya): hyparquet is a pure-JS,
// dependency-free Parquet reader driven over a web-standard Blob byte source;
// hyparquet-compressors supplies the Snappy codec. Every other source is plain
// JSONL / JSON / gzip and needs no library.
import { parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

// ═══════════════════════════════════════════════════════════════════════
// §1  Configuration (all from the environment)
// ═══════════════════════════════════════════════════════════════════════

const env = (k: string, d: string) => process.env[k] ?? d;

// ── google/smol · SmolSent (the first training stage) ──
// SmolSent is Google's sentence-level translation set: ~863 human sentence pairs
// per language pair across 100+ low-resource languages, cc-by-4.0 (commercial-
// friendly). Each row is {sl, tl, src, trg, …} — a source sentence and its
// translation. A pair is "two names for one meaning", which is exactly the
// cross-language concept SEMA fuses (see test/05-concepts.test.mjs), so each row
// becomes FACTS that bind the two phrasings as one concept at recall time.
//
// The corpus ships as one plain JSONL file PER language pair under smolsent/ in
// the HF repo (e.g. smolsent/ha_en.jsonl). We DOWNLOAD each file and stream its
// lines — far faster and free of the rate-limiting that per-row API paging hit.
// The file list is discovered from the HF repo tree. SMOLSENT=0 disables the
// stage; SMOLSENT_PAIRS (comma-separated basenames without .jsonl, e.g.
// "ha_en,zu_en") restricts to a chosen subset.
const SMOLSENT = env("SMOLSENT", "1") !== "0";
const SMOLSENT_DATASET = env("SMOLSENT_DATASET", "google/smol");
const SMOLSENT_PAIRS = (process.env.SMOLSENT_PAIRS ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
// The resume id PREFIX for the SmolSent stage; one completed-files entry per
// file (e.g. "smolsent::ha_en.jsonl").
const SMOLSENT_ID = "smolsent";
// Which direction(s) of a translation pair to deposit. Was effectively "both",
// and that is now the default NO longer, for a reason measured rather than
// assumed.
//
// SmolSent's English side is a SHARED POOL translated into every language: row
// id 0 of smolsent/ha_en.jsonl, zu_en.jsonl and am_en.jsonl all carry the SAME
// `trg` ("It allows me to work by following my vibes and ..."). The two
// directions are therefore not symmetric at all:
//
//   src2trg  (foreign -> English)  many distinct contexts -> ONE shared
//                                  continuation. Every language's rendering of
//                                  a meaning converges on the same English
//                                  node — the cross-language concept fusion
//                                  this stage exists for.
//   trg2src  (English -> foreign)  ONE context -> 100+ DIFFERENT continuations,
//                                  one per language file. The same English
//                                  sentence is deposited over and over with a
//                                  different answer each time.
//
// So dropping trg2src is not merely a corpus-size economy (it halves the
// largest stage, which was 60.9% of all examples in the last trained store); it
// removes a genuine ambiguity pathology. Set SMOLSENT_DIRECTIONS=both to
// restore the old behaviour, or trg2src for English->foreign only.
//
// WHAT THE CUT DOES NOT DO, measured on a three-pair store: asking the English
// sentence still ANSWERS with a foreign rendering, because the engine can reach
// a shared continuation's predecessors on its own. What is removed is the
// DEPOSITED forward ambiguity — one context carrying ~100 competing
// continuations — not every reverse association.
const SMOLSENT_DIRECTIONS = env("SMOLSENT_DIRECTIONS", "src2trg")
  .trim().toLowerCase();
const SMOLSENT_SRC2TRG = SMOLSENT_DIRECTIONS !== "trg2src";
const SMOLSENT_TRG2SRC = SMOLSENT_DIRECTIONS === "trg2src" ||
  SMOLSENT_DIRECTIONS === "both";
// A SmolSent side longer than this is skipped (a sentence pair is short; a huge
// value is corruption, not a sentence).
const MAX_SMOLSENT_CHARS = Math.max(
  2_000,
  Math.floor(Number(env("MAX_SMOLSENT_KB", "16")) * 1000) || 16_000,
);

const DB_PATH = env("DB_PATH", "sema"); // → {DB_PATH}.sqlite
const D = Number(env("D", "1024"));
const SEED = Number(env("SEED", "7"));
// Checkpoint cadence is measured in LEARNED CONTENT, not deposits: a snapshot
// every CHECKPOINT_MB megabytes of trained UTF-8 content (decimal MB, matching
// the bytes() helper). A floor of 1 MB: a zero/NaN value must not make every
// deposit checkpoint, nor silently disable checkpointing. The tail (a run that
// learns less than one interval, or the remainder past the last interval) is
// always saved by finish() at exit — a complete point.
const CHECKPOINT_BYTES = Math.max(
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
const PARQUET_BATCH_BYTES = Math.max(
  1_000_000,
  Math.floor(Number(env("PARQUET_BATCH_MB", "32")) * 1_000_000) || 32_000_000,
);
const LOCAL_PATH = env("LOCAL_PATH", ""); // train from a local dir of *.zip
const CACHE_DIR = env("CACHE_DIR", join(process.cwd(), "cache"));
const MAX_CACHE_BYTES = Number(env("MAX_CACHE_GB", "100")) * 1e9;
const PROGRESS_MS = Number(env("PROGRESS_MS", "250")); // panel refresh cadence
// Index maintenance at checkpoints: compact (remove garbage), repair (fill
// gaps), then refresh the canonical-form index (equivalence-class resolution —
// src/canon.ts). All three are idempotent batch operations (the canon build is
// additionally incremental via the store's `canon.upto` cursor);
// INDEX_MAINTENANCE=0 disables.
const INDEX_MAINTENANCE = env("INDEX_MAINTENANCE", "1") !== "0";
const DOWNLOAD_TRIES = 5;
// In-progress downloads are written to a sibling "<dest>.part" and atomically
// renamed into place only after the bytes are fully flushed to disk. The cache
// invariant is therefore absolute: a file at its final path is, by definition,
// complete. Partial transfers (a crash, a kill, a dropped socket) leave only a
// .part file, which is swept at startup and never fed to the parser.
const PART_SUFFIX = ".part";

// A single process-wide abort signal. SIGINT/SIGTERM aborts it, which cancels
// every in-flight fetch immediately (instead of waiting out a slow socket), so
// Ctrl+C is responsive even mid-download. The deposit loop also polls it to
// stop cleanly at the next item boundary, leaving the store consistent.
const shutdown = new AbortController();
// The checkpoint recall is a best-effort diagnostic — it must NEVER stall
// training. We bound it so a slow/large store cannot freeze the deposit loop.
const INFER_TIMEOUT_MS = Number(env("INFER_TIMEOUT_MS", "15000"));

// A module-level hook so the low-level fetch retries can surface a rate-limit
// WAIT into the live progress log (set once main()'s panel exists). Without it a
// long 429 back-off would look like a silent hang. Throttled so a storm of 429s
// logs at most one "waiting" notice every few seconds.
let onThrottleWait: ((waitMs: number, label: string) => void) | null = null;
let lastThrottleLog = 0;

// Optional ceiling on how much LEARNED CONTENT to train, in megabytes (decimal,
// like CHECKPOINT_MB). Default Infinity = unbounded. The cap is checked against
// trainedContentBytes after each deposit, so a run stops at the first item that
// carries the running total to/past the ceiling (that item is still counted).
const MAX_MB = Number(env("MAX_MB", "Infinity"));
if (isNaN(MAX_MB) || MAX_MB < 0) {
  process.stderr.write(
    `fatal: MAX_MB must be a non-negative number or "Infinity"\n`,
  );
  process.exit(1);
}
const MAX_BYTES = MAX_MB * 1_000_000; // Infinity stays Infinity

// ── CohereLabs/aya_dataset (the second training stage, after SmolSent) ──
// The Aya Dataset is ~204k HUMAN-annotated prompt→completion pairs across 70+
// languages, each a clean (inputs → targets) fact in a named language. It ships
// ONLY as Snappy-compressed Parquet (no JSONL/CSV). We DOWNLOAD the one train
// Parquet file and read it row-group by row-group with `hyparquet` (a pure-JS,
// dependency-free Parquet reader) + `hyparquet-compressors` (Snappy) over a
// web-standard Blob byte source — no whole-file-in-memory load. AYA=0 disables
// the stage; AYA_URL overrides the Parquet source.
const AYA = env("AYA", "1") !== "0";
const AYA_URL = env(
  "AYA_URL",
  "https://huggingface.co/datasets/CohereLabs/aya_dataset/resolve/main/data/train-00000-of-00001.parquet",
);
// The resume id of the Aya stage, kept in the same completed-files set as the
// other stages, so one store records the whole curriculum.
const AYA_ID = "aya::dataset";
// A single Aya field this many chars or longer is skipped: inputs/targets range
// up to ~3.3M chars, and a multi-MB "pair" is documentation/dump noise, not a
// cognitive example.
const MAX_AYA_FIELD_CHARS = Math.max(
  10_000,
  Math.floor(Number(env("MAX_AYA_FIELD_KB", "256")) * 1000) || 256_000,
);

// ── OpenAssistant/oasst2 (the fourth training stage, after Aya) ──
// oasst2 is a corpus of human↔assistant conversation TREES. Its richest, most
// stream-friendly artifact is "<date>_oasst2_ready.trees.jsonl.gz": one JSON
// conversation tree PER LINE, gzip-compressed (a web standard — Decompression
// Stream("gzip")). Each tree is {message_tree_id, prompt:{role,text,replies:[…]}}
// where `replies` nests recursively and a prompt can have several ranked
// assistant replies (rank 0 = best). We follow the best-ranked, non-deleted
// reply at each step to get ONE linear, strictly-alternating conversation per
// tree, then keep only the MULTI-TURN ones (≥ OASST_MIN_TURNS messages, i.e. at
// least two full user→assistant exchanges) — single Q→A trees are skipped, by
// design. OASST=0 disables the stage; OASST_URL overrides the source.
const OASST = env("OASST", "1") !== "0";
const OASST_URL = env(
  "OASST_URL",
  "https://huggingface.co/datasets/OpenAssistant/oasst2/resolve/main/2023-11-05_oasst2_ready.trees.jsonl.gz",
);
// The resume id of the oasst2 stage, in the same completed-files set as the
// other stages, so one store records the whole curriculum.
const OASST_ID = "oasst2::trees";
// Multi-turn threshold: a conversation must have at least this many turns to be
// trained (4 = user→assistant→user→assistant, the smallest real multi-turn).
const OASST_MIN_TURNS = Math.max(
  2,
  Math.floor(Number(env("OASST_MIN_TURNS", "4"))) || 4,
);
// Skip a tree whose decoded JSON line exceeds this (a pathological record); the
// real maximum is far smaller, so this only guards against corruption.
const MAX_OASST_LINE_CHARS = Math.max(
  100_000,
  Math.floor(Number(env("MAX_OASST_LINE_MB", "8")) * 1_000_000) || 8_000_000,
);

// ── google-research-datasets/Taskmaster 1–4 (the dialogue stages) ──
// Four corpora of task-oriented dialogue, one shape between them: each file is a
// JSON ARRAY of conversations and each conversation carries
// `utterances: [{speaker, text, …}]`. TM-1 ships two files directly under its
// directory (self-dialogs, woz-dialogs); TM-2/3/4 ship theirs under `<set>/data`.
// They are the best-scoring corpora on the fold-unit recurrence benchmark that
// selects for halo health (TM-3 85.1%, TM-4 78.8%, TM-2 68.7%, TM-1 51.8%,
// against 23.2% for the incumbent SmolSent), and they are genuinely multi-turn
// where the incumbent multi-turn stage is not (TM-3 median 20 turns of ~43 B,
// against oasst2's median turn of 529 B).
//
// Served from GitHub raw, not Hugging Face: the HF mirrors are loading-script
// repos with no data files, and the official copies carry the CC BY 4.0 notice.
const TASKMASTER = env("TASKMASTER", "1") !== "0";
// Which sets to train, in order. Each is a directory in the Taskmaster repo.
const TASKMASTER_SETS = env(
  "TASKMASTER_SETS",
  "TM-1-2019,TM-2-2020,TM-3-2020,TM-4-2024",
).split(",").map((s) => s.trim()).filter(Boolean);
const TASKMASTER_REPO = env(
  "TASKMASTER_REPO",
  "google-research-datasets/Taskmaster",
);
const TASKMASTER_RAW =
  `https://raw.githubusercontent.com/${TASKMASTER_REPO}/master`;
// A conversation must have at least this many turns AFTER same-speaker merging.
// The default of 2 keeps every real exchange: unlike oasst2 — where a lone Q→A
// tree merely replicates the Aya stage's shape and is dropped — a two-turn
// task-oriented exchange is still task-oriented dialogue, and TM-4's dialogues
// are short by design (median 3.7 turns), so a higher bar would discard most of
// that set.
const TASKMASTER_MIN_TURNS = Math.max(
  2,
  Math.floor(Number(env("TASKMASTER_MIN_TURNS", "2"))) || 2,
);
// Skip a conversation carrying an implausibly long utterance (corruption). The
// measured maximum across TM-1/2/3/4 is 1,897 bytes, so this only guards.
const MAX_TASKMASTER_TURN_CHARS = Math.max(
  1_000,
  Math.floor(Number(env("MAX_TASKMASTER_TURN_KB", "32")) * 1000) || 32_000,
);

// ── 2WikiMultihopQA — the `evidences` TRIPLES only (the composition stage) ──
// Each row carries `evidences`: a JSON string of (subject, relation, object)
// triples that CHAIN — one triple's object is the next's subject. 72.5% of rows
// carry such a chain (measured over 4,000 rows), and those triples are the only
// representation measured to make Sema compose a two-hop answer at all.
//
// TWO COLUMNS ARE DELIBERATELY NOT READ, one for licence reasons and one for
// capability reasons:
//   • `context` holds Wikipedia PROSE. The repo is Apache-2.0 but Wikipedia text
//     is CC BY-SA, and a Sema store keeps text verbatim, so ingesting the
//     passages would attach ShareAlike to every distributed store. The triples
//     originate in Wikidata (CC0). See DATASETS.md §3.2/§4.
//   • `question`/`answer` are the composed multi-hop QUESTION. Depositing those
//     teaches the answer to that exact question and nothing else — it memorises
//     rather than composes. They are used to EVALUATE this adapter, never as
//     training input.
//
// Read from Hugging Face's auto-converted `refs/convert/parquet` branch, not
// from main: the main-branch train.parquet is written as ONE 167,454-row
// group (666 MB uncompressed) and a Parquet column chunk is per-group, so any
// read of it materialises the whole file. The converted branch uses uniform
// 10,000-row groups. See test/79-parquet-batching.test.mjs.
const WIKI2 = env("WIKI2", "1") !== "0";
const WIKI2_DATASET = env("WIKI2_DATASET", "xanhho/2WikiMultihopQA");
// Splits to train, in order. Only `train` by default: `validation`/`test` are
// the dataset's held-out sets and are what an honest evaluation of this
// adapter's composition rate has to be measured on.
const WIKI2_SPLITS = env("WIKI2_SPLITS", "train")
  .split(",").map((s) => s.trim()).filter(Boolean);
// Reject a triple with an implausibly long field (corruption); real subjects and
// objects are entity names, and relations are Wikidata property labels.
// 0 = every row. The train split holds 167,454 rows at ~4.95 deposits each
// (~830k facts), so this is the knob that keeps 2Wiki proportionate to the rest
// of the curriculum in the same way SODA_MAX_DIALOGS does.
const WIKI2_MAX_ROWS = Math.max(
  0,
  Math.floor(Number(env("WIKI2_MAX_ROWS", "0"))) || 0,
);
const MAX_WIKI2_FIELD_CHARS = Math.max(
  100,
  Math.floor(Number(env("MAX_WIKI2_FIELD_KB", "2")) * 1000) || 2_000,
);

// ── allenai/soda (social dialogue) and AmazonScience/massive (short intents) ──
// Both are read from Hugging Face's auto-converted `refs/convert/parquet`
// branch. For SODA that is mandatory, not cosmetic: its main-branch
// train.parquet is ONE 1,191,582-row group (1.19 GB uncompressed), and a
// Parquet column chunk is per-group, so any read of it materialises the whole
// file — measured at 100% of a 689 MB file and 2 GB of heap for a 500-row read.
// The converted branch uses uniform 10,000-row groups.
//
// BOTH STAGES ARE BUDGETED, and that is a curriculum decision rather than an
// algorithmic cap. SODA's train split holds 1,191,582 dialogues which the
// cumulative walk would turn into ~8 MILLION episodes — against the 662,221
// deposits of the entire current corpus. Trained whole it would not join the
// mix, it would BE the mix, and corpus size is the quantity every scale problem
// in this engine is measured against. The default takes the first
// SODA_MAX_DIALOGS of them; set it to 0 to lift the budget.
const SODA = env("SODA", "1") !== "0";
const SODA_DATASET = env("SODA_DATASET", "allenai/soda");
const SODA_SPLITS = env("SODA_SPLITS", "train")
  .split(",").map((s) => s.trim()).filter(Boolean);
// ~6.3 episodes per dialogue, so this budgets ~750k episodes — comparable to
// the Taskmaster stage and to Aya, which is the intended balance. 0 = no budget.
const SODA_MAX_DIALOGS = Math.max(
  0,
  Math.floor(Number(env("SODA_MAX_DIALOGS", "120000"))) || 0,
);
const MAX_SODA_TURN_CHARS = Math.max(
  1_000,
  Math.floor(Number(env("MAX_SODA_TURN_KB", "32")) * 1000) || 32_000,
);

// MASSIVE deposits BARE UTTERANCES — an experience, not an episode — and that
// is the only shape its data supports. Two richer shapes were considered and
// rejected on evidence:
//   • Same-intent pairs as paraphrases. 49.1% of consecutive rows share
//     (locale, intent), but they are NOT meaning-equivalent: intent 48 in mn-MN
//     runs "wake me at nine on the fifth" next to "set an alarm two hours from
//     now". Depositing that pair as an episode teaches a continuation that does
//     not exist.
//   • Same-id rows across locales. Those ARE translations of one another —
//     which is exactly SmolSent's relation, and SmolSent scores worst of every
//     corpus measured on fold-unit recurrence (23.2%) because cross-lingual
//     pairs share no units.
// So the stage contributes recurring fold units and lexical coverage (65.1%
// recurring unit mass, median 29 B) and nothing relational. `annot_utt` carries
// slot markup ("[date : tavdahad] ...") and is never read.
// DISABLED BY DEFAULT, on evidence gathered after the stage was written. A bare
// experience deposits content with NO EDGE, and that cuts both ways. Measured on
// a three-pair dialogue store with and without six MASSIVE-style utterances:
//
//   "set an alarm"            without: "Sure, what size would you like?"  (wrong)
//                             with:    "set an alarm for seven"           (better)
//   "play music"              without: ""                                 (correct silence)
//                             with:    "Yes, sweetened or unsweetened?"   (wrong)
//
// So it displaces some wrong answers and manufactures others, INCLUDING turning
// a correct silence into a wrong answer — and honest silence is a stated
// property of this engine (AGENTS §2.13). On the mixed-curriculum store the
// same shape produced the fragment "nus" for "wake me up at nine am".
//
// That evidence is four probes on toy stores and is NOT conclusive; it is,
// however, the only evidence there is, and it points the wrong way. The stage
// stays implemented and one env var away. Turn it on (MASSIVE=1) once there is
// a real measurement showing the recurring fold units it contributes (72.3% of
// deposited unit mass) buy more than the spurious answers cost.
const MASSIVE = env("MASSIVE", "0") !== "0";
const MASSIVE_DATASET = env("MASSIVE_DATASET", "AmazonScience/massive");
// "all" is the config covering every locale in one set of shards.
const MASSIVE_CONFIG = env("MASSIVE_CONFIG", "all");
const MASSIVE_SPLITS = env("MASSIVE_SPLITS", "train")
  .split(",").map((s) => s.trim()).filter(Boolean);
// 0 = every row (587,214 in `all`/train, ~17 MB of content).
const MASSIVE_MAX_ROWS = Math.max(
  0,
  Math.floor(Number(env("MASSIVE_MAX_ROWS", "0"))) || 0,
);
const MAX_MASSIVE_UTT_CHARS = Math.max(
  100,
  Math.floor(Number(env("MAX_MASSIVE_UTT_KB", "2")) * 1000) || 2_000,
);

// ── MuskumPillerum/General-Knowledge (the fourth training stage, after oasst2) ──
// A ~37.6k-row general-knowledge Q&A set: each row is a single {Question, Answer}
// pair. A row is a pure RELATION (question → answer), so it becomes exactly ONE
// FACT, identical in shape to the Aya stage. It ships as a single JSON array
// file (output.json); we DOWNLOAD it and stream the array. GENKNOW_URL overrides
// the source.
//
// DISABLED BY DEFAULT ON LICENCE GROUNDS (2026-08-13). The HF repo carries NO
// licence tag and no licence in its card — an earlier header in this file
// claimed MIT without support — and its own dataset card states it "contains a
// subset of the alpaca dataset". Alpaca is CC BY-NC 4.0: NonCommercial, which
// conflicts with Sema's commercial licence. Because a Sema store retains its
// training text VERBATIM, an unlicensed corpus inside it makes the whole
// artifact undistributable. See DATASETS.md §3.2. GENKNOW=1 re-enables the
// stage for local, non-distributed experiments only.
const GENKNOW = env("GENKNOW", "0") !== "0";
const GENKNOW_URL = env(
  "GENKNOW_URL",
  "https://huggingface.co/datasets/MuskumPillerum/General-Knowledge/resolve/main/output.json",
);
// The resume id of the General-Knowledge stage, in the same completed-files set
// as the other stages, so one store records the whole curriculum.
const GENKNOW_ID = "genknow::qa";
// A Question/Answer longer than this is skipped (answers run to a few hundred
// chars; this only guards against a corrupt/runaway field).
const MAX_GENKNOW_CHARS = Math.max(
  4_000,
  Math.floor(Number(env("MAX_GENKNOW_KB", "64")) * 1000) || 64_000,
);

// ═══════════════════════════════════════════════════════════════════════
// §2  Terminal + formatting helpers
// ═══════════════════════════════════════════════════════════════════════

const CSI = "\x1b[";
const B = `${CSI}1m`, DIM = `${CSI}2m`, R = `${CSI}0m`;
const GREY = `${CSI}90m`, CYAN = `${CSI}36m`, GRN = `${CSI}32m`;
const YEL = `${CSI}33m`, RED = `${CSI}31m`;
const HIDE = `${CSI}?25l`, SHOW = `${CSI}?25h`;

/** Sleep `ms`, but wake early if the shutdown signal fires — so a long back-off
 *  (e.g. a rate-limit wait) never swallows Ctrl+C. Resolves either way. */
const waitMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    if (shutdown.signal.aborted) return resolve();
    // NOTE: the timer is deliberately NOT unref'd — an unref'd timer does not
    // keep the event loop alive, so a pending wait (e.g. the pace between page
    // requests, or a rate-limit back-off) would let Node exit early and the run
    // would "do nothing and close". The listener lets a shutdown wake it early.
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      shutdown.signal.removeEventListener("abort", done);
      resolve();
    }
    shutdown.signal.addEventListener("abort", done, { once: true });
  });

/** Resolve `p`, but reject with a TimeoutError if it takes longer than `ms`.
 *  The underlying promise is left to settle on its own (we just stop waiting),
 *  so a slow black-box call can never wedge the caller. */
function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label = "operation",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const e: Error & { name: string } = new Error(
        `${label} timed out after ${ms}ms`,
      );
      e.name = "TimeoutError";
      reject(e);
    }, ms);
    if (typeof (t as any).unref === "function") (t as any).unref();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Human-readable duration from seconds. */
function dur(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Human-readable byte size. */
function bytes(n: number): string {
  if (!isFinite(n) || n < 0) return "--";
  if (n < 1024) return `${n} B`;
  if (n < 1e6) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
}

/** Short count: 1234567 → "1.23M". */
function num(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const clamp01 = (f: number) => Math.max(0, Math.min(1, f));
const pct = (f: number) => `${(clamp01(f) * 100).toFixed(1)}%`;

/** A progress bar of width `w` filled to fraction `frac`. */
function bar(w: number, frac: number): string {
  const filled = Math.round(clamp01(frac) * w);
  return `${GRN}${"█".repeat(filled)}${GREY}${"░".repeat(w - filled)}${R}`;
}

/** Collapse whitespace and clip to `max` chars with an ellipsis. */
function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (max < 1) return "";
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

/** An HTTP error the caller tagged as transient. `.fatal` skips all retries;
 *  `.throttle` (a 429/503 rate-limit or overload) is retried indefinitely and
 *  does NOT consume the bounded attempt budget — the server told us to wait, not
 *  to give up. `.retryAfterMs` carries a server-suggested delay when present. */
type HttpError = Error & {
  fatal?: boolean;
  throttle?: boolean;
  retryAfterMs?: number;
};

/** Retry `fn` with exponential backoff.
 *
 *  Three error classes:
 *   • `.fatal` / AbortError  → rethrown immediately (never retried).
 *   • `.throttle` (429/503)  → the server is rate-limiting/overloaded. We are
 *     NOT failing — we WAIT (honouring Retry-After, else capped exponential
 *     back-off with jitter) and retry WITHOUT consuming an attempt, so a
 *     throttled request holds on until it succeeds rather than being dropped.
 *     Only a shutdown breaks this loop.
 *   • anything else          → a genuine transient error, retried up to `tries`
 *     with exponential back-off before giving up.
 *
 *  `onFail` is called after each non-throttle failed attempt; `onThrottle` after
 *  each throttle wait (for a "waiting…" notice). */
async function retry<T>(
  label: string,
  fn: () => Promise<T>,
  tries: number,
  onFail?: (attempt: number, err: Error) => void,
  onThrottle?: (waitMsAmount: number) => void,
): Promise<T> {
  let wait = 1000, last = "", throttleWait = 1000, throttleHits = 0;
  for (let attempt = 1; attempt <= tries;) {
    if (shutdown.signal.aborted) {
      const e: HttpError = new Error("aborted");
      e.fatal = true;
      throw e;
    }
    try {
      return await fn();
    } catch (e) {
      const err = e as HttpError;
      if (err.name === "AbortError" || err.fatal) throw err;

      // Rate-limited / overloaded: wait it out. Does NOT advance `attempt`, so a
      // busy server can never exhaust the retry budget and drop the request.
      if (err.throttle && !shutdown.signal.aborted) {
        throttleHits++;
        // Honour Retry-After when the server sent one; else exponential back-off
        // with jitter, capped, so a fleet of requests does not resynchronise.
        const base = err.retryAfterMs && err.retryAfterMs > 0
          ? err.retryAfterMs
          : throttleWait;
        const ms = Math.min(base, 60_000) +
          Math.floor(base * 0.25 * Math.random());
        onThrottle?.(ms);
        await waitMs(ms);
        throttleWait = Math.min(throttleWait * 2, 60_000);
        continue;
      }

      last = err.message;
      onFail?.(attempt, err);
      attempt++;
      if (attempt <= tries) {
        await waitMs(wait);
        wait = Math.min(wait * 2, 30_000);
      }
    }
  }
  throw new Error(`${label} failed after ${tries} attempts: ${last}`);
}

/** Classify a non-OK HTTP response into an {@link HttpError} for {@link retry}:
 *   • 429 / 503  → THROTTLE (rate-limited / overloaded): retried indefinitely,
 *     honouring a Retry-After header (seconds or an HTTP-date) when present.
 *   • other 5xx  → transient: retried up to the caller's attempt budget.
 *   • other 4xx  → FATAL: a real client error (404, 401, …) — not retried.
 *  Never throttles forever silently: the wait is interruptible by shutdown. */
function httpError(res: Response): HttpError {
  const err: HttpError = new Error(`HTTP ${res.status}`);
  if (res.status === 429 || res.status === 503) {
    err.throttle = true;
    const ra = res.headers.get("retry-after");
    if (ra) {
      const secs = Number(ra);
      if (Number.isFinite(secs)) err.retryAfterMs = Math.max(0, secs * 1000);
      else {
        const when = Date.parse(ra);
        if (Number.isFinite(when)) {
          err.retryAfterMs = Math.max(0, when - Date.now());
        }
      }
    }
  } else if (res.status < 500) {
    err.fatal = true; // genuine client error — do not retry
  } // other 5xx: neither fatal nor throttle → ordinary bounded retry
  return err;
}

/** GET a URL and parse JSON, with the shared retry policy: rate-limits (429/503)
 *  WAIT indefinitely (surfaced to the progress log via onThrottleWait, throttled
 *  to one notice every few seconds), other 4xx is fatal, other 5xx retried up to
 *  DOWNLOAD_TRIES. Used by every datasets-server API stage so all share the same
 *  never-drop-on-throttle behaviour. */
async function getJson(url: string, label: string): Promise<any> {
  return retry(
    label,
    async () => {
      const res = await fetch(url, { signal: shutdown.signal });
      if (res.ok) return res.json();
      throw httpError(res);
    },
    DOWNLOAD_TRIES,
    undefined,
    (ms) => {
      const now = Date.now();
      if (onThrottleWait && now - lastThrottleLog > 3000) {
        lastThrottleLog = now;
        onThrottleWait(ms, label);
      }
    },
  );
}

// ═══════════════════════════════════════════════════════════════════════
// §3  Cache + download helpers (a downloaded file is bounded by MAX_CACHE_GB)
//
// SmolSent and Aya are paged from the datasets-server JSON API (no file to
// download); oasst2 downloads ONE gzipped file. So only the generic download
// helpers below survive — there is no per-language ZIP discovery or prefetch.
// ═══════════════════════════════════════════════════════════════════════

/** A cheap HEAD to learn a download's size (for the cache ceiling and a real
 *  ETA). Rate-limits wait; other 4xx is fatal; total failure → 0. */
/** Advertised transfer size of `url`, used only to reserve cache room. Like any
 *  `content-length` this is the ON-THE-WIRE size, so for a content-coded source
 *  (GitHub raw gzips JSON ~14x) it UNDER-estimates the file that lands on disk.
 *  That is tolerable here because the cache ceiling is a budget, not a
 *  correctness property — a run may overshoot MAX_CACHE_GB by the compression
 *  ratio of one in-flight file, and each file is deleted as soon as it is
 *  consumed. It must NOT be reused as an integrity check; see downloadFile. */
async function headSize(url: string): Promise<number> {
  return retry(`HEAD ${url}`, async () => {
    const res = await fetch(url, { method: "HEAD", signal: shutdown.signal });
    if (res.ok) return Number(res.headers.get("content-length")) || 0;
    throw httpError(res);
  }, 4);
}

function cacheSize(): number {
  if (!existsSync(CACHE_DIR)) return 0;
  let total = 0;
  for (const name of readdirSync(CACHE_DIR)) {
    try {
      total += statSync(join(CACHE_DIR, name)).size;
    } catch { /* raced with a delete */ }
  }
  return total;
}

/** Block until there is room for a file of `fileBytes` under the ceiling.
 *  A single file larger than the whole ceiling can never "fit", so we let it
 *  through (it is deleted right after processing) rather than wait forever. */
async function ensureCacheRoom(
  fileBytes: number,
  warn?: (msg: string) => void,
): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (fileBytes >= MAX_CACHE_BYTES) return;
  let warned = false;
  // Stop waiting the moment a shutdown is requested — the abort signal unblocks
  // a long cache-full wait so Ctrl+C is never swallowed by the ceiling.
  while (
    !shutdown.signal.aborted && cacheSize() + fileBytes > MAX_CACHE_BYTES
  ) {
    if (!warned) {
      warn?.(
        `${YEL}⚠${R} cache at ${
          (MAX_CACHE_BYTES / 1e9).toFixed(0)
        } GB ceiling — waiting for room…`,
      );
      warned = true;
    }
    await waitMs(5_000);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// §5  Download (streamed to disk, with retry + cleanup on failure)
// ═══════════════════════════════════════════════════════════════════════

async function downloadFile(
  url: string,
  destPath: string,
  tries = DOWNLOAD_TRIES,
  onFail?: (attempt: number, err: Error) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const partPath = destPath + PART_SUFFIX;
  await retry(
    `download ${basename(destPath)}`,
    async () => {
      // Abort promptly on shutdown rather than waiting out a slow socket.
      if (shutdown.signal.aborted) {
        const e: Error & { fatal?: boolean } = new Error("aborted");
        e.fatal = true;
        throw e;
      }
      const res = await fetch(url, { signal: shutdown.signal });
      if (!res.ok) throw httpError(res);
      if (!res.body) throw new Error("empty response body");

      // `content-length` describes the bytes ON THE WIRE. When the server
      // applied a content-coding, fetch hands us the DECODED body, so the
      // header no longer describes what gets written to disk and the integrity
      // guard below must not use it. Measured: raw.githubusercontent.com sends
      // `content-encoding: gzip` with content-length 110,928 for a file that
      // decodes to 1,607,931 bytes — a size check against that rejects every
      // healthy download. (The bug stayed latent because Hugging Face sends
      // `content-encoding: br` and NO content-length, leaving total = 0, which
      // already disables the guard.)
      const encoding = (res.headers.get("content-encoding") ?? "").trim()
        .toLowerCase();
      const decoded = encoding !== "" && encoding !== "identity";
      const total = decoded
        ? 0
        : Number(res.headers.get("content-length")) || 0;
      let done = 0;

      // Stream straight to a ".part" sibling using pure WHATWG streams. A
      // TransformStream meters progress; pipeTo into a WritableStream gives REAL
      // backpressure natively — the sink's write() returns a promise the
      // readable side awaits, so a fast server can never outrun the disk (no
      // whole-file heap buffering). The sink wraps a single raw fs descriptor
      // (the one capability the web platform lacks); writing to disk is the only
      // Node operation in the whole pipeline. The final, valid file only ever
      // appears via the atomic rename below, so a crash mid-transfer can never
      // leave a truncated file at the real path.
      const meter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          done += chunk.length;
          onProgress?.(done, total);
          controller.enqueue(chunk);
        },
      });

      const fd = openSync(partPath, "w");
      let closed = false;
      const closeFd = () => {
        if (closed) return;
        closed = true;
        try {
          closeSync(fd);
        } catch { /* already closed */ }
      };
      const sink = new WritableStream<Uint8Array>({
        write(chunk) {
          // writeSync drains the whole chunk before returning, so the readable
          // side is paused for exactly as long as the disk needs — backpressure.
          let off = 0;
          while (off < chunk.length) {
            off += writeSync(fd, chunk, off, chunk.length - off);
          }
        },
        close() {
          fsyncSync(fd); // durable bytes before the rename promotes them
          closeFd();
        },
        abort() {
          closeFd();
        },
      });

      try {
        await res.body.pipeThrough(meter).pipeTo(sink, {
          signal: shutdown.signal,
        });
      } catch (e) {
        // pipeTo's abort() ran the sink's abort() (closing the descriptor); if
        // it didn't (a non-abort throw), make sure the descriptor is not leaked.
        closeFd();
        try {
          unlinkSync(partPath);
        } catch { /* best effort */ }
        throw e;
      }

      // Optional integrity guard: when the server advertised a size FOR THE
      // BYTES WE WRITE (see the content-encoding note above — `total` is 0 for
      // a decoded body, which disables this), a complete file must match it. A
      // short read (silent truncation) is retried rather than promoted, so the
      // parser never sees a partial file.
      try {
        const got = statSync(partPath).size;
        if (total > 0 && got !== total) {
          try {
            unlinkSync(partPath);
          } catch { /* best effort */ }
          throw new Error(`size mismatch: got ${got}, expected ${total}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("size mismatch")) {
          throw e;
        }
        // statSync failure is non-fatal here; the rename below will surface it.
      }

      // Atomic publish: rename is atomic within a filesystem, so the final path
      // flips from "absent" to "complete" in one step — never an in-between.
      renameSync(partPath, destPath);
    },
    tries,
    onFail,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// §6  Parsing — raw rows → SEMA training items
// ═══════════════════════════════════════════════════════════════════════

export interface Episode {
  context: string;
  continuation: string;
}
export type TrainingItem = string | Episode;

const isEpisode = (it: TrainingItem): it is Episode => typeof it !== "string";

/** Build the accumulated-context episodes of a turn sequence: each successive
 *  turn is the continuation of ALL the turns before it joined together. This is
 *  the same cumulative-context shape a multi-turn conversation deposits, so the
 *  store learns to continue a growing context.
 *
 *  The "\n" below is a CORPUS choice, not a protocol.  oasst2 turns are
 *  paragraphs, and reading them back with the newlines kept is how this corpus
 *  reads naturally; a different corpus may join with nothing, and
 *  test/13-conversation.test.mjs does exactly that.  Neither has to match the
 *  other, because Sema never scans content for turn boundaries — those are
 *  offsets the Conversation API carries beside the bytes (see Mind.addTurn's
 *  "ON SEPARATORS" note).  The newline here is simply part of the text this
 *  store learnt, so anything replaying this corpus feeds it back as part of
 *  the turn: `addTurn(conv, "\n" + turnText)`.  It is not a convention the
 *  engine, the API, or the tests have to agree on. */
function accumulate(turns: string[]): Episode[] {
  const out: Episode[] = [];
  for (let i = 1; i < turns.length; i++) {
    out.push({ context: turns.slice(0, i).join("\n"), continuation: turns[i] });
  }
  return out;
}

/** Dedup + trim a concept's items: drop empty/degenerate pairs and exact
 *  repeats so a concept never deposits the same form twice. */
export function refineItems(items: TrainingItem[]): TrainingItem[] {
  const out: TrainingItem[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!isEpisode(it)) {
      const exp = it.trim();
      const key = "E:" + exp;
      if (exp && !seen.has(key)) {
        seen.add(key);
        out.push(exp);
      }
      continue;
    }
    const ctx = it.context.trim();
    const cont = it.continuation.trim();
    if (!ctx || !cont || ctx === cont) continue;
    const key = "P:" + ctx + "\u0000" + cont;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ context: ctx, continuation: cont });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// §6c  SmolSent parsing — a translation pair → SEMA facts
//
// Each SmolSent row is {sl, tl, src, trg, …}: a source sentence and its
// translation into another language — "two names for one meaning". This is the
// cross-language concept SEMA fuses (see test/05-concepts.test.mjs: "ice" and
// "hielo" become one concept because they share company, so a fact about one
// transfers to the other). So a pair is rendered as BIDIRECTIONAL translation
// FACTS — (src → trg) and (trg → src) — binding the two phrasings as one
// concept at recall time, in both directions. Two facts, no experiences and no
// cumulative walk: a sentence pair is not multi-turn, and a bare sentence on its
// own carries no relation to point at.
// ═══════════════════════════════════════════════════════════════════════

/** One normalized SmolSent row. */
export interface SmolSentRow {
  src: string; // source sentence
  trg: string; // its translation
  sl: string; // source language code
  tl: string; // target language code
}

/** Normalize a raw datasets-server row into a SmolSentRow, or null when it lacks
 *  both sides or a side is implausibly large (a dump, not a sentence). */
export function toSmolSentRow(row: unknown): SmolSentRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const src = typeof r.src === "string" ? r.src.trim() : "";
  // `trg` is a single string in smolsent; tolerate a list form defensively.
  const trgRaw = Array.isArray(r.trgs) ? r.trgs[0] : r.trg;
  const trg = typeof trgRaw === "string" ? trgRaw.trim() : "";
  if (!src || !trg) return null;
  if (
    src.length > MAX_SMOLSENT_CHARS || trg.length > MAX_SMOLSENT_CHARS
  ) return null;
  const sl = typeof r.sl === "string" ? r.sl.trim() : "";
  const tl = typeof r.tl === "string" ? r.tl.trim() : "";
  return { src, trg, sl, tl };
}

/** Translate ONE SmolSent pair into SEMA facts. The two sentences are one
 *  meaning in two languages, but the two BINDINGS are not equally sound —
 *  SmolSent's English side is a shared pool translated into every language, so
 *  `trg -> src` gives one English context a different answer in every language
 *  file. See SMOLSENT_DIRECTIONS. refineItems drops the degenerate case where
 *  src === trg. */
export function smolSentRowToItems(row: SmolSentRow): TrainingItem[] {
  const { src, trg } = row;
  const items: TrainingItem[] = [];
  if (SMOLSENT_SRC2TRG) items.push({ context: src, continuation: trg });
  if (SMOLSENT_TRG2SRC) items.push({ context: trg, continuation: src });
  return refineItems(items);
}

// ═══════════════════════════════════════════════════════════════════════
// §6d  Aya Dataset parsing — a human prompt→completion row → SEMA items
//
// Each Aya row is a single human-written (inputs → targets) pair in a named
// language, e.g. {inputs:"Qual é a capital da Índia?", targets:"Nova Déli.",
// language:"Portuguese", …}. That is already the canonical SEMA fact (ask →
// answer), so the translation is direct: exactly ONE (question → answer) fact.
// reasoning/scratch-work fields do not exist in this corpus, so nothing is
// stripped; the text is human prose already.

/** One normalized Aya row. */
export interface AyaRow {
  inputs: string;
  targets: string;
  language: string;
}

/** Normalize a raw datasets-server row object into an AyaRow, or null when it
 *  lacks a usable prompt/answer or a field is implausibly large (a dump, not a
 *  cognitive example). Trims surrounding whitespace; keeps inner text verbatim
 *  (human prose, possibly multi-paragraph). */
export function toAyaRow(row: unknown): AyaRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const inputs = typeof r.inputs === "string" ? r.inputs.trim() : "";
  const targets = typeof r.targets === "string" ? r.targets.trim() : "";
  if (!inputs || !targets) return null;
  if (
    inputs.length > MAX_AYA_FIELD_CHARS || targets.length > MAX_AYA_FIELD_CHARS
  ) return null;
  const language = typeof r.language === "string" ? r.language.trim() : "";
  return { inputs, targets, language };
}

/** Translate ONE Aya row into SEMA training items. A row is a single human
 *  (question → answer) exchange — exactly one FACT, the (inputs → targets) edge.
 *  No standalone-answer experience and no one-exchange "cumulative" walk: a lone
 *  Q→A is not multi-turn, and both would only replicate the same edge. */
export function ayaRowToItems(row: AyaRow): TrainingItem[] {
  const { inputs, targets } = row;
  return refineItems([{ context: inputs, continuation: targets }]);
}

// ═══════════════════════════════════════════════════════════════════════
// §6e  OpenAssistant/oasst2 parsing — a conversation TREE → SEMA items
//
// Each tree is {prompt:{role,text,replies:[…]}}, replies nested recursively. A
// prompt can have several ranked assistant replies; we collapse the tree to ONE
// linear conversation by following the best-ranked (rank 0), non-deleted reply
// at each step. The result strictly alternates prompter/assistant. Only MULTI-
// TURN conversations (≥ OASST_MIN_TURNS messages) are kept — the explicit focus
// of this stage; single Q→A trees are dropped.
// ═══════════════════════════════════════════════════════════════════════

/** A single oasst2 message node (the fields we use; the tree nests via replies). */
interface OasstNode {
  role?: string;
  text?: string;
  rank?: number | null;
  deleted?: boolean;
  replies?: OasstNode[];
}

/** One conversational turn extracted from a tree. */
export interface OasstTurn {
  role: string; // "prompter" | "assistant"
  text: string;
}

/** Collapse a conversation tree to ONE linear path: at each node, descend into
 *  its best-ranked, non-deleted reply (rank 0 preferred; unranked sorts last).
 *  Returns the ordered turns (already strictly alternating in this corpus). */
export function bestOasstPath(root: OasstNode): OasstTurn[] {
  const turns: OasstTurn[] = [];
  let node: OasstNode | undefined = root;
  while (node) {
    const text = typeof node.text === "string" ? node.text.trim() : "";
    if (text) turns.push({ role: String(node.role ?? "?"), text });
    const live: OasstNode[] = (node.replies ?? []).filter((r: OasstNode) =>
      r && !r.deleted && typeof r.text === "string" && r.text.trim() !== ""
    );
    if (live.length === 0) break;
    live.sort((a: OasstNode, b: OasstNode) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
    );
    node = live[0];
  }
  return turns;
}

/** Translate ONE multi-turn oasst2 conversation into SEMA training items.
 *
 *  This is the ONE stage where cumulative continuous context is truly necessary:
 *  the data is a real multi-turn dialogue, and what must be learned is how each
 *  turn follows from the WHOLE conversation so far — not from the previous turn
 *  alone. The conversation is emitted ONLY as the accumulated walk; standalone
 *  turn experiences and local adjacent-pair facts are NOT emitted (they are
 *  subsumed by it and would merely replicate the content).
 *
 *  The walk is the pattern proven in test/13-conversation.test.mjs
 *  ("teachConversation"): each turn is the continuation of all prior turns,
 *  with BARE turn text — NO "User:/Assistant:" labels.  The SHAPE is identical
 *  (cumulative context → next turn); the join string is not, and does not need
 *  to be — that file joins with nothing and this corpus joins with "\n" (see
 *  `accumulate`).  Saying "byte-for-byte", as this comment used to, invites the
 *  reading that the two must agree on a separator.  They must not agree,
 *  because there is nothing to agree about: turn boundaries are offsets, and
 *  the join string is just corpus text. Roles already
 *  alternate by position in an oasst2 best-path (the root is a prompter), so a
 *  label adds nothing the position does not, while a clean continuation matches
 *  the test's recall (predictNext queries bare prior turns) and lets a turn share
 *  its gist with the same text elsewhere (e.g. an Aya question stored bare).
 *
 *  Returns [] for a conversation below the multi-turn threshold, so callers can
 *  simply skip empties. */
export function oasstConversationToItems(turns: OasstTurn[]): TrainingItem[] {
  if (turns.length < OASST_MIN_TURNS) return []; // not multi-turn — skip
  return refineItems(accumulate(turns.map((t) => t.text)));
}

// ═══════════════════════════════════════════════════════════════════════
// §6e′  Taskmaster 1–4 parsing — a conversation ARRAY ELEMENT → SEMA items
//
// One adapter serves all four sets: every Taskmaster conversation, in every
// set, is `{conversation_id, …, utterances: [{speaker, text, …}]}`.
//
// ONLY `utterances[].text` IS READ, and that is a licence-adjacent correctness
// property, not a stylistic one. TM-3 and TM-4 also carry an `instructions`
// field holding the crowd-worker's task template — page after page of
// `{{HIDE movie_1 name.movie No Time To Die}}`, `{{CHECK confirm_natural …}}`
// and `var_theater_1` placeholders. That is authoring scaffolding, not
// dialogue, and depositing it would teach the store template noise as prose.
// Reading only `utterances[].text` excludes it structurally. Verified against
// the real files: across TM-2 (13,953 turns), TM-3 (24,059) and TM-4 (786),
// utterance text contains ZERO `var_*` placeholders and ZERO `{{ }}` markers —
// the scaffolding never leaks out of `instructions`.
//
// CONSECUTIVE SAME-SPEAKER TURNS ARE MERGED. Taskmaster splits one speaker's
// contribution across several indexed utterances ("I can help you with your
// movie search." / "Where are you located?" are two ASSISTANT rows), which is
// an artifact of the collection UI. Left unmerged, the cumulative walk deposits
// a turn boundary in the middle of one speaker's contribution and teaches it as
// a hand-off. Measured share of turns absorbed by merging: TM-1 17.7%,
// TM-2 11.9%, TM-3 0.8%, TM-4 0.0% — so this is load-bearing for the older sets
// and a no-op for the newer ones. Speaker names are compared case-insensitively
// because TM-1/2 use USER/ASSISTANT and TM-3/4 use user/assistant.
//
// The deposit shape is the cumulative walk (§6e's `accumulate`), identical to
// oasst2: each turn is the continuation of ALL prior turns, bare text, no role
// labels. It is the right shape here for the same reason and at a far healthier
// size — merged turns run p50 34–45 B (p90 ~100 B) and the accumulated context
// p50 301–532 B (p90 ~1.1 KB), against oasst2's median SINGLE turn of 529 B.
// ═══════════════════════════════════════════════════════════════════════

/** One utterance of a Taskmaster conversation. */
export interface TaskmasterTurn {
  speaker: string; // upper-cased, so TM-1/2 and TM-3/4 compare equal
  text: string;
}

/** Normalize ONE element of a Taskmaster data file into its turns, or null when
 *  it carries no usable utterance. Empty/whitespace-only utterances are dropped
 *  (TM-3 has a few); a single implausibly long utterance rejects the whole
 *  conversation as corrupt rather than depositing a dump. */
export function toTaskmasterTurns(row: unknown): TaskmasterTurn[] | null {
  if (!row || typeof row !== "object") return null;
  const utterances = (row as Record<string, unknown>).utterances;
  if (!Array.isArray(utterances)) return null;
  const turns: TaskmasterTurn[] = [];
  for (const u of utterances) {
    if (!u || typeof u !== "object") continue;
    const r = u as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) continue;
    if (text.length > MAX_TASKMASTER_TURN_CHARS) return null;
    turns.push({
      speaker: String(r.speaker ?? "").trim().toUpperCase(),
      text,
    });
  }
  return turns.length ? turns : null;
}

/** Collapse consecutive same-speaker turns into one, joining with a space, and
 *  return the bare texts in order. A turn with no speaker never merges with its
 *  neighbour: an unlabelled row is of unknown origin, and joining two of them
 *  would invent a contribution that may span two speakers. */
export function mergeTaskmasterTurns(turns: TaskmasterTurn[]): string[] {
  const out: string[] = [];
  let prev = "";
  for (const t of turns) {
    if (out.length > 0 && t.speaker !== "" && t.speaker === prev) {
      out[out.length - 1] += " " + t.text;
    } else {
      out.push(t.text);
    }
    prev = t.speaker;
  }
  return out;
}

/** Translate ONE Taskmaster conversation into SEMA training items: the
 *  cumulative walk over its merged turns. Returns [] for a conversation below
 *  TASKMASTER_MIN_TURNS, so callers can simply skip empties. */
export function taskmasterConversationToItems(
  turns: TaskmasterTurn[],
): TrainingItem[] {
  const texts = mergeTaskmasterTurns(turns);
  if (texts.length < TASKMASTER_MIN_TURNS) return [];
  return refineItems(accumulate(texts));
}

// ═══════════════════════════════════════════════════════════════════════
// §6e″  2WikiMultihopQA parsing — `evidences` TRIPLES → SEMA facts
//
// This is the only stage whose purpose is COMPOSITION: answering a question
// whose answer no single deposited fact contains. Sema composes by grounding
// hop 1, then pivoting on the longest unconsumed learnt context that the
// grounded answer CONTAINS (`reason`/`pivotStep`), so the pivot target must
// itself be a deposited context. Each triple therefore deposits TWO facts:
//
//     "<subject> <relation>"  →  "The <relation> of <subject> is <object>."
//     "<subject>"             →  "The <relation> of <subject> is <object>."
//
// The second is the PIVOT FACT. Without it the bare entity naming hop 2's
// subject is not a learnt context, so the chain is structurally unreachable no
// matter what the rest of the pipeline does.
//
// MEASURED on 200 real chained dev rows, depositing triples only and asking the
// dataset's own composed questions (D = 1024, seed 7):
//
//   relation fact only          240 deposits    5/120 ( 4%)   pivotStep  0
//   relation + pivot fact       800 deposits   44/200 (22%)   pivotStep 31
//
// A 5x improvement, and the only variant where the second hop fires at all.
//
// REJECTED ALTERNATIVE, so it is not re-tried blind: depositing the pivot fact
// only for subjects that also appear as an OBJECT within the same row's
// evidences (a row-local "something can pivot into this" test) cut deposits 25%
// (800 → 600) but cost composition — 41/200 (20.5%) with pivotStep down to 21,
// because real chains also run BETWEEN rows. Composition is this stage's entire
// justification, so the deposits are worth keeping.
//
// The residual ~78% is a KNOWN, previously-recorded limitation and not a defect
// in this adapter: the climb elects a topic rather than a relation, so a
// question phrased "When did X's father die?" does not align with the Wikidata
// property label "date of death". Failure is dominated by hop 2 never firing,
// not by a wrong hop 2. Answer-shape breakdown at N = 120: entity answers
// 23/106, date answers 2/14 — dates are worse, but not the cliff an earlier
// note suggested, which is why no object-shape filter is applied here.
// ═══════════════════════════════════════════════════════════════════════

/** One (subject, relation, object) triple from a 2Wiki `evidences` cell. */
export interface WikiTriple {
  subject: string;
  relation: string;
  object: string;
}

/** Normalize a 2Wiki row into its evidence triples, or null when it carries
 *  none usable. `evidences` is a JSON STRING holding an array of 3-element
 *  arrays; a row whose cell is absent, unparseable, or empty yields null.
 *  Individual malformed or oversized triples are dropped without discarding the
 *  row — one bad triple should not cost the others. */
export function toWikiTriples(row: unknown): WikiTriple[] | null {
  if (!row || typeof row !== "object") return null;
  const cell = (row as Record<string, unknown>).evidences;
  let parsed: unknown = cell;
  if (typeof cell === "string") {
    try {
      parsed = JSON.parse(cell);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const out: WikiTriple[] = [];
  for (const e of parsed) {
    if (!Array.isArray(e) || e.length < 3) continue;
    const subject = typeof e[0] === "string" ? e[0].trim() : "";
    const relation = typeof e[1] === "string" ? e[1].trim() : "";
    const object = typeof e[2] === "string" ? e[2].trim() : "";
    if (!subject || !relation || !object) continue;
    if (
      subject.length > MAX_WIKI2_FIELD_CHARS ||
      relation.length > MAX_WIKI2_FIELD_CHARS ||
      object.length > MAX_WIKI2_FIELD_CHARS
    ) continue;
    out.push({ subject, relation, object });
  }
  return out.length ? out : null;
}

/** Render ONE triple as the prose fact Sema stores. Kept separate so the two
 *  deposits below are guaranteed to share a byte-identical continuation: the
 *  pivot fact only works if it leads to the SAME node the relation fact does. */
export function wikiTripleSentence(t: WikiTriple): string {
  return `The ${t.relation} of ${t.subject} is ${t.object}.`;
}

/** Translate a row's triples into SEMA items: per triple, the relation fact and
 *  the bare-subject PIVOT fact (see the section note above). refineItems drops
 *  the duplicates this produces when a row states the same triple twice. */
export function wikiTriplesToItems(triples: WikiTriple[]): TrainingItem[] {
  const items: TrainingItem[] = [];
  for (const t of triples) {
    const fact = wikiTripleSentence(t);
    items.push({ context: `${t.subject} ${t.relation}`, continuation: fact });
    items.push({ context: t.subject, continuation: fact });
  }
  return refineItems(items);
}

// ═══════════════════════════════════════════════════════════════════════
// §6e‴  SODA parsing — a social dialogue row → SEMA items
//
// Each row carries `dialogue` (an array of turn strings) and `speakers` (the
// speaker name per turn). The deposit is the cumulative walk over speaker-merged
// turns, identical in shape to Taskmaster and oasst2 — turns are short (mean
// 87 B) and dialogues average 7.3 turns, so the accumulated context stays well
// inside the healthy range.
//
// `narrative`, `literal` and the ATOMIC-style `head`/`relation`/`tail` columns
// are NOT deposited: they are the generation scaffolding SODA was distilled
// from, they restate the dialogue in the third person, and depositing both a
// dialogue and its paraphrased summary gives one meaning two shapes — which is
// measured to SUPPRESS composition rather than help it.
// ═══════════════════════════════════════════════════════════════════════

/** Normalize a SODA row into its turns, or null when it carries no usable
 *  dialogue. Speakers are optional (they only drive merging); an implausibly
 *  long turn rejects the dialogue as corrupt. */
export function toSodaTurns(row: unknown): TaskmasterTurn[] | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const dialogue = r.dialogue;
  if (!Array.isArray(dialogue)) return null;
  const speakers = Array.isArray(r.speakers) ? r.speakers : [];
  const turns: TaskmasterTurn[] = [];
  for (let i = 0; i < dialogue.length; i++) {
    const text = typeof dialogue[i] === "string"
      ? (dialogue[i] as string).trim()
      : "";
    if (!text) continue;
    if (text.length > MAX_SODA_TURN_CHARS) return null;
    turns.push({
      speaker: String(speakers[i] ?? "").trim().toUpperCase(),
      text,
    });
  }
  return turns.length ? turns : null;
}

/** Translate ONE SODA dialogue into SEMA items: the cumulative walk over its
 *  speaker-merged turns. Shares `mergeTaskmasterTurns` because the rule is the
 *  same one — consecutive turns by one speaker are one contribution. */
export function sodaDialogueToItems(turns: TaskmasterTurn[]): TrainingItem[] {
  const texts = mergeTaskmasterTurns(turns);
  if (texts.length < 2) return []; // not an exchange
  return refineItems(accumulate(texts));
}

// ═══════════════════════════════════════════════════════════════════════
// §6e⁗  MASSIVE parsing — one short utterance → ONE SEMA experience
//
// See the constants note for why this deposits a bare experience and not a
// relation: the two relational shapes this corpus appears to offer are both
// false (same-intent rows are not paraphrases; same-id rows across locales are
// translations, SmolSent's worst-scoring relation).
// ═══════════════════════════════════════════════════════════════════════

/** Translate ONE MASSIVE row into SEMA items: its bare utterance, as an
 *  experience. `annot_utt` (slot-annotated) is deliberately not used — its
 *  "[date : ...]" markup is not prose. Returns [] for an unusable row. */
export function massiveRowToItems(row: unknown): TrainingItem[] {
  if (!row || typeof row !== "object") return [];
  const utt = (row as Record<string, unknown>).utt;
  const text = typeof utt === "string" ? utt.trim() : "";
  if (!text || text.length > MAX_MASSIVE_UTT_CHARS) return [];
  return refineItems([text]);
}

// ═══════════════════════════════════════════════════════════════════════
// §6f  General-Knowledge parsing — a {Question, Answer} row → SEMA fact
//
// Each row is a single general-knowledge question with one answer — a pure
// RELATION (question → answer), so it becomes exactly ONE FACT, like the Aya
// stage. No experience (a fact is possible) and no cumulative walk (a lone Q&A
// is not multi-turn). The source over-escapes newlines (a literal "\n" two-char
// sequence) and leaves trailing whitespace, so answers are un-escaped and
// trimmed to plain prose before deposit.
// ═══════════════════════════════════════════════════════════════════════

/** One normalized General-Knowledge row. */
export interface GenKnowRow {
  question: string;
  answer: string;
}

/** Turn a source value into clean prose: decode the literal "\n"/"\t"/"\r"
 *  two-character escapes the source JSON left in the text, collapse the runs of
 *  whitespace that creates, and trim. */
function unescapePlain(s: string): string {
  return s
    .replace(/\\r\\n|\\n|\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalize a raw datasets-server row into a GenKnowRow, or null when it lacks
 *  a usable question/answer or a side is implausibly large (corruption). */
export function toGenKnowRow(row: unknown): GenKnowRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const question = typeof r.Question === "string"
    ? unescapePlain(r.Question)
    : "";
  const answer = typeof r.Answer === "string" ? unescapePlain(r.Answer) : "";
  if (!question || !answer) return null;
  if (
    question.length > MAX_GENKNOW_CHARS || answer.length > MAX_GENKNOW_CHARS
  ) return null;
  return { question, answer };
}

/** Translate ONE General-Knowledge row into SEMA items: exactly one
 *  (question → answer) FACT. refineItems drops a degenerate question === answer. */
export function genKnowRowToItems(row: GenKnowRow): TrainingItem[] {
  return refineItems([{ context: row.question, continuation: row.answer }]);
}

// ═══════════════════════════════════════════════════════════════════════
// §7  Ingestion
//
// Each item is deposited directly: an experience via ingest(text), an episode
// via ingest(context, continuation). After each, the per-example callback
// receives the item's UTF-8 content size — the quantity the scaling suite
// (14-scaling.test.mjs) reports as a constant KB/s — then gates the global
// example count and checkpointing (returns false to stop). `sample` feeds the
// reservoir used for the periodic recall box.
// ═══════════════════════════════════════════════════════════════════════

const ENC = new TextEncoder();

/** Content size of a training item in UTF-8 bytes — the same quantity the
 *  scaling suite (14-scaling.test.mjs) measures as KB/s: for an episode the
 *  context plus the continuation, for a bare experience its own text. */
const itemBytes = (it: TrainingItem): number =>
  isEpisode(it)
    ? ENC.encode(it.context).length + ENC.encode(it.continuation).length
    : ENC.encode(it).length;

async function ingestItems(
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

// ── §7a′  oasst2 — stream the gzipped JSONL of trees and deposit multi-turn ──
//
// The file is gzipped JSONL: one conversation tree per line. We inflate with the
// web-standard DecompressionStream("gzip"), split on newlines without buffering
// the whole file or an unbounded line, parse each tree, collapse it to its best
// linear path, and deposit only the multi-turn ones. Robust by construction: a
// line that fails to parse (or is oversize) is counted skipped and the stream
// continues; a cap/signal stops cleanly at a conversation boundary.
async function processOasst(
  filePath: string,
  ci: CachedIngest,
  onExample: (contentBytes: number) => Promise<boolean>,
  sample: (it: TrainingItem) => void,
): Promise<
  { examples: number; stopped: boolean; skipped: number; multi: number }
> {
  const blob = await openAsBlob(filePath);
  const reader = blob.stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let examples = 0;
  let skipped = 0; // malformed/oversize lines
  let multi = 0; // multi-turn conversations deposited
  let leftover = "";
  let droppingLine = false;

  const processLine = async (line: string): Promise<boolean> => {
    if (!line.trim()) return true;
    let tree: { prompt?: OasstNode };
    try {
      tree = JSON.parse(line);
    } catch {
      skipped++;
      return true;
    }
    if (!tree.prompt) return true;
    const turns = bestOasstPath(tree.prompt);
    const items = oasstConversationToItems(turns); // [] when not multi-turn
    if (items.length === 0) return true; // single-turn / empty — skipped
    multi++;
    return ingestItems(ci, items, async (contentBytes) => {
      examples++;
      return onExample(contentBytes);
    }, sample);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk = value;
      for (;;) {
        const nl = chunk.indexOf("\n");
        if (nl < 0) {
          if (!droppingLine) {
            if (leftover.length + chunk.length > MAX_OASST_LINE_CHARS) {
              leftover = "";
              droppingLine = true;
              skipped++;
            } else leftover += chunk;
          }
          break;
        }
        const part = chunk.slice(0, nl);
        chunk = chunk.slice(nl + 1);
        if (droppingLine) {
          droppingLine = false;
          leftover = "";
          continue;
        }
        if (leftover.length + part.length > MAX_OASST_LINE_CHARS) {
          leftover = "";
          skipped++;
          continue;
        }
        const line = leftover + part;
        leftover = "";
        if (!(await processLine(line))) {
          return { examples, stopped: true, skipped, multi };
        }
      }
    }
    if (!droppingLine && leftover.trim()) {
      if (!(await processLine(leftover))) {
        return { examples, stopped: true, skipped, multi };
      }
    }
    return { examples, stopped: false, skipped, multi };
  } finally {
    try {
      reader.releaseLock();
    } catch { /* best effort */ }
  }
}

// ── §7b  Downloaded-file processors — SmolSent, Aya, General-Knowledge ──
//
// Each source is DOWNLOADED to the cache and streamed from disk (via web-standard
// Blob streams), rather than paged row-by-row over an HTTP API. This is far
// faster, is not rate-limited, and gives a real byte-based progress/throughput
// reading. A source stops cleanly at an item boundary on cap/signal; a file that
// is fully consumed is marked complete so a resume skips it.
interface FileResult {
  examples: number;
  stopped: boolean; // stopped early by MAX_MB cap or shutdown
  skipped: number; // malformed/oversize records
}

/** Discover the SmolSent per-pair JSONL files from the HF repo tree, restricted
 *  to SMOLSENT_PAIRS (basenames without .jsonl) when set. Each entry is the
 *  repo-relative path, e.g. "smolsent/ha_en.jsonl". */
async function listSmolSentFiles(): Promise<string[]> {
  // The dataset id ("owner/name") is a PATH here, so its "/" must not be
  // percent-encoded. `recursive=true` returns every file under smolsent/.
  const url = `https://huggingface.co/api/datasets/${SMOLSENT_DATASET}` +
    `/tree/main/smolsent?recursive=true`;
  const body = await getJson(url, `GET smol tree`);
  const paths: string[] = Array.isArray(body)
    ? body
      .filter((e: any) => e?.type === "file" && /\.jsonl$/i.test(e?.path))
      .map((e: any) => String(e.path))
    : [];
  paths.sort();
  if (!SMOLSENT_PAIRS.length) return paths;
  const want = new Set(SMOLSENT_PAIRS.map((p) => p.replace(/\.jsonl$/i, "")));
  return paths.filter((p) => want.has(basename(p).replace(/\.jsonl$/i, "")));
}

/** List the Taskmaster data files to train, in TASKMASTER_SETS order. Returns
 *  repo-relative paths, e.g. "TM-3-2020/data/data_00.json".
 *
 *  TM-2/3/4 keep their dialogue files under `<set>/data`, so everything there is
 *  fair game. TM-1 has no `data` directory: its two dialogue files sit at the
 *  set root NEXT TO `ontology.json` (a slot schema) and `sample.json` (a small
 *  excerpt of self-dialogs). Neither is an array of conversations, and training
 *  the excerpt would deposit a subset of TM-1 twice, so TM-1 is filtered to the
 *  `*-dialogs.json` pair (self-dialogs, woz-dialogs). */
async function listTaskmasterFiles(): Promise<
  Array<{ set: string; path: string }>
> {
  const out: Array<{ set: string; path: string }> = [];
  for (const set of TASKMASTER_SETS) {
    const rootOnly = /^TM-1\b/i.test(set);
    const dir = rootOnly ? set : `${set}/data`;
    const body = await getJson(
      `https://api.github.com/repos/${TASKMASTER_REPO}/contents/${dir}`,
      `GET Taskmaster ${dir}`,
    );
    const names: string[] = Array.isArray(body)
      ? body
        .filter((e: any) => e?.type === "file" && /\.json$/i.test(e?.name))
        .map((e: any) => String(e.name))
      : [];
    names.sort();
    for (const name of names) {
      if (rootOnly && !/-dialogs\.json$/i.test(name)) continue;
      out.push({ set, path: `${dir}/${name}` });
    }
  }
  return out;
}

/** List a dataset's Parquet shards on Hugging Face's auto-converted
 *  `refs/convert/parquet` branch, restricted to `config` and to `splits`.
 *
 *  Shared by 2Wiki, SODA and MASSIVE. The converted branch is used rather than
 *  `main` because a dataset's own Parquet may be written as ONE giant row-group
 *  (SODA's is 1,191,582 rows), and a column chunk is per-group, so reading any
 *  part of it materialises all of it. The converted branch is uniformly
 *  10,000-row groups. See test/79-parquet-batching.test.mjs.
 *
 *  Paths look like "<config>/<split>/0000.parquet". The BRANCH name is a single
 *  path SEGMENT here, so its "/" is percent-encoded — unlike a dataset id,
 *  whose "/" must not be. */
async function listConvertedParquet(
  dataset: string,
  config: string,
  splits: string[],
  label: string,
): Promise<string[]> {
  const body = await getJson(
    `https://huggingface.co/api/datasets/${dataset}` +
      `/tree/refs%2Fconvert%2Fparquet/${config}?recursive=true`,
    `GET ${label} tree`,
  );
  const paths: string[] = Array.isArray(body)
    ? body
      .filter((e: any) => e?.type === "file" && /\.parquet$/i.test(e?.path))
      .map((e: any) => String(e.path))
    : [];
  paths.sort();
  const want = new Set(splits);
  return paths.filter((p) => {
    const parts = p.split("/");
    // The tree is rooted at `config`, so the split is the second-to-last part.
    return want.has(parts[parts.length - 2] ?? "");
  });
}

/** Stream a plain-JSONL file from disk, deposit each parsed row via `toItems`.
 *  Lines are split without buffering the whole file; an oversize/malformed line
 *  is counted skipped and the stream continues. Shared by SmolSent (and any
 *  future JSONL source). */
async function processJsonl(
  filePath: string,
  toItems: (row: unknown) => TrainingItem[] | null,
  ci: CachedIngest,
  onExample: (contentBytes: number) => Promise<boolean>,
  sample: (it: TrainingItem) => void,
  maxLineChars: number,
): Promise<FileResult> {
  const blob = await openAsBlob(filePath);
  const reader = blob.stream().pipeThrough(new TextDecoderStream()).getReader();
  let examples = 0, skipped = 0, leftover = "", dropping = false;

  const processLine = async (line: string): Promise<boolean> => {
    if (!line.trim()) return true;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      skipped++;
      return true;
    }
    const items = toItems(row);
    if (!items || items.length === 0) {
      skipped++;
      return true;
    }
    return ingestItems(ci, items, async (contentBytes) => {
      examples++;
      return onExample(contentBytes);
    }, sample);
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
            if (leftover.length + chunk.length > maxLineChars) {
              leftover = "";
              dropping = true;
              skipped++;
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
        if (leftover.length + part.length > maxLineChars) {
          leftover = "";
          skipped++;
          continue;
        }
        const line = leftover + part;
        leftover = "";
        if (!(await processLine(line))) {
          return { examples, stopped: true, skipped };
        }
      }
    }
    if (!dropping && leftover.trim()) {
      if (!(await processLine(leftover))) {
        return { examples, stopped: true, skipped };
      }
    }
    return { examples, stopped: false, skipped };
  } finally {
    try {
      reader.releaseLock();
    } catch { /* best effort */ }
  }
}

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

/** Read a downloaded Parquet file in bounded row batches with hyparquet (+Snappy
 *  from hyparquet-compressors) over a web-standard Blob byte source, depositing
 *  each row via `toItems`. At most `PARQUET_BATCH_BYTES` of source rows are
 *  materialised at a time, so neither a multi-hundred-MB file nor a file written
 *  as ONE giant row-group loads whole into memory.
 *
 *  Batching also makes a single-group file INTERRUPTIBLE: the abort check runs
 *  per batch, where before a 1.19M-row group could not be cancelled at all. */
async function processParquet(
  filePath: string,
  toItems: (row: unknown) => TrainingItem[] | null,
  ci: CachedIngest,
  onExample: (contentBytes: number) => Promise<boolean>,
  sample: (it: TrainingItem) => void,
  // Optional stage-level stop, checked per row and before each batch is
  // decoded. A stage BUDGET must stop the read rather than reject rows: left to
  // reject, a budgeted stage still DECODES every remaining row-group — 143,346
  // rows of one 86.7 MB SODA shard — and reports them as "unusable" when
  // nothing was wrong with them, which is a lie in the run log.
  //
  // Measured honestly: on that shard the wall time did NOT improve (2m 35s ->
  // 2m 37s), because a budgeted run is dominated by depositing the rows it DID
  // take, not by scanning past the ones it did not. The win here is a truthful
  // log and the CPU/allocation of ~143k skipped row decodes, not elapsed time.
  // A larger shard past a small budget is where the decode cost would show.
  shouldStop?: () => boolean,
): Promise<FileResult> {
  const blob = await openAsBlob(filePath);
  const file = {
    byteLength: blob.size,
    slice: async (start: number, end?: number) =>
      await blob.slice(start, end ?? blob.size).arrayBuffer(),
  };
  const meta = await parquetMetadataAsync(file);
  let examples = 0, skipped = 0;
  let rowStart = 0;
  for (const rg of meta.row_groups) {
    const rgRows = Number(rg.num_rows);
    const rgEnd = rowStart + rgRows;
    const batchRows = parquetBatchRows(
      rgRows,
      Number(rg.total_byte_size ?? 0),
      PARQUET_BATCH_BYTES,
    );
    if (batchRows <= 0) continue; // empty group
    // Materialise one bounded batch at a time, then deposit its rows.
    while (rowStart < rgEnd) {
      if (shutdown.signal.aborted) return { examples, stopped: true, skipped };
      if (shouldStop?.()) return { examples, stopped: true, skipped };
      const rowEnd = Math.min(rowStart + batchRows, rgEnd);
      const rows = await parquetReadObjects({
        file,
        compressors,
        rowStart,
        rowEnd,
      });
      rowStart = rowEnd;
      for (const row of rows) {
        if (shouldStop?.()) return { examples, stopped: true, skipped };
        const items = toItems(row);
        if (!items || items.length === 0) {
          skipped++;
          continue;
        }
        const ok = await ingestItems(ci, items, async (contentBytes) => {
          examples++;
          return onExample(contentBytes);
        }, sample);
        if (!ok) return { examples, stopped: true, skipped };
      }
    }
  }
  return { examples, stopped: false, skipped };
}

/** Read a downloaded JSON-array file (General-Knowledge output.json) and deposit
 *  each element via `toItems`. The array is small enough (~16 MB) to parse whole;
 *  a huge file would be rejected by the cache ceiling long before this. */
async function processJsonArray(
  filePath: string,
  toItems: (row: unknown) => TrainingItem[] | null,
  ci: CachedIngest,
  onExample: (contentBytes: number) => Promise<boolean>,
  sample: (it: TrainingItem) => void,
): Promise<FileResult> {
  const blob = await openAsBlob(filePath);
  let arr: unknown;
  try {
    arr = JSON.parse(await blob.text());
  } catch (e) {
    throw new Error(`invalid JSON: ${(e as Error).message}`);
  }
  const rows: unknown[] = Array.isArray(arr) ? arr : [];
  let examples = 0, skipped = 0;
  for (const row of rows) {
    if (shutdown.signal.aborted) return { examples, stopped: true, skipped };
    const items = toItems(row);
    if (!items || items.length === 0) {
      skipped++;
      continue;
    }
    const ok = await ingestItems(ci, items, async (contentBytes) => {
      examples++;
      return onExample(contentBytes);
    }, sample);
    if (!ok) return { examples, stopped: true, skipped };
  }
  return { examples, stopped: false, skipped };
}

// ═══════════════════════════════════════════════════════════════════════
// §8  Progress display (a live panel pinned to the BOTTOM of stderr)
//
// Log lines scroll up into history above the panel; the panel always sits
// at the bottom and only ever clears its own rows on repaint, so download
// notices and recall boxes persist instead of being wiped each frame.
// ═══════════════════════════════════════════════════════════════════════

interface ProgState {
  exampleCount: number; // training examples ingested
  target: number; // learned-content byte cap (MAX_BYTES), or Infinity
  elapsedS: number;
  trainedBytes: number; // UTF-8 content bytes trained so far
  trainedRate: number; // rolling trained-content bytes/s — the headline KB/s
  bytesDone: number; // source bytes processed so far (corpus position)
  bytesTotal: number; // total source bytes of the corpus (0 until known)
  bytesRate: number; // rolling source bytes/s (drives the corpus ETA)
  fileIndex: number; // 1-based
  fileTotal: number;
  filePath: string; // language display name
  fileSize: number; // bytes of current ZIP
  fileExamples: number; // examples ingested from the current language
  activity: "download" | "process" | "idle";
  dlSpeed: number; // bytes/s, or 0
  dlDone: number; // bytes downloaded so far for the current download (live)
  dlTotal: number; // total bytes of the current download (0 if unknown)
  storeEntries: number;
  cacheBytes: number;
  lastSample: string | null; // pre-rendered recall box, pinned in the panel
}

/** A prompt/expected pair to display for an item. */
function promptOf(
  it: TrainingItem,
): { prompt: string; expected: string | null; kind: "episode" | "experience" } {
  return isEpisode(it)
    ? { prompt: it.context, expected: it.continuation, kind: "episode" }
    : { prompt: it.slice(0, 200), expected: null, kind: "experience" };
}

/** A coarse, honest similarity between an expected continuation and SEMA's
 *  recall. Both are normalized (lowercased, whitespace-collapsed) and compared
 *  by the longest shared leading run plus token overlap, so the verdict is a
 *  heuristic signal of recall quality rather than a brittle fixed-prefix test. */
function recallSimilarity(expected: string, response: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const a = norm(expected), b = norm(response);
  if (!a || !b) return 0;
  let lead = 0;
  const lim = Math.min(a.length, b.length);
  while (lead < lim && a[lead] === b[lead]) lead++;
  const leadFrac = lead / Math.max(1, Math.min(a.length, b.length));
  const ta = new Set(a.split(" ")), tb = new Set(b.split(" "));
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const jac = inter / Math.max(1, ta.size + tb.size - inter);
  return Math.max(leadFrac, jac);
}

/** A framed recall sample. Pinned in the panel on a TTY (so the most recent
 *  example is always on screen) and logged once per checkpoint when piped. */
function renderInferenceBox(
  prompt: string,
  expected: string | null,
  response: string,
  kind: "episode" | "experience",
  checkpointN: number,
): string {
  const W = 68;
  const hr = `${DIM}${"─".repeat(W)}${R}`;
  const title = kind === "episode"
    ? "latest recall"
    : "latest recall (experience)";
  const head = `${title} · checkpoint #${checkpointN} `;
  const shown = response.trim() ? response : "(empty)";
  const lines = [
    `${B}╭─ ${head}${"─".repeat(Math.max(0, W - 2 - head.length))}╮${R}`,
    `${B}│${R} ${hr}`,
    `${B}│${R}  ${CYAN}${B}Context:${R}  ${clip(prompt, W - 13)}`,
  ];
  if (expected) {
    lines.push(`${B}│${R}  ${YEL}${B}Expected:${R} ${clip(expected, W - 13)}`);
  }
  lines.push(`${B}│${R}  ${GRN}${B}SEMA:${R}     ${clip(shown, W - 13)}`);
  lines.push(`${B}│${R} ${hr}`);
  let verdict: string;
  if (expected) {
    const sim = recallSimilarity(expected, response);
    const pctStr = `${Math.round(sim * 100)}%`;
    verdict = sim >= 0.6
      ? `${GRN}✓${R}  recall close to expected ${DIM}(~${pctStr} overlap)${R}`
      : sim >= 0.25
      ? `${YEL}△${R}  partial recall ${DIM}(~${pctStr} overlap)${R}`
      : `${RED}✗${R}  recall diverges ${DIM}(~${pctStr} overlap)${R}`;
  } else {
    verdict = `${DIM}·${R}  plain experience — no expected answer`;
  }
  lines.push(`${B}│${R}  ${verdict}`);
  lines.push(`${B}╰${"─".repeat(W)}╯${R}`);
  return lines.join("\n");
}

function renderPanel(s: ProgState): string {
  const targetKnown = isFinite(s.target);
  // Primary progress: by learned-content bytes when a MAX_MB target is set,
  // else by how far we are through the corpus on disk (bytes) — so the default
  // unbounded run still shows a real fraction and a real ETA.
  const frac = targetKnown
    ? (s.target > 0 ? s.trainedBytes / s.target : 0)
    : (s.bytesTotal > 0 ? s.bytesDone / s.bytesTotal : 0);

  const etaStr = (() => {
    if (targetKnown) {
      return s.trainedRate > 0
        ? dur((s.target - s.trainedBytes) / s.trainedRate)
        : "∞";
    }
    if (s.bytesTotal > 0 && s.bytesRate > 0) {
      return dur((s.bytesTotal - s.bytesDone) / s.bytesRate);
    }
    return "∞";
  })();

  const fileFrac = s.fileTotal > 0 ? s.fileIndex / s.fileTotal : 0;

  let actIcon = `${DIM}·${R}`, actText = "waiting…";
  if (s.activity === "download") {
    actIcon = `${CYAN}⬇${R}`;
    const name = s.filePath;
    const total = s.dlTotal > 0 ? s.dlTotal : s.fileSize;
    if (total > 0 && s.dlDone > 0) {
      const dlFrac = clamp01(s.dlDone / total);
      actText =
        `downloading ${name}  ${bar(18, dlFrac)} ${B}${pct(dlFrac)}${R}` +
        ` ${DIM}${bytes(s.dlDone)}/${bytes(total)}${R}`;
      if (s.dlSpeed > 0) actText += ` ${DIM}@ ${bytes(s.dlSpeed)}/s${R}`;
    } else {
      actText = total > 0
        ? `downloading ${name} · ${bytes(total)}…`
        : `downloading ${name}…`;
    }
  } else if (s.activity === "process") {
    actIcon = `${GRN}✓${R}`;
    actText = `processing ${s.filePath} · ${
      int(s.fileExamples)
    } examples so far`;
  }

  const targetStr = targetKnown ? bytes(s.target) : "∞";
  const headExamples = targetKnown
    ? `${CYAN}${bytes(s.trainedBytes)}${R} / ${targetStr} learned ${DIM}·${R} ${
      int(s.exampleCount)
    } examples`
    : `${CYAN}${int(s.exampleCount)}${R} examples`;
  const corpusInfo = s.bytesTotal > 0
    ? `${B}📦${R} ${bytes(s.bytesDone)}/${bytes(s.bytesTotal)} (${
      pct(s.bytesDone / s.bytesTotal)
    })`
    : `${B}📦${R} ${bytes(s.bytesDone)} processed`;
  const fileInfo = s.fileTotal > 0
    ? `${B}🌐${R} ${s.fileIndex}/${s.fileTotal} (${pct(fileFrac)})`
    : `${B}🌐${R} ${s.fileIndex} languages`;

  const panel = [
    `${B}╭${R}${B} sema train${R} ${DIM}·${R} SmolSent+Aya+oasst2 ${DIM}·${R} ` +
    `D=${D} ${DIM}·${R} seed=${SEED} ${DIM}·${R} ` +
    `store=${
      basename(DB_PATH)
    }.sqlite\n${B}╰${R} target=${CYAN}${targetStr}${R} ` +
    `learned ${DIM}·${R} checkpoint every ${bytes(CHECKPOINT_BYTES)}`,
    `\n${bar(40, frac)}  ${B}${pct(frac)}${R}  ${headExamples}`,
    `\n${B}⚡${R} ${bytes(s.trainedRate)}/s learned  ${B}🧠${R} ${
      bytes(s.trainedBytes)
    } content  ${B}⏱${R} ${dur(s.elapsedS)} elapsed  ${B}🕐${R} ${etaStr} ETA`,
    `${fileInfo}  ${corpusInfo}  ${B}🗄${R} ${num(s.storeEntries)} entries  ` +
    `${B}💾${R} cache ${bytes(s.cacheBytes)}`,
    `\n${actIcon} ${actText}`,
  ].join("");

  return s.lastSample ? `${panel}\n${s.lastSample}` : panel;
}

/** A live panel pinned to the bottom of stderr. On a TTY it redraws in place,
 *  clearing only its own lines; logs are flushed into the scrollback above it.
 *  Off a TTY (piped/CI) the panel is suppressed and a plain status line is
 *  emitted occasionally, so logs stay clean and parseable. */
class Progress {
  private lines = 0; // height of the panel currently on screen
  private lastPaint = 0;
  private lastStatus = 0;
  private last: ProgState | null = null;
  private readonly tty = process.stderr.isTTY === true;

  /** True when attached to an interactive terminal (panel is live). */
  get interactive(): boolean {
    return this.tty;
  }

  /** Cursor sequence that returns to the top of the panel and clears it. */
  private clearPanel(): string {
    if (this.lines <= 0) return "";
    const up = this.lines - 1; // cursor is on the panel's last line
    return (up > 0 ? `${CSI}${up}F` : "\r") + `${CSI}0J`;
  }

  render(s: ProgState, force = false): void {
    this.last = s;
    const now = Date.now();
    if (!force && now - this.lastPaint < PROGRESS_MS) return;
    this.lastPaint = now;

    if (!this.tty) {
      if (force || now - this.lastStatus >= 10_000) {
        this.lastStatus = now;
        const targetKnown = isFinite(s.target);
        const where = s.bytesTotal > 0
          ? ` ${pct(s.bytesDone / s.bytesTotal)} of corpus`
          : "";
        process.stderr.write(
          `[sema] ${bytes(s.trainedBytes)}${
            targetKnown ? "/" + bytes(s.target) : ""
          } learned · ${int(s.exampleCount)} examples · ` +
            `${
              bytes(s.trainedRate)
            }/s · lang ${s.fileIndex}/${s.fileTotal}${where} · ` +
            `${num(s.storeEntries)} entries\n`,
        );
      }
      return;
    }

    const text = renderPanel(s);
    process.stderr.write(`${this.clearPanel()}${HIDE}${text}`);
    this.lines = text.split("\n").length;
  }

  /** Emit a line (or block) into the scrollback above the panel; the panel is
   *  redrawn immediately beneath it so it never disappears between frames. */
  log(msg: string): void {
    if (!this.tty) {
      process.stderr.write(`${msg}\n`);
      return;
    }
    let out = `${this.clearPanel()}${msg}\n`;
    this.lines = 0;
    if (this.last) {
      const text = renderPanel(this.last);
      out += `${HIDE}${text}`;
      this.lines = text.split("\n").length;
    }
    process.stderr.write(out);
  }

  dispose(): void {
    if (this.tty) process.stderr.write(`${SHOW}\n`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// §9  Progress persistence (inside the store — resume from the store alone)
// ═══════════════════════════════════════════════════════════════════════

const META_COMPLETED = "train.completedFiles";
const META_DEPOSITS = "train.depositCount";
const META_TRAINED_BYTES = "train.trainedContentBytes";
const META_BYTES = "train.totalBytesProcessed";
const META_CORPUS_BYTES = "train.totalCorpusBytes";

interface SavedProgress {
  completedFiles: string[];
  depositCount: number;
  trainedContentBytes: number;
  totalBytesProcessed: number;
  totalCorpusBytes: number;
}

async function loadProgress(store: Store): Promise<SavedProgress> {
  try {
    const raw = await store.getMeta(META_COMPLETED);
    const deps = await store.getMeta(META_DEPOSITS);
    const b = await store.getMeta(META_BYTES);
    if (raw !== null && deps !== null && b !== null) {
      const completedFiles = JSON.parse(raw);
      if (Array.isArray(completedFiles)) {
        const trained = await store.getMeta(META_TRAINED_BYTES);
        const corpus = await store.getMeta(META_CORPUS_BYTES);
        return {
          completedFiles,
          depositCount: Number(deps) || 0,
          trainedContentBytes: Number(trained) || 0,
          totalBytesProcessed: Number(b) || 0,
          totalCorpusBytes: Number(corpus) || 0,
        };
      }
    }
  } catch { /* corrupt/missing — start fresh */ }
  return {
    completedFiles: [],
    depositCount: 0,
    trainedContentBytes: 0,
    totalBytesProcessed: 0,
    totalCorpusBytes: 0,
  };
}

async function saveProgress(store: Store, p: SavedProgress): Promise<void> {
  await store.setMeta(META_COMPLETED, JSON.stringify(p.completedFiles));
  await store.setMeta(META_DEPOSITS, String(p.depositCount));
  await store.setMeta(META_TRAINED_BYTES, String(p.trainedContentBytes));
  await store.setMeta(META_BYTES, String(p.totalBytesProcessed));
  await store.setMeta(META_CORPUS_BYTES, String(p.totalCorpusBytes));
  await store.setMeta("train.updatedAt", new Date().toISOString());
  store.commit();
}

// ═══════════════════════════════════════════════════════════════════════
// §10  Main
// ═══════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  // The vector indices' memory knob (MiB) — each index's SQLite page cache.
  // The IVF index routes inserts through a RAM-resident pivot table and
  // appends to chunk blobs, so this cache mostly serves query-time cluster
  // scans; 256 MiB comfortably covers the probed working set of a trained
  // store.  Override with VECTOR_CACHE_MB (64 is the library default).
  const VECTOR_CACHE_MB = Math.max(0, Number(env("VECTOR_CACHE_MB", "256")));
  // Page cache for the MAIN DAG database (node/kid/edge/contain tables).
  // Training issues millions of content-addressed point probes per session
  // against a GB-scale file; the library default (64 MiB) is sized for a
  // small machine — a training box affords more.  Override with
  // SQLITE_CACHE_MB.
  const SQLITE_CACHE_MB = Math.max(0, Number(env("SQLITE_CACHE_MB", "256")));
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

  await store.setMeta(
    "train.dataset",
    "SmolSent+Aya+oasst2+Taskmaster+2Wiki+SODA+MASSIVE",
  );
  await store.setMeta("train.D", String(D));
  await store.setMeta("train.seed", String(SEED));
  await store.setMeta("train.createdAt", new Date().toISOString());

  // ── counters & sampling ──
  let depositCount = 0;
  let trainedContentBytes = 0;
  let bytesSinceCkpt = 0;
  let checkpointNum = 0;
  let totalBytesProcessed = 0;
  let totalCorpusBytes = 0;
  const langTally: Record<string, number> = {};
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
  const progress = new Progress();
  // Surface rate-limit waits from the low-level fetch retries into the live log,
  // so a 429 back-off reads as "waiting", never a silent hang or a dropped file.
  onThrottleWait = (ms, label) => {
    progress.log(
      `  ${YEL}⏳${R} rate-limited (${label}); waiting ${
        (ms / 1000).toFixed(1)
      }s and retrying — not skipping`,
    );
  };
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
    state.exampleCount = depositCount;
    state.trainedBytes = trainedContentBytes;
    state.elapsedS = (now - t0) / 1000;
    state.storeEntries = cachedEntries;
    state.bytesDone = totalBytesProcessed;
    state.bytesTotal = totalCorpusBytes;

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
      const instTrained = (trainedContentBytes - rateTrained) / dt;
      const instByte = (totalBytesProcessed - rateBytes) / dt;
      const a = 0.3; // EMA weight on the newest sample
      state.trainedRate = state.trainedRate === 0
        ? instTrained
        : state.trainedRate * (1 - a) + instTrained * a;
      state.bytesRate = state.bytesRate === 0
        ? instByte
        : state.bytesRate * (1 - a) + instByte * a;
      rateT = now;
      rateTrained = trainedContentBytes;
      rateBytes = totalBytesProcessed;
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
  // main() is abandoned, and the process exits 0 silently mid-file — no error for
  // the fault-tolerance to catch. This one ref'd (NOT unref'd) timer guarantees a
  // live handle for the whole run, so the loop can never drain from under a
  // pending yield. Every real exit is an explicit process.exit() (finish(), the
  // shutdown watchdog, the second-signal path, the fatal catch), so keeping this
  // handle alive never delays a genuine shutdown; finish() clears it before that
  // final exit for tidiness. Same lesson as waitMs above (deliberately un-unref'd).
  const keepAlive = setInterval(() => {}, 1 << 30);

  const checkpoint = () => mind.save();

  /** Run index maintenance: compact (remove garbage), repair (fill gaps),
   *  then refresh the canonical-form index (see below).  All three are
   *  idempotent — running twice produces the same result as once.
   *  Compaction frees index space first; repair then adds back every
   *  edge/halo-bearing node whose gist was evicted from the pending cache
   *  before it reached the content index, completing the coverage that
   *  incremental promotion alone cannot guarantee.
   *
   *  repair runs with minParents = 0, NOT the library default of 2.  The
   *  default repairs only structural BRIDGES (≥2 parents), but this
   *  trainer's fact deposits also leave answer-side DEPOSIT ROOTS with 0
   *  structural parents ("The capital of France is Paris." as the dst of a
   *  Q→A edge is a root of its own tree, contained in nothing).  Those are
   *  resonance targets recall depends on — a trained store shipped without
   *  them cannot ground statement-shaped queries against its own answers
   *  (observed: 33 such roots missing after a full curriculum, including
   *  high-traffic conversation replies).  minParents = 0 admits every
   *  edge/halo bearer; the candidate set is still corpus-of-experiences-
   *  sized, so the pass stays cheap.
   *
   *  Logs the number of entries removed/added so a run that silently degrades
   *  (growing compaction count, or repair never recovering anything) is
   *  visible in the training log. */
  const runIndexMaintenance = async (): Promise<void> => {
    if (!INDEX_MAINTENANCE) return;
    try {
      const removed = await mind.store.compactContentIndex();
      if (removed > 0) {
        progress.log(
          `  ${DIM}index compact: removed ${int(removed)} isolated entries${R}`,
        );
      }
    } catch (err) {
      progress.log(
        `  ${YEL}⚠ index compact failed${R}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    try {
      const added = await mind.repairContentIndex(0);
      if (added > 0) {
        progress.log(
          `  ${GRN}index repair: added ${
            int(added)
          } missing resonance targets${R}`,
        );
      }
    } catch (err) {
      progress.log(
        `  ${YEL}⚠ index repair failed${R}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    // Canonical-form index (src/canon.ts): lets resolution find stored forms
    // across surface variation (case, width, whitespace).  Incremental and
    // idempotent by construction — the `canon.upto` meta cursor scans only
    // nodes newer than the last pass, and the (h, id) primary key ignores
    // re-inserted rows — so it composes with the resume model exactly like
    // compact/repair: every checkpoint (and finish) leaves the index
    // covering all content trained so far.
    try {
      const added = await mind.buildCanonIndex();
      if (added > 0) {
        progress.log(
          `  ${GRN}canon index: added ${int(added)} canonical-form entries${R}`,
        );
      }
    } catch (err) {
      progress.log(
        `  ${YEL}⚠ canon index build failed${R}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  // The checkpoint recall is a best-effort diagnostic. It is time-bounded so a
  // slow/large store can never freeze the deposit loop, and guarded so a still
  // running recall is never stacked on top of another.
  let inferBusy = false;
  const runRecall = async (item: TrainingItem, n: number): Promise<void> => {
    if (inferBusy) return;
    inferBusy = true;
    try {
      const info = promptOf(item);
      const r = await withTimeout(
        mind.respond(info.prompt),
        INFER_TIMEOUT_MS,
        "recall",
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

  // ── graceful shutdown (always leaves the store consistent) ──
  let stopRequested = false;
  let stopReason = "interrupted";
  let finishing = false;

  const finish = async (why: string): Promise<void> => {
    if (finishing) return;
    finishing = true;
    shutdown.abort(); // unblock any straggling fetch/pipeTo
    tick(true);
    await store.setMeta("train.completedAt", new Date().toISOString());
    await store.setMeta("train.totalDeposits", String(depositCount));
    await store.setMeta("train.totalTrainedBytes", String(trainedContentBytes));
    await store.setMeta("train.totalBytes", String(totalBytesProcessed));
    await store.setMeta(
      "train.totalCorpusBytes",
      String(totalCorpusBytes),
    );
    await store.setMeta("train.langTally", JSON.stringify(langTally));
    try {
      await runIndexMaintenance();
      await checkpoint();
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
    const avgRate = elapsedS > 0 ? trainedContentBytes / elapsedS : 0;
    const tally = Object.entries(langTally)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${int(v)}`)
      .join(", ");
    let entries = depositCount;
    try {
      entries = await mind.store.size();
    } catch { /* best effort */ }
    console.log(
      `\n${GRN}✓${R} ${why}.  ${basename(DB_PATH)}.sqlite: ` +
        `${int(entries)} entries, ${int(depositCount)} examples, ` +
        `${bytes(trainedContentBytes)} content learned ` +
        `${DIM}(${bytes(avgRate)}/s avg)${R}, ` +
        `${bytes(totalBytesProcessed)} corpus processed, ${elapsed} elapsed.` +
        (tally ? `\n  ${DIM}per language:${R} ${tally}` : ""),
    );
    try {
      await store.close();
    } catch { /* best effort */ }
    process.exit(0);
  };

  const requestStop = (reason: string) => {
    if (stopRequested) {
      process.stderr.write(`\n${YEL}⚠ second signal — exiting now${R}\n`);
      process.stderr.write(SHOW);
      process.exit(130);
    }
    stopRequested = true;
    stopReason = reason;
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
      progress.log(`  ${YEL}⚠ connection error (ignored)${R}: ${err.message}`);
      return;
    }
    process.stderr.write(
      `\n${RED}uncaught exception${R}: ${err.message}\n${err.stack ?? ""}\n`,
    );
    try {
      void store.setMeta("train.crashedAt", new Date().toISOString());
      void store.setMeta("train.crashError", err.message);
      void store.setMeta("train.totalDeposits", String(depositCount));
    } catch { /* best effort */ }
    process.exit(1);
  });

  // ── per-example callback: gates MAX_MB, drives checkpoints + samples ──
  const onDeposit = async (contentBytes: number): Promise<boolean> => {
    depositCount++;
    trainedContentBytes += contentBytes;
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
        await runIndexMaintenance();
        await checkpoint();
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
    return !stopRequested && trainedContentBytes < MAX_BYTES;
  };

  const cacheWarn = (m: string) => progress.log(`  ${m}`);

  /** Acquire a source file: reuse a cached copy, else download `url` into the
   *  cache under `destName` (atomic, retried, rate-limit-tolerant, shows live
   *  byte progress). Returns the local path, or null on a non-abort failure
   *  (logged). `label` names the file in the panel/log. */
  const acquire = async (
    url: string,
    destName: string,
    label: string,
  ): Promise<string | null> => {
    const dest = join(CACHE_DIR, destName);
    if (existsSync(dest)) {
      progress.log(`  ${GRN}✓${R} ${label} ${DIM}(cached)${R}`);
      return dest;
    }
    let size = 0;
    try {
      size = await headSize(url);
    } catch { /* unknown — proceed without a cache-room reservation */ }
    state.activity = "download";
    state.filePath = label;
    state.fileSize = size;
    const slot = { done: 0, total: size, t0: Date.now() };
    dlSlot = slot;
    tick(true);
    try {
      await ensureCacheRoom(size, cacheWarn);
      slot.t0 = Date.now();
      await downloadFile(
        url,
        dest,
        DOWNLOAD_TRIES,
        (n, e) =>
          progress.log(
            `  ${YEL}⚠${R} ${label} download attempt ${n}/${DOWNLOAD_TRIES}: ${e.message}`,
          ),
        (done, total) => {
          slot.done = done;
          if (total > 0) slot.total = total;
        },
      );
    } catch (e) {
      dlSlot = null;
      if (stopRequested || (e as Error)?.name === "AbortError") return null;
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
    return dest;
  };

  // ── §10a  SmolSent stage (the FIRST stage) ──
  //
  // Downloads each SmolSent per-pair JSONL file and streams its lines. Resume is
  // per-file: a fully-consumed file is recorded in completedFiles
  // ("smolsent::<name>"); an interrupted file is re-streamed from the top on
  // resume (re-deposition is idempotent). LOCAL_PATH may hold pre-downloaded
  // smolsent *.jsonl files.
  const smolToItems = (row: unknown): TrainingItem[] | null => {
    const r = toSmolSentRow(row);
    return r ? smolSentRowToItems(r) : null;
  };
  const trainSmolSent = async (): Promise<void> => {
    if (!SMOLSENT) return;
    if (trainedContentBytes >= MAX_BYTES || stopRequested) return;

    // Work-list: local *.jsonl in LOCAL_PATH, else the repo's smolsent/ files.
    let files: Array<
      { id: string; name: string; local?: string; url?: string }
    >;
    if (LOCAL_PATH) {
      files = readdirSync(LOCAL_PATH)
        .filter((f: string) => /\.jsonl$/i.test(f))
        .sort()
        .map((f: string) => ({
          id: `${SMOLSENT_ID}::${f}`,
          name: f,
          local: join(LOCAL_PATH, f),
        }));
      if (SMOLSENT_PAIRS.length) {
        const want = new Set(
          SMOLSENT_PAIRS.map((p) => p.replace(/\.jsonl$/i, "")),
        );
        files = files.filter((f) => want.has(f.name.replace(/\.jsonl$/i, "")));
      }
    } else {
      let paths: string[];
      try {
        paths = await listSmolSentFiles();
      } catch (e) {
        if (stopRequested || (e as Error)?.name === "AbortError") return;
        progress.log(
          `  ${RED}✗${R} SmolSent file listing failed: ${(e as Error).message}`,
        );
        return;
      }
      files = paths.map((path) => ({
        id: `${SMOLSENT_ID}::${basename(path)}`,
        name: basename(path),
        // owner/name and the file path are URL PATH segments — do not encode "/".
        url:
          `https://huggingface.co/datasets/${SMOLSENT_DATASET}/resolve/main/${path}`,
      }));
    }
    if (files.length === 0) {
      progress.log(`  ${DIM}· no SmolSent files found — skipping${R}`);
      return;
    }

    const p = await loadProgress(store);
    const done = new Set(p.completedFiles);
    const remaining = files.filter((f) => !done.has(f.id));
    if (remaining.length === 0) {
      progress.log(`  ${DIM}· SmolSent already trained — skipping${R}`);
      return;
    }
    state.fileTotal = files.length;
    progress.log(
      `  ${GRN}✓${R} SmolSent: ${remaining.length}/${files.length} translation file(s) to train`,
    );

    let idx = 0;
    for (const f of files) {
      if (trainedContentBytes >= MAX_BYTES || stopRequested) break;
      idx++;
      if (done.has(f.id)) continue;

      // Acquire (download or reuse), then stream the JSONL.
      let path = f.local ?? "";
      let downloaded = false;
      if (!path) {
        const got = await acquire(
          f.url!,
          f.id.replace(/[^A-Za-z0-9._-]+/g, "_"),
          `SmolSent ${f.name}`,
        );
        if (!got) {
          if (stopRequested) break;
          continue; // a single failed file never aborts the stage
        }
        path = got;
        downloaded = true;
      }

      // Accumulate known corpus bytes so the progress bar shows a
      // meaningful ETA — grows as each file's size is discovered.
      try {
        totalCorpusBytes += statSync(path).size;
      } catch { /* best effort */ }

      state.activity = "process";
      state.fileIndex = idx;
      state.filePath = `SmolSent ${f.name}`;
      state.fileExamples = 0;
      tick(true);
      const p0 = Date.now();
      let res: FileResult;
      try {
        res = await processJsonl(
          path,
          smolToItems,
          ci,
          onDeposit,
          sample,
          MAX_SMOLSENT_CHARS * 4,
        );
      } catch (e) {
        if (stopRequested || (e as Error)?.name === "AbortError") break;
        progress.log(
          `  ${RED}✗${R} SmolSent ${f.name} parse failed: ${
            (e as Error).message
          }`,
        );
        if (downloaded) {
          try {
            unlinkSync(path);
          } catch { /* best effort */ }
        }
        continue;
      }
      langTally["smolsent"] = (langTally["smolsent"] ?? 0) + res.examples;
      progress.log(
        `  ${GRN}✓${R} ${
          f.name.replace(/\.jsonl$/i, "")
        } ${DIM}[translation]${R} → ${int(res.examples)} facts ${DIM}in ${
          dur((Date.now() - p0) / 1000)
        }${R}` +
          (res.skipped
            ? ` ${YEL}· ${int(res.skipped)} unusable row(s) skipped${R}`
            : "") +
          (res.stopped ? ` ${YEL}(stopped early)${R}` : ""),
      );

      if (!res.stopped) {
        try {
          totalBytesProcessed += statSync(path).size;
        } catch { /* best effort */ }
        if (downloaded) {
          try {
            unlinkSync(path);
          } catch { /* best effort */ }
        }
        done.add(f.id);
        p.completedFiles.push(f.id);
      }
      try {
        await saveProgress(store, {
          completedFiles: p.completedFiles,
          depositCount,
          trainedContentBytes,
          totalBytesProcessed,
          totalCorpusBytes,
        });
        await store.setMeta("train.langTally", JSON.stringify(langTally));
      } catch { /* best effort — finish() will retry */ }
      if (res.stopped) break; // cap/signal — leave file un-completed for resume
    }
  };

  // ── §10b  Aya Dataset stage (runs AFTER SmolSent) ──
  //
  // Downloads the one train Parquet file and reads it row-group by row-group
  // (hyparquet + Snappy) — one (inputs → targets) fact per row. Marked complete
  // only when fully consumed; an interrupted run re-reads from the top on resume
  // (re-deposition is idempotent). LOCAL_PATH may hold a pre-downloaded *.parquet.
  const ayaToItems = (row: unknown): TrainingItem[] | null => {
    const r = toAyaRow(row);
    return r ? ayaRowToItems(r) : null;
  };
  const trainAya = async (): Promise<void> => {
    if (!AYA) return;
    if (trainedContentBytes >= MAX_BYTES || stopRequested) return;

    const p = await loadProgress(store);
    if (p.completedFiles.includes(AYA_ID)) {
      progress.log(`  ${DIM}· Aya Dataset already trained — skipping${R}`);
      return;
    }

    let path = "", downloaded = false;
    if (LOCAL_PATH) {
      const hit = readdirSync(LOCAL_PATH).find((f: string) =>
        /aya.*\.parquet$/i.test(f) || /\.parquet$/i.test(f)
      );
      if (!hit) {
        progress.log(
          `  ${DIM}· no Aya *.parquet in ${LOCAL_PATH} — skipping${R}`,
        );
        return;
      }
      path = join(LOCAL_PATH, hit);
    } else {
      const got = await acquire(AYA_URL, "aya_train.parquet", "Aya Dataset");
      if (!got) return;
      path = got;
      downloaded = true;
    }

    try {
      totalCorpusBytes += statSync(path).size;
    } catch { /* best effort */ }
    state.fileTotal = 1;
    state.fileIndex = 1;

    state.activity = "process";
    state.filePath = "Aya Dataset";
    state.fileExamples = 0;
    tick(true);
    const p0 = Date.now();
    let res: FileResult;
    try {
      res = await processParquet(path, ayaToItems, ci, onDeposit, sample);
    } catch (e) {
      if (stopRequested || (e as Error)?.name === "AbortError") return;
      progress.log(
        `  ${RED}✗${R} Aya processing failed: ${(e as Error).message}`,
      );
      return;
    }
    langTally["aya"] = (langTally["aya"] ?? 0) + res.examples;
    progress.log(
      `  ${GRN}✓${R} Aya Dataset ${DIM}[multilingual chat]${R} → ${
        int(res.examples)
      } facts ${DIM}in ${dur((Date.now() - p0) / 1000)}${R}` +
        (res.skipped
          ? ` ${YEL}· ${int(res.skipped)} unusable row(s) skipped${R}`
          : "") +
        (res.stopped ? ` ${YEL}(stopped early)${R}` : ""),
    );

    if (!res.stopped) {
      try {
        totalBytesProcessed += statSync(path).size;
      } catch { /* best effort */ }
      if (downloaded) {
        try {
          unlinkSync(path);
        } catch { /* best effort */ }
      }
      p.completedFiles.push(AYA_ID);
    }
    try {
      await saveProgress(store, {
        completedFiles: p.completedFiles,
        depositCount,
        trainedContentBytes,
        totalBytesProcessed,
        totalCorpusBytes,
      });
      await store.setMeta("train.langTally", JSON.stringify(langTally));
    } catch { /* best effort — finish() will retry */ }
  };

  // ── §10c  oasst2 stage (multi-turn conversations; runs AFTER Aya; both modes) ──
  //
  // Resolves the source (a local *trees*.jsonl.gz in
  // LOCAL_PATH, else the gzip downloaded to the cache), streams it, and marks
  // OASST_ID complete only when fully consumed (an interrupted run re-streams
  // from the top; re-deposition is idempotent). Only multi-turn conversations
  // are deposited — single Q→A trees are skipped inside processOasst.
  const trainOasst = async (): Promise<void> => {
    if (!OASST) return;
    if (trainedContentBytes >= MAX_BYTES || stopRequested) return;

    const p = await loadProgress(store);
    if (p.completedFiles.includes(OASST_ID)) {
      progress.log(`  ${DIM}· oasst2 already trained — skipping${R}`);
      return;
    }

    let gzPath = "";
    let downloaded = false;
    if (LOCAL_PATH) {
      const hit = readdirSync(LOCAL_PATH).find((f: string) =>
        /oasst.*trees.*\.jsonl\.gz$/i.test(f) || /oasst.*\.jsonl\.gz$/i.test(f)
      );
      if (!hit) {
        progress.log(
          `  ${DIM}· no oasst2 *trees*.jsonl.gz in ${LOCAL_PATH} — skipping${R}`,
        );
        return;
      }
      gzPath = join(LOCAL_PATH, hit);
    } else {
      const dest = join(CACHE_DIR, "oasst2_ready.trees.jsonl.gz");
      if (existsSync(dest)) {
        gzPath = dest; // reuse a copy left by a previous interrupted run
        progress.log(`  ${GRN}✓${R} oasst2 trees ${DIM}(cached)${R}`);
      } else {
        let size = 0;
        try {
          size = await headSize(OASST_URL);
        } catch { /* unknown — proceed without a cache-room reservation */ }
        state.activity = "download";
        state.filePath = "oasst2 trees";
        state.fileSize = size;
        const slot = { done: 0, total: size, t0: Date.now() };
        dlSlot = slot;
        tick(true);
        try {
          await ensureCacheRoom(size, cacheWarn);
          slot.t0 = Date.now();
          await downloadFile(
            OASST_URL,
            dest,
            DOWNLOAD_TRIES,
            (n, e) =>
              progress.log(
                `  ${YEL}⚠${R} oasst2 download attempt ${n}/${DOWNLOAD_TRIES}: ${e.message}`,
              ),
            (done, total) => {
              slot.done = done;
              if (total > 0) slot.total = total;
            },
          );
        } catch (e) {
          dlSlot = null;
          if (stopRequested || (e as Error)?.name === "AbortError") return;
          progress.log(
            `  ${RED}✗${R} oasst2 download failed: ${(e as Error).message}`,
          );
          try {
            unlinkSync(dest);
          } catch { /* best effort */ }
          return;
        }
        dlSlot = null;
        const dlS = Math.max(0.001, (Date.now() - slot.t0) / 1000);
        const sz = statSync(dest).size;
        progress.log(
          `  ${CYAN}⬇${R} oasst2 trees ${bytes(sz)} ` +
            `${DIM}${dur(dlS)} @ ${bytes(sz / dlS)}/s${R}`,
        );
        gzPath = dest;
        downloaded = true;
      }
    }

    try {
      totalCorpusBytes += statSync(gzPath).size;
    } catch { /* best effort */ }
    state.fileTotal = 1;
    state.fileIndex = 1;

    // Stream the trees.
    state.activity = "process";
    state.filePath = "oasst2 (multi-turn)";
    state.fileExamples = 0;
    tick(true);
    const p0 = Date.now();
    let result: {
      examples: number;
      stopped: boolean;
      skipped: number;
      multi: number;
    };
    try {
      result = await processOasst(gzPath, ci, onDeposit, sample);
    } catch (e) {
      if (stopRequested || (e as Error)?.name === "AbortError") return;
      progress.log(
        `  ${RED}✗${R} oasst2 processing failed: ${(e as Error).message}`,
      );
      return;
    }
    const { examples, stopped, skipped, multi } = result;
    langTally["oasst2"] = (langTally["oasst2"] ?? 0) + examples;
    progress.log(
      `  ${GRN}✓${R} oasst2 ${DIM}[multi-turn chat]${R} → ${
        int(examples)
      } examples from ${int(multi)} conversation(s) ${DIM}in ${
        dur((Date.now() - p0) / 1000)
      }${R}` +
        (skipped
          ? ` ${YEL}· ${int(skipped)} malformed line(s) skipped${R}`
          : "") +
        (stopped ? ` ${YEL}(stopped early)${R}` : ""),
    );

    // Only mark complete (and reclaim the cache) when fully consumed.
    if (!stopped) {
      try {
        totalBytesProcessed += statSync(gzPath).size;
      } catch { /* best effort */ }
      if (downloaded) {
        try {
          unlinkSync(gzPath);
        } catch { /* best effort */ }
      }
      p.completedFiles.push(OASST_ID);
    }
    try {
      await saveProgress(store, {
        completedFiles: p.completedFiles,
        depositCount,
        trainedContentBytes,
        totalBytesProcessed,
        totalCorpusBytes,
      });
      await store.setMeta("train.langTally", JSON.stringify(langTally));
    } catch { /* best effort — finish() will retry */ }
  };

  // ── §10d  General-Knowledge stage (runs AFTER oasst2) ──
  //
  // Downloads the single JSON-array file (output.json) and deposits each
  // {Question, Answer} as one fact. Marked complete only when fully consumed.
  // LOCAL_PATH may hold a pre-downloaded *.json.
  const genToItems = (row: unknown): TrainingItem[] | null => {
    const r = toGenKnowRow(row);
    return r ? genKnowRowToItems(r) : null;
  };
  // ── §10d′  Taskmaster 1–4 stage (task-oriented dialogue; runs AFTER oasst2) ──
  //
  // Lists the repo's data files, then for each: download, parse the JSON array,
  // deposit one cumulative walk per conversation. Per-FILE resume ids, like
  // SmolSent — an interrupted file is re-read from the top on resume, and
  // re-deposition is idempotent. LOCAL_PATH/taskmaster/ may hold pre-downloaded
  // *.json (a subdirectory, because these share the .json extension with the
  // General-Knowledge source and must not be confused with it).
  const tmToItems = (row: unknown): TrainingItem[] | null => {
    const turns = toTaskmasterTurns(row);
    if (!turns) return null;
    const items = taskmasterConversationToItems(turns); // [] when too short
    return items.length ? items : null;
  };

  const trainTaskmaster = async (): Promise<void> => {
    if (!TASKMASTER) return;
    if (trainedContentBytes >= MAX_BYTES || stopRequested) return;

    let files: Array<
      { id: string; name: string; local?: string; url?: string }
    >;
    if (LOCAL_PATH) {
      const dir = join(LOCAL_PATH, "taskmaster");
      let names: string[] = [];
      try {
        names = readdirSync(dir).filter((f: string) => /\.json$/i.test(f))
          .sort();
      } catch { /* no local taskmaster dir */ }
      if (names.length === 0) {
        progress.log(
          `  ${DIM}· no Taskmaster *.json in ${dir} — skipping${R}`,
        );
        return;
      }
      files = names.map((f: string) => ({
        id: `taskmaster::${f}`,
        name: f,
        local: join(dir, f),
      }));
    } else {
      let listed: Array<{ set: string; path: string }>;
      try {
        listed = await listTaskmasterFiles();
      } catch (e) {
        if (stopRequested || (e as Error)?.name === "AbortError") return;
        progress.log(
          `  ${RED}✗${R} Taskmaster file listing failed: ${
            (e as Error).message
          }`,
        );
        return;
      }
      files = listed.map((f) => ({
        id: `taskmaster::${f.path}`,
        name: `${f.set}/${basename(f.path)}`,
        url: `${TASKMASTER_RAW}/${f.path}`,
      }));
    }
    if (files.length === 0) {
      progress.log(`  ${DIM}· no Taskmaster files found — skipping${R}`);
      return;
    }

    const p = await loadProgress(store);
    const done = new Set(p.completedFiles);
    const remaining = files.filter((f) => !done.has(f.id));
    if (remaining.length === 0) {
      progress.log(`  ${DIM}· Taskmaster already trained — skipping${R}`);
      return;
    }
    state.fileTotal = files.length;
    progress.log(
      `  ${GRN}✓${R} Taskmaster: ${remaining.length}/${files.length} dialogue file(s) to train`,
    );

    let idx = 0;
    for (const f of files) {
      if (trainedContentBytes >= MAX_BYTES || stopRequested) break;
      idx++;
      if (done.has(f.id)) continue;

      let path = f.local ?? "";
      let downloaded = false;
      if (!path) {
        const got = await acquire(
          f.url!,
          f.id.replace(/[^A-Za-z0-9._-]+/g, "_"),
          `Taskmaster ${f.name}`,
        );
        if (!got) {
          if (stopRequested) break;
          continue; // a single failed file never aborts the stage
        }
        path = got;
        downloaded = true;
      }

      try {
        totalCorpusBytes += statSync(path).size;
      } catch { /* best effort */ }

      state.activity = "process";
      state.fileIndex = idx;
      state.filePath = `Taskmaster ${f.name}`;
      state.fileExamples = 0;
      tick(true);
      const p0 = Date.now();
      let res: FileResult;
      try {
        res = await processJsonArray(path, tmToItems, ci, onDeposit, sample);
      } catch (e) {
        if (stopRequested || (e as Error)?.name === "AbortError") break;
        progress.log(
          `  ${RED}✗${R} Taskmaster ${f.name} parse failed: ${
            (e as Error).message
          }`,
        );
        if (downloaded) {
          try {
            unlinkSync(path);
          } catch { /* best effort */ }
        }
        continue;
      }
      langTally["taskmaster"] = (langTally["taskmaster"] ?? 0) + res.examples;
      progress.log(
        `  ${GRN}✓${R} ${f.name} ${DIM}[task dialogue]${R} → ${
          int(res.examples)
        } facts ${DIM}in ${dur((Date.now() - p0) / 1000)}${R}` +
          (res.skipped
            ? ` ${YEL}· ${
              int(res.skipped)
            } unusable conversation(s) skipped${R}`
            : "") +
          (res.stopped ? ` ${YEL}(stopped early)${R}` : ""),
      );

      if (!res.stopped) {
        try {
          totalBytesProcessed += statSync(path).size;
        } catch { /* best effort */ }
        if (downloaded) {
          try {
            unlinkSync(path);
          } catch { /* best effort */ }
        }
        done.add(f.id);
        p.completedFiles.push(f.id);
      }
      try {
        await saveProgress(store, {
          completedFiles: p.completedFiles,
          depositCount,
          trainedContentBytes,
          totalBytesProcessed,
          totalCorpusBytes,
        });
        await store.setMeta("train.langTally", JSON.stringify(langTally));
      } catch { /* best effort — finish() will retry */ }
      if (res.stopped) break; // cap/signal — leave file un-completed for resume
    }
  };

  // ── §10d″  2WikiMultihopQA stage (composition; runs AFTER Taskmaster) ──
  //
  // Only the `evidences` column is ever touched — see §6e″ for why `context`
  // and `question`/`answer` are not.
  const wiki2ToItems = (row: unknown): TrainingItem[] | null => {
    const triples = toWikiTriples(row);
    if (!triples) return null;
    const items = wikiTriplesToItems(triples);
    return items.length ? items : null;
  };

  const trainWiki2 = (): Promise<void> =>
    runConvertedParquetStage({
      enabled: WIKI2,
      label: "2Wiki",
      tally: "2wiki",
      kind: "relation triples",
      dataset: WIKI2_DATASET,
      config: "default",
      splits: WIKI2_SPLITS,
      localDir: "2wiki",
      maxRows: WIKI2_MAX_ROWS,
      toItems: wiki2ToItems,
    });

  // ── §10d‴  Converted-Parquet stage runner (2Wiki, SODA, MASSIVE) ──
  //
  // These three differ only in their name, their row adapter and their row
  // budget, so they share one runner instead of three copies of the per-shard
  // loop. Resume is per SHARD, as everywhere else.
  //
  // The BUDGET is applied here rather than inside an adapter because it is a
  // curriculum decision about corpus MIX, not a property of a row: SODA's train
  // split would otherwise contribute ~8M episodes against the 662,221 deposits
  // of the whole current corpus. A budgeted stage never marks its remaining
  // shards complete, so raising the budget later resumes rather than restarts.
  const runConvertedParquetStage = async (opts: {
    enabled: boolean;
    label: string; // human name, e.g. "SODA"
    tally: string; // langTally key
    kind: string; // dim tag in the log line, e.g. "social dialogue"
    dataset: string;
    config: string;
    splits: string[];
    localDir: string; // subdirectory of LOCAL_PATH
    maxRows: number; // 0 = no budget
    toItems: (row: unknown) => TrainingItem[] | null;
  }): Promise<void> => {
    if (!opts.enabled) return;
    if (trainedContentBytes >= MAX_BYTES || stopRequested) return;

    let files: Array<
      { id: string; name: string; local?: string; url?: string }
    >;
    if (LOCAL_PATH) {
      const dir = join(LOCAL_PATH, opts.localDir);
      let names: string[] = [];
      try {
        names = readdirSync(dir).filter((f: string) => /\.parquet$/i.test(f))
          .sort();
      } catch { /* no local dir for this stage */ }
      if (names.length === 0) {
        progress.log(
          `  ${DIM}· no ${opts.label} *.parquet in ${dir} — skipping${R}`,
        );
        return;
      }
      files = names.map((f: string) => ({
        id: `${opts.tally}::${f}`,
        name: f,
        local: join(dir, f),
      }));
    } else {
      let paths: string[];
      try {
        paths = await listConvertedParquet(
          opts.dataset,
          opts.config,
          opts.splits,
          opts.label,
        );
      } catch (e) {
        if (stopRequested || (e as Error)?.name === "AbortError") return;
        progress.log(
          `  ${RED}✗${R} ${opts.label} file listing failed: ${
            (e as Error).message
          }`,
        );
        return;
      }
      files = paths.map((path) => ({
        id: `${opts.tally}::${path}`,
        name: path,
        url: `https://huggingface.co/datasets/${opts.dataset}` +
          `/resolve/refs%2Fconvert%2Fparquet/${path}`,
      }));
    }
    if (files.length === 0) {
      progress.log(`  ${DIM}· no ${opts.label} files found — skipping${R}`);
      return;
    }

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
    const budgetMark = opts.maxRows > 0
      ? `${opts.tally}::budget=${opts.maxRows}`
      : "";
    if (budgetMark && done.has(budgetMark)) {
      progress.log(
        `  ${DIM}· ${opts.label} budget of ${
          int(opts.maxRows)
        } row(s) already met — skipping${R}`,
      );
      return;
    }
    const remaining = files.filter((f) => !done.has(f.id));
    if (remaining.length === 0) {
      progress.log(`  ${DIM}· ${opts.label} already trained — skipping${R}`);
      return;
    }
    state.fileTotal = files.length;
    progress.log(
      `  ${GRN}✓${R} ${opts.label}: ${remaining.length}/${files.length} shard(s) to train` +
        (opts.maxRows > 0
          ? ` ${DIM}(budget ${int(opts.maxRows)} rows)${R}`
          : ""),
    );

    // The budget spans the whole stage, not one shard, so it is counted here.
    let rowsTaken = 0;
    const spent = () => opts.maxRows > 0 && rowsTaken >= opts.maxRows;
    const budgeted = (row: unknown): TrainingItem[] | null => {
      const items = opts.toItems(row);
      if (!items || items.length === 0) return null;
      rowsTaken++;
      return items;
    };

    let idx = 0;
    for (const f of files) {
      if (trainedContentBytes >= MAX_BYTES || stopRequested) break;
      if (opts.maxRows > 0 && rowsTaken >= opts.maxRows) break;
      idx++;
      if (done.has(f.id)) continue;

      let path = f.local ?? "";
      let downloaded = false;
      if (!path) {
        const got = await acquire(
          f.url!,
          f.id.replace(/[^A-Za-z0-9._-]+/g, "_"),
          `${opts.label} ${f.name}`,
        );
        if (!got) {
          if (stopRequested) break;
          continue; // a single failed shard never aborts the stage
        }
        path = got;
        downloaded = true;
      }

      try {
        totalCorpusBytes += statSync(path).size;
      } catch { /* best effort */ }

      state.activity = "process";
      state.fileIndex = idx;
      state.filePath = `${opts.label} ${f.name}`;
      state.fileExamples = 0;
      tick(true);
      const p0 = Date.now();
      const before = rowsTaken;
      let res: FileResult;
      try {
        res = await processParquet(
          path,
          budgeted,
          ci,
          onDeposit,
          sample,
          spent,
        );
      } catch (e) {
        if (stopRequested || (e as Error)?.name === "AbortError") break;
        progress.log(
          `  ${RED}✗${R} ${opts.label} ${f.name} parse failed: ${
            (e as Error).message
          }`,
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
      langTally[opts.tally] = (langTally[opts.tally] ?? 0) + res.examples;
      progress.log(
        `  ${GRN}✓${R} ${f.name} ${DIM}[${opts.kind}]${R} → ${
          int(res.examples)
        } facts ${DIM}from ${int(rowsTaken - before)} row(s) in ${
          dur((Date.now() - p0) / 1000)
        }${R}` +
          (res.skipped
            ? ` ${YEL}· ${int(res.skipped)} unusable row(s) skipped${R}`
            : "") +
          (hitBudget
            ? ` ${YEL}(budget reached)${R}`
            : res.stopped
            ? ` ${YEL}(stopped early)${R}`
            : ""),
      );

      if (!res.stopped && !hitBudget) {
        try {
          totalBytesProcessed += statSync(path).size;
        } catch { /* best effort */ }
        if (downloaded) {
          try {
            unlinkSync(path);
          } catch { /* best effort */ }
        }
        done.add(f.id);
        p.completedFiles.push(f.id);
      }
      try {
        await saveProgress(store, {
          completedFiles: p.completedFiles,
          depositCount,
          trainedContentBytes,
          totalBytesProcessed,
          totalCorpusBytes,
        });
        await store.setMeta("train.langTally", JSON.stringify(langTally));
      } catch { /* best effort — finish() will retry */ }
      // A budget stop is not a cap/signal stop: the stage is finished, so fall
      // out of the loop rather than treating it as an interruption.
      if (res.stopped && !hitBudget) break;
    }

    // Record a satisfied budget so the next run skips this stage instead of
    // re-reading it. Only when the budget was actually reached: a stage that
    // ran out of shards first is complete by the normal per-shard rule, and a
    // stage cut short by MAX_MB or Ctrl+C must stay resumable.
    if (budgetMark && spent() && !stopRequested && !done.has(budgetMark)) {
      p.completedFiles.push(budgetMark);
      try {
        await saveProgress(store, {
          completedFiles: p.completedFiles,
          depositCount,
          trainedContentBytes,
          totalBytesProcessed,
          totalCorpusBytes,
        });
      } catch { /* best effort — finish() will retry */ }
    }
  };

  const trainSoda = (): Promise<void> =>
    runConvertedParquetStage({
      enabled: SODA,
      label: "SODA",
      tally: "soda",
      kind: "social dialogue",
      dataset: SODA_DATASET,
      config: "default",
      splits: SODA_SPLITS,
      localDir: "soda",
      maxRows: SODA_MAX_DIALOGS,
      toItems: (row) => {
        const turns = toSodaTurns(row);
        if (!turns) return null;
        const items = sodaDialogueToItems(turns);
        return items.length ? items : null;
      },
    });

  const trainMassive = (): Promise<void> =>
    runConvertedParquetStage({
      enabled: MASSIVE,
      label: "MASSIVE",
      tally: "massive",
      kind: "short intents",
      dataset: MASSIVE_DATASET,
      config: MASSIVE_CONFIG,
      splits: MASSIVE_SPLITS,
      localDir: "massive",
      maxRows: MASSIVE_MAX_ROWS,
      toItems: (row) => {
        const items = massiveRowToItems(row);
        return items.length ? items : null;
      },
    });

  const trainGenKnow = async (): Promise<void> => {
    if (!GENKNOW) return;
    if (trainedContentBytes >= MAX_BYTES || stopRequested) return;

    const p = await loadProgress(store);
    if (p.completedFiles.includes(GENKNOW_ID)) {
      progress.log(
        `  ${DIM}· General-Knowledge already trained — skipping${R}`,
      );
      return;
    }

    let path = "", downloaded = false;
    if (LOCAL_PATH) {
      const hit = readdirSync(LOCAL_PATH).find((f: string) =>
        /general.*knowledge.*\.json$/i.test(f) || /output\.json$/i.test(f)
      );
      if (!hit) {
        progress.log(
          `  ${DIM}· no General-Knowledge *.json in ${LOCAL_PATH} — skipping${R}`,
        );
        return;
      }
      path = join(LOCAL_PATH, hit);
    } else {
      const got = await acquire(
        GENKNOW_URL,
        "general_knowledge.json",
        "General-Knowledge",
      );
      if (!got) return;
      path = got;
      downloaded = true;
    }

    try {
      totalCorpusBytes += statSync(path).size;
    } catch { /* best effort */ }
    state.fileTotal = 1;
    state.fileIndex = 1;

    state.activity = "process";
    state.filePath = "General-Knowledge";
    state.fileExamples = 0;
    tick(true);
    const p0 = Date.now();
    let res: FileResult;
    try {
      res = await processJsonArray(path, genToItems, ci, onDeposit, sample);
    } catch (e) {
      if (stopRequested || (e as Error)?.name === "AbortError") return;
      progress.log(
        `  ${RED}✗${R} General-Knowledge processing failed: ${
          (e as Error).message
        }`,
      );
      return;
    }
    langTally["genknow"] = (langTally["genknow"] ?? 0) + res.examples;
    progress.log(
      `  ${GRN}✓${R} General-Knowledge ${DIM}[Q&A facts]${R} → ${
        int(res.examples)
      } facts ${DIM}in ${dur((Date.now() - p0) / 1000)}${R}` +
        (res.skipped
          ? ` ${YEL}· ${int(res.skipped)} unusable row(s) skipped${R}`
          : "") +
        (res.stopped ? ` ${YEL}(stopped early)${R}` : ""),
    );

    if (!res.stopped) {
      try {
        totalBytesProcessed += statSync(path).size;
      } catch { /* best effort */ }
      if (downloaded) {
        try {
          unlinkSync(path);
        } catch { /* best effort */ }
      }
      p.completedFiles.push(GENKNOW_ID);
    }
    try {
      await saveProgress(store, {
        completedFiles: p.completedFiles,
        depositCount,
        trainedContentBytes,
        totalBytesProcessed,
        totalCorpusBytes,
      });
      await store.setMeta("train.langTally", JSON.stringify(langTally));
    } catch { /* best effort — finish() will retry */ }
  };

  // ── §10  Train the curriculum (resume-aware; one store records all stages) ──
  //
  // Every source is paged from an HTTP API (SmolSent, Aya) or a single
  // downloaded file (oasst2) — there is no per-file ZIP loop. Each stage closure
  // reads the authoritative completed-set from the store, skips itself when
  // already done, and persists its own progress, so the whole curriculum resumes
  // from the store alone. LOCAL_PATH lets oasst2 read a local *.jsonl.gz.
  tick(true);

  // ── resume — restore counters and the per-source tally from the store ──
  const prog = await loadProgress(store);
  depositCount = prog.depositCount;
  trainedContentBytes = prog.trainedContentBytes;
  totalBytesProcessed = prog.totalBytesProcessed;
  totalCorpusBytes = prog.totalCorpusBytes;
  rateTrained = trainedContentBytes;
  rateBytes = totalBytesProcessed;
  try {
    const t = await store.getMeta("train.langTally");
    if (t) {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          langTally[k] = Number(v) || 0;
        }
      }
    }
  } catch { /* fresh tally */ }
  if (prog.completedFiles.length > 0) {
    progress.log(
      `  ${CYAN}↻${R} resuming: ${prog.completedFiles.length} stage-unit(s) done, ` +
        `${int(depositCount)} examples, ${bytes(trainedContentBytes)} learned`,
    );
  }

  // Stage 1 (SmolSent translation facts), 2 (Aya multilingual chat), 3 (oasst2
  // multi-turn), 4 (General-Knowledge Q&A facts). Each is skipped on a resume
  // that already finished it.
  if (!stopRequested) await trainSmolSent();
  if (!stopRequested) await trainAya();
  if (!stopRequested) await trainOasst();
  if (!stopRequested) await trainTaskmaster();
  if (!stopRequested) await trainWiki2();
  if (!stopRequested) await trainSoda();
  if (!stopRequested) await trainMassive();
  if (!stopRequested) await trainGenKnow();

  await finish(stopRequested ? stopReason : "done");
}

// ═══════════════════════════════════════════════════════════════════════
// §11  Entry point — only run when invoked directly, so importing the parser
//       functions above (e.g. for tests) never starts training.
// ═══════════════════════════════════════════════════════════════════════

const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("train_base.js");
if (isMain) {
  main().catch((e) => {
    process.stderr.write(SHOW);
    console.error(`\n${RED}fatal:${R}`, e);
    process.exit(1);
  });
}
