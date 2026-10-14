// bridge.ts — corroborated-substitution grounding (recall's last tier before
// refusal).
//
// THE GAP (test/49): a query phrased through a near-synonym of a trained
// word ("Name the biggest planet." against a corpus that only ever says
// "largest planet") reaches nothing — recognition finds no form, whole-query
// resonance stays below the reach bar — even though the fact is trained and
// the synonym pairing is corroborated across the corpus.  Words are never
// independently addressable nodes (deposit interns whole streams plus W-1/W
// leaf windows; a word mid-sentence falls between those scales), so no halo
// ever links "biggest" to "largest" — and the write side cannot cheaply
// mint such nodes without polluting the shared indexes (measured: an
// earlier write-side attempt regressed 24 unrelated tests).
//
// THE MECHANISM — read-only, refusal-path-only.  When recall is about to
// refuse, the query's own content-addressed windows (the W-byte leaf-id
// flat branches indexSubSpans already interns at every byte offset) are
// probed against the store; the rarest ones pick, among recall's ranked
// hits, the trained contexts that hold them.  Each candidate is READ against
// the query as `reference` reads a frame instance (`frameSlots`: one
// monotone chain, the gaps it leaves); a mismatch grounds as a SUBSTITUTION
// only under two derived gates:
//
//   • CORROBORATION — the query-side span is itself corpus-attested: every
//     W-window inside it resolves as a stored flat form, at least one of
//     them reused across ≥ 2 containers (the same "≥ 2 structural parents"
//     bar propagateSuffixes gates suffix inheritance with).  An untrained
//     word ("deadliest") has no stored windows and can never substitute.
//   • GRADED IDENTITY — lexical geometry is tried first at
//     conceptThreshold(D). Differently-spelled forms fall through to VSA
//     company: their stored W-window occurrences ascend to learned episodes,
//     whose bundled halos must clear significanceBar(D), the same
//     distributional-evidence bar used by analogyStrength.
//
// A candidate context is accepted when every unexplained gap, and each of
// its edges, stays within one perception window W (the same single-window
// tolerance identityBar prices).  The accepted context is
// then grounded exactly like any recall hit — project() through its learnt
// edges — so the answer is a trained continuation, never synthesized bytes.
//
// COST: nothing on any answering path — the bridge runs only where the
// alternative was silence.  There it pays O(|query|) content-hash probes
// (the propagateSuffixes trick), at most W anchor climbs and
// 2·recallQueryK candidate reads, and one
// O(|query|·|candidate|)-bounded alignment each.
//
// FIXED WRONG-ANSWER GAP (found and closed 2026-07-20): a proper-noun swap
// could pass both derived gates above and voice a WRONG fact.  Live case:
// "The capital of France is" (a prefix-completion probe) bridged through a
// substitution reading "of Fra[nce]" as "of Spain si[nce]" into "Madrid has
// been the capital of Spain since 1561...", because the TRUE France fact
// ("The capital of France is Paris.") is a terminal statement with no
// outgoing edge and is therefore never admitted as a bridge candidate (§
// candidate admission above) — so no competing evidence for "France" was
// ever collected, and the Spain candidate's own text satisfied frame
// unanimity vacuously (nothing to disagree with).
//   REFUTED FIX 1 — require unanimous()'s frame-consensus scan to find a
//     genuine corroborating occurrence (not vacuous-true on zero evidence):
//     breaks test/49 — "biggest"~"largest" is corroborated ONLY by the very
//     candidate proposing the substitution in that miniature corpus (no
//     OTHER trained pair pairs either word with "planet"); requiring
//     external evidence makes that legitimate case fail too.
//   REFUTED FIX 2 — exclude the candidate's own bytes from being its own
//     corroborating witness (same idea, scoped to self-reference): same
//     failure, same reason — self-witness is ALL the evidence test/49 has.
//   REFUTED FIX 3 — require the CANDIDATE-side substituted span to also
//     clear the ≥2-container reuse bar (attestedSpan, symmetric with the
//     query-side attestedQ): does not discriminate — "Spain" is reused
//     across at least as many trained contexts as "France" is, so it
//     passes trivially.
//   THE ACTUAL FIX — RAW BALANCE (see the substitution loop below): the raw
//     mismatch (BEFORE expansion absorbs any matched flanking bytes) must
//     be roughly length-balanced on both sides — dominates(min(uLen,cLen),
//     max(uLen,cLen)), the SAME "part*2 > whole" bar used throughout the
//     codebase, no new constant.  Measured on both cases: the legitimate
//     "biggest"~"largest" substitution's raw diff is "big"/"lar" (3/3
//     bytes, perfectly balanced — expansion then absorbs the shared "gest"
//     suffix, identical on both sides, to reach an attestable span).  The
//     wrong "France"~"Spain" substitution's raw diff was "Fra"/"Spai" (3/8
//     bytes) — the align sweep's greedy search had found a coincidental
//     "nce " match years later inside "since", so 3 bytes of query content
//     were standing in for 8 bytes of candidate content.  That asymmetry is
//     exactly what a real lexical/morphological synonym never has and an
//     arbitrary sentence divergence always does; expansion (which only
//     grows both sides by IDENTICAL absorbed bytes) can never repair a raw
//     imbalance, so gating on the RAW gap is the correct point of attack.
//     Verified: real-store repro now falls through to an honest echo of
//     the true trained fact instead of the wrong Spain continuation; the
//     boiling-point and lowercase-France bridge wins are unaffected; full
//     suite green (358/358).

