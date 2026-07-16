// bytes.ts — small, pure byte-span utilities.
//
// Nothing here knows about Sema, the store, or the search; these are the
// mechanical operations on Uint8Arrays that the rest of the code leans on, kept
// together so a reader meets them once and never wonders whether a given helper
// hides a side effect.
/** True when two byte spans are equal in length and content. */
export function bytesEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
/** Concatenate byte arrays. Takes an array rather than rest params so
 *  a large segment list can never overflow the call stack via spread. */
export function concatBytes(parts) {
  let total = 0;
  for (const p of parts) {
    total += p.length;
  }
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
export function concat2(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
/** Latin-1 view of a byte span — a stable, lossless string key for chart
 *  memoization (every byte 0–255 maps to one code unit). */
export function latin1(b) {
  let s = "";
  for (let k = 0; k < b.length; k++) {
    s += String.fromCharCode(b[k]);
  }
  return s;
}
/** First index ≥ `from` at which `needle` occurs in `hay`, or -1.  A short naive
 *  scan — used only to locate a result span inside a learnt framing form. */
export function indexOf(hay, needle, from) {
  if (needle.length === 0) {
    return from;
  }
  outer: for (let i = Math.max(0, from); i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}
