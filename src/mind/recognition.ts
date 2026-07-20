// recognition.ts — Section 2 of the mind:
// Address + Read over byte streams — decompose a query into its known forms.
//
//   recognise — structural + canonical decomposition into every stored form
//               that leads somewhere (has a continuation edge or a halo).
//   segment   — leaf-parent segmentation using the geometry's own groupings.
import { rItem } from "./trace.js";

import type { MindContext, Recognition, Segment } from "./types.js";
import {
  canonResolve,
  foldTree,
  gistOf,
  latin1Key,
  perceive,
  resolve,
} from "./primitives.js";
import { atomIsHub, corpusN, leadsSomewhere } from "./traverse.js";
import { chainReach, leafIdAt, leafIdRun } from "./canonical.js";
import { isChunk, type Sema } from "../sema.js";
import type { Leaf, Site } from "./graph-search.js";

/** Decompose a byte stream into every stored form that leads somewhere
 *  (has a continuation edge or a halo).  Two complementary readings:
 *
 *   • structural — walk the query's own perceived tree, naming each subtree
 *     by findLeaf at the leaves and findBranch above.  Catches every form
 *     aligned to the query's segmentation.
 *
 *   • canonical — re-derive the store's segmentation directly: at each byte,
 *     the longest known leaf, chained into flat branches.  Names forms the
 *     query's own cut cannot, and records sub-leaf boundaries as `splits`.
 *
 *  Both O(n · maxGroup) bounded O(1) probes — never a scan of the corpus. */
export function recognise(ctx: MindContext, bytes: Uint8Array): Recognition {
  // Content-keyed memo — works for both single-turn respond() and multi-turn
  // respondTurn() (where the map persists across calls).  ALWAYS consulted,
  // regardless of tracing — matching perceive()'s own memo, which carries no
  // trace gate at all.  This memo is NOT an optional accelerator: recogniseImpl
  // walks the query's perceived tree via foldTree, whose subtree-resolution
  // fast path (see primitives.ts) skips invoking `visit` — and therefore
  // skips EMITTING SITES — for any subtree already cached in
  // ctx._resolvedSubtrees.  A multi-turn conversation's stable-prefix fold
  // deliberately shares node OBJECTS across turns, so by the second call on
  // the exact same bytes, large swaths of the tree are already cached and
  // foldTree stops short of recursing into them — a second recogniseImpl
  // call on the SAME bytes is not idempotent; it silently finds FEWER sites
  // than the first (observed live: 31 sites → 5 on an immediate repeat
  // call).  Skipping this memo "only while tracing" used to mean every
  // traced turn re-ran recogniseImpl from scratch at every one of the many
  // call sites that recognise the same query (cover, reason, articulate...),
  // each subsequent call silently more incomplete than the last — measurably
  // changing which mechanism grounds the answer, not just costing time.  The
  // trace step must still fire on every call regardless (a cache hit is not
  // silent), so it is emitted here directly instead of only inside
  // recogniseImpl.
  if (ctx.recogniseMemo) {
    const key = latin1Key(bytes);
    const hit = ctx.recogniseMemo.get(key);
    if (hit !== undefined) {
      ctx.trace?.step(
        "recognise",
        [rItem(bytes, "query")],
        hit.sites.map((s) =>
          rItem(bytes.subarray(s.start, s.end), "form", s.payload, [
            s.start,
            s.end,
          ])
        ),
        `decompose the query into ${hit.sites.length} learnt form(s) that ` +
          `lead somewhere (over ${hit.leaves.length} perceived leaves) [cached]`,
      );
      return hit;
    }
    const fresh = recogniseImpl(ctx, bytes);
    ctx.recogniseMemo.set(key, fresh);
    return fresh;
  }
  return recogniseImpl(ctx, bytes);
}

