/**
 * Sequence segmentation on the lightest-derivation engine.
 *
 * The only structure here is the **frontier**: the items are the positions
 * `0…length` of a sequence, and a derivation is a path through them. That is
 * what keeps the search linear in the input rather than quadratic — there is no
 * enumeration of span *pairs* and no chart of O(n²) sub-sequences.
 *
 * Candidate spans are produced **on demand**: when the search finalises a
 * position it asks a {@link Trie} which learned forms begin there. The trie walk
 * stops exactly where the data's patterns stop — a position with nothing learned
 * dead-ends immediately, a position inside a long form walks precisely that far.
 * Nothing is scanned ahead of demand and no length bound is imposed; the
 * structure of what was learned is the bound.
 *
 * {@link coverSequence} is the segmentation primitive: the lightest set of
 * non-overlapping spans covering a sequence. It is the principled,
 * corpus-independent replacement for "scan the whole stream with an automaton,
 * then greedily keep the longest non-overlapping matches" — same linear cost,
 * but the *optimal* cover and only the work the goal demands.
 */
/** A candidate span over a sequence, carrying caller payload. */
export interface CandidateSpan<P> {
    /** Start offset (inclusive). */
    start: number;
    /** End offset (exclusive); must be > start. */
    end: number;
    /** Relative cost of using this span (default 1). Lower wins ties. */
    weight?: number;
    /** Caller data, returned on the chosen spans. */
    payload: P;
}
export interface Cover<P> {
    /** Chosen non-overlapping spans, left to right. */
    spans: Array<CandidateSpan<P>>;
    /** Symbols covered by the chosen spans. */
    covered: number;
    /** Symbols left uncovered. */
    uncovered: number;
}
/**
 * The lightest non-overlapping cover of `[0, length)` drawn from `candidates`.
 *
 * Primary objective: cover the most symbols (fewest left uncovered). Secondary:
 * least total span weight — with the default unit weight this prefers fewer,
 * longer spans, the optimal analogue of greedy longest-match, but it can return
 * a pair of shorter spans when together they cover more than one long one (which
 * greedy cannot). Modelled as a shortest path over frontier positions: from a
 * position you either leave one symbol uncovered (costly) or take a candidate
 * that starts there (cheap), reaching `length`.
 *
 * Cost: O((length + |candidates|) · log length) — the frontier has `length + 1`
 * items, each finalised once, with one "skip" edge plus the candidates that
 * start there. No quadratic span structure.
 */
export declare function coverSequence<P>(length: number, candidates: ReadonlyArray<CandidateSpan<P>>): Cover<P>;
