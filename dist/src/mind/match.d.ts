import { Vec } from "../vec.js";
import type { Hit } from "../store.js";
import type { MindContext } from "./types.js";
import type { Site } from "./graph-search.js";
/** The graded LOCATE ladder: find `needle` in `haystack` starting at
 *  `fromPos`, strictest matcher first, relaxing only when the stricter one
 *  fails.  This is the read-out matcher skill extraction locates exemplar
 *  frames with.
 *
 *  1. exact    — literal byte match (the fast path).
 *  2. halo     — the needle's distributional role matches a recognised query
 *                form (gate: conceptThreshold).
 *  3. gist     — the needle's perceived gist matches a query segment
 *                (gate: identityBar — scale-aware).
 *
 *  Returns the absolute byte position, or −1. */
export declare function locate(ctx: MindContext, haystack: Uint8Array, needle: Uint8Array, fromPos: number, sites?: ReadonlyArray<Site>): number;
/** The ALIGNED matcher: maximal literal matching runs between `query` and
 *  `ct` (a learned context's bytes), by seed-and-extend over
 *  `space.maxGroup`-sized n-gram seeds.  Where locate() finds ONE position of
 *  a short frame, this finds EVERY run two whole structures share — the
 *  matcher CAST detects a woven query with.  Returns non-overlapping runs
 *  sorted by query position. */
export declare function alignRuns(ctx: MindContext, query: Uint8Array, ct: Uint8Array): Array<{
    qs: number;
    qe: number;
    cs: number;
}>;
/** A run from {@link alignGraded} — the ALIGNED matcher extended with the
 *  same graded-evidence ladder as {@link locate}.  Literal runs carry
 *  `weight = 1` (exact match is full evidence); halo-matched site runs carry
 *  `weight = cosine` (measured evidence — the halo similarity itself).
 *  `cs` is the structural byte position in the context regardless of run
 *  kind, so the substitution/redirection schemas work unchanged on conceptual
 *  alignment. */
export interface GradedRun {
    /** True for a run the CLIMB proposed rather than the byte matcher found — see
     *  {@link computeWeave}'s phase 2.  Provenance only: a proposed run reaches
     *  CAST already gated (dominant literal agreement, not frame, and over bytes
     *  no literal run claimed), so every consumer reads it exactly like any other
     *  run.  Filtering seat-shaped reads by this flag was tried and is NOT
     *  needed — the gates, not the flag, are what make it safe. */
    proposed?: boolean;
    qs: number;
    qe: number;
    cs: number;
    weight: number;
}
/** The GRADED alignment matcher: extends literal W-gram alignment
 *  ({@link alignRuns}) with halo-matched recognised sites in query regions
 *  that have no literal coverage.  Same ladder as {@link locate}: literal
 *  first, then distributional role (halo-matched sites, gate:
 *  conceptThreshold, enforced by {@link bestHaloMate}).  Returns weighted
 *  runs sorted by query position.
 *
 *  `querySites` are the pre-computed recognition sites for the query
 *  (optional — when absent, only literal alignment fires and graded degrades
 *  to the original behaviour).  Context sites are recognised internally. */
export declare function alignGraded(ctx: MindContext, query: Uint8Array, contextBytes: Uint8Array, querySites?: ReadonlyArray<Site>): GradedRun[];
/** One place two byte streams DISAGREE, between runs where they agree: the
 *  query span `[qs,qe)` standing where the candidate's `[cs,ce)` stands.
 *
 *  Two mechanisms read the same gap and ask OPPOSITE questions of it, which is
 *  why the shape lives here rather than in either of them:
 *
 *    • the substitution bridge asks whether the two sides MEAN THE SAME, and
 *      so EXPANDS the gap (absorbing flanking matched bytes) until the query
 *      side is corpus-attested and the pair clears the concept bar;
 *    • the frame reading asks WHERE THE SLOT IS, and so CONTRACTS it
 *      ({@link contractGap}) until the two sides share nothing at all.
 *
 *  Neither reading is derivable from the other, and both need the same gap. */
