// mechanisms/cover.ts — Cover (Grounding II): the query's own decomposition
// composes an answer through ONE lightest-derivation search.
//
// Cover consumes recognition directly (its axioms are the query's own
// decomposition) plus the computed spans any parse()-bearing mechanism
// contributed: computed spans MASK colliding recognised sites and enter the
// search at zero cost ("computation always wins", alu.md) — which is also why
// cover runs FIRST in defaultMechanisms: a computed-backed cover becomes a
// near-zero-cost incumbent that prunes the other mechanisms through the
// ordinary admissible-floor check, with no extension special-case anywhere.

import type { MindContext } from "../types.js";
import type {
  ComputedResult,
  ConceptLicence,
  ConnectorLicence,
  DerivationStep,
  Site,
} from "../graph-search.js";
import { read, resolve } from "../primitives.js";
import { guidedFirst, hubBound } from "../traverse.js";
import { conceptHop } from "../match.js";
import { bridge } from "../resonance.js";
import { liftAnswer, liftedScaffolding, segRestatesQuery } from "../types.js";
import { decodeText } from "../rationale.js";
import { insideAnsweredTurn, restates } from "../derivation.js";
import type { RationaleItem } from "../rationale.js";
import { rItem, rNode, traceDerivation } from "../trace.js";
import type { PipelineMechanism } from "../pipeline-mechanism.js";

// ── Concept / connector pre-resolution ──────────────────────────────────────

/** The concept hops the cover may take, OFFERED up front and looked up only
 *  when the search asks (see {@link Licence}): every recognised form with no
 *  continuation of its own may borrow a halo sibling's. */
export interface CoverConcepts extends ConceptLicence {
  /** Look up the asked forms' concept targets not yet granted. */
  grant(nodes: Iterable<number>): Promise<void>;
}

export function offerConcepts(
  ctx: MindContext,
  sites: ReadonlyArray<Site>,
): CoverConcepts {
  const offered = new Set<number>();
  for (const { payload: n } of sites) {
    if (!offered.has(n) && !ctx.store.hasNext(n)) offered.add(n);
  }
  const granted = new Map<number, number | null>();
  return {
    offered,
    granted,
    asked: new Set(),
    async grant(nodes) {
      const found: Array<[number, number]> = [];
      for (const n of nodes) {
        if (granted.has(n)) continue;
        const hop = await conceptHop(ctx, n);
        granted.set(n, hop);
        if (hop !== null) found.push([n, hop]);
      }
      if (found.length > 0) {
        ctx.trace?.step(
          "resolveConcepts",
          found.map(([n]) => rNode(ctx, n, "edgeless-form")),
          found.map(([, h]) => rNode(ctx, h, "concept-sibling")),
          "borrow a synonym's continuation edge for each edge-less form the search reached (a concept/halo hop)",
        );
      }
    },
  };
}

/** The connectors the cover may splice, OFFERED up front and BRIDGED only when
 *  the search asks (see {@link ConnectorLicence}): every pair a learnt whole
 *  could run together — two touching sites, each side as itself or as its
 *  answer, in both orders — and, when three or more answers are recognised, the
 *  first answer to each later one (the N-ary whole). */
export interface CoverConnectors extends ConnectorLicence {
  /** Bridge the asked pairs not yet granted. */
  grant(keys: Iterable<string>): Promise<void>;
}

