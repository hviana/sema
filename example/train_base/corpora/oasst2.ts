// train_base/corpora/oasst2.ts — OpenAssistant/oasst2 conversation trees
//
// Knobs, the row adapter, and the stage descriptor for ONE corpus, together
// with the evidence that fixed each default. A corpus file owns everything
// source-specific; the contract it fills is ../corpus.ts and the loop that runs
// it is ../stage.ts.

import { env } from "../config.js";
import { accumulate, refineItems, type TrainingItem } from "../items.js";
import { lines } from "../readers.js";
import { type Corpus, singleUnit } from "../corpus.js";

// ── OpenAssistant/oasst2 (the fourth training stage, after Aya) ──
// oasst2 is a corpus of human↔assistant conversation TREES. Its richest, most
// stream-friendly artifact is "<date>_oasst2_ready.trees.jsonl.gz": one JSON
// conversation tree PER LINE, gzip-compressed (a web standard — Decompression
// Stream("gzip")). Each tree is {message_tree_id, prompt:{role,text,replies:[…]}}
// where `replies` nests recursively and a prompt can have several ranked
// assistant replies (rank 0 = best). We follow the best-ranked, non-deleted
// reply at each step to get ONE linear, strictly-alternating conversation per
// tree, then keep only the MULTI-TURN ones (≥ OASST_MIN_TURNS messages, i.e. at
// least two full user→assistant exchanges) — single Q→A trees are skipped, by
// design. OASST=0 disables the stage; OASST_URL overrides the source.
const OASST = env("OASST", "1") !== "0";
const OASST_URL = env(
  "OASST_URL",
  "https://huggingface.co/datasets/OpenAssistant/oasst2/resolve/main/2023-11-05_oasst2_ready.trees.jsonl.gz",
);
// Multi-turn threshold: a conversation must have at least this many turns to be
// trained (4 = user→assistant→user→assistant, the smallest real multi-turn).
const OASST_MIN_TURNS = Math.max(
  2,
  Math.floor(Number(env("OASST_MIN_TURNS", "4"))) || 4,
);
// Skip a tree whose decoded JSON line exceeds this (a pathological record); the
// real maximum is far smaller, so this only guards against corruption.
const MAX_OASST_LINE_CHARS = Math.max(
  100_000,
  Math.floor(Number(env("MAX_OASST_LINE_MB", "8")) * 1_000_000) || 8_000_000,
);

// ═══════════════════════════════════════════════════════════════════════
// §6e  OpenAssistant/oasst2 parsing — a conversation TREE → SEMA items
//
// Each tree is {prompt:{role,text,replies:[…]}}, replies nested recursively. A
// prompt can have several ranked assistant replies; we collapse the tree to ONE
// linear conversation by following the best-ranked (rank 0), non-deleted reply
// at each step. The result strictly alternates prompter/assistant. Only MULTI-
// TURN conversations (≥ OASST_MIN_TURNS messages) are kept — the explicit focus
// of this stage; single Q→A trees are dropped.
// ═══════════════════════════════════════════════════════════════════════

/** A single oasst2 message node (the fields we use; the tree nests via replies). */
interface OasstNode {
  role?: string;
  text?: string;
  rank?: number | null;
  deleted?: boolean;
  replies?: OasstNode[];
}

/** One conversational turn extracted from a tree. */
export interface OasstTurn {
  role: string; // "prompter" | "assistant"
  text: string;
}

/** Collapse a conversation tree to ONE linear path: at each node, descend into
 *  its best-ranked, non-deleted reply (rank 0 preferred; unranked sorts last).
 *  Returns the ordered turns (already strictly alternating in this corpus). */
export function bestOasstPath(root: OasstNode): OasstTurn[] {
  const turns: OasstTurn[] = [];
  let node: OasstNode | undefined = root;
  while (node) {
    const text = typeof node.text === "string" ? node.text.trim() : "";
    if (text) turns.push({ role: String(node.role ?? "?"), text });
    const live: OasstNode[] = (node.replies ?? []).filter((r: OasstNode) =>
      r && !r.deleted && typeof r.text === "string" && r.text.trim() !== ""
    );
    if (live.length === 0) break;
    live.sort((a: OasstNode, b: OasstNode) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
    );
    node = live[0];
  }
  return turns;
}

