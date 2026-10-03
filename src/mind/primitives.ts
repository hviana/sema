// primitives.ts — Address + Read primitives (Section 1 of the mind).
//
//   Address  — bytes → node   (perceive, foldTree, resolve)
//   Read     — node → bytes   (read)

import { Vec } from "../vec.js";
import { Sema } from "../sema.js";
import {
  bytesToTree,
  contentFoldIncremental,
  contentIdentity,
  Grid,
  gridToTree,
  hilbertBytes,
  stackGrids,
} from "../geometry.js";
import { canonHash } from "../canon.js";
import { bytesEqual, concatBytes, latin1 } from "../bytes.js";
import { ALL } from "./types.js";
import type { Input, MindContext } from "./types.js";
import type { ContentFold } from "../geometry.js";

// ── Address: bytes → node ──────────────────────────────────────────────

/** The {@link perceive} memo key: the span's content PLUS the boundary set it
 *  was folded under.  The tree is a function of BOTH — the same bytes fold
 *  plainly with no boundaries and into a left-nested stable-prefix shape with
 *  them — so a content-only key returns whichever shape was computed first.
 *  That is exactly what happened: a conversation seeded its cumulative context
 *  under the content key, and every later plain `perceive` of those bytes was
 *  served the boundary tree instead (measured: respondTurn answered where
 *  respond() on byte-identical input did not).  NUL separates the two parts —
 *  the boundary rendering is digits and commas, so no content byte can forge
 *  the split. */
export function perceiveKey(
  bytes: Uint8Array,
  boundaries?: readonly number[],
): string {
  const k = latin1(bytes);
  return boundaries === undefined || boundaries.length === 0
    ? k
    : k + "\u0000" + boundaries.join(",");
}

/** Perceive input into a content-defined tree (the river fold).
 *  Deterministic — identical bytes always produce an identical tree.
 *
 * `boundaries` is an optional sorted list of proper byte offsets where the fold
 * must split so that each prefix segment folds identically to how it folded
 * when it was learned (fold-contract.md stable-prefix contract). Only the
 * CALLER — who assembled the multi-turn context — knows where those boundaries
 * are; the geometry never guesses them from the bytes. */
export function perceive(
  ctx: MindContext,
  input: Input,
  leafAt?: (i: number) => number | null,
  lookup?: (ids: number[]) => number | null,
  boundaries?: readonly number[],
): Sema {
  if (typeof input === "string" || input instanceof Uint8Array) {
    const bytes = typeof input === "string"
      ? new TextEncoder().encode(input)
      : input;
    if (leafAt === undefined && lookup === undefined) {
      // Per-response memo (see MindContext.perceiveMemo): only the plain
      // inference shape — raw bytes, no store capabilities — is memoised,
      // keyed by CONTENT so byte-identical spans in fresh arrays still hit.
      // The tree is shared by reference; Sema nodes are never mutated.
      const memo = ctx.perceiveMemo;
      if (memo) {
        const key = perceiveKey(bytes, boundaries);
        const hit = memo.get(key);
        if (hit !== undefined) {
          if (ctx.meter) ctx.meter.perceiveHits++;
          return hit;
        }
        if (ctx.meter) {
          ctx.meter.perceptions++;
          ctx.meter.perceivedBytes += bytes.length;
        }
        const tree = bytesToTree(
          ctx.space,
          ctx.alphabet,
          bytes,
          undefined,
          undefined,
          boundaries,
        );
        memo.set(key, tree);
        return tree;
      }
      if (ctx.meter) {
        ctx.meter.perceptions++;
        ctx.meter.perceivedBytes += bytes.length;
      }
      return bytesToTree(
        ctx.space,
        ctx.alphabet,
        bytes,
        undefined,
        undefined,
        boundaries,
      );
    }
    return bytesToTree(ctx.space, ctx.alphabet, bytes, leafAt, lookup);
  }
  if (Array.isArray(input)) {
    return gridToTree(ctx.space, ctx.alphabet, stackGrids(input));
  }
  return gridToTree(ctx.space, ctx.alphabet, input as Grid);
}

