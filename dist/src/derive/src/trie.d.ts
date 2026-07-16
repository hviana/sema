/**
 * Forward prefix trie over integer symbols — the lazy site matcher.
 *
 * This is the matching primitive the lightest-derivation search consults *on
 * demand*: given a position in a sequence, {@link Trie.matchesAt} walks forward
 * from the root and reports every stored pattern that begins there, in
 * O(longest matching pattern). Nothing is scanned that the search never asks
 * about — there is no global automaton, no failure links, no precomputed match
 * table. That is the whole point: rewrite sites are *materialised only when
 * demanded* (the "lazy hyperedge generation" of the rewrite search), so the
 * matcher itself stays trivial and the search decides what to look at.
 *
 * It is fully generic and self-contained: symbols are non-negative integers
 * (bytes 0–255, Unicode code points, opcodes, …); patterns are any
 * `ArrayLike<number>` (`Uint8Array` or `number[]`); each pattern carries an
 * arbitrary `payload` returned on every match. The trie also exposes a tiny
 * cursor API ({@link Trie.root}, {@link Trie.step}, {@link Trie.terminal}) so a
 * caller can extend a partial match symbol-by-symbol — e.g. to ask "could this
 * span still grow into a known form?" while composing.
 *
 * ## Memory
 *
 * Most states (99.7 % in typical use) have exactly one outgoing transition.
 * Storing a full `Map` per state would cost ~88 bytes each. Instead, a singleton
 * transition is packed inline into two typed arrays — `_nxt` (Int32Array, 4
 * bytes) and `_sym` (Uint8Array, 1 byte) — for ~5 bytes per state, a 17×
 * reduction. Only the rare multi-transition state (~0.3 %) allocates a `Map`,
 * kept in a sparse `_multi` table keyed by state number.
 */
/** One pattern occurrence found by the trie. */
export interface Match<P> {
    /** Start offset in the searched sequence (inclusive). */
    start: number;
    /** End offset (exclusive); `end - start === length`. */
    end: number;
    /** Length of the matched pattern. */
    length: number;
    /** Pattern id, assigned in insertion order (0-based). */
    id: number;
    /** Payload registered with the pattern. */
    payload: P;
}
export declare class Trie<P = undefined> {
    private _nxt;
    private _sym;
    private _multi;
    private _end;
    private readonly _lens;
    private readonly _vals;
    private _len;
    constructor();
    /** The root state, for cursor walks. */
    get root(): number;
    /** Number of distinct patterns stored. */
    get size(): number;
    /** Allocate a fresh state, growing the typed arrays by a fixed increment
     *  when full.  No power-of-2 doubling — the transient double-memory spike
     *  during growth is bounded to the increment. */
    private _state;
    /** Follow symbol `c` from state `s`.  Returns the next state, or -1. */
    private _follow;
    /** Follow one symbol from `state`; returns the next state or -1 if none. */
    step(state: number, symbol: number): number;
    /** The pattern ending exactly at `state`, or null. */
    terminal(state: number): {
        id: number;
        payload: P;
    } | null;
    /** Length of the pattern with this id. */
    lengthOf(id: number): number;
    /**
     * Insert a pattern, returning its id. Inserting the same symbol-sequence
     * twice returns the first id and keeps the first payload (patterns are keyed
     * by content). Empty patterns are ignored and return -1.
     */
    insert(pattern: ArrayLike<number>, payload: P): number;
    /**
     * Every stored pattern that begins exactly at `pos` in `seq`, shortest first.
     * Walks forward from the root in O(longest match); reports nothing about any
     * other position. This is the on-demand probe the search uses.
     */
    matchesAt(seq: ArrayLike<number>, pos: number): Array<Match<P>>;
    /**
     * Every occurrence of every pattern anywhere in `seq` (eager form, the union
     * of {@link matchesAt} over all start positions). O(seq · longest pattern),
     * independent of how many patterns are stored. Use {@link matchesAt} when the
     * search only needs the sites at a particular position.
     */
    scan(seq: ArrayLike<number>): Array<Match<P>>;
}