/** Translate ONE multi-turn oasst2 conversation into SEMA training items.
 *
 *  This is the ONE stage where cumulative continuous context is truly necessary:
 *  the data is a real multi-turn dialogue, and what must be learned is how each
 *  turn follows from the WHOLE conversation so far — not from the previous turn
 *  alone. The conversation is emitted ONLY as the accumulated walk; standalone
 *  turn experiences and local adjacent-pair facts are NOT emitted (they are
 *  subsumed by it and would merely replicate the content).
 *
 *  The walk is the pattern proven in test/13-conversation.test.mjs
 *  ("teachConversation"): each turn is the continuation of all prior turns,
 *  with BARE turn text — NO "User:/Assistant:" labels.  The SHAPE is identical
 *  (cumulative context → next turn); the join string is not, and does not need
 *  to be — that file joins with nothing and this corpus joins with "\n" (see
 *  `accumulate`).  Saying "byte-for-byte", as this comment used to, invites the
 *  reading that the two must agree on a separator.  They must not agree,
 *  because there is nothing to agree about: turn boundaries are offsets, and
 *  the join string is just corpus text. Roles already
 *  alternate by position in an oasst2 best-path (the root is a prompter), so a
 *  label adds nothing the position does not, while a clean continuation matches
 *  the test's recall (predictNext queries bare prior turns) and lets a turn share
 *  its gist with the same text elsewhere (e.g. an Aya question stored bare).
 *
 *  Returns [] for a conversation below the multi-turn threshold, so callers can
 *  simply skip empties. */
export function oasstConversationToItems(
  turns: OasstTurn[],
  minTurns = OASST_MIN_TURNS,
): TrainingItem[] {
  if (turns.length < minTurns) return []; // not multi-turn — skip
  return refineItems(accumulate(turns.map((t) => t.text)));
}

/** The row adapter: ONE line of the tree dump → its deposits. Returns null for
 *  a tree with no prompt and for every single-turn tree — the latter is the
 *  stage's design, not a defect, which is why the reader counts it `unusable`
 *  rather than `skipped`. */
export function oasstTreeToItems(row: unknown): TrainingItem[] | null {
  if (!row || typeof row !== "object") return null;
  const tree = row as { prompt?: OasstNode };
  if (!tree.prompt) return null;
  const items = oasstConversationToItems(bestOasstPath(tree.prompt));
  return items.length ? items : null;
}

export const oasst2: Corpus = {
  id: "oasst2",
  label: "oasst2",
  kind: "multi-turn chat",
  enabled: OASST,
  read: lines({ gzip: true, maxLineChars: MAX_OASST_LINE_CHARS }),
  toItems: oasstTreeToItems,
  // The one corpus that KEEPS a cached file after a complete read: a copy left
  // behind by a previous interrupted run is not this stage's to reclaim.
  keepCached: true,
  log: {
    deposits: "examples",
    // A tree that yields items is exactly a tree that cleared OASST_MIN_TURNS.
    rows: "conversation(s)",
    // The single-turn trees this stage drops BY DESIGN must not be reported as
    // damage — only genuinely malformed lines are.
    malformedOnly: true,
  },
  discover: singleUnit({
    // Resume id "oasst2::trees" — the string this store already records.
    key: "trees",
    label: "oasst2",
    display: "oasst2 (multi-turn)",
    url: OASST_URL,
    dest: "oasst2_ready.trees.jsonl.gz",
    acquireLabel: "oasst2 trees",
    localMatch: [/oasst.*trees.*\.jsonl\.gz$/i, /oasst.*\.jsonl\.gz$/i],
    localWhat: "oasst2 *trees*.jsonl.gz",
  }),
};
