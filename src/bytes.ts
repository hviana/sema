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

/** Latin-1 view of a byte span — ONE code unit per byte, so it is injective
 *  and safe as an exact cache key (every byte 0–255 maps to one code unit).
 *  Batched `String.fromCharCode`, chunked to stay within the engine's argument
 *  limit on long spans; the one definition every content-keyed memo uses.
 *  `apply` takes the typed array as its argument list directly — a spread
 *  walks it through the iterator protocol first, ~2.7× slower per short key. */
export function latin1(b: Uint8Array): string {
  const n = b.length;
  let s = "";
  for (let i = 0; i < n; i += 4096) {
    s += String.fromCharCode.apply(
      null,
      b.subarray(i, Math.min(i + 4096, n)) as unknown as number[],
    );
  }
  return s;
}

/** One key for a SEQUENCE of byte strings: each part prefixed by its length,
 *  so the key is injective for arbitrary bytes.  A separator byte is not: with
 *  `\0` between parts, (`A\0`, `B`) and (`A`, `\0B`) share a key. */
export function bytesKey(...parts: Uint8Array[]): string {
  let s = "";
  for (const p of parts) s += `${p.length}:` + latin1(p);
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

/** THE FRAME two byte runs share around what varies: the length of their
 *  longest common PREFIX, then of their longest common SUFFIX in what is left
 *  of the shorter — so the two never overlap.  Over `a[as, ae)` and
 *  `b[bs, be)`; whole arrays by default. */
export function sharedEnds(
  a: Uint8Array,
  b: Uint8Array,
  as = 0,
  ae = a.length,
  bs = 0,
  be = b.length,
): [number, number] {
  const max = Math.min(ae - as, be - bs);
  let p = 0;
  while (p < max && a[as + p] === b[bs + p]) p++;
  let s = 0;
  while (s < max - p && a[ae - 1 - s] === b[be - 1 - s]) s++;
  return [p, s];
}
