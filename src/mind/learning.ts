// learning.ts — ingest and deposition (Section 7 of the mind).
//
//   Learning is DEPOSITION: perceive a stream into a tree and intern every
//   node.  A fact is an EDGE between node ids; recall traverses edges.

import { Vec } from "../vec.js";
import { bindSeat, companySignature, isChunk, Sema } from "../sema.js";
import type { Input, MindContext } from "./types.js";
import { changedNodes } from "./types.js";
import {
  inputBytes,
  latin1Key,
  perceive,
  perceiveDeposit,
  resolve,
} from "./primitives.js";
import { canonicalWindows, leafIdPrefix } from "./canonical.js";
import { fold as foldVecs } from "../sema.js";

/** Intern a perceived tree into node ids, bottom-up, sharing equal subtrees.
 *  Returns the root node id and a map from tree nodes to their ids.
 *
 *  Memoized by NODE IDENTITY (ctx._internIds): the pyramid fold shares a
 *  prefix's subtree OBJECTS across an accumulated context's deposits, and a
 *  node already interned needs nothing again — its id is permanent
 *  (content-addressed) and its intern-time side effects (gist capture, kid
 *  rows) fired at first mint; re-interning was pure lookups.  A memo hit
 *  therefore skips the WHOLE shared subtree, making the intern walk
 *  O(new nodes) per deposit instead of O(context).  Only the hit node
 *  itself enters `ids`; descendants stay reachable via the memo (see
 *  idOf in indexSubSpans and the changedNodes prune). */
export async function internTreeIds(
  ctx: MindContext,
  node: Sema,
  ids: Map<Sema, number>,
): Promise<number> {
  const known = ctx._internIds.get(node);
  if (known !== undefined) {
    ids.set(node, known);
    return known;
  }
  let id: number;
  if (node.kids === null) {
    id = await ctx.store.putLeaf(node.leaf ?? new Uint8Array(0), node.v);
  } else {
    const kds: number[] = [];
    for (const k of node.kids) kds.push(await internTreeIds(ctx, k, ids));
    id = await ctx.store.putBranch(kds, node.v);
  }
  ids.set(node, id);
  ctx._internIds.set(node, id);
  return id;
}

/** Index flat branches for sub-spans of a deposit's byte stream, linked to
 *  their structural chunks via durable CONTAINMENT edges. */
export async function indexSubSpans(
  ctx: MindContext,
  tree: Sema,
  ids: Map<Sema, number>,
): Promise<boolean> {
  const chunkOf: Array<number | undefined> = [];
  const streamIds: number[] = [];
  const streamVecs: Vec[] = [];
  const collect = (n: Sema): boolean => {
    if (isChunk(n)) {
      // A chunk inside a memo-skipped shared subtree is absent from `ids`;
      // the intern memo still knows it (same object).  A miss on both (the
      // WeakMap entry was collected) only forfeits the seenBefore skip.
      const chunkId = ids.get(n) ?? ctx._internIds.get(n);
      for (const k of n.kids) {
        const lid = k.leaf ? ctx.store.findLeaf(k.leaf) : null;
        if (lid === null) return false;
        streamIds.push(lid);
        streamVecs.push(k.v);
        chunkOf.push(chunkId);
      }
      return true;
    }
    if (n.kids) {
      for (const k of n.kids) if (!collect(k)) return false;
    }
    return true;
  };
  if (!collect(tree)) return false;

  const W = ctx.space.maxGroup; // write side of the canonical contract
  const prev = ctx._prevSeen;
  const seenBefore = (off: number, len: number): boolean => {
    if (!prev) return false;
    for (let i = off; i < off + len; i++) {
      const c = chunkOf[i];
      if (c === undefined || !prev.has(c)) return false;
    }
    return true;
  };
  const lens = streamIds.length >= W ? canonicalWindows(W) : [streamIds.length];
  for (const len of lens) {
    if (len < 1) continue;
    for (let off = 0; off + len <= streamIds.length; off++) {
      if (seenBefore(off, len)) continue;
      const winIds = streamIds.slice(off, off + len);
      const flatId = ctx.store.findBranch(winIds) ??
        await ctx.store.putBranch(
          winIds,
          foldVecs(ctx.space, streamVecs.slice(off, off + len)),
        );
      for (let i = off; i < off + len; i++) {
        const c = chunkOf[i];
        if (c !== undefined) ctx.store.addContainer(flatId, c);
      }
    }
  }
  return true;
}