export interface AlignGap {
    qs: number;
    qe: number;
    cs: number;
    ce: number;
}
/** Extend a seed match (query offset qo ↔ candidate offset co) to its maximal
 *  common run, then walk outward in both directions collecting further common
 *  runs of at least W bytes across bounded mismatch gaps (each side ≤
 *  chainReach).  Returns the matched query spans and the mismatch pairs
 *  between consecutive runs.
 *
 *  This is the SEEDED aligner, distinct from {@link alignRuns}: that one finds
 *  every run two structures share anywhere (a weave), this one reads two
 *  streams as ONE structure that diverges in bounded places (a frame with
 *  slots).
 *
 *  Gaps come back in SWEEP order (right sweep, then left), not query order,
 *  and only the INTERIOR ones are reported — a consumer that needs the query's
 *  unmatched head or tail derives it from `matched`.  Both are the bridge's
 *  contract, which prices its edges separately (see its matchStart/matchEnd
 *  window test); {@link frameSlots} takes the other reading. */
export declare function alignAround(ctx: MindContext, q: Uint8Array, c: Uint8Array, qo: number, co: number): {
    matched: Array<[number, number]>;
    gaps: AlignGap[];
};
/** Contract a gap to its VARYING CORE: strip the prefix and suffix the two
 *  sides share.  {@link alignAround} cannot match a shared affix shorter than
 *  W, so that affix lands INSIDE the gap — measured, the slot of
 *  `How do I compile main.c?` against `…hello.c?` comes back as
 *  `main.c?`/`hello.c?`, three bytes of which (`.c?`) both sides hold.
 *
 *  Splicing the uncontracted gap carries the query's own punctuation into the
 *  answer; worse, it hides what actually VARIES, which is the only thing a
 *  cohort can agree about.  Returns null when nothing is left on either side —
 *  a pure insertion or deletion, which names no slot. */
export declare function contractGap(q: Uint8Array, c: Uint8Array, g: AlignGap): AlignGap | null;
/** What one place two streams disagree IS, once contracted to its varying
 *  core.  A consumer decides which kinds it can use; the matcher only reports.
 *
 *    substitution  both sides carry bytes — one thing stands where another does
 *    insertion     the query carries bytes the candidate does not
 *    deletion      the candidate carries bytes the query does not */
export type SlotKind = "substitution" | "insertion" | "deletion";
/** One VARIABLE POSITION of a pairing: where the query and a candidate differ,
 *  contracted to the bytes that actually vary. */
export interface FrameSlot {
    /** Query span (empty for a deletion). */
    qs: number;
    qe: number;
    /** Candidate span (empty for an insertion). */
    cs: number;
    ce: number;
    kind: SlotKind;
    /** The candidate's own bytes here — empty for an insertion. */
    filler: Uint8Array;
}
/** One trained context read against the query as ONE structure with variable
 *  positions.
 *
 *  EVERYTHING THE ALIGNER SAW, NOTHING JUDGED.  `slots` holds every place the
 *  pairing varies, in query order, whatever its kind or size, and `covered`
 *  says how much of the query the two hold in common.  No gate is applied
 *  here — see {@link frameSlots}. */
