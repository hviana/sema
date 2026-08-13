import type { Hit } from "../store.js";
import type { MindContext } from "./types.js";
export interface Junction {
    /** The node whose learnt bytes evidence this junction (a container form,
     *  a continuation, or a context). */
    id: number;
    /** The bytes that belong between left and right. */
    interior: Uint8Array;
}
/** Which relaxation produced a {@link SynonymJunction}: one side replaced by
 *  a distributional halo sibling (`single-synonym`), or both (`double-
 *  synonym`) — the two remaining rungs of the graded ladder below exact DAG
 *  containment (see the module doc atop {@link junctionSynonyms}). */
export type SynonymJunctionTier = "single-synonym" | "double-synonym";
export interface SynonymJunction extends Junction {
    tier: SynonymJunctionTier;
    /** Sibling score for a single-synonym junction; min(left, right) sibling
     *  score for a double-synonym junction. */
    confidence: number;
}
/** The exact node ids and halo siblings resolved for one junction call's two
 *  sides — computed ONCE and reused by every ladder rung that needs them
 *  (junctionSynonyms' two tiers, and the structural-resonance tier beyond
 *  it).  A failed synonym junction means only "no common DAG container was
 *  proven" — it does NOT mean the loaded siblings stop being useful. */
export interface JunctionSynonymSides {
    leftId: number | null;
    rightId: number | null;
    leftSiblings: Hit[];
    rightSiblings: Hit[];
}
/** Resolve `left`/`right` to their exact node ids (when known) and load each
 *  resolved side's halo siblings once — deterministic (haloSiblings already
 *  ranks nearest-first) and shared by every ladder rung that consults
 *  siblings, so no ladder rung repeats a halo ANN query the previous one
 *  already paid for. */
export declare function loadJunctionSynonymSides(ctx: MindContext, left: Uint8Array, right: Uint8Array): Promise<JunctionSynonymSides>;
/** Seed node ids to ascend from for one side of a junction: the side's own
 *  node when it is a stored form, plus — when the node has no structural
 *  parents — its canonical window ids.  A non-W-aligned node may have no
 *  parents, but its constituent W-grams typically do; the window ids
 *  provide alternative ascent paths.  The `parentsFirst(…, 1)` probe is a
 *  single indexed lookup, far cheaper than computing every window id, so
 *  the window-id path is only taken when the node alone cannot ascend.
 *  Exported for callers (synonym junctions) that hold one side FIXED across
 *  several calls and so compute its seeds once instead of per call. */
export declare function junctionSeeds(ctx: MindContext, b: Uint8Array): number[];
/** Session cache of the identity walks' pure reads (capped bytes,
 *  parent pages, container pages), keyed by the write-invalidated structural
 *  lifecycle object. One response issues many walks whose ancestries overlap
 *  heavily (pair sides repeat across combos, and synonym walks revisit the
 *  same neighbourhoods); the store is read-only while a response is in flight,
 *  so every one of these reads is a pure function of the id — repeats cost a
 *  Map hit instead of a SQL statement or a byte reconstruction. */
