// types.ts — all interfaces, types, and free functions for the mind.
//
// GraphSearchHost is defined first (minimal imports) so GraphSearch can import
// it without pulling in the full MindContext.

import type { Vec } from "../vec.js";
import type { Sema } from "../sema.js";
import type { BoundedMap, Store } from "../store.js";
import type { Space } from "../sema.js";
import type { Alphabet } from "../alphabet.js";
import type { MindConfig } from "../config.js";
import type {
  ComputedResult,
  DerivationItem,
  DerivationStep,
  GraphSearch,
  Leaf,
  Seg,
  Site,
} from "./graph-search.js";
import type { Rationale } from "./rationale.js";
import type { FoldPyramid, Grid, StableFold } from "../geometry.js";

/** One {@link MindContext._depositTrees} entry — see that field's doc. */
export interface DepositCacheEntry {
  /** Turn boundaries accumulated over this content's deposit chain —
   *  strictly increasing proper offsets, each a previously-deposited
   *  whole-context length.  Empty for a first-seen (single-turn) input. */
  boundaries: number[];
  /** Plain-fold pyramid (first-seen inputs only). */
  pyramid?: FoldPyramid;
  /** Stable-prefix segment folds (grown-context inputs only). */
  stable?: StableFold;
  /** The continuation bytes this ctxInput was paired with in ingestPair, if
   *  any — the ONLY thing that makes a later, longer ctxInput a genuine next
   *  TURN of the same conversation rather than an unrelated fact that
   *  happens to share this one's byte prefix (e.g. "2+2" vs. "2+2=5").  A
   *  later deposit only takes this entry as its stable-prefix `prev` when
   *  its own suffix bytes-equal this exactly. */
  nextBytes?: Uint8Array;
}
import { bytesEqual, concatBytes, indexOf } from "../bytes.js";
import { dominates } from "../geometry.js";

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES (exported from the package)
// ═══════════════════════════════════════════════════════════════════════════

export type Input = string | Uint8Array | Grid | Grid[];

// NOTE: the public `Response` interface lives in mind/mind.ts (it carries the
// `provenance` read-out).  A second copy briefly lived here and drifted —
// keep exactly one definition.

// ═══════════════════════════════════════════════════════════════════════════
// GraphSearchHost — the contract GraphSearch needs (no closures)
// ═══════════════════════════════════════════════════════════════════════════

/** The host capabilities GraphSearch consults during a cover.  MindContext
 *  extends this so the Mind can pass itself as the host. */