export interface FrameInstance {
    /** The trained context this reading is against. */
    id: number;
    /** Every variable position, in query order. */
    slots: FrameSlot[];
    /** Query spans the pairing literally matched — the frame itself. */
    matched: Array<[number, number]>;
    /** Query bytes the frame accounts for: the size of what is shared. */
    covered: number;
}
/** THE SLOT MATCHER: read one query ↔ context pairing as one structure with
 *  variable positions.
 *
 *  IT REPORTS; IT DOES NOT JUDGE.  This returns every gap the aligner found,
 *  contracted to its varying core and tagged with its kind, plus the shared
 *  coverage — and rejects nothing.  That is the whole point of the split, and
 *  it was got WRONG first: four VOICING gates (the frame must dominate the
 *  query, each slot must reach one window on both sides, an insertion or
 *  deletion disqualifies the pairing, fillers must be pairwise distinct) were
 *  applied here, and every one of them is a requirement for SUBSTITUTING AND
 *  SPEAKING, not for knowing where a pairing varies.  With them in place the
 *  shared reading was reference-shaped: measured over four real pairings, three
 *  were hidden from every consumer —
 *
 *    `What is the capital of the country where the Eiffel Tower is?`
 *        against `What is the capital of France?`  (covered 23/61)  HIDDEN
 *    `What is the capital of France, really?`      (an insertion)   HIDDEN
 *    `What is the capital of Fran?`                (sub-window)     HIDDEN
 *
 *  — including the case of the one consumer that most obviously needed it.  A
 *  shared layer with one usable consumer is private code at a public address.
 *  Each gate now lives with the mechanism that needs it (see reference.ts).
 *
 *  Seeded at the origin, because a frame is shared structure the query and its
 *  instances both OPEN with: the maximal run around (0,0) is the frame's head
 *  and the sweeps find the rest.
 *
 *  Null only for a degenerate pairing (either side empty). */
export declare function frameSlots(ctx: MindContext, query: Uint8Array, cand: Uint8Array, id: number): FrameInstance | null;
/** THE DISPLACED-FILLER GATE: does `projection` speak the ANCHOR's occupant of
 *  a position the query fills differently?
 *
 *  A mechanism grounding through an anchor voices that anchor's continuation.
 *  When the query is the same structure as the anchor with one position filled
 *  differently — a different filename, a different word — the anchor's
 *  continuation is ABOUT THE ANCHOR'S occupant, and voicing it answers a
 *  question the asker did not ask.  It is worse than silence, because it is
 *  fluent and specific and wrong:
 *
 *      trained  `How do I compile hello.c?` -> `Run gcc hello.c`
 *      asked    `How do I compile main.c?`
 *      voiced   `Run gcc hello.c`            <- the corpus's file, not the asker's
 *
 *  The same shape on the trained 15.7M-node store: `How do you say 'flurbish'
 *  in French?` answers "the way to say hello is \"Bonjour\"".
 *
 *  THIS IS NOT THE RESTATED-FRAGMENT GUARD.  That one asks whether the
 *  projection is a piece of the QUERY; this asks whether it is a piece of the
 *  ANCHOR that the query displaced.  Neither implies the other, and the
 *  observed failures pass the restatement guard cleanly.
 *
 *  Three conditions, all byte-exact and all necessary:
 *
 *  1. the query and the anchor must be ONE STRUCTURE — what they share has to
 *     dominate the query, or the query is not a variant of the anchor at all
 *     and the anchor's occupant of anything is beside the point;
 *  2. both sides of the position must reach one river window — below it byte
 *     overlap is chance, not evidence (the floor identityBar and the bridge's
 *     attestedQ both draw);
 *  3. the projection must voice the anchor's filler and NOT the query's
 *     referent.  Voicing both is a projection that carried the asker's own
 *     occupant through, which is exactly what a licensed reference does and
 *     must stay allowed;
 *  4. and the projection must share NO perceivable content with the query
 *     outside that position — no run of one river window.
 *
 *  GATE 4 IS WHAT SEPARATES A DIFFERENT THING FROM A DIFFERENT WORD, and
 *  without it this refuses correct answers.  A displaced slot alone cannot
 *  tell them apart: `symbol` <- `formula` and `main` <- `hello` are the same
 *  shape to the matcher — one substitution slot, frame dominating.  Measured
 *  on the trained store, gates 1-3 alone silenced
 *
 *      Q `What is the chemical symbol for water?`
 *      A `The chemical formula for water is H2O.`
 *
 *  which is right, and merely phrased in the corpus's own words.  The answer
 *  shares `the chemical ` and ` for water` with the question, so it is plainly
 *  about what was asked.  `Run gcc hello.c` against `How do I compile main.c?`
 *  shares nothing but `.c` — two bytes, below the window where overlap stops
 *  being chance — so it is not about what was asked at all.  No new constant:
 *  W is the same floor identityBar, attestedQ and the site test already draw. */
