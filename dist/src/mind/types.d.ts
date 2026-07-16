import type { Vec } from "../vec.js";
import type { Sema } from "../sema.js";
import type { BoundedMap, Store } from "../store.js";
import type { Space } from "../sema.js";
import type { Alphabet } from "../alphabet.js";
import type { MindConfig } from "../config.js";
import type { GraphSearch, Leaf, Seg, Site } from "./graph-search.js";
import type { Rationale } from "./rationale.js";
import type { FoldPyramid, Grid } from "../geometry.js";
export type Input = string | Uint8Array | Grid | Grid[];
/** The host capabilities GraphSearch consults during a cover.  MindContext
 *  extends this so the Mind can pass itself as the host. */
export interface GraphSearchHost {
  resolve(bytes: Uint8Array): number | null;
  recogniseSpan?(bytes: Uint8Array): {
    sites: ReadonlyArray<Site>;
    leaves: ReadonlyArray<Leaf>;
    splits: ReadonlySet<number>;
  };
  chooseNext?(node: number): number | undefined;
}
export interface Recognition {
  /** Forms that can lead somewhere — they have an edge or a halo. */
  sites: Site[];
  /** The query's perceived leaves (the search's covering axioms). */
  leaves: Leaf[];
  /** Sub-leaf positions where a form boundary falls between leaf edges. */
  splits: Set<number>;
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
}
/** The edge-bearing contexts reached by climbing from a node, plus saturation info. */
export interface AncestorReach {
  roots: number[];
  contextsReached: number;
  saturated: boolean;
}
/** Saturated-interval information for the noise-drop gate. */
export interface SaturationInfo {
  leadingEnd: number;
  hasLeading: boolean;
  intervals: Array<{
    start: number;
    end: number;
  }>;
}
/** The items of poolVotes' deduction system. */
export type AItem = {
  kind: "region";
  ri: number;
} | {
  kind: "anchor";
  id: number;
} | {
  kind: "anchorFocus";
  id: number;
};
export interface MindContext extends GraphSearchHost {
  store: Store;
  space: Space;
  alphabet: Alphabet;
  cfg: MindConfig;
  search: GraphSearch;
  trace: Rationale | null;
  climbMemo: WeakMap<Uint8Array, Map<string, AttentionRead>> | null;
  /** Per-response memo of {@link recognise} keyed by the byte-array OBJECT
   *  (think, articulate, and the post-grounding pre-consume all recognise the
   *  same query/answer objects).  Valid because the store is read-only while
   *  a response is in flight; bypassed when a trace is attached so every
   *  recognise still emits its rationale step.  Null outside respond(). */
  recogniseMemo: WeakMap<Uint8Array, Recognition> | null;
  /** Per-response memo of {@link perceive} keyed by the byte-array OBJECT —
   *  the GENERAL memo the result-level ones (recogniseMemo, climbMemo,
   *  _gistCache) each partially compensate for: resolve(), gistOf(), and
   *  every mechanism's re-perception of the same query/answer object hit it
   *  (a reason hop used to fold the same answer three times).  Valid because
   *  the store is read-only while a response is in flight and perception is
   *  a pure function of bytes; only inference-shaped calls (plain Uint8Array,
   *  no leafAt/lookup capabilities) are memoised, so the deposit path never
   *  sees it.  Keyed by CONTENT (latin1 of the bytes), not object identity —
   *  mechanisms materialise the same span in fresh subarrays constantly
   *  (measured on a trained store: 46% of one response's perceptions were
   *  byte-identical repeats an identity key missed).  NOT bypassed under
   *  trace — perception emits no rationale steps, so there is nothing a memo
   *  hit could swallow.  Null outside respond(). */
  perceiveMemo: Map<string, Sema> | null;
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
  /** DEPOSIT-path stable-prefix tree cache: content key (latin1) of a
   *  deposited input → its plain-fold level PYRAMID, so the NEXT deposit
   *  whose prefix it is (a conversation's accumulated context) reuses every
   *  full aligned block and refolds only the right edge of each level —
   *  O(turn) per deposit instead of O(context), with the tree BIT-IDENTICAL
   *  to a from-scratch fold (see FoldPyramid).  Purely a performance cache.
   *  Entry-count bounded (a pyramid is ~KB/byte of content; only the few
   *  live conversation chains matter). */
  _depositTrees: BoundedMap<string, FoldPyramid>;
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
/** Read a whole node's bytes. */
export declare const ALL = 2147483647;
/** Splice every chosen span in order — the whole cover as one byte string. */
export declare function spliceAll(segs: Seg[]): Uint8Array | null;
/** Lift the answer out of the cover for think: the recognised region, free of
 *  the asker's surrounding (unrecognised) framing. */
export declare function liftAnswer(
  segs: Seg[],
  queryLen: number,
): Uint8Array | null;
/** The CHANGED NODES of a freshly-perceived `tree` against the node ids a previous
 *  tracked deposit interned (`prevSeen`). */
export declare function changedNodes(
  tree: Sema,
  ids: Map<Sema, number>,
  prevSeen: Set<number>,
): Sema[];
