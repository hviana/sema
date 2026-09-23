// corpus.ts — read the trained memory back out of the DAG, AS DATA.
//
// A trained experience pair IS one continuation edge: `src` is the context that
// was deposited, `dst` is what the mind learnt follows it.  Reading them back
// uses the store's own structure and its own indexes — no auxiliary index is
// built, nothing is written, and NOTHING HERE KNOWS ABOUT TEXT: this layer takes
// bytes and returns bytes.  The text case is one helper on the Mind
// (`searchCorpusText`), which encodes, calls this, and decodes.
//
// WHERE EACH STAGE COMES FROM (ported from the demo's `explore.ts`, which
// hand-rolled its own resolution):
//
//   1. PERCEIVE, CONTENT-ADDRESS and ADMIT the query — `recognise()`, the SAME
//      machinery an answer goes through.  It returns the sites: the query spans
//      that content-addressed to a stored node that can lead somewhere.  The
//      demo's own recursive `findLeaf`/`findBranch` walk was a second
//      implementation of exactly this, and it is NOT ported.
//   2. CLIMB the structural `kid` table from each resolved site to the
//      edge-bearing contexts above it (`edgeAncestors`, traverse.ts), weighting
//      each context by how much query content reached it.
//   3. READ the continuation off the edge table (`nextFirst`).
//
// COST is set by how much of the QUERY resolves, never by the size of the
// store: the sites are what recognition already found, the climb is bounded by
// the declared `corpusClimbs`/`corpusContextsPerClimb`, and every store call is
// a point probe or a capped read.  All work is accounted by the store's own
// meter hooks when a response's meter is open — there is no second instrument.
//
// WHAT THIS IS NOT.  Exact content addressing, not fuzzy keyword search: a query
// shares results with a stored note when it shares actual chunk-aligned content
// with it.  An arbitrary mid-word fragment resolves to nothing, and the honest
// answer there is "nothing matched" — which is why `sampleCorpus` exists, and
// why the miss is reported as a STATE rather than as prose (the text helper
// turns it into words).

import { recognise } from "./recognition.js";
import { edgeAncestors } from "./traverse.js";
import type { MindContext } from "./types.js";

/** One stored experience pair, as bytes. */
export interface CorpusPair {
  context: Uint8Array;
  continuation: Uint8Array;
  contextId: number;
  continuationId: number;
  /** Bytes of the query this pair was matched on — 0 when browsing. */
  matchedBytes: number;
  /** True when the stored bytes ran past the declared preview capacity. */
  contextTruncated: boolean;
  continuationTruncated: boolean;
}

/** Why a search produced no pairs.  A STATE, so a caller's own layer can say it
 *  in its own words — the byte layer does not speak. */
export type CorpusMiss = "matched" | "nothing-resolved" | "no-continuations";

export interface CorpusResult {
  pairs: CorpusPair[];
  /** Query subtrees that content-addressed to a real stored node. */
  resolved: number;
  /** Distinct edge-bearing contexts the climb reached. */
  reached: number;
  /** Distinct contexts that carry a learnt continuation, store-wide. */
  totalContexts: number;
  /** True when these are browse samples rather than search results. */
  browsed: boolean;
  miss: CorpusMiss;
}

/** A context node as a pair, or null when it carries no continuation. */
function pairOf(
  ctx: MindContext,
  id: number,
  matchedBytes: number,
): CorpusPair | null {
  const outs = ctx.store.nextFirst(id, 1);
  if (outs.length === 0) return null;
  const cap = ctx.cfg.corpusPreviewBytes;
  const context = ctx.store.bytesPrefix(id, cap + 1);
  const continuation = ctx.store.bytesPrefix(outs[0], cap + 1);
  const contextTruncated = context.length > cap;
  const continuationTruncated = continuation.length > cap;
  return {
    context: contextTruncated ? context.subarray(0, cap) : context,
    continuation: continuationTruncated
      ? continuation.subarray(0, cap)
      : continuation,
    contextId: id,
    continuationId: outs[0],
    matchedBytes,
    contextTruncated,
    continuationTruncated,
  };
}