/** Perceive, intern, and index a single input.  Returns the perceived tree,
 *  root id, id map, and the changed (new) subtrees for halo reinforcement. */
export async function deposit(
  ctx: MindContext,
  input: Input,
  track: boolean,
  conversational = false,
): Promise<
  { tree: Sema; rootId: number; ids: Map<Sema, number>; changed: Sema[] }
> {
  const bytes = inputBytes(ctx, input);
  // Deposit-shaped perception: stable-prefix tree SEEDING (see
  // perceiveDeposit) — an accumulated context re-folds only its new suffix,
  // O(turn) instead of O(context) per conversation turn.  Cache-only here
  // (no store-probe fallback): a knownPrefixLength scan on every novel fact
  // would cost O(n²) hashing, while conversation replays are always warm —
  // re-deposition replays from the first turn, rebuilding the cache as it
  // goes.  `conversational` scopes the STABLE-PREFIX variant (turn-boundary
  // folding, matching query-time perception) to ingestPair's own growing
  // context argument — a bare ingestOne deposit whose bytes merely happen
  // to extend an earlier UNRELATED deposit (no conversational relationship)
  // must keep the plain fold, or two coincidentally-prefix-sharing facts
  // would stop sharing structure with each other.
  const tree = perceiveDeposit(ctx, bytes, conversational);

  const ids = new Map<Sema, number>();
  const rootId = await internTreeIds(ctx, tree, ids);

  const indexed = await indexSubSpans(ctx, tree, ids);

  const leafIds = leafIdPrefix(ctx, bytes);
  if (leafIds.length === bytes.length && leafIds.length >= 2) {
    await ctx.store.putBranch(leafIds, tree.v);
  }

  const changed = (track && ctx._prevSeen)
    ? changedNodes(tree, ids, ctx._prevSeen)
    : [tree];
  if (track) ctx._prevSeen = indexed ? new Set(ids.values()) : null;
  return { tree, rootId, ids, changed };
}

/** Ingest a single input (a bare experience, no continuation). */
export async function ingestOne(
  ctx: MindContext,
  input: Input,
): Promise<Sema & { id: number }> {
  const { tree, rootId, ids } = await deposit(ctx, input, true);
  ctx.store.indexTarget(rootId);
  const parts: number[] = tree.kids
    ? tree.kids.map((k) => ids.get(k)!)
    : [rootId];
  const stride = ctx.space.maxGroup;
  if (parts.length > stride) {
    for (let i = 0; i + stride < parts.length; i += stride) {
      await ctx.store.link(parts[i], parts[i + stride]);
    }
    if ((parts.length - 1) % stride !== 0) {
      const lastStart = Math.floor((parts.length - 1) / stride) * stride;
      if (lastStart < parts.length - 1) {
        await ctx.store.link(parts[lastStart], parts[parts.length - 1]);
      }
    }
  } else {
    for (const id of parts) ctx.store.indexTarget(id);
  }
  return Object.assign(tree, { id: rootId });
}

/** For each right-edge suffix of the context bytes, resolve it against the
 *  store.  A suffix whose resolved node is already a known form inherits the
 *  continuation edge.  Gate: ≥ 2 structural parents (reused across deposits),
 *  or (halo > 0 ∧ already an edge source).  Pure answers do not qualify. */