export function offerConnectors(
  ctx: MindContext,
  sites: ReadonlyArray<Site>,
  query?: Uint8Array,
): CoverConnectors {
  const answerOf = (n: number) => guidedFirst(ctx, n) ?? n;
  // A site's continuation already present elsewhere in the query is stale
  // transcript evidence: cover still needs the site for structural context,
  // but liftAnswer will trim that continuation as already answered. Offering
  // pairwise/n-ary bridges for it can only create connectors that are later
  // discarded — a semantically neutral gate (it removes work whose product
  // liftAnswer throws away), and a cumulative (multi-turn) query is exactly
  // where such already-answered continuations recur.
  const answered = { at: 0 };
  const ordered = [...sites]
    .sort((a, b) => a.start - b.start)
    .filter((s) => {
      if (insideAnsweredTurn(ctx.answeredSpans, answered, s.start, s.end)) {
        return false;
      }
      if (query === undefined || ctx.answeredSpans.length === 0) return true;
      const continuations = ctx.store.nextFirst(s.payload, hubBound(ctx));
      return !continuations.some((answer) => {
        // PREFIX-CAPPED (bounded-reads.md): a candidate longer than the query
        // cannot occur INSIDE it, so read one byte past the query's length —
        // enough to detect the overflow — and reject without reconstructing the
        // rest. The `+ 1` is what makes the test exact rather than a
        // truncation: a result of exactly `query.length + 1` bytes is known to
        // be too long, and anything shorter is the candidate's COMPLETE
        // content, so the substring test below is the same test as before. (The
        // same overflow probe bridge.ts:256 already uses.)
        //
        // This loop runs up to hubBound(ctx) = √N reads PER SITE, and only on a
        // multi-turn response — `answeredSpans` is empty for a plain respond(),
        // so the probe does not execute there. The cap cannot reduce the read
        // COUNT — only a semantic change to the "already answered" test could —
        // but it bounds each read by the query instead of by the corpus, which
        // is what bounded-reads.md asks for and what rescues a SHORT query: at
        // 3 bytes this reads 4 bytes per candidate instead of the ~231 it
        // averaged before.
        const bytes = read(ctx, answer, query.length + 1);
        // THE CONTENT READING of the same exclusion: the site's own
        // continuation already occurs in the query, so voicing it back adds
        // nothing.  It is the restatement law with no `proper` flag — the
        // containment reading that also admits the whole query.
        return restates(query, bytes, 0);
      });
    });
  const pairwise = new Set<string>();
  for (let i = 0; i + 1 < ordered.length; i++) {
    if (ordered[i].end !== ordered[i + 1].start) continue;
    const lefts = [ordered[i].payload, answerOf(ordered[i].payload)];
    const rights = [ordered[i + 1].payload, answerOf(ordered[i + 1].payload)];
    for (const l of new Set(lefts)) {
      for (const r of new Set(rights)) {
        if (l === r) continue;
        pairwise.add(l + "," + r);
        pairwise.add(r + "," + l);
      }
    }
  }
  const orderedNodes: Array<{ node: number; bytes: Uint8Array }> = [];
  const seenN = new Set<number>();
  for (const s of ordered) {
    const node = guidedFirst(ctx, s.payload) ?? s.payload;
    if (seenN.has(node)) continue;
    seenN.add(node);
    orderedNodes.push({ node, bytes: read(ctx, node) });
  }
  const nary = new Map<
    string,
    { left: Uint8Array; right: Uint8Array; allowance: number }
  >();
  if (orderedNodes.length >= 3) {
    const first = orderedNodes[0];
    const W = ctx.space.maxGroup;
    let middleBytes = 0; // Σ bytes of the answers BETWEEN first and m-th
    for (let m = 1; m < orderedNodes.length; m++) {
      // The N-ary interior legitimately holds every intermediate answer
      // plus one W-quantum of glue per joint — pass that allowance so the
      // bridge's phrase-scale cap admits the whole learnt run.  Asked only
      // when the pairwise bridge of the same key (if offered) found nothing.
      nary.set(first.node + "," + orderedNodes[m].node, {
        left: first.bytes,
        right: orderedNodes[m].bytes,
        allowance: middleBytes + (m + 1) * W,
      });
      middleBytes += orderedNodes[m].bytes.length;
    }
  }
  const granted = new Map<string, Uint8Array | null>();
  return {
    offered: new Set([...pairwise, ...nary.keys()]),
    granted,
    asked: new Set(),
    async grant(keys) {
      const found: Array<[string, Uint8Array]> = [];
      for (const key of keys) {
        if (granted.has(key)) continue;
        let link: Uint8Array | null = null;
        if (pairwise.has(key)) {
          const comma = key.indexOf(",");
          if (ctx.meter) ctx.meter.coverBridges++;
          link = await bridge(
            ctx,
            read(ctx, Number(key.slice(0, comma))),
            read(ctx, Number(key.slice(comma + 1))),
          );
        }
        const whole = nary.get(key);
        if (link === null && whole !== undefined) {
          if (ctx.meter) {
            ctx.meter.coverBridges++;
            ctx.meter.coverAllowanceBytes += whole.allowance;
          }
          link = await bridge(ctx, whole.left, whole.right, whole.allowance);
        }
        granted.set(key, link);
        if (link !== null) found.push([key, link]);
      }
      if (found.length > 0) {
        ctx.trace?.step(
          "resolveConnectors",
          ordered.map((s) => rItem(read(ctx, s.payload), "answer", s.payload)),
          found.map(([pair, bytes]) => ({
            text: `${pair}: "${decodeText(bytes)}"`,
            role: "connector",
          } as RationaleItem)),
          "the bytes the graph splices between adjacent answers the search reached (asked of the gist space)",
        );
      }
    },
  };
}

