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
import type { Meter } from "../meter.js";
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
import type { ContentFold, Grid } from "../geometry.js";

/** One {@link MindContext._depositTrees} entry — see that field's doc.
 *
 *  A PURE WORK CACHE.  It carries the already-folded content segments of a
 *  deposited stream so a longer stream sharing its byte prefix can skip
 *  refolding them.  It holds no turn boundaries and no continuation proof
 *  because the deposit fold imposes nothing: reuse is bit-identical to a cold
 *  fold, so a hit can only save time, never change a tree. */
export interface DepositCacheEntry {
  /** The plain content fold's reusable segment state. */
  content: ContentFold;
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
  /** Work accumulator, or null/absent when nothing is profiling — see
   *  src/meter.ts.  Declared here (not only on MindContext) so the graph
   *  search can report its chart effort without importing mind code. */
  readonly meter?: Meter | null;
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
  /** The query span of the point's STRONGEST contributing region — the argmax
   *  over `wFocus` (see `peak`, which is that same region's weight), NOT a
   *  union or hull over every region that voted.  Measured on test/24 3.2: the
   *  winning anchor's span here was 2 bytes while its contributing regions
   *  together covered most of the query.  It is the minimal honest statement
   *  of what a grounding on this anchor rests on, and recall accounts exactly
   *  it for that reason — widening it to every contributing region made recall
   *  out-bid mechanisms that had genuinely explained more (a GENERATED list
   *  degraded to a RETRIEVED one, test/24 3.2 and test/04 1). */
  start: number;
  end: number;
  /** The largest SINGLE region's contribution to this point's pooled vote —
   *  the weight of the very region `start`..`end` delimits (both are the
   *  argmax over `wFocus`), so the two fields describe one region: its
   *  strength and its place.
   *  `vote` is a sum over every region that agreed, so it grows with how many
   *  places corroborated; `peak` is what the strongest one of them said on its
   *  own.  A consumer holding this point to consensusFloor(N) — a bar that
   *  prices ONE region's maximally-discriminative evidence — must read `peak`,
   *  not `vote`: six scaffolding regions summing past the floor is not the
   *  same claim as one region clearing it. */
  peak: number;
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
  /** The stored node this region's bytes ARE, when the region came from a
   *  recognised SITE — content-addressed and exact, so the climb has no
   *  reason to re-derive it approximately.  A perceived sub-tree leaves this
   *  undefined; chunks get the same thing from `canonicalChunkId`. */
  id?: number;
  /** EVIDENCE, NOT A POINT OF ATTENTION.  True for a region the query's own
   *  fold never produced — a stored form that a content-defined cut SPLIT,
   *  recovered by sliding-window lookup in collectRegions.  The store
   *  guarantees such a form is addressable (canonicalWindows interns both
   *  lengths), so it may corroborate an anchor's vote; but the query did not
   *  weave it as an independent structure, so it must not make the query look
   *  like it holds one more point of attention than it does — it is kept out
   *  of the root-cut distribution and out of the breadth ratio (see
   *  poolVotes/commitVotes).  Absent/false for every region from the fold.
   *  (Flagging these `chunk: true` instead is REFUTED — a chunk is a
   *  smallest unit the FOLD produced, and claiming first-class unit status
   *  for an assembled span cost 5 tests.) */
  corroborating?: boolean;
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
  /** The SEPARATE query places this vote's evidence occupies, when that is
   *  more than the one contiguous run [start, end].  A cross-region junction
   *  vote is pooled as a single synthetic region spanning its endpoints and
   *  the gap between them, so `[start, end]` reads as ONE place — yet the
   *  vote exists precisely because two non-adjacent regions each voted and
   *  only their conjunction resolved.  Cluster counting (Attention.clusters)
   *  asks "how many separate places in the query corroborate this?", and
   *  answering it from the merged span makes every joint binding look like a
   *  single local neighbourhood; fusion's dispersion gate then drops it
   *  unless it also explains most of the whole query, which a binding inside
   *  a MULTI-topic query structurally cannot.  Absent for an ordinary
   *  per-region vote, where the merged span already is the truth. */
  parts?: readonly (readonly [number, number])[];
  /** Carried through from {@link Region.corroborating}: this vote's evidence
   *  is a stored form the query's fold SPLIT, not a structure the query wove.
   *  Votes are what the pool sees (regions are not), so the flag has to
   *  travel with the vote for the root election to honour it. */
  corroborating?: boolean;
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
  /** The work accumulator for the inference call in flight, or null when
   *  nothing is profiling — see src/meter.ts.  WRITE-ONLY from the engine's
   *  point of view: no inference decision may read a counter, or the
   *  determinism contract (AGENTS §2.1) is gone.  Every call site is
   *  `ctx.meter?.x++`, so an unprofiled response allocates nothing. */
  meter: Meter | null;
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
  /** Stable identity for session-lifetime, write-invalidated structural
   *  caches. Query-level climb results remain on climbMemo. */
  _structMemoKey: object;
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
   *  the Sema objects the pyramid keeps alive).
   *
   *  THAT REUSE IS A PRECONDITION, NOT A GIVEN: the keys are node IDENTITIES,
   *  so it hits only while the conversation's fold hands back the SAME Sema
   *  objects for the unchanged prefix.  `_growContext` rebuilt the whole tree
   *  with `bytesToTree` on every turn, so every key was fresh and this cache
   *  could not hit even once — the O(suffix) claim above described an
   *  intention rather than the code.  It now grows the context through
   *  {@link stablePrefixFoldIncremental}, which reuses each already-folded
   *  segment: measured over four turns, turn 4 shared 69 of its 95 nodes with
   *  turn 3 (26 new ≈ the new turn's own size). */
  _resolvedSubtrees: WeakMap<Sema, { id: number; len: number }> | null;
  /** Completed assistant-turn byte spans in the current cumulative query.
   *  Empty for ordinary respond(); response-scoped structural context for
   *  mechanisms that must not re-derive already-produced replies. */
  answeredSpans: ReadonlyArray<readonly [number, number]>;
  /** Start offset of the user turn currently being answered. Zero for an
   *  ordinary respond() and for the first turn of a conversation. */
  currentTurnStart: number;
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
   *  O(turn) per deposit instead of O(context).  A first-seen input takes the
   *  same fold with no boundaries at all, and caches the segments it produced
   *  so a later turn of the same conversation reuses them.  Purely a
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
/** The spans {@link liftAnswer} actually concatenates, in order — the answer
 *  before it is joined.  Exposed so a caller can ask what the lifted answer is
 *  MADE OF without re-deriving the selection: in particular how much of it is
 *  SCAFFOLDING (a `rec: false` span — query bytes carried through verbatim
 *  because nothing explained them, the same spans the liftAnswer trace labels
 *  "scaffolding" rather than "chosen").
 *
 *  That quantity is load-bearing for the grounding decision.  Two candidates
 *  can leave the SAME number of query bytes unaccounted and therefore grade
 *  identically, while one of them pads its answer with those bytes and the
 *  other does not — measured on test/22's two-fact chain, cover and recall
 *  both graded 11001 with 11 bytes unexplained, and cover won the tie only on
 *  consideration order, answering "The capital of France is Paris famous for"
 *  where recall had crossed the hop.  Carrying an unexplained span into the
 *  answer is strictly weaker than not explaining it: it manufactures fluency
 *  out of the asker's own words.  See the tie-break in pipeline.ts. */
export function liftAnswerParts(
  segs: Seg[],
  queryLen: number,
  query: Uint8Array,
  W: number,
): Seg[] {
  const restated = segs.map((s) => segRestatesQuery(s, query, queryLen, W));
  const recognised: number[] = [];
  for (let k = 0; k < segs.length; k++) {
    if (segs[k].rec && !restated[k]) recognised.push(k);
  }
  if (recognised.length === 0) return [];

  if (recognised.length === 1) {
    const s = segs[recognised[0]];
    if (s.computed && s.i > 0) return [s];
    if (dominates(s.j - s.i, queryLen)) {
      return segs.filter((_, k) => !restated[k]);
    }
    return [s];
  }
  const lo = recognised[0];
  const hi = recognised[recognised.length - 1];
  return segs.slice(lo, hi + 1).filter((_, k) => !restated[lo + k]);
}

/** The SCAFFOLDING byte count of a lifted answer: how many of its bytes come
 *  from spans nothing recognised (see {@link liftAnswerParts}).
 *
 *  ONLY RUNS OF AT LEAST ONE RIVER WINDOW COUNT.  Not all carried-through
 *  bytes are a failure to explain: a period, a question mark, the space
 *  between two fused topics are GLUE — they belong to the answer's surface,
 *  and dropping them to look better-derived would be a worse answer, not a
 *  more honest one.  A substantive phrase the derivation never explained
 *  ("famous for") is a different claim entirely.
 *
 *  W is the line between them, and it is the same line the rest of the mind
 *  already draws: below one river window byte overlap is chance, not evidence
 *  (see identityBar, the bridge's attestedQ, and recognition's site floor).
 *  Counting every scaffolding byte instead — which is what this did first —
 *  made punctuation preservation lose a tie it should win, and test/00's
 *  "period preserved" / "question mark preserved" caught it immediately. */
export function liftedScaffolding(
  segs: Seg[],
  queryLen: number,
  query: Uint8Array,
  W: number,
): number {
  // MEASURED PER CONTIGUOUS RUN, not per span.  A PASS span is one BYTE — the
  // cover charges unrecognised bytes individually — so asking whether a single
  // span reaches W would find no run ever, whatever the query.  " famous for"
  // arrives as eleven one-byte spans in a row and is one eleven-byte run.
  let n = 0;
  let run = 0;
  const close = () => {
    if (run >= W) n += run;
    run = 0;
  };
  for (const s of liftAnswerParts(segs, queryLen, query, W)) {
    if (s.rec) close();
    else run += s.bytes.length;
  }
  close();
  return n;
}

export function liftAnswer(
  segs: Seg[],
  queryLen: number,
  query: Uint8Array,
  W: number,
): Uint8Array | null {
  // ONE selection rule, in {@link liftAnswerParts} — this is its join.  The
  // two used to be separate copies of the same lo/hi/restated reasoning, which
  // is exactly how an answer and the accounting OF that answer drift apart.
  const parts = liftAnswerParts(segs, queryLen, query, W);
  if (parts.length === 0) return null;
  return concatBytes(parts.map((x) => x.bytes));
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
