/** True when two byte spans are equal in length and content. */
export declare function bytesEqual(a: Uint8Array, b: Uint8Array): boolean;
/** Concatenate byte arrays. Takes an array rather than rest params so
 *  a large segment list can never overflow the call stack via spread. */
export declare function concatBytes(parts: Uint8Array[]): Uint8Array;
/** Join two byte spans — the hot two-operand case of {@link concatBytes},
 *  fused without the array wrapper for the search's inner fuse loop. */
export declare function concat2(a: Uint8Array, b: Uint8Array): Uint8Array;
/** Latin-1 view of a byte span — a stable, lossless string key for chart
 *  memoization (every byte 0–255 maps to one code unit). */
export declare function latin1(b: Uint8Array): string;
/** First index ≥ `from` at which `needle` occurs in `hay`, or -1.  A short naive
 *  scan — used only to locate a result span inside a learnt framing form. */
export declare function indexOf(
  hay: Uint8Array,
  needle: Uint8Array,
  from: number,
): number;