async function propagateSuffixes(
  ctx: MindContext,
  src: number,
  dst: number,
): Promise<void> {
  const W = ctx.space.maxGroup;
  const bytes = ctx.store.bytes(src);
  const n = bytes.length;
  if (n < 2 * W) return;
  // Existence prefilter — the write side of the canonical contract: every
  // deposit interns its WHOLE byte stream as a flat branch of per-byte leaf
  // ids (deposit(), canonical.ts).  A suffix is a stored form exactly when
  // that flat twin exists, so one content-hash probe per offset decides;
  // only a hit pays for resolve()'s deposit-shaped perception.  This keeps
  // the scan free of river folds — O(1) probes over cheap byte hashes
  // instead of O(suffix) vector folds per offset.
  const leafIds = leafIdPrefix(ctx, bytes);
  for (let i = 1; i <= n - W; i++) {
    if (ctx.store.findBranch(leafIds.slice(i)) === null) continue;
    const id = resolve(ctx, bytes.subarray(i));
    if (id === null || id === src) continue;
    const known = ctx.store.parentsFirst(id, 2).length >= 2 ||
      (ctx.store.haloMass(id) > 0 && ctx.store.hasNext(id));
    if (!known) continue;
    await ctx.store.link(id, dst);
  }
}

/** Ingest a pair (context, continuation) — learn an edge and pour halos. */
export async function ingestPair(
  ctx: MindContext,
  ctxInput: Input,
  cont: Input,
): Promise<void> {
  const c = await deposit(ctx, ctxInput, true, true);
  const cont_ = await deposit(ctx, cont, false);
  const ctxId = c.rootId, contId = cont_.rootId;

  // Stamp this turn's continuation onto its own cache entry — the proof a
  // FUTURE, longer ctxInput needs (see perceiveDeposit) to recognise itself
  // as this conversation's genuine next turn rather than an unrelated fact
  // that happens to share this ctxInput's byte prefix.
  {
    const ctxBytes = inputBytes(ctx, ctxInput);
    const entry = ctx._depositTrees.get(latin1Key(ctxBytes));
    if (entry !== undefined) entry.nextBytes = inputBytes(ctx, cont);
  }

  await ctx.store.link(ctxId, contId);
  await propagateSuffixes(ctx, ctxId, contId);

  // Halos pour company SIGNATURES (identity), not gists (content) — see
  // companySignature in sema.ts.
  const contSeat = bindSeat(ctx.space, companySignature(ctx.space, contId), 1);
  for (const part of c.changed) {
    const partId = c.ids.get(part)!;
    await ctx.store.pourHalo(partId, contSeat);
    await ctx.store.pourHalo(
      contId,
      bindSeat(ctx.space, companySignature(ctx.space, partId), 0),
    );
  }
}

/** Dispatch the public ingest input shapes onto one-input / pair handlers —
 *  THE one reading of ingest's polymorphic surface (scalar, (context,
 *  continuation) pair, or a list mixing bare inputs and pairs).  Both ingest
 *  paths — the direct one below and {@link CachedIngest} — route through
 *  this, so the shape-detection can never drift between them again (the
 *  ingest cache once re-implemented it and drifted). */
export async function dispatchIngest(
  input: Input | (Input | [Input, Input])[],
  second: Input | undefined,
  onOne: (input: Input) => Promise<Sema & { id: number }>,
  onPair: (ctxInput: Input, cont: Input) => Promise<void>,
): Promise<(Sema & { id: number }) | undefined> {
  if (
    Array.isArray(input) && !(input instanceof Uint8Array) &&
    (input as { width?: unknown }).width === undefined
  ) {
    const arr = input as (Input | [Input, Input])[];
    if (
      arr.length === 2 && !Array.isArray(arr[0]) && !Array.isArray(arr[1])
    ) {
      await onPair(arr[0] as Input, arr[1] as Input);
      return undefined;
    }
    for (const item of arr) {
      if (Array.isArray(item) && item.length === 2) {
        await onPair(item[0], item[1]);
      } else await onOne(item as Input);
    }
    return undefined;
  }
  if (second === undefined) return onOne(input as Input);
  await onPair(input as Input, second);
  return undefined;
}

/** Ingest an input or array of inputs/pairs.  The public ingest entry point. */
export async function ingest(
  ctx: MindContext,
  input: Input | (Input | [Input, Input])[],
  second?: Input,
): Promise<(Sema & { id: number }) | undefined> {
  return dispatchIngest(
    input,
    second,
    (i) => ingestOne(ctx, i),
    (a, b) => ingestPair(ctx, a, b),
  );
}
