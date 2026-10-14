// canonical.ts — THE canonical-segmentation convention, defined once.
//
// The store's canonical reading of a byte stream — "the id of each single-byte
// leaf, chained into flat branches" — is a WRITE/READ CONTRACT split across
// four consumers that previously each re-implemented the chaining loop:
//
//   WRITE side (training):
//     • learning.indexSubSpans — interns sliding windows of the two
//       {@link canonicalWindows} lengths over the stream's leaf ids;
//     • learning.deposit — interns the WHOLE stream as one flat branch so
//       every deposit has a byte-level identity.
//   READ side (inference):
//     • recognition's sweep — every span from every start probed as a flat
//       branch, its hash extended a byte at a time, within W⁴ + 2r;
//     • every W-window reading — {@link windowIds}, the one table of the
//       content address of each W-slice of a byte stream.
//
// A single-byte leaf needs no lookup: its id is implicit, −(b+1), so every
// byte span HAS a kid run and its flat identity is one probe ({@link flatId}).
//   (geometry.knownPrefixLength is the same convention below the store layer,
//    expressed through injected `leafAt`/`lookup` capabilities — it cannot
//    import this module without inverting the dependency spine, so its header
//    cross-references this file instead.)
//
// If the write side's windows or the read side's reach ever change, they must
// change HERE — a drift between them silently makes recognition stop finding
// what training indexed, which no type checker catches.

import type { MindContext } from "./types.js";
import { flatBytesKids } from "../store.js";

/** The two sliding-window lengths the WRITE side interns over a stream's leaf
 *  ids: W−1 and W (the river's grouping quantum and its off-by-one neighbour,
 *  so a form straddling a group boundary is reachable from either cut).
 *
 *  Widening this to cover the reader's full segment scale (W−1..2W) was
 *  measured and REFUTED: it tripled the store (3,160 → 8,980 nodes on a
 *  200-pair corpus), slowed ingest 80%, and fixed not one test.  Unknown
 *  regions are not caused by the index's scale. */
export function canonicalWindows(W: number): [number, number] {
  return [W - 1, W];
}

/** The READ side's chain reach: how many leaf ids a canonical chain may grow
 *  to from one position — W², the deepest two-level composite the write side's
 *  windows can spell. */
export function chainReach(W: number): number {
  return W * W;
}

/** THE FLAT NODE over a byte span — the node the write side interns for a
 *  whole deposit and for each canonical window — or null when none was
 *  interned.  One content-addressed probe; the store's negative filter refuses
 *  most misses without I/O. */
export function flatId(ctx: MindContext, span: Uint8Array): number | null {
  const store = ctx.store;
  return store.findFlatBranch
    ? store.findFlatBranch(span)
    : store.findBranch(flatBytesKids(span));
}

/** Which prefixes of `prefix ‖ tail` are STORED NODES — as lengths in the
 *  tail's own coordinates, ascending, excluding the empty one.  This is the
 *  candidate set a rule needs to join an already-stored prefix to a suffix it
 *  has not stored: a key names a relation exactly when `prefix ‖ tail[0..p]` IS
 *  a node, and a key can end strictly inside the tail without sitting on any
 *  fold boundary (a stored member's end is the end of ITS OWN stream, and the
 *  fold never emits a cut at a stream's end).  Measured: "stockholm mayor"
 *  exists, leads on, and its boundary 6 is in neither the tail's cuts nor the
 *  concatenation's.
 *
 *  ONE cheap content-addressed probe per offset, the hash extended by one byte
 *  per probe ({@link Store.flatSpans}), and NO `resolve`, which is what keeps
 *  this off the O(suffix) vector folds the recognition path pays. */
export function keyEnds(
  ctx: MindContext,
  prefix: Uint8Array,
  tail: Uint8Array,
): number[] {
  if (prefix.length === 0 || tail.length === 0) return [];
  const joined = new Uint8Array(prefix.length + tail.length);
  joined.set(prefix, 0);
  joined.set(tail, prefix.length);
  const probe = ctx.store.flatSpans?.(joined) ??
    ((s: number, e: number) => flatId(ctx, joined.subarray(s, e)));
  const ends: number[] = [];
  for (let p = 1; p <= tail.length; p++) {
    if (probe(0, prefix.length + p) !== null) ends.push(p);
  }
  return ends;
}

/** The content-addressed id of the W-window of `bytes` at offset `o`, or
 *  null when none was interned — THE window identity every W-window reading
 *  of the engine asks (commonness, scaffolding, anchors, dismissed content,
 *  shared content).  Memoised per byte array and store state, offset by
 *  offset, so a reader that stops early pays only for what it read and a
 *  second reader of the same bytes pays nothing. */
export function windowAt(
  ctx: MindContext,
  bytes: Uint8Array,
  o: number,
): number | null {
  const table = tableOf(ctx, bytes);
  let id = table.at.get(o);
  if (id === undefined) {
    const W = ctx.space.maxGroup;
    id = o + W <= bytes.length ? flatId(ctx, bytes.subarray(o, o + W)) : null;
    table.at.set(o, id);
  }
  return id;
}

/** The canonical W-window node ids of a byte stream, offset → id, ascending —
 *  {@link windowAt} at every offset, with the windows never interned left
 *  out.  Under this identity any content two deposits share IS the same node
 *  (hash-consing paid the comparison at write time). */
export function windowIds(
  ctx: MindContext,
  bytes: Uint8Array,
): Map<number, number> {
  const table = tableOf(ctx, bytes);
  if (table.all === undefined) {
    const W = ctx.space.maxGroup;
    const all = new Map<number, number>();
    for (let o = 0; o + W <= bytes.length; o++) {
      const id = windowAt(ctx, bytes, o);
      if (id !== null) all.set(o, id);
    }
    table.all = all;
  }
  return table.all;
}

interface WindowTable {
  key: object;
  at: Map<number, number | null>;
  all?: Map<number, number>;
}
const windowTables = new WeakMap<Uint8Array, WindowTable>();
function tableOf(ctx: MindContext, bytes: Uint8Array): WindowTable {
  let t = windowTables.get(bytes);
  if (t === undefined || t.key !== ctx._structMemoKey) {
    t = { key: ctx._structMemoKey, at: new Map() };
    windowTables.set(bytes, t);
  }
  return t;
}
