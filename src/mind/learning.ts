// learning.ts — ingest and deposition (Section 7 of the mind).
//
//   Learning is DEPOSITION: perceive a stream into a tree and intern every
//   node.  A fact is an EDGE between node ids; recall traverses edges.

import { addInto, normalize, Vec, zeros } from "../vec.js";
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
import { hubBound } from "./traverse.js";
import { dominates } from "../geometry.js";
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

/** What one ingested item deposited — reported through {@link ingest}'s
 *  optional `onDeposit` callback.  Pure provenance read-out: node ids are
 *  content-addressed, so two byte-identical items report the SAME ids (that
 *  is content addressing working, not an error), and the callback observes
 *  the deposit without influencing it. */
export interface DepositReport {
  /** Zero-based position of the item in the ingested input (0 for a scalar
   *  or single pair). */
  index: number;
  /** Whether the item was a bare experience or a (context, continuation)
   *  pair. */
  kind: "one" | "pair";
  /** Root node id of the item's (context) bytes. */
  contextId: number;
  /** Root node id of the continuation bytes — pairs only. */
  continuationId?: number;
}

/** How many constituents one profile may VISIT.  A partner's constituent tree
 *  is O(len/W) nodes, so an uncapped descent would make a pour cost grow with
 *  the partner's LENGTH — and a partner is a whole deposit, which may be a
 *  paragraph.  The budget is what keeps a pour O(1) in the input, the property
 *  that lets {@link companyProfile} claim no new cost class.  It binds only on
 *  long partners whose constituents are all corpus-unique; the descent's own
 *  stop rule (below) reaches recurring units far sooner on a trained store. */
const PROFILE_VISITS = 64;

