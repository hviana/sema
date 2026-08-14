// train_base/http.ts — the shared network policy: wait out throttling, retry
// what is transient, give up at once on what is not.
//
// A leaf module by construction: everything it needs to cancel (the run's
// AbortSignal) and everything it needs to report (a throttle notice) arrives
// as a parameter. There is no module-level shutdown handle and no module-level
// log hook — those were globals precisely because this code used to live in the
// same file as the run that owned them.

import { DOWNLOAD_TRIES } from "./config.js";

/** Sleep `ms`, but wake early if `signal` fires — so a long back-off (e.g. a
 *  rate-limit wait) never swallows Ctrl+C. Resolves either way. */
export const waitMs = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    // NOTE: the timer is deliberately NOT unref'd — an unref'd timer does not
    // keep the event loop alive, so a pending wait (e.g. the pace between page
    // requests, or a rate-limit back-off) would let Node exit early and the run
    // would "do nothing and close". The listener lets a shutdown wake it early.
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/** Resolve `p`, but reject with a TimeoutError if it takes longer than `ms`.
 *  The underlying promise is left to settle on its own (we just stop waiting),
 *  so a slow black-box call can never wedge the caller. */
export function withTimeout<T>(
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

/** An HTTP error the caller tagged as transient. `.fatal` skips all retries;
 *  `.throttle` (a 429/503 rate-limit or overload) is retried indefinitely and
 *  does NOT consume the bounded attempt budget — the server told us to wait, not
 *  to give up. `.retryAfterMs` carries a server-suggested delay when present. */
export type HttpError = Error & {
  fatal?: boolean;
  throttle?: boolean;
  retryAfterMs?: number;
};

/** What every network call in this trainer needs from its caller: how to be
 *  cancelled, and (optionally) where to report a rate-limit wait. */
export interface HttpOptions {
  signal: AbortSignal;
  /** Called after each throttle wait, so a 429 back-off reads as "waiting"
   *  rather than a silent hang. Omitted ⇒ the wait is silent. */
  onThrottle?: (waitMsAmount: number, label: string) => void;
}

/** Wrap a throttle notice so a STORM of 429s logs at most one notice every
 *  `minGapMs`. Without the gap a busy server produces a wall of identical
 *  "waiting…" lines that pushes the real log out of the scrollback. */
export function throttleNotifier(
  fn: (waitMsAmount: number, label: string) => void,
  minGapMs = 3000,
): (waitMsAmount: number, label: string) => void {
  let last = 0;
  return (ms, label) => {
    const now = Date.now();
    if (now - last <= minGapMs) return;
    last = now;
    fn(ms, label);
  };
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
export async function retry<T>(
  label: string,
  fn: () => Promise<T>,
  tries: number,
  opts: HttpOptions & { onFail?: (attempt: number, err: Error) => void },
): Promise<T> {
  const { signal, onFail, onThrottle } = opts;
  let wait = 1000, last = "", throttleWait = 1000;
  for (let attempt = 1; attempt <= tries;) {
    if (signal.aborted) {
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
      if (err.throttle && !signal.aborted) {
        // Honour Retry-After when the server sent one; else exponential back-off
        // with jitter, capped, so a fleet of requests does not resynchronise.
        const base = err.retryAfterMs && err.retryAfterMs > 0
          ? err.retryAfterMs
          : throttleWait;
        const ms = Math.min(base, 60_000) +
          Math.floor(base * 0.25 * Math.random());
        onThrottle?.(ms, label);
        await waitMs(ms, signal);
        throttleWait = Math.min(throttleWait * 2, 60_000);
        continue;
      }

      last = err.message;
      onFail?.(attempt, err);
      attempt++;
      if (attempt <= tries) {
        await waitMs(wait, signal);
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
export function httpError(res: Response): HttpError {
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
 *  WAIT indefinitely (surfaced through `opts.onThrottle`), other 4xx is fatal,
 *  other 5xx retried up to DOWNLOAD_TRIES. Used by every dataset LISTING call so
 *  all share the same never-drop-on-throttle behaviour. */
export async function getJson(
  url: string,
  label: string,
  opts: HttpOptions,
): Promise<any> {
  return retry(
    label,
    async () => {
      const res = await fetch(url, { signal: opts.signal });
      if (res.ok) return res.json();
      throw httpError(res);
    },
    DOWNLOAD_TRIES,
    opts,
  );
}

/** The `rel="next"` URL of an RFC 5988 Link header, or null. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i);
    if (m) return m[1];
  }
  return null;
}

/** GET a paginated JSON ARRAY, following `Link: rel="next"` to the end.
 *
 *  A LISTING THAT STOPS EARLY IS INVISIBLE, and that is why this exists.
 *  Hugging Face caps a tree listing at 1,000 entries and hands back a next
 *  link (verified: allenai/c4 returns exactly 1,000 plus a link). A caller that
 *  ignores it gets a work-list silently missing everything past the first page,
 *  trains it, marks those units complete, and thereafter reports the corpus
 *  "already trained". No error at any point. Following the links is the only
 *  way the work-list can be trusted to be the whole work-list.
 *
 *  `maxPages` is a runaway guard, not a limit anyone should hit; exceeding it
 *  throws rather than returning a partial list, for exactly the reason above. */
export async function getJsonPaged(
  url: string,
  label: string,
  opts: HttpOptions,
  maxPages = 500,
): Promise<unknown[]> {
  const out: unknown[] = [];
  let next: string | null = url;
  let pages = 0;
  while (next !== null) {
    const at: string = next;
    const { body, link } = await retry(
      label,
      async () => {
        const res = await fetch(at, { signal: opts.signal });
        if (!res.ok) throw httpError(res);
        return { body: await res.json(), link: res.headers.get("link") };
      },
      DOWNLOAD_TRIES,
      opts,
    );
    if (!Array.isArray(body)) break; // not a listing — nothing to page through
    out.push(...body);
    next = nextLink(link);
    if (++pages >= maxPages && next) {
      throw new Error(
        `${label}: more than ${maxPages} pages of listing — refusing to ` +
          `continue with a work-list that may be incomplete`,
      );
    }
  }
  return out;
}

/** Advertised transfer size of `url`, used only to reserve cache room. Like any
 *  `content-length` this is the ON-THE-WIRE size, so for a content-coded source
 *  (GitHub raw gzips JSON ~14x) it UNDER-estimates the file that lands on disk.
 *  That is tolerable here because the cache ceiling is a budget, not a
 *  correctness property — a run may overshoot MAX_CACHE_GB by the compression
 *  ratio of one in-flight file, and each file is deleted as soon as it is
 *  consumed. It must NOT be reused as an integrity check; see downloadFile.
 *
 *  Rate-limits wait; other 4xx is fatal; total failure → the caller's catch. */
export async function headSize(
  url: string,
  opts: HttpOptions,
): Promise<number> {
  return retry(
    `HEAD ${url}`,
    async () => {
      const res = await fetch(url, { method: "HEAD", signal: opts.signal });
      if (res.ok) return Number(res.headers.get("content-length")) || 0;
      throw httpError(res);
    },
    4,
    opts,
  );
}