/** The DEPOSIT-shaped perceive.  Folds over the stream's own content cuts —
 *  bit-identical to what inference computes for the same bytes.  That
 *  train/inference agreement is the whole contract: the trained context node
 *  and the node `resolve(query)` reaches must be the SAME node, and the only
 *  way to guarantee it is to give this function nothing extra to say.  It
 *  imposes no boundaries, knows nothing about turns, and reads no convention
 *  out of the bytes.
 *
 *  An input that EXTENDS a previously deposited one — a conversation context
 *  grown by a turn, or a resumed replay — reuses that deposit's already-folded
 *  content segments ({@link contentFoldIncremental}), so it costs O(new bytes)
 *  instead of O(context).  The reuse is TRANSPARENT by construction: a segment
 *  is a pure function of its own bytes, so a reused one is bit-identical to a
 *  refolded one.  Nothing has to prove that the extending deposit is "really"
 *  a next turn — a coincidental byte prefix reuses the same segments and gets
 *  the same tree it would have got anyway.  (It used to matter: while this
 *  path imposed turn BOUNDARIES, a wrong guess changed the tree, so the cache
 *  needed a continuation-bytes proof to gate it.  Nothing is imposed now, so
 *  there is nothing to gate.) */
export function perceiveDeposit(
  ctx: MindContext,
  bytes: Uint8Array,
  conversational = false,
): Sema {
  // Longest cached PROPER prefix first — the most segments to reuse.
  let prev: ContentFold | undefined;
  const lens = [...ctx._depositLens]
    .filter((L) => L >= 2 && L < bytes.length)
    .sort((a, b) => b - a);
  for (const L of lens) {
    const hit = ctx._depositTrees.get(latin1(bytes.subarray(0, L)));
    if (hit !== undefined) {
      prev = hit.content;
      break;
    }
  }
  const folded = contentFoldIncremental(ctx.space, ctx.alphabet, bytes, prev);
  // Only a CONVERSATIONAL deposit writes the cache: reuse is sound for any
  // deposit, but the budget is 8 entries and a corpus of unrelated facts would
  // evict the live chains for nothing.  Purely a cost decision now, not a
  // correctness one.
  if (conversational && bytes.length >= 2) {
    // The lengths set drifts as the map evicts; past the probe budget the
    // drift itself becomes the cost (each stale length is an O(len) key
    // build), so both reset together — losing only warm-up on live chains.
    if (ctx._depositLens.size > 64) {
      ctx._depositLens.clear();
      ctx._depositTrees.clear();
    }
    ctx._depositTrees.set(latin1(bytes), { content: folded.fold });
    ctx._depositLens.add(bytes.length);
  }
  return folded.tree;
}

/** The raw bytes of an input — modality-neutral conversion. */
export function inputBytes(ctx: MindContext, input: Input): Uint8Array {
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  if (Array.isArray(input)) return hilbertBytes(stackGrids(input));
  return hilbertBytes(input as Grid);
}

/** Convenience: the gist vector of a byte span. */
export function gistOf(ctx: MindContext, bytes: Uint8Array): Vec {
  return perceive(ctx, bytes).v;
}

/** Fold a perceived tree bottom-up against the store's content-addressed maps:
 *  every leaf is named by findLeaf, every branch by findBranch over its kids'
 *  ids (null the moment any child is unknown).  `visit`, when given, sees each
 *  node with its byte span and resolved id.  Returns the node's byte end and
 *  resolved id. */
