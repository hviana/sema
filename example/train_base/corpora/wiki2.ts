// train_base/corpora/wiki2.ts — 2WikiMultihopQA evidence triples
//
// Knobs, the row adapter, and the stage descriptor for ONE corpus, together
// with the evidence that fixed each default. A corpus file owns everything
// source-specific; the loop that runs it is in ../stage.ts.

import { env } from "../config.js";
import { refineItems, type TrainingItem } from "../items.js";
import { parquet } from "../readers.js";
import type { Corpus } from "../stage.js";
import { convertedParquetUnits } from "./converted-parquet.js";

// ── 2WikiMultihopQA — the `evidences` TRIPLES only (the composition stage) ──
// Each row carries `evidences`: a JSON string of (subject, relation, object)
// triples that CHAIN — one triple's object is the next's subject. 72.5% of rows
// carry such a chain (measured over 4,000 rows), and those triples are the only
// representation measured to make Sema compose a two-hop answer at all.
//
// TWO COLUMNS ARE DELIBERATELY NOT READ, one for licence reasons and one for
// capability reasons:
//   • `context` holds Wikipedia PROSE. The repo is Apache-2.0 but Wikipedia text
//     is CC BY-SA, and a Sema store keeps text verbatim, so ingesting the
//     passages would attach ShareAlike to every distributed store. The triples
//     originate in Wikidata (CC0). See DATASETS.md §3.2/§4.
//   • `question`/`answer` are the composed multi-hop QUESTION. Depositing those
//     teaches the answer to that exact question and nothing else — it memorises
//     rather than composes. They are used to EVALUATE this adapter, never as
//     training input.
//
// Read from Hugging Face's auto-converted `refs/convert/parquet` branch, not
// from main: the main-branch train.parquet is written as ONE 167,454-row
// group (666 MB uncompressed) and a Parquet column chunk is per-group, so any
// read of it materialises the whole file. The converted branch uses uniform
// 10,000-row groups. See test/79-parquet-batching.test.mjs.
const WIKI2 = env("WIKI2", "1") !== "0";
const WIKI2_DATASET = env("WIKI2_DATASET", "xanhho/2WikiMultihopQA");
// Splits to train, in order. Only `train` by default: `validation`/`test` are
// the dataset's held-out sets and are what an honest evaluation of this
// adapter's composition rate has to be measured on.
const WIKI2_SPLITS = env("WIKI2_SPLITS", "train")
  .split(",").map((s) => s.trim()).filter(Boolean);
// Reject a triple with an implausibly long field (corruption); real subjects and
// objects are entity names, and relations are Wikidata property labels.
// 0 = every row. The train split holds 167,454 rows at ~4.95 deposits each
// (~830k facts), so this is the knob that keeps 2Wiki proportionate to the rest
// of the curriculum in the same way SODA_MAX_DIALOGS does.
const WIKI2_MAX_ROWS = Math.max(
  0,
  Math.floor(Number(env("WIKI2_MAX_ROWS", "0"))) || 0,
);
const MAX_WIKI2_FIELD_CHARS = Math.max(
  100,
  Math.floor(Number(env("MAX_WIKI2_FIELD_KB", "2")) * 1000) || 2_000,
);