/** The COMPANY PROFILE of a partner: its own identity signature superposed
 *  with the signatures of its RECURRING content-defined constituents.
 *
 *  WHY THE WHOLE-PARTNER SIGNATURE ALONE IS NOT ENOUGH.  The distributional
 *  hypothesis is a claim about TYPES ("occurs near a city name"), but a
 *  signature keyed on the whole partner's node id records a TOKEN ("occurred
 *  near node #4711992").  Two nodes are then distributional siblings only when
 *  their partners are the very same node — and a content-addressed store of
 *  natural language almost never repeats a whole deposit (measured on the
 *  trained store: whole-span dedup 0.98×, i.e. effectively none).  So the
 *  halos of genuine synonyms came out quasi-orthogonal BY CONSTRUCTION: the
 *  best distributional sibling of "Eiffel Tower" scored 0.146 against a
 *  concept threshold of 0.516, with its own attested translations absent
 *  entirely, and the whole concept-hop / articulation / analogy layer was
 *  inert at corpus scale.  (Re-verified under the store's OWN training seed:
 *  company signatures key on NODE ID, not the alphabet, so this reading is
 *  seed-independent and the figures are identical either way.  Worth stating
 *  because a Mind built with a seed other than the store's makes every GIST
 *  comparison meaningless while leaving halo comparisons untouched.)
 *
 *  WHY THE DESCENT MUST NOT STOP AT DEPTH 1.  Reading only `rec.kids` does
 *  NOT deliver this.  Cuts are content-defined over a rolling window, so a
 *  chunk boundary depends on the bytes AROUND a unit: "The Eiffel Tower is in
 *  Paris" folds to "The Eiffel " + "Tower is in Paris", and "Tour Eiffel dia
 *  any Paris" to "Tour Eiffel " + "dia any Paris".  The shared unit "Paris"
 *  is a node in NEITHER — depth-1 profiles of that pair intersect in the
 *  EMPTY SET, and their halos measured 0.0319 against 0.0416 for an unrelated
 *  control: no signal at all.  A depth-1 read merely moves the token problem
 *  from whole-partner identity down to top-level-chunk identity, which for
 *  full sentences is nearly as rare.  Descending, the same pair shares
 *  " Paris" and "ffel " while the control still shares nothing — the units
 *  the distributional hypothesis is actually about.
 *
 *  EVERY DEPTH CONTRIBUTES, AND THE RULE MUST NOT DEPEND ON ARRIVAL ORDER.
 *  The tempting stop rule — descend only while a constituent is corpus-unique,
 *  stop at the first unit attested in ≥ 2 forms — is wrong, and measurably so.
 *  Recurrence is a property of the corpus SO FAR: when the first of a pair is
 *  deposited its shared unit has fan-in 1, so the descent runs past it, and
 *  only the second partner ever profiles it.  The pair then never meets
 *  (measured on the fixture above: 0.0165 against a 0.0375 control — still
 *  nothing).  Whether two synonyms become distributional siblings cannot be
 *  allowed to depend on which was trained first.  So the walk descends through
 *  EVERY constituent within its budget and superposes each one that is not a
 *  hub, at whatever depth it sits.  A partner's own unique chunks contribute
 *  terms unique to that partner, which dilute but never mislead; the shared
 *  units contribute the signal.
 *
 *  HUBS ARE THE ONE EXCLUSION, read LIMITed as `parentsFirst(n, bound+1)` —
 *  the store's own exact hub-or-not probe (a result longer than the bound
 *  means MORE than the bound), never a fan-in-sized read.  A constituent with
 *  more than √N structural parents is scaffolding by §8.8's bound: " is ",
 *  "the ".  Superposing it would put a term shared by every deposit into every
 *  profile, ALL halos would correlate, and the concept threshold's null model
 *  (unrelated halos at 0 ± 1/√D) that §4.1's hygiene note protects would
 *  collapse.  It is still DESCENDED into — a hub chunk can contain a rare
 *  unit — but contributes nothing itself.
 *
 *  Byte atoms are skipped in BOTH representations (a negative id and a stored
 *  kid-less node): an atom's fan-in is the alphabet's, so it can only ever
 *  read as a hub, and a short partner folding FLAT would otherwise put a
 *  handful of alphabet signatures into every profile — which is what silenced
 *  CAST's analogy gate in the first version of this function (measured:
 *  analogy strength 0.3636 -> 0.2004, "no halo-tier company evidence",
 *  test/29 C1).
 *
 *  A FUNCTION OF THE NODE AND THE CORPUS STATE — stated precisely, because
 *  the weaker claim is the true one.  The constituents are read from the
 *  STORE, never from the depositing tree's id map: that map holds only the
 *  nodes THIS deposit newly interned, so a partner met a second time yielded a
 *  profile missing exactly those constituents, the exact-partner case fell
 *  from cosine 1 to 1/√(1+k), and the geometry stopped meaning anything.
 *  Reading the store fixes that.  It does NOT make the profile permanent: the
 *  hub test reads fan-in against √N and both grow with training, so a partner
 *  poured early and again late can profile differently.  That residue is
 *  confined to the hub EXCLUSION — which terms are dropped as scaffolding —
 *  and never to which units are found, because the descent itself is now
 *  order-independent.  The drift is one-directional and benign: a term can
 *  only ever go from contributing to being excluded as scaffolding.  Replay of
 *  a fixed training order is bit-identical, so §2.1 holds.  What must not be
 *  claimed is that a node's profile is fixed for all time; it is fixed given
 *  the corpus that has been seen.
 *
 *  THE NULL MODEL IS OTHERWISE UNTOUCHED (§4.1).  Every term is still a seeded
 *  function of a NODE IDENTITY, never a gist, so no byte-similarity between
 *  partners can leak content similarity into distributional similarity.  The
 *  result is normalized, so ONE episode still pours ONE unit of mass:
 *  {@link Store.haloMass} keeps counting episodes and every mass-based
 *  reading is unchanged.  Two partners sharing j of k discriminating
 *  constituents meet at j/(1+k) — graded evidence, above the 1/√D noise floor
 *  and below conceptThreshold until the overlap is most of the content, which
 *  is the semantics "same company" should have.
 *
 *  Bounded: at most {@link PROFILE_VISITS} constituents are classified, each
 *  by ONE LIMITed structural-parent read, so a pour costs O(1) reads in the
 *  partner's size and performs no scan. */
