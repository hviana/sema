// attention.ts — Consensus climb / attention pipeline (Section 4 of the mind).
//
// Every region of the query's perceived tree casts a resonance vote for the
// context (learnt fact) it best climbs to.  Votes are pooled through the very
// deduction engine (lightestDerivation) that GraphSearch covers with — so a
// pooled-evidence decision is one weighted rule of the SAME deduction system,
// not a hand-rolled tally.  The result is one or more independent points of
// attention for the rest of the pipeline to follow.

import { isChunk } from "../sema.js";
import type { Hit } from "../store.js";
import {
  type DeductionSystem,
  lightestDerivation,
  type PooledConclusion,
} from "../derive/src/index.js";
import type { DerivationItem, DerivationStep } from "./graph-search.js";
import type {
  AItem,
  AncestorReach,
  Attention,
  AttentionRead,
  DFMode,
  MindContext,
  Region,
  RegionVote,
  SaturationInfo,
  SaturationStop,
} from "./types.js";
import {
  composeStructuralGist,
  consensusFloor,
  dominates,
  estimatorNoise,
  type StructuralPart,
} from "../geometry.js";
import { foldTree, gistOf, latin1Key, perceive, read } from "./primitives.js";
import { recognise } from "./recognition.js";
import { leafIdRun } from "./canonical.js";
import { corpusN, edgeAncestors, hubBound } from "./traverse.js";
import {
  cachedRead,
  type Junction,
  junctionContainersFrom,
  junctionSeeds,
  junctionSynonyms,
  type JunctionSynonymSides,
  loadJunctionSynonymSides,
  type SynonymJunction,
  walkCache,
} from "./junction.js";
import type { Vec } from "../vec.js";
import { indexOf } from "../bytes.js";
import type { RationaleItem } from "./rationale.js";
import { rDeriv, rItem, rNode, traceDerivation } from "./trace.js";

// ═══════════════════════════════════════════════════════════════════════════
// climbConsensus / inspectRationale instrumentation.
//
// Purely additive tracing over the consensus climb: it never changes an
// inference result or the human-readable rationale text traceAttention
// already produces (see below) — it only exposes, as one structured `data`
// payload on the SAME "climbConsensus" step, the machinery that produced
// that text: every structural saturation stop, candidate breadth versus
// evidence that actually contributed, and the decisions that removed or
// accepted evidence (§ objective of the instrumentation spec).
//
// The mutable collection buffers (the `TraceDraft` below) are allocated ONLY
// when `ctx.trace` is set — every call site that would otherwise push onto
// one of these arrays or sets is gated by `td?.` / `if (td)`, so a plain
// (untraced) climb pays exactly zero allocation for this instrumentation.
// ═══════════════════════════════════════════════════════════════════════════

/** How the newly-added graded junction ladder (junction.ts / attention.ts's
 *  {@link CrossRegionTier}) is reported on a `junctionVotes` entry.  The
 *  instrumentation spec this implements predates that ladder and only knew
 *  two tiers ("exact" | "synonym"); with the richer `CrossRegionTier` now
 *  the real shape of a junction vote's provenance, `junctionVotes[].tier`
 *  reports it DIRECTLY (the tier as-is: "exact" | "single-synonym" |
 *  "double-synonym" | "structural-resonance") rather than collapsing every
 *  non-exact tier into a lossy "synonym" bucket — the whole point of
 *  exposing `tier` here is to let a debugger tell a halo-sibling
 *  substitution apart from a structural-resonance ANN guess, which the
 *  spec's original two-value type cannot do. */
export type ClimbConsensusJunctionTier = CrossRegionTier;

export type RegionOutcome =
  | "voted"
  | "no-ann-hit"
  | "no-structural-reach"
  | "saturated-abstention"
  | "nonpositive-df-weight"
  | "contrastive-margin-rejection";

/** The best DIFFERENT-conclusion rival the contrastive-margin gate found
 *  while scanning an ordinary (approximate) region's ANN hits — spec §1.
 *  Its roots/saturation/contextsReached are already available through
 *  `reaches` (serialiseReaches) for `node`; not duplicated here. */
export interface ConsensusContrastiveRivalTrace {
  node: number;
  rank: number;
  score: number;
}

export interface ConsensusRegionTrace {
  index: number;
  source: "perceived" | "recognised";
  span: [number, number];
  chunk: boolean;
  known: boolean;

  canonicalId?: number;
  canonicalUsable: boolean;
  canonicalFailed: boolean;

  annQueried: boolean;
  annHitsReturned: number;
  annHitsExamined: number;

  selected?: {
    source: "canonical" | "ann";
    node: number;
    rank?: number;
    score: number;
    fallback?: "orphan" | "saturated-tie";
  };

  reachNode?: number;
  outcome: RegionOutcome;

  idf?: number;
  dfWeight?: number;

  contrastiveMargin?: number;
  contrastiveNoiseFloor?: number;
  contrastiveRival?: ConsensusContrastiveRivalTrace;

  mutualWeight?: number;
  voteWeightPerRoot?: number;
  focusWeightPerRoot?: number;

  ordinaryVoteProduced: boolean;
  superseded: boolean;
}

export interface ConsensusReachTrace {
  node: number;
  roots: number[];
  contextsReached: number;
  saturated: boolean;
  saturation?: SaturationStop;
}

export type AnchorRejectionReason =
  | "below-natural-break"
  | "below-consensus-floor"
  | "leading-saturation";

export interface ConsensusAnchorTrace {
  anchor: number;
  rank: number;

  pooledVote: number;
  idfVote: number;

  candidateBreadth: number;
  contributingVotes: number;
  contributingEvidence: number;
  breadth: number;
  contributingSpans: Array<[number, number]>;
  clusters: number;

  commit: {
    status: "root" | "overlap" | "rejected";
    dominant: boolean;
    passesNaturalBreak?: boolean;
    passesConsensusFloor?: boolean;
    pastLeadingSaturation?: boolean;
    rejectionReasons: AnchorRejectionReason[];
  };
}

export interface JunctionVoteTrace {
  container: number;
  span: [number, number];
  roots: number[];
  sourceRegionIndices: number[];
  explainedAwayRegionIndices: number[];
  absorbed: number;
  tier?: ClimbConsensusJunctionTier;

  /** Zero-based index into `crossRegion.probes` — the probe this vote was
   *  produced from (spec §8). */
  probe: number;
  confidence: number;
  /** "Evidence bytes" — the container-coverage byte count (the existing
   *  `bestCov` variable at the push site). */
  evidenceBytes: number;
  mutualWeight: number;
  voteWeightPerRoot: number;
}

/** Whether one DAG/synonym tier attempt was even made for a probe, and how
 *  many candidate containers it returned — spec §2/§3. */
export interface CrossRegionTierAttemptTrace {
  attempted: boolean;
  candidatesReturned: number;
}

/** Aggregate outcome of the container-selection loop for a DAG/synonym tier
 *  that returned at least one container — spec §4.  Only aggregate counts
 *  and the final outcome are recorded, never every candidate. */
export interface CrossRegionStructuralTrace {
  tier: "exact" | "single-synonym" | "double-synonym";
  selfEvidenceRejected: number;
  contradictionRejected: number;
  passedGuards: number;
  selectedNode?: number;
  outcome:
    | "all-rejected"
    | "saturated"
    | "no-roots"
    | "nonpositive-idf"
    | "accepted";
}

/** One retained structural-resonance variant that actually issued its own
 *  ANN query — spec §5. */
export interface StructuralResonanceVariantTrace {
  kind: StructuralVariant["kind"];
  semanticConfidence: number;
  leftSiblingId?: number;
  rightSiblingId?: number;
  annHitsReturned: number;
}

/** One merged structural-resonance proposal actually examined via
 *  edgeAncestors — spec §5.  Retains node/variant/scores, but NOT
 *  roots/saturation/contextsReached/idf (already in `reaches`). */
export interface StructuralResonanceCandidateTrace {
  node: number;
  variant: StructuralVariant["kind"];
  leftSiblingId?: number;
  rightSiblingId?: number;
  annScore: number;
  semanticConfidence: number;
  effectiveScore: number;
  outcome:
    | "saturated"
    | "no-roots"
    | "nonpositive-idf"
    | "same-as-endpoint"
    | "same-as-selected"
    | "selected"
    | "contrastive-rival";
}

export interface StructuralResonanceTrace {
  variantBudget: number;
  variants: StructuralResonanceVariantTrace[];
  mergedProposals: number;
  examined: StructuralResonanceCandidateTrace[];
  contrastiveMargin?: number;
  noiseFloor: number;
  outcome:
    | "ineligible"
    | "empty"
    | "no-valid-proposal"
    | "margin-rejected"
    | "accepted";
  ineligibleReasons?: Array<
    "between-region" | "not-both-strong" | "not-both-known" | "gap-too-large"
  >;
}

/** One cross-region pair the ladder actually probed — spec §2.  Exactly one
 *  of these is pushed per pair that incremented `probes`. */
export interface CrossRegionProbeTrace {
  leftRegionIndex: number;
  rightRegionIndex: number;
  betweenRegionIndices: number[];
  exact: CrossRegionTierAttemptTrace;
  singleSynonym: CrossRegionTierAttemptTrace;
  doubleSynonym: CrossRegionTierAttemptTrace;
  structural?: CrossRegionStructuralTrace;
  resonance?: StructuralResonanceTrace;
  outcome:
    | "accepted"
    | "structural-rejected"
    | "resonance-ineligible"
    | "resonance-rejected";
}

export interface ClimbConsensusData {
  version: 1;

  cache: {
    hit: boolean;
    detailAvailable: boolean;
  };

  config: {
    annK: number;
    crossRegionProbeLimit: number;
    mode: DFMode;
    corpusN?: number;
    dimension?: number;
    hubBound?: number;
    estimatorNoise?: number;
    naturalBreak?: number;
    consensusFloor?: number;
  };

  candidates: {
    perceived: number;
    recognised: number;
    total: number;
  };

  regions?: ConsensusRegionTrace[];
  reaches?: ConsensusReachTrace[];

  crossRegion?: {
    eligibleRegions: number;
    maximalRegions: number;
    probeLimit: number;
    probesAttempted: number;
    junctionVotes: JunctionVoteTrace[];
    supersededOrdinaryVotes: number;
    probes: CrossRegionProbeTrace[];
    stopReason: "insufficient-regions" | "probe-limit" | "pairs-exhausted";
  };

  saturation?: {
    regionIntervals: Array<{ start: number; end: number }>;
    hasLeading: boolean;
    leadingEnd: number;
  };

  pooling?: {
    inputVotes: number;
    eligibleVotes: number;
    saturationMaskedVotes: number;
  };

  anchors?: ConsensusAnchorTrace[];

  result: AttentionRead;
}

/** The mutable collection buffers threaded through one traced consensus
 *  climb — allocated exactly once, in {@link computeAttention}, only when
 *  `ctx.trace` is set.  Every field mirrors a `ClimbConsensusData` array/map,
 *  built incrementally as the pipeline runs so commit-time decisions (in
 *  particular) are recorded LIVE, not reconstructed afterward. */
interface TraceDraft {
  perceivedCount: number;
  regions: ConsensusRegionTrace[];
  crossRegionJunctionVotes: JunctionVoteTrace[];
  crossRegionSummary?: {
    eligibleRegions: number;
    maximalRegions: number;
    probeLimit: number;
    probesAttempted: number;
    stopReason?: "insufficient-regions" | "probe-limit" | "pairs-exhausted";
  };
  crossRegionProbes: CrossRegionProbeTrace[];
  supersededOrdinaryVotes: number;
  saturation?: {
    regionIntervals: Array<{ start: number; end: number }>;
    hasLeading: boolean;
    leadingEnd: number;
  };
  pooling?: {
    inputVotes: number;
    eligibleVotes: number;
    saturationMaskedVotes: number;
  };
  anchors: ConsensusAnchorTrace[];
}