/** Which stored notes does this query reach?  BYTES in, BYTES out.
 *
 *  Exact content addressing through the machinery that already exists: the
 *  query's recognised sites are the resolved subtrees, the climb goes up from
 *  the biggest first, and a pair is a context that carries a continuation. */
export function searchCorpus(
  ctx: MindContext,
  queryBytes: Uint8Array,
  limit?: number,
): CorpusResult {
  const store = ctx.store;
  const want = Math.max(
    1,
    Math.min(limit ?? ctx.cfg.corpusContextsPerClimb, ctx.cfg.corpusLimitMax),
  );
  // A resolved subtree must account for at least one window (W): a single
  // character resolves against almost any store and means nothing.  W is the
  // mind's own line between chance and evidence — derived, never declared.
  const floor = ctx.space.maxGroup;
  const resolved = recognise(ctx, queryBytes).sites
    .map((s) => ({ id: s.payload, len: store.contentLen(s.payload, 512) }))
    .filter((r) => r.len >= floor);
  // Biggest first, lowest id breaking ties: a clause is evidence, a character is
  // noise, and equal evidence must not be decided by iteration order.
  const byLength = resolved
    .sort((a, b) => b.len - a.len || a.id - b.id)
    .slice(0, ctx.cfg.corpusClimbs);

  // Weight each context by how much query content reached it.
  const weight = new Map<number, number>();
  for (const { id, len } of byLength) {
    for (const root of edgeAncestors(ctx, id, ctx.cfg.corpusContextsPerClimb).roots) {
      weight.set(root, (weight.get(root) ?? 0) + len);
    }
  }

  const pairs: CorpusPair[] = [];
  const ranked = [...weight.entries()].sort(
    (a, b) => b[1] - a[1] || a[0] - b[0],
  );
  for (const [id, w] of ranked) {
    if (pairs.length >= want) break;
    const pair = pairOf(ctx, id, w);
    if (pair) pairs.push(pair);
  }
  return {
    pairs,
    resolved: byLength.length,
    reached: weight.size,
    totalContexts: store.edgeSourceCount(),
    browsed: false,
    miss: pairs.length > 0
      ? "matched"
      : weight.size === 0
      ? "nothing-resolved"
      : "no-continuations",
  };
}

/** Browse real pairs, striding the id space so the sample is spread rather than
 *  one local cluster.  DETERMINISTIC: `from` is the caller's own offset, so
 *  browsing twice with different offsets shows different notes without a random
 *  draw (the demo drew `Math.random()`, which the engine cannot do — same seed,
 *  same order, same query must mean the same answer). */
export function sampleCorpus(
  ctx: MindContext,
  limit?: number,
  from = 0,
): CorpusResult {
  const store = ctx.store;
  const want = Math.max(
    1,
    Math.min(limit ?? ctx.cfg.corpusContextsPerClimb, ctx.cfg.corpusLimitMax),
  );
  const total = store.nodeCount();
  const probes = ctx.cfg.corpusSampleProbes;
  const floorBytes = ctx.cfg.corpusSampleFloorBytes;
  const pairs: CorpusPair[] = [];
  // EACH CONTEXT AT MOST ONCE.  Striding the id space revisits ids when the
  // store is small relative to the probe budget (measured: a 160-node store
  // returned the SAME pair six times for `limit: 6`), and a browse that repeats
  // itself is not a browse.  The demo had the same hole; it is invisible only on
  // a store far larger than the probe budget.
  const seen = new Set<number>();
  for (let i = 0; i < probes && pairs.length < want && total > 0; i++) {
    const slot = (i / probes + from) % 1;
    const id = Math.floor(slot * total);
    if (seen.has(id)) continue;
    if (!store.has(id) || !store.hasNext(id)) continue;
    if (store.contentLen(id, floorBytes) < floorBytes) continue;
    const pair = pairOf(ctx, id, 0);
    if (pair) {
      seen.add(id);
      pairs.push(pair);
    }
  }
  return {
    pairs,
    resolved: 0,
    reached: pairs.length,
    totalContexts: store.edgeSourceCount(),
    browsed: true,
    miss: pairs.length > 0 ? "matched" : "no-continuations",
  };
}