function recogniseImpl(ctx: MindContext, bytes: Uint8Array): Recognition {
  const store = ctx.store;
  const sites: Site[] = [];
  const leaves: Leaf[] = [];
  const splits = new Set<number>();
  const starts = new Set<number>();
  if (bytes.length === 0) return { sites, leaves, splits, starts };

  // Span-resolve memo for THIS call: the structural pass (sub-runs inside
  // leaf-parents) and the canonical pass (leaf-id chains) probe overlapping
  // spans, and each resolve() is a full fold of the sub-span (fresh subarray
  // objects — the per-response perceive memo cannot see them).  Keyed
  // numerically by (start, end); resolve is pure and the store is read-only
  // here, so a hit is exact.
  const spanIds = new Map<number, number | null>();
  const resolveSpan = (start: number, end: number): number | null => {
    const key = start * (bytes.length + 1) + end;
    let id = spanIds.get(key);
    if (id === undefined) {
      id = resolve(ctx, bytes.subarray(start, end));
      spanIds.set(key, id);
    }
    return id;
  };

  // Byte atoms (implicit negative-id single-byte leaves) are admitted as
  // recognised sites only while atoms can still DISCRIMINATE at this corpus
  // scale (see {@link atomIsHub}).  On a small store a single-letter fact
  // ("a" → "A") is genuine learnt content and its site is essential; on a
  // large one every letter of every query would otherwise become a
  // "recognised form" — the bridge then finds junction connectors between
  // bare letters, cover follows edges hanging off them, and pure noise
  // ("qq8f3kz9…") grounds to an arbitrary learnt sentence instead of
  // silence.  Atoms stay available as leaves (PASS-carried literals) and
  // through exact tier-0 resolution regardless.
  const atomsAreHubs = atomIsHub(ctx, corpusN(ctx));
  // Distinct probes (structural exact match, canon fallback, edge trims at
  // several offsets) can legitimately re-derive the SAME (start, end, id)
  // site from different tree nodes — a wide edge-trim search is exactly
  // this on purpose (see below).  Duplicate site entries are not wrong
  // evidence, but they double the weight cover's derivation search gives
  // that span, distorting its cost model — the same span must count once.
  const seen = new Set<string>();
  const emit = (start: number, end: number, id: number) => {
    if (id < 0 && atomsAreHubs) return;
    const key = start + "," + end + "," + id;
    if (seen.has(key)) return;
    seen.add(key);
    if (leadsSomewhere(ctx, id)) {
      sites.push({ start, end, payload: id });
    }
  };

  // ── structural: the query's own perceived tree ──────────────────────
  starts.add(0);
  foldTree(ctx, perceive(ctx, bytes), 0, (n, start, end, node) => {
    if (n.kids === null) {
      leaves.push({ start, end, bytes: n.leaf ?? new Uint8Array(0), node });
    }
    if (node !== null) emit(start, end, node);
    // Canonical fallback: a subtree whose exact content-addressed lookup
    // missed may still be a stored form under the response's equivalence
    // (case, width, whitespace — whatever the injected canonicalizer says).
    // O(subtree bytes) per miss, memoised per response; a no-op when no
    // canonicalizer was injected or the store has no canon index.  A raw
    // leaf (n.kids === null) is single-byte and handled by the byte-atom
    // path above instead — canon equivalence only applies to composites.
    else if (n.kids !== null) {
      const cid = canonResolve(ctx, bytes.subarray(start, end));
      if (cid !== null) emit(start, end, cid);
      // The edge-trim fallbacks below remove 1 byte from a side; the
      // remainder must still be a composite (>= 2 bytes, the same floor
      // n.kids !== null enforces above) rather than degenerate into
      // single-byte-atom territory, which atomIsHub already governs
      // separately.
      else if (end - start - 1 >= 2) {
        // The chunk's own boundary is drawn by content geometry, not by
        // any notion of "form" — it can include one edge byte the query's
        // fold happened to attach here that the trained span never had
        // (e.g. a separator from the preceding chunk).  The core has no
        // idea what that byte means; it only knows resolve()/canonResolve
        // are self-verifying (hash-then-verify, same discipline as every
        // content lookup here), so a blind one-byte-shorter guess on
        // either edge costs nothing when wrong and is trustworthy when it
        // hits.  Two extra probes, only on the already-failed miss path.
        const left = resolve(ctx, bytes.subarray(start + 1, end));
        if (left !== null) emit(start + 1, end, left);
        const right = resolve(ctx, bytes.subarray(start, end - 1));
        if (right !== null) emit(start, end - 1, right);
        // A misalignment wider than one byte (e.g. more than one edge
        // separator swallowed) is not itself geometry-quantized — the
        // WRITE side's canonical index (canonicalWindows) interns sliding
        // W−1/W-length windows over leaf ids at EVERY offset, not just
        // radix-aligned ones (see canonical.ts) — so the offset that
        // recovers a trained span can be anything, not a multiple of W.
        // What IS bounded is how far it's worth looking: chainReach(W)=W²,
        // the same reach the canonical pass (tryChain) trusts for a chain
        // rebuilt off the query's own fold.  Every candidate offset is
        // gated by store.findBranch(leafIds) first — the SAME cheap,
        // fold-free existence check tryChain already uses — so the extra
        // resolve() fold (the real cost) is only paid when a branch could
        // plausibly exist there, not for every offset.  The node itself is
        // also bounded to chunk-scale (end - start <= W²): widening this at
        // whole-query/root scale can rediscover a smaller subtree's own
        // content as a second, overlapping site the structural walk's own
        // finer recursion already emits correctly on its own — a duplicate
        // that downstream derivation can stitch into a wrong answer.
        const W = ctx.space.maxGroup;
        for (
          let k = 1;
          end - start <= W * W && k <= W * W && start + k < end - 1;
          k++
        ) {
          const lIds = leafIdRun(ctx, bytes, start + k, end);
          if (lIds !== null && store.findBranch(lIds) !== null) {
            const eLeft = resolve(ctx, bytes.subarray(start + k, end));
            if (eLeft !== null) emit(start + k, end, eLeft);
          }
          const rIds = leafIdRun(ctx, bytes, start, end - k);
          if (rIds !== null && store.findBranch(rIds) !== null) {
            const eRight = resolve(ctx, bytes.subarray(start, end - k));
            if (eRight !== null) emit(start, end - k, eRight);
          }
        }
        // A REAL extra word at the left edge (a discourse connective like
        // "And " prepended to a follow-up turn — not boundary noise, actual
        // content the injected canonicalizer has no equivalence for) shows
        // up as a canon-miss too big for the chunk-scale search above: the
        // turn is its OWN segment (stable-prefix folded independently — see
        // mind.ts's _growContext), so it can be turn/segment-scale, not
        // chunk-scale.  Widening the size bound itself reopens the root-
        // scale false-positive this module already fixed once (test/46);
        // widening the SEARCH instead — trying every position up to W
        // chunk-widths from the left edge that the query's OWN fold treats
        // as a chunk boundary (`starts`, the same set the canonical pass
        // privileges with full chain reach) — does not: `starts.has(p)` is
        // fold EVIDENCE the query produced on its own (a leaf-parent chunk
        // like "And " is visited, and its start added to `starts`, before
        // this composite ever runs — foldTree is post-order), never a blind
        // guess.  Bounded to W candidates, each an O(1) set lookup before
        // paying for the real canonResolve fold — canonResolve, not
        // resolve()/findBranch, because the gap here is often exactly the
        // kind of equivalence (case, in the live trace) canon exists for,
        // not just an exact-content coincidence.
        for (let k = 1; k <= W; k++) {
          const p = start + k * W;
          if (p >= end - 1 || !starts.has(p)) continue;
          const cid = canonResolve(ctx, bytes.subarray(p, end));
          if (cid !== null) emit(p, end, cid);
        }
      }
    }
    if (isChunk(n)) {
      starts.add(start);
      // Try every sub-span within this leaf-parent.
      const leafOffsets: number[] = [];
      let off = start;
      for (const k of n.kids) {
        leafOffsets.push(off);
        off += k.leaf?.length ?? 0;
      }
      // Sub-spans starting at i > 0 begin INSIDE the chunk, at an offset the
      // query's own fold did not itself choose as a boundary — the same
      // opportunistic byte-atom-chain risk `tryChain`'s `boundary` gate
      // guards below (see its comment).  Only the chunk's own left edge
      // (i === 0, already registered in `starts` above) carries the fold's
      // evidence; interior sub-starts are exempt from the guard only while
      // atoms themselves still discriminate at this corpus scale.
      for (let i = 0; i < n.kids.length; i++) {
        if (i > 0 && atomsAreHubs) break;
        const subIds: number[] = [];
        for (let j = i; j < n.kids.length; j++) {
          const kj = n.kids[j];
          if (kj.kids !== null || !kj.leaf) break;
          const lid = store.findLeaf(kj.leaf);
          if (lid === null) break;
          subIds.push(lid);
          const branch = store.findBranch(subIds);
          if (branch === null) continue;
          const subEnd = leafOffsets[j] + (kj.leaf?.length ?? 0);
          const resolved = resolveSpan(leafOffsets[i], subEnd);
          if (resolved !== null) emit(leafOffsets[i], subEnd, resolved);
        }
      }
    }
  });

  // ── canonical: longest-known-leaf re-segmentation ──────────────────
  const W = ctx.space.maxGroup;
  const singleLeaf: Array<{ id: number; end: number } | null> = new Array(
    bytes.length,
  ).fill(null);
  for (let p = 0; p < bytes.length; p++) {
    const id = leafIdAt(ctx, bytes, p);
    if (id !== null) singleLeaf[p] = { id, end: p + 1 };
  }

  const leafFrom = (p: number): { id: number; end: number } | null => {
    if (p >= bytes.length) return null;
    return singleLeaf[p];
  };

  const chunkEnd = new Uint32Array(bytes.length);
  const sorted = [...starts].sort((a, b) => a - b);
  for (let si = 0; si < sorted.length; si++) {
    const chunkStart = sorted[si];
    const chunkLimit = si + 1 < sorted.length ? sorted[si + 1] : bytes.length;
    for (let p = chunkStart; p < chunkLimit; p++) {
      chunkEnd[p] = chunkLimit;
    }
  }

  // A chain rebuilt from a NON-boundary offset (the query's own perceived
  // cut, `starts`, never chose to segment here) is opportunistic: the same
  // byte-atom coincidence the hub guard above already exists for, just
  // spelled over 2+ leaves instead of 1.  At small corpus scale that's fine
  // — coincidence is rare and every chain is real evidence (see `atomIsHub`).
  // Past the scale where atoms themselves stop discriminating, the same
  // uniform-expectation argument bounds a CHAIN'S commonality too: it is at
  // least as rare as its rarest atom, so a store where atoms are hubs makes
  // interior chain reconstructions no more trustworthy than the atoms they
  // are built from ("hi" resolving out of "W[hi]ch" is exactly this: two
  // hub-scale atoms, chained at an offset nothing in the query's own fold
  // selected).  Chains that start ON a boundary carry the fold's own
  // evidence instead and are exempt.
  const tryChain = (
    p: number,
    maxIds: number,
    boundary: boolean,
  ): void => {
    const first = leafFrom(p);
    if (!first) return;
    emit(p, first.end, first.id);
    const ids = [first.id];
    let pos = first.end;
    let prevId: number | null = null;
    for (let depth = 1; pos < bytes.length && ids.length <= maxIds; depth++) {
      const nx = leafFrom(pos);
      if (!nx) break;
      ids.push(nx.id);
      pos = nx.end;
      if (store.findBranch(ids) === null) continue;
      if (!boundary && atomsAreHubs) continue;
      const id = resolveSpan(p, pos);
      if (id === null || id === prevId) continue;
      prevId = id;
      emit(p, pos, id);
    }
  };

  for (let p = 0; p < bytes.length; p++) {
    if (starts.has(p)) {
      tryChain(p, chainReach(W), true); // boundary start — full reach
    } else {
      const limit = chunkEnd[p] + W;
      tryChain(p, Math.min(limit - p, chainReach(W)), false);
    }
  }

  // ── splits: a form boundary that does not fall on a leaf edge ────────
  const leafEdges = new Set<number>([bytes.length]);
  for (const lf of leaves) leafEdges.add(lf.start);
  for (const s of sites) {
    if (!leafEdges.has(s.start)) splits.add(s.start);
    if (!leafEdges.has(s.end)) splits.add(s.end);
  }

  ctx.trace?.step(
    "recognise",
    [rItem(bytes, "query")],
    sites.map((s) =>
      rItem(bytes.subarray(s.start, s.end), "form", s.payload, [
        s.start,
        s.end,
      ])
    ),
    `decompose the query into ${sites.length} learnt form(s) that lead somewhere` +
      ` (over ${leaves.length} perceived leaves)`,
  );

  return { sites, leaves, splits, starts };
}

