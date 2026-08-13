import { Vec } from "../vec.js";
import type { AncestorReach, MindContext } from "./types.js";
/** The reach memo this ask should use — see the note above.
 *
 *  A TRACED response always gets a fresh, empty one.  `AncestorReach`'s
 *  `visited`/`maxDepth`/`saturation` fields are populated only when a trace
 *  is attached, so an entry deposited by an untraced earlier turn would
 *  silently black out the reach detail of a later traced one; and the trace's
 *  reach payload is serialised by ITERATING this map, which must therefore
 *  hold what THIS climb consulted, not the whole conversation's history.
 *  Consistent with AGENTS §2.11: a traced response is a different machine —
 *  never benchmark with a trace attached. */
export declare function sharedReachMemo(ctx: MindContext): Map<number, AncestorReach>;
/** Invalidate every session-lifetime structural read after a write. */
export declare function invalidateStructuralCaches(ctx: MindContext): void;
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
export declare function edgeAncestors(ctx: MindContext, id: number, contextCount: number, memo?: Map<number, AncestorReach>): AncestorReach;
/** Convenience: forward edges of a node. */
export declare function nextOf(ctx: MindContext, id: number): number[];
/** Convenience: reverse edges of a node. */
export declare function prevOf(ctx: MindContext, id: number): number[];
/** The uniform-expectation floor on a byte atom's corpus commonality: N
 *  learnt contexts, each at least one perception chunk of up to W of the 256
 *  possible byte values, contain a given atom in ≥ N·W/256 contexts on
 *  average.  An atom's TRUE containment is unmeasurable (atoms carry no
 *  kid/contain links by construction), so this floor is the honest stand-in:
 *  derived entirely from the corpus scale N, the perception window W, and
 *  the alphabet size — never tuned. */
export declare function atomReach(ctx: MindContext, contextCount: number): number;
/** Whether a byte atom is a hub at this corpus scale — its commonality floor
 *  {@link atomReach} exceeds the hub bound √N.  Below it (small stores) an
 *  atom votes and is recognised exactly as any stored form; above it the
 *  alphabet is scaffolding everywhere and abstains. */
export declare function atomIsHub(ctx: MindContext, contextCount: number): boolean;
/** Cached "does this node bear a continuation edge?" — the CHEAP half of
 *  {@link leadsSomewhere}, exported for hot paths that must PRE-FILTER a
 *  candidate before paying for a fold and cannot afford the halo tier.
 *
 *  `leadsSomewhere`'s second tier (`hasHalo`) is deliberately uncached — one
 *  indexed point probe per candidate, which is right where candidates are
 *  already few.  On recognition's off-boundary chain pass they are not few:
 *  using the full predicate there took haloProbes from 922 to 9,144 on a
 *  nine-query battery over the trained store.  The edge tier alone is memoised
 *  for the response, so it is ~free, and a node bearing an edge is exactly the
 *  "deposited whole, not an interned fragment" claim that pass needs.
 *
 *  Strictly NARROWER than `leadsSomewhere` — a halo-only node reads false — so
 *  it is sound as a pre-filter before a consumer that applies the full
 *  predicate, and never as a replacement for it. */
export declare function bearsEdge(ctx: MindContext, id: number): boolean;
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
export declare function reachOf(ctx: MindContext, id: number, contextCount: number, memo?: Map<number, AncestorReach>): number;
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
export declare function hubCap<T>(ctx: MindContext, ids: readonly T[]): readonly T[];
/** Whether `descendant` lies within `ancestor`'s subtree — a structural DAG
 *  relation read off the hash-consed `kids` lists, by a bounded explicit-stack
 *  descent.  Used by articulation to keep a voice from revoicing a fragment
 *  OF that voice. */
export declare function contains(ctx: MindContext, ancestor: number, descendant: number): boolean;
/** Whether a continuation edge joins the two forms, in either direction —
 *  the EXACT half's veto on calling them synonyms.
 *
 *  Halos measure company, and the strongest company any two forms can keep is
 *  standing next to each other: a question and its answer co-occur in every
 *  episode that taught the pair, so their halos SHOULD be similar, and on a
 *  conversational store they are (measured on the CONV fixture: consecutive
 *  turns at 0.809 against a 0.516 concept threshold).  A gate reading halo
 *  cosine alone therefore reads adjacency as synonymy and revoices an answer
 *  in the words of the question it answers — "it hangs in madrid" spliced back
 *  into "where is it kept now".  The distributional layer cannot tell the two
 *  relations apart, because to it they are the same observation; the exact
 *  half can, for free, because it stored the edge.  §4.1's division of labour
 *  exactly: approximate proposes, exact decides.
 *
 *  Read LIMITed in both directions at the hub bound — a common continuation's
 *  fan-in is corpus-sized, and no single decision may scale with it. */
export declare function answers(ctx: MindContext, a: number, b: number): boolean;
/** The best-scoring item by cosine against `query`, among items scoring at
 *  or above `threshold` — the shared arg-max every Pattern-A "which of these
 *  resonates best" decision reduces to.  `strict` picks the tie-break a
 *  caller needs: `true` keeps the first-seen leader on a tie (`>`), the
 *  default lets a later equal score take it (`>=`). */
export declare function argmaxBy<T>(items: Iterable<T>, scoreOf: (item: T) => number, threshold: number, strict?: boolean): {
    item: T;
    score: number;
} | null;
export declare function argmaxCosine<T>(query: Vec, items: Iterable<T>, vecOf: (item: T) => Vec | null | undefined, threshold: number, strict?: boolean): {
    item: T;
    score: number;
} | null;
/** The guided-or-first continuation of a node, as answer-shaped bytes source:
 *  chooseNext under the response guide, falling back to the FIRST-inserted
 *  edge — the one no-guide convention chooseNext, project() and the search's
 *  formRules all share.  undefined when the node has no continuation. */
