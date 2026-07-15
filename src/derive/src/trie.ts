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

const ROOT = 0;

export class Trie<P = undefined> {
  // ── compact transition storage ──────────────────────────────────────────
  // _nxt[s]  —  -1   terminal (no outgoing transition)
  //             -2   multi-transition → _multi.get(s)
  //             >=0  singleton target; the symbol is _sym[s]
  private _nxt: Int32Array;
  private _sym: Uint8Array;
  private _multi: Map<number, Map<number, number>> | null = null;

  // _end[s] is the pattern id ending exactly at s, or -1.
  private _end: Int32Array;

  // Per-pattern data, indexed by pattern id.
  private readonly _lens: number[] = [];
  private readonly _vals: P[] = [];

  private _len = 1; // next free state (state 0 = root)

  constructor() {
    const c = 256;
    this._nxt = new Int32Array(c);
    this._sym = new Uint8Array(c);
    this._end = new Int32Array(c);
    this._nxt[ROOT] = -1;
    this._end[ROOT] = -1;
  }

  /** The root state, for cursor walks. */
  get root(): number {
    return ROOT;
  }

  /** Number of distinct patterns stored. */
  get size(): number {
    return this._lens.length;
  }

  // ── internal helpers ────────────────────────────────────────────────────

  /** Allocate a fresh state, growing the typed arrays by a fixed increment
   *  when full.  No power-of-2 doubling — the transient double-memory spike
   *  during growth is bounded to the increment. */
  private _state(): number {
    const s = this._len++;
    if (s >= this._nxt.length) {
      const c = s + 4096;
      const nn = new Int32Array(c);
      nn.set(this._nxt);
      this._nxt = nn;
      const ns = new Uint8Array(c);
      ns.set(this._sym);
      this._sym = ns;
      const ne = new Int32Array(c);
      ne.set(this._end);
      this._end = ne;
    }
    this._nxt[s] = -1;
    this._end[s] = -1;
    return s;
  }

  /** Follow symbol `c` from state `s`.  Returns the next state, or -1. */
  private _follow(s: number, c: number): number {
    const n = this._nxt[s];
    if (n >= 0) return this._sym[s] === c ? n : -1;
    if (n === -2) return this._multi!.get(s)!.get(c) ?? -1;
    return -1; // n === -1
  }

  // ── cursor API (allocation-free) ─────────────────────────────────────────

  /** Follow one symbol from `state`; returns the next state or -1 if none. */
  step(state: number, symbol: number): number {
    return this._follow(state, symbol);
  }

  /** The pattern ending exactly at `state`, or null. */
  terminal(state: number): { id: number; payload: P } | null {
    const id = this._end[state];
    return id === -1 ? null : { id, payload: this._vals[id] };
  }

  /** Length of the pattern with this id. */
  lengthOf(id: number): number {
    return this._lens[id];
  }

  // ── build ───────────────────────────────────────────────────────────────

  /**
   * Insert a pattern, returning its id. Inserting the same symbol-sequence
   * twice returns the first id and keeps the first payload (patterns are keyed
   * by content). Empty patterns are ignored and return -1.
   */
  insert(pattern: ArrayLike<number>, payload: P): number {
    const n = pattern.length;
    if (n === 0) return -1;
    let s = ROOT;
    for (let i = 0; i < n; i++) {
      const c = pattern[i];
      const t = this._nxt[s];

      if (t === -1) {
        // Terminal — place first transition as a singleton.
        const ns = this._state();
        this._nxt[s] = ns;
        this._sym[s] = c;
        s = ns;
      } else if (t >= 0) {
        // Singleton — either advance on match, or expand to multi.
        if (this._sym[s] === c) {
          s = t;
        } else {
          const map = new Map<number, number>();
          map.set(this._sym[s], t);
          const ns = this._state();
          map.set(c, ns);
          if (!this._multi) this._multi = new Map();
          this._multi.set(s, map);
          this._nxt[s] = -2;
          s = ns;
        }
      } else {
        // Multi (t === -2) — extend the existing Map.
        const map = this._multi!.get(s)!;
        let ns = map.get(c);
        if (ns === undefined) {
          ns = this._state();
          map.set(c, ns);
        }
        s = ns;
      }
    }
    if (this._end[s] !== -1) return this._end[s]; // already present
    const id = this._lens.length;
    this._lens.push(n);
    this._vals.push(payload);
    this._end[s] = id;
    return id;
  }

  // ── matching ───────────────────────────────────────────────────────────

  /**
   * Every stored pattern that begins exactly at `pos` in `seq`, shortest first.
   * Walks forward from the root in O(longest match); reports nothing about any
   * other position. This is the on-demand probe the search uses.
   */
  matchesAt(seq: ArrayLike<number>, pos: number): Array<Match<P>> {
    const out: Array<Match<P>> = [];
    let s = ROOT;
    for (let i = pos, n = seq.length; i < n; i++) {
      s = this._follow(s, seq[i]);
      if (s === -1) break;
      const id = this._end[s];
      if (id !== -1) {
        out.push({
          start: pos,
          end: i + 1,
          length: this._lens[id],
          id,
          payload: this._vals[id],
        });
      }
    }
    return out;
  }

  /**
   * Every occurrence of every pattern anywhere in `seq` (eager form, the union
   * of {@link matchesAt} over all start positions). O(seq · longest pattern),
   * independent of how many patterns are stored. Use {@link matchesAt} when the
   * search only needs the sites at a particular position.
   */
  scan(seq: ArrayLike<number>): Array<Match<P>> {
    const out: Array<Match<P>> = [];
    for (let pos = 0, n = seq.length; pos < n; pos++) {
      let s = ROOT;
      for (let i = pos; i < n; i++) {
        s = this._follow(s, seq[i]);
        if (s === -1) break;
        const id = this._end[s];
        if (id !== -1) {
          out.push({
            start: pos,
            end: i + 1,
            length: this._lens[id],
            id,
            payload: this._vals[id],
          });
        }
      }
    }
    return out;
  }
}