/** Segment bytes using the geometry's own groupings — leaf-parent
 *  nodes from the perceived tree, with consecutive bare leaves merged
 *  into one segment.  Each segment's gist is perceived from its bytes
 *  IN ISOLATION, so the same content has the same gist regardless of
 *  where it appears. */
export function segment(ctx: MindContext, bytes: Uint8Array): Segment[] {
  const tree = perceive(ctx, bytes);
  const out: Segment[] = [];
  let pendingStart = -1;
  let pendingEnd = -1;

  const flush = () => {
    if (pendingStart >= 0 && pendingEnd > pendingStart) {
      out.push({
        start: pendingStart,
        end: pendingEnd,
        v: gistOf(ctx, bytes.subarray(pendingStart, pendingEnd)),
      });
    }
    pendingStart = -1;
    pendingEnd = -1;
  };

  const walk = (n: Sema, start: number): number => {
    if (n.kids === null) {
      const end = start + (n.leaf?.length ?? 0);
      if (pendingStart < 0) pendingStart = start;
      pendingEnd = end;
      return end;
    }
    if (isChunk(n)) {
      flush();
      let end = start;
      for (const c of n.kids) end += c.leaf?.length ?? 0;
      out.push({ start, end, v: gistOf(ctx, bytes.subarray(start, end)) });
      return end;
    }
    flush();
    let pos = start;
    for (const c of n.kids) pos = walk(c, pos);
    return pos;
  };
  walk(tree, 0);
  flush();
  return out;
}