/** The config/corpus context {@link traceAttention} needs to fill in
 *  `ClimbConsensusData.config` and `.result` at whichever exit fires —
 *  threaded down from {@link computeAttention} rather than re-derived, so
 *  every emission point reports the SAME numbers the real climb used. */
interface ClimbConsensusCfg {
  k: number;
  mode: DFMode;
  perceivedCount: number;
  totalRegions: number;
  N?: number;
  reachMemo?: ReadonlyMap<number, AncestorReach>;
  naturalBreak?: number;
  consensusFloor?: number;
}

function newTraceDraft(perceivedCount: number): TraceDraft {
  return {
    perceivedCount,
    regions: [],
    crossRegionJunctionVotes: [],
    crossRegionProbes: [],
    supersededOrdinaryVotes: 0,
    anchors: [],
  };
}

/** Serialise the shared `reachMemo` into the plain, authoritative saturation
 *  profile (spec §5) — every distinct node any tier's `edgeAncestors` call
 *  climbed from during this response, in insertion (first-consulted) order. */
function serialiseReaches(
  reachMemo: ReadonlyMap<number, AncestorReach>,
): ConsensusReachTrace[] {
  const out: ConsensusReachTrace[] = [];
  for (const [node, r] of reachMemo) {
    out.push({
      node,
      roots: [...r.roots],
      contextsReached: r.contextsReached,
      saturated: r.saturated,
      ...(r.saturation ? { saturation: r.saturation } : {}),
    });
  }
  return out;
}

// ── Public entry points ───────────────────────────────────────────────────

/** Climb the query's perceived byte regions up the structural DAG via
 *  resonance, pool the evidence, and return only the ROOT points of
 *  attention — those that cleared commitVotes' significance floor. */
export async function climbAttention(
  ctx: MindContext,
  query: Uint8Array,
  k: number,
  mode: DFMode = "inverse",
): Promise<Attention[]> {
  return (await climbAttentionAll(ctx, query, k, mode)).roots;
}

/** Full read-out of one consensus climb: both the roots (dominant points of
 *  attention) and the entire ranked list.  Cached via ctx.climbMemo, ALWAYS —
 *  see {@link recognise} for why this memo (and recognise()'s own) must
 *  never be skipped while tracing: computeAttention's collectRegions walks
 *  the query's perceived tree via the same foldTree whose subtree-resolution
 *  fast path makes a second call on identical bytes non-idempotent once
 *  ctx._resolvedSubtrees is warm (which a multi-turn conversation's shared
 *  prefix subtrees guarantee by the second turn).  A cache hit still emits
 *  a trace step — abbreviated, since the full per-sub-region voting detail
 *  {@link traceAttention} builds isn't preserved by the cached read-out —
 *  so a traced response is never silently blacked out for a repeated
 *  query. */
export async function climbAttentionAll(
  ctx: MindContext,
  query: Uint8Array,
  k: number,
  mode: DFMode = "inverse",
): Promise<AttentionRead> {
  // Content-keyed memo — works for both single-turn respond() and multi-turn
  // respondTurn().
  if (ctx.climbMemo) {
    const contentKey = latin1Key(query);
    const modeKey = `${k}:${mode}`;
    let byRead = ctx.climbMemo.get(contentKey);
    if (byRead === undefined) {
      ctx.climbMemo.set(contentKey, byRead = new Map());
    }
    const hit = byRead.get(modeKey);
    if (hit !== undefined) {
      // Cache-hit exit (spec §9): the abbreviated payload shape — only what
      // is actually stored in the cached AttentionRead is reported.  No
      // candidate, reach, saturation, pooling or anchor detail is fabricated
      // (that per-region detail was never retained by the memo).
      const data: ClimbConsensusData | undefined = ctx.trace
        ? {
          version: 1,
          cache: { hit: true, detailAvailable: false },
          config: { annK: k, crossRegionProbeLimit: k, mode },
          candidates: { perceived: 0, recognised: 0, total: 0 },
          result: hit,
        }
        : undefined;
      ctx.trace?.step(
        "climbConsensus",
        [rItem(query, "query")],
        hit.roots.map((r) => rNode(ctx, r.anchor, "anchor", r.vote)),
        `(cached) consensus already computed for this query — ` +
          `${hit.roots.length} point(s) of attention`,
        undefined,
        data,
      );
      return hit;
    }
    const read = await computeAttention(ctx, query, k, mode);
    byRead.set(modeKey, read);
    return read;
  }
  return computeAttention(ctx, query, k, mode);
}

// ── Pipeline ──────────────────────────────────────────────────────────────

export async function computeAttention(
  ctx: MindContext,
  query: Uint8Array,
  k: number,
  mode: DFMode,
): Promise<AttentionRead> {
  const regions = collectRegions(ctx, query);
  const perceivedCount = regions.length;

  // Recognised sites carry structural evidence that perceived sub-regions
  // miss: a word crossing a W-boundary is split into chunks whose partial
  // gists may not resonate distinctively, but the SITE (content-addressed,
  // exact) names the whole form.  Adding sites as climb regions lets the
  // consensus vote with the full word, at zero cost — recognition is already
  // memoised per response (ctx.recogniseMemo), and gistOf for short sites is
  // O(|span|·D).  Sites that overlap perceived regions add corroborating
  // evidence; sites in gaps (like cross-boundary words) fill them.
  const rec = recognise(ctx, query);
  for (const s of rec.sites) {
    regions.push({
      v: gistOf(ctx, query.subarray(s.start, s.end)),
      start: s.start,
      end: s.end,
      chunk: false,
      known: true, // a recognised site IS a stored form
    });
  }

  // The trace draft (spec §9): allocated ONLY when a trace was requested —
  // every downstream consumer gates its own writes on `td?` / `if (td)`, so
  // an untraced climb pays zero allocation for this instrumentation.
  const td: TraceDraft | undefined = ctx.trace
    ? newTraceDraft(perceivedCount)
    : undefined;
  const cfg0: ClimbConsensusCfg = {
    k,
    mode,
    perceivedCount,
    totalRegions: regions.length,
  };

  if (regions.length === 0) {
    traceAttention(ctx, [], [], [], undefined, td, cfg0);
    return { roots: [], ranked: [] };
  }

  const N = corpusN(ctx);
  // One climb per distinct anchor for the WHOLE query: regions sharing a
  // chunk, and canonicalChunkId's prefix probes, all hit this memo instead of
  // re-reading the anchor's full edge fan-out from the store.
  const reachMemo = new Map<number, AncestorReach>();
  const rvs = await voteRegions(ctx, query, regions, k, mode, N, reachMemo, td);

  // ── Cross-region: DIRECT region-to-region interaction ─────────────────
  // Two regions whose individual climbs land on DIFFERENT contexts leave
  // their JOINT context — the learnt whole that contains BOTH — with no
  // vote.  crossRegionVotes recovers it by the bridge's content-addressed
  // junction ascent (see the note above the function).
  const cross = await crossRegionVotes(
    ctx,
    query,
    regions,
    rvs,
    k,
    N,
    reachMemo,
    td,
  );
  // A vote SUPERSEDED by exact joint evidence (its bytes literally live
  // inside the joint container, yet it climbed elsewhere — grid aliasing)
  // is dropped, not down-weighted: the joint container explains it away.
  const allVotes = cross.votes.length > 0
    ? [
      ...rvs.votes.filter((v) => !cross.superseded.has(v)),
      ...cross.votes,
    ]
    : rvs.votes;
  // Mark, on the per-region trace, the source region of every superseded
  // ordinary vote (spec §4's final rule) — an explicit pass over the exact
  // set crossRegionVotes' explaining-away logic removed, never inferred
  // from `absorbed`.
  if (td && cross.superseded.size > 0) {
    for (const rv of cross.superseded) {
      const region = td.regions.find(
        (r) => r.span[0] === rv.start && r.span[1] === rv.end,
      );
      if (region) region.superseded = true;
    }
  }
  // ──────────────────────────────────────────────────────────────────────

  const cfg: ClimbConsensusCfg = { ...cfg0, N, reachMemo };

  if (allVotes.length === 0) {
    traceAttention(ctx, regions, rvs.voters, [], undefined, td, cfg);
    return { roots: [], ranked: [] };
  }

  const sat = detectSaturated(ctx, regions, rvs.saturated);
  if (td) {
    td.saturation = {
      regionIntervals: sat.intervals.map((iv) => ({ ...iv })),
      hasLeading: sat.hasLeading,
      leadingEnd: sat.leadingEnd,
    };
  }
  const pooled = poolVotes(ctx, allVotes, sat, N, td);
  return commitVotes(ctx, pooled, sat, regions, rvs.voters, N, td, cfg);
}

export function collectRegions(ctx: MindContext, query: Uint8Array): Region[] {
  const regions: Region[] = [];
  // A region that DOMINATES the query (covers more than half — the shared
  // {@link dominates} test liftAnswer uses for a span that swallows its
  // surroundings) can never itself discriminate between several topics the
  // query weaves; voting with it only when it is the sole structure (no
  // narrower region exists) keeps a flat/short query's single point of
  // attention intact without letting a broad, non-discriminative wrapper
  // dilute a multi-topic query's vote or masquerade as a genuine second
  // point of attention.
  // foldTree (not walkTree): the same post-order walk, but each node also
  // resolves content-addressed against the store — `known` is what lets the
  // climb keep exact evidence at full weight while margin-damping the
  // approximate kind (see voteRegions).  One findLeaf/findBranch per tree
  // node, the same lookups a deposit pays.
  foldTree(ctx, perceive(ctx, query), 0, (n, start, end, node) => {
    if (n.kids === null) return;
    if (!dominates(end - start, query.length) || regions.length === 0) {
      regions.push({
        v: n.v,
        start,
        end,
        chunk: isChunk(n),
        known: node !== null,
      });
    }
  });
  return regions;
}