export function foldTree(
  ctx: MindContext,
  n: Sema,
  start: number,
  visit?: (n: Sema, start: number, end: number, node: number | null) => void,
): { end: number; node: number | null } {
  // Subtree already resolved (from a previous conversation turn or an earlier
  // recognition pass).  The pyramid reuses prefix subtrees as identical Sema
  // objects, so a conversation's prefix is warm from its second turn on.
  // Without a visitor that makes foldTree O(suffix) instead of O(context);
  // with one it stays O(context) and saves the per-node store probes instead
  // (see below for why the distinction is not negotiable).
  //
  // WHAT THE CACHE KNOWS, AND WHAT IT DOES NOT.  An entry records this
  // subtree's id and byte length — nothing about its DESCENDANTS' spans.
  // Returning here therefore emits ONE visit() where a cold walk emits one per
  // node, and `visit` is not instrumentation: recognise() emits its sites from
  // it (recognition.ts) and attention's collectRegions votes over what it
  // yields (attention.ts).  Skipping the descent silently shrinks the evidence
  // those mechanisms see, purely because the cache happened to be warm.
  //
  // That is not hypothetical and not an edge case — it is every conversation
  // turn after the first.  `contentFoldIncremental` deliberately shares prefix
  // segment OBJECTS across turns (~99% reuse), so by turn 2 the prefix is
  // warm; meanwhile recogniseMemo/climbMemo are keyed on exact query BYTES,
  // which a growing context never repeats.  Warm subtrees + missed memos is
  // the unprotected quadrant.  Measured over real trained conversations,
  // recognising the same context with a warm prefix lost 67-92% of its leaves
  // (772->204, 589->47, 872->291, 377->37) with `sites` unchanged, so the loss
  // is invisible to the coarse counts; a direct foldTree probe on identical
  // bytes and an identical tree object fired visit() 661 times cold and 37
  // warm.  respond() is immune only because it never sets _resolvedSubtrees
  // (mind.ts) — the degradation was unique to the multi-turn API.
  //
  // So the fast path is taken only when NOBODY IS WATCHING.  With a visitor
  // present we still walk, and the cache degrades to the thing it soundly is:
  // an elision of the store probes (findLeaf/findBranch) at each node, not an
  // elision of the traversal.  Ids still come from the cache, so a warm walk
  // is cheaper than a cold one; it is no longer *different* from one.
  const cached = ctx._resolvedSubtrees?.get(n);
  if (cached !== undefined && visit === undefined) {
    return { end: start + cached.len, node: cached.id };
  }

  if (n.kids === null) {
    const b = n.leaf ?? new Uint8Array(0);
    const end = start + b.length;
    const node = cached !== undefined ? cached.id : ctx.store.findLeaf(b);
    visit?.(n, start, end, node);
    if (node !== null && ctx._resolvedSubtrees) {
      ctx._resolvedSubtrees.set(n, { id: node, len: b.length });
    }
    return { end, node };
  }
  let pos = start;
  const kids: Array<number | null> = [];
  for (const k of n.kids) {
    const r = foldTree(ctx, k, pos, visit);
    kids.push(r.node);
    pos = r.end;
  }
  // Same store-probe elision as the leaf case: a cached entry already names
  // this subtree, so the descent above was for `visit`'s benefit alone and the
  // id need not be re-derived.  Using it also keeps a warm walk's ids
  // bit-identical to a cold walk's rather than re-deriving them from children
  // that may themselves have come from cache.
  const named = cached !== undefined
    ? { id: cached.id, byBytes: false }
    : branchNaming(ctx, kids, treeBytes(n));
  const node = named.id;
  visit?.(n, start, pos, node);
  if (node !== null && ctx._resolvedSubtrees) {
    ctx._resolvedSubtrees.set(n, { id: node, len: pos - start });
  }
  return { end: pos, node };
}

/** A perceived subtree's bytes, its leaves in order. */
function treeBytes(n: Sema): Uint8Array {
  const parts: Uint8Array[] = [];
  const walk = (x: Sema): void => {
    if (x.kids === null) parts.push(x.leaf ?? new Uint8Array(0));
    else for (const k of x.kids) walk(k);
  };
  walk(n);
  return concatBytes(parts);
}

/** The EXACT content-addressed node of a byte stream — `foldTree(perceive)`,
 *  read for identity alone.
 *
 *  A fold names a branch only when every child is named, so identity needs the
 *  fold's SHAPE and the store's answer per node, never its vectors:
 *  {@link contentIdentity} walks the same shape (geometry.ts — one grouping
 *  rule, two algebras) and asks the store bottom-up, building no D-dimensional
 *  gist and leaving nothing in the perception memo.  Each node is named the
 *  way the store's write side names it ({@link branchNaming}).  `test/148` pins
 *  the agreement with the full fold over random and corpus spans. */