export declare function voicesDisplacedFiller(ctx: MindContext, query: Uint8Array, anchor: Uint8Array, projection: Uint8Array): boolean;
/** Whether every member is byte-distinct from the others. */
export declare function distinct(items: readonly Uint8Array[]): boolean;
/** Substitute every `needle -> repl` pair SIMULTANEOUSLY: one left-to-right
 *  pass, longest needle first at each position, and a replacement is never
 *  re-examined.
 *
 *  SIMULTANEOUS IS NOT A DETAIL.  Applying the pairs in sequence lets one
 *  substitution's OUTPUT be another's input: with slots `gcc -> zig` and
 *  `hello.c -> zig.c` a sequential pass rewrites bytes it had just written,
 *  and the result depends on the order the slots happened to be found in.
 *  Longest-first at each position makes the pass independent of pair order,
 *  which is what keeps {@link carriesFillers} and the binding it licenses the
 *  SAME operation — if they could disagree, the licence would not be testing
 *  what is voiced. */
export declare function substituteAll(hay: Uint8Array, pairs: ReadonlyArray<{
    needle: Uint8Array;
    repl: Uint8Array;
}>): Uint8Array;
/** THE CARRIAGE LICENCE — the gate that decides whether a slot may be VOICED
 *  through.  Given two instances of one frame and what each one continues to,
 *  it asks one byte question:
 *
 *      substituteAll(contA, fillersA -> fillersB) == contB
 *
 *  When it holds, the corpus attests byte-exactly that the continuation is a
 *  function of the fillers and nothing else, so putting a NEW occupant through
 *  the same carriage is derivation rather than invention.  No threshold, no
 *  similarity, no new constant: the store's own instances decide, exactly as
 *  the bridge's `unanimous` decides whether a frame is a value slot.
 *
 *  Its FAILURE is what this is really for.  A frame whose continuation carries
 *  filler-DEPENDENT content — `What is the capital of X?` answering a different
 *  city per X — fails it, and that failure is the only thing between a slot
 *  and an invented fact.  Measured on the trained 15.7M-node store (325,615
 *  contexts): `What is the capital of Zamunda?` resonates to a PURE cohort,
 *  every one of the top 14 hits an instance of that frame, with an unambiguous
 *  slot; every structural gate passes and only this one refuses, on
 *  `replace("Tokyo", "Japan" -> "France") != "Paris"`.
 *
 *  With SEVERAL slots the test is unchanged, which is the point of testing the
 *  whole substitution at once: a frame whose answer tracks one slot but
 *  invents around another fails exactly as a single-slot value slot does. */
export declare function carriesFillers(contA: Uint8Array, fillersA: readonly Uint8Array[], contB: Uint8Array, fillersB: readonly Uint8Array[]): boolean;
/** The IN-LIST halo matcher: the best halo-mate for `halo` among EXPLICIT
 *  candidates, above the concept threshold — the list counterpart of
 *  {@link haloSiblings}, which asks the halo INDEX for candidates instead.
 *  Behind locate()'s halo step and articulation's voice matching; a third
 *  "best halo among these" decision must come here, not inline. */
export declare function bestHaloMate<T>(ctx: MindContext, halo: Vec, items: Iterable<T>, haloOf: (item: T) => Vec | null | undefined): {
    item: T;
    score: number;
} | null;
export declare function haloSiblings(ctx: MindContext, id: number, halo?: Vec | null, bar?: number): Promise<Hit[]>;
/** Bundle the distributional company of every addressable W-window in a
 *  byte span.  This is the query-time counterpart of the write-side halo
 *  pours: no lexical unit or storage row is invented; the span is represented
 *  by VSA superposition of the window concepts the store already knows.
 *
 *  Components are normalized before bundling so repetition mass remains
 *  evidence about each stored node, not an accidental weight on one window
 *  inside the composed phrase.  Returns null when the corpus provides no
 *  distributional evidence for the span. */