// ═══════════════════════════════════════════════════════════════════════
// §6e″  2WikiMultihopQA parsing — `evidences` TRIPLES → SEMA facts
//
// This is the only stage whose purpose is COMPOSITION: answering a question
// whose answer no single deposited fact contains. Sema composes by grounding
// hop 1, then pivoting on the longest unconsumed learnt context that the
// grounded answer CONTAINS (`reason`/`pivotStep`), so the pivot target must
// itself be a deposited context. Each triple therefore deposits TWO facts:
//
//     "<subject> <relation>"  →  "The <relation> of <subject> is <object>."
//     "<subject>"             →  "The <relation> of <subject> is <object>."
//
// The second is the PIVOT FACT. Without it the bare entity naming hop 2's
// subject is not a learnt context, so the chain is structurally unreachable no
// matter what the rest of the pipeline does.
//
// MEASURED on 200 real chained dev rows, depositing triples only and asking the
// dataset's own composed questions (D = 1024, seed 7):
//
//   relation fact only          240 deposits    5/120 ( 4%)   pivotStep  0
//   relation + pivot fact       800 deposits   44/200 (22%)   pivotStep 31
//
// A 5x improvement, and the only variant where the second hop fires at all.
//
// REJECTED ALTERNATIVE, so it is not re-tried blind: depositing the pivot fact
// only for subjects that also appear as an OBJECT within the same row's
// evidences (a row-local "something can pivot into this" test) cut deposits 25%
// (800 → 600) but cost composition — 41/200 (20.5%) with pivotStep down to 21,
// because real chains also run BETWEEN rows. Composition is this stage's entire
// justification, so the deposits are worth keeping.
//
// The residual ~78% is a KNOWN, previously-recorded limitation and not a defect
// in this adapter: the climb elects a topic rather than a relation, so a
// question phrased "When did X's father die?" does not align with the Wikidata
// property label "date of death". Failure is dominated by hop 2 never firing,
// not by a wrong hop 2. Answer-shape breakdown at N = 120: entity answers
// 23/106, date answers 2/14 — dates are worse, but not the cliff an earlier
// note suggested, which is why no object-shape filter is applied here.
// ═══════════════════════════════════════════════════════════════════════

/** One (subject, relation, object) triple from a 2Wiki `evidences` cell. */
export interface WikiTriple {
  subject: string;
  relation: string;
  object: string;
}

/** Normalize a 2Wiki row into its evidence triples, or null when it carries
 *  none usable. `evidences` is a JSON STRING holding an array of 3-element
 *  arrays; a row whose cell is absent, unparseable, or empty yields null.
 *  Individual malformed or oversized triples are dropped without discarding the
 *  row — one bad triple should not cost the others. */
export function toWikiTriples(
  row: unknown,
  maxChars = MAX_WIKI2_FIELD_CHARS,
): WikiTriple[] | null {
  if (!row || typeof row !== "object") return null;
  const cell = (row as Record<string, unknown>).evidences;
  let parsed: unknown = cell;
  if (typeof cell === "string") {
    try {
      parsed = JSON.parse(cell);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const out: WikiTriple[] = [];
  for (const e of parsed) {
    if (!Array.isArray(e) || e.length < 3) continue;
    const subject = typeof e[0] === "string" ? e[0].trim() : "";
    const relation = typeof e[1] === "string" ? e[1].trim() : "";
    const object = typeof e[2] === "string" ? e[2].trim() : "";
    if (!subject || !relation || !object) continue;
    if (
      subject.length > maxChars ||
      relation.length > maxChars ||
      object.length > maxChars
    ) continue;
    out.push({ subject, relation, object });
  }
  return out.length ? out : null;
}

/** Render ONE triple as the prose fact Sema stores. Kept separate so the two
 *  deposits below are guaranteed to share a byte-identical continuation: the
 *  pivot fact only works if it leads to the SAME node the relation fact does. */
export function wikiTripleSentence(t: WikiTriple): string {
  return `The ${t.relation} of ${t.subject} is ${t.object}.`;
}

/** Translate a row's triples into SEMA items: per triple, the relation fact and
 *  the bare-subject PIVOT fact (see the section note above). refineItems drops
 *  the duplicates this produces when a row states the same triple twice. */
export function wikiTriplesToItems(triples: WikiTriple[]): TrainingItem[] {
  const items: TrainingItem[] = [];
  for (const t of triples) {
    const fact = wikiTripleSentence(t);
    items.push({ context: `${t.subject} ${t.relation}`, continuation: fact });
    items.push({ context: t.subject, continuation: fact });
  }
  return refineItems(items);
}

export const wiki2: Corpus = {
  id: "2wiki",
  label: "2Wiki",
  kind: "relation triples",
  enabled: WIKI2,
  maxRows: WIKI2_MAX_ROWS,
  read: parquet(),
  toItems: (row) => {
    const triples = toWikiTriples(row);
    if (!triples) return null;
    const items = wikiTriplesToItems(triples);
    return items.length ? items : null;
  },
  unitNoun: "shard(s)",
  log: { rows: "row(s)" },
  discover: convertedParquetUnits({
    id: "2wiki",
    label: "2Wiki",
    dataset: WIKI2_DATASET,
    config: "default",
    splits: WIKI2_SPLITS,
    localSub: "2wiki",
  }),
};
