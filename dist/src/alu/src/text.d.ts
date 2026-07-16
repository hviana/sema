/** An ASCII decimal digit. */
export declare const isDigitByte: (c: number) => boolean;
/** The decimal point of a numeral. */
export declare const DOT = 46;
/** The explicit list container's delimiters — the canonical nd spelling the
 *  codec emits, so a computed list feeds straight back in as an operand. */
export declare const OPEN = 91;
export declare const CLOSE = 93;
/** ASCII whitespace (space, tab, newline, carriage return) — the one spacing
 *  convention bytes of every textual modality share. */
export declare const isSpaceByte: (c: number) => boolean;
/** A byte that DELIMITS list elements inside an explicit container: whitespace,
 *  a comma, or a semicolon.  Deliberately excludes anything that can sit inside
 *  a numeral or a symbol token (letters, digits, sign/decimal `+ - .`) and the
 *  brackets themselves, so an element's own bytes are never split. */
export declare const isSepByte: (c: number) => boolean;
/** The index of the first non-whitespace byte (or the length, if all space). */
export declare function trimStart(b: Uint8Array): number;
/** The index one past the last non-whitespace byte (or 0, if all space). */
export declare function trimEnd(b: Uint8Array): number;
/** The index of the `]` matching the `[` at `open`, bracket-depth aware, or -1
 *  when it is unbalanced — used to test whether a span is one explicit list
 *  CONTAINER (its opening bracket closing exactly at its end). */
export declare function matchBracket(b: Uint8Array, open: number): number;
/** The maximal non-whitespace runs of `bytes` within [from, to) — the spacing
 *  floor's reading of "the tokens", shared by the structural host's segmenter
 *  and the parser's term lexing so neither re-implements the walk. */
export declare function nonSpaceRuns(
  bytes: Uint8Array,
  from?: number,
  to?: number,
): Array<{
  i: number;
  j: number;
}>;