export declare function spanHalo(ctx: MindContext, bytes: Uint8Array, from?: number, to?: number): Vec | null;
/** Distributional synonym evidence between arbitrary byte spans. Whole words
 *  need not be independently interned: their stored W-window occurrences are
 *  lifted to episode halos, bundled, and compared. The caller chooses the
 *  derived gate appropriate to its claim (concept identity or analogy). */
export declare function spanSynonymStrength(ctx: MindContext, a: Uint8Array, b: Uint8Array): number;
/** The DISTRIBUTIONAL matcher between two nodes: mutual-nearest-neighbour
 *  strength, not a pick.  Returns the direct halo cosine, or failing that the
 *  highest mutual-halo-sibling min-score (second-order analogy), or failing
 *  that the SHARED-FRAME strength (below) — the gate CAST's comparison
 *  schema validates genuine analogs with (bar: significanceBar).
 *
 *  The result names its TIER alongside the score: `halo: true` means the
 *  score cleared a significanceBar-gated HALO tier (direct company cosine
 *  or mutual-sibling) — genuine distributional evidence; `halo: false`
 *  means only the structural shared-frame fallback matched, a coverage
 *  fraction with no bar of its own.  CAST's comparison gate treats the two
 *  differently (see cast.ts): halo evidence stands alone, frame evidence
 *  needs the query to have named the analog or the climb root to be
 *  trusted. */
export interface AnalogyEvidence {
    score: number;
    halo: boolean;
}
export declare function analogyStrength(ctx: MindContext, a: number, b: number): Promise<AnalogyEvidence>;
/** The STRUCTURAL analogy tier: two nodes are analogs when their byte
 *  streams share a LEARNT frame — a content-addressed flat form of at least
 *  one full river window (W bytes, the perception quantum) that occurs in
 *  BOTH.  This is what "playing the same role" means structurally: "Ice is
 *  cold" and "Steel is hard" share the learnt " is " frame even though they
 *  keep disjoint distributional company.  Halos measure company by IDENTITY
 *  (company signatures — see sema.ts), so unrelated-company analogs must be
 *  validated by the frame itself, not by content leaking through halo
 *  vectors.  Strength is the shared learnt coverage of the SHORTER side —
 *  a fraction, comparable to the cosine tiers above.  Derived: the window
 *  is maxGroup, the same quantum differsByOneWindow and canonicalChunkId
 *  measure by; no tuned constants. */
export declare function sharedFrameStrength(ctx: MindContext, a: number, b: number): number;
/** The same measure over BYTES, for callers holding a role-establishing
 *  CONTEXT rather than the node whose role it establishes — CAST's comparison
 *  reads the tier this way when two candidate analogs are fillers (bare entity
 *  names) rather than frame-bearing structures themselves.  A role is a
 *  property of the context that establishes a filler, never of the filler's
 *  own bytes: measured on test/29's corpus, "Michelangelo" against "Homer"
 *  reads 0.000 while their establishing contexts ("The David was sculpted
 *  by…" against "The Iliad was written by…") read 0.452, and a context in a
 *  genuinely different frame ("Water boils at…") still reads 0.000 — the tier
 *  discriminates, it was simply being asked about the wrong bytes. */
export declare function sharedFrameStrengthOf(ctx: MindContext, A: Uint8Array, B: Uint8Array): number;
/** FORWARD through a synonym: the continuation an edge-less node borrows from
 *  a concept (halo) sibling — resonate the node's halo, take the first
 *  sibling above the concept threshold that itself has a direct edge. */
export declare function conceptHop(ctx: MindContext, id: number): Promise<number | null>;
/** FORWARD projection: follow continuation edges from a node to its fixpoint.
 *  The first hop may cross a concept (halo) link — a synonym.  The rest
 *  follow direct edges.  Convergence is intrinsic: the seen set guards
 *  against cycles.  `guide` disambiguates multi-continuation nodes by
 *  resonance. */
