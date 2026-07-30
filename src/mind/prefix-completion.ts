// prefix-completion.ts — Completion of a query that IS the opening of a
// trained form.
//
// THE SHAPE.  `The capital of France is` grounds nothing, while
// `The capital of France is Paris.` is trained and reads back byte-exact.  The
// query is not SIMILAR to that form, it is a PROPER PREFIX of it: every query
// byte is a literal match, in order, from offset zero.  That is the strongest
// grounding relation in the store — stronger than the bridge's corroborated
// substitution, which pays a CONCEPT per substituted span, and stronger than
// resonance, which only claims an angle.  Nothing is invented here: the answer
// bytes are the trained remainder of a form the store already holds.
//
// WHY THE EARLIER TIERS CANNOT DO IT.  Two independent reasons, both measured:
//
//   1. `resolve(prefix)` is null.  A proper prefix of a deposited stream has no
//      branch of its own unless it was itself deposited, so the exact tiers
//      have nothing to find.
//   2. The form is not among the resonance candidates AT ALL.  Measured on the
//      trained store: cos(query, that form) = 0.5752, yet the form is absent
//      from `resonate(k)` at k = 24, 256 AND 2048 — while forms scoring LOWER
//      (Germany 0.5670, Yemen 0.5591) are returned.  `k` only reorders WITHIN
//      the IVF clusters already probed, exactly as Store.resonate's doc warns,
//      so no k recovers it.  With `exhaustive` it ranks 8.
//
// So this is a RETRIEVABILITY gap, not a semantic one, and it is repaired by
// reading the candidate list recall's refusal path has ALREADY fetched
// exhaustively for the substitution bridge — never by issuing a probe of its
// own.  Measured cost of the scan over those 570 candidates: 2.9 ms warm,
// 20.4 ms cold, against a ~700 ms refusal path.  Issuing a FRESH exhaustive
// call instead would cost 490 ms median against 13 ms non-exhaustive (36×),
// which is why this tier takes the list as an argument and adds nothing.
//
// THREE GUARDS, each one falsified into existence by measurement over the
// battery's 15 probes — do not drop any:
//
//   1. AN UNREADABLE COMPLETION VETOES.  Reads are bounded (a stored span can
//      run to hundreds of kilobytes), so a candidate that opens with the query
//      but SATURATES the read is a completion nobody can see.  It is treated as
//      a standing disagreement — if any such candidate exists, no completion is
//      licensed at all.
//      It must NOT be quietly skipped, and that is not a stylistic point: the
//      skip is what MANUFACTURES a fragment.  Measured on a one-deposit fixture
//      whose sentence exceeds the cap — the query matched BOTH node 28 (the
//      whole 138-byte form, saturating) and node 5 (an interior fold node of 34
//      bytes, unsaturated, remainder `"Paris, an"`).  Skipping the saturated
//      candidate removed the only evidence that disagreed, and uniqueness then
//      passed on the fragment and voiced a mid-sentence slice as an answer.
//      Suppressing the disagreement is what created the fabrication.
//      (Testing instead whether a candidate is a "complete trained form" via
//      the fold does NOT work and was measured: content addressing makes an
//      interior node resolve to ITSELF — node 5 above does — so self-resolution
//      says nothing about completeness.)
//   2. THE REMAINDER MUST HOLD A WORD.  `What is the capital of France?`
//      prefix-matches a trained `What is the capital of France??`, whose
//      remainder is the single byte `?`.  Voicing it would produce exactly the
//      degenerate 1–3-byte reply that is a known failure smell.  A remainder
//      must carry a run of at least W non-separator bytes to be an answer.
//   3. UNIQUENESS.  Several trained forms may open with the same words and
//      continue differently, and then the corpus does not say which completion
//      the asker means.  Distinct remainders ⇒ refuse.  This is the documented
//      PREFIX TRAP, and it is real — just not for every prefix.  Measured: of
//      15 probes exactly ONE yields a unique remainder, and all three honest
//      silence probes yield none (including `What is the capital of Zamunda?`,
//      whose top hit scores 0.83).
//
// Uniqueness is judged on the remainder BYTES, not on the candidate id: the
// same completion reached through two different trained forms is one answer,
// not an ambiguity.

