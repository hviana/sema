import type { MindContext } from "../types.js";
import type { Vec } from "../../vec.js";
/** A CAST answer plus its elementary evidence for think's grounding decider:
 *  `accounted` — the query spans the weave's aligned runs explain; `moves` —
 *  the ladder cost of the acts the taken branch performed (STEP per
 *  projection, CONCEPT for the halo-mediated analogy gate). */
export interface CastResult {
    bytes: Uint8Array;
    used: ReadonlySet<number>;
    accounted: Array<[number, number]>;
    moves: number;
    /** A human-readable label for the query bytes this schema left
     *  unexplained — purely diagnostic, never priced (see the module's
     *  Task 2 note in pipeline.ts's Candidate interface). */
    unexplained: string;
}
/** The seat that establishes a node's role in an analogical comparison:
 *  the REVERSE context (what leads to it) when a predecessor genuinely
 *  ESTABLISHES id — introduces or describes it by name — else the FORWARD
 *  continuation (what it leads to), else `fallback`.
 *
 *  An earlier version gated this purely on `prevCount(id) > 0`: any
 *  predecessor at all was treated as proof of a genuine named ENTITY
 *  (seat it by what established it), while no predecessor meant a bare
 *  learnt CONTEXT (seat it by what it leads to, since voicing it verbatim
 *  would answer a question with a question).  That test measured the wrong
 *  thing — a broad sample of this store's own question-shaped nodes showed
 *  the large majority (≈71%) have at least one predecessor, most of them a
 *  handful of generic, high-fan-out sentences that recur as an INCIDENTAL
 *  neighbour to dozens of otherwise-unrelated destinations (a SmolSent-
 *  style sentence-adjacency artifact, never naming or describing what
 *  follows).  Traced live: "What is the capital of France?" — whose own
 *  forward edge unambiguously resolves to "The capital of France is
 *  Paris." — has exactly one such incidental predecessor ("Create an
 *  example of a types of questions a GPT model can answer.?"), wrongly
 *  read as disqualifying proof of "genuine entity."
 *
 *  A plain forward-first swap (matching {@link project}'s universal
 *  priority) over-corrected: test/29's C2/C3 pin that a genuine entity
 *  analog (e.g. "Leonardo da Vinci", established by "The Mona Lisa was
 *  painted by Leonardo da Vinci.") must be seated by that establishing
 *  sentence, NOT by its own biography fact — voicing the bio leaks exactly
 *  what a comparison must keep out, and loses the embedded "Mona Lisa"
 *  term C3 relies on for a further hop.
 *
 *  The distinguishing signal is content-addressed, not a count: a genuine
 *  establishing predecessor's bytes CONTAIN id's own bytes — it names or
 *  describes id ("...painted by Leonardo da Vinci." contains "Leonardo da
 *  Vinci").  An incidental adjacency predecessor never does — it merely
 *  preceded id in some unrelated document without ever mentioning it.  No
 *  new tuned constant: containment is the same primitive `restatesQuery`
 *  and `dominates`-style checks already use throughout this codebase.
 *
 *  `allowForward` (default true) gates the FORWARD branch specifically —
 *  see the call sites below: the DOMINANT is what the query is actually
 *  ASKING, so completing it forward is the whole point; an ANALOG is only
 *  being CITED for comparison; the query never asked about IT, so chasing
 *  its own further continuation drifts onto whatever coincidentally
 *  follows it in the corpus.  Traced live: the analog "What is the capital
 *  of Japan?\nTokyo is the capital of Japan." is ALREADY a complete,
 *  self-answering unit (prevCount 0, so no establishing predecessor
 *  either) — its sole forward edge is "And what is the capital of the
 *  Moon?", an unrelated quiz question sharing nothing but corpus
 *  adjacency.  With forward disallowed, an analog like this falls through
 *  to `fallback` — its own bytes, exactly the complete fact that made it a
 *  genuine analog in the first place.  See
 *  test/41-seatofnode-direction.test.mjs and
 *  test/43-cast-analog-seat.test.mjs. */
export declare function seatOfNode(ctx: MindContext, id: number, guide: Vec | null | undefined, fallback: Uint8Array, allowForward?: boolean): Promise<Uint8Array>;
/** CAST's own entry gates, checked once here and reused by
/** The main CAST entry point.  Given a query and its pre-computed pre.rec.sites,
 *  determine whether the query weaves together multiple independent learnt
 *  structures (by graded alignment — literal first, then halo-matched pre.rec.sites).
 *  If so, attempt substitution, redirection, AND analogical comparison —
 *  each schema is tried independently and every one that fires yields its
 *  OWN candidate; think's grounding decider (which already compares weights
 *  across mechanisms) picks among them, so CAST no longer needs an internal
 *  priority order.
 *
 *  `climb`, when given, is {@link castFloor}'s own climb result — reused
 *  instead of re-running climbAttentionAll (see the note on {@link
 *  CastFloor}).  Its gates (`query.length`, `edgeSourceCount`,
 *  `ranked.length < 2`) MUST stay in sync with castFloor's — one is the
 *  other's admissible lower bound, checked before this runs.
 *
 *  Returns the array of {@link CastResult}s that fired (possibly empty). */
export declare function counterfactualTransfer(ctx: MindContext, query: Uint8Array, pre: Precomputed): Promise<CastResult[]>;
import type { PipelineMechanism, Precomputed } from "../pipeline-mechanism.js";
export declare const castMechanism: PipelineMechanism;
