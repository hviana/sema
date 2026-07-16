import { Vec } from "../vec.js";
import type { AncestorReach, MindContext } from "./types.js";
/** Climb the structural DAG from a node to its edge-bearing ancestor contexts.
 *  Ascent stops at hub nodes (parents > √N) — their reach is non-discriminative.
 *  When the start node has no structural parents, climbs from containment parents
 *  (sub-span flat branches inheriting their chunks' context).
 *
 *  `memo`, when given, caches whole climbs by start id for the duration of ONE
 *  query (the store is read-only while a query is in flight, so a climb is a
 *  pure function of the id).  The consensus pipeline climbs the SAME anchors
 *  repeatedly — regions sharing a chunk, and canonicalChunkId probing each
 *  chunk's prefixes — so without the memo every repeat re-pays the full
 *  fan-out reads. */
export declare function edgeAncestors(
  ctx: MindContext,
  id: number,
  contextCount: number,
  memo?: Map<number, AncestorReach>,
): AncestorReach;
/** Convenience: forward edges of a node. */
export declare function nextOf(ctx: MindContext, id: number): number[];
/** Convenience: reverse edges of a node. */
export declare function prevOf(ctx: MindContext, id: number): number[];
/** Whether a node LEADS SOMEWHERE — it bears a continuation edge or a halo.
 *  The admission predicate recognition filters sites with (HOW_IT_WORKS
 *  §15.3): a form that leads nowhere contributes nothing to any derivation.
 *  Runs once per candidate span on the recognition hot path — `hasNext` is
 *  cached per response (the same flat-branch ids are probed across prefix
 *  variants by canonicalChunkId).  `hasHalo` is not cached: it's a single
 *  indexed point probe per candidate, and the candidates that reach this
 *  check have already been filtered by hasNext above in edgeAncestors. */
export declare function leadsSomewhere(ctx: MindContext, id: number): boolean;
/** The structural IDF read of ONE node: how many distinct learnt contexts
 *  its containment/edge climb reaches, or Infinity when it reaches none or
 *  saturates (no usable identity evidence).  The number every
 *  discriminative-vs-scaffolding decision derives from — paired with the
 *  half-dominance convention (geometry.dominates(reach, N)): content
 *  reaching a corpus MINORITY of contexts discriminates (an entity, a
 *  filler); content reaching a majority is frame scaffolding. */
export declare function reachOf(
  ctx: MindContext,
  id: number,
  contextCount: number,
  memo?: Map<number, AncestorReach>,
): number;
/** The corpus scale N — the count of DISTINCT learnt contexts, floored at 2
 *  so its derived readings (ln N in the consensus floor, √N in the hub bound)
 *  stay meaningful on a near-empty store.  The one definition every consumer
 *  of "how big is this corpus?" reads. */
export declare function corpusN(ctx: MindContext): number;
/** The hub bound √N itself (≥ 2 always, since N is floored at 2) — for
 *  consumers that pass it to the store's LIMITed reads instead of capping a
 *  materialised list.  {@link hubCap} is the list-side reading of the same
 *  convention. */
export declare function hubBound(ctx: MindContext): number;
/** Cap a candidate list at the hub bound √N (insertion order) — the ONE
 *  fan-out convention every walk and disambiguation uses (see HOW_IT_WORKS
 *  §8.6).  A node connected to more than √N others is a hub whose individual
 *  connections carry ~no discriminative information; materialising or scoring
 *  them all would make single decisions scale with the corpus. */
export declare function hubCap<T>(
  ctx: MindContext,
  ids: readonly T[],
): readonly T[];
/** Whether `descendant` lies within `ancestor`'s subtree — a structural DAG
 *  relation read off the hash-consed `kids` lists, by a bounded explicit-stack
 *  descent.  Used by articulation to keep a voice from revoicing a fragment
 *  OF that voice. */
export declare function contains(
  ctx: MindContext,
  ancestor: number,
  descendant: number,
): boolean;
/** The best-scoring item by cosine against `query`, among items scoring at
 *  or above `threshold` — the shared arg-max every Pattern-A "which of these
 *  resonates best" decision reduces to.  `strict` picks the tie-break a
 *  caller needs: `true` keeps the first-seen leader on a tie (`>`), the
 *  default lets a later equal score take it (`>=`). */
export declare function argmaxBy<T>(
  items: Iterable<T>,
  scoreOf: (item: T) => number,
  threshold: number,
  strict?: boolean,
): {
  item: T;
  score: number;
} | null;
export declare function argmaxCosine<T>(
  query: Vec,
  items: Iterable<T>,
  vecOf: (item: T) => Vec | null | undefined,
  threshold: number,
  strict?: boolean,
): {
  item: T;
  score: number;
} | null;
/** The guided-or-first continuation of a node, as answer-shaped bytes source:
 *  chooseNext under the response guide, falling back to the FIRST-inserted
 *  edge — the one no-guide convention chooseNext, project() and the search's
 *  formRules all share.  undefined when the node has no continuation. */
export declare function guidedFirst(
  ctx: MindContext,
  id: number,
): number | undefined;
export declare function guidedNext(
  ctx: MindContext,
  node: number,
): number | undefined;
/** Disambiguate among a node's learnt continuations by distributional
 *  support.  NOTE the `guide` contract: its VALUE is deliberately unused —
 *  only its PRESENCE gates disambiguation (a null guide means no query is in
 *  flight, so structural walkers keep plain first-edge behaviour).  The
 *  gist-cosine of short answer candidates against a query guide is dominated
 *  by accidental byte-pattern correlations, not semantic relatedness, so the
 *  evidence consulted is structural: each candidate's reverse-edge support
 *  count (see below).  Contrast {@link chooseAmong}, the REVERSE-direction
 *  disambiguator, whose candidates are whole learnt contexts — long enough
 *  that their perceived gists ARE semantically meaningful — and which
 *  therefore scores by guide cosine.  The two directions consult different
 *  halves of the evidence on purpose. */
export declare function chooseNext(
  ctx: MindContext,
  id: number,
  guide?: Vec | null,
): number | undefined;
/** The perceived gist of a candidate node, through the session gist cache.
 *  Re-gisting a candidate is a full river fold of its bytes — the measured
 *  recall bottleneck (a hub context offers up to √N continuations, EACH
 *  re-perceived per pick).  A node's bytes are immutable and perception is
 *  pure, so the cached gist is valid for the store's lifetime.  Exported for
 *  every "score node ids against a guide" decision (chooseAmong here, the
 *  bridge's junction pick) so they share ONE cache and one convention. */
export declare function candidateGist(ctx: MindContext, c: number): Vec | null;
export declare function chooseAmong(
  ctx: MindContext,
  candidates: readonly number[],
  guide: Vec,
): {
  id: number;
  score: number;
};
