// train_base/cache.ts — the durable disk cache and the download sink.
//
// This is the ONE place the trainer needs Node rather than the web platform:
// every other byte in the pipeline moves through fetch, WHATWG streams,
// DecompressionStream, TextDecoderStream and Blob, but writing a file is the
// single capability the web platform does not expose. So the sink below wraps a
// raw fs descriptor, and nothing else here does.
//
// Two invariants the rest of the trainer relies on:
//   • ATOMIC — a download streams to "<file>.part", is fsync'd, then renamed
//     into place. A file at its final path is, by construction, complete, so an
//     interrupted download can never be mistaken for a cached one.
//   • BOUNDED — a download blocks under the MAX_CACHE_GB ceiling, and a fully
//     processed file is deleted by its caller immediately.

import {
  CACHE_DIR,
  CACHE_WAIT_MS,
  MAX_CACHE_BYTES,
  PART_SUFFIX,
} from "./config.js";
import { httpError, retry, waitMs } from "./http.js";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, join } from "node:path";

/** Delete every orphaned "<file>.part" in the cache, returning how many were
 *  removed and the bytes they held.
 *
 *  A .part file at rest is by definition the debris of a download that never
 *  finished — the rename that promotes one is the last step of `downloadFile`,
 *  so a live .part exists only while THIS process is writing it. Sweeping at
 *  startup is therefore safe, and it is load-bearing rather than cosmetic:
 *  `cacheSize` deliberately counts .part files (an in-flight download really
 *  does occupy the disk), so debris left by a killed run consumes ceiling
 *  budget that nothing would ever free, and `ensureCacheRoom` would wait for
 *  room that cannot appear.
 *
 *  The one assumption is that a cache directory belongs to ONE run at a time.
 *  That was already true — two trainers sharing CACHE_DIR would write the same
 *  .part path — so this adds no constraint that did not exist. */
export function sweepPartials(): { files: number; bytes: number } {
  const out = { files: 0, bytes: 0 };
  if (!existsSync(CACHE_DIR)) return out;
  for (const name of readdirSync(CACHE_DIR)) {
    if (!name.endsWith(PART_SUFFIX)) continue;
    const p = join(CACHE_DIR, name);
    try {
      const size = statSync(p).size;
      unlinkSync(p);
      out.files++;
      out.bytes += size;
    } catch { /* raced with another delete — nothing to reclaim */ }
  }
  return out;
}

/** Total bytes currently held in the cache directory — INCLUDING any .part
 *  file, because an in-flight download occupies the disk like any other file.
 *  Orphaned ones are removed by {@link sweepPartials} at startup. */
export function cacheSize(): number {
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
export async function ensureCacheRoom(
  fileBytes: number,
  signal: AbortSignal,
  warn?: (msg: string) => void,
  maxWaitMs = CACHE_WAIT_MS,
): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (fileBytes >= MAX_CACHE_BYTES) return;
  let warned = false;
  const until = Date.now() + maxWaitMs;
  // Stop waiting the moment a shutdown is requested — the abort signal unblocks
  // a long cache-full wait so Ctrl+C is never swallowed by the ceiling.
  while (!signal.aborted && cacheSize() + fileBytes > MAX_CACHE_BYTES) {
    // BOUNDED. Room appears when this run consumes and deletes a file, so a
    // cache already over the ceiling with nothing left to consume — stale files
    // from another run, a ceiling set below one corpus — would otherwise wait
    // for room that cannot arrive, forever, after a single warning line.
    if (Date.now() >= until) {
      throw new Error(
        `cache still full after ${Math.round(maxWaitMs / 60_000)} min ` +
          `(${(cacheSize() / 1e9).toFixed(1)} GB of a ` +
          `${(MAX_CACHE_BYTES / 1e9).toFixed(0)} GB ceiling) — raise ` +
          `MAX_CACHE_GB or clear ${CACHE_DIR}`,
      );
    }
    if (!warned) {
      warn?.(
        `cache at ${
          (MAX_CACHE_BYTES / 1e9).toFixed(0)
        } GB ceiling — waiting for room…`,
      );
      warned = true;
    }
    await waitMs(5_000, signal);
  }
}

export interface DownloadOptions {
  signal: AbortSignal;
  tries: number;
  onFail?: (attempt: number, err: Error) => void;
  onProgress?: (done: number, total: number) => void;
}

/** Stream `url` to `destPath`, atomically and with backpressure. */
export async function downloadFile(
  url: string,
  destPath: string,
  opts: DownloadOptions,
): Promise<void> {
  const partPath = destPath + PART_SUFFIX;
  await retry(
    `download ${basename(destPath)}`,
    async () => {
      // Abort promptly on shutdown rather than waiting out a slow socket.
      if (opts.signal.aborted) {
        const e: Error & { fatal?: boolean } = new Error("aborted");
        e.fatal = true;
        throw e;
      }
      const res = await fetch(url, { signal: opts.signal });
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
          opts.onProgress?.(done, total);
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
          signal: opts.signal,
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
    opts.tries,
    { signal: opts.signal, onFail: opts.onFail },
  );
}