// ── Pipeline mechanism ──────────────────────────────────────────────────────

export const coverMechanism: PipelineMechanism = {
  name: "cover",
  provenance: "cover",
  async floor(_ctx, _query, _pre, _worthRunning) {
    return 0;
  },
  async run(ctx, query, pre) {
    const { rec, computed } = pre;

    // Masking: computed spans are authoritative.  Remove recognised sites
    // that overlap any computed span before building the cover search.
    const sites = computed.length === 0
      ? rec.sites
      : rec.sites.filter((s) =>
        !computed.some((u) => s.start < u.j && u.i < s.end)
      );

    if (computed.length > 0 && sites.length < rec.sites.length) {
      ctx.trace?.step(
        "maskByComputation",
        rec.sites.map((s) =>
          rItem(query.subarray(s.start, s.end), "form", s.payload, [
            s.start,
            s.end,
          ])
        ),
        sites.map((s) =>
          rItem(query.subarray(s.start, s.end), "form", s.payload, [
            s.start,
            s.end,
          ])
        ),
        "a computation always wins: recognised forms overlapping a computed span are dropped",
      );
    }

    if (sites.length === 0 && computed.length === 0) return [];

    const connectors = ctx.meter
      ? ctx.meter.timeSync(
        "cover.offerConnectors",
        () => offerConnectors(ctx, sites, query),
      )
      : offerConnectors(ctx, sites, query);
    let splits = rec.splits;
    if (computed.length > 0) {
      splits = new Set(rec.splits);
      for (const u of computed) {
        splits.add(u.i);
        splits.add(u.j);
      }
    }
    const concepts = ctx.meter
      ? ctx.meter.timeSync(
        "cover.offerConcepts",
        () => offerConcepts(ctx, sites),
      )
      : offerConcepts(ctx, sites);

    const coverDeps = [
      ctx.trace?.lastIndex("recognise"),
      ctx.trace?.lastIndex("computeExtensions"),
    ].filter((x): x is number => x !== undefined);

    // Convert ComputedSpan[] to ComputedResult[] for the graph search.
    const computedResults: ComputedResult[] = computed.map((u) => ({
      i: u.i,
      j: u.j,
      bytes: u.bytes,
      node: resolve(ctx, u.bytes) ?? undefined,
    }));

    const tCover = ctx.trace?.enter("cover", [
      ...sites.map((s) =>
        rItem(query.subarray(s.start, s.end), "form", s.payload, [
          s.start,
          s.end,
        ])
      ),
      ...computedResults.map((u) => rItem(u.bytes, "computed")),
    ], coverDeps.length ? coverDeps : undefined);

    // COVER, GRANT WHAT IT ASKED, COVER AGAIN — until a cover asks for nothing
    // (see Licence in graph-search.ts).  Only the final cover's derivations reach the
    // rationale; a provisional one is superseded, not part of the answer.
    let derivations: DerivationStep[][] = [];
    let solved: ReturnType<typeof ctx.search.cover>;
    for (;;) {
      derivations = [];
      solved = ctx.search.cover(
        query.length,
        sites,
        concepts,
        rec.leaves,
        splits,
        undefined,
        connectors,
        computedResults,
        ctx.trace ? (steps) => derivations.push(steps) : undefined,
      );
      if (concepts.asked.size === 0 && connectors.asked.size === 0) break;
      const grant = async () => {
        await concepts.grant([...concepts.asked]);
        await connectors.grant([...connectors.asked]);
      };
      if (ctx.meter) await ctx.meter.time("cover.grant", grant);
      else await grant();
    }
    for (const steps of derivations) traceDerivation(ctx, steps);
    const segs = solved && solved.segs;
    tCover?.done(
      segs === null
        ? []
        : segs.map((s) =>
          rItem(s.bytes, s.rec ? "chosen" : "bridge", s.node, [s.i, s.j])
        ),
      segs === null
        ? "no cover of the query composed"
        : "lightest derivation: the chosen spans, left to right",
    );

    if (segs === null) return [];

    const W = ctx.space.maxGroup;
    // A chosen span's SUBSTITUTED bytes (an edge followed from a recognised
    // site, not the site's own literal text read back) that equal a byte
    // span the query ALREADY CONTAINS elsewhere restates part of the
    // question — never an answer (see {@link segRestatesQuery}).  A
    // recognised site that is itself an entire PRIOR TURN of a multi-turn
    // query is exactly this shape: it carries a genuine learnt
    // continuation, but that continuation is something the asker already
    // said moments later in the SAME query.  liftAnswer TRIMS such spans
    // out of both the framing decision and the final concatenation — the
    // OTHER spans a derivation chose are independent evidence and must not
    // be discarded along with the stale one.
    const restated = segs.filter((s) =>
      segRestatesQuery(s, query, query.length, W)
    );
    if (restated.length > 0) {
      ctx.trace?.step(
        "restatedSpan",
        restated.map((s) => rItem(s.bytes, "substituted", s.node, [s.i, s.j])),
        [],
        "the chosen span's substitution already occurs elsewhere in the query — trimmed from the answer, not an answer itself",
      );
    }

    const composed = liftAnswer(segs, query.length, query, W);
    if (composed === null) return [];

    ctx.trace?.step(
      "liftAnswer",
      segs.map((s) =>
        rItem(s.bytes, s.rec ? "chosen" : "scaffolding", s.node, [s.i, s.j])
      ),
      [rItem(composed, "answer", resolve(ctx, composed) ?? undefined)],
      "lift the recognised region out of the asker's framing",
      tCover ? [tCover.index] : undefined,
    );

    // accounted = RECOGNISED, non-restating cover spans only — a trimmed
    // restated span contributes nothing to the composed answer, so it must
    // not be priced as if it did (PASS-carried bytes are priced already;
    // the diagnostic label reflects the same distinction).
    const accounted: Array<[number, number]> = segs
      .filter((s) => s.rec && !segRestatesQuery(s, query, query.length, W))
      .map((s) => [s.i, s.j]);

    return [{
      bytes: composed,
      accounted,
      // The derivation's DISCRETE work.  The bytes the chart could not
      // recognise are NOT priced here: they are exactly the spans `accounted`
      // leaves uncovered, and the pipeline's one formula charges them at PASS —
      // the same formula that prices every other mechanism's candidate.  No
      // mechanism spells a cost of its own.
      moves: solved!.moves,
      // How much of the composed answer is the asker's own unexplained words
      // (the spans the liftAnswer trace above labels "scaffolding").  Cover is
      // the mechanism that can carry them, because a PASS span still lands in
      // the cover it returns.
      scaffolding: liftedScaffolding(segs, query.length, query, W),
    }];
  },
};
