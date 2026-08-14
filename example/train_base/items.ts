// train_base/items.ts — the REPRESENTATION core: what a training item is, and
// the three shapes a corpus datum may take.
//
// REPRESENTATION POLICY (one datum → one form; no replication):
//   • FACTS are the default. A datum that is a RELATION (translation pair,
//     question → answer) is emitted as a (context → continuation) edge SEMA
//     points at and, by example across the corpus, generalizes from (cf.
//     example/demo.ts).
//   • EXPERIENCES (bare statements) are used only when a fact is NOT possible —
//     content with no natural relational split.
//   • CUMULATIVE CONTINUOUS CONTEXT is used only when truly necessary — genuine
//     MULTI-TURN dialogue, where a turn follows from the whole conversation so
//     far. The fact stages do NOT synthesize a multi-turn walk, which would just
//     replicate the facts (repetition SEMA avoids).
//
// Nothing here reads the environment or touches I/O: these are the pure
// functions every corpus adapter is built out of.

export interface Episode {
  context: string;
  continuation: string;
}
export type TrainingItem = string | Episode;

export const isEpisode = (it: TrainingItem): it is Episode =>
  typeof it !== "string";

/** One turn of a dialogue, attributed to a speaker. The speaker is only ever
 *  used to decide MERGING (see `mergeSpeakerTurns`); it is never deposited. */
export interface SpeakerTurn {
  // Upper-cased by the adapters, so USER/ASSISTANT (TM-1/2) and user/assistant
  // (TM-3/4) compare equal.
  speaker: string;
  text: string;
}

/** Build the accumulated-context episodes of a turn sequence: each successive
 *  turn is the continuation of ALL the turns before it joined together. This is
 *  the same cumulative-context shape a multi-turn conversation deposits, so the
 *  store learns to continue a growing context.
 *
 *  The "\n" below is a CORPUS choice, not a protocol.  oasst2 turns are
 *  paragraphs, and reading them back with the newlines kept is how this corpus
 *  reads naturally; a different corpus may join with nothing, and
 *  test/13-conversation.test.mjs does exactly that.  Neither has to match the
 *  other, because Sema never scans content for turn boundaries — those are
 *  offsets the Conversation API carries beside the bytes (see Mind.addTurn's
 *  "ON SEPARATORS" note).  The newline here is simply part of the text this
 *  store learnt, so anything replaying this corpus feeds it back as part of
 *  the turn: `addTurn(conv, "\n" + turnText)`.  It is not a convention the
 *  engine, the API, or the tests have to agree on. */
export function accumulate(turns: string[]): Episode[] {
  const out: Episode[] = [];
  for (let i = 1; i < turns.length; i++) {
    out.push({ context: turns.slice(0, i).join("\n"), continuation: turns[i] });
  }
  return out;
}

/** Collapse consecutive same-speaker turns into one, joining with a space, and
 *  return the bare texts in order. A turn with no speaker never merges with its
 *  neighbour: an unlabelled row is of unknown origin, and joining two of them
 *  would invent a contribution that may span two speakers.
 *
 *  Load-bearing for corpora that split one contribution across several indexed
 *  utterances (an artifact of the collection UI). Left unmerged, the cumulative
 *  walk deposits a turn boundary in the middle of one speaker's contribution
 *  and teaches it as a hand-off. Measured share of turns absorbed by merging:
 *  TM-1 17.7%, TM-2 11.9%, TM-3 0.8%, TM-4 0.0%. */
export function mergeSpeakerTurns(turns: SpeakerTurn[]): string[] {
  const out: string[] = [];
  let prev = "";
  for (const t of turns) {
    if (out.length > 0 && t.speaker !== "" && t.speaker === prev) {
      out[out.length - 1] += " " + t.text;
    } else {
      out.push(t.text);
    }
    prev = t.speaker;
  }
  return out;
}

/** Dedup + trim a concept's items: drop empty/degenerate pairs and exact
 *  repeats so a concept never deposits the same form twice. */
export function refineItems(items: TrainingItem[]): TrainingItem[] {
  const out: TrainingItem[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!isEpisode(it)) {
      const exp = it.trim();
      const key = "E:" + exp;
      if (exp && !seen.has(key)) {
        seen.add(key);
        out.push(exp);
      }
      continue;
    }
    const ctx = it.context.trim();
    const cont = it.continuation.trim();
    if (!ctx || !cont || ctx === cont) continue;
    const key = "P:" + ctx + "\u0000" + cont;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ context: ctx, continuation: cont });
  }
  return out;
}

const ENC = new TextEncoder();

/** Content size of a training item in UTF-8 bytes — the same quantity the
 *  scaling suite (14-scaling.test.mjs) measures as KB/s: for an episode the
 *  context plus the continuation, for a bare experience its own text. */
export const itemBytes = (it: TrainingItem): number =>
  isEpisode(it)
    ? ENC.encode(it.context).length + ENC.encode(it.continuation).length
    : ENC.encode(it).length;
