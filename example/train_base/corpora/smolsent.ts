// train_base/corpora/smolsent.ts — google/smol sentence pairs
//
// Knobs, the row adapter, and the stage descriptor for ONE corpus, together
// with the evidence that fixed each default. A corpus file owns everything
// source-specific; the loop that runs it is in ../stage.ts.

import { env, LOCAL_PATH } from "../config.js";
import { refineItems, type TrainingItem } from "../items.js";
import { hfTree, localFiles } from "../discovery.js";
import { lines } from "../readers.js";
import type { Corpus, Unit } from "../stage.js";
import type { TrainCtx } from "../runtime.js";
import { basename, join } from "node:path";

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
export function toSmolSentRow(
  row: unknown,
  maxChars = MAX_SMOLSENT_CHARS,
): SmolSentRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const src = typeof r.src === "string" ? r.src.trim() : "";
  // `trg` is a single string in smolsent; tolerate a list form defensively.
  const trgRaw = Array.isArray(r.trgs) ? r.trgs[0] : r.trg;
  const trg = typeof trgRaw === "string" ? trgRaw.trim() : "";
  if (!src || !trg) return null;
  if (
    src.length > maxChars || trg.length > maxChars
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
export function smolSentRowToItems(
  row: SmolSentRow,
  dirs: { src2trg: boolean; trg2src: boolean } = {
    src2trg: SMOLSENT_SRC2TRG,
    trg2src: SMOLSENT_TRG2SRC,
  },
): TrainingItem[] {
  const { src, trg } = row;
  const items: TrainingItem[] = [];
  if (dirs.src2trg) items.push({ context: src, continuation: trg });
  if (dirs.trg2src) items.push({ context: trg, continuation: src });
  return refineItems(items);
}

/** Discover the SmolSent per-pair JSONL files from the HF repo tree, restricted
 *  to SMOLSENT_PAIRS (basenames without .jsonl) when set. Each entry is the
 *  repo-relative path, e.g. "smolsent/ha_en.jsonl". */
async function listFiles(ctx: TrainCtx): Promise<string[]> {
  const paths = await hfTree(
    SMOLSENT_DATASET,
    "smolsent",
    /\.jsonl$/i,
    `GET smol tree`,
    ctx.http,
  );
  if (!SMOLSENT_PAIRS.length) return paths;
  const want = new Set(SMOLSENT_PAIRS.map((p) => p.replace(/\.jsonl$/i, "")));
  return paths.filter((p) => want.has(basename(p).replace(/\.jsonl$/i, "")));
}

const unit = (name: string): Unit => ({
  key: name,
  // The log names a pair by its language code alone; the panel keeps the file.
  name: name.replace(/\.jsonl$/i, ""),
  display: `SmolSent ${name}`,
});

export const smolsent: Corpus = {
  id: SMOLSENT_ID,
  label: "SmolSent",
  kind: "translation",
  enabled: SMOLSENT,
  unitNoun: "translation file(s)",
  // The *4 is chars-to-a-generous-JSON-envelope: the guard bounds ONE side of
  // a pair, the line carries both plus its keys.
  read: lines({ maxLineChars: MAX_SMOLSENT_CHARS * 4 }),
  toItems: (row) => {
    const r = toSmolSentRow(row);
    return r ? smolSentRowToItems(r) : null;
  },
  async discover(ctx) {
    // Work-list: local *.jsonl in LOCAL_PATH, else the repo's smolsent/ files.
    if (LOCAL_PATH) {
      let names = localFiles(LOCAL_PATH, /\.jsonl$/i);
      if (SMOLSENT_PAIRS.length) {
        const want = new Set(
          SMOLSENT_PAIRS.map((p) => p.replace(/\.jsonl$/i, "")),
        );
        names = names.filter((n) => want.has(n.replace(/\.jsonl$/i, "")));
      }
      return names.map((n) => ({ ...unit(n), local: join(LOCAL_PATH, n) }));
    }
    return (await listFiles(ctx)).map((path) => ({
      ...unit(basename(path)),
      // owner/name and the file path are URL PATH segments — do not encode "/".
      url:
        `https://huggingface.co/datasets/${SMOLSENT_DATASET}/resolve/main/${path}`,
    }));
  },
};