export interface GraphSearchHost {
  resolve(bytes: Uint8Array): number | null;
  recogniseSpan?(bytes: Uint8Array): {
    sites: ReadonlyArray<Site>;
    leaves: ReadonlyArray<Leaf>;
    splits: ReadonlySet<number>;
    starts: ReadonlySet<number>;
  };
  chooseNext?(node: number): number | undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Recognition {
  /** Forms that can lead somewhere — they have an edge or a halo. */
  sites: Site[];
  /** The query's perceived leaves (the search's covering axioms). */
  leaves: Leaf[];
  /** Sub-leaf positions where a form boundary falls between leaf edges. */
  splits: Set<number>;
  /** Leaf-parent (chunk) start positions from the query's OWN perceived
   *  fold — the positions the fold itself chose as a grouping boundary, as
   *  opposed to an offset a byte-level scan merely happens to land on.  The
   *  one boundary signal opportunistic cross-leaf recovery (recognition's
   *  own canonical chains, the search's `fuse`) can lean on instead of
   *  ASCII/word heuristics: see the `boundary` gate in recognition.ts. */
  starts: Set<number>;
}

/** How the consensus climb weights a region's Document-Frequency reach. */
export type DFMode = "inverse" | "direct" | "combined";

/** One POINT OF ATTENTION the consensus climb resolved. */
export interface Attention {
  /** The learnt context this point resolves to. */
  anchor: number;
  /** IDF-weighted consensus vote — the strength that orders points. */
  vote: number;
  /** The union of the query byte-spans whose evidence supports this point. */
  start: number;
  end: number;
  /** SCALE-INVARIANT confidence: the fraction of the query's OWN regions
   *  whose evidence this point accounts for (Σ RegionVote.absorbed among
   *  its contributors, over the query's total region count) — read PER-
   *  ANCHOR, unlike the raw IDF vote (an absolute, ln(N)-scaled quantity
   *  that means "strong" on a small store and "weak" on a large one for
   *  the SAME degree of genuine consensus).  A point whose breadth clears
   *  `dominates` (> half the query's regions corroborate it) is real
   *  consensus; one that does not is a coincidental single-region echo —
   *  see test/35-attention-confidence.test.mjs. */
  breadth: number;
  /** DISPERSION: the number of distinct clusters this point's contributing
   *  regions form, merging any two whose gap is under one river-fold
   *  quantum W.  Neither breadth NOR raw region count discriminates a
   *  genuine further topic from a coincidental echo (both were tried and
   *  falsified — breadth starves a genuine, evenly-split multi-topic query,
   *  since no root in a real N-way split can exceed half the vote; raw
   *  count doesn't separate them either, since a short, structurally simple
   *  echo racks up as many corroborating regions as a real topic does).
   *  Dispersion asks a different question: not how MUCH evidence, but how
   *  many separate PLACES in the query corroborate it.  A coincidental
   *  match — one local phrase resonating with an unrelated stored form —
   *  is structurally confined to ONE cluster no matter how strong its vote;
   *  a genuine further topic is named in its own distinctive wording
   *  somewhere the query's scaffolding does not reach, always a SEPARATE
   *  cluster from whatever else corroborates it.  See
   *  test/37-cluster-dispersion-fusion.test.mjs. */
  clusters: number;
}

/** Both read-outs of one consensus climb. */
export interface AttentionRead {
  roots: Attention[];
  ranked: Attention[];
}

/** A positioned region of a byte stream paired with its gist. */
export interface Segment {
  start: number;
  end: number;
  v: Vec;
}

/** A region of the query's perceived tree for the consensus climb. */
export interface Region {
  v: Vec;
  start: number;
  end: number;
  chunk: boolean;
  /** Whether the region's bytes resolve to a KNOWN node (content-addressed,
   *  exact).  Exact regions vote with full weight; approximate ones pay the
   *  contrastive margin (see voteRegions) — under the linear fold a raw
   *  resonance score is byte-overlap, evidence only in excess of its best
   *  rival conclusion. */
  known: boolean;
}

/** Per-region vote data from the consensus climb's resonance pass. */
export interface RegionVote {
  start: number;
  end: number;
  canonicalFailed: boolean;
  roots: readonly number[];
  w: number;
  wFocus: number;
  /** How many of the query's ORIGINAL regions this one vote's evidence
   *  accounts for.  1 for an ordinary per-region vote (itself); for a
   *  cross-region junction vote, 1 (itself) plus however many individual
   *  votes it explained away (see crossRegionVotes) — the junction speaks
   *  for all of them at once, and breadth accounting must not undercount it
   *  to "one region" just because it collapsed to one pooled axiom.
   *  Defaults to 1 when absent. */
  absorbed?: number;
}

/** The structural gate that first decided an {@link edgeAncestors} climb was
 *  saturated (an abstention, not a discriminative conclusion) — pure
 *  instrumentation for {@link ClimbConsensusData}'s reach trace; it never
 *  feeds back into the climb itself. */
export type SaturationReason =
  | "byte-atom-commonality"
  | "predecessor-fan-in"
  | "distinct-context-limit"
  | "parent-fan-out"
  | "lateral-cone-limit";

/** One saturation stop's provenance: which reason fired, at which node, the
 *  observed count against the bound that decided it. */
export interface SaturationStop {
  reason: SaturationReason;
  node: number;
  observed: number;
  limit: number;
}

/** The edge-bearing contexts reached by climbing from a node, plus saturation info. */
export interface AncestorReach {
  roots: number[];
  contextsReached: number;
  saturated: boolean;
  /** The saturation gate that stopped this climb, when {@link saturated} is
   *  true and a trace was requested — see {@link edgeAncestors}.  Absent for
   *  a non-saturated reach, and absent (even when saturated) when no trace
   *  was requested — instrumentation must not allocate when tracing is off. */
  saturation?: SaturationStop;
  /** The number of nodes the climb actually PROCESSED (popped and examined
   *  by its visit step; a transparent chain counts as its one terminal).
   *  Present only when a trace was requested — same contract as
   *  {@link saturation}: instrumentation must not allocate when tracing is
   *  off.  Purely a read-out; the climb never consults it. */
  visited?: number;
  /** The maximum structural ascent distance (in parent/containment hops,
   *  transparent-chain interiors counted) from the start node among the
   *  processed nodes.  Present only when a trace was requested — see
   *  {@link visited}. */
  maxDepth?: number;
}

/** Saturated-interval information for the noise-drop gate. */
export interface SaturationInfo {
  leadingEnd: number;
  hasLeading: boolean;
  intervals: Array<{ start: number; end: number }>;
}

/** The items of poolVotes' deduction system. */
export type AItem =
  | { kind: "region"; ri: number }
  | { kind: "anchor"; id: number }
  | { kind: "anchorFocus"; id: number };

// ═══════════════════════════════════════════════════════════════════════════
// MindContext — bundles all state the mind's functions need
// ═══════════════════════════════════════════════════════════════════════════

export interface MindContext extends GraphSearchHost {
  store: Store;
  space: Space;
  alphabet: Alphabet;
  cfg: MindConfig;
  search: GraphSearch;
  trace: Rationale | null;
  /** The content canonicalizer for THIS response, or null — injected by the
   *  modality entry point (respondText passes the text canonicalizer; a
   *  binary respond passes none).  Resolution uses it as a fallback: when
   *  the exact content-addressed lookup misses, the span's canonical key is
   *  probed against the store's canon index (see src/canon.ts).  The core
   *  never inspects what the equivalence IS. */
  canon: ((bytes: Uint8Array) => Uint8Array) | null;
  /** Per-response memo of canonical-fallback resolutions, keyed by the
   *  span's latin1 content key.  Null outside respond(). */
  canonMemo: Map<string, number | null> | null;
  /** Memo of the consensus climb — content-keyed (latin1) so results
   *  persist across conversation turns where the same byte spans recur.
   *  Null outside respond(); during respondTurn() the conversation's
   *  persistent map is swapped in. */
  climbMemo: Map<string, Map<string, AttentionRead>> | null;
  /** Memo of {@link recognise} — content-keyed (latin1) so recognised
   *  forms carry forward across conversation turns.  Bypassed while a
   *  trace is attached.  Null outside respond(). */
  recogniseMemo: Map<string, Recognition> | null;
  /** Memo of {@link perceive} — content-keyed (latin1).  The general
   *  cache the result-level memos each partially compensate for.  NOT
   *  bypassed under trace — perception emits no rationale steps.
   *  Null outside respond(). */
  perceiveMemo: Map<string, Sema> | null;
  /** Subtree-resolution cache: Sema node → its store id and byte length.
   *  Populated by {@link foldTree} during inference; checked before
   *  walking children.  When a conversation's pyramid reuses prefix
   *  subtrees, this cache lets {@link recognise} skip them entirely —
   *  O(suffix) instead of O(context).  Mind-lifetime (WeakMap keys are
   *  the Sema objects the pyramid keeps alive). */
  _resolvedSubtrees: WeakMap<Sema, { id: number; len: number }> | null;
  _edgeGuide: Vec | null;
  _edgeChoice: Map<number, number>;
  _prevSeen: Set<number> | null;
  /** Session cache of node-id → perceived gist, for candidate scoring
   *  ({@link chooseAmong} in the reverse projection's recall path re-gists up to
   *  √N contexts per pick — the measured bottleneck there).  `chooseNext` does
   *  NOT use this cache; forward-edge disambiguation uses prevOf counts
   *  (distributional evidence) instead of gist comparison, because for short
   *  answer candidates the gist is dominated by accidental byte-pattern
   *  correlations.  A node's bytes are immutable and perception is a pure
   *  function of bytes, so an entry stays valid for the store's lifetime —
   *  never invalidated.  Bounded LRU (byte-sized); a miss only re-perceives,
   *  never a correctness risk. */
  _gistCache: BoundedMap<number, Vec>;
  /** DEPOSIT-path perception cache: content key (latin1) of a deposited
   *  input → its accumulated turn BOUNDARIES plus reusable fold state.  A
   *  deposit whose content extends a cached entry IS a conversation context
   *  grown by one turn — the cached length is the new boundary — so it
   *  folds with the SAME stable-prefix fold query-time perception uses
   *  (structural train/inference agreement, load-bearing for recall),
   *  reusing every already-folded segment via `stable` (see StableFold) —
   *  O(turn) per deposit instead of O(context).  A first-seen input keeps
   *  the plain fold and caches its `pyramid` (see FoldPyramid).  Purely a
   *  performance cache for the FOLD STATE; the boundaries are semantic but
   *  derived only from the deposit sequence itself (an evicted chain falls
   *  back to plain-fold behavior, exactly the pre-boundary shape). */
  _depositTrees: BoundedMap<string, DepositCacheEntry>;
  /** The byte lengths present in {@link _depositTrees} — the candidate
   *  prefix lengths probed (longest first).  Drifts on eviction (a stale
   *  length only costs a miss); cleared with the map when it outgrows the
   *  probe budget. */
  _depositLens: Set<number>;
  /** Mind-lifetime intern memo by NODE IDENTITY: perceived-tree node → its
   *  content-addressed id.  Valid forever (ids are permanent, Sema nodes
   *  immutable); WeakMap, so entries live exactly as long as the pyramid
   *  cache keeps the shared subtrees alive.  Lets internTreeIds skip whole
   *  shared subtrees and indexSubSpans keep its seenBefore window skip. */
  _internIds: WeakMap<Sema, number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// FREE FUNCTIONS (pure, no state)
// ═══════════════════════════════════════════════════════════════════════════

/** Read a whole node's bytes. */
export const ALL = 0x7fffffff;

/** Splice every chosen span in order — the whole cover as one byte string. */
export function spliceAll(segs: Seg[]): Uint8Array | null {
  if (!segs.some((s) => s.rec)) return null;
  return concatBytes(segs.map((s) => s.bytes));
}

/** Whether a chosen span RESTATES the query rather than answering it: its
 *  SUBSTITUTED bytes (an edge followed from a recognised site, not the
 *  site's own literal text read back) already occur elsewhere in the query
 *  — the same principle recall.ts's tiers apply to a whole-query projection
 *  ("a projection that is a proper byte-subspan of the query restates part
 *  of the question").  A LITERAL span (the site's own bytes, unchanged) is
 *  exempt: naming what's already there at its OWN position is not a
 *  substitution.  A recognised site that is itself an entire PRIOR TURN of
 *  a multi-turn query is exactly this shape: it carries a genuine learnt
 *  continuation, but that continuation is something the asker already said
 *  moments later in the SAME query, not a new answer.  Below one river
 *  window, byte overlap is chance, not evidence — the same floor
 *  identityBar and reachThreshold hold every other structural-overlap claim
 *  to. */
export function segRestatesQuery(
  s: Seg,
  query: Uint8Array,
  queryLen: number,
  W: number,
): boolean {
  if (!s.rec) return false;
  const literal = s.j - s.i === s.bytes.length &&
    bytesEqual(s.bytes, query.subarray(s.i, s.j));
  if (literal) return false;
  return s.bytes.length >= W && s.bytes.length < queryLen &&
    indexOf(query, s.bytes, 0) >= 0;
}

/** Lift the answer out of the cover for think: the recognised region, free of
 *  the asker's surrounding (unrecognised) framing — and free of any chosen
 *  span that only RESTATES content the query already contains (see {@link
 *  segRestatesQuery}).  A restating span is excluded from both the framing
 *  (lo/hi) decision and the final concatenation: it is stale, not a second
 *  answer, but the OTHER spans a derivation chose are independent evidence
 *  and must not be discarded along with it. */
export function liftAnswer(
  segs: Seg[],
  queryLen: number,
  query: Uint8Array,
  W: number,
): Uint8Array | null {
  const restated = segs.map((s) => segRestatesQuery(s, query, queryLen, W));
  const recognised: number[] = [];
  for (let k = 0; k < segs.length; k++) {
    if (segs[k].rec && !restated[k]) recognised.push(k);
  }
  if (recognised.length === 0) return null;

  if (recognised.length === 1) {
    const s = segs[recognised[0]];
    // A COMPUTED span's query-side width is operand digit-count, not
    // evidence of how much of the query's meaning it accounts for — the
    // half-dominance check below (built for a genuinely RECOGNISED learned
    // form) is not a valid framing signal for it (see the `computed` field
    // doc on Seg/GItem): "1000 - 421" outweighs "what is …?" by width only
    // because the operands are big, not because the framing matters less.
    // A LITERAL PREFIX before a computed span is unambiguous framing
    // regardless of width — an arithmetic expression is never itself
    // preceded by more literal computed content, so anything literal before
    // it is question wording ("what is ", "compute ") to lift clear of.
    // With no prefix (s.i === 0) the span is judged by the ordinary
    // half-dominance rule below, which already correctly keeps a short
    // trailing glue byte ("2+2." → "4.", the span dominates a 4-byte query).
    if (s.computed && s.i > 0) return s.bytes;
    if (dominates(s.j - s.i, queryLen)) {
      return concatBytes(
        segs.filter((_, k) => !restated[k]).map((x) => x.bytes),
      );
    }
    return s.bytes;
  }
  const lo = recognised[0];
  const hi = recognised[recognised.length - 1];
  return concatBytes(
    segs.slice(lo, hi + 1).filter((_, k) => !restated[lo + k]).map((x) =>
      x.bytes
    ),
  );
}

/** The CHANGED NODES of a freshly-perceived `tree` against the node ids a previous
 *  tracked deposit interned (`prevSeen`). */
export function changedNodes(
  tree: Sema,
  ids: Map<Sema, number>,
  prevSeen: Set<number>,
): Sema[] {
  const newCount = new Map<Sema, number>();
  const count = (n: Sema): number => {
    const memo = newCount.get(n);
    if (memo !== undefined) return memo;
    const id = ids.get(n);
    // PRUNE: a node whose id the previous deposit already interned is old,
    // and content addressing makes that transitive — the same id names the
    // same content, so every descendant was interned then too.  The whole
    // subtree counts 0 without walking it; with the pyramid fold sharing a
    // conversation's prefix subtree, this is what keeps the changed-nodes
    // read O(new nodes) instead of O(context).  (A node internTreeIds
    // memo-skipped has an id here exactly when it is such a shared root.)
    if (id !== undefined && prevSeen.has(id)) {
      newCount.set(n, 0);
      return 0;
    }
    let c = 1; // reachable only when NOT pruned above ⇒ this node is new
    if (n.kids) { for (const k of n.kids) c += count(k); }
    newCount.set(n, c);
    return c;
  };
  const total = count(tree);
  if (total === 0) return [tree];

  let n = tree;
  for (;;) {
    if (n.kids === null) return [n];
    let holder: Sema | null = null;
    for (const k of n.kids) {
      if (newCount.get(k)! === total) {
        holder = k;
        break;
      }
    }
    if (holder === null) return [n];
    n = holder;
  }
}