import { cosine, type Vec } from "../vec.js";
import {
  AGREEMENT,
  conceptThreshold,
  dominates,
  significanceBar,
  twoQuanta,
} from "../geometry.js";
import { bytesEqual, indexOf } from "../bytes.js";
import type { MindContext } from "./types.js";
import { exactNode, perceive } from "./primitives.js";
import { chainReach, windowAt, windowIds } from "./canonical.js";
import { unexplainedSpans } from "./derivation.js";
import {
  allWindowsAreScaffolding,
  hubBound,
  hubWindows,
  spanHalo,
  windowRarity,
} from "./traverse.js";
import { rItem, rNode } from "./trace.js";
import { type AlignGap, type FrameInstance } from "./match.js";

/** One accepted substitution: query span [qs,qe) stands in for the
 *  candidate context's span — recorded for the rationale trace.  The same
 *  shape the shared aligner reports a disagreement as ({@link AlignGap}); an
 *  accepted substitution is a gap that cleared this file's gates. */
type Substitution = AlignGap;

/** A bridged grounding proposal: the trained context to ground, the query
 *  spans its alignment accounts for, and the substitutions that closed it. */
export interface BridgeHit {
  id: number;
  accounted: Array<[number, number]>;
  subs: Substitution[];
}

/** True when some query byte-range left UNACCOUNTED by `spans` contains a
 *  STORED window — content the store has seen that the proposed reading
 *  simply ignores.  The IGNORED-KNOWN principle: a span may be dismissed
 *  only when the store itself has never seen it; known content the
 *  alignment failed to account for is grounds for refusal, while genuinely
 *  novel spans (an untrained word, stray punctuation) remain tolerable.
 *  Shared by the substitution bridge's own acceptance and CAST's
 *  frame-tier comparison gate (cast.ts).  Pure attestation — no
 *  similarity, no constants. */
export function dismissedKnownContent(
  ctx: MindContext,
  query: Uint8Array,
  spans: ReadonlyArray<readonly [number, number]>,
): boolean {
  const W = ctx.space.maxGroup;
  for (const [a, b] of unexplainedSpans(query.length, spans)) {
    for (let o = a; o + W <= b; o++) {
      if (windowAt(ctx, query, o) !== null) return true;
    }
  }
  return false;
}

/** Recall's corroborated-substitution bridge — see the module comment.
 *  Returns the best bridged grounding proposal, or null. */
/** `proposed` is a THUNK, not a list: the bridge's own cheap gates (the
 *  two-quantum query floor and the O(|query|) stored-window anchor scan) decide
 * whether ANY candidate can be aligned, and they need no proposals to do it.
 * Resolving the caller's proposals eagerly meant recall paid its exhaustive
 * whole-index resonance — the most expensive single act on the refusal path —
 * for every query, including the ones whose windows the store has never seen
 * and which the anchor scan rejects outright. Same investment discipline the
 * mechanism floors follow (mechanism-market.md): never compute a shared
 * analysis just to discard it. */
export async function substitutionBridge(
  ctx: MindContext,
  query: Uint8Array,
  proposed: () => Promise<ReadonlyArray<FrameInstance>> = async () => [],
): Promise<BridgeHit | null> {
  const meter = ctx.meter;
  return meter
    ? meter.time("substitutionBridge", () => bridgeImpl(ctx, query, proposed))
    : bridgeImpl(ctx, query, proposed);
}