export declare function follow(ctx: MindContext, id: number, guide?: Vec | null): Promise<Uint8Array | null>;
/** REVERSE projection: the context a learnt continuation follows, voiced as
 *  bytes.  A common continuation ("Yes.") follows MANY contexts; with a
 *  `guide` the context whose gist resonates with the query wins (seat
 *  symmetry) — without one, the most-corroborated context wins (poured halo
 *  MASS, the direct measure of how many episodes established it), falling
 *  back to first-learnt on equal mass.  Among many predecessors RECIPROCAL
 *  ones (mutual edges) are preferred when any exist (RC5).  Callers that
 *  HAVE a query gist must pass it, or they silently change disambiguation
 *  regime.
 *
 *  `rev`, when the caller has already materialised prevOf (one read per
 *  relation — a hub's reverse fan-in is corpus-sized), is reused instead of
 *  refetched.  Returns null when there is no predecessor or the picked
 *  context reads empty (a zero-length context is no grounding: an empty
 *  Uint8Array is truthy, and returning it would flow a hollow "answer"
 *  onward). */
export declare function reverseContext(ctx: MindContext, id: number, guide?: Vec | null, rev?: readonly number[]): Uint8Array | null;
/** THE projection: ground a matched node to answer bytes — FORWARD to its
 *  continuation fixpoint (which may cross a concept hop), else REVERSE to
 *  the context it follows.  This is the direction ladder every mechanism's
 *  final grounding step reduces to. */
export declare function project(ctx: MindContext, id: number, guide?: Vec | null): Promise<Uint8Array | null>;
/** Check whether an anchor is a span-shaped skill exemplar: it represents a
 *  fact whose context and answer together form a span-in-context pattern.
 *  If the anchor has a nextOf continuation, that is the answer and the anchor
 *  itself is the context.  Otherwise the anchor's prevOf parents provide
 *  candidate contexts, and the longest one whose span is span-shaped wins. */
export declare function skillExemplar(ctx: MindContext, anchor: number, guide?: Vec | null): Promise<{
    contextBytes: Uint8Array;
    answerBytes: Uint8Array;
} | null>;
/** Whether the answer is a SPARSE subsequence of the context (bytes in
 *  order, arbitrary gaps) — the OPEN span-shape reading (see the section
 *  note above).  This is what lets extraction validate a MULTI-PIECE
 *  exemplar whose answer is stitched from several context runs — but it is
 *  deliberately permissive, so it must never be used as evidence that one
 *  span was "drawn from" another (see {@link containsSpan} for that).
 *
 *  There is deliberately NO containsSpan pre-check here: strict containment
 *  IMPLIES the subsequence embedding (a contiguous run, or a resolved node —
 *  whose content-addressed identity means its bytes occur contiguously — is
 *  an in-order embedding with zero gaps), so the scan below decides alone,
 *  with the same truth value.  The old pre-check re-perceived the context
 *  (a full river fold) per CANDIDATE in skillExemplar's √N-capped loop —
 *  pure cost, no discrimination. */
export declare function isSpanShaped(_ctx: MindContext, context: Uint8Array, answer: Uint8Array): boolean;
/** STRICT containment: the answer's resolved node appears in the context's
 *  folded tree, or the answer occurs as one CONTIGUOUS byte run of the
 *  context.  This is real evidence the answer was drawn from the context.
 *  Fusion gates on this — the sparse-subsequence reading of
 *  {@link isSpanShaped} is trivially satisfied by short answers over long
 *  queries ("cold" is a gap-tolerant subsequence of most sentences holding
 *  c…o…l…d in order), and gating fusion on it silently starved multi-topic
 *  queries of their further points of attention. */
export declare function containsSpan(ctx: MindContext, context: Uint8Array, answer: Uint8Array): boolean;
