// bytes.ts — small, pure byte-span utilities.
//
// Nothing here knows about Sema, the store, or the search; these are the
// mechanical operations on Uint8Arrays that the rest of the code leans on, kept
// together so a reader meets them once and never wonders whether a given helper
// hides a side effect.

/** True when two byte spans are equal in length and content. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Concatenate byte arrays. Takes an array rather than rest params so
 *  a large segment list can never overflow the call stack via spread. */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Join two byte spans — the hot two-operand case of {@link concatBytes},
 *  fused without the array wrapper for the search's inner fuse loop. */
export function concat2(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Latin-1 view of a byte span — a stable, lossless string key for chart
 *  memoization (every byte 0–255 maps to one code unit). */
export function latin1(b: Uint8Array): string {
  let s = "";
  for (let k = 0; k < b.length; k++) s += String.fromCharCode(b[k]);
  return s;
}

/** First index ≥ `from` at which `needle` occurs in `hay`, or -1.  A short naive
 *  scan — used only to locate a result span inside a learnt framing form. */
export function indexOf(
  hay: Uint8Array,
  needle: Uint8Array,
  from: number,
): number {
  if (needle.length === 0) return from;
  outer:
  for (let i = Math.max(0, from); i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** The span of `bytes` between its first and last non-separator byte — the
 *  QUESTION, with any leading/trailing whitespace dropped.  Returns a subarray
 *  (no copy) and the original when there is nothing to trim.
 *
 *  canon.ts's contract states the reading: "a span's leading or trailing
 *  separator belongs BETWEEN forms, not to the form".  canon itself preserves
 *  edge whitespace, and must, because the hazard it cites is a recognised
 *  SUB-span swallowing the boundary byte separating it from its neighbour
 *  ("ice " matching the stored "ice").  At the outer edges of a WHOLE input
 *  there is no neighbour — nothing precedes byte 0, nothing follows the last
 *  byte — so that hazard cannot arise and the trim is safe exactly there.
 *
 *  TEXT ONLY.  For a binary or grid modality 0x20 is content, not presentation,
 *  so callers must gate this on the same `typeof input === "string"` test that
 *  decides whether to inject the text canonicalizer. */
export function trimEdgeSeparators(bytes: Uint8Array): Uint8Array {
  const sep = (b: number) =>
    b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
  let from = 0;
  let to = bytes.length;
  while (from < to && sep(bytes[from])) from++;
  while (to > from && sep(bytes[to - 1])) to--;
  return from === 0 && to === bytes.length ? bytes : bytes.subarray(from, to);
}