function companyProfile(ctx: MindContext, id: number): Vec {
  const acc = zeros(ctx.space.D);
  addInto(acc, companySignature(ctx.space, id));
  const bound = hubBound(ctx);
  const W = ctx.space.maxGroup;
  const whole = Math.max(1, ctx.store.contentLen(id));
  const frontier: number[] = [];
  const seen = new Set<number>([id]);
  const descend = (n: number) => {
    const kids = ctx.store.get(n)?.kids;
    if (!kids) return;
    for (const kid of kids) if (!seen.has(kid)) frontier.push(kid);
  };
  descend(id);
  for (let visits = 0; visits < PROFILE_VISITS && frontier.length > 0;) {
    const n = frontier.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    visits++;
    // Atoms in both representations — negative id, or a stored kid-less node.
    if (n < 0 || ctx.store.get(n)?.kids == null) continue;
    descend(n);
    const len = ctx.store.contentLen(n, whole);
    if (len < W || dominates(len, whole)) continue;
    // MINIMAL units only: a constituent that still has a constituent of its
    // own at or above W is a composite, and superposing it as well as its
    // parts would count the same content twice.  Nested partners — an
    // accumulated conversation, where turn k's context is a prefix of turn
    // k+1's — share their large chunks structurally rather than
    // distributionally, so those composites are exactly the terms that make
    // adjacent turns read as synonyms (measured: consecutive turns at 0.809
    // and 0.740 against a 0.516 concept threshold).  The smallest units at or
    // above the fold's own window are the word-sized types company should be
    // keyed at.
    const kids = ctx.store.get(n)!.kids!;
    let composite = false;
    for (const kid of kids) {
      if (kid >= 0 && ctx.store.contentLen(kid, W) >= W) composite = true;
    }
    if (composite) continue;
    if (ctx.store.parentsFirst(n, bound + 1).length > bound) continue;
    addInto(acc, companySignature(ctx.space, n));
  }
  return normalize(acc);
}

/** Ingest a pair (context, continuation) — learn an edge and pour halos.
 *  Returns the deposited root ids (context, continuation) — a pure
 *  read-out; callers that ignore it behave exactly as before. */
export async function ingestPair(
  ctx: MindContext,
  ctxInput: Input,
  cont: Input,
): Promise<{ ctxId: number; contId: number }> {
  const c = await deposit(ctx, ctxInput, true, true);
  const cont_ = await deposit(ctx, cont, false);
  const ctxId = c.rootId, contId = cont_.rootId;

  // NO CONTINUATION STAMP.  A longer ctxInput reusing this one's folded
  // segments needs no proof that it is "really" the next turn: the deposit
  // fold imposes no boundaries, so reuse is bit-identical to refolding and a
  // coincidental byte prefix gets the tree it would have got anyway.  The
  // stamp existed only to gate a boundary guess that no longer happens.

  await ctx.store.link(ctxId, contId);
  await propagateSuffixes(ctx, ctxId, contId);

  // Halos pour company SIGNATURES (identity), not gists (content) — see
  // companySignature in sema.ts — as a TYPE-level profile: the partner's own
  // signature superposed with its discriminating constituents' (see
  // companyProfile), so company is shared by what partners are MADE OF and
  // not only by partner identity.
  const contSeat = bindSeat(ctx.space, companyProfile(ctx, contId), 1);
  for (const part of c.changed) {
    const partId = c.ids.get(part)!;
    await ctx.store.pourHalo(partId, contSeat);
    await ctx.store.pourHalo(
      contId,
      bindSeat(ctx.space, companyProfile(ctx, partId), 0),
    );
  }
  return { ctxId, contId };
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

/** Ingest an input or array of inputs/pairs.  The public ingest entry point.
 *
 *  `onDeposit`, when given, is invoked once per ingested item with the
 *  deposited root node ids ({@link DepositReport}) — item-level provenance
 *  for tooling that needs to know which stored node an ingested item became.
 *  Purely observational: the callback runs after the item's deposit
 *  completed and nothing reads its result. */
export async function ingest(
  ctx: MindContext,
  input: Input | (Input | [Input, Input])[],
  second?: Input,
  onDeposit?: (report: DepositReport) => void,
): Promise<(Sema & { id: number }) | undefined> {
  let index = 0;
  return dispatchIngest(
    input,
    second,
    async (i) => {
      const r = await ingestOne(ctx, i);
      onDeposit?.({ index: index++, kind: "one", contextId: r.id });
      return r;
    },
    async (a, b) => {
      const { ctxId, contId } = await ingestPair(ctx, a, b);
      onDeposit?.({
        index: index++,
        kind: "pair",
        contextId: ctxId,
        continuationId: contId,
      });
    },
  );
}
