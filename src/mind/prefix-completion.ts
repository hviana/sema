// prefix-completion.ts — Grounding a query that IS the opening of a trained
// form.
//
// THE SHAPE.  `The capital of France is` grounds nothing, while
// `The capital of France is Paris.` is trained and reads back byte-exact.  The
// query is not SIMILAR to that form, it is a PROPER PREFIX of it: every query
// byte is a literal match, in order, from offset zero.  That is the strongest
// grounding relation in the store — stronger than the bridge's corroborated
// substitution, which pays a CONCEPT per substituted span, and stronger than
// resonance, which only claims an angle.  Nothing is invented: the answer IS a
// trained form, voiced whole.
//
// NO NOTION OF TEXT.  This mechanism reads bytes and geometry only.  It has no
// separator, no character class, no "word": the only structural quantity it
// uses is W, the river's grouping window, which is the same capacity the
// perception tree groups by and the same bar the argument-binding tier holds
// its constituents to.  A completion shorter than one grouping window carries
// no structure the geometry can perceive, whatever the modality — that is a
// statement about the fold, not about punctuation.  Presentation (what is
// "spacing", what is "case") belongs to the injected canon and to the modality
// entry point, never here; see src/canon.ts.
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
// exhaustively for the substitution bridge — never by resonating on its own.
// Measured cost of the scan over those 570 candidates: 2.9 ms warm, 20.4 ms
// cold, against a ~700 ms refusal path.  Issuing a FRESH exhaustive call would
// cost 490 ms median against 13 ms non-exhaustive (36×), which is why this tier
// takes the candidate list as an argument and adds nothing to it.
//
// THREE GUARDS, each falsified into existence by measurement — do not drop any:
//
//   1. AN UNREADABLE CONTINUATION VETOES.  Reads are bounded (a stored span can
//      run to hundreds of kilobytes), so a candidate that opens with the query
//      but SATURATES the read continues in a way nobody can see.  It is a
//      standing disagreement: if any such candidate exists, nothing is grounded.
//      It must NOT be quietly skipped, and that is not a stylistic point — the
//      skip is what MANUFACTURES a fragment.  Measured on a one-deposit fixture
//      whose form exceeds the cap: the query matched BOTH the whole 138-byte
//      form (saturating) AND an interior fold node of 34 bytes (unsaturated,
//      continuing `" Paris, an"`).  Skipping the saturated candidate removed the
//      only evidence that disagreed, uniqueness then passed on the interior
//      node, and a mid-form slice was voiced as an answer.  Suppressing the
//      disagreement is what created the fabrication.
//      (Testing instead whether a candidate is a "complete form" via the fold
//      does NOT work and was measured: content addressing makes an interior
//      node resolve to ITSELF, so self-resolution says nothing about
//      completeness.)
//   2. THE CONTINUATION MUST REACH ONE GROUPING WINDOW.  A trained
//      `What is the capital of France??` opens with `What is the capital of
//      France?` and continues by a single byte.  Below W the continuation is
//      sub-quantum — the fold groups nothing from it — and voicing it produces
//      the degenerate reply that is a known failure smell.
//   3. UNIQUENESS.  Several trained forms may open with the query and continue
//      differently, and then the corpus does not say which continuation the
//      asker means.  Distinct continuations ⇒ refuse.  This is the documented
//      PREFIX TRAP, and it is real — just not for every prefix.  Measured: of
//      15 battery probes exactly ONE yields a unique continuation, and all
//      three honest-silence probes yield none (including `What is the capital
//      of Zamunda?`, whose top hit scores 0.83).
//
// Uniqueness is judged on the continuation BYTES, not on the candidate id: the
// same continuation reached through two trained forms is one answer, not an
// ambiguity.

import type { MindContext } from "./types.js";
import { bytesEqual } from "../bytes.js";
import { rItem } from "./trace.js";
import { canonicalWindows, leafIdPrefix } from "./canonical.js";
import { hubBound } from "./traverse.js";

/** Trained forms the query may OPEN, proposed from the write side's own
 *  leaf-id window index — the supply of last resort for {@link
 *  prefixCompletion}.
 *
 *  WHY A SECOND SUPPLY EXISTS.  The ranked list this mechanism normally reads
 *  is a resonance list, and resonance cannot rank a proper prefix: measured on
 *  the trained store, cos(prefix, form) falls from 0.9629 at a one-byte
 *  truncation to 0.6206 at three bytes, against a reachThreshold of 0.8750.
 *  Three bytes of truncation put the answer out of reach on GEOMETRY, not on a
 *  bug, so no k and no re-ranking recovers it.
 *
 *  WHY THIS ROUTE WORKS WHERE THE FOLD DOES NOT.  A query's own fold is
 *  useless here: content addressing is not phrase-position-invariant, so a
 *  standalone prefix folds to a DIFFERENT node than the same bytes sitting
 *  inside a longer deposit, and neither the prefix's own node nor its
 *  ancestors lead to the deposit (measured: the 22-byte prefix of the
 *  photosynthesis form resolves, is shared by 6 contexts, and does not have
 *  the form among its ancestors).  Leaf ids ARE position-invariant — they are
 *  content-addressed on single bytes — and `indexSubSpans` already interns a
 *  flat branch over every canonical WINDOW of a deposit's leaf-id stream, with
 *  containment edges to the chunks that window spans.  A query that is a
 *  prefix therefore shares those window nodes exactly, and reaches the deposit
 *  by climbing containment then parents.  Nothing is added to the write side;
 *  this reads an index training already built.
 *
 *  BOUNDED (§2.8), AND WITH NO NEW THRESHOLD.  The window whose containment is
 *  SMALLEST carries the most evidence, and one saturated at `hubBound` carries
 *  none — that is the same √N reading of "hub" the rest of the mind uses, not
 *  a tuned knob.  The upward walk spends a budget of `hubBound` nodes and
 *  fans out by W, so a hub query enumerates nothing and the caller stays
 *  silent rather than guessing (§2.13).  Measured on the trained store: the
 *  photosynthesis form at a one-byte truncation picks a window with 52
 *  containers, visits 446 nodes, and yields exactly ONE candidate that
 *  survives the caller's byte compare — the form itself.
 *
 *  These are PROPOSALS only.  Every candidate still faces the byte-exact
 *  prefix compare and all three guards below, so a wrong proposal costs one
 *  bounded read and can never be voiced (§2.3). */
