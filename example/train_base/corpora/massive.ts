// train_base/corpora/massive.ts — AmazonScience/massive short intents
//
// Knobs, the row adapter, and the stage descriptor for ONE corpus, together
// with the evidence that fixed each default. A corpus file owns everything
// source-specific; the loop that runs it is in ../stage.ts.

import { env } from "../config.js";
import { refineItems, type TrainingItem } from "../items.js";
import { parquet } from "../readers.js";
import type { Corpus } from "../stage.js";
import { convertedParquetUnits } from "./converted-parquet.js";

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
export function massiveRowToItems(
  row: unknown,
  maxChars = MAX_MASSIVE_UTT_CHARS,
): TrainingItem[] {
  if (!row || typeof row !== "object") return [];
  const utt = (row as Record<string, unknown>).utt;
  const text = typeof utt === "string" ? utt.trim() : "";
  if (!text || text.length > maxChars) return [];
  return refineItems([text]);
}

export const massive: Corpus = {
  id: "massive",
  label: "MASSIVE",
  kind: "short intents",
  enabled: MASSIVE,
  maxRows: MASSIVE_MAX_ROWS,
  read: parquet(),
  toItems: (row) => {
    const items = massiveRowToItems(row);
    return items.length ? items : null;
  },
  unitNoun: "shard(s)",
  log: { rows: "row(s)" },
  discover: convertedParquetUnits({
    id: "massive",
    label: "MASSIVE",
    dataset: MASSIVE_DATASET,
    config: MASSIVE_CONFIG,
    splits: MASSIVE_SPLITS,
    localSub: "massive",
  }),
};