export async function voteRegions(
  ctx: MindContext,
  query: Uint8Array,
  regions: readonly Region[],
  k: number,
  mode: DFMode,
  N: number,
  reachMemo?: Map<number, AncestorReach>,
  td?: TraceDraft,
): Promise<{
  votes: RegionVote[];
  saturated: boolean[];
  voters: Array<{ id: number; score: number; w: number } | null>;
}> {
  const regionSaturated: boolean[] = new Array(regions.length).fill(false);
  const regionVotes: RegionVote[] = [];
  const regionVoter: Array<{ id: number; score: number; w: number } | null> =
    ctx.trace ? regions.map(() => null) : [];

  for (let ri = 0; ri < regions.length; ri++) {
    const { v, start, end, chunk, known } = regions[ri];
    // Trace-only bookkeeping for this region — allocated only under `td`
    // (i.e. only when ctx.trace is set); see ConsensusRegionTrace/
    // RegionOutcome (spec §4).  `examinedIds` tracks distinct ANN hits
    // whose edgeAncestors reach was actually CONSULTED here (not merely
    // returned by resonate) — the fallback/margin loops below add to it.
    const examinedIds = td ? new Set<number>() : undefined;
    let annQueried = false;
    let fallbackKind: "orphan" | "saturated-tie" | undefined;
    const recordRegion = (
      outcome: RegionOutcome,
      extra: Partial<ConsensusRegionTrace> = {},
    ) => {
      if (!td) return;
      td.regions[ri] = {
        index: ri,
        source: ri < td.perceivedCount ? "perceived" : "recognised",
        span: [start, end],
        chunk,
        known,
        canonicalId: canonicalId ?? undefined,
        canonicalUsable,
        canonicalFailed,
        annQueried,
        annHitsReturned: hits ? hits.length : 0,
        annHitsExamined: examinedIds ? examinedIds.size : 0,
        outcome,
        ordinaryVoteProduced: outcome === "voted",
        superseded: false,
        ...extra,
      };
    };

    // EXACT-FIRST: a chunk whose canonical anchor is content-addressed needs
    // no estimator — identity is exact, so its score is 1 BY DEFINITION (the
    // estimated cosine of a form with itself, minus quantisation noise, and
    // the caveat atop geometry.ts forbids trusting the estimate over the
    // exact resolution anyway).  The ANN query is deferred behind
    // `ensureHits` and paid only when actually consulted: the orphan
    // fallback, the contrastive margin (approximate regions only), or a
    // region with no usable canonical.  On chunk-heavy queries this removes
    // the resonate() call for most exact regions — the single largest
    // remaining inference sink — with the anchor choice unchanged (the
    // canonical branch already ignored hits[0]).
    const canonicalId = chunk
      ? canonicalChunkId(ctx, query.subarray(start, end), N, reachMemo)
      : null;
    const canonicalUsable = canonicalId !== null &&
      (ctx.store.hasParents(canonicalId) ||
        ctx.store.hasContainers(canonicalId));
    let hits: readonly Hit[] | null = null;
    const ensureHits = async (): Promise<readonly Hit[]> => {
      if (hits === null) {
        hits = await ctx.store.resonate(v, k);
        annQueried = true;
      }
      return hits;
    };

    const canonicalFailed = chunk && canonicalId === null;
    let voterId: number;
    let score: number;
    let scoreId: number; // the node the score was measured against
    let selectedSource: "canonical" | "ann";
    if (canonicalUsable) {
      voterId = canonicalId!;
      score = 1;
      scoreId = canonicalId!;
      selectedSource = "canonical";
    } else {
      const h = await ensureHits();
      if (h.length === 0) {
        recordRegion("no-ann-hit");
        continue;
      }
      voterId = h[0].id;
      score = h[0].score;
      scoreId = h[0].id;
      selectedSource = "ann";
      examinedIds?.add(voterId);
    }

    let reach = edgeAncestors(ctx, voterId, N, reachMemo);
    // A region's vote must not die with the TOP hit: `hits[1..k]` were
    // already fetched, and the top-ranked anchor being a structural orphan
    // (no edge-bearing ancestors) is an accident of the approximate ranking,
    // not evidence the region relates to nothing.  Walk the remaining hits —
    // nearest first, climbs memoised — until one climbs.  A SATURATED reach
    // is not an orphan: it is a deliberate abstention, kept as-is.
    if (reach.roots.length === 0 && !reach.saturated) {
      for (const h of await ensureHits()) {
        if (h.id === voterId) continue;
        const r2 = edgeAncestors(ctx, h.id, N, reachMemo);
        examinedIds?.add(h.id);
        if (r2.saturated || r2.roots.length > 0) {
          ctx.trace?.step(
            "anchorFallback",
            [rNode(ctx, voterId, "orphan-anchor", score)],
            [rNode(ctx, h.id, "anchor", h.score)],
            "the top-ranked anchor climbs to no context — a lower-ranked hit votes instead",
          );
          reach = r2;
          voterId = h.id;
          score = h.score;
          scoreId = h.id;
          selectedSource = "ann";
          fallbackKind = "orphan";
          break;
        }
      }
    } else if (!canonicalUsable && reach.saturated) {
      // TIE-BAND saturation fallback.  A saturated top hit abstains the whole
      // region (a hub's reach concludes nothing) — but the hub may only CLAIM
      // that abstention when it is DISTINGUISHABLY the nearest anchor.  The
      // resonance ranking is an estimate: the difference between two scores
      // against the same query carries √2× the estimator's per-score error,
      // ≈ 1/√D ({@link estimatorNoise}) — so any hit within that band of the
      // top is the SAME rank at measurement resolution, and letting the hub
      // win the tie decides the region by quantisation accident (observed:
      // a 0.1σ rank inversion flipped a pinned behaviour when the query
      // estimator sharpened from 4 to 8 bits).  Walk the tied hits, nearest
      // first; the first that climbs somewhere non-saturated votes for the
      // region.  Beyond the band the hub is genuinely nearest and its
      // abstention stands.  A KNOWN (content-addressed) region never enters:
      // its anchor is exact, not an estimate.
      const band = estimatorNoise(ctx.store.D);
      for (const h of await ensureHits()) {
        if (h.id === voterId) continue;
        if (h.score < score - band) break; // hits are nearest-first
        const r2 = edgeAncestors(ctx, h.id, N, reachMemo);
        examinedIds?.add(h.id);
        if (!r2.saturated && r2.roots.length > 0) {
          ctx.trace?.step(
            "anchorFallback",
            [rNode(ctx, voterId, "saturated-anchor", score)],
            [rNode(ctx, h.id, "anchor", h.score)],
            "the top-ranked anchor is a saturated hub tied within estimator noise — the tied hit votes instead",
          );
          reach = r2;
          voterId = h.id;
          score = h.score;
          scoreId = h.id;
          selectedSource = "ann";
          fallbackKind = "saturated-tie";
          break;
        }
      }
    }
    regionSaturated[ri] = reach.saturated;
    const selected: ConsensusRegionTrace["selected"] | undefined = !td
      ? undefined
      : (() => {
        const rank: number | undefined = selectedSource === "ann"
          ? (hits as readonly Hit[] | null)?.findIndex((h: Hit) =>
            h.id === voterId
          )
          : undefined;
        return {
          source: selectedSource,
          node: voterId,
          score,
          ...(rank !== undefined ? { rank } : {}),
          ...(fallbackKind ? { fallback: fallbackKind } : {}),
        };
      })();
    if (reach.roots.length === 0) {
      recordRegion("no-structural-reach", { selected, reachNode: voterId });
      continue;
    }
    if (reach.saturated) {
      recordRegion("saturated-abstention", { selected, reachNode: voterId });
      continue;
    }

    // One IDF per region — dfWeight() and the focus weight used to compute
    // the same logarithm independently.
    const idf = Math.log(N / Math.max(1, reach.contextsReached));
    const df = Math.log(1 + reach.contextsReached);
    const wf = mode === "direct" ? df : mode === "combined" ? idf + df : idf;
    if (wf <= 0) {
      recordRegion("nonpositive-df-weight", {
        selected,
        reachNode: voterId,
        idf,
        dfWeight: wf,
      });
      continue;
    }

    // CONTRASTIVE-MARGIN GATE — the compensation the linear (byte-proportional)
    // fold demands, applied to APPROXIMATE evidence only.  Under the linear
    // fold a resonance score reads "fraction of aligned shared bytes", so a
    // NOVEL span sharing a frame with several stored exemplars scores high
    // against each of them without being evidence of ANY of them: the shared
    // scaffolding, not the span's own content, carries the similarity.  Such a
    // frame region resonates ~equally to every framed exemplar, so its top hit
    // barely beats the best DIFFERENT-conclusion rival (a different climb
    // root-set) — its discriminative margin, score MINUS that rival, collapses
    // toward zero.  A region votes only when that margin clears the estimator's
    // own noise floor (1/√D — see {@link estimatorNoise}); below it the margin
    // is quantisation noise, not evidence.  A KNOWN region (content-addressed,
    // exact) skips the contrast: it IS learnt content, not an approximation.
    //
    // The margin GATES; it does NOT scale the weight.  A surviving region votes
    // at its genuine strength (score²·wf) — the SAME scale {@link
    // consensusFloor} is derived for.  Using the margin as a MULTIPLIER
    // (score·margin) conflated "discriminative" with "strong": a genuinely
    // discriminative span whose frame-rival happened to score close got a tiny
    // vote, systematically compressing correct scaffolding-dominated groundings
    // (reordered / paraphrased queries) below the floor so they grounded
    // nothing.  Gating at the noise floor keeps frame-echo suppression (a frame
    // region's margin ≈ 0 is gated out) without penalising honest evidence.
    let contrastiveMargin: number | undefined;
    let contrastiveRival: ConsensusContrastiveRivalTrace | undefined;
    if (!known) {
      let margin = score;
      const hitsForRival = await ensureHits();
      for (let hi = 0; hi < hitsForRival.length; hi++) {
        const h = hitsForRival[hi];
        if (h.id === voterId) continue;
        const r2 = edgeAncestors(ctx, h.id, N, reachMemo);
        examinedIds?.add(h.id);
        if (r2.saturated || r2.roots.length === 0) continue; // concludes nothing
        if (sameRoots(r2.roots, reach.roots)) continue; // same conclusion
        margin = score - h.score; // hits are nearest-first: the best rival
        if (td) {
          contrastiveRival = { node: h.id, rank: hi, score: h.score };
        }
        break;
      }
      contrastiveMargin = margin;
      const noiseFloor = estimatorNoise(ctx.store.D);
      if (margin <= noiseFloor) {
        recordRegion("contrastive-margin-rejection", {
          selected,
          reachNode: voterId,
          idf,
          dfWeight: wf,
          contrastiveMargin: margin,
          contrastiveNoiseFloor: noiseFloor,
          ...(contrastiveRival ? { contrastiveRival } : {}),
        });
        continue;
      }
    }

    // MUTUAL-EXPLANATION WEIGHT (angle + magnitude).  Under the linear fold
    // cos = shared/(‖r‖·‖h‖) with ‖·‖² = content bytes, so the old score²
    // was already — implicitly — (shared/len_r)·(shared/len_h): the fraction
    // of the REGION the hit explains times the fraction of the HIT the
    // region pins down.  Made explicit, each factor is computed from the two
    // magnitudes (the region's own span; the hit's, read from the store —
    // contentLen, √bytes being the linear fold's gist norm) and CAPPED at 1:
    // the estimated cosine can imply more shared content than the smaller
    // side even holds, and the uncapped square silently credited that
    // impossible surplus — a small region echoing inside a large context, or
    // the reverse, voted above its physical evidence.  In the uncapped
    // regime this is exactly score², the scale {@link consensusFloor} is
    // derived for.  (The margin gate above deliberately stays in raw cosine
    // units: it tests the ESTIMATOR's noise floor, which lives in cosine
    // space; converting each side by its own hit's magnitude would compare
    // noise floors of different scales.)
    const lenR = Math.max(1, end - start);
    // Cap the magnitude read at lenR·D: past it s/ratio ≤ s/√D — below the
    // estimator's own noise floor — so the mutual weight is ~0 regardless
    // and the clamped value yields exactly that; no full walk of a huge hit.
    const ratio = Math.sqrt(
      Math.max(1, ctx.store.contentLen(scoreId, lenR * ctx.store.D)) / lenR,
    );
    const mutual = Math.min(1, score * ratio) * Math.min(1, score / ratio);
    const w = (mutual * wf) / reach.roots.length;
    const wFocus = (mutual * idf) / reach.roots.length;
    regionVotes.push({
      start,
      end,
      canonicalFailed,
      roots: reach.roots,
      w,
      wFocus,
    });
    if (ctx.trace) {
      regionVoter[ri] = { id: voterId, score, w: wf };
    }
    recordRegion("voted", {
      selected,
      reachNode: voterId,
      idf,
      dfWeight: wf,
      ...(contrastiveMargin !== undefined
        ? {
          contrastiveMargin,
          contrastiveNoiseFloor: estimatorNoise(ctx.store.D),
          ...(contrastiveRival ? { contrastiveRival } : {}),
        }
        : {}),
      mutualWeight: mutual,
      voteWeightPerRoot: w,
      focusWeightPerRoot: wFocus,
    });
  }
  return {
    votes: regionVotes,
    saturated: regionSaturated,
    voters: regionVoter,
  };
}

/** The consensus vote as EVIDENCE POOLING, not shortest path: each surviving
 *  region is an axiom; it contributes to every root it climbed to (or, for a
 *  terminal answer node, to the contexts that lead to it) by a `combine:
 *  "sum"` rule, so independent regions corroborating the same anchor ADD
 *  rather than compete to be the cheapest route (see {@link Rule.combine} in
 *  derive/src/deduction.ts).  Run through the very engine {@link
 *  GraphSearch} covers with — `lightestDerivation` — so a pooled-evidence
 *  decision is, like a followed edge or a spliced connector, one weighted
 *  rule of the SAME deduction system, not a separate hand-rolled tally that
 *  merely logs alongside it.  `votesIdf`/`support` are the same two
 *  read-outs {@link commitVotes} always gated on; only how they accumulate
 *  changed. */
