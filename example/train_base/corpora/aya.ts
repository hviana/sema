// train_base/corpora/aya.ts — CohereLabs/aya_dataset prompt→completion pairs
//
// Knobs, the row adapter, and the stage descriptor for ONE corpus, together
// with the evidence that fixed each default. A corpus file owns everything
// source-specific; the contract it fills is ../corpus.ts and the loop that runs
// it is ../stage.ts.

import { env } from "../config.js";
import { refineItems, type TrainingItem } from "../items.js";
import { parquet } from "../readers.js";
import { type Corpus, singleUnit } from "../corpus.js";

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
// A single Aya field this many chars or longer is skipped: inputs/targets range
// up to ~3.3M chars, and a multi-MB "pair" is documentation/dump noise, not a
// cognitive example.
const MAX_AYA_FIELD_CHARS = Math.max(
  10_000,
  Math.floor(Number(env("MAX_AYA_FIELD_KB", "256")) * 1000) || 256_000,
);

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
export function toAyaRow(
  row: unknown,
  maxChars = MAX_AYA_FIELD_CHARS,
): AyaRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const inputs = typeof r.inputs === "string" ? r.inputs.trim() : "";
  const targets = typeof r.targets === "string" ? r.targets.trim() : "";
  if (!inputs || !targets) return null;
  if (
    inputs.length > maxChars || targets.length > maxChars
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

export const aya: Corpus = {
  id: "aya",
  label: "Aya Dataset",
  kind: "multilingual chat",
  enabled: AYA,
  // The three columns toAyaRow reads, out of six. Kept for the same reason as
  // the other Parquet stages — the read states what the adapter uses — though
  // here it is nearly free rather than a saving: measured on the train file,
  // 238 MB uncompressed across all six and 233 MB for these three (98.2%). The
  // dropped columns are ids and annotation metadata, so there is little to
  // drop.
  read: parquet({ columns: ["inputs", "targets", "language"] }),
  toItems: (row) => {
    const r = toAyaRow(row);
    return r ? ayaRowToItems(r) : null;
  },
  discover: singleUnit({
    // Resume id "aya::dataset" — the string this store already records.
    key: "dataset",
    label: "Aya Dataset",
    display: "Aya Dataset",
    url: AYA_URL,
    dest: "aya_train.parquet",
    localMatch: [/aya.*\.parquet$/i, /\.parquet$/i],
    localWhat: "Aya *.parquet",
  }),
};