export declare function guidedFirst(ctx: MindContext, id: number): number | undefined;
export declare function guidedNext(ctx: MindContext, node: number): number | undefined;
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
export declare function chooseNext(ctx: MindContext, id: number, guide?: Vec | null): number | undefined;
/** The perceived gist of a candidate node, through the session gist cache.
 *  Re-gisting a candidate is a full river fold of its bytes — the measured
 *  recall bottleneck (a hub context offers up to √N continuations, EACH
 *  re-perceived per pick).  A node's bytes are immutable and perception is
 *  pure, so the cached gist is valid for the store's lifetime.  Exported for
 *  every "score node ids against a guide" decision (chooseAmong here, the
 *  bridge's junction pick) so they share ONE cache and one convention. */
export declare function candidateGist(ctx: MindContext, c: number): Vec | null;
export declare function chooseAmong(ctx: MindContext, candidates: readonly number[], guide: Vec): {
    id: number;
    score: number;
};
/** True when NO window of `query` discriminates anything — every stored
 *  W-window it spells is contained by more places than the hub bound allows,
 *  i.e. the whole query is corpus-global scaffolding.
 *
 *  WHAT IT IS FOR.  Several mechanisms ground a query through the literal
 *  spans it did NOT explain, and those spans are the whole of their evidence.
 *  When every one of them is a hub, the query says nothing the corpus can be
 *  held to, and grounding it means picking one of thousands of continuations
 *  it gives no evidence for — a fabrication whatever the answer happens to be.
 *  Answering with silence there is the honest degradation contract (§2.13).
 *
 *  MEASURED SEPARATION (trained store, hubBound 571) — this is categorical,
 *  not marginal, and it is why the predicate lives here rather than being
 *  spelled twice:
 *    "What is the capital of"  ALL saturated ("What":572)  → fabricated
 *    "What is the capital "    ALL saturated ("What":572)  → fabricated
 *    "what is the capital of france"  min "f fr":248       → correct
 *    "What is the capitol of France?" min "f Fr":114       → correct
 *    "WHAT IS THE CAPITAL OF FRANCE?" min "HE C":1         → correct
 *    "What  is   the capital  of France?" min "t  i":4     → correct
 *    "Who wrote Romeo and Juliet?"    min "iet?":26        → correct
 *    "What is the capital of Zamunda?" min "Zamu":3        → silent anyway
 *  Note the last: the honest-silence probes are already refused on other
 *  evidence and sit on the SAME side as the correct ones, so this predicate
 *  is not what makes them silent and cannot be credited for them.
 *
 *  NO NEW THRESHOLD (§2.2): `hubBound` is the √N reading of "hub" used
 *  everywhere, and the containment read is clamped to it exactly as every
 *  other fan-out read is (§2.8).  A query with no stored window at all is NOT
 *  scaffolding-only — it has no evidence either way, and its callers already
 *  refuse it on their own terms. */
export declare function allWindowsAreScaffolding(ctx: MindContext, query: Uint8Array): boolean;
/** Trained forms the query may OPEN, proposed from the write side's own
 *  leaf-id window index — the supply of last resort for prefix completion.
 *
 *  WHY A SECOND SUPPLY EXISTS.  The ranked list prefix completion normally reads
 *  is a resonance list, and resonance cannot rank a proper prefix: measured on
 *  the trained store, cos(prefix, form) falls from 0.9629 at a one-byte
 *  truncation to 0.6206 at three bytes, against a reachThreshold of 0.8750.
 *  Three bytes of truncation put the answer out of reach on GEOMETRY, not on a
 *  bug, so no k and no re-ranking recovers it.
 *
 *  WHY THIS ROUTE WORKS WHERE THE FOLD DOES NOT.  A query's own fold is
 *  useless here: content addressing is not phrase-position-invariant, so a
 *  standalone prefix folds to a DIFFERENT node than the same bytes sitting
 *  inside a longer deposit, and neither the prefix's own node nor its
 *  ancestors lead to the deposit (measured: the 22-byte prefix of the
 *  photosynthesis form resolves, is shared by 6 contexts, and does not have
 *  the form among its ancestors).  Leaf ids ARE position-invariant — they are
 *  content-addressed on single bytes — and `indexSubSpans` already interns a
 *  flat branch over every canonical WINDOW of a deposit's leaf-id stream, with
 *  containment edges to the chunks that window spans.  A query that is a
 *  prefix therefore shares those window nodes exactly, and reaches the deposit
 *  by climbing containment then parents.  Nothing is added to the write side;
 *  this reads an index training already built.
 *
 *  BOUNDED (§2.8), AND WITH NO NEW THRESHOLD.  The window whose containment is
 *  SMALLEST carries the most evidence, and one saturated at `hubBound` carries
 *  none — that is the same √N reading of "hub" the rest of the mind uses, not
 *  a tuned knob.  The upward walk spends a budget of `hubBound` nodes and
 *  fans out by W, so a hub query enumerates nothing and the caller stays
 *  silent rather than guessing (§2.13).  Measured on the trained store: the
 *  photosynthesis form at a one-byte truncation picks a window with 52
 *  containers, visits 446 nodes, and yields exactly ONE candidate that
 *  survives the caller's byte compare — the form itself.
 *
 *  These are PROPOSALS only.  Every candidate still faces the byte-exact
 *  prefix compare and all three guards below, so a wrong proposal costs one
 *  bounded read and can never be voiced (§2.3). */
export declare function formsOpenedBy(ctx: MindContext, query: Uint8Array): number[];
