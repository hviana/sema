// train_base/ui.ts — everything the run puts on the screen: the formatters, the
// live panel pinned to the bottom of stderr, and the checkpoint recall box.
//
// Nothing here decides anything. It renders a ProgState the run owns, and the
// run never reads a value back out of it — so the whole display can be swapped
// (or silenced) without touching a line of training logic.

import { CHECKPOINT_BYTES, D, DB_PATH, PROGRESS_MS, SEED } from "./config.js";
import { isEpisode, type TrainingItem } from "./items.js";
import { basename } from "node:path";

// ── colours ──
export const CSI = "\x1b[";
export const B = `${CSI}1m`, DIM = `${CSI}2m`, R = `${CSI}0m`;
export const GREY = `${CSI}90m`, CYAN = `${CSI}36m`, GRN = `${CSI}32m`;
export const YEL = `${CSI}33m`, RED = `${CSI}31m`;
export const HIDE = `${CSI}?25l`, SHOW = `${CSI}?25h`;

// ── formatters ──

/** Human-readable duration from seconds. */
export function dur(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Human-readable byte size. */
export function bytes(n: number): string {
  if (!isFinite(n) || n < 0) return "--";
  if (n < 1024) return `${n} B`;
  if (n < 1e6) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
}

/** Short count: 1234567 → "1.23M". */
export function num(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export const int = (n: number) => Math.round(n).toLocaleString("en-US");
export const clamp01 = (f: number) => Math.max(0, Math.min(1, f));
export const pct = (f: number) => `${(clamp01(f) * 100).toFixed(1)}%`;

/** A progress bar of width `w` filled to fraction `frac`. */
export function bar(w: number, frac: number): string {
  const filled = Math.round(clamp01(frac) * w);
  return `${GRN}${"█".repeat(filled)}${GREY}${"░".repeat(w - filled)}${R}`;
}

/** Collapse whitespace and clip to `max` chars with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (max < 1) return "";
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

// ── the panel ──

export interface ProgState {
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
  fileSize: number; // bytes of current file
  fileExamples: number; // examples ingested from the current file
  activity: "download" | "process" | "idle";
  dlSpeed: number; // bytes/s, or 0
  dlDone: number; // bytes downloaded so far for the current download (live)
  dlTotal: number; // total bytes of the current download (0 if unknown)
  storeEntries: number;
  cacheBytes: number;
  lastSample: string | null; // pre-rendered recall box, pinned in the panel
}

/** A prompt/expected pair to display for an item. */
export function promptOf(
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
export function recallSimilarity(expected: string, response: string): number {
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
export function renderInferenceBox(
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

/** Render the whole panel. `title` names the curriculum being trained; the run
 *  supplies it, so the panel never has to know which corpora exist. */
export function renderPanel(s: ProgState, title: string): string {
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
    `${B}╭${R}${B} sema train${R} ${DIM}·${R} ${title} ${DIM}·${R} ` +
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
export class Progress {
  private lines = 0; // height of the panel currently on screen
  private lastPaint = 0;
  private lastStatus = 0;
  private last: ProgState | null = null;
  private readonly tty = process.stderr.isTTY === true;

  constructor(private readonly title: string) {}

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

    const text = renderPanel(s, this.title);
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
      const text = renderPanel(this.last, this.title);
      out += `${HIDE}${text}`;
      this.lines = text.split("\n").length;
    }
    process.stderr.write(out);
  }

  dispose(): void {
    if (this.tty) process.stderr.write(`${SHOW}\n`);
  }
}