async function bridgeImpl(
  ctx: MindContext,
  query: Uint8Array,
  proposed: () => Promise<ReadonlyArray<FrameInstance>>,
): Promise<BridgeHit | null> {
  const W = ctx.space.maxGroup;
  if (query.length < twoQuanta(W)) return null;
  const bound = hubBound(ctx);
  const bar = conceptThreshold(ctx.store.D);
  const synonymBar = significanceBar(ctx.store.D);
  const reachCap = chainReach(W);
  const diagnostics = ctx.trace
    ? {
      anchors: 0,
      picked: 0,
      proposed: 0,
      proposedGrounded: 0,
      synonymChecks: 0,
      bestSynonym: 0,
      phraseScale: 0,
      aligned: 0,
      structurallyValid: 0,
      coverageValid: 0,
      identityValid: 0,
      knownContentValid: 0,
      bestCovered: 0,
      bestRank: -1,
      closest: [] as Array<{
        id: number;
        covered: number;
        leading: number;
        trailing: number;
        gaps: number;
        substitutions: number;
        queryGapBytes: number;
        candidateGapBytes: number;
        gapRanges: Array<[number, number, number, number]>;
        candidateSurplus: number;
        gapsExplained: boolean;
      }>,
    }
    : null;

  // PHRASE-SCALE CANDIDATE CAP — the same |content|·W bound the weave
  // (pipeline-mechanism.ts), the cross-region junction ladder's
  // `maxInterior`, and structural resonance's `maxSiblingBytes` all apply,
  // for the same reason and now at the one remaining place that read
  // candidate contexts WHOLE.
  //
  // The bridge accepts a candidate only when the query is DOMINATED by its
  // matched runs plus substitutions, with at most one window W of slack at
  // each edge and at most one chain reach (W²) per interior gap — so the
  // candidate region an accepted alignment can ever consume is bounded by
  // |query|·W.  Content beyond that cannot participate in any alignment
  // this function would accept; reading it is pure cost.  And a candidate
  // an order of magnitude past the query is not a paraphrase of it: it is a
  // document or a whole conversation that merely quotes a phrase, and
  // grounding through ITS learnt edge voices that document's continuation,
  // not a phrase answer.
  //
  // Measured on the 17.7M-node / 325K-context store: uncapped, the refusal
  // path materialised up to ~1 MB of candidate bytes per query (up to √N
  // proposals plus √N climbed contexts, each read in full), and the frame-
  // unanimity scan — which walks EVERY collected candidate's bytes, inside
  // the per-gap expansion loop — paid that volume back tens of times per
  // substitution.  Recall's run() was 0.7–2.6 s per refusing query.
  // 1. The query's stored windows, rarest first (fewest containers — the
  //    most discriminative anchors; hub-clamped like every fan-out read).
  //    The scan doubles as the ONE store probe of every query window: the
  //    per-offset stored/reused facts it establishes serve every later
  //    attestation and ignored-known check as plain array reads (the same
  //    probes repeated per candidate dominated the refusal-path cost).
  const nWin = Math.max(0, query.length - W + 1);
  const winReused = new Uint8Array(nWin);
  const anchors: Array<{ off: number; id: number; rarity: number }> = [];
  for (const [o, id] of windowIds(ctx, query)) {
    const rarity = windowRarity(ctx, id, bound + 1);
    if (rarity >= AGREEMENT) winReused[o] = 1;
    if (rarity === 0) continue;
    anchors.push({ off: o, id, rarity });
  }
  if (diagnostics) diagnostics.anchors = anchors.length;
  if (anchors.length === 0) {
    ctx.trace?.step(
      "substitutionBridge",
      [rItem(query, "query")],
      [],
      "no stored query window can anchor a corroborated substitution",
      undefined,
      diagnostics!,
    );
    return null;
  }
  // NO DISCRIMINATING LITERAL EVIDENCE — abstain (INVARIANTS.md). A bridge
  // grounds through the literal spans it did NOT substitute; those anchors are
  // the whole of its evidence. When every one of them is SATURATED —
  // containment clamped at the √N hub bound, i.e. the window is corpus-global
  // scaffolding — the query's unsubstituted part discriminates nothing, and the
  // single substituted span is carrying the entire semantic load. That is not a
  // corroborated bridge; it is a template match, and it FABRICATES.
  //
  // Measured on the trained store (hubBound 571).  "What is the capital of"
  // has 19 anchors, ALL saturated ("What":572, "hat ":572, "at i":572 …), and
  // bridged to an unrelated trained context about an integral, voiced
  // confidently.  Every query the bridge answers CORRECTLY has at least one
  // unsaturated anchor, by a wide margin and with no near miss:
  // "Who is the author of Hamlet?" → "let?":12, "How do you say 'thank you'
  // in French?" → "y 't":3, "…largest planet…" → "tem?":31, "What is the
  // capital of France?" → "f Fr":114.  The honest-silence probes sit on the
  // same side as the correct ones ("Zamu":3), so this gate is not what makes
  // them silent and cannot be credited for them.
  //
  // This introduces NO new threshold: `bound` is the same √N reading of "hub"
  // the anchor scan already clamps its own containment read to (thresholds.md,
  // commonality.md).
  if (allWindowsAreScaffolding(ctx, query)) {
    ctx.trace?.step(
      "substitutionBridge",
      [rItem(query, "query")],
      [],
      "every query window that could anchor is corpus-global scaffolding — " +
        "no literal evidence to corroborate a substitution",
      undefined,
      diagnostics!,
    );
    return null;
  }
  // CORROBORATION (see the module-level doc) over the precomputed window
  // facts: the query span [qs,qe) attests when every full W-window inside
  // it is a stored flat form and at least one is reused across ≥ 2
  // containers.  Spans shorter than W carry no window of their own and can
  // never substitute.
  const attestedQ = (qs: number, qe: number): boolean => {
    if (qe - qs < W) return false;
    let reused = false;
    for (let o = qs; o + W <= qe; o++) {
      if (windowAt(ctx, query, o) === null) return false;
      if (winReused[o]) reused = true;
    }
    return reused;
  };
  // ── EXPLAINED SPANS — the scaffolding judgement, corpus-global ──────────
  //
  // The question every gap poses is "may the two forms differ HERE without
  // differing in what they SAY?", and that is the discriminative-vs-
  // scaffolding question commonality.md names, over the CORPUS-GLOBAL
  // population. It already has one definition — `dominates(reachOf(...), N)`,
  // the same gate confluence's filler test uses ("scaffolding never binds").
  // Nothing new is derived here; the bar is read, not invented.
  //
  // A span is explained when EITHER
  //   • it is sub-quantum (< W) — typographic glue, the tolerance identityBar
  //     already prices ("below one river window, byte overlap is chance"); or
  //   • every full W-window inside it is COMMON by the store's own climb:
  //     the ascent SATURATES (the window sits in more places than √N — the
  //     climb's own definition of non-discriminative), or it resolves to a
  //     majority of the corpus's contexts.  "the process of ", " is the ".
  //
  // THE READING MATTERS, not just the population — see commonality.md. This
  // deliberately does NOT go through `reachOf`, which maps BOTH "saturated" and
  // "reaches nothing" to Infinity. For IDF weighting those are the same thing
  // (no usable identity evidence); for THIS question they are opposites — a
  // window reaching nothing is novel content, the most discriminative material
  // there is, and reading it as Infinity would call it scaffolding. Measured:
  // with `reachOf`, "Is water wet?" was answered with "No, heavy water is not
  // wet." — "heav"/"eavy" occur once, reach no edge-bearing ancestor, and were
  // written off as filler. So an empty-rooted window is NEVER explained, and
  // neither is an untrained one (the same principle attestedQ applies to the
  // query side).
  const explainedSpan = (
    bytes: Uint8Array,
    from: number,
    to: number,
  ): boolean => {
    if (to - from < W) return true;
    // Common content: every window of it a hub (`hubWindows`, the one
    // reading of a window's commonness — its containers past the read
    // allowance).  (A reading of its own — saturated, or reaching a corpus
    // majority — was measured to decide the same on the suite and the 2Wiki
    // fixtures.)
    const common = (start: number, end: number): boolean => {
      if (end - start < W) return false;
      const hub = hubWindows(ctx, bytes);
      for (let o = start; o + W <= end; o++) if (!hub[o]) return false;
      return true;
    };
    if (common(from, to)) return true;
    // Alignment may attach the shared delimiter to either side of an inserted
    // phrase. Up to W-1 boundary bytes are below the fold's identity scale;
    // classify the phrase by a full-window interior core when one exists.
    // This does not erase a short discriminative insertion: "heavy" still
    // leaves the full `heav`/`eavy` windows for the corpus-global test.
    for (let left = 0; left < W; left++) {
      for (let right = 0; right < W; right++) {
        if (left + right === 0 || left + right >= W) continue;
        if (common(from + left, to - right)) return true;
      }
    }
    return false;
  };

  anchors.sort((a, b) => a.rarity - b.rarity);
  // Up to W anchors, at least one window apart — the quantum's own count.
  const picked: typeof anchors = [];
  for (const a of anchors) {
    if (picked.length >= W) break;
    if (picked.some((p) => Math.abs(p.off - a.off) < W)) continue;
    picked.push(a);
  }
  if (diagnostics) diagnostics.picked = picked.length;
  // 2. Candidate trained contexts: the caller's PROPOSED hits — recall's
  //    whole-query resonance ranking — holding a picked anchor window.  Only
  //    ever PROPOSALS: every candidate passes the byte-exact reading and gates
  //    below.  (Two further channels — each picked anchor climbed to its
  //    edge-bearing ancestors, and junction containers of anchor-window pairs
  //    — were measured to propose nothing this one missed, and removed.)
  const seen = new Set<number>();
  const candidates: Array<{ use: number; inst: FrameInstance }> = [];
  const instances = await proposed();
  if (diagnostics) diagnostics.proposed = instances.length;
  for (const inst of instances) {
    if (seen.has(inst.id)) continue;
    seen.add(inst.id);
    const tb = inst.bytes;
    if (
      !picked.some((a) => indexOf(tb, query.subarray(a.off, a.off + W), 0) >= 0)
    ) continue;
    let use = inst.id;
    if (!ctx.store.hasNext(use)) {
      const folded = exactNode(ctx, tb);
      if (folded === null || folded === use || !ctx.store.hasNext(folded)) {
        continue;
      }
      use = folded;
      if (seen.has(use)) continue;
      seen.add(use);
    }
    candidates.push({ use, inst });
    if (diagnostics) diagnostics.proposedGrounded++;
  }
  // A proposal may be a FLAT content twin whose continuation edge lives on
  // the fold-shaped deposit node with the same bytes — the same twin split
  // canonResolve bridges by re-folding (primitives.ts) — but the re-fold is
  // paid only for proposals that hold a picked anchor window.
  //
  // Frame unanimity reads the COMPLETE collected population, in order.
  if (diagnostics) diagnostics.phraseScale = candidates.length;
  const unanimous = (
    u: Uint8Array,
    c: Uint8Array,
    lf: Uint8Array,
    rf: Uint8Array,
  ): boolean => {
    for (const { inst: { bytes } } of candidates) {
      let from = 0;
      for (;;) {
        const i = indexOf(bytes, lf, from);
        if (i < 0) break;
        from = i + 1;
        const start = i + lf.length;
        const j = indexOf(
          bytes.subarray(start, start + reachCap + rf.length),
          rf,
          0,
        );
        if (j < 0) continue;
        const filler = bytes.subarray(start, start + j);
        if (filler.length === 0) continue;
        if (!bytesEqual(filler, u) && !bytesEqual(filler, c)) return false;
      }
    }
    return true;
  };

  // (A candidate need NOT contain the query's rarest window literally: the
  // rarest window may sit INSIDE the very word being substituted (observed
  // live: "chemical symbol for water" whose rarest window "l sy" spans
  // "symbol" — the trained formula-question can never contain it).  A
  // candidate that instead dodges the query's known content by writing it
  // off as gaps is refused by dismissedKnownContent below, which subsumes
  // the old rarest-window containment gate: rare windows inside an accepted
  // substitution are accounted for; rare windows outside the accepted spans
  // force refusal (the Matrix-synopsis junk stays dead by exactly that
  // check — verified live).
  let best: BridgeHit | null = null;
  let bestAccounted = 0;
  const queryHaloMemo = new Map<string, Vec | null>();
  const candidateHaloMemo = new Map<string, Vec | null>();
  for (
    let candidateIndex = 0;
    candidateIndex < candidates.length;
    candidateIndex++
  ) {
    const { use: sid, inst } = candidates[candidateIndex];
    const cBytes = inst.bytes;
    // THE SAME READING `reference` takes of a candidate (`frameSlots`, read
    // once per response by `Precomputed.frames`): one monotone chain from the
    // origin, each gap with its raw borders.  Gaps outside the first and last
    // matched run are the edges the coverage test below reads, not mismatches.
    const matched = inst.matched.filter(([s0, e0]) => e0 > s0);
    const first = matched.length > 0 ? matched[0][0] : query.length;
    const last = matched.length > 0 ? matched[matched.length - 1][1] : 0;
    const gaps = inst.slots
      .filter((sl) => sl.gq[0] >= first && sl.gq[1] <= last)
      .map((sl) => ({
        qs: sl.gq[0],
        qe: sl.gq[1],
        cs: sl.gc[0],
        ce: sl.gc[1],
      }));
    if (diagnostics) diagnostics.aligned++;

    // Investment gate: even treating every two-sided mismatch as a valid
    // synonym, can this alignment satisfy the bridge's final coverage rule?
    // Distributional span composition performs bounded ancestor climbs; never
    // pay for it on a candidate arithmetic already proves cannot win.
    let matchStart = query.length;
    let matchEnd = 0;
    let potential = 0;
    for (const [s, e] of matched) {
      matchStart = Math.min(matchStart, s);
      matchEnd = Math.max(matchEnd, e);
      potential += e - s;
    }
    for (const g of gaps) {
      if (g.qe > g.qs && g.ce > g.cs) potential += g.qe - g.qs;
    }
    if (
      matchStart > W || query.length - matchEnd > W ||
      !dominates(potential, query.length)
    ) continue;

    // Gate each mismatch: a corroborated, geometrically-identified
    // substitution counts as accounted; anything else stays a gap.
    //
    // A raw mismatch is the MINIMAL byte diff ("big" ↔ "lar" inside
    // biggest/largest), usually below the scale at which either side is a
    // corpus unit.  The true unit is found by EXPANSION: absorb flanking
    // bytes from the adjacent matched runs (equal on both sides by
    // construction, so both spans grow identically) until the query side
    // attests and the pair clears the concept bar — smallest expansion
    // first, capped at chainReach like the mismatch itself.  Absorbed
    // bytes were already matched, so coverage is unchanged.
    const subs: Substitution[] = [];
    let ok = true;
    for (const g of gaps) {
      const uLen = g.qe - g.qs, cLen = g.ce - g.cs;
      if (uLen === 0 || cLen === 0 || uLen > reachCap || cLen > reachCap) {
        // Pure insertion/deletion or over-long mismatch.  Query-side: one
        // perception window (the identityBar tolerance).  Candidate-side:
        // one chain reach (W², the two-level composite bound) — a genuine
        // paraphrase inserts inflection-scale material ("does water boil"
        // ↔ "should water be boiled"), while a divergent candidate jumps
        // hundreds of bytes between the query's frames.
        if (uLen > W || cLen > reachCap) ok = false;
        continue;
      }
      // RAW BALANCE gate (closes the OPEN GAP above): the two sides of a
      // genuine lexical substitution swap comparable amounts of content —
      // "big"/"lar" (3/3 bytes, before expansion absorbs the shared "gest"
      // suffix to reach an attestable "biggest"/"largest").  A candidate
      // whose two sentences simply diverge into unrelated continuations
      // produces a LOPSIDED raw mismatch instead — the live wrong answer's
      // raw gap was "Fra"/"Spai" widened to (3,8) by the align sweep
      // finding a coincidental "nce " match years later in "since" — 3
      // bytes of query content standing in for 8 bytes of candidate
      // content is not a word swap, it is two different sentences that
      // happen to share a few letters.  Uses the SAME dominates() bar
      // (part*2 > whole) applied throughout the codebase, symmetrically:
      // the smaller raw side must be more than half the larger.  Applies
      // to the RAW gap for GEOMETRIC identity, before expansion — expansion
      // only ever grows both sides by IDENTICAL absorbed bytes, so it cannot
      // fix an imbalance that was already there. Distributional synonym
      // evidence is exempt: two phrases may occupy the same role at very
      // different lengths.
      let accepted = false;
      const balanced = dominates(Math.min(uLen, cLen), Math.max(uLen, cLen));
      const maxExtra = reachCap - Math.max(uLen, cLen);
      outer:
      for (let extra = 0; extra <= maxExtra; extra++) {
        for (let a = 0; a <= extra; a++) {
          const b = extra - a;
          const qs2 = g.qs - a, qe2 = g.qe + b;
          const cs2 = g.cs - a, ce2 = g.ce + b;
          if (qs2 < 0 || qe2 > query.length) continue;
          if (cs2 < 0 || ce2 > cBytes.length) continue;
          // INTERIOR gate: a substitution must sit INSIDE matched
          // structure — at least one full window of matched bytes must
          // remain adjacent on BOTH sides after absorption.  Every junk
          // substitution observed live sat at the query's edge, with only
          // terminal punctuation beyond it ("…born in [England].",
          // "…capital of [Zamunda]?"): an edge mismatch is the query
          // trailing off into different content, not a word standing in a
          // shared frame.
          const leftOk = matched.some(([s, e]) => e >= qs2 && qs2 - s >= W);
          const rightOk = matched.some(([s, e]) => s <= qe2 && e - qe2 >= W);
          if (!leftOk || !rightOk) continue;
          if (!attestedQ(qs2, qe2)) continue;
          const u = query.subarray(qs2, qe2);
          const cSpan = cBytes.subarray(cs2, ce2);
          const geometric = cosine(perceive(ctx, u).v, perceive(ctx, cSpan).v);
          const qKey = `${qs2}:${qe2}`;
          let qHalo = queryHaloMemo.get(qKey);
          if (qHalo === undefined) {
            qHalo = spanHalo(ctx, query, qs2, qe2);
            queryHaloMemo.set(qKey, qHalo);
          }
          const cKey = `${sid}:${cs2}:${ce2}`;
          let cHalo = candidateHaloMemo.get(cKey);
          if (cHalo === undefined) {
            cHalo = spanHalo(ctx, cBytes, cs2, ce2);
            candidateHaloMemo.set(cKey, cHalo);
          }
          const distributional = qHalo !== null && cHalo !== null
            ? cosine(qHalo, cHalo)
            : 0;
          if (diagnostics) {
            diagnostics.synonymChecks++;
            diagnostics.bestSynonym = Math.max(
              diagnostics.bestSynonym,
              distributional,
            );
          }
          // Graded identity: byte geometry remains the cheap first tier;
          // VSA company is the synonym tier when differently-spelled forms
          // occupy the same learnt distributional role.
          if (
            (!balanced || geometric < bar) &&
            distributional < synonymBar
          ) {
            continue;
          }
          if (
            !unanimous(
              u,
              cSpan,
              query.subarray(qs2 - W, qs2),
              query.subarray(qe2, qe2 + W),
            )
          ) continue;
          subs.push({ qs: qs2, qe: qe2, cs: cs2, ce: ce2 });
          accepted = true;
          break outer;
        }
      }
      if (!accepted && (uLen > W || cLen > reachCap)) ok = false;
    }
    // A candidate with ZERO gaps needs no substitution and might seem like
    // the strongest possible bridge, but accepting it here is a trap: this
    // mechanism runs only where recall's own resonance/echo tiers already
    // declined to ground a same-shape, zero-substitution match — usually
    // because the query is a strict byte-PREFIX of several candidates
    // (many trained "The capital of X is Y." facts share the query "The
    // capital of France is" as a substring once the true France fact is
    // filtered out for lacking a continuation edge) and nothing here
    // corroborates picking one candidate's completion over another's
    // (observed live: prefix-completion bridged to an unrelated "London"
    // trivia distractor over the true France fact, which precedes it in
    // resonance rank but has no outgoing edge to bridge through).  This
    // mechanism exists to explain SUBSTITUTIONS; a query needing none is
    // recall's job, not the bridge's.
    if (!ok) continue;
    if (diagnostics) diagnostics.structurallyValid++;

    // Coverage: every interior gap is already proved ≤ W above, and the
    // EDGES must be explained to the same one-window tolerance — the same
    // "at most one river window of foreign content" identityBar prices.  (A
    // further bar, that the covered bytes dominate the query, was measured
    // redundant with these and removed.)  The live junk this closes: alignments that matched a query's scaffolding
    // and one substitution but left the query's whole trailing content
    // ("…planet orbiting our sun.", 24 bytes) unexplained, yet still
    // half-dominated the byte count.
    const spans: Array<[number, number]> = [
      ...matched,
      ...subs.map((s) => [s.qs, s.qe] as [number, number]),
    ].sort((x, y) => x[0] - y[0]);
    let covered = 0;
    let reachEnd = 0;
    for (const [s, e] of spans) {
      if (e <= reachEnd) continue;
      covered += e - Math.max(s, reachEnd);
      reachEnd = Math.max(reachEnd, e);
    }
    if (diagnostics) {
      diagnostics.bestCovered = Math.max(diagnostics.bestCovered, covered);
      const candidateGapBytes = gaps.reduce(
        (n, g) => n + g.ce - g.cs,
        0,
      );
      diagnostics.closest.push({
        id: sid,
        covered,
        leading: spans[0][0],
        trailing: query.length - reachEnd,
        gaps: gaps.length,
        substitutions: subs.length,
        queryGapBytes: gaps.reduce((n, g) => n + g.qe - g.qs, 0),
        candidateGapBytes,
        gapRanges: gaps.map((g) => [g.qs, g.qe, g.cs, g.ce]),
        candidateSurplus: cBytes.length - covered - candidateGapBytes,
        gapsExplained: gaps.every((g) => explainedSpan(cBytes, g.cs, g.ce)),
      });
      diagnostics.closest.sort((a, b) =>
        b.covered - a.covered ||
        a.leading + a.trailing - b.leading - b.trailing ||
        a.id - b.id
      );
      if (diagnostics.closest.length > W) diagnostics.closest.length = W;
    }
    if (spans[0][0] > W || query.length - reachEnd > W) continue;
    if (diagnostics) diagnostics.coverageValid++;

    // ZERO-SUBSTITUTION ADMISSION — an IDENTITY claim, not a substitution.
    //
    // A candidate needing no substitution is normally refused (see the trap
    // above), and that refusal is right for the case it was written for: the
    // query is a strict byte-PREFIX of several candidates, each of which
    // continues differently, and nothing here corroborates picking one
    // continuation over another.  But that trap has a signature — the
    // candidate carries substantial content BEYOND the alignment, and that
    // surplus is exactly the "answer" the bridge would be inventing.
    //
    // The opposite shape is not ambiguous at all: the alignment explains BOTH
    // strings end to end, and the only thing between them is sub-quantum glue
    // — typographic punctuation the fold treats as structure.  Then the two
    // are the SAME learnt form, and grounding through its edge returns that
    // form's own trained answer, never a chosen-among-many completion.
    //
    // Why the ladder cannot reach these otherwise: the gist is a STRUCTURAL
    // signature, so a mid-string insertion shifts every fold boundary after
    // it.  Measured: `Who wrote Romeo and Juliet?` against the trained
    // `Who wrote "Romeo and Juliet"?` — two inserted quote characters — scores
    // cos 0.377, BELOW unrelated neighbours like "Who wrote the opera
    // Carmen??" (0.603).  Recall's identity tiers gate on identityBar (0.969
    // here) and its reach tiers on 0.875, so no gist-based tier can ever see
    // it; only byte-exact alignment can, which is what this function does.
    //
    // The claim is deliberately strict, in three parts:
    //
    //   • QUERY SIDE — EXACT.  Every byte of the query must be a literal
    //     match against the candidate: covered === query.length, no slack at
    //     all, not even sub-quantum.  The query is what we are answering, so
    //     an identity claim about it may write off NOTHING.  This is stricter
    //     than the ≤ W edge tolerance the substituted path uses, and it has
    //     to be: with a one-window allowance, `what is 2^10?` matched the
    //     trained `what is 2+2?` — "^10" against "+2", four bytes, both sides
    //     below W — and answered "2+2 is 4.", outweighing cover's authoritative
    //     ALU result.  Below W, byte OVERLAP is chance rather than evidence;
    //     that never made a below-W DIFFERENCE meaningless, and digits are the
    //     case that proves it.
    //   • CANDIDATE SIDE, INTERIOR — each gap must be an EXPLAINED span (see
    //     explainedSpan): sub-quantum glue, or corpus-global scaffolding.
    //     This side is asymmetric ON PURPOSE.  Material the CANDIDATE has and
    //     the query omits is not something the asker asked about: if it is
    //     scaffolding, dropping it changes nothing ("What is *the process of*
    //     photosynthesis?"); if it is discriminative, the candidate answers a
    //     DIFFERENT, narrower question ("Is *heavy* water wet?") and must be
    //     refused.  Only the corpus can tell those apart, and it does.
    //   • CANDIDATE SIDE, SURPLUS — its bytes are the matched runs
    //     (byte-identical to the query's, hence the same total length) plus
    //     its own gap spans; anything past that is surplus, and surplus is
    //     the prefix trap.  A prefix-completion candidate fails here by the
    //     whole length of the completion it wanted to supply — which is why
    //     admitting scaffolding interiors does not reopen that trap.
    //
    // Ordered cheapest-first: the two arithmetic tests run before
    // explainedSpan, whose per-window `reachOf` climbs are the only costly
    // part (shared through the response/conversation reach memo, and reached
    // only by a candidate that already survived every structural gate).
    if (subs.length === 0) {
      if (covered !== query.length) continue;
      const cGap = gaps.reduce((n, g) => n + (g.ce - g.cs), 0);
      if (cBytes.length - covered - cGap > W) continue;
      if (!gaps.every((g) => explainedSpan(cBytes, g.cs, g.ce))) continue;
    }
    if (diagnostics) diagnostics.identityValid++;

    // KNOWN content may never be dismissed — see dismissedKnownContent
    // (the live case: "what is the capital of france" aligning into a
    // Matrix synopsis by writing off "ance" — a stored window of the
    // trained "France" — as a gap, while genuinely novel spans like
    // test/49's untrained "Name" remain tolerable).
    if (dismissedKnownContent(ctx, query, spans)) continue;
    if (diagnostics) diagnostics.knownContentValid++;

    if (covered > bestAccounted) {
      bestAccounted = covered;
      best = { id: sid, accounted: spans, subs };
      if (diagnostics) diagnostics.bestRank = candidateIndex;
    }
  }

  if (best !== null) {
    ctx.trace?.step(
      "substitutionBridge",
      [rItem(query, "query")],
      [
        rNode(ctx, best.id, "bridged-context"),
        ...best.subs.map((s) =>
          rItem(query.subarray(s.qs, s.qe), "substituted")
        ),
      ],
      `a trained context accounts for the query up to ${best.subs.length} ` +
        `corroborated substitution(s) — grounding through its learnt edges`,
      undefined,
      diagnostics!,
    );
  } else {
    ctx.trace?.step(
      "substitutionBridge",
      [rItem(query, "query")],
      [],
      "candidate contexts were proposed, but none passed the bridge's " +
        "structural identity and corroboration gates",
      undefined,
      diagnostics!,
    );
  }
  return best;
}
