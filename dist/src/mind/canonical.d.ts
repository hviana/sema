import type { MindContext } from "./types.js";
/** The two sliding-window lengths the WRITE side interns over a stream's leaf
 *  ids: W−1 and W (the river's grouping quantum and its off-by-one neighbour,
 *  so a form straddling a group boundary is reachable from either cut). */
export declare function canonicalWindows(W: number): [number, number];
/** The READ side's chain reach: how many leaf ids a canonical chain may grow
 *  to from one position — W², the deepest two-level composite the write side's
 *  windows can spell. */
export declare function chainReach(W: number): number;
/** The id of the single-byte leaf at position `p`, or null when that byte was
 *  never interned. */
export declare function leafIdAt(ctx: MindContext, bytes: Uint8Array, p: number): number | null;
/** The leaf ids of the window `[from, to)`, or null the moment ANY byte in it
 *  is unknown — the all-or-nothing read {@link canonicalChunkId} anchors on. */
export declare function leafIdRun(ctx: MindContext, bytes: Uint8Array, from: number, to: number): number[] | null;
/** The leaf ids of the LONGEST KNOWN PREFIX of `bytes` — stops at the first
 *  unknown byte and returns what it has (possibly empty).  The caller decides
 *  what a partial prefix means (deposit only interns the whole-stream flat
 *  branch when the prefix covers everything). */
export declare function leafIdPrefix(ctx: MindContext, bytes: Uint8Array): number[];
/** The canonical W-window node ids of a byte stream, offset → id — the
 *  CONTENT-ADDRESSED IDENTITY of every W-sized slice, under which any content
 *  two deposits share IS the same node (hash-consing paid the comparison at
 *  write time).  The read side of the {@link canonicalWindows} contract asked
 *  at every offset: a window over unknown bytes, or one never interned as a
 *  flat branch, has no identity and is skipped.  Confluence's meet and CAST's
 *  frame detection both read shared/common content through this — never
 *  through a byte scan. */
export declare function windowIds(ctx: MindContext, bytes: Uint8Array): Map<number, number>;