export function exactNode(ctx: MindContext, bytes: Uint8Array): number | null {
  return exactNaming(ctx, bytes).id;
}

/** {@link exactNode}, with whether the span's own name was found only through
 *  its BYTES — its children named no branch, and the flat node over the same
 *  bytes did ({@link branchNaming}).  That is where the exact lookup used to
 *  MISS, so it is where {@link resolve} still asks the canonical class: the
 *  class may hold the learnt member that leads somewhere, which a flat index
 *  entry need not (measured: `tonight` named an edge-less window and
 *  pre-empted the case-folded `Tonight` whose edge a composition stood on).
 *  Recognition's probes reach it through `resolve`; asking it again for the
 *  perceived tree's own byte-named groups changed none of 116 real queries and
 *  no test, so it is not asked there. */
export function exactNaming(
  ctx: MindContext,
  bytes: Uint8Array,
): { id: number | null; byBytes: boolean } {
  if (bytes.length === 0) {
    return { id: foldTree(ctx, perceive(ctx, bytes), 0).node, byBytes: false };
  }
  if (ctx.meter) ctx.meter.identityBytes += bytes.length;
  let byBytes = false;
  const id = contentIdentity(
    ctx.space,
    ctx.alphabet,
    bytes,
    (from, to) =>
      to - from === 1
        ? ctx.store.findLeaf(bytes.subarray(from, to))
        : flatNode(ctx, bytes.subarray(from, to)),
    (kids, from, to) => {
      const named = branchNaming(ctx, kids, bytes.subarray(from, to));
      if (from === 0 && to === bytes.length) byBytes = named.byBytes;
      return named.id;
    },
  );
  return { id, byBytes };
}

/** The flat node over a span's single-byte atoms — the node every deposit
 *  interns for its whole input and for each canonical window (learning.ts
 *  `deposit`, `indexSubSpans`).  The store's negative filter refuses most
 *  misses without a lookup. */
function flatNode(ctx: MindContext, span: Uint8Array): number | null {
  const store = ctx.store;
  return store.findFlatBranch
    ? store.findFlatBranch(span)
    : store.findBranch(Array.from(span, (b) => -(b + 1)));
}

/** THE READ SIDE NAMES A BRANCH EXACTLY AS THE WRITE SIDE DID.  `intern`
 *  (store.ts) names a branch by its children; when they name none, it looks up
 *  the flat node over the same bytes and REUSES it (step 1b, "same bytes, same
 *  node") — so a deposit whose fold grouped `ver` + `!` was stored with the
 *  window `ver!` as that child.  Reading by the children alone could never
 *  name such a deposit again: measured on the 31.7M-node store, 8 of 80 stored
 *  dialogue turns asked verbatim resolved to nothing (a 25-byte turn, a final
 *  `?` or `!`, …) and fell to the composition path.  Same order as the write
 *  side: the children first, the bytes when they name nothing — and an unnamed
 *  child does not settle it, since the write side minted that child and still
 *  reached step 1b. */
function branchNaming(
  ctx: MindContext,
  kids: ReadonlyArray<number | null>,
  span: Uint8Array,
): { id: number | null; byBytes: boolean } {
  if (kids.every((k) => k !== null)) {
    const id = ctx.store.findBranch(kids as number[]);
    if (id !== null) return { id, byBytes: false };
  }
  if (kids.length < 2) return { id: null, byBytes: false };
  const id = flatNode(ctx, span);
  if (id !== null && ctx.meter) ctx.meter.flatBranchNames++;
  return { id, byBytes: id !== null };
}

/** The canonical node id of a byte span: perceive it in isolation — the way
 *  training did — and recover its root bottom-up.  Returns null if any part is
 *  unknown. */
export function resolve(ctx: MindContext, bytes: Uint8Array): number | null {
  if (bytes.length === 0) return null;
  if (ctx.meter) ctx.meter.resolves++;
  const { id: exact, byBytes } = exactNaming(ctx, bytes);
  if (exact !== null && !byBytes) return exact;
  return canonResolve(ctx, bytes) ?? exact;
}

