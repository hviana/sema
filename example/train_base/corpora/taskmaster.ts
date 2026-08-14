// train_base/corpora/taskmaster.ts — google-research-datasets/Taskmaster 1–4 dialogue
//
// Knobs, the row adapter, and the stage descriptor for ONE corpus, together
// with the evidence that fixed each default. A corpus file owns everything
// source-specific; the contract it fills is ../corpus.ts and the loop that runs
// it is ../stage.ts.

import { env, LOCAL_PATH } from "../config.js";
import {
  accumulate,
  mergeSpeakerTurns,
  refineItems,
  type SpeakerTurn,
  type TrainingItem,
} from "../items.js";
import { githubContents, localFiles } from "../discovery.js";
import { jsonArray } from "../readers.js";
import { type Corpus, localDir, type Unit } from "../corpus.js";
import type { TrainCtx } from "../runtime.js";
import { DIM, R } from "../ui.js";
import { basename, join } from "node:path";

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

/** One utterance of a Taskmaster conversation — the shared dialogue-turn shape,
 *  under the name this corpus's adapters have always used. */
export type TaskmasterTurn = SpeakerTurn;

/** Normalize ONE element of a Taskmaster data file into its turns, or null when
 *  it carries no usable utterance. Empty/whitespace-only utterances are dropped
 *  (TM-3 has a few); a single implausibly long utterance rejects the whole
 *  conversation as corrupt rather than depositing a dump. */
export function toTaskmasterTurns(
  row: unknown,
  maxChars = MAX_TASKMASTER_TURN_CHARS,
): TaskmasterTurn[] | null {
  if (!row || typeof row !== "object") return null;
  const utterances = (row as Record<string, unknown>).utterances;
  if (!Array.isArray(utterances)) return null;
  const turns: TaskmasterTurn[] = [];
  for (const u of utterances) {
    if (!u || typeof u !== "object") continue;
    const r = u as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) continue;
    if (text.length > maxChars) return null;
    turns.push({
      speaker: String(r.speaker ?? "").trim().toUpperCase(),
      text,
    });
  }
  return turns.length ? turns : null;
}

/** Translate ONE Taskmaster conversation into SEMA training items: the
 *  cumulative walk over its merged turns. Returns [] for a conversation below
 *  TASKMASTER_MIN_TURNS, so callers can simply skip empties. */
export function taskmasterConversationToItems(
  turns: TaskmasterTurn[],
  minTurns = TASKMASTER_MIN_TURNS,
): TrainingItem[] {
  const texts = mergeSpeakerTurns(turns);
  if (texts.length < minTurns) return [];
  return refineItems(accumulate(texts));
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
async function listFiles(
  ctx: TrainCtx,
): Promise<Array<{ set: string; path: string; size: number }>> {
  const out: Array<{ set: string; path: string; size: number }> = [];
  for (const set of TASKMASTER_SETS) {
    const rootOnly = /^TM-1\b/i.test(set);
    const dir = rootOnly ? set : `${set}/data`;
    const names = await githubContents(
      TASKMASTER_REPO,
      dir,
      /\.json$/i,
      `GET Taskmaster ${dir}`,
      ctx.http,
    );
    for (const { path: name, size } of names) {
      if (rootOnly && !/-dialogs\.json$/i.test(name)) continue;
      out.push({ set, path: `${dir}/${name}`, size });
    }
  }
  return out;
}

const unit = (key: string, name: string): Unit => ({
  key,
  name,
  display: `Taskmaster ${name}`,
});

export const taskmaster: Corpus = {
  id: "taskmaster",
  label: "Taskmaster",
  kind: "task dialogue",
  enabled: TASKMASTER,
  unitNoun: "dialogue file(s)",
  read: jsonArray(),
  toItems: (row) => {
    const turns = toTaskmasterTurns(row);
    if (!turns) return null;
    const items = taskmasterConversationToItems(turns); // [] when too short
    return items.length ? items : null;
  },
  log: { bad: "unusable conversation(s)" },
  async discover(ctx) {
    // LOCAL_PATH/taskmaster/ — a subdirectory, because these share the .json
    // extension with the General-Knowledge source and must not be confused
    // with it.
    if (LOCAL_PATH) {
      const dir = localDir("taskmaster");
      const names = localFiles(dir, /\.json$/i);
      if (names.length === 0) {
        ctx.progress.log(
          `  ${DIM}· no Taskmaster *.json in ${dir} — skipping${R}`,
        );
        return null;
      }
      return names.map((n) => ({
        ...unit(n.path, n.path),
        local: join(dir, n.path),
        bytes: n.size,
      }));
    }
    return (await listFiles(ctx)).map((f) => ({
      ...unit(f.path, `${f.set}/${basename(f.path)}`),
      url: `${TASKMASTER_RAW}/${f.path}`,
      bytes: f.size,
    }));
  },
};
