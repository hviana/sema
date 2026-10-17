// recognition.ts — Address + Read over byte streams — decompose a query into its known forms.
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
  perceive,
  resolve,
} from "./primitives.js";
import {
  bearsEdge,
  corpusN,
  edgeAncestors,
  heldWithin,
  leadsSomewhere,
  offsetCanon,
  windowRarity,
} from "./traverse.js";
import { atomIsHub, boundFor } from "../geometry.js";
import { chainReach, flatId, windowIds } from "./canonical.js";
import { bytesEqual, indexOf, latin1 } from "../bytes.js";
import { isChunk, type Sema } from "../sema.js";
import type { Leaf, Site } from "./graph-search.js";

/** Decompose a byte stream into every stored form that leads somewhere
 *  (has a continuation edge or a halo).  Three readings of ONE question —
 *  "which spans of these bytes are stored forms?":
 *
 *   • structural — the query's own perceived tree, each subtree named as the
 *     write side named it (and, where that misses, by its canonical class);
 *   • the exact sweep — every span within one reach of every start, and the
 *     stream's edges beyond it, probed by its flat twin (one hash extended a
 *     byte at a time) and resolved where it hits.  Every form that leads
 *     somewhere HAS a flat twin, so this names a stored form at whatever
 *     offset it sits — no fold cut needs to fall on its borders;
 *   • the canonical sweep — the same sweep over the stream's canonical bytes,
 *     against the canon index.
 *
 *  Probes are content-addressed and filtered (bloom) — never a scan of the
 *  corpus.  This replaced ten tiers (edge trims at three reaches, chunk
 *  sub-runs, chains at two reaches, budgeted edge and interior probes, cut
 *  suffixes): each was a special case of the sweep, measured identical on
 *  every compositional and inference question of three fixtures, with CPU
 *  unchanged.
 *
 *  ONE READING PER BYTE STREAM, deliberately: a per-caller variant would key
 *  the memo by the variant and break "computed at most once" (memoization.md):
 *  the pipeline recognises a grounded answer for `preConsumed`, and the pivot
 *  then recognises the same bytes again. */