export function poolVotes(
  ctx: MindContext,
  regionVotes: readonly RegionVote[],
  sat: SaturationInfo,
  N: number,
  td?: TraceDraft,
): {
  votes: Map<number, number>;
  votesIdf: Map<number, number>;
  support: Map<number, { start: number; end: number; w: number }>;
  /** Per-anchor SCALE-INVARIANT support: Σ RegionVote.absorbed over the
   *  distinct contributing regions — see Attention.breadth. */
  regionSupport: Map<number, number>;
  /** Per-anchor contributing region spans — see Attention.clusters. */
  regionSpans: Map<number, Array<[number, number]>>;
  steps: DerivationStep[];
} {
  const eligible: number[] = [];
  for (let ri = 0; ri < regionVotes.length; ri++) {
    const rv = regionVotes[ri];
    if (
      rv.canonicalFailed &&
      sat.intervals.some((iv) => rv.start >= iv.start && rv.end <= iv.end)
    ) {
      continue;
    }
    eligible.push(ri);
  }
  if (td) {
    td.pooling = {
      inputVotes: regionVotes.length,
      eligibleVotes: eligible.length,
      saturationMaskedVotes: regionVotes.length - eligible.length,
    };
  }

  const key = (it: AItem) =>
    it.kind === "region"
      ? `r${it.ri}`
      : it.kind === "anchor"
      ? `a${it.id}`
      : `x${it.id}`;
  const pool = new Map<string, PooledConclusion<AItem>>();
  const system: DeductionSystem<AItem> = {
    key,
    *axioms() {
      for (const ri of eligible) {
        yield { item: { kind: "region", ri }, cost: 0 };
      }
    },
    isGoal: () => false, // exhaust every axiom; there is no single goal to stop at
    // Every region axiom ties at cost 0, so the agenda's pop order among them
    // is otherwise unspecified; ordering by `ri` here only steers the HEAP
    // (never added to a stored cost — see relax's use of h) so pooling fires
    // in exactly the regionVotes array order the original loop used, byte-for-
    // byte reproducing its accumulation and tie-break order.
    heuristic: (it) => it.kind === "region" ? it.ri : 0,
    *rules(it) {
      if (it.kind !== "region") return;
      const rv = regionVotes[it.ri];
      // The same hub bound the rest of the system uses (edgeAncestors' parent
      // cutoff, chooseNext's candidate cap): a terminal answer followed by
      // more than √N contexts is a non-discriminative hub — spreading a
      // region's vote across its FULL corpus-sized fan-in yields O(corpus)
      // rule applications per region and near-zero per-target weight anyway.
      // Cap the redistribution at the first √N contexts (insertion order,
      // the same convention chooseNext caps by).
      const hubBound = Math.ceil(Math.sqrt(N));
      for (const r of rv.roots) {
        // CAPPED read: only the first hubBound targets are ever credited, so
        // only they are read — a common continuation's full reverse fan-in
        // is corpus-sized and is never materialised.
        const pv = ctx.store.prevFirst(r, hubBound);
        const isAnswer = pv.length > 0 && !ctx.store.hasNext(r);
        const targets = isAnswer ? pv : [r];
        for (const t of targets) {
          yield {
            premises: [it],
            conclusion: { kind: "anchor", id: t },
            cost: rv.w / targets.length,
            combine: "sum",
          };
          yield {
            premises: [it],
            conclusion: { kind: "anchorFocus", id: t },
            cost: rv.wFocus / targets.length,
            combine: "sum",
          };
        }
      }
    },
    pool,
  };
  lightestDerivation(system);

  const votes = new Map<number, number>();
  const votesIdf = new Map<number, number>();
  const support = new Map<
    number,
    { start: number; end: number; w: number }
  >();
  const regionSupport = new Map<number, number>();
  const regionSpans = new Map<number, Array<[number, number]>>();
  const steps: DerivationStep[] = [];
  let order = 0;
  for (const pc of pool.values()) {
    if (pc.item.kind === "anchor") {
      votes.set(pc.item.id, pc.cost);
      const premises: DerivationItem[] = [];
      const seenRi = new Set<number>();
      let breadthSum = 0;
      const spans: Array<[number, number]> = [];
      for (const c of pc.contributions) {
        const p0 = c.premises[0].item;
        if (p0.kind !== "region" || seenRi.has(p0.ri)) continue;
        seenRi.add(p0.ri);
        const rv = regionVotes[p0.ri];
        breadthSum += rv.absorbed ?? 1;
        premises.push({ kind: "form", span: [rv.start, rv.end] });
        spans.push([rv.start, rv.end]);
      }
      regionSupport.set(pc.item.id, breadthSum);
      regionSpans.set(pc.item.id, spans);
      steps.push({
        order: order++,
        move: "pool-vote",
        premises,
        conclusion: { kind: "form", span: [-1, -1], node: pc.item.id },
        cost: pc.cost,
        producers: [],
      });
    } else if (pc.item.kind === "anchorFocus") {
      votesIdf.set(pc.item.id, pc.cost);
      let bestRv: RegionVote | null = null;
      for (const c of pc.contributions) {
        const p0 = c.premises[0].item;
        if (p0.kind !== "region") continue;
        const rv = regionVotes[p0.ri];
        if (!bestRv || rv.wFocus > bestRv.wFocus) bestRv = rv;
      }
      if (bestRv) {
        support.set(pc.item.id, {
          start: bestRv.start,
          end: bestRv.end,
          w: bestRv.wFocus,
        });
      }
    }
  }
  return { votes, votesIdf, support, regionSupport, regionSpans, steps };
}

/** The number of DISTINCT clusters a root's contributing regions form —
 *  see Attention.clusters.  Two regions belong to the same cluster iff the
 *  gap between them is strictly less than one river-fold quantum W: at
 *  that distance there is no room for a genuinely separate, independently
 *  perceivable unit of content between them (the same "smallest meaningful
 *  distinction" quantum {@link reachThreshold}'s own doc invokes).  A gap
 *  of a full quantum or more means real, separate structure could sit
 *  between the two spans, so they count as independent corroboration.
 *  Strict `<` (not `<=`): verified against gap 3.1's own "gender equality"
 *  root, whose two genuine clusters sit EXACTLY W bytes apart — `<= W`
 *  would wrongly merge them into one and break that pinned requirement. */
function countClusters(spans: readonly [number, number][], W: number): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let clusters = 1;
  let curEnd = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s - curEnd < W) {
      curEnd = Math.max(curEnd, e);
    } else {
      clusters++;
      curEnd = e;
    }
  }
  return clusters;
}

export function commitVotes(
  ctx: MindContext,
  pooled: {
    votes: Map<number, number>;
    votesIdf: Map<number, number>;
    support: Map<number, { start: number; end: number; w: number }>;
    regionSupport: Map<number, number>;
    regionSpans: Map<number, Array<[number, number]>>;
    steps: DerivationStep[];
  },
  sat: SaturationInfo,
  regions: readonly Region[],
  regionVoter: ReadonlyArray<{ id: number; score: number; w: number } | null>,
  N: number,
  td?: TraceDraft,
  cfg?: ClimbConsensusCfg,
): AttentionRead {
  const { votes, votesIdf, support, regionSupport, regionSpans, steps } =
    pooled;
  if (votes.size === 0) {
    traceAttention(ctx, regions, regionVoter, [], steps, td, cfg);
    return { roots: [], ranked: [] };
  }

  // SCALE-INVARIANT confidence — see Attention.breadth's doc.  regions.length
  // is the query's OWN full candidate count (most never vote at all), the
  // same denominator the "N of M sub-regions voted" rationale text already
  // reports; regionSupport is that same accounting read PER ANCHOR.
  const totalRegions = Math.max(1, regions.length);
  const ranked = [...votes.entries()]
    .map(([anchor, vote]) => {
      const s = support.get(anchor)!;
      return {
        anchor,
        vote,
        start: s.start,
        end: s.end,
        breadth: (regionSupport.get(anchor) ?? 0) / totalRegions,
        clusters: countClusters(
          regionSpans.get(anchor) ?? [],
          ctx.space.maxGroup,
        ),
      };
    })
    .sort((a, b) => b.vote - a.vote);

  const overlaps = (a: Attention, b: Attention) =>
    a.start < b.end && b.start < a.end;
  const idfDesc = [...votesIdf.values()].sort((a, b) => b - a);
  const rootCut = naturalBreak(idfDesc);
  // A FURTHER point of attention (beyond the dominant one, which always
  // grounds) must clear the same absolute significance floor
  // recallByResonance trusts a climb anchor with — log(N) + 1/2, three-ish
  // halvings of confidence above pure chance at this corpus scale — not
  // merely beat whatever its immediate neighbour in the ratio happens to be.
  // Without it, naturalBreak's ratio is scale-free but not FLOOR-free: on a
  // large, topic-diverse corpus the steepest ratio in a long noise tail can
  // sit far below any real signal, admitting scaffolding echoes as if they
  // were genuine further topics.
  const floor = consensusFloor(N);
  const placed: Attention[] = [];
  const roots: Attention[] = [];
  const recordAnchor = (
    point: Attention,
    rank: number,
    status: "root" | "overlap" | "rejected",
    dominant: boolean,
    passesNaturalBreak: boolean | undefined,
    passesConsensusFloor: boolean | undefined,
    pastLeadingSaturation: boolean | undefined,
    rejectionReasons: AnchorRejectionReason[],
  ) => {
    if (!td) return;
    td.anchors.push({
      anchor: point.anchor,
      rank,
      pooledVote: point.vote,
      idfVote: votesIdf.get(point.anchor) ?? 0,
      candidateBreadth: regions.length,
      contributingVotes: regionSpans.get(point.anchor)?.length ?? 0,
      contributingEvidence: regionSupport.get(point.anchor) ?? 0,
      breadth: point.breadth,
      contributingSpans: regionSpans.get(point.anchor) ?? [],
      clusters: point.clusters,
      commit: {
        status,
        dominant,
        passesNaturalBreak,
        passesConsensusFloor,
        pastLeadingSaturation,
        rejectionReasons,
      },
    });
  };
  for (let rank = 0; rank < ranked.length; rank++) {
    const point = ranked[rank];
    const absorbed = placed.some((p) => overlaps(point, p));
    // Commit decisions are recorded LIVE, inside this loop, in the exact
    // shape the gates below apply them — never reconstructed afterward from
    // the final `roots` (spec §8's explicit requirement).
    let status: "root" | "overlap" | "rejected";
    let dominant = false;
    let passesNaturalBreak: boolean | undefined;
    let passesConsensusFloor: boolean | undefined;
    let pastLeadingSaturation: boolean | undefined;
    const rejectionReasons: AnchorRejectionReason[] = [];
    if (absorbed) {
      status = "overlap";
    } else {
      const pastLeading = !sat.hasLeading ||
        roots.length === 0 || point.start >= sat.leadingEnd;
      pastLeadingSaturation = pastLeading;
      const vote = votesIdf.get(point.anchor) ?? 0;
      if (roots.length === 0) {
        // The first non-overlapping root is DOMINANT and bypasses the two
        // vote thresholds (it always grounds) — only the leading-saturation
        // gate still applies to it.
        dominant = true;
        if (pastLeading) {
          status = "root";
        } else {
          status = "rejected";
          rejectionReasons.push("leading-saturation");
        }
      } else {
        passesNaturalBreak = vote >= rootCut;
        passesConsensusFloor = vote >= floor;
        if (passesNaturalBreak && passesConsensusFloor && pastLeading) {
          status = "root";
        } else {
          status = "rejected";
          if (!passesNaturalBreak) rejectionReasons.push("below-natural-break");
          if (!passesConsensusFloor) {
            rejectionReasons.push("below-consensus-floor");
          }
          if (!pastLeading) rejectionReasons.push("leading-saturation");
        }
      }
      if (status === "root") {
        roots.push(point);
      } else {
        recordAnchor(
          point,
          rank,
          status,
          dominant,
          passesNaturalBreak,
          passesConsensusFloor,
          pastLeadingSaturation,
          rejectionReasons,
        );
        continue;
      }
    }
    recordAnchor(
      point,
      rank,
      status,
      dominant,
      passesNaturalBreak,
      passesConsensusFloor,
      pastLeadingSaturation,
      rejectionReasons,
    );
    placed.push(point);
  }

  traceAttention(
    ctx,
    regions,
    regionVoter,
    roots,
    steps,
    td,
    cfg ? { ...cfg, naturalBreak: rootCut, consensusFloor: floor } : undefined,
    ranked,
  );
  return { roots, ranked };
}

