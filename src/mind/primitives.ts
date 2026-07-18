// primitives.ts — Address + Read primitives (Section 1 of the mind).
//
//   Address  — bytes → node   (perceive, foldTree, resolve)
//   Read     — node → bytes   (read)

import { Vec } from "../vec.js";
import { Sema } from "../sema.js";
import {
  bytesToTree,
  bytesToTreePyramid,
  Grid,
  gridToTree,
  hilbertBytes,
  stablePrefixFoldIncremental,
  stackGrids,
} from "../geometry.js";
import { canonHash } from "../canon.js";
import { bytesEqual } from "../bytes.js";
import { ALL } from "./types.js";
import type { DepositCacheEntry, Input, MindContext } from "./types.js";

// ── Address: bytes → node ──────────────────────────────────────────────

/** The content key of a byte span — one latin1 char per byte, an exact,
 *  collision-free encoding.  Spans on the perception path are query-scale
 *  (windows, regions, candidate spans), so key construction is far cheaper
 *  than the river fold it deduplicates. */
export function latin1Key(bytes: Uint8Array): string {
  // Batched String.fromCharCode — avoids the O(n²) cost of repeated += on
  // potentially-large query spans, and stays well under the ~65536 arg limit.
  const n = bytes.length;
  let s = "";
  for (let i = 0; i < n; i += 4096) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 4096, n)));
  }
  return s;
}

/** Perceive input into a content-defined tree (the river fold).
 *  Deterministic — identical bytes always produce an identical tree.
 *
 *  `boundaries` is an optional sorted list of proper byte offsets where the
 *  fold must split so that each prefix segment folds identically to how it
 *  folded when it was learned (§10.3 stable-prefix contract).  Only the
 *  CALLER — who assembled the multi-turn context — knows where those
 *  boundaries are; the geometry never guesses them from the bytes. */
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
        const key = latin1Key(bytes);
        const hit = memo.get(key);
        if (hit !== undefined) return hit;
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

/** The DEPOSIT-shaped perceive.  A FIRST-SEEN input takes the PLAIN fold
 *  (bit-identical to inference perception of a standalone query — that
 *  structural train/inference agreement is load-bearing for exact recall),
 *  computed incrementally via the fold's level pyramid
 *  ({@link bytesToTreePyramid}).  An input that EXTENDS a previously
 *  deposited one is a conversation context grown by one turn — the cached
 *  prefix length IS the turn boundary (derived from the deposit sequence
 *  itself, never from content conventions) — and takes the STABLE-PREFIX
 *  fold over the accumulated boundaries, bit-identical to the boundary
 *  fold query-time conversation perception uses, so the trained context
 *  node and the query's context subtree are the SAME node.  Segment folds
 *  reuse across deposits ({@link stablePrefixFoldIncremental}) — O(turn)
 *  instead of O(context) per turn.  The fold state is purely a cache; the
 *  boundary accumulation is what an evicted chain loses (falling back to
 *  the plain fold, the pre-boundary shape — a warm replay restores it). */