/** Equivalence-class resolution: when the exact content-addressed lookup
 *  misses, find a stored node whose CANONICAL key equals the span's — the
 *  store's canon index proposes candidates by key hash, and each is verified
 *  by re-canonicalizing its bytes (hash-then-verify, like every content
 *  lookup).  Among verified candidates, one that leads somewhere (has a
 *  continuation edge) is preferred; ties break to the lowest id — a corpus
 *  property, not a seed property.  Null when the response carries no
 *  canonicalizer, the store has no canon index, or nothing verifies. */
export function canonResolve(
  ctx: MindContext,
  bytes: Uint8Array,
): number | null {
  const canon = ctx.canon;
  const store = ctx.store;
  if (canon === null || !store.canonFind) return null;
  if (bytes.length < 2) return null;
  const memo = ctx.canonMemo;
  const memoKey = memo ? latin1(bytes) : "";
  if (memo) {
    const hit = memo.get(memoKey);
    if (hit !== undefined) return hit;
  }
  const set = (v: number | null): number | null => {
    memo?.set(memoKey, v);
    return v;
  };
  const key = canon(bytes);
  if (key.length === 0) return set(null);
  // A stored form that IS canonical is not in the index (buildCanonIndex
  // skips identity rows) — the exact content-addressed lookup of the
  // canonical bytes finds it directly.
  if (key.length !== bytes.length || !bytesEqual(key, bytes)) {
    const direct = exactNode(ctx, key);
    if (direct !== null) return set(direct);
  }
  if (ctx.meter) ctx.meter.canonLookups++;
  const candidates = store.canonFind(canonHash(key));
  if (candidates.length === 0) return set(null);
  let best: number | null = null;
  let bestLeads = false;
  for (const id of candidates) {
    const bytesOf = read(ctx, id);
    const stored = canon(bytesOf);
    if (stored.length !== key.length || !bytesEqual(stored, key)) continue;
    // The index stores FLAT content twins; the id the exact path would have
    // resolved for these bytes is their FOLD — the deposit-shaped node that
    // carries the edges and halos.  Re-folding the candidate's bytes lands
    // on exactly the node the canonical-case query would have found.
    const folded = exactNode(ctx, bytesOf);
    const use = folded ?? id;
    // THE ADMISSION PREDICATE, asked of the store that owns it (edge or halo,
    // the halo tier carrying the mass bar).  Asking `haloMass(use) > 0` instead
    // would agree only while `minHaloMass <= 1`.
    const leads = store.leadsSomewhere(use);
    if (
      best === null || (leads && !bestLeads) ||
      (leads === bestLeads && use < best)
    ) {
      best = use;
      bestLeads = leads;
    }
  }
  return set(best);
}

/** Walk a perceived tree in POST-ORDER with byte offsets — children before
 *  their parent, `visit(node, start, end)` for every node including leaves.
 *  Returns the byte end.  The one shared traversal the offset-carrying tree
 *  readers (recognition via foldTree's richer variant, attention's region
 *  collection, resonance's branch counting) build on, so each does not
 *  re-derive the offset bookkeeping.  (recognition.segment keeps its own
 *  walk: its flush semantics need PRE-order decisions at leaf-parents, which
 *  a post-order visitor cannot express.) */
export function walkTree(
  n: Sema,
  start: number,
  visit: (node: Sema, start: number, end: number) => void,
): number {
  if (n.kids === null) {
    const end = start + (n.leaf?.length ?? 0);
    visit(n, start, end);
    return end;
  }
  let pos = start;
  for (const k of n.kids) pos = walkTree(k, pos, visit);
  visit(n, start, pos);
  return pos;
}

// ── Read: node → bytes ──────────────────────────────────────────────────

/** Reconstruct a node's byte content from the DAG, up to `maxLen` bytes. */
export function read(
  ctx: MindContext,
  id: number,
  maxLen: number = ALL,
): Uint8Array {
  return ctx.store.bytesPrefix(id, maxLen);
}