export function recognise(
  ctx: MindContext,
  bytes: Uint8Array,
): Recognition {
  // Content-keyed memo — works for both single-turn respond() and multi-turn
  // respondTurn() (where the map persists across calls).  ALWAYS consulted,
  // regardless of tracing — matching perceive()'s own memo, which carries no
  // trace gate at all.
  //
  // This memo is an accelerator, and that is now the whole of it: repeated
  // recognition of the same query is ordinary within one response (cover,
  // reason and articulate all recognise it) and recogniseImpl is O(n ·
  // maxGroup) probes each time.
  //
  // IT USED TO BE LOAD-BEARING FOR CORRECTNESS, and the history is worth
  // keeping because it explains why there is no trace gate here.  foldTree's
  // subtree-resolution fast path (primitives.ts) once returned on a cache hit
  // WITHOUT recursing, so it skipped invoking `visit` — and therefore skipped
  // EMITTING SITES — for any subtree already in ctx._resolvedSubtrees.  A
  // conversation's incremental fold deliberately shares node OBJECTS across
  // turns, so by the second call on the same bytes large swaths of the tree
  // were already cached and recogniseImpl silently found FEWER sites than the
  // first call (observed live: 31 → 5).  Skipping this memo "only while
  // tracing" therefore meant every traced turn re-ran recogniseImpl at each of
  // those call sites, each result more incomplete than the last — changing
  // which mechanism grounded the answer, not merely costing time.
  //
  // foldTree no longer does that: it takes the fast path only when no `visit`
  // is supplied, so a walk that emits sites always walks in full and the id
  // cache is reduced to eliding store probes (see primitives.ts).  recognise()
  // is idempotent on its own now — verified with the memo bypassed, the
  // subtree cache warm and the tree object shared: three consecutive calls on
  // the same 544-byte context returned sites=2 leaves=544 splits=0 starts=88,
  // identical every time.
  //
  // The unconditional consult STAYS regardless.  A memo whose absence can only
  // cost time is still not something to gate on whether an audit happens to be
  // attached: tracing must not change what the pipeline computes, and the
  // cheapest way to guarantee that is for the trace flag to touch nothing but
  // the trace.  The trace step must still fire on every call (a cache hit is
  // not silent), so it is emitted here directly rather than only inside
  // recogniseImpl.
  if (ctx.recogniseMemo) {
    const key = latin1(bytes);
    const hit = ctx.recogniseMemo.get(key);
    if (hit !== undefined) {
      if (ctx.meter) ctx.meter.recogniseHits++;
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
  if (ctx.meter) {
    ctx.meter.recognitions++;
    ctx.meter.recognisedBytes += bytes.length;
  }
  const store = ctx.store;
  const sites: Site[] = [];
  const leaves: Leaf[] = [];
  const splits = new Set<number>();
  const starts = new Set<number>();
  // The same cuts in ASCENDING order.  The post-order walk below visits
  // leaf-parents left to right, so appending as they are added keeps this
  // sorted with no comparison — which is what lets the composite search find
  // its candidates by binary search instead of rescanning the whole set.
  const startList: number[] = [];
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
  const atomsAreHubs = atomIsHub(corpusN(ctx), ctx.space.maxGroup);
  // The structural and sweep readings can legitimately re-derive the SAME
  // (start, end, id) site.  Duplicate site entries are not wrong evidence,
  // but they double the weight cover's derivation search gives that span,
  // distorting its cost model — the same span must count once.
  const seen = new Set<string>();
  // The question itself is never a fragment of something longer: a span
  // covering the WHOLE question is exempt from both scale gates below.
  const whole = (start: number, end: number) =>
    start === 0 && end === bytes.length;
  const emit = (start: number, end: number, id: number) => {
    if (id < 0 && atomsAreHubs && !whole(start, end)) return;
    // A SITE MUST SPAN ONE RIVER WINDOW.  Below W, byte overlap is chance,
    // not evidence — the principle identityBar already states ("below one
    // river window, byte overlap is chance") and the bridge's attestedQ
    // already applies ("spans shorter than W carry no window of their own").
    // No new constant.
    //
    // This REPLACES the false premise it used to share with fuse() and
    // tryChain: those gates asked "does this offset sit on a fold boundary?"
    // and read the answer from `starts`, which is exactly {0, W, 2W, …}
    // because riverFold groups fixed-arity — arithmetic, not evidence.
    //
    // Measured on the 17.9M-node store, over the sites of 7 probes (1 good, 11
    // junk by hand-labelling, corrected for whole-query forms): len >= W
    // rejects "hi"(2) "of"(2) "is"(2) "di"(2) "the"(3), admits "Eiffel
    // Tower"(12) and both whole-query forms len >= W-1 admits "the" — W-1 is
    // the write side's straddle neighbour for RETRIEVAL, never a claim about
    // units commonality.md saturation admits 11/11 junk: edgeAncestors on a
    // site node reaches 1..48 contexts, so dominates(ctx, N) needs ctx > 162805
    // and never fires; every site reads DISC rarity does not separate: "hi" has
    // 1 container, "the" 572
    //
    // A span covering the WHOLE query is exempt: then it is not a fragment of
    // something longer, it is the question ("hi" asked on its own).
    if (
      atomsAreHubs && end - start < ctx.space.maxGroup && !whole(start, end)
    ) return;
    const key = start + "," + end + "," + id;
    if (seen.has(key)) return;
    seen.add(key);
    if (leadsSomewhere(ctx, id)) {
      sites.push({ start, end, payload: id });
    }
  };

  // ── structural: the query's own perceived tree ──────────────────────
  starts.add(0);
  startList.push(0);
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
    }
    if (isChunk(n)) {
      starts.add(start);
      if (startList[startList.length - 1] !== start) startList.push(start);
    }
  });

  // ── THE ONE EXACT SWEEP ──────────────────────────────────────────────
  // Every form that leads somewhere has a FLAT twin (a deposit is interned
  // whole and flat; a suffix inherits an edge only where its flat twin
  // exists), and with implicit byte leaves the flat probe is exact at any
  // offset.  So "which spans of the question are stored forms?" is one
  // sweep: every span within one reach of every start, the hash extended a
  // byte at a time (Store.flatSpans), each hit resolved; and the whole
  // question's edges beyond the reach.  Where the exact probe misses, the
  // canonical sweep proposes.
  const W = ctx.space.maxGroup;
  const flatAt = store.flatSpans?.(bytes) ??
    ((start: number, end: number) => flatId(ctx, bytes.subarray(start, end)));
  const n = bytes.length;
  const reach = sweepReach(ctx);
  // Spans the exact probe did not name — what the canonical sweep asks.
  const missed = new Set<number>();
  const exact = (p: number, e: number, chained: boolean): boolean => {
    if (ctx.meter) ctx.meter.recogniseSpans++;
    const flat = flatAt(p, e);
    if (flat === null) {
      missed.add(p * (n + 1) + e);
      return false;
    }
    // At the scale where atoms are hubs, a stored run starting off the fold's
    // own cuts is read only when it can lead somewhere: it bears an edge
    // itself, or it is a whole deposit's flat twin — a flat node no larger
    // form holds (a window or a chunk always is held).  Existence probes,
    // paid before the fold `resolve` would cost.
    if (
      chained && atomsAreHubs && !starts.has(p) && !bearsEdge(ctx, flat) &&
      heldWithin(ctx, flat)
    ) return false;
    const id = resolveSpan(p, e);
    if (id === null) {
      if (ctx.meter) ctx.meter.bloomFalsePositives++;
      missed.add(p * (n + 1) + e);
      return false;
    }
    emit(p, e, id);
    return true;
  };
  for (let p = 0; p < n; p++) {
    emit(p, p + 1, -(bytes[p] + 1));
    const last = Math.min(n, p + reach);
    for (let e = p + 2; e <= last; e++) exact(p, e, true);
  }
  // The question's own edges beyond the reach: a whole trained form at
  // either end, however long — and, at the end, one byte short of it (a
  // closing separator belongs between forms).
  for (let e = reach + 1; e <= n; e++) exact(0, e, false);
  for (let s0 = n - reach - 1; s0 > 0; s0--) {
    if (!exact(s0, n, false)) exact(s0, n - 1, false);
  }
  // THE CANONICAL SWEEP — the same sweep over the question's canonical
  // bytes.  Where the canonicalizer keeps every offset (case, width), the
  // canonical key of a span IS that span of the canonical question, so its
  // index hash extends a byte at a time exactly as the exact one does, and
  // the canon index's negative filter answers most spans with no I/O.  A hit
  // only proposes: `resolve` re-canonicalizes and verifies.
  // The edges beyond the reach are asked as the exact sweep asks them: the
  // whole prefix, and every suffix that starts on a cut the fold drew.
  const canon = ctx.canon;
  const canonFind = store.canonFind?.bind(store);
  if (canon !== null && canonFind !== undefined) {
    const qc = canon(bytes);
    if (qc.length === n) {
      const ask = (p: number, e: number, h: number): void => {
        if (e - p < 2 || !missed.has(p * (n + 1) + e)) return;
        if (ctx.meter) ctx.meter.recogniseCanonSpans++;
        if (canonFind(h).length === 0) return;
        const id = resolveSpan(p, e);
        if (id !== null) emit(p, e, id);
        else if (ctx.meter) ctx.meter.canonProbesDenied++;
      };
      for (let p = 0; p < n; p++) {
        let h = 0x811c9dc5 >>> 0;
        const last = p === 0 ? n : Math.min(n, p + reach);
        for (let e = p + 1; e <= last; e++) {
          h = Math.imul(h ^ qc[e - 1], 0x01000193) >>> 0;
          ask(p, e, h);
        }
      }
      for (const s0 of startList) {
        if (s0 === 0 || n - s0 <= reach) continue;
        let h = 0x811c9dc5 >>> 0;
        for (let e = s0 + 1; e <= n; e++) {
          h = Math.imul(h ^ qc[e - 1], 0x01000193) >>> 0;
          if (e >= n - 1) ask(s0, e, h);
        }
      }
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

/** THE THINGS a span of bytes holds — the one entity reader of the walk's
 *  pivot (`pivotInto`) and the engine's derive-through (`entityProposals`):
 *  every stored form recognition reads in the bytes, and in their canonical
 *  spelling, that a deposit learnt WHOLE and that leads on.  The canonical
 *  spelling is the canonical class read WITHOUT an index — a deposit spelled
 *  `gustaf molander` is found in `Gustaf Molander` — at the cost of one more
 *  memoised recognition (a `canonResolve` scan of every span found the same
 *  forms at O(L²) probes).  Each thing with its span in the bytes and whether
 *  the canonical spelling held it; first occurrence per node, exact spelling
 *  first, in recognition's order. */
/** How far recognition's exact sweep reaches from every start: `W⁴ + 2r`.
 *  A stored form longer than this is read only at the stream's edges. */
export function sweepReach(ctx: MindContext): number {
  const W = ctx.space.maxGroup;
  return chainReach(W) * W * W + 2 * ctx.space.seats.length;
}

export function thingsIn(
  ctx: MindContext,
  bytes: Uint8Array,
): Array<{ id: number; span: [number, number]; canonical: boolean }> {
  const out: Array<{ id: number; span: [number, number]; canonical: boolean }> =
    [];
  const seen = new Set<number>();
  const take = (b: Uint8Array, canonical: boolean): void => {
    for (const s of recognise(ctx, b).sites) {
      if (s.payload < 0 || seen.has(s.payload)) continue;
      if (!ctx.store.hasNext(s.payload) || !ctx.store.learntWhole(s.payload)) {
        continue;
      }
      seen.add(s.payload);
      out.push({ id: s.payload, span: [s.start, s.end], canonical });
    }
  };
  take(bytes, false);
  const c = offsetCanon(ctx, bytes);
  if (!bytesEqual(c, bytes)) take(c, true);
  // A THING LONGER THAN THE SWEEP'S REACH, inside the bytes: recognition reads
  // such a form only at the stream's edges, so one held in the interior (a
  // deposited paragraph quoted mid-answer) is found by structure instead.
  // Every stretch of half the reach lies whole inside such a thing, so its
  // rarest stored window is the thing's own; the contexts that window climbs
  // to are proposed, and the bytes decide (the answer holds the thing).
  const reach = sweepReach(ctx);
  const n = bytes.length;
  if (n > reach) {
    const W = ctx.space.maxGroup;
    const half = Math.ceil(reach / 2);
    const windows = windowIds(ctx, bytes);
    const N = corpusN(ctx);
    const cap = boundFor(N) + 1;
    for (let p = 0; p + half <= n; p += half) {
      let best: number | null = null, rarest = Infinity;
      for (let o = p; o + W <= p + half; o++) {
        const id = windows.get(o);
        if (id === undefined) continue;
        const r = windowRarity(ctx, id, cap);
        if (r > 0 && r < rarest) [best, rarest] = [id, r];
      }
      if (best === null) continue;
      const climb = edgeAncestors(ctx, best, N, undefined, true);
      if (climb.saturated) continue;
      for (const root of climb.roots) {
        if (seen.has(root)) continue;
        const len = ctx.store.contentLen(root, n + 1);
        if (len <= reach || len > n || !ctx.store.learntWhole(root)) continue;
        const at = indexOf(bytes, ctx.store.bytes(root), 0);
        if (at < 0) continue;
        seen.add(root);
        out.push({ id: root, span: [at, at + len], canonical: false });
      }
    }
  }
  return out;
}