export function detectSaturated(
  ctx: MindContext,
  regions: ReadonlyArray<{ start: number; end: number; chunk?: boolean }>,
  saturated: ReadonlyArray<boolean>,
): SaturationInfo {
  // Intervals are built from CHUNK regions only.  collectRegions emits the
  // tree in POST-ORDER — a parent region arrives AFTER its children and
  // shares its first child's `start` — so the raw array is not monotone in
  // byte position, and a saturated parent would fuse with a later saturated
  // chunk into an interval swallowing a NON-saturated child.  Chunk regions
  // (leaf-parents) are disjoint and already in byte order, and saturation
  // masking exists to drop canonicalFailed CHUNK votes (see poolVotes), so
  // chunks are both the sufficient and the safe basis.  A region without a
  // `chunk` flag (a bare {start,end} from a direct caller) is treated as a
  // chunk.
  const intervals: Array<{ start: number; end: number }> = [];
  let intStart = -1;
  let intEnd = -1;
  let totalLen = 0;
  for (let ri = 0; ri < regions.length; ri++) {
    const r = regions[ri];
    totalLen = Math.max(totalLen, r.end);
    if (r.chunk === false) continue;
    if (saturated[ri]) {
      if (intStart === -1) intStart = r.start;
      intEnd = r.end;
    } else {
      if (intStart !== -1) {
        intervals.push({ start: intStart, end: intEnd });
        intStart = -1;
      }
    }
  }
  if (intStart !== -1) {
    intervals.push({ start: intStart, end: intEnd });
  }

  const leading = intervals.length > 0 && intervals[0].start === 0
    ? intervals[0]
    : null;
  const hasLeading = leading !== null &&
    leading.end >= ctx.space.maxGroup &&
    leading.end < totalLen;
  const leadingEnd = leading !== null ? leading.end : 0;

  return { leadingEnd, hasLeading, intervals };
}

/** Set equality of two climb root lists (the "same conclusion" test the
 *  contrastive margin skips rivals by). */
function sameRoots(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}

export function canonicalChunkId(
  ctx: MindContext,
  regionBytes: Uint8Array,
  N: number,
  reachMemo?: Map<number, AncestorReach>,
): number | null {
  const len = Math.min(regionBytes.length, ctx.space.maxGroup);
  for (let off = 0; off + len <= regionBytes.length; off++) {
    const ids = leafIdRun(ctx, regionBytes, off, off + len);
    if (ids === null) return null;
    const flatId = ctx.store.findBranch(ids);
    if (flatId === null) continue;
    if (len < 2) return flatId;

    let bestId = flatId;
    let bestReach = edgeAncestors(ctx, flatId, N, reachMemo);
    for (let k2 = 1; k2 < len; k2++) {
      const shortIds = ids.slice(0, len - k2);
      const shortId = ctx.store.findBranch(shortIds);
      if (shortId === null) continue;
      const shortReach = edgeAncestors(ctx, shortId, N, reachMemo);
      if (
        shortReach.saturated ||
        shortReach.contextsReached > bestReach.contextsReached
      ) {
        bestId = shortId;
        bestReach = shortReach;
      }
    }
    return bestId;
  }
  return null;
}

export function naturalBreak(votes: number[]): number {
  if (votes.length <= 1) return votes[0] ?? 0;
  let breakAt = 1;
  let steepest = Infinity;
  for (let i = 1; i < votes.length; i++) {
    if (votes[i - 1] <= 0) break;
    const ratio = votes[i] / votes[i - 1];
    if (ratio < steepest) {
      steepest = ratio;
      breakAt = i;
    }
  }
  return votes[breakAt - 1];
}

// ═══════════════════════════════════════════════════════════════════════════
// Cross-region attention — DIRECT region-to-region interaction.
//
// voteRegions climbs each region INDEPENDENTLY; poolVotes then ADDS those
// independent votes.  Additive pooling is a soft conjunction, but it can only
// ever surface a context at least one region already votes for.  Two regions
// whose individual climbs land on DIFFERENT contexts leave their JOINT context
// — the learnt whole that contains BOTH — with no vote at all, and no amount
// of pooling can recover it.  ("red" climbs to `red square`, "circle" to
// `circle`; nothing votes for `red circle`, the only fact holding both.)
//
// This is the attention counterpart of the bridge, and it ascends by the SAME
// content-addressed junction walk (junction.ts): "which learnt whole contains
// region A then region B?" is a bounded DAG ascent from the two forms'
// canonical identities — NOT a resonance guess on a synthesised gist.  Folding
// two region vectors cannot even reconstruct the stored joint form: Sema builds
// a multi-word gist from BYTE-chunk folds, so isolated word vectors superpose
// into a different direction and resonate to `red circle` and `red square`
// indistinguishably.  The ascent sidesteps this by matching BYTES, not vectors.
//
// A joint container is EXACT evidence (it literally holds both forms), so it
// votes at full strength — the exact-first discipline voteRegions gives a
// content-addressed chunk.  Each junction search is a bounded walk with NO
// ANN query, and searches are capped at k.  Three further disciplines make
// the composition ORDER-FREE, N-ARY, and CORPUS-INDEPENDENT:
//
//  • ORDER-FREE — a junction is evidence the forms were LEARNT TOGETHER;
//    which one the query mentioned first is a fact about the query, not the
//    learnt whole.  The walk tests both byte orders at no extra walk cost
//    (see junctionContainersFrom's `unordered`).
//  • N-ARY — binding is not intrinsically pairwise.  A pair's containers are
//    FILTERED by the remaining candidate forms: the container covering the
//    MOST of the query's composable forms wins, so three cross-cutting
//    attributes (each pair ambiguous) still resolve to their unique triple —
//    at the cost of one cached byte read + indexOf per (container, extra),
//    never an extra walk.
//  • CORPUS-INDEPENDENT — candidates are ANY voted region, not just
//    recognised sites.  A word never learnt standalone has no site, but its
//    stored chunks still vote and their BYTES still compose: the ascent
//    matches byte containment, so a fragment pair evidences the same joint
//    container the whole word would.  Contiguous shards of one word cannot
//    pair (the adjacency skip), and a pair covered by a single KNOWN region
//    is skipped — that whole form already votes directly, and re-deriving it
//    from its own pieces would only double-count.
//
// EXPLAINING AWAY (the aliasing complement of corpus independence): a chunk
// of the query can straddle the byte grid so that it exists verbatim in the
// WRONG deposit (" cir" of "red then circle" is a stored chunk of `blue
// circle`, never of `red circle` — a pure alignment accident) and its
// independent climb then votes for a context the query gives no reason to
// believe.  When a junction binds, any individual vote whose bytes the joint
// container LITERALLY CONTAINS yet whose climb disagrees with the junction's
// is superseded: the exact joint evidence explains those bytes, so their
// disagreeing vote is grid aliasing, not signal.  Votes whose bytes the
// container does not hold (a genuine second topic) are untouched.
// ═══════════════════════════════════════════════════════════════════════════

// ── Structural-resonance — the FINAL approximate tier ──────────────────────
//
// Reached only when every DAG junction tier (exact, single-synonym, double-
// synonym) found no container.  Composes a hypothetical structural gist from
// ALREADY-EXISTING structural vectors — the two endpoint regions' own gists
// (or, per variant, a halo sibling's stored gist occupying the same slot)
// plus the REAL middle-query structure between them — and asks the ANN index
// what already-learnt whole resembles that composition.  It never perceives
// concatenated endpoint bytes and never fabricates a rewritten query string;
// see {@link composeStructuralGist}.

export type CrossRegionTier =
  | "exact"
  | "single-synonym"
  | "double-synonym"
  | "structural-resonance";

export interface StructuralVariant {
  left: StructuralPart;
  right: StructuralPart;
  kind:
    | "exact-exact"
    | "left-synonym"
    | "right-synonym"
    | "double-synonym";
  semanticConfidence: number;
  leftSiblingId?: number;
  rightSiblingId?: number;
}

export interface StructuralResonanceProposal {
  id: number;
  annScore: number;
  semanticConfidence: number;
  effectiveScore: number;
  variant: StructuralVariant["kind"];
  leftSiblingId?: number;
  rightSiblingId?: number;
}

const VARIANT_KIND_ORDER: Record<StructuralVariant["kind"], number> = {
  "exact-exact": -1,
  "left-synonym": 0,
  "right-synonym": 1,
  "double-synonym": 2,
};

/** A node's structural gist, read directly from its own stored bytes — the
 *  repository's node → gist accessor: content is immutable and perception is
 *  a pure function of bytes, so re-perceiving a node's full stored bytes
 *  reproduces exactly the gist it was interned with.  Never concatenates
 *  the sibling's bytes with anything else. */
function storedNodeGist(ctx: MindContext, id: number): Vec {
  return gistOf(ctx, read(ctx, id));
}

/** A halo sibling's structural part, occupying the ORIGINAL query-region
 *  slot length — the sibling replaces only the DIRECTION, never the query's
 *  own bytes, position, or gap (see §6 of the spec this implements). */
function siblingPart(
  ctx: MindContext,
  sibling: Hit,
  originalRegion: { start: number; end: number },
): StructuralPart {
  return {
    v: storedNodeGist(ctx, sibling.id),
    len: originalRegion.end - originalRegion.start,
  };
}

/** Build, bound and order every mandatory structural variant (§7-8): the
 *  exact/exact composition is always kept; up to `ctx.cfg.haloQueryK`
 *  synonym variants (single- and double-synonym combined, one shared
 *  budget) are appended, ordered by confidence, then kind, then sibling id. */
export function buildStructuralVariants(
  ctx: MindContext,
  ra: Region,
  rb: Region,
  sides: JunctionSynonymSides,
): {
  variants: StructuralVariant[];
  exactLeft: StructuralPart;
  exactRight: StructuralPart;
} {
  const exactLeft: StructuralPart = { v: ra.v, len: ra.end - ra.start };
  const exactRight: StructuralPart = { v: rb.v, len: rb.end - rb.start };

  const synonymVariants: StructuralVariant[] = [];
  for (const ls of sides.leftSiblings) {
    synonymVariants.push({
      left: siblingPart(ctx, ls, ra),
      right: exactRight,
      kind: "left-synonym",
      semanticConfidence: ls.score,
      leftSiblingId: ls.id,
    });
  }
  for (const rs of sides.rightSiblings) {
    synonymVariants.push({
      left: exactLeft,
      right: siblingPart(ctx, rs, rb),
      kind: "right-synonym",
      semanticConfidence: rs.score,
      rightSiblingId: rs.id,
    });
  }
  for (const ls of sides.leftSiblings) {
    for (const rs of sides.rightSiblings) {
      synonymVariants.push({
        left: siblingPart(ctx, ls, ra),
        right: siblingPart(ctx, rs, rb),
        kind: "double-synonym",
        semanticConfidence: Math.min(ls.score, rs.score),
        leftSiblingId: ls.id,
        rightSiblingId: rs.id,
      });
    }
  }

  // §8: semantic confidence desc, then kind (left-synonym, right-synonym,
  // double-synonym), then left sibling id asc, then right sibling id asc.
  synonymVariants.sort((a, b) =>
    b.semanticConfidence - a.semanticConfidence ||
    VARIANT_KIND_ORDER[a.kind] - VARIANT_KIND_ORDER[b.kind] ||
    (a.leftSiblingId ?? -1) - (b.leftSiblingId ?? -1) ||
    (a.rightSiblingId ?? -1) - (b.rightSiblingId ?? -1)
  );

  const variants: StructuralVariant[] = [
    {
      left: exactLeft,
      right: exactRight,
      kind: "exact-exact",
      semanticConfidence: 1,
    },
    ...synonymVariants.slice(0, ctx.cfg.haloQueryK),
  ];
  return { variants, exactLeft, exactRight };
}

