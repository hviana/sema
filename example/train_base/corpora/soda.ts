// train_base/corpora/soda.ts — allenai/soda social dialogue
//
// Knobs, the row adapter, and the stage descriptor for ONE corpus, together
// with the evidence that fixed each default. A corpus file owns everything
// source-specific; the contract it fills is ../corpus.ts and the loop that runs
// it is ../stage.ts.

import { env } from "../config.js";
import {
  accumulate,
  mergeSpeakerTurns,
  refineItems,
  type TrainingItem,
} from "../items.js";
import { parquet } from "../readers.js";
import type { Corpus } from "../corpus.js";
import { convertedParquetUnits } from "./converted-parquet.js";
// SODA turns are the same shape as Taskmaster's, and merge by the same rule.
import type { TaskmasterTurn } from "./taskmaster.js";

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
export function toSodaTurns(
  row: unknown,
  maxChars = MAX_SODA_TURN_CHARS,
): TaskmasterTurn[] | null {
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
    if (text.length > maxChars) return null;
    turns.push({
      speaker: String(speakers[i] ?? "").trim().toUpperCase(),
      text,
    });
  }
  return turns.length ? turns : null;
}

/** Translate ONE SODA dialogue into SEMA items: the cumulative walk over its
 *  speaker-merged turns. Shares `mergeSpeakerTurns` because the rule is the
 *  same one — consecutive turns by one speaker are one contribution. */
export function sodaDialogueToItems(turns: TaskmasterTurn[]): TrainingItem[] {
  const texts = mergeSpeakerTurns(turns);
  if (texts.length < 2) return []; // not an exchange
  return refineItems(accumulate(texts));
}

export const soda: Corpus = {
  id: "soda",
  label: "SODA",
  kind: "social dialogue",
  enabled: SODA,
  maxRows: SODA_MAX_DIALOGS,
  // Two of sixteen columns. The `narrative`/`literal`/`head`/`relation`/`tail`
  // scaffolding the note above declines to deposit is now also never decoded:
  // measured on the converted train shard, 449 MB uncompressed across all
  // sixteen against 306 MB for these two (68.1%).
  read: parquet({ columns: ["dialogue", "speakers"] }),
  toItems: (row) => {
    const turns = toSodaTurns(row);
    if (!turns) return null;
    const items = sodaDialogueToItems(turns);
    return items.length ? items : null;
  },
  unitNoun: "shard(s)",
  log: { rows: "row(s)" },
  discover: convertedParquetUnits({
    id: "soda",
    label: "SODA",
    dataset: SODA_DATASET,
    config: "default",
    splits: SODA_SPLITS,
    localSub: "soda",
  }),
};
