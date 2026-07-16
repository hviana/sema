// text.ts — the byte-class floor the ALU's lexing rests on.
//
// SEMA is byte-native and multimodal; the ALU keeps its knowledge of raw text
// as small as possible.  What remains is the IRREDUCIBLE floor — the decimal
// numeral grammar (digits ground a quantity exactly as the byte alphabet
// grounds a symbol), whitespace as the universal spacing byte, and the list
// grammar's delimiters — collected HERE, once, so no other module hardcodes a
// character class of its own.  Everything above this floor (which spans name
// operations, where terms begin and end, what an expression means) is resolved
// from the operation registry, the host's geometric segmentation, or resonance.
/** An ASCII decimal digit. */
export const isDigitByte = (c) => c >= 0x30 && c <= 0x39;
/** The decimal point of a numeral. */
export const DOT = 0x2e; // "."
/** The explicit list container's delimiters — the canonical nd spelling the
 *  codec emits, so a computed list feeds straight back in as an operand. */
export const OPEN = 0x5b; // "["
export const CLOSE = 0x5d; // "]"
/** ASCII whitespace (space, tab, newline, carriage return) — the one spacing
 *  convention bytes of every textual modality share. */
export const isSpaceByte = (c) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
/** A byte that DELIMITS list elements inside an explicit container: whitespace,
 *  a comma, or a semicolon.  Deliberately excludes anything that can sit inside
 *  a numeral or a symbol token (letters, digits, sign/decimal `+ - .`) and the
 *  brackets themselves, so an element's own bytes are never split. */
export const isSepByte = (c) => isSpaceByte(c) || c === 0x2c /* , */ || c === 0x3b /* ; */;
/** The index of the first non-whitespace byte (or the length, if all space). */
export function trimStart(b) {
    let i = 0;
    while (i < b.length && isSpaceByte(b[i]))
        i++;
    return i;
}
/** The index one past the last non-whitespace byte (or 0, if all space). */
export function trimEnd(b) {
    let j = b.length;
    const lo = trimStart(b);
    while (j > lo && isSpaceByte(b[j - 1]))
        j--;
    return j;
}
/** The index of the `]` matching the `[` at `open`, bracket-depth aware, or -1
 *  when it is unbalanced — used to test whether a span is one explicit list
 *  CONTAINER (its opening bracket closing exactly at its end). */
export function matchBracket(b, open) {
    let depth = 0;
    for (let i = open; i < b.length; i++) {
        if (b[i] === OPEN)
            depth++;
        else if (b[i] === CLOSE && --depth === 0)
            return i;
    }
    return -1;
}
/** The maximal non-whitespace runs of `bytes` within [from, to) — the spacing
 *  floor's reading of "the tokens", shared by the structural host's segmenter
 *  and the parser's term lexing so neither re-implements the walk. */
export function nonSpaceRuns(bytes, from = 0, to = bytes.length) {
    const out = [];
    let i = from;
    while (i < to) {
        if (isSpaceByte(bytes[i])) {
            i++;
            continue;
        }
        let j = i;
        while (j < to && !isSpaceByte(bytes[j]))
            j++;
        out.push({ i, j });
        i = j;
    }
    return out;
}