/** Deterministic best-of tie-break for two proposals ranked for the SAME
 *  candidate id — effectiveScore, then annScore, then semanticConfidence,
 *  then variant kind, then sibling ids (§10). */
function betterProposal(
  a: StructuralResonanceProposal,
  b: StructuralResonanceProposal,
): boolean {
  if (a.effectiveScore !== b.effectiveScore) {
    return a.effectiveScore > b.effectiveScore;
  }
  if (a.annScore !== b.annScore) return a.annScore > b.annScore;
  if (a.semanticConfidence !== b.semanticConfidence) {
    return a.semanticConfidence > b.semanticConfidence;
  }
  if (VARIANT_KIND_ORDER[a.variant] !== VARIANT_KIND_ORDER[b.variant]) {
    return VARIANT_KIND_ORDER[a.variant] < VARIANT_KIND_ORDER[b.variant];
  }
  if ((a.leftSiblingId ?? -1) !== (b.leftSiblingId ?? -1)) {
    return (a.leftSiblingId ?? -1) < (b.leftSiblingId ?? -1);
  }
  return (a.rightSiblingId ?? -1) < (b.rightSiblingId ?? -1);
}

/** The final approximate tier: compose every retained structural variant,
 *  ANN-query each, merge proposals by candidate id, and validate the winner
 *  through the SAME structural gates every other tier answers to (saturation,
 *  roots, IDF, contrastive margin).  Returns null when nothing survives. */
export async function structuralResonance(
  ctx: MindContext,
  query: Uint8Array,
  ra: Region,
  rb: Region,
  sides: JunctionSynonymSides,
  k: number,
  N: number,
  reachMemo: Map<number, AncestorReach>,
  /** Each side's OWN individual climb roots (from voteRegions), when it cast
   *  one — the self-evidence backstop structural-resonance needs and the
   *  exact tier gets for free from literal byte containment (§11's whole
   *  premise: recover a JOINT context neither side votes for alone).  A
   *  candidate whose reach is exactly one side's own conclusion is not new
   *  evidence of a joint whole; it is that side's resonance rediscovering
   *  itself through a synthetic gist still dominated by its own direction. */
  ownRootsA: readonly number[] | undefined,
  ownRootsB: readonly number[] | undefined,
  trace?: StructuralResonanceTrace,
): Promise<
  | { proposal: StructuralResonanceProposal; reach: AncestorReach; idf: number }
  | null
> {
  const { variants } = buildStructuralVariants(ctx, ra, rb, sides);
  if (trace) trace.variantBudget = ctx.cfg.haloQueryK;

  const middleBytes = query.subarray(ra.end, rb.start);
  const middlePart: StructuralPart | null = middleBytes.length === 0
    ? null
    : { v: perceive(ctx, middleBytes).v, len: middleBytes.length };

  const proposals = new Map<number, StructuralResonanceProposal>();
  for (const variant of variants) {
    const parts: StructuralPart[] = [variant.left];
    if (middlePart) parts.push(middlePart);
    parts.push(variant.right);
    const synthetic = composeStructuralGist(ctx.space, parts);
    const hits = await ctx.store.resonate(synthetic, k);
    if (trace) {
      trace.variants.push({
        kind: variant.kind,
        semanticConfidence: variant.semanticConfidence,
        leftSiblingId: variant.leftSiblingId,
        rightSiblingId: variant.rightSiblingId,
        annHitsReturned: hits.length,
      });
    }
    for (const hit of hits) {
      const candidate: StructuralResonanceProposal = {
        id: hit.id,
        annScore: hit.score,
        semanticConfidence: variant.semanticConfidence,
        effectiveScore: hit.score * variant.semanticConfidence,
        variant: variant.kind,
        leftSiblingId: variant.leftSiblingId,
        rightSiblingId: variant.rightSiblingId,
      };
      const prev = proposals.get(hit.id);
      if (prev === undefined || betterProposal(candidate, prev)) {
        proposals.set(hit.id, candidate);
      }
    }
  }
  if (trace) trace.mergedProposals = proposals.size;
  if (proposals.size === 0) {
    if (trace) {
      trace.noiseFloor = estimatorNoise(ctx.store.D);
      trace.outcome = "empty";
    }
    return null;
  }

  const sorted = [...proposals.values()].sort((a, b) =>
    b.effectiveScore - a.effectiveScore || a.id - b.id
  );

  // One shared shape for every `examined` entry (spec §5): only `outcome`
  // varies across the six exit points below, so build it once instead of
  // repeating the six-field literal at each site.
  const recordExamined = (
    p: StructuralResonanceProposal,
    outcome: StructuralResonanceCandidateTrace["outcome"],
  ) => {
    if (!trace) return;
    trace.examined.push({
      node: p.id,
      variant: p.variant,
      leftSiblingId: p.leftSiblingId,
      rightSiblingId: p.rightSiblingId,
      annScore: p.annScore,
      semanticConfidence: p.semanticConfidence,
      effectiveScore: p.effectiveScore,
      outcome,
    });
  };

  let selected: StructuralResonanceProposal | null = null;
  let selectedReach: AncestorReach | null = null;
  let selectedIdf = 0;
  let rival: StructuralResonanceProposal | null = null;
  for (const p of sorted) {
    const reach = edgeAncestors(ctx, p.id, N, reachMemo);
    if (reach.saturated || reach.roots.length === 0) {
      recordExamined(p, reach.saturated ? "saturated" : "no-roots");
      continue;
    }
    const idf = Math.log(N / Math.max(1, reach.contextsReached));
    if (idf <= 0) {
      recordExamined(p, "nonpositive-idf");
      continue;
    }
    // Self-evidence backstop (see the param doc above): a candidate that is
    // exactly one side's own already-voted conclusion carries no JOINT
    // evidence — skip it as if it never survived.
    if (
      (ownRootsA && sameRoots(reach.roots, ownRootsA)) ||
      (ownRootsB && sameRoots(reach.roots, ownRootsB))
    ) {
      recordExamined(p, "same-as-endpoint");
      continue;
    }
    if (selected === null) {
      selected = p;
      selectedReach = reach;
      selectedIdf = idf;
      recordExamined(p, "selected");
    } else if (!sameRoots(reach.roots, selectedReach!.roots)) {
      rival = p;
      recordExamined(p, "contrastive-rival");
      break;
    } else {
      recordExamined(p, "same-as-selected");
    }
  }
  if (selected === null || selectedReach === null) {
    if (trace) {
      trace.noiseFloor = estimatorNoise(ctx.store.D);
      trace.outcome = "no-valid-proposal";
    }
    return null;
  }

  const margin = rival
    ? selected.effectiveScore - rival.effectiveScore
    : selected.effectiveScore;
  if (trace) {
    trace.contrastiveMargin = margin;
    trace.noiseFloor = estimatorNoise(ctx.store.D);
  }
  if (margin <= estimatorNoise(ctx.store.D)) {
    if (trace) trace.outcome = "margin-rejected";
    return null;
  }

  if (trace) trace.outcome = "accepted";
  return { proposal: selected, reach: selectedReach, idf: selectedIdf };
}

