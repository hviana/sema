// canonical.ts — THE canonical-segmentation convention, defined once.
//
// The store's canonical reading of a byte stream — "the id of each single-byte
// leaf, chained into flat branches" — is a WRITE/READ CONTRACT split across
// four consumers that previously each re-implemented the chaining loop:
//
//   WRITE side (training):
//     • learning.indexSubSpans — interns sliding windows of the two
//       {@link canonicalWindows} lengths over the stream's leaf ids;
//     • learning.deposit — interns the WHOLE stream as one flat branch
//       (via {@link leafIdPrefix}) so every deposit has a byte-level identity.
//   READ side (inference):
//     • recognition's canonical pass — chains leaf ids from every position and
//       probes each growing prefix as a flat branch, up to {@link chainReach};
//     • attention.canonicalChunkId — reads a chunk's window of leaf ids
//       (via {@link leafIdRun}) and probes its prefixes for the best anchor.
//   (geometry.knownPrefixLength is the same convention below the store layer,
//    expressed through injected `leafAt`/`lookup` capabilities — it cannot
//    import this module without inverting the dependency spine, so its header
//    cross-references this file instead.)
//
// If the write side's windows or the read side's reach ever change, they must
// change HERE — a drift between them silently makes recognition stop finding
// what training indexed, which no type checker catches.
/** The two sliding-window lengths the WRITE side interns over a stream's leaf
 *  ids: W−1 and W (the river's grouping quantum and its off-by-one neighbour,
 *  so a form straddling a group boundary is reachable from either cut). */
export function canonicalWindows(W) {
  return [W - 1, W];
}
/** The READ side's chain reach: how many leaf ids a canonical chain may grow
 *  to from one position — W², the deepest two-level composite the write side's
 *  windows can spell. */
export function chainReach(W) {
  return W * W;
}
/** The id of the single-byte leaf at position `p`, or null when that byte was
 *  never interned. */
export function leafIdAt(ctx, bytes, p) {
  return ctx.store.findLeaf(bytes.subarray(p, p + 1));
}
/** The leaf ids of the window `[from, to)`, or null the moment ANY byte in it
 *  is unknown — the all-or-nothing read {@link canonicalChunkId} anchors on. */
export function leafIdRun(ctx, bytes, from, to) {
  const ids = [];
  for (let i = from; i < to; i++) {
    const lid = leafIdAt(ctx, bytes, i);
    if (lid === null) {
      return null;
    }
    ids.push(lid);
  }
  return ids;
}
/** The leaf ids of the LONGEST KNOWN PREFIX of `bytes` — stops at the first
 *  unknown byte and returns what it has (possibly empty).  The caller decides
 *  what a partial prefix means (deposit only interns the whole-stream flat
 *  branch when the prefix covers everything). */
export function leafIdPrefix(ctx, bytes) {
  const ids = [];
  for (let i = 0; i < bytes.length; i++) {
    const lid = leafIdAt(ctx, bytes, i);
    if (lid === null) {
      break;
    }
    ids.push(lid);
  }
  return ids;
}
/** The canonical W-window node ids of a byte stream, offset → id — the
 *  CONTENT-ADDRESSED IDENTITY of every W-sized slice, under which any content
 *  two deposits share IS the same node (hash-consing paid the comparison at
 *  write time).  The read side of the {@link canonicalWindows} contract asked
 *  at every offset: a window over unknown bytes, or one never interned as a
 *  flat branch, has no identity and is skipped.  Confluence's meet and CAST's
 *  frame detection both read shared/common content through this — never
 *  through a byte scan. */
export function windowIds(ctx, bytes) {
  const W = ctx.space.maxGroup;
  const out = new Map();
  for (let off = 0; off + W <= bytes.length; off++) {
    const ids = leafIdRun(ctx, bytes, off, off + W);
    if (ids === null) {
      continue;
    }
    const wid = ctx.store.findBranch(ids);
    if (wid !== null) {
      out.set(off, wid);
    }
  }
  return out;
}
