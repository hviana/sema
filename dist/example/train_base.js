//This file uses the Google SMOL dataset, made available under the CC BY 4.0 license.
//This file uses Aya and oasst2 datasets, made available under the apache-2.0 license.
//This file uses MuskumPillerum/General-Knowledge dataset, made available under the MIT license.
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
// The curriculum runs in four stages, into ONE store:
//   1. SmolSent (google/smol) — sentence-level TRANSLATION pairs across 100+
//      low-resource languages; see §6c. Each pair is "two names for one meaning"
//      → bidirectional translation FACTS, the cross-language concept SEMA fuses
//      (cf. test/05-concepts.test.mjs).
//   2. Aya Dataset — ~204k human prompt→completion pairs, 70+ languages; see §6d
//      → one (question → answer) FACT each.
//   3. oasst2 — MULTI-TURN human↔assistant conversation trees; see §6e → the
//      accumulated-context walk (single-turn trees are skipped, by design).
//   4. General-Knowledge (MuskumPillerum) — ~37.6k {Question, Answer} pairs; see
//      §6f → one (question → answer) FACT each.
// Each stage runs only after the previous one finishes, and is recorded in the
// same completed-files set, so a single store resumes the whole curriculum.
//
// Every source is DOWNLOADED as a file and streamed from disk (never paged
// row-by-row over an HTTP API — that was slow and rate-limited): SmolSent as
// per-pair JSONL, oasst2 as a gzipped JSONL, General-Knowledge as a JSON array,
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
//   SMOLSENT=0 node dist/example/train_base.js           # skip SmolSent stage
//   AYA=0 node dist/example/train_base.js                # skip Aya stage
//   AYA_SPLIT=test node dist/example/train_base.js       # small Aya slice
//   OASST=0 node dist/example/train_base.js              # skip oasst2 stage
//   OASST_MIN_TURNS=6 node dist/example/train_base.js    # deeper multi-turn only
//   GENKNOW=0 node dist/example/train_base.js            # skip General-Knowledge
//   LOCAL_PATH=./base node dist/example/train_base.js    # offline: *.jsonl/.parquet/.jsonl.gz/.json
//   DB_PATH=./data/sema node dist/example/train_base.js
import { CachedIngest, Mind, SQliteStore } from "../src/index.js";
// One Node module — node:fs — and nothing else. Everything else (HTTP, byte
// streams, (de)compression, text decoding, cancellation) is a web standard:
// fetch, WHATWG ReadableStream/WritableStream/TransformStream,
// DecompressionStream, TextDecoderStream, Blob, AbortController. Reading a file
// goes through openAsBlob, which returns a web Blob (`.stream()` → web streams);
// writing a file is the single capability the web platform does not expose, so
// the download sink uses the synchronous fs descriptor calls below. The durable
// disk cache is therefore the sole, irreducible Node dependency.
import { closeSync, existsSync, fsyncSync, mkdirSync, openAsBlob, openSync, readdirSync, renameSync, statSync, unlinkSync, writeSync, } from "node:fs";
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
const env = (k, d) => process.env[k] ?? d;
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
// A SmolSent side longer than this is skipped (a sentence pair is short; a huge
// value is corruption, not a sentence).
const MAX_SMOLSENT_CHARS = Math.max(2_000, Math.floor(Number(env("MAX_SMOLSENT_KB", "16")) * 1000) || 16_000);
const DB_PATH = env("DB_PATH", "sema"); // → {DB_PATH}.sqlite
const D = Number(env("D", "1024"));
const SEED = Number(env("SEED", "7"));
// Checkpoint cadence is measured in LEARNED CONTENT, not deposits: a snapshot
// every CHECKPOINT_MB megabytes of trained UTF-8 content (decimal MB, matching
// the bytes() helper). A floor of 1 MB: a zero/NaN value must not make every
// deposit checkpoint, nor silently disable checkpointing. The tail (a run that
// learns less than one interval, or the remainder past the last interval) is
// always saved by finish() at exit — a complete point.
const CHECKPOINT_BYTES = Math.max(1_000_000, Math.floor(Number(env("CHECKPOINT_MB", "100")) * 1_000_000) || 100_000_000);
const LOCAL_PATH = env("LOCAL_PATH", ""); // train from a local dir of *.zip
const CACHE_DIR = env("CACHE_DIR", join(process.cwd(), "cache"));
const MAX_CACHE_BYTES = Number(env("MAX_CACHE_GB", "100")) * 1e9;
const PROGRESS_MS = Number(env("PROGRESS_MS", "250")); // panel refresh cadence
// Index maintenance at checkpoints: compact (remove garbage) then repair (fill
// gaps). Both are idempotent batch operations; INDEX_MAINTENANCE=0 disables.
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
let onThrottleWait = null;
let lastThrottleLog = 0;
// Optional ceiling on how much LEARNED CONTENT to train, in megabytes (decimal,
// like CHECKPOINT_MB). Default Infinity = unbounded. The cap is checked against
// trainedContentBytes after each deposit, so a run stops at the first item that
// carries the running total to/past the ceiling (that item is still counted).
const MAX_MB = Number(env("MAX_MB", "Infinity"));
if (isNaN(MAX_MB) || MAX_MB < 0) {
    process.stderr.write(`fatal: MAX_MB must be a non-negative number or "Infinity"\n`);
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
const AYA_URL = env("AYA_URL", "https://huggingface.co/datasets/CohereLabs/aya_dataset/resolve/main/data/train-00000-of-00001.parquet");
// The resume id of the Aya stage, kept in the same completed-files set as the
// other stages, so one store records the whole curriculum.
const AYA_ID = "aya::dataset";
// A single Aya field this many chars or longer is skipped: inputs/targets range
// up to ~3.3M chars, and a multi-MB "pair" is documentation/dump noise, not a
// cognitive example.
const MAX_AYA_FIELD_CHARS = Math.max(10_000, Math.floor(Number(env("MAX_AYA_FIELD_KB", "256")) * 1000) || 256_000);
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
const OASST_URL = env("OASST_URL", "https://huggingface.co/datasets/OpenAssistant/oasst2/resolve/main/2023-11-05_oasst2_ready.trees.jsonl.gz");
// The resume id of the oasst2 stage, in the same completed-files set as the
// other stages, so one store records the whole curriculum.
const OASST_ID = "oasst2::trees";
// Multi-turn threshold: a conversation must have at least this many turns to be
// trained (4 = user→assistant→user→assistant, the smallest real multi-turn).
const OASST_MIN_TURNS = Math.max(2, Math.floor(Number(env("OASST_MIN_TURNS", "4"))) || 4);
// Skip a tree whose decoded JSON line exceeds this (a pathological record); the
// real maximum is far smaller, so this only guards against corruption.
const MAX_OASST_LINE_CHARS = Math.max(100_000, Math.floor(Number(env("MAX_OASST_LINE_MB", "8")) * 1_000_000) || 8_000_000);
// ── MuskumPillerum/General-Knowledge (the fourth training stage, after oasst2) ──
// A ~37.6k-row general-knowledge Q&A set: each row is a single {Question, Answer}
// pair. A row is a pure RELATION (question → answer), so it becomes exactly ONE
// FACT, identical in shape to the Aya stage. It ships as a single JSON array
// file (output.json); we DOWNLOAD it and stream the array. GENKNOW=0 disables
// the stage; GENKNOW_URL overrides the source.
const GENKNOW = env("GENKNOW", "1") !== "0";
const GENKNOW_URL = env("GENKNOW_URL", "https://huggingface.co/datasets/MuskumPillerum/General-Knowledge/resolve/main/output.json");
// The resume id of the General-Knowledge stage, in the same completed-files set
// as the other stages, so one store records the whole curriculum.
const GENKNOW_ID = "genknow::qa";
// A Question/Answer longer than this is skipped (answers run to a few hundred
// chars; this only guards against a corrupt/runaway field).
const MAX_GENKNOW_CHARS = Math.max(4_000, Math.floor(Number(env("MAX_GENKNOW_KB", "64")) * 1000) || 64_000);
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
const waitMs = (ms) => new Promise((resolve) => {
    if (shutdown.signal.aborted)
        return resolve();
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
function withTimeout(p, ms, label = "operation") {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            const e = new Error(`${label} timed out after ${ms}ms`);
            e.name = "TimeoutError";
            reject(e);
        }, ms);
        if (typeof t.unref === "function")
            t.unref();
        p.then((v) => {
            clearTimeout(t);
            resolve(v);
        }, (e) => {
            clearTimeout(t);
            reject(e);
        });
    });
}
/** Human-readable duration from seconds. */
function dur(seconds) {
    if (!isFinite(seconds) || seconds < 0)
        return "--";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0)
        return `${h}h ${m}m ${s}s`;
    if (m > 0)
        return `${m}m ${s}s`;
    return `${s}s`;
}
/** Human-readable byte size. */
function bytes(n) {
    if (!isFinite(n) || n < 0)
        return "--";
    if (n < 1024)
        return `${n} B`;
    if (n < 1e6)
        return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1e9)
        return `${(n / 1e6).toFixed(1)} MB`;
    return `${(n / 1e9).toFixed(2)} GB`;
}
/** Short count: 1234567 → "1.23M". */
function num(n) {
    if (n >= 1e9)
        return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6)
        return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3)
        return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
}
const int = (n) => Math.round(n).toLocaleString("en-US");
const clamp01 = (f) => Math.max(0, Math.min(1, f));
const pct = (f) => `${(clamp01(f) * 100).toFixed(1)}%`;
/** A progress bar of width `w` filled to fraction `frac`. */
function bar(w, frac) {
    const filled = Math.round(clamp01(frac) * w);
    return `${GRN}${"█".repeat(filled)}${GREY}${"░".repeat(w - filled)}${R}`;
}
/** Collapse whitespace and clip to `max` chars with an ellipsis. */
function clip(text, max) {
    const t = text.replace(/\s+/g, " ").trim();
    if (max < 1)
        return "";
    return t.length <= max ? t : t.slice(0, max - 1) + "…";
}
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
async function retry(label, fn, tries, onFail, onThrottle) {
    let wait = 1000, last = "", throttleWait = 1000, throttleHits = 0;
    for (let attempt = 1; attempt <= tries;) {
        if (shutdown.signal.aborted) {
            const e = new Error("aborted");
            e.fatal = true;
            throw e;
        }
        try {
            return await fn();
        }
        catch (e) {
            const err = e;
            if (err.name === "AbortError" || err.fatal)
                throw err;
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
function httpError(res) {
    const err = new Error(`HTTP ${res.status}`);
    if (res.status === 429 || res.status === 503) {
        err.throttle = true;
        const ra = res.headers.get("retry-after");
        if (ra) {
            const secs = Number(ra);
            if (Number.isFinite(secs))
                err.retryAfterMs = Math.max(0, secs * 1000);
            else {
                const when = Date.parse(ra);
                if (Number.isFinite(when)) {
                    err.retryAfterMs = Math.max(0, when - Date.now());
                }
            }
        }
    }
    else if (res.status < 500) {
        err.fatal = true; // genuine client error — do not retry
    } // other 5xx: neither fatal nor throttle → ordinary bounded retry
    return err;
}
/** GET a URL and parse JSON, with the shared retry policy: rate-limits (429/503)
 *  WAIT indefinitely (surfaced to the progress log via onThrottleWait, throttled
 *  to one notice every few seconds), other 4xx is fatal, other 5xx retried up to
 *  DOWNLOAD_TRIES. Used by every datasets-server API stage so all share the same
 *  never-drop-on-throttle behaviour. */
async function getJson(url, label) {
    return retry(label, async () => {
        const res = await fetch(url, { signal: shutdown.signal });
        if (res.ok)
            return res.json();
        throw httpError(res);
    }, DOWNLOAD_TRIES, undefined, (ms) => {
        const now = Date.now();
        if (onThrottleWait && now - lastThrottleLog > 3000) {
            lastThrottleLog = now;
            onThrottleWait(ms, label);
        }
    });
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
async function headSize(url) {
    return retry(`HEAD ${url}`, async () => {
        const res = await fetch(url, { method: "HEAD", signal: shutdown.signal });
        if (res.ok)
            return Number(res.headers.get("content-length")) || 0;
        throw httpError(res);
    }, 4);
}
function cacheSize() {
    if (!existsSync(CACHE_DIR))
        return 0;
    let total = 0;
    for (const name of readdirSync(CACHE_DIR)) {
        try {
            total += statSync(join(CACHE_DIR, name)).size;
        }
        catch { /* raced with a delete */ }
    }
    return total;
}
/** Block until there is room for a file of `fileBytes` under the ceiling.
 *  A single file larger than the whole ceiling can never "fit", so we let it
 *  through (it is deleted right after processing) rather than wait forever. */
async function ensureCacheRoom(fileBytes, warn) {
    mkdirSync(CACHE_DIR, { recursive: true });
    if (fileBytes >= MAX_CACHE_BYTES)
        return;
    let warned = false;
    // Stop waiting the moment a shutdown is requested — the abort signal unblocks
    // a long cache-full wait so Ctrl+C is never swallowed by the ceiling.
    while (!shutdown.signal.aborted && cacheSize() + fileBytes > MAX_CACHE_BYTES) {
        if (!warned) {
            warn?.(`${YEL}⚠${R} cache at ${(MAX_CACHE_BYTES / 1e9).toFixed(0)} GB ceiling — waiting for room…`);
            warned = true;
        }
        await waitMs(5_000);
    }
}
// ═══════════════════════════════════════════════════════════════════════
// §5  Download (streamed to disk, with retry + cleanup on failure)
// ═══════════════════════════════════════════════════════════════════════
async function downloadFile(url, destPath, tries = DOWNLOAD_TRIES, onFail, onProgress) {
    const partPath = destPath + PART_SUFFIX;
    await retry(`download ${basename(destPath)}`, async () => {
        // Abort promptly on shutdown rather than waiting out a slow socket.
        if (shutdown.signal.aborted) {
            const e = new Error("aborted");
            e.fatal = true;
            throw e;
        }
        const res = await fetch(url, { signal: shutdown.signal });
        if (!res.ok)
            throw httpError(res);
        if (!res.body)
            throw new Error("empty response body");
        const total = Number(res.headers.get("content-length")) || 0;
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
        const meter = new TransformStream({
            transform(chunk, controller) {
                done += chunk.length;
                onProgress?.(done, total);
                controller.enqueue(chunk);
            },
        });
        const fd = openSync(partPath, "w");
        let closed = false;
        const closeFd = () => {
            if (closed)
                return;
            closed = true;
            try {
                closeSync(fd);
            }
            catch { /* already closed */ }
        };
        const sink = new WritableStream({
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
        }
        catch (e) {
            // pipeTo's abort() ran the sink's abort() (closing the descriptor); if
            // it didn't (a non-abort throw), make sure the descriptor is not leaked.
            closeFd();
            try {
                unlinkSync(partPath);
            }
            catch { /* best effort */ }
            throw e;
        }
        // Optional integrity guard: when the server advertised a size, a complete
        // file must match it. A short read (silent truncation) is retried rather
        // than promoted, so the parser never sees a partial ZIP.
        try {
            const got = statSync(partPath).size;
            if (total > 0 && got !== total) {
                try {
                    unlinkSync(partPath);
                }
                catch { /* best effort */ }
                throw new Error(`size mismatch: got ${got}, expected ${total}`);
            }
        }
        catch (e) {
            if (e instanceof Error && e.message.startsWith("size mismatch")) {
                throw e;
            }
            // statSync failure is non-fatal here; the rename below will surface it.
        }
        // Atomic publish: rename is atomic within a filesystem, so the final path
        // flips from "absent" to "complete" in one step — never an in-between.
        renameSync(partPath, destPath);
    }, tries, onFail);
}
const isEpisode = (it) => typeof it !== "string";
/** Build the accumulated-context episodes of a turn sequence: each successive
 *  turn is the continuation of ALL the turns before it joined together. This is
 *  the same cumulative-context shape a multi-turn conversation deposits, so the
 *  store learns to continue a growing context. */
function accumulate(turns) {
    const out = [];
    for (let i = 1; i < turns.length; i++) {
        out.push({ context: turns.slice(0, i).join("\n"), continuation: turns[i] });
    }
    return out;
}
/** Dedup + trim a concept's items: drop empty/degenerate pairs and exact
 *  repeats so a concept never deposits the same form twice. */
export function refineItems(items) {
    const out = [];
    const seen = new Set();
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
        if (!ctx || !cont || ctx === cont)
            continue;
        const key = "P:" + ctx + "\u0000" + cont;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push({ context: ctx, continuation: cont });
    }
    return out;
}
/** Normalize a raw datasets-server row into a SmolSentRow, or null when it lacks
 *  both sides or a side is implausibly large (a dump, not a sentence). */
export function toSmolSentRow(row) {
    if (!row || typeof row !== "object")
        return null;
    const r = row;
    const src = typeof r.src === "string" ? r.src.trim() : "";
    // `trg` is a single string in smolsent; tolerate a list form defensively.
    const trgRaw = Array.isArray(r.trgs) ? r.trgs[0] : r.trg;
    const trg = typeof trgRaw === "string" ? trgRaw.trim() : "";
    if (!src || !trg)
        return null;
    if (src.length > MAX_SMOLSENT_CHARS || trg.length > MAX_SMOLSENT_CHARS)
        return null;
    const sl = typeof r.sl === "string" ? r.sl.trim() : "";
    const tl = typeof r.tl === "string" ? r.tl.trim() : "";
    return { src, trg, sl, tl };
}
/** Translate ONE SmolSent pair into SEMA facts: the two sentences are one
 *  meaning in two languages, so bind them BOTH ways. refineItems drops the
 *  degenerate case where src === trg. */
export function smolSentRowToItems(row) {
    const { src, trg } = row;
    return refineItems([
        { context: src, continuation: trg },
        { context: trg, continuation: src },
    ]);
}
/** Normalize a raw datasets-server row object into an AyaRow, or null when it
 *  lacks a usable prompt/answer or a field is implausibly large (a dump, not a
 *  cognitive example). Trims surrounding whitespace; keeps inner text verbatim
 *  (human prose, possibly multi-paragraph). */
export function toAyaRow(row) {
    if (!row || typeof row !== "object")
        return null;
    const r = row;
    const inputs = typeof r.inputs === "string" ? r.inputs.trim() : "";
    const targets = typeof r.targets === "string" ? r.targets.trim() : "";
    if (!inputs || !targets)
        return null;
    if (inputs.length > MAX_AYA_FIELD_CHARS || targets.length > MAX_AYA_FIELD_CHARS)
        return null;
    const language = typeof r.language === "string" ? r.language.trim() : "";
    return { inputs, targets, language };
}
/** Translate ONE Aya row into SEMA training items. A row is a single human
 *  (question → answer) exchange — exactly one FACT, the (inputs → targets) edge.
 *  No standalone-answer experience and no one-exchange "cumulative" walk: a lone
 *  Q→A is not multi-turn, and both would only replicate the same edge. */
export function ayaRowToItems(row) {
    const { inputs, targets } = row;
    return refineItems([{ context: inputs, continuation: targets }]);
}
/** Collapse a conversation tree to ONE linear path: at each node, descend into
 *  its best-ranked, non-deleted reply (rank 0 preferred; unranked sorts last).
 *  Returns the ordered turns (already strictly alternating in this corpus). */
export function bestOasstPath(root) {
    const turns = [];
    let node = root;
    while (node) {
        const text = typeof node.text === "string" ? node.text.trim() : "";
        if (text)
            turns.push({ role: String(node.role ?? "?"), text });
        const live = (node.replies ?? []).filter((r) => r && !r.deleted && typeof r.text === "string" && r.text.trim() !== "");
        if (live.length === 0)
            break;
        live.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
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
 *  The walk is byte-for-byte the pattern proven in test/13-conversation.test.mjs
 *  ("teachConversation"): each turn is the continuation of all prior turns joined
 *  by "\n", with BARE turn text — NO "User:/Assistant:" labels. Roles already
 *  alternate by position in an oasst2 best-path (the root is a prompter), so a
 *  label adds nothing the position does not, while a clean continuation matches
 *  the test's recall (predictNext queries bare prior turns) and lets a turn share
 *  its gist with the same text elsewhere (e.g. an Aya question stored bare).
 *
 *  Returns [] for a conversation below the multi-turn threshold, so callers can
 *  simply skip empties. */
export function oasstConversationToItems(turns) {
    if (turns.length < OASST_MIN_TURNS)
        return []; // not multi-turn — skip
    return refineItems(accumulate(turns.map((t) => t.text)));
}
/** Turn a source value into clean prose: decode the literal "\n"/"\t"/"\r"
 *  two-character escapes the source JSON left in the text, collapse the runs of
 *  whitespace that creates, and trim. */
function unescapePlain(s) {
    return s
        .replace(/\\r\\n|\\n|\\r/g, "\n")
        .replace(/\\t/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
/** Normalize a raw datasets-server row into a GenKnowRow, or null when it lacks
 *  a usable question/answer or a side is implausibly large (corruption). */
export function toGenKnowRow(row) {
    if (!row || typeof row !== "object")
        return null;
    const r = row;
    const question = typeof r.Question === "string"
        ? unescapePlain(r.Question)
        : "";
    const answer = typeof r.Answer === "string" ? unescapePlain(r.Answer) : "";
    if (!question || !answer)
        return null;
    if (question.length > MAX_GENKNOW_CHARS || answer.length > MAX_GENKNOW_CHARS)
        return null;
    return { question, answer };
}
/** Translate ONE General-Knowledge row into SEMA items: exactly one
 *  (question → answer) FACT. refineItems drops a degenerate question === answer. */
export function genKnowRowToItems(row) {
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
const itemBytes = (it) => isEpisode(it)
    ? ENC.encode(it.context).length + ENC.encode(it.continuation).length
    : ENC.encode(it).length;
async function ingestItems(ci, items, onItem, sample) {
    for (const it of items) {
        if (isEpisode(it))
            await ci.ingest(it.context, it.continuation);
        else
            await ci.ingest(it);
        sample?.(it);
        if (!(await onItem(itemBytes(it))))
            return false; // stop requested
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
async function processOasst(filePath, ci, onExample, sample) {
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
    const processLine = async (line) => {
        if (!line.trim())
            return true;
        let tree;
        try {
            tree = JSON.parse(line);
        }
        catch {
            skipped++;
            return true;
        }
        if (!tree.prompt)
            return true;
        const turns = bestOasstPath(tree.prompt);
        const items = oasstConversationToItems(turns); // [] when not multi-turn
        if (items.length === 0)
            return true; // single-turn / empty — skipped
        multi++;
        return ingestItems(ci, items, async (contentBytes) => {
            examples++;
            return onExample(contentBytes);
        }, sample);
    };
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            let chunk = value;
            for (;;) {
                const nl = chunk.indexOf("\n");
                if (nl < 0) {
                    if (!droppingLine) {
                        if (leftover.length + chunk.length > MAX_OASST_LINE_CHARS) {
                            leftover = "";
                            droppingLine = true;
                            skipped++;
                        }
                        else
                            leftover += chunk;
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
    }
    finally {
        try {
            reader.releaseLock();
        }
        catch { /* best effort */ }
    }
}
/** Discover the SmolSent per-pair JSONL files from the HF repo tree, restricted
 *  to SMOLSENT_PAIRS (basenames without .jsonl) when set. Each entry is the
 *  repo-relative path, e.g. "smolsent/ha_en.jsonl". */
async function listSmolSentFiles() {
    // The dataset id ("owner/name") is a PATH here, so its "/" must not be
    // percent-encoded. `recursive=true` returns every file under smolsent/.
    const url = `https://huggingface.co/api/datasets/${SMOLSENT_DATASET}` +
        `/tree/main/smolsent?recursive=true`;
    const body = await getJson(url, `GET smol tree`);
    const paths = Array.isArray(body)
        ? body
            .filter((e) => e?.type === "file" && /\.jsonl$/i.test(e?.path))
            .map((e) => String(e.path))
        : [];
    paths.sort();
    if (!SMOLSENT_PAIRS.length)
        return paths;
    const want = new Set(SMOLSENT_PAIRS.map((p) => p.replace(/\.jsonl$/i, "")));
    return paths.filter((p) => want.has(basename(p).replace(/\.jsonl$/i, "")));
}
/** Stream a plain-JSONL file from disk, deposit each parsed row via `toItems`.
 *  Lines are split without buffering the whole file; an oversize/malformed line
 *  is counted skipped and the stream continues. Shared by SmolSent (and any
 *  future JSONL source). */
async function processJsonl(filePath, toItems, ci, onExample, sample, maxLineChars) {
    const blob = await openAsBlob(filePath);
    const reader = blob.stream().pipeThrough(new TextDecoderStream()).getReader();
    let examples = 0, skipped = 0, leftover = "", dropping = false;
    const processLine = async (line) => {
        if (!line.trim())
            return true;
        let row;
        try {
            row = JSON.parse(line);
        }
        catch {
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
            if (done)
                break;
            let chunk = value;
            for (;;) {
                const nl = chunk.indexOf("\n");
                if (nl < 0) {
                    if (!dropping) {
                        if (leftover.length + chunk.length > maxLineChars) {
                            leftover = "";
                            dropping = true;
                            skipped++;
                        }
                        else
                            leftover += chunk;
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
    }
    finally {
        try {
            reader.releaseLock();
        }
        catch { /* best effort */ }
    }
}
/** Read a downloaded Parquet file row-group by row-group with hyparquet (+Snappy
 *  from hyparquet-compressors) over a web-standard Blob byte source, depositing
 *  each row via `toItems`. Only one row-group is materialised at a time, so a
 *  multi-hundred-MB file never loads whole into memory. */
async function processParquet(filePath, toItems, ci, onExample, sample) {
    const blob = await openAsBlob(filePath);
    const file = {
        byteLength: blob.size,
        slice: async (start, end) => await blob.slice(start, end ?? blob.size).arrayBuffer(),
    };
    const meta = await parquetMetadataAsync(file);
    let examples = 0, skipped = 0;
    let rowStart = 0;
    for (const rg of meta.row_groups) {
        if (shutdown.signal.aborted)
            return { examples, stopped: true, skipped };
        const rgRows = Number(rg.num_rows);
        const rowEnd = rowStart + rgRows;
        // Materialise exactly one row-group, then deposit its rows.
        const rows = await parquetReadObjects({
            file,
            compressors,
            rowStart,
            rowEnd,
        });
        rowStart = rowEnd;
        for (const row of rows) {
            const items = toItems(row);
            if (!items || items.length === 0) {
                skipped++;
                continue;
            }
            const ok = await ingestItems(ci, items, async (contentBytes) => {
                examples++;
                return onExample(contentBytes);
            }, sample);
            if (!ok)
                return { examples, stopped: true, skipped };
        }
    }
    return { examples, stopped: false, skipped };
}
/** Read a downloaded JSON-array file (General-Knowledge output.json) and deposit
 *  each element via `toItems`. The array is small enough (~16 MB) to parse whole;
 *  a huge file would be rejected by the cache ceiling long before this. */
async function processJsonArray(filePath, toItems, ci, onExample, sample) {
    const blob = await openAsBlob(filePath);
    let arr;
    try {
        arr = JSON.parse(await blob.text());
    }
    catch (e) {
        throw new Error(`invalid JSON: ${e.message}`);
    }
    const rows = Array.isArray(arr) ? arr : [];
    let examples = 0, skipped = 0;
    for (const row of rows) {
        if (shutdown.signal.aborted)
            return { examples, stopped: true, skipped };
        const items = toItems(row);
        if (!items || items.length === 0) {
            skipped++;
            continue;
        }
        const ok = await ingestItems(ci, items, async (contentBytes) => {
            examples++;
            return onExample(contentBytes);
        }, sample);
        if (!ok)
            return { examples, stopped: true, skipped };
    }
    return { examples, stopped: false, skipped };
}
/** A prompt/expected pair to display for an item. */
function promptOf(it) {
    return isEpisode(it)
        ? { prompt: it.context, expected: it.continuation, kind: "episode" }
        : { prompt: it.slice(0, 200), expected: null, kind: "experience" };
}
/** A coarse, honest similarity between an expected continuation and SEMA's
 *  recall. Both are normalized (lowercased, whitespace-collapsed) and compared
 *  by the longest shared leading run plus token overlap, so the verdict is a
 *  heuristic signal of recall quality rather than a brittle fixed-prefix test. */
function recallSimilarity(expected, response) {
    const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const a = norm(expected), b = norm(response);
    if (!a || !b)
        return 0;
    let lead = 0;
    const lim = Math.min(a.length, b.length);
    while (lead < lim && a[lead] === b[lead])
        lead++;
    const leadFrac = lead / Math.max(1, Math.min(a.length, b.length));
    const ta = new Set(a.split(" ")), tb = new Set(b.split(" "));
    let inter = 0;
    for (const w of ta)
        if (tb.has(w))
            inter++;
    const jac = inter / Math.max(1, ta.size + tb.size - inter);
    return Math.max(leadFrac, jac);
}
/** A framed recall sample. Pinned in the panel on a TTY (so the most recent
 *  example is always on screen) and logged once per checkpoint when piped. */
function renderInferenceBox(prompt, expected, response, kind, checkpointN) {
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
    let verdict;
    if (expected) {
        const sim = recallSimilarity(expected, response);
        const pctStr = `${Math.round(sim * 100)}%`;
        verdict = sim >= 0.6
            ? `${GRN}✓${R}  recall close to expected ${DIM}(~${pctStr} overlap)${R}`
            : sim >= 0.25
                ? `${YEL}△${R}  partial recall ${DIM}(~${pctStr} overlap)${R}`
                : `${RED}✗${R}  recall diverges ${DIM}(~${pctStr} overlap)${R}`;
    }
    else {
        verdict = `${DIM}·${R}  plain experience — no expected answer`;
    }
    lines.push(`${B}│${R}  ${verdict}`);
    lines.push(`${B}╰${"─".repeat(W)}╯${R}`);
    return lines.join("\n");
}
function renderPanel(s) {
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
            if (s.dlSpeed > 0)
                actText += ` ${DIM}@ ${bytes(s.dlSpeed)}/s${R}`;
        }
        else {
            actText = total > 0
                ? `downloading ${name} · ${bytes(total)}…`
                : `downloading ${name}…`;
        }
    }
    else if (s.activity === "process") {
        actIcon = `${GRN}✓${R}`;
        actText = `processing ${s.filePath} · ${int(s.fileExamples)} examples so far`;
    }
    const targetStr = targetKnown ? bytes(s.target) : "∞";
    const headExamples = targetKnown
        ? `${CYAN}${bytes(s.trainedBytes)}${R} / ${targetStr} learned ${DIM}·${R} ${int(s.exampleCount)} examples`
        : `${CYAN}${int(s.exampleCount)}${R} examples`;
    const corpusInfo = s.bytesTotal > 0
        ? `${B}📦${R} ${bytes(s.bytesDone)}/${bytes(s.bytesTotal)} (${pct(s.bytesDone / s.bytesTotal)})`
        : `${B}📦${R} ${bytes(s.bytesDone)} processed`;
    const fileInfo = s.fileTotal > 0
        ? `${B}🌐${R} ${s.fileIndex}/${s.fileTotal} (${pct(fileFrac)})`
        : `${B}🌐${R} ${s.fileIndex} languages`;
    const panel = [
        `${B}╭${R}${B} sema train${R} ${DIM}·${R} SmolSent+Aya+oasst2 ${DIM}·${R} ` +
            `D=${D} ${DIM}·${R} seed=${SEED} ${DIM}·${R} ` +
            `store=${basename(DB_PATH)}.sqlite\n${B}╰${R} target=${CYAN}${targetStr}${R} ` +
            `learned ${DIM}·${R} checkpoint every ${bytes(CHECKPOINT_BYTES)}`,
        `\n${bar(40, frac)}  ${B}${pct(frac)}${R}  ${headExamples}`,
        `\n${B}⚡${R} ${bytes(s.trainedRate)}/s learned  ${B}🧠${R} ${bytes(s.trainedBytes)} content  ${B}⏱${R} ${dur(s.elapsedS)} elapsed  ${B}🕐${R} ${etaStr} ETA`,
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
    lines = 0; // height of the panel currently on screen
    lastPaint = 0;
    lastStatus = 0;
    last = null;
    tty = process.stderr.isTTY === true;
    /** True when attached to an interactive terminal (panel is live). */
    get interactive() {
        return this.tty;
    }
    /** Cursor sequence that returns to the top of the panel and clears it. */
    clearPanel() {
        if (this.lines <= 0)
            return "";
        const up = this.lines - 1; // cursor is on the panel's last line
        return (up > 0 ? `${CSI}${up}F` : "\r") + `${CSI}0J`;
    }
    render(s, force = false) {
        this.last = s;
        const now = Date.now();
        if (!force && now - this.lastPaint < PROGRESS_MS)
            return;
        this.lastPaint = now;
        if (!this.tty) {
            if (force || now - this.lastStatus >= 10_000) {
                this.lastStatus = now;
                const targetKnown = isFinite(s.target);
                const where = s.bytesTotal > 0
                    ? ` ${pct(s.bytesDone / s.bytesTotal)} of corpus`
                    : "";
                process.stderr.write(`[sema] ${bytes(s.trainedBytes)}${targetKnown ? "/" + bytes(s.target) : ""} learned · ${int(s.exampleCount)} examples · ` +
                    `${bytes(s.trainedRate)}/s · lang ${s.fileIndex}/${s.fileTotal}${where} · ` +
                    `${num(s.storeEntries)} entries\n`);
            }
            return;
        }
        const text = renderPanel(s);
        process.stderr.write(`${this.clearPanel()}${HIDE}${text}`);
        this.lines = text.split("\n").length;
    }
    /** Emit a line (or block) into the scrollback above the panel; the panel is
     *  redrawn immediately beneath it so it never disappears between frames. */
    log(msg) {
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
    dispose() {
        if (this.tty)
            process.stderr.write(`${SHOW}\n`);
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
async function loadProgress(store) {
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
    }
    catch { /* corrupt/missing — start fresh */ }
    return {
        completedFiles: [],
        depositCount: 0,
        trainedContentBytes: 0,
        totalBytesProcessed: 0,
        totalCorpusBytes: 0,
    };
}
async function saveProgress(store, p) {
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
async function main() {
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
            process.stderr.write(`  warmed vector caches: ${num(warmed)} rows in ${dur((Date.now() - t) / 1000)}\n`);
        }
    }
    const ci = new CachedIngest(mind);
    const prevD = await store.getMeta("train.D");
    const prevSeed = await store.getMeta("train.seed");
    if ((prevD && Number(prevD) !== D) || (prevSeed && Number(prevSeed) !== SEED)) {
        process.stderr.write(`fatal: D/SEED changed (store has D=${prevD} seed=${prevSeed}, ` +
            `requested D=${D} seed=${SEED}). Delete ${DB_PATH}.sqlite ` +
            `to start fresh.\n`);
        process.exit(1);
    }
    await store.setMeta("train.dataset", "SmolSent+Aya+oasst2");
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
    const langTally = {};
    const t0 = Date.now();
    // Reservoir sample: one uniformly-random item from the current window, shown
    // in the recall box at each checkpoint.
    let sampleItem = null;
    let seenInWindow = 0;
    const sample = (it) => {
        seenInWindow++;
        if (Math.random() < 1 / seenInWindow)
            sampleItem = it;
    };
    // ── progress panel ──
    const progress = new Progress();
    // Surface rate-limit waits from the low-level fetch retries into the live log,
    // so a 429 back-off reads as "waiting", never a silent hang or a dropped file.
    onThrottleWait = (ms, label) => {
        progress.log(`  ${YEL}⏳${R} rate-limited (${label}); waiting ${(ms / 1000).toFixed(1)}s and retrying — not skipping`);
    };
    const state = {
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
        if (sizeInFlight)
            return;
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
    let dlSlot = null;
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
        }
        else {
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
    if (typeof paintTimer.unref === "function")
        paintTimer.unref();
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
    const keepAlive = setInterval(() => { }, 1 << 30);
    const checkpoint = () => mind.save();
    /** Run index maintenance: compact (remove garbage) then repair (fill gaps).
     *  Both are idempotent — running twice produces the same result as once.
     *  Compaction frees index space first; repair then adds back the bridges
     *  whose gists were evicted before indexing, completing the coverage that
     *  incremental bridge promotion alone cannot guarantee.
     *
     *  Logs the number of entries removed/added so a run that silently degrades
     *  (growing compaction count, or repair never recovering anything) is
     *  visible in the training log. */
    const runIndexMaintenance = async () => {
        if (!INDEX_MAINTENANCE)
            return;
        try {
            const removed = await mind.store.compactContentIndex();
            if (removed > 0) {
                progress.log(`  ${DIM}index compact: removed ${int(removed)} isolated entries${R}`);
            }
        }
        catch (err) {
            progress.log(`  ${YEL}⚠ index compact failed${R}: ${err instanceof Error ? err.message : String(err)}`);
        }
        try {
            const added = await mind.repairContentIndex();
            if (added > 0) {
                progress.log(`  ${GRN}index repair: added ${int(added)} missing bridges${R}`);
            }
        }
        catch (err) {
            progress.log(`  ${YEL}⚠ index repair failed${R}: ${err instanceof Error ? err.message : String(err)}`);
        }
    };
    // The checkpoint recall is a best-effort diagnostic. It is time-bounded so a
    // slow/large store can never freeze the deposit loop, and guarded so a still
    // running recall is never stacked on top of another.
    let inferBusy = false;
    const runRecall = async (item, n) => {
        if (inferBusy)
            return;
        inferBusy = true;
        try {
            const info = promptOf(item);
            const r = await withTimeout(mind.respond(info.prompt), INFER_TIMEOUT_MS, "recall");
            const resp = new TextDecoder().decode(r.bytes).replace(/\u0000+/g, "");
            const box = renderInferenceBox(info.prompt, info.expected, resp, info.kind, n);
            state.lastSample = box;
            if (!progress.interactive)
                progress.log(box);
            tick(true);
        }
        catch (err) {
            progress.log(`  ${DIM}· checkpoint #${n} recall skipped: ${err instanceof Error ? err.message : String(err)}${R}`);
        }
        finally {
            inferBusy = false;
        }
    };
    // ── graceful shutdown (always leaves the store consistent) ──
    let stopRequested = false;
    let stopReason = "interrupted";
    let finishing = false;
    const finish = async (why) => {
        if (finishing)
            return;
        finishing = true;
        shutdown.abort(); // unblock any straggling fetch/pipeTo
        tick(true);
        await store.setMeta("train.completedAt", new Date().toISOString());
        await store.setMeta("train.totalDeposits", String(depositCount));
        await store.setMeta("train.totalTrainedBytes", String(trainedContentBytes));
        await store.setMeta("train.totalBytes", String(totalBytesProcessed));
        await store.setMeta("train.totalCorpusBytes", String(totalCorpusBytes));
        await store.setMeta("train.langTally", JSON.stringify(langTally));
        try {
            await runIndexMaintenance();
            await checkpoint();
        }
        catch (err) {
            process.stderr.write(`\n  ${YEL}⚠ final checkpoint failed${R}: ${err instanceof Error ? err.message : String(err)}\n`);
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
        }
        catch { /* best effort */ }
        console.log(`\n${GRN}✓${R} ${why}.  ${basename(DB_PATH)}.sqlite: ` +
            `${int(entries)} entries, ${int(depositCount)} examples, ` +
            `${bytes(trainedContentBytes)} content learned ` +
            `${DIM}(${bytes(avgRate)}/s avg)${R}, ` +
            `${bytes(totalBytesProcessed)} corpus processed, ${elapsed} elapsed.` +
            (tally ? `\n  ${DIM}per language:${R} ${tally}` : ""));
        try {
            await store.close();
        }
        catch { /* best effort */ }
        process.exit(0);
    };
    const requestStop = (reason) => {
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
            process.stderr.write(`\n${YEL}⚠ shutdown watchdog fired — forcing exit${R}\n`);
            process.stderr.write(SHOW);
            process.exit(130);
        }, 60_000);
        if (typeof watchdog.unref === "function")
            watchdog.unref();
    };
    process.on("SIGINT", () => requestStop("interrupted"));
    process.on("SIGTERM", () => requestStop("terminated"));
    // ── fail-safe: a dropped connection must never kill a long run ──
    process.on("unhandledRejection", (reason) => {
        progress.log(`  ${YEL}⚠ unhandled rejection${R}: ${reason instanceof Error ? reason.message : String(reason)}`);
    });
    process.on("uncaughtException", (err) => {
        const code = err?.code ?? err?.cause?.code;
        if (err.message === "terminated" || code === "UND_ERR_SOCKET") {
            progress.log(`  ${YEL}⚠ connection error (ignored)${R}: ${err.message}`);
            return;
        }
        process.stderr.write(`\n${RED}uncaught exception${R}: ${err.message}\n${err.stack ?? ""}\n`);
        try {
            void store.setMeta("train.crashedAt", new Date().toISOString());
            void store.setMeta("train.crashError", err.message);
            void store.setMeta("train.totalDeposits", String(depositCount));
        }
        catch { /* best effort */ }
        process.exit(1);
    });
    // ── per-example callback: gates MAX_MB, drives checkpoints + samples ──
    const onDeposit = async (contentBytes) => {
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
            if (item)
                await runRecall(item, n);
            try {
                await runIndexMaintenance();
                await checkpoint();
            }
            catch (err) {
                progress.log(`  ${YEL}⚠ checkpoint failed${R}: ${err instanceof Error ? err.message : String(err)}`);
            }
            tick(true);
        }
        else {
            tick();
        }
        // Stop AFTER the deposit is counted/displayed so the final item is never
        // lost from the totals. A pending signal stops at this same boundary, so a
        // clean shutdown and a MAX_MB cap unwind through identical, tested code.
        return !stopRequested && trainedContentBytes < MAX_BYTES;
    };
    const cacheWarn = (m) => progress.log(`  ${m}`);
    /** Acquire a source file: reuse a cached copy, else download `url` into the
     *  cache under `destName` (atomic, retried, rate-limit-tolerant, shows live
     *  byte progress). Returns the local path, or null on a non-abort failure
     *  (logged). `label` names the file in the panel/log. */
    const acquire = async (url, destName, label) => {
        const dest = join(CACHE_DIR, destName);
        if (existsSync(dest)) {
            progress.log(`  ${GRN}✓${R} ${label} ${DIM}(cached)${R}`);
            return dest;
        }
        let size = 0;
        try {
            size = await headSize(url);
        }
        catch { /* unknown — proceed without a cache-room reservation */ }
        state.activity = "download";
        state.filePath = label;
        state.fileSize = size;
        const slot = { done: 0, total: size, t0: Date.now() };
        dlSlot = slot;
        tick(true);
        try {
            await ensureCacheRoom(size, cacheWarn);
            slot.t0 = Date.now();
            await downloadFile(url, dest, DOWNLOAD_TRIES, (n, e) => progress.log(`  ${YEL}⚠${R} ${label} download attempt ${n}/${DOWNLOAD_TRIES}: ${e.message}`), (done, total) => {
                slot.done = done;
                if (total > 0)
                    slot.total = total;
            });
        }
        catch (e) {
            dlSlot = null;
            if (stopRequested || e?.name === "AbortError")
                return null;
            progress.log(`  ${RED}✗${R} ${label} download failed: ${e.message}`);
            try {
                unlinkSync(dest);
            }
            catch { /* best effort */ }
            return null;
        }
        dlSlot = null;
        const dlS = Math.max(0.001, (Date.now() - slot.t0) / 1000);
        const sz = statSync(dest).size;
        progress.log(`  ${CYAN}⬇${R} ${label} ${bytes(sz)} ${DIM}${dur(dlS)} @ ${bytes(sz / dlS)}/s${R}`);
        return dest;
    };
    // ── §10a  SmolSent stage (the FIRST stage) ──
    //
    // Downloads each SmolSent per-pair JSONL file and streams its lines. Resume is
    // per-file: a fully-consumed file is recorded in completedFiles
    // ("smolsent::<name>"); an interrupted file is re-streamed from the top on
    // resume (re-deposition is idempotent). LOCAL_PATH may hold pre-downloaded
    // smolsent *.jsonl files.
    const smolToItems = (row) => {
        const r = toSmolSentRow(row);
        return r ? smolSentRowToItems(r) : null;
    };
    const trainSmolSent = async () => {
        if (!SMOLSENT)
            return;
        if (trainedContentBytes >= MAX_BYTES || stopRequested)
            return;
        // Work-list: local *.jsonl in LOCAL_PATH, else the repo's smolsent/ files.
        let files;
        if (LOCAL_PATH) {
            files = readdirSync(LOCAL_PATH)
                .filter((f) => /\.jsonl$/i.test(f))
                .sort()
                .map((f) => ({
                id: `${SMOLSENT_ID}::${f}`,
                name: f,
                local: join(LOCAL_PATH, f),
            }));
            if (SMOLSENT_PAIRS.length) {
                const want = new Set(SMOLSENT_PAIRS.map((p) => p.replace(/\.jsonl$/i, "")));
                files = files.filter((f) => want.has(f.name.replace(/\.jsonl$/i, "")));
            }
        }
        else {
            let paths;
            try {
                paths = await listSmolSentFiles();
            }
            catch (e) {
                if (stopRequested || e?.name === "AbortError")
                    return;
                progress.log(`  ${RED}✗${R} SmolSent file listing failed: ${e.message}`);
                return;
            }
            files = paths.map((path) => ({
                id: `${SMOLSENT_ID}::${basename(path)}`,
                name: basename(path),
                // owner/name and the file path are URL PATH segments — do not encode "/".
                url: `https://huggingface.co/datasets/${SMOLSENT_DATASET}/resolve/main/${path}`,
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
        progress.log(`  ${GRN}✓${R} SmolSent: ${remaining.length}/${files.length} translation file(s) to train`);
        let idx = 0;
        for (const f of files) {
            if (trainedContentBytes >= MAX_BYTES || stopRequested)
                break;
            idx++;
            if (done.has(f.id))
                continue;
            // Acquire (download or reuse), then stream the JSONL.
            let path = f.local ?? "";
            let downloaded = false;
            if (!path) {
                const got = await acquire(f.url, f.id.replace(/[^A-Za-z0-9._-]+/g, "_"), `SmolSent ${f.name}`);
                if (!got) {
                    if (stopRequested)
                        break;
                    continue; // a single failed file never aborts the stage
                }
                path = got;
                downloaded = true;
            }
            // Accumulate known corpus bytes so the progress bar shows a
            // meaningful ETA — grows as each file's size is discovered.
            try {
                totalCorpusBytes += statSync(path).size;
            }
            catch { /* best effort */ }
            state.activity = "process";
            state.fileIndex = idx;
            state.filePath = `SmolSent ${f.name}`;
            state.fileExamples = 0;
            tick(true);
            const p0 = Date.now();
            let res;
            try {
                res = await processJsonl(path, smolToItems, ci, onDeposit, sample, MAX_SMOLSENT_CHARS * 4);
            }
            catch (e) {
                if (stopRequested || e?.name === "AbortError")
                    break;
                progress.log(`  ${RED}✗${R} SmolSent ${f.name} parse failed: ${e.message}`);
                if (downloaded) {
                    try {
                        unlinkSync(path);
                    }
                    catch { /* best effort */ }
                }
                continue;
            }
            langTally["smolsent"] = (langTally["smolsent"] ?? 0) + res.examples;
            progress.log(`  ${GRN}✓${R} ${f.name.replace(/\.jsonl$/i, "")} ${DIM}[translation]${R} → ${int(res.examples)} facts ${DIM}in ${dur((Date.now() - p0) / 1000)}${R}` +
                (res.skipped
                    ? ` ${YEL}· ${int(res.skipped)} unusable row(s) skipped${R}`
                    : "") +
                (res.stopped ? ` ${YEL}(stopped early)${R}` : ""));
            if (!res.stopped) {
                try {
                    totalBytesProcessed += statSync(path).size;
                }
                catch { /* best effort */ }
                if (downloaded) {
                    try {
                        unlinkSync(path);
                    }
                    catch { /* best effort */ }
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
            }
            catch { /* best effort — finish() will retry */ }
            if (res.stopped)
                break; // cap/signal — leave file un-completed for resume
        }
    };
    // ── §10b  Aya Dataset stage (runs AFTER SmolSent) ──
    //
    // Downloads the one train Parquet file and reads it row-group by row-group
    // (hyparquet + Snappy) — one (inputs → targets) fact per row. Marked complete
    // only when fully consumed; an interrupted run re-reads from the top on resume
    // (re-deposition is idempotent). LOCAL_PATH may hold a pre-downloaded *.parquet.
    const ayaToItems = (row) => {
        const r = toAyaRow(row);
        return r ? ayaRowToItems(r) : null;
    };
    const trainAya = async () => {
        if (!AYA)
            return;
        if (trainedContentBytes >= MAX_BYTES || stopRequested)
            return;
        const p = await loadProgress(store);
        if (p.completedFiles.includes(AYA_ID)) {
            progress.log(`  ${DIM}· Aya Dataset already trained — skipping${R}`);
            return;
        }
        let path = "", downloaded = false;
        if (LOCAL_PATH) {
            const hit = readdirSync(LOCAL_PATH).find((f) => /aya.*\.parquet$/i.test(f) || /\.parquet$/i.test(f));
            if (!hit) {
                progress.log(`  ${DIM}· no Aya *.parquet in ${LOCAL_PATH} — skipping${R}`);
                return;
            }
            path = join(LOCAL_PATH, hit);
        }
        else {
            const got = await acquire(AYA_URL, "aya_train.parquet", "Aya Dataset");
            if (!got)
                return;
            path = got;
            downloaded = true;
        }
        try {
            totalCorpusBytes += statSync(path).size;
        }
        catch { /* best effort */ }
        state.fileTotal = 1;
        state.fileIndex = 1;
        state.activity = "process";
        state.filePath = "Aya Dataset";
        state.fileExamples = 0;
        tick(true);
        const p0 = Date.now();
        let res;
        try {
            res = await processParquet(path, ayaToItems, ci, onDeposit, sample);
        }
        catch (e) {
            if (stopRequested || e?.name === "AbortError")
                return;
            progress.log(`  ${RED}✗${R} Aya processing failed: ${e.message}`);
            return;
        }
        langTally["aya"] = (langTally["aya"] ?? 0) + res.examples;
        progress.log(`  ${GRN}✓${R} Aya Dataset ${DIM}[multilingual chat]${R} → ${int(res.examples)} facts ${DIM}in ${dur((Date.now() - p0) / 1000)}${R}` +
            (res.skipped
                ? ` ${YEL}· ${int(res.skipped)} unusable row(s) skipped${R}`
                : "") +
            (res.stopped ? ` ${YEL}(stopped early)${R}` : ""));
        if (!res.stopped) {
            try {
                totalBytesProcessed += statSync(path).size;
            }
            catch { /* best effort */ }
            if (downloaded) {
                try {
                    unlinkSync(path);
                }
                catch { /* best effort */ }
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
        }
        catch { /* best effort — finish() will retry */ }
    };
    // ── §10c  oasst2 stage (multi-turn conversations; runs AFTER Aya; both modes) ──
    //
    // Resolves the source (a local *trees*.jsonl.gz in
    // LOCAL_PATH, else the gzip downloaded to the cache), streams it, and marks
    // OASST_ID complete only when fully consumed (an interrupted run re-streams
    // from the top; re-deposition is idempotent). Only multi-turn conversations
    // are deposited — single Q→A trees are skipped inside processOasst.
    const trainOasst = async () => {
        if (!OASST)
            return;
        if (trainedContentBytes >= MAX_BYTES || stopRequested)
            return;
        const p = await loadProgress(store);
        if (p.completedFiles.includes(OASST_ID)) {
            progress.log(`  ${DIM}· oasst2 already trained — skipping${R}`);
            return;
        }
        let gzPath = "";
        let downloaded = false;
        if (LOCAL_PATH) {
            const hit = readdirSync(LOCAL_PATH).find((f) => /oasst.*trees.*\.jsonl\.gz$/i.test(f) || /oasst.*\.jsonl\.gz$/i.test(f));
            if (!hit) {
                progress.log(`  ${DIM}· no oasst2 *trees*.jsonl.gz in ${LOCAL_PATH} — skipping${R}`);
                return;
            }
            gzPath = join(LOCAL_PATH, hit);
        }
        else {
            const dest = join(CACHE_DIR, "oasst2_ready.trees.jsonl.gz");
            if (existsSync(dest)) {
                gzPath = dest; // reuse a copy left by a previous interrupted run
                progress.log(`  ${GRN}✓${R} oasst2 trees ${DIM}(cached)${R}`);
            }
            else {
                let size = 0;
                try {
                    size = await headSize(OASST_URL);
                }
                catch { /* unknown — proceed without a cache-room reservation */ }
                state.activity = "download";
                state.filePath = "oasst2 trees";
                state.fileSize = size;
                const slot = { done: 0, total: size, t0: Date.now() };
                dlSlot = slot;
                tick(true);
                try {
                    await ensureCacheRoom(size, cacheWarn);
                    slot.t0 = Date.now();
                    await downloadFile(OASST_URL, dest, DOWNLOAD_TRIES, (n, e) => progress.log(`  ${YEL}⚠${R} oasst2 download attempt ${n}/${DOWNLOAD_TRIES}: ${e.message}`), (done, total) => {
                        slot.done = done;
                        if (total > 0)
                            slot.total = total;
                    });
                }
                catch (e) {
                    dlSlot = null;
                    if (stopRequested || e?.name === "AbortError")
                        return;
                    progress.log(`  ${RED}✗${R} oasst2 download failed: ${e.message}`);
                    try {
                        unlinkSync(dest);
                    }
                    catch { /* best effort */ }
                    return;
                }
                dlSlot = null;
                const dlS = Math.max(0.001, (Date.now() - slot.t0) / 1000);
                const sz = statSync(dest).size;
                progress.log(`  ${CYAN}⬇${R} oasst2 trees ${bytes(sz)} ` +
                    `${DIM}${dur(dlS)} @ ${bytes(sz / dlS)}/s${R}`);
                gzPath = dest;
                downloaded = true;
            }
        }
        try {
            totalCorpusBytes += statSync(gzPath).size;
        }
        catch { /* best effort */ }
        state.fileTotal = 1;
        state.fileIndex = 1;
        // Stream the trees.
        state.activity = "process";
        state.filePath = "oasst2 (multi-turn)";
        state.fileExamples = 0;
        tick(true);
        const p0 = Date.now();
        let result;
        try {
            result = await processOasst(gzPath, ci, onDeposit, sample);
        }
        catch (e) {
            if (stopRequested || e?.name === "AbortError")
                return;
            progress.log(`  ${RED}✗${R} oasst2 processing failed: ${e.message}`);
            return;
        }
        const { examples, stopped, skipped, multi } = result;
        langTally["oasst2"] = (langTally["oasst2"] ?? 0) + examples;
        progress.log(`  ${GRN}✓${R} oasst2 ${DIM}[multi-turn chat]${R} → ${int(examples)} examples from ${int(multi)} conversation(s) ${DIM}in ${dur((Date.now() - p0) / 1000)}${R}` +
            (skipped
                ? ` ${YEL}· ${int(skipped)} malformed line(s) skipped${R}`
                : "") +
            (stopped ? ` ${YEL}(stopped early)${R}` : ""));
        // Only mark complete (and reclaim the cache) when fully consumed.
        if (!stopped) {
            try {
                totalBytesProcessed += statSync(gzPath).size;
            }
            catch { /* best effort */ }
            if (downloaded) {
                try {
                    unlinkSync(gzPath);
                }
                catch { /* best effort */ }
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
        }
        catch { /* best effort — finish() will retry */ }
    };
    // ── §10d  General-Knowledge stage (runs AFTER oasst2) ──
    //
    // Downloads the single JSON-array file (output.json) and deposits each
    // {Question, Answer} as one fact. Marked complete only when fully consumed.
    // LOCAL_PATH may hold a pre-downloaded *.json.
    const genToItems = (row) => {
        const r = toGenKnowRow(row);
        return r ? genKnowRowToItems(r) : null;
    };
    const trainGenKnow = async () => {
        if (!GENKNOW)
            return;
        if (trainedContentBytes >= MAX_BYTES || stopRequested)
            return;
        const p = await loadProgress(store);
        if (p.completedFiles.includes(GENKNOW_ID)) {
            progress.log(`  ${DIM}· General-Knowledge already trained — skipping${R}`);
            return;
        }
        let path = "", downloaded = false;
        if (LOCAL_PATH) {
            const hit = readdirSync(LOCAL_PATH).find((f) => /general.*knowledge.*\.json$/i.test(f) || /output\.json$/i.test(f));
            if (!hit) {
                progress.log(`  ${DIM}· no General-Knowledge *.json in ${LOCAL_PATH} — skipping${R}`);
                return;
            }
            path = join(LOCAL_PATH, hit);
        }
        else {
            const got = await acquire(GENKNOW_URL, "general_knowledge.json", "General-Knowledge");
            if (!got)
                return;
            path = got;
            downloaded = true;
        }
        try {
            totalCorpusBytes += statSync(path).size;
        }
        catch { /* best effort */ }
        state.fileTotal = 1;
        state.fileIndex = 1;
        state.activity = "process";
        state.filePath = "General-Knowledge";
        state.fileExamples = 0;
        tick(true);
        const p0 = Date.now();
        let res;
        try {
            res = await processJsonArray(path, genToItems, ci, onDeposit, sample);
        }
        catch (e) {
            if (stopRequested || e?.name === "AbortError")
                return;
            progress.log(`  ${RED}✗${R} General-Knowledge processing failed: ${e.message}`);
            return;
        }
        langTally["genknow"] = (langTally["genknow"] ?? 0) + res.examples;
        progress.log(`  ${GRN}✓${R} General-Knowledge ${DIM}[Q&A facts]${R} → ${int(res.examples)} facts ${DIM}in ${dur((Date.now() - p0) / 1000)}${R}` +
            (res.skipped
                ? ` ${YEL}· ${int(res.skipped)} unusable row(s) skipped${R}`
                : "") +
            (res.stopped ? ` ${YEL}(stopped early)${R}` : ""));
        if (!res.stopped) {
            try {
                totalBytesProcessed += statSync(path).size;
            }
            catch { /* best effort */ }
            if (downloaded) {
                try {
                    unlinkSync(path);
                }
                catch { /* best effort */ }
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
        }
        catch { /* best effort — finish() will retry */ }
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
    }
    catch { /* fresh tally */ }
    if (prog.completedFiles.length > 0) {
        progress.log(`  ${CYAN}↻${R} resuming: ${prog.completedFiles.length} stage-unit(s) done, ` +
            `${int(depositCount)} examples, ${bytes(trainedContentBytes)} learned`);
    }
    // Stage 1 (SmolSent translation facts), 2 (Aya multilingual chat), 3 (oasst2
    // multi-turn), 4 (General-Knowledge Q&A facts). Each is skipped on a resume
    // that already finished it.
    if (!stopRequested)
        await trainSmolSent();
    if (!stopRequested)
        await trainAya();
    if (!stopRequested)
        await trainOasst();
    if (!stopRequested)
        await trainGenKnow();
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