async function crossRegionVotes(
  ctx: MindContext,
  query: Uint8Array,
  regions: readonly Region[],
  rvs: { votes: readonly RegionVote[]; saturated: readonly boolean[] },
  k: number,
  N: number,
  reachMemo: Map<number, AncestorReach>,
  td?: TraceDraft,
): Promise<{ votes: RegionVote[]; superseded: Set<RegionVote> }> {
  // Candidate regions: every region that ALREADY CAST ITS OWN VOTE in
  // voteRegions — individually idf > 0, genuinely discriminative on its own,
  // just not necessarily for the SAME context as its partner.  This is the
  // exact shape of the binding problem: "red" alone votes for `red square`,
  // "circle" alone for `circle` — each independently informative, disagreeing
  // on the conclusion — and only their CONJUNCTION resolves to the one
  // context, `red circle`, that actually holds both.
  //
  // A region that never voted (idf == 0 — e.g. a repeated system-prompt
  // prefix shared by every deposit) carries NO individual signal, and must be
  // excluded here too: ascending from a non-discriminative fragment's seeds
  // can still land on some deeper, incidentally-unique DESCENDANT container —
  // its rarity would come entirely from context OUTSIDE the fragments
  // actually composed, manufacturing confidence the query gave no reason to
  // have.  Requiring a prior individual vote is the same discipline the noise
  // drop already applies to single regions, extended to compositions — with
  // one graded relaxation: a KNOWN region that did NOT vote (saturated, or
  // idf ≤ 0) may still serve as the WEAK side of a pair whose other side DID
  // vote.  Saturation is an abstention about where the region CLIMBS; its
  // content-addressed identity is still exact, and the junction asks a
  // different question — "which whole holds both?" — whose conclusion the
  // container's own idf gate below still guards.  Two non-voting regions
  // never pair (that is exactly the shared-prefix trap above), so at least
  // one side is always individually discriminative.
  //
  // Only MAXIMAL spans compose: a span contained in another candidate is a
  // fragment of that candidate's evidence, never independent of it.
  const votedSpans = new Set<string>();
  for (const rv of rvs.votes) votedSpans.add(`${rv.start},${rv.end}`);
  const seen = new Set<string>();
  const eligible: number[] = [];
  const strong = new Set<number>();
  for (let ri = 0; ri < regions.length; ri++) {
    const r = regions[ri];
    const key = `${r.start},${r.end}`;
    const isStrong = votedSpans.has(key);
    if ((!isStrong && !r.known) || seen.has(key)) continue;
    seen.add(key);
    eligible.push(ri);
    if (isStrong) strong.add(ri);
  }
  const cand = eligible.filter((x) =>
    !eligible.some((y) =>
      y !== x &&
      regions[y].start <= regions[x].start &&
      regions[x].end <= regions[y].end &&
      regions[y].end - regions[y].start > regions[x].end - regions[x].start
    )
  );
  const none = { votes: [], superseded: new Set<RegionVote>() };
  if (td) {
    td.crossRegionSummary = {
      eligibleRegions: eligible.length,
      maximalRegions: cand.length,
      probeLimit: k,
      probesAttempted: 0, // updated below as probes accrue
      stopReason: cand.length < 2 ? "insufficient-regions" : undefined,
    };
  }
  if (cand.length < 2) return none;
  cand.sort((x, y) =>
    regions[x].start - regions[y].start || regions[x].end - regions[y].end
  );

  const dec = (b: Uint8Array): string =>
    new TextDecoder().decode(b).replace(/\s+/g, " ").trim();
  const cache = walkCache(ctx);
  // One junctionSeeds per candidate for the WHOLE pairing loop — a candidate
  // recurs in up to |cand|−1 pairs, and its seeds are a pure function of its
  // bytes.
  const seedsMemo = new Map<number, number[]>();
  const seedsOf = (ri: number): number[] => {
    let s = seedsMemo.get(ri);
    if (s === undefined) {
      const r = regions[ri];
      s = junctionSeeds(ctx, query.subarray(r.start, r.end));
      seedsMemo.set(ri, s);
    }
    return s;
  };
  const overlapsSpan = (
    e: Region,
    s: { start: number; end: number },
  ): boolean => e.start < s.end && s.start < e.end;

  const out: RegionVote[] = [];
  const superseded = new Set<RegionVote>();
  // A candidate consumed by one junction does not seed another: its evidence
  // is already composed at full joint strength, and re-pairing it would vote
  // the same container (or a sub-container of it) twice.
  const consumed = new Set<number>();
  let probes = 0;

  for (let a = 0; a < cand.length && probes < k; a++) {
    if (consumed.has(cand[a])) continue;
    const ra = regions[cand[a]];
    for (let b = a + 1; b < cand.length && probes < k; b++) {
      if (consumed.has(cand[b])) continue;
      const rb = regions[cand[b]];
      if (!strong.has(cand[a]) && !strong.has(cand[b])) continue;
      if (ra.end >= rb.start) continue; // overlap or adjacent — nothing between
      // Candidates strictly BETWEEN ra and rb (cand is sorted by start, so
      // that is exactly cand[a+1 .. b-1]) that already cast their OWN vote —
      // genuine, individually-corroborated evidence about what fills the gap
      // — gate the container search below: a joint container is binding
      // evidence only when it is CONSISTENT with that evidence, i.e. its own
      // bytes actually contain what the between-region says. This is the
      // n-ary composition's normal shape (a between-attribute's bytes DO
      // recur inside the joint container, credited as an "extra" below) as
      // opposed to a container that silently substitutes something else for
      // it (e.g. bridging past "Italy" to a container whose interior is
      // "Japan" — a different, contradicting learnt whole).
      // Only a KNOWN (content-addressed, exact) between-region qualifies —
      // an approximate region's resonance climbing "somewhere" is ordinary
      // noise (any ANN query returns SOME nearest neighbour), not evidence
      // this specific gap already means something specific.
      const between: number[] = [];
      for (let m = a + 1; m < b; m++) {
        if (
          strong.has(cand[m]) && !consumed.has(cand[m]) &&
          regions[cand[m]].known
        ) between.push(cand[m]);
      }
      // A single KNOWN region covering both: the whole form is already a
      // stored identity that votes directly; its pieces add nothing.
      if (
        regions.some((r) => r.known && r.start <= ra.start && rb.end <= r.end)
      ) continue;
      probes++;
      if (td?.crossRegionSummary) {
        td.crossRegionSummary.probesAttempted = probes;
      }
      // Trace-only per-probe bookkeeping (spec §2-§7) — built incrementally
      // as the ladder runs, pushed exactly once at whichever exit fires
      // below.  `pushProbe` is called at every continue/success exit for
      // THIS pair so the invariant `probes.length === probesAttempted`
      // holds regardless of which tier settled it.
      const probe: CrossRegionProbeTrace | undefined = td
        ? {
          leftRegionIndex: cand[a],
          rightRegionIndex: cand[b],
          betweenRegionIndices: [...between],
          exact: { attempted: false, candidatesReturned: 0 },
          singleSynonym: { attempted: false, candidatesReturned: 0 },
          doubleSynonym: { attempted: false, candidatesReturned: 0 },
          outcome: "structural-rejected",
        }
        : undefined;
      let probePushed = false;
      const pushProbe = (
        outcome: CrossRegionProbeTrace["outcome"],
      ) => {
        if (!td || !probe || probePushed) return;
        probe.outcome = outcome;
        td.crossRegionProbes.push(probe);
        probePushed = true;
      };

      const left = query.subarray(ra.start, ra.end);
      const right = query.subarray(rb.start, rb.end);
      // Phrase-scale contract, exactly as the bridge: the glue between the two
      // forms may be up to W× the content it joins.
      const maxInterior = (left.length + right.length) * ctx.space.maxGroup;
      const cap = left.length + right.length + maxInterior;

      // The graded ladder (spec §1): exact DAG junction, then single-synonym,
      // then double-synonym, then — only when every DAG tier found nothing —
      // structural-resonance.  `sides` (the two halo sibling lists) is loaded
      // ONCE and reused by junctionSynonyms AND structural-resonance, so no
      // ladder rung repeats a halo ANN query an earlier rung already paid for.
      const sides = await loadJunctionSynonymSides(ctx, left, right);

      let tier: CrossRegionTier = "exact";
      let containers: Array<Junction | SynonymJunction> =
        junctionContainersFrom(
          ctx,
          left,
          right,
          cap,
          seedsOf(cand[a]),
          seedsOf(cand[b]),
          undefined,
          true,
        );
      if (probe) {
        probe.exact = {
          attempted: true,
          candidatesReturned: containers.length,
        };
      }
      if (containers.length === 0) {
        // Tiers 2-4 — synonym containers (junctionSynonyms itself runs
        // single-synonym first, falling to double-synonym only when
        // single-synonym found nothing — see junction.ts).
        const syn = await junctionSynonyms(
          ctx,
          left,
          right,
          maxInterior,
          true,
          sides,
        );
        if (probe) {
          const singleAttempted = sides.leftSiblings.length > 0 ||
            sides.rightSiblings.length > 0;
          const singleReturned = syn[0]?.tier === "single-synonym"
            ? syn.length
            : 0;
          const doubleAttempted = singleAttempted && singleReturned === 0 &&
            sides.leftSiblings.length > 0 && sides.rightSiblings.length > 0;
          const doubleReturned = syn[0]?.tier === "double-synonym"
            ? syn.length
            : 0;
          probe.singleSynonym = {
            attempted: singleAttempted,
            candidatesReturned: singleReturned,
          };
          probe.doubleSynonym = {
            attempted: doubleAttempted,
            candidatesReturned: doubleReturned,
          };
        }
        if (syn.length > 0) {
          containers = syn;
          tier = syn[0].tier;
        }
      }

      // Tier 5 — structural-resonance ANN, the FINAL approximate proposal
      // path.  Only reached when every DAG tier found NOTHING, and only when
      // there is no already-corroborated region between the endpoints (a
      // between-region with its own vote is evidence the gap already means
      // something specific — an ANN guess must not override it).
      let structuralPick:
        | {
          proposal: StructuralResonanceProposal;
          reach: AncestorReach;
          idf: number;
        }
        | null = null;
      if (containers.length === 0) {
        // Structural-resonance composes each side's OWN gist directly (no
        // byte-containment truth backs it, unlike the DAG tiers) — so, unlike
        // the DAG ladder (which tolerates one approximate side because byte
        // containment cannot lie), the ANN tier requires BOTH sides to be
        // KNOWN (content-addressed, exact identities): an approximate chunk
        // fragment's own resonance is noise at any tier, and composing noise
        // into a synthetic gist only manufactures a plausible-looking but
        // spurious ANN neighbour, not evidence of a genuine joint whole.
        // PHRASE-SCALE CONTRACT — the same one the DAG tiers hold their glue
        // to (see maxInterior above): a junction, exact or approximate, is a
        // whole the two forms nearly exhaust, not two arbitrary landmarks
        // anywhere in a long, multi-topic query.  Without this, structural-
        // resonance would pair opposite ends of an unrelated scaffolding-
        // dominated query and manufacture a plausible-looking ANN neighbour
        // for a "gap" that never was a phrase.
        // BOTH sides must be independently DISCRIMINATIVE (individually
        // voted — `strong`, not merely a content-addressed `known` chunk):
        // a shared, non-discriminative scaffolding run (a repeated system
        // preamble) can be `known` without ever being distinctive evidence
        // of anything, and composing its own gist into a synthetic query
        // manufactures a plausible-looking but spurious ANN neighbour.  The
        // DAG tiers can tolerate one merely-`known` side because byte
        // containment cannot lie; structural-resonance has no such
        // backstop, so both sides earn their place here the same way an
        // ordinary approximate region earns its individual vote.
        const gap = rb.start - ra.end;
        const reasons: NonNullable<
          StructuralResonanceTrace["ineligibleReasons"]
        > = [];
        if (between.length > 0) reasons.push("between-region");
        if (!strong.has(cand[a]) || !strong.has(cand[b])) {
          reasons.push("not-both-strong");
        }
        if (!ra.known || !rb.known) reasons.push("not-both-known");
        if (gap > maxInterior) reasons.push("gap-too-large");
        let resonanceTrace: StructuralResonanceTrace | undefined;
        if (reasons.length > 0) {
          if (probe) {
            resonanceTrace = {
              variantBudget: ctx.cfg.haloQueryK,
              variants: [],
              mergedProposals: 0,
              examined: [],
              noiseFloor: estimatorNoise(ctx.store.D),
              outcome: "ineligible",
              ineligibleReasons: reasons,
            };
            probe.resonance = resonanceTrace;
          }
        } else {
          if (probe) {
            // `outcome`/`noiseFloor` are required fields with no natural
            // "unset" value; structuralResonance (called just below) always
            // overwrites both before returning, on every one of its exit
            // paths — these are never read in their initial form.
            resonanceTrace = {
              variantBudget: ctx.cfg.haloQueryK,
              variants: [],
              mergedProposals: 0,
              examined: [],
              noiseFloor: 0,
              outcome: "empty",
            };
            probe.resonance = resonanceTrace;
          }
          const ownRootsA = rvs.votes.find((v) =>
            v.start === ra.start && v.end === ra.end
          )?.roots;
          const ownRootsB = rvs.votes.find((v) =>
            v.start === rb.start && v.end === rb.end
          )?.roots;
          structuralPick = await structuralResonance(
            ctx,
            query,
            ra,
            rb,
            sides,
            k,
            N,
            reachMemo,
            ownRootsA,
            ownRootsB,
            resonanceTrace,
          );
        }
        if (structuralPick === null) {
          pushProbe(
            reasons.length > 0 ? "resonance-ineligible" : "resonance-rejected",
          );
          continue;
        }
        tier = "structural-resonance";
      }

      let best: (Junction | SynonymJunction) | null = null;
      let bestExtras: number[] = [];
      let bestCov = -1;
      let reach: AncestorReach;
      let idf: number;
      let confidence: number;

      if (structuralPick !== null) {
        // A resonance proposal is NOT a Junction — there is no container to
        // read bytes from, so the self-evidence/contradiction/N-ary
        // machinery below (byte-verified against a real container) does not
        // apply; per spec §13, no N-ary extra-region coverage for resonance
        // proposals.
        best = { id: structuralPick.proposal.id, interior: new Uint8Array(0) };
        bestExtras = [];
        bestCov = rb.end - ra.start;
        reach = structuralPick.reach;
        idf = structuralPick.idf;
        confidence = structuralPick.proposal.effectiveScore;
      } else {
        // Aggregate structural-tier trace (spec §4) — one per DAG tier that
        // returned at least one container (exact, single-synonym or
        // double-synonym); only aggregate counts and the final outcome are
        // recorded, never every candidate.
        const structuralTrace: CrossRegionStructuralTrace | undefined = probe
          ? {
            tier: tier as "exact" | "single-synonym" | "double-synonym",
            selfEvidenceRejected: 0,
            contradictionRejected: 0,
            passedGuards: 0,
            outcome: "all-rejected",
          }
          : undefined;
        if (probe) probe.structural = structuralTrace;

        // N-ARY selection: the container covering the MOST remaining candidate
        // forms wins (then tightest interior, then lowest id).  Reads are
        // cache hits — every container's bytes were already read by the walk.
        //
        // SELF-EVIDENCE GUARD: a junction is BINDING evidence only when the
        // container joins forms the query mentions APART.  When the container's
        // own joined occurrence (left..right including its interior) is a
        // literal substring of the query, the query already spells that phrase
        // out contiguously — perception already voted with it, and grid shards
        // of one phrase pairing "around" a gap chunk would merely rediscover
        // the phrase they are shards of, then explain away its rivals.
        for (const c of containers) {
          const bytes = cachedRead(ctx, cache, c.id, cap);
          const li = indexOf(bytes, left, 0);
          const ri = indexOf(bytes, right, 0);
          if (li >= 0 && ri >= 0) {
            const joined = bytes.subarray(
              Math.min(li, ri),
              Math.max(li + left.length, ri + right.length),
            );
            if (indexOf(query, joined, 0) >= 0) {
              if (structuralTrace) structuralTrace.selfEvidenceRejected++;
              continue; // query says it itself
            }
          }
          // CONTRADICTION GUARD: a between-region already carrying its own
          // vote must actually recur in this container's bytes — otherwise
          // the container is a different learnt whole that happens to share
          // ra/rb, and letting it stand in for the gap would silently
          // override evidence the query itself already resolved there.
          if (
            between.some((bi) =>
              indexOf(
                bytes,
                query.subarray(regions[bi].start, regions[bi].end),
                0,
              ) < 0
            )
          ) {
            if (structuralTrace) structuralTrace.contradictionRejected++;
            continue;
          }
          if (structuralTrace) structuralTrace.passedGuards++;
          let cov = left.length + right.length;
          const extras: number[] = [];
          for (const ei of cand) {
            if (ei === cand[a] || ei === cand[b] || consumed.has(ei)) continue;
            const e = regions[ei];
            if (overlapsSpan(e, ra) || overlapsSpan(e, rb)) continue;
            const eb = query.subarray(e.start, e.end);
            if (indexOf(bytes, eb, 0) >= 0) {
              extras.push(ei);
              cov += eb.length;
            }
          }
          if (
            cov > bestCov ||
            (cov === bestCov && best !== null &&
              (c.interior.length < best.interior.length ||
                (c.interior.length === best.interior.length && c.id < best.id)))
          ) {
            best = c;
            bestExtras = extras;
            bestCov = cov;
          }
        }
        if (best === null) {
          // every container was self-evidence / contradiction — outcome
          // stays "all-rejected".
          pushProbe("structural-rejected");
          continue;
        }

        const r = edgeAncestors(ctx, best.id, N, reachMemo);
        if (r.saturated || r.roots.length === 0) {
          if (structuralTrace) {
            structuralTrace.outcome = r.saturated ? "saturated" : "no-roots";
          }
          pushProbe("structural-rejected");
          continue;
        }
        const df = Math.log(N / Math.max(1, r.contextsReached));
        if (df <= 0) {
          if (structuralTrace) structuralTrace.outcome = "nonpositive-idf";
          pushProbe("structural-rejected");
          continue;
        }
        if (structuralTrace) {
          structuralTrace.outcome = "accepted";
          structuralTrace.selectedNode = best.id;
        }
        reach = r;
        idf = df;
        // Confidence used by voting (spec §13): exact junction = 1;
        // single/double-synonym = the sibling(s)' score(s), carried on the
        // SynonymJunction the ladder selected.
        confidence = "confidence" in best ? best.confidence : 1;
      }

      // MUTUAL-EXPLANATION WEIGHT — the same formula for every tier, with
      // `confidence` collapsed to certainty (1) for exact evidence: under
      // that collapse this is byte-for-byte the old exact-only formula
      // (min(1,ratio)·min(1,1/ratio)).  For structural-resonance,
      // `confidence` is already annScore·semanticConfidence — never
      // multiplied a second time.
      const lenR = Math.max(1, bestCov);
      const ratio = Math.sqrt(
        Math.max(1, ctx.store.contentLen(best.id, lenR * ctx.store.D)) / lenR,
      );
      const mutual = Math.min(1, confidence * ratio) *
        Math.min(1, confidence / ratio);
      const w = (mutual * idf) / reach.roots.length;
      let spanStart = ra.start;
      let spanEnd = rb.end;
      for (const ei of bestExtras) {
        spanStart = Math.min(spanStart, regions[ei].start);
        spanEnd = Math.max(spanEnd, regions[ei].end);
      }
      consumed.add(cand[a]);
      consumed.add(cand[b]);
      for (const ei of bestExtras) consumed.add(ei);

      // EXPLAINING AWAY — see the block comment above the function.  Byte
      // containment in the joint container is the relatedness test (the
      // vote's bytes are literally part of the learnt whole), and FULL root
      // disjointness is the disagreement test: a vote sharing even one root
      // with the junction corroborates it and keeps its say elsewhere.
      // Counted BEFORE pushing the junction's own vote below: each ORIGINAL
      // region this ascent explains away is evidence the junction speaks
      // for, not evidence lost — `absorbed` (RegionVote's breadth-accounting
      // field) must credit the junction with all of it, not just the ONE
      // pooled axiom it collapses to.
      // Only EXACT DAG evidence may explain away ordinary votes (spec §15).
      // Single-synonym, double-synonym, and structural-resonance may ADD
      // supporting evidence but never remove it: their evidence is itself
      // approximate (a sibling substitution, or an ANN guess), so treating
      // their byte-containment the way exact containment is treated would
      // let an approximation override a genuine, independently-voted region.
      let explainedAway = 0;
      // Exact set of ORIGINAL region indices this junction explained away —
      // recorded live as `superseded.add` fires (spec §3's explicit rule:
      // never inferred from `absorbed` afterward).
      const explainedAwayIndices: number[] = [];
      if (tier === "exact") {
        const containerBytes = cachedRead(ctx, cache, best.id, cap);
        const jointRoots = new Set(reach.roots);
        for (const rv of rvs.votes) {
          if (rv.roots.some((r) => jointRoots.has(r))) continue;
          const bytes = query.subarray(rv.start, rv.end);
          if (indexOf(containerBytes, bytes, 0) >= 0 && !superseded.has(rv)) {
            superseded.add(rv);
            explainedAway++;
            if (td) {
              const idx = regions.findIndex((r) =>
                r.start === rv.start && r.end === rv.end
              );
              if (idx >= 0) explainedAwayIndices.push(idx);
            }
          }
        }
      }

      out.push({
        start: spanStart,
        end: spanEnd,
        canonicalFailed: false, // content-addressed: never saturation-masked
        roots: reach.roots,
        w,
        wFocus: w,
        absorbed: 1 + explainedAway,
      });
      pushProbe("accepted");
      if (td) {
        td.crossRegionJunctionVotes.push({
          container: best.id,
          span: [spanStart, spanEnd],
          roots: [...reach.roots],
          sourceRegionIndices: [cand[a], cand[b], ...bestExtras],
          explainedAwayRegionIndices: explainedAwayIndices,
          absorbed: 1 + explainedAway,
          tier,
          probe: td.crossRegionProbes.length - 1,
          confidence,
          evidenceBytes: bestCov,
          mutualWeight: mutual,
          voteWeightPerRoot: w,
        });
      }

      const label = [cand[a], cand[b], ...bestExtras]
        .sort((x, y) => regions[x].start - regions[y].start)
        .map((ri) => dec(query.subarray(regions[ri].start, regions[ri].end)))
        .join(" ▸ ");
      const tierNote = tier === "exact"
        ? `junction node ${best.id}` +
          (best.interior.length === 0
            ? " (adjacent)"
            : ` (interior "${dec(best.interior)}")`) +
          ", by content-addressed ascent"
        : tier === "structural-resonance"
        ? `structurally-composed ANN proposal, node ${best.id} — the query ` +
          `structurally composed the endpoint regions, the real middle-` +
          `query structure, and the selected halo-sibling endpoint ` +
          `direction(s) (variant ${structuralPick!.proposal.variant}, ` +
          `annScore ${structuralPick!.proposal.annScore.toFixed(3)} × ` +
          `semanticConfidence ${
            structuralPick!.proposal.semanticConfidence.toFixed(3)
          } = effectiveScore ${
            structuralPick!.proposal.effectiveScore.toFixed(3)
          }); it did not concatenate endpoint bytes or rewrite the query`
        : `${tier} junction node ${best.id}` +
          (best.interior.length === 0
            ? " (adjacent)"
            : ` (interior "${dec(best.interior)}")`) +
          `, by halo-sibling DAG ascent (confidence ${confidence.toFixed(3)})`;
      ctx.trace?.step(
        "crossRegion",
        [{ text: label, role: "pair" }],
        reach.roots.map((r) => ({
          text: dec(read(ctx, r)).slice(0, 60),
          node: r,
          role: "joint-context",
        })),
        `${label} → ${tierNote} → ${reach.roots.length} context(s)` +
          (superseded.size > 0
            ? `; ${superseded.size} aliasing vote(s) explained away`
            : ""),
      );
      break; // ra is consumed — move to the next unconsumed candidate
    }
  }

  if (td) td.supersededOrdinaryVotes = superseded.size;
  if (td?.crossRegionSummary) {
    td.crossRegionSummary.stopReason = probes >= k
      ? "probe-limit"
      : "pairs-exhausted";
  }
  return { votes: out, superseded };
}