export function perceiveDeposit(
  ctx: MindContext,
  bytes: Uint8Array,
  conversational = false,
): Sema {
  let prev: DepositCacheEntry | undefined;
  let prefixLen = 0;
  // Cache consult (both boundary lookup and stable-prefix reuse) is scoped
  // to conversational deposits only — a bare, unrelated fact whose bytes
  // happen to extend an earlier deposit is NOT a conversation turn, and
  // must keep the plain fold so it shares structure with ITS OWN prior
  // deposits, not fragment against a coincidental byte-prefix.
  if (conversational) {
    // Longest cached PROPER prefix first.
    const lens = [...ctx._depositLens]
      .filter((L) => L >= 2 && L < bytes.length)
      .sort((a, b) => b - a);
    for (const L of lens) {
      const hit = ctx._depositTrees.get(latin1Key(bytes.subarray(0, L)));
      // The suffix must bytes-equal the hit's OWN recorded continuation —
      // proof this deposit is that turn's actual next turn, not a fact
      // that coincidentally shares its byte prefix.
      if (
        hit !== undefined && hit.nextBytes !== undefined &&
        bytesEqual(hit.nextBytes, bytes.subarray(L))
      ) {
        prev = hit;
        prefixLen = L;
        break;
      }
    }
  }
  let tree: Sema;
  let entry: DepositCacheEntry;
  if (prev !== undefined) {
    const boundaries = [...prev.boundaries, prefixLen];
    const folded = stablePrefixFoldIncremental(
      ctx.space,
      ctx.alphabet,
      bytes,
      boundaries,
      prev.stable,
    );
    tree = folded.tree;
    entry = { boundaries, stable: folded.fold };
  } else {
    const plain = bytesToTreePyramid(ctx.space, ctx.alphabet, bytes);
    tree = plain.tree;
    entry = { boundaries: [], pyramid: plain.pyramid };
  }
  // Only a conversational deposit writes the cache too — otherwise a bare
  // fact's plain fold could later be misread as a conversation's turn-zero
  // boundary by an unrelated conversational deposit that happens to extend
  // its bytes.
  if (conversational && bytes.length >= 2) {
    // The lengths set drifts as the map evicts; past the probe budget the
    // drift itself becomes the cost (each stale length is an O(len) key
    // build), so both reset together — losing only warm-up on live chains.
    if (ctx._depositLens.size > 64) {
      ctx._depositLens.clear();
      ctx._depositTrees.clear();
    }
    ctx._depositTrees.set(latin1Key(bytes), entry);
    ctx._depositLens.add(bytes.length);
  }
  return tree;
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
  // Fast path: subtree already resolved (from a previous conversation turn
  // or an earlier recognition pass).  The pyramid reuses prefix subtrees as
  // identical Sema objects, so this cache turns foldTree into O(suffix)
  // instead of O(context) for multi-turn recognition.
  const cached = ctx._resolvedSubtrees?.get(n);
  if (cached !== undefined) {
    const end = start + cached.len;
    visit?.(n, start, end, cached.id);
    return { end, node: cached.id };
  }

  if (n.kids === null) {
    const b = n.leaf ?? new Uint8Array(0);
    const end = start + b.length;
    const node = ctx.store.findLeaf(b);
    visit?.(n, start, end, node);
    if (node !== null && ctx._resolvedSubtrees) {
      ctx._resolvedSubtrees.set(n, { id: node, len: b.length });
    }
    return { end, node };
  }
  let pos = start;
  let known = true;
  const kids: number[] = [];
  for (const k of n.kids) {
    const r = foldTree(ctx, k, pos, visit);
    if (r.node === null) known = false;
    else if (known) kids.push(r.node);
    pos = r.end;
  }
  const node = known ? ctx.store.findBranch(kids) : null;
  visit?.(n, start, pos, node);
  if (node !== null && ctx._resolvedSubtrees) {
    ctx._resolvedSubtrees.set(n, { id: node, len: pos - start });
  }
  return { end: pos, node };
}

/** The canonical node id of a byte span: perceive it in isolation — the way
 *  training did — and recover its root bottom-up.  Returns null if any part is
 *  unknown. */
export function resolve(ctx: MindContext, bytes: Uint8Array): number | null {
  if (bytes.length === 0) return null;
  const exact = foldTree(ctx, perceive(ctx, bytes), 0).node;
  if (exact !== null) return exact;
  return canonResolve(ctx, bytes);
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
  const memoKey = memo ? latin1Key(bytes) : "";
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
    const direct = foldTree(ctx, perceive(ctx, key), 0).node;
    if (direct !== null) return set(direct);
  }
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
    const folded = foldTree(ctx, perceive(ctx, bytesOf), 0).node;
    const use = folded ?? id;
    const leads = store.hasNext(use) || store.haloMass(use) > 0;
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