export interface WalkCache {
    /** id → prefix bytes read so far + whether they are the COMPLETE bytes
     *  (shorter than the cap that read them). */
    reads: Map<number, {
        b: Uint8Array;
        complete: boolean;
    }>;
    parents: Map<number, number[]>;
    containers: Map<number, number[]>;
}
export declare function walkCache(ctx: MindContext): WalkCache | null;
export declare function invalidateJunctionCache(ctx: MindContext): void;
export declare function cachedRead(ctx: MindContext, cache: WalkCache | null, id: number, cap: number): Uint8Array;
/** Tier 1 body, parameterised on already-resolved seed lists so a caller
 *  holding one side FIXED across several calls (synonym junctions) pays for
 *  that side's seeds once, not once per call.  The byte-containment check
 *  below ensures only genuine containers are returned regardless of seeds.
 *
 *  BOUNDED at corpus scale by three disciplines (profiled on a 17.7M-node
 *  store, where the unbounded form spent >90% of a query's CPU here):
 *   • PHRASE-SCALE READS — a junction container is by contract a whole the
 *     pair nearly exhausts (glue from a period to a phrase), so every visit
 *     reads at most `maxContainer + 1` bytes (`bytesPrefix` stops early).
 *     A node whose bytes exceed the cap cannot be a junction container, and
 *     its ancestors are strictly larger — the branch is PRUNED, never
 *     reconstructing a corpus-sized deposit (an oasst2 conversation) just
 *     to reject it.
 *   • EXPANSION BUDGET — at most √N·W nodes are popped in total: a √N-wide
 *     frontier (the one fan-out convention) through the ~W structural
 *     levels that separate phrase-scale content from its containers
 *     (perception trees are W-ary, so a junction container lies within a
 *     few levels of its parts).  A side too common to decide within the
 *     budget abstains here and falls through to the resonance tier (the
 *     climb's own saturation semantics).
 *
 *     REFUTED TIGHTENING (measured, 325K contexts): giving this walk
 *     edgeAncestors' cumulative LATERAL-CONE limit — abstain once the
 *     accumulated lateral entries pass √N — would cut most of the pops (47
 *     of 56 walks exceed √N lateral, and 47 exhaust the budget), but TWO OF
 *     THE FOUR walks that actually found a container had lateral spread of
 *     1425 and 1426, far past √N.  The cone limit is sound for
 *     edgeAncestors' question and wrong for this one: a junction container
 *     is legitimately reached across many containing structures.  Half the
 *     successful junctions would be lost.
 *   • per-node hub guards — parent fan-outs beyond √N are hubs (not
 *     expanded); each node contributes at most one √N page of containers;
 *     √N collected candidates decide. */
export declare function junctionContainersFrom(ctx: MindContext, left: Uint8Array, right: Uint8Array, maxContainer: number, leftSeeds: number[], rightSeeds: number[], 
/** Shared expansion budget — a TIER's √N pops, not each walk's, when one
 *  tier issues several walks (synonym junctions try up to 2·haloQueryK
 *  siblings; without a shared budget each sibling would spend its own √N). */
budget?: {
    n: number;
}, 
/** ORDER-FREE containment: also accept containers holding right-then-left.
 *  A junction is evidence that the two forms were LEARNT TOGETHER; which
 *  one the query happened to mention first is a fact about the query, not
 *  about the learnt whole.  The walk is identical (the seed ascent does not
 *  depend on order) — only the byte-containment test gains a second probe,
 *  so order-freedom costs two indexOf calls per visited node, never a
 *  second walk. */
unordered?: boolean): Junction[];
/** Tier 1 entry point: every learnt whole that literally contains
 *  left-then-right, found by ascending the structural DAG (parents +
 *  containment links) from the two sides' content-addressed identities.
 *  Both sides' seeds resolved fresh, one call. */
export declare function junctionContainers(ctx: MindContext, left: Uint8Array, right: Uint8Array, maxContainer: number, unordered?: boolean): Junction[];
/** Tier 2.5: synonym junctions — the container ascent (tier 1) applied to
 *  halo siblings of left and right.  When a distributional synonym of one
 *  form participates in a learnt whole with the other form, the container
 *  between the synonym and the other side is valid evidence for the
 *  original pair.  The container evidence is exact (content-addressed DAG
 *  ascent, with window-id-enhanced seeds so non-W-aligned siblings still
 *  ascend); the relaxation is only in which form occupies one side — a
 *  distributional sibling rather than the exact form.
 *
 *  ONE expansion budget is shared by every sibling walk in this call, so
 *  cost is bounded at √N·W pops total regardless of how many siblings are
 *  tried.  A sibling whose bytes exceed `maxInterior` is skipped (it
 *  cannot be junction-sized). */
export declare function junctionSynonyms(ctx: MindContext, left: Uint8Array, right: Uint8Array, maxInterior: number, unordered?: boolean, sides?: JunctionSynonymSides, sharedBudget?: {
    n: number;
}): Promise<SynonymJunction[]>;
