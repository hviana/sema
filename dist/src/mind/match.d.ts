import { Vec } from "../vec.js";
import type { Hit } from "../store.js";
import type { MindContext } from "./types.js";
import type { Site } from "./graph-search.js";
/** The graded LOCATE ladder: find `needle` in `haystack` starting at
 *  `fromPos`, strictest matcher first, relaxing only when the stricter one
 *  fails.  This is the read-out matcher skill extraction locates exemplar
 *  frames with.
 *
 *  1. exact    — literal byte match (the fast path).
 *  2. halo     — the needle's distributional role matches a recognised query
 *                form (gate: conceptThreshold).
 *  3. gist     — the needle's perceived gist matches a query segment
 *                (gate: identityBar — scale-aware).
 *
 *  Returns the absolute byte position, or −1. */
export declare function locate(ctx: MindContext, haystack: Uint8Array, needle: Uint8Array, fromPos: number, sites?: ReadonlyArray<Site>): number;
/** The ALIGNED matcher: maximal literal matching runs between `query` and
 *  `ct` (a learned context's bytes), by seed-and-extend over
 *  `space.maxGroup`-sized n-gram seeds.  Where locate() finds ONE position of
 *  a short frame, this finds EVERY run two whole structures share — the
 *  matcher CAST detects a woven query with.  Returns non-overlapping runs
 *  sorted by query position. */
export declare function alignRuns(ctx: MindContext, query: Uint8Array, ct: Uint8Array): Array<{
    qs: number;
    qe: number;
    cs: number;
}>;
/** A run from {@link alignGraded} — the ALIGNED matcher extended with the
 *  same graded-evidence ladder as {@link locate}.  Literal runs carry
 *  `weight = 1` (exact match is full evidence); halo-matched site runs carry
 *  `weight = cosine` (measured evidence — the halo similarity itself).
 *  `cs` is the structural byte position in the context regardless of run
 *  kind, so the substitution/redirection schemas work unchanged on conceptual
 *  alignment. */
export interface GradedRun {
    qs: number;
    qe: number;
    cs: number;
    weight: number;
}
/** The GRADED alignment matcher: extends literal W-gram alignment
 *  ({@link alignRuns}) with halo-matched recognised sites in query regions
 *  that have no literal coverage.  Same ladder as {@link locate}: literal
 *  first, then distributional role (halo-matched sites, gate:
 *  conceptThreshold, enforced by {@link bestHaloMate}).  Returns weighted
 *  runs sorted by query position.
 *
 *  `querySites` are the pre-computed recognition sites for the query
 *  (optional — when absent, only literal alignment fires and graded degrades
 *  to the original behaviour).  Context sites are recognised internally. */
export declare function alignGraded(ctx: MindContext, query: Uint8Array, contextBytes: Uint8Array, querySites?: ReadonlyArray<Site>): GradedRun[];
/** The IN-LIST halo matcher: the best halo-mate for `halo` among EXPLICIT
 *  candidates, above the concept threshold — the list counterpart of
 *  {@link haloSiblings}, which asks the halo INDEX for candidates instead.
 *  Behind locate()'s halo step and articulation's voice matching; a third
 *  "best halo among these" decision must come here, not inline. */
export declare function bestHaloMate<T>(ctx: MindContext, halo: Vec, items: Iterable<T>, haloOf: (item: T) => Vec | null | undefined): {
    item: T;
    score: number;
} | null;
export declare function haloSiblings(ctx: MindContext, id: number, halo?: Vec | null, bar?: number): Promise<Hit[]>;
/** The DISTRIBUTIONAL matcher between two nodes: mutual-nearest-neighbour
 *  strength, not a pick.  Returns the direct halo cosine, or failing that the
 *  highest mutual-halo-sibling min-score (second-order analogy), or failing
 *  that the SHARED-FRAME strength (below) — the gate CAST's comparison
 *  schema validates genuine analogs with (bar: significanceBar). */
export declare function analogyStrength(ctx: MindContext, a: number, b: number): Promise<number>;
/** The STRUCTURAL analogy tier: two nodes are analogs when their byte
 *  streams share a LEARNT frame — a content-addressed flat form of at least
 *  one full river window (W bytes, the perception quantum) that occurs in
 *  BOTH.  This is what "playing the same role" means structurally: "Ice is
 *  cold" and "Steel is hard" share the learnt " is " frame even though they
 *  keep disjoint distributional company.  Halos measure company by IDENTITY
 *  (company signatures — see sema.ts), so unrelated-company analogs must be
 *  validated by the frame itself, not by content leaking through halo
 *  vectors.  Strength is the shared learnt coverage of the SHORTER side —
 *  a fraction, comparable to the cosine tiers above.  Derived: the window
 *  is maxGroup, the same quantum differsByOneWindow and canonicalChunkId
 *  measure by; no tuned constants. */
export declare function sharedFrameStrength(ctx: MindContext, a: number, b: number): number;
/** FORWARD through a synonym: the continuation an edge-less node borrows from
 *  a concept (halo) sibling — resonate the node's halo, take the first
 *  sibling above the concept threshold that itself has a direct edge. */
export declare function conceptHop(ctx: MindContext, id: number): Promise<number | null>;
/** FORWARD projection: follow continuation edges from a node to its fixpoint.
 *  The first hop may cross a concept (halo) link — a synonym.  The rest
 *  follow direct edges.  Convergence is intrinsic: the seen set guards
 *  against cycles.  `guide` disambiguates multi-continuation nodes by
 *  resonance. */
export declare function follow(ctx: MindContext, id: number, guide?: Vec | null): Promise<Uint8Array | null>;
/** REVERSE projection: the context a learnt continuation follows, voiced as
 *  bytes.  A common continuation ("Yes.") follows MANY contexts; with a
 *  `guide` the context whose gist resonates with the query wins (seat
 *  symmetry) — without one, the most-corroborated context wins (poured halo
 *  MASS, the direct measure of how many episodes established it), falling
 *  back to first-learnt on equal mass.  Callers that HAVE a query gist must
 *  pass it, or they silently change disambiguation regime.
 *
 *  `rev`, when the caller has already materialised prevOf (one read per
 *  relation — a hub's reverse fan-in is corpus-sized), is reused instead of
 *  refetched.  Returns null when there is no predecessor or the picked
 *  context reads empty (a zero-length context is no grounding: an empty
 *  Uint8Array is truthy, and returning it would flow a hollow "answer"
 *  onward). */
export declare function reverseContext(ctx: MindContext, id: number, guide?: Vec | null, rev?: readonly number[]): Uint8Array | null;
/** THE projection: ground a matched node to answer bytes — FORWARD to its
 *  continuation fixpoint (which may cross a concept hop), else REVERSE to
 *  the context it follows.  This is the direction ladder every mechanism's
 *  final grounding step reduces to. */
export declare function project(ctx: MindContext, id: number, guide?: Vec | null): Promise<Uint8Array | null>;