import type { MindContext } from "./types.js";
import { trimEdgeSeparators } from "../bytes.js";
import { rItem } from "./trace.js";

/** A completion of the query by a trained form that opens with it. */
export interface PrefixCompletion {
  /** The trained form whose opening the query is. */
  id: number;
  /** The form's remainder after the query, edge-separators trimmed. */
  completion: Uint8Array;
}

/** True when `bytes` holds a run of at least `w` non-separator bytes. */
function holdsWord(bytes: Uint8Array, w: number): boolean {
  let run = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const sep = b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d ||
      b === 0x3f || b === 0x2e || b === 0x2c || b === 0x21 ||
      b === 0x22 || b === 0x27;
    if (sep) run = 0;
    else if (++run >= w) return true;
  }
  return false;
}

/** A stable key for a byte span — latin1, so no UTF-8 validation. */
function keyOf(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** The sole trained form that opens with `query`, completed — or null when no
 *  candidate opens with it, when the only remainders are degenerate, or when
 *  the candidates disagree about the completion.
 *
 *  `ranked` must be a list the caller has ALREADY fetched; this tier never
 *  issues a resonance of its own (see the header's cost note). */
export function prefixCompletion(
  ctx: MindContext,
  query: Uint8Array,
  ranked: ReadonlyArray<number>,
): PrefixCompletion | null {
  const W = ctx.space.maxGroup;
  const t = ctx.trace?.enter("prefixCompletion", [rItem(query, "query")]);
  const done = (
    hit: PrefixCompletion | null,
    note: string,
    data?: unknown,
  ): PrefixCompletion | null => {
    t?.done(
      hit === null ? [] : [rItem(hit.completion, "completion", hit.id)],
      note,
      data,
    );
    return hit;
  };
  // A completion shorter than a window cannot clear guard 2, so a query with
  // no room for one past the cap is not worth a single read.
  const cap = query.length * W;
  if (query.length === 0 || cap <= query.length + W) {
    return done(null, "query leaves no room for a completion within the cap");
  }

  // Distinct remainders, each with the first form that offered it.  Uniqueness
  // (guard 3) is decided over this map, so the scan cannot stop early: a second
  // remainder is the refusal, and finding it is the point.
  const byCompletion = new Map<string, PrefixCompletion>();
  let opened = 0;
  let saturated = 0;
  let degenerate = 0;
  let unreadable = false;
  for (const id of ranked) {
    const form = ctx.store.bytesPrefix(id, cap);
    if (form.length <= query.length) continue;
    let isPrefix = true;
    for (let i = 0; i < query.length; i++) {
      if (form[i] !== query[i]) {
        isPrefix = false;
        break;
      }
    }
    if (!isPrefix) continue;
    opened++;
    // Guard 1: a candidate that opens with the query but SATURATED the bounded
    // read is a completion we cannot see.  It must not be skipped — skipping it
    // is what manufactures the fragment (see the header) — it is a standing
    // disagreement, and a completion nobody can read is never licensed.
    if (form.length >= cap) {
      saturated++;
      unreadable = true;
      continue;
    }
    const rest = trimEdgeSeparators(form.subarray(query.length));
    // Guard 2: the remainder must carry a word, not just punctuation.
    if (!holdsWord(rest, W)) {
      degenerate++;
      continue;
    }
    const key = keyOf(rest);
    if (!byCompletion.has(key)) byCompletion.set(key, { id, completion: rest });
  }

  const data = {
    candidates: ranked.length,
    opened,
    saturated,
    degenerate,
    distinctCompletions: byCompletion.size,
  };
  // Guard 3: the corpus must agree on ONE completion.
  if (unreadable && byCompletion.size > 0) {
    return done(
      null,
      "a form opens with this query but runs past the read bound — its " +
        "completion cannot be read, so no completion is licensed",
      data,
    );
  }
  if (byCompletion.size !== 1) {
    return done(
      null,
      byCompletion.size === 0
        ? "no trained form opens with this query and completes it with a word"
        : "trained forms open with this query but complete it differently — " +
          "the corpus does not say which completion is meant",
      data,
    );
  }
  const [only] = byCompletion.values();
  return done(
    only,
    "one trained form opens with this query, and its remainder is a word",
    data,
  );
}