export function prefixCandidates(
  ctx: MindContext,
  query: Uint8Array,
): number[] {
  const store = ctx.store;
  const W = ctx.space.maxGroup;
  const run = leafIdPrefix(ctx, query);
  // The widest canonical window is the most discriminative one the write side
  // ever interned; a query too short to spell one carries no window evidence.
  const len = canonicalWindows(W)[1];
  if (run.length < len) return [];
  const bound = hubBound(ctx);

  let best: number | null = null;
  let bestN = 0;
  for (let off = 0; off + len <= run.length; off++) {
    const wid = store.findBranch(run.slice(off, off + len));
    if (wid === null) continue;
    const n = store.containersSlice(wid, 0, bound).length;
    // Empty says the window spans no chunk; saturated says it is a hub, whose
    // containment discriminates nothing.  Neither is evidence.
    if (n === 0 || n >= bound) continue;
    if (best === null || n < bestN) {
      best = wid;
      bestN = n;
    }
  }
  if (best === null) return [];

  let frontier = store.containersSlice(best, 0, bound);
  const seen = new Set<number>(frontier);
  let budget = bound;
  while (frontier.length > 0 && budget > 0) {
    const next: number[] = [];
    for (const f of frontier) {
      if (budget-- <= 0) break;
      for (const p of store.parentsFirst(f, W)) {
        if (seen.has(p)) continue;
        seen.add(p);
        next.push(p);
      }
    }
    frontier = next;
  }
  return [...seen];
}

/** A trained form the query opens, and the bytes by which it continues. */
export interface PrefixCompletion {
  /** The trained form whose opening the query is — the answer, voiced whole. */
  id: number;
  /** The form's own bytes.  The mechanism grounds a FORM, never a slice of
   *  one: slicing at the query's end would cut at an offset the geometry has
   *  no reason to treat as a boundary. */
  form: Uint8Array;
  /** The bytes past the query — carried for the rationale and for the
   *  uniqueness comparison, not voiced on its own. */
  continuation: Uint8Array;
}

/** The sole trained form the query opens — or null when no candidate opens with
 *  it, when the continuation is sub-quantum, when a candidate's continuation
 *  cannot be read through, or when the candidates disagree.
 *
 *  `ranked` must be a list the caller has ALREADY fetched; this mechanism never
 *  resonates on its own (see the header's cost note). */
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
      hit === null ? [] : [rItem(hit.continuation, "continuation", hit.id)],
      note,
      data,
    );
    return hit;
  };
  // Reads are bounded to phrase scale, the same bound the frame filler uses.
  // A query with no room for a whole grouping window past its own length
  // cannot clear guard 2, so it is not worth a single read.
  const cap = query.length * W;
  if (query.length === 0 || cap < query.length + W) {
    return done(null, "no room for a perceivable continuation within the cap");
  }

  // Distinct continuations, each with the first form that offered it.  Held as
  // a list, not a byte-keyed map: candidates that open with the query are few
  // (measured: 1 on the trained store's winning query), and a linear byte
  // compare needs no string encoding of content.  Uniqueness (guard 3) is
  // decided over this list, so the scan cannot stop early — a second
  // continuation IS the refusal, and finding it is the point.
  const found: PrefixCompletion[] = [];
  let opened = 0;
  let unreadable = 0;
  let subQuantum = 0;
  for (const id of ranked) {
    const form = ctx.store.bytesPrefix(id, cap);
    if (form.length <= query.length) continue;
    let opens = true;
    for (let i = 0; i < query.length; i++) {
      if (form[i] !== query[i]) {
        opens = false;
        break;
      }
    }
    if (!opens) continue;
    opened++;
    // Guard 1: a saturated read continues out of sight — a disagreement that
    // cannot be resolved, so it ends the search rather than being skipped.
    if (form.length >= cap) {
      unreadable++;
      continue;
    }
    const rest = form.subarray(query.length);
    // Guard 2: below one grouping window there is no structure to voice.
    if (rest.length < W) {
      subQuantum++;
      continue;
    }
    if (!found.some((f) => bytesEqual(f.continuation, rest))) {
      found.push({ id, form, continuation: rest });
    }
  }

  const data = {
    candidates: ranked.length,
    opened,
    unreadable,
    subQuantum,
    distinctContinuations: found.length,
  };
  if (unreadable > 0 && found.length > 0) {
    return done(
      null,
      "a form opens with this query but continues past the read bound — " +
        "its continuation cannot be read, so none is licensed",
      data,
    );
  }
  // Guard 3: the corpus must agree on ONE continuation.
  if (found.length !== 1) {
    return done(
      null,
      found.length === 0
        ? "no trained form opens with this query and continues perceivably"
        : "trained forms open with this query but continue differently — " +
          "the corpus does not say which continuation is meant",
      data,
    );
  }
  return done(
    found[0],
    "one trained form opens with this query, and continues perceivably",
    data,
  );
}