/** Emit the "climbConsensus" step — the human-readable note this always
 *  produced, now paired (when `ctx.trace` and `cfg` are both present) with
 *  the structured {@link ClimbConsensusData} payload on the SAME step's
 *  `data` field.  Every exit of {@link computeAttention} funnels through
 *  here, so instrumentation and the existing rationale text can never drift
 *  apart — see the instrumentation spec's §9 "every exit path". */
export function traceAttention(
  ctx: MindContext,
  regions: ReadonlyArray<{ start: number; end: number }>,
  regionVoter: ReadonlyArray<{ id: number; score: number; w: number } | null>,
  roots: ReadonlyArray<Attention>,
  steps: ReadonlyArray<DerivationStep> = [],
  td?: TraceDraft,
  cfg?: ClimbConsensusCfg,
  ranked: ReadonlyArray<Attention> = roots,
): void {
  if (!ctx.trace) return;
  const voters: RationaleItem[] = [];
  for (let i = 0; i < regions.length; i++) {
    const rv = regionVoter[i];
    if (rv == null) continue;
    const item = rNode(ctx, rv.id, "sub-region", rv.score);
    item.text = `${item.text}  (df-w ${rv.w.toFixed(2)})`;
    voters.push(item);
  }
  const t = ctx.trace.enter("climbConsensus", voters);
  // The pooled-evidence decision, one DerivationStep per anchor — the same
  // shape {@link GraphSearch}'s own cover steps take (see traceDerivation).
  if (steps.length > 0) traceDerivation(ctx, steps);

  const data: ClimbConsensusData | undefined = (td && cfg)
    ? {
      version: 1,
      cache: { hit: false, detailAvailable: true },
      config: {
        annK: cfg.k,
        crossRegionProbeLimit: cfg.k,
        mode: cfg.mode,
        ...(cfg.N !== undefined ? { corpusN: cfg.N } : {}),
        dimension: ctx.store.D,
        ...(cfg.N !== undefined ? { hubBound: hubBound(ctx) } : {}),
        estimatorNoise: estimatorNoise(ctx.store.D),
        ...(cfg.naturalBreak !== undefined
          ? { naturalBreak: cfg.naturalBreak }
          : {}),
        ...(cfg.consensusFloor !== undefined
          ? { consensusFloor: cfg.consensusFloor }
          : {}),
      },
      candidates: {
        perceived: cfg.perceivedCount,
        recognised: cfg.totalRegions - cfg.perceivedCount,
        total: cfg.totalRegions,
      },
      ...(td.regions.length > 0 ? { regions: td.regions } : {}),
      ...(cfg.reachMemo ? { reaches: serialiseReaches(cfg.reachMemo) } : {}),
      ...(td.crossRegionSummary
        ? {
          crossRegion: {
            eligibleRegions: td.crossRegionSummary.eligibleRegions,
            maximalRegions: td.crossRegionSummary.maximalRegions,
            probeLimit: td.crossRegionSummary.probeLimit,
            probesAttempted: td.crossRegionSummary.probesAttempted,
            junctionVotes: td.crossRegionJunctionVotes,
            supersededOrdinaryVotes: td.supersededOrdinaryVotes,
            probes: td.crossRegionProbes,
            stopReason: td.crossRegionSummary.stopReason ?? "pairs-exhausted",
          },
        }
        : {}),
      ...(td.saturation ? { saturation: td.saturation } : {}),
      ...(td.pooling ? { pooling: td.pooling } : {}),
      ...(td.anchors.length > 0 ? { anchors: td.anchors } : {}),
      result: { roots: [...roots], ranked: [...ranked] },
    }
    : undefined;

  t.done(
    roots.map((r) => rNode(ctx, r.anchor, "anchor", r.vote)),
    roots.length === 0
      ? `${regions.length} sub-regions climbed the DAG, but none agreed on a context`
      : roots.length === 1
      ? `${voters.length} of ${regions.length} sub-regions voted; IDF-weighted consensus picked one context (vote ${
        roots[0].vote.toFixed(2)
      })`
      : `${voters.length} of ${regions.length} sub-regions voted; consensus ordered ${roots.length} INDEPENDENT points of attention (votes ${
        roots.map((r) => r.vote.toFixed(2)).join(", ")
      })`,
    data,
  );
}
