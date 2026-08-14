// train_base/corpora/genknow.ts — MuskumPillerum/General-Knowledge Q&A
//
// Knobs, the row adapter, and the stage descriptor for ONE corpus, together
// with the evidence that fixed each default. A corpus file owns everything
// source-specific; the loop that runs it is in ../stage.ts.

import { env } from "../config.js";
import { refineItems, type TrainingItem } from "../items.js";
import { jsonArray } from "../readers.js";
import { type Corpus, singleUnit } from "../stage.js";

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
export function toGenKnowRow(
  row: unknown,
  maxChars = MAX_GENKNOW_CHARS,
): GenKnowRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const question = typeof r.Question === "string"
    ? unescapePlain(r.Question)
    : "";
  const answer = typeof r.Answer === "string" ? unescapePlain(r.Answer) : "";
  if (!question || !answer) return null;
  if (
    question.length > maxChars || answer.length > maxChars
  ) return null;
  return { question, answer };
}

/** Translate ONE General-Knowledge row into SEMA items: exactly one
 *  (question → answer) FACT. refineItems drops a degenerate question === answer. */
export function genKnowRowToItems(row: GenKnowRow): TrainingItem[] {
  return refineItems([{ context: row.question, continuation: row.answer }]);
}

export const genknow: Corpus = {
  id: "genknow",
  label: "General-Knowledge",
  kind: "Q&A facts",
  enabled: GENKNOW,
  unitId: GENKNOW_ID,
  read: jsonArray(),
  toItems: (row) => {
    const r = toGenKnowRow(row);
    return r ? genKnowRowToItems(r) : null;
  },
  discover: singleUnit({
    label: "General-Knowledge",
    display: "General-Knowledge",
    url: GENKNOW_URL,
    dest: "general_knowledge.json",
    localMatch: [/general.*knowledge.*\.json$/i, /output\.json$/i],
    localWhat: "General-Knowledge *.json",
  }),
};
