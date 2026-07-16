// mechanisms/cover.ts — Cover (Grounding II): the query's own decomposition
// composes an answer through ONE lightest-derivation search.
//
// Cover consumes recognition directly (its axioms are the query's own
// decomposition) plus the computed spans any parse()-bearing mechanism
// contributed: computed spans MASK colliding recognised sites and enter the
// search at zero cost ("computation always wins", §16.3) — which is also why
// cover runs FIRST in defaultMechanisms: a computed-backed cover becomes a
// near-zero-cost incumbent that prunes the other mechanisms through the
// ordinary admissible-floor check, with no extension special-case anywhere.
import { read, resolve } from "../primitives.js";
import { guidedFirst } from "../traverse.js";
import { conceptHop } from "../match.js";
import { bridge } from "../resonance.js";
import { liftAnswer } from "../types.js";
import { decodeText, unexplainedLabel } from "../rationale.js";
import { rItem, rNode, traceDerivation } from "../trace.js";
// ── Concept / connector pre-resolution ──────────────────────────────────────
export async function resolveConcepts(ctx, sites) {
  const target = new Map();
  const visited = new Set();
  for (const { payload: n } of sites) {
    if (visited.has(n)) {
      continue;
    }
    visited.add(n);
    if (ctx.store.hasNext(n)) {
      continue;
    }
    const hop = await conceptHop(ctx, n);
    if (hop !== null) {
      target.set(n, hop);
    }
  }
  if (target.size > 0) {
    ctx.trace?.step(
      "resolveConcepts",
      [...target.keys()].map((n) => rNode(ctx, n, "edgeless-form")),
      [...target.values()].map((h) => rNode(ctx, h, "concept-sibling")),
      "borrow a synonym's continuation edge for each edge-less form (a concept/halo hop)",
    );
  }
  return target;
}
export async function resolveConnectors(ctx, sites) {
  const links = new Map();
  const ordered = [...sites].sort((a, b) => a.start - b.start);
  const answerOf = (n) => guidedFirst(ctx, n) ?? n;
  const bridgePair = async (l, r) => {
    if (l === r || links.has(l + "," + r)) {
      return;
    }
    const link = await bridge(ctx, read(ctx, l), read(ctx, r));
    if (link !== null) {
      links.set(l + "," + r, link);
    }
  };
  for (let i = 0; i + 1 < ordered.length; i++) {
    if (ordered[i].end !== ordered[i + 1].start) {
      continue;
    }
    const lefts = [ordered[i].payload, answerOf(ordered[i].payload)];
    const rights = [ordered[i + 1].payload, answerOf(ordered[i + 1].payload)];
    for (const l of new Set(lefts)) {
      for (const r of new Set(rights)) {
        await bridgePair(l, r);
        await bridgePair(r, l);
      }
    }
  }
  const orderedNodes = [];
  const seenN = new Set();
  for (const s of ordered) {
    const node = guidedFirst(ctx, s.payload) ?? s.payload;
    if (seenN.has(node)) {
      continue;
    }
    seenN.add(node);
    orderedNodes.push({ node, bytes: read(ctx, node) });
  }
  if (orderedNodes.length >= 3) {
    const first = orderedNodes[0];
    const W = ctx.space.maxGroup;
    let middleBytes = 0; // Σ bytes of the answers BETWEEN first and m-th
    for (let m = 1; m < orderedNodes.length; m++) {
      const key = first.node + "," + orderedNodes[m].node;
      if (links.has(key)) {
        middleBytes += orderedNodes[m].bytes.length;
        continue;
      }
      // The N-ary interior legitimately holds every intermediate answer
      // plus one W-quantum of glue per joint — pass that allowance so the
      // bridge's phrase-scale cap admits the whole learnt run.
      const allowance = middleBytes + (m + 1) * W;
      const interior = await bridge(
        ctx,
        first.bytes,
        orderedNodes[m].bytes,
        allowance,
      );
      if (interior !== null) {
        links.set(key, interior);
      }
      middleBytes += orderedNodes[m].bytes.length;
    }
  }
  if (links.size > 0) {
    ctx.trace?.step(
      "resolveConnectors",
      ordered.map((s) => rItem(read(ctx, s.payload), "answer", s.payload)),
      [...links.entries()].map(([pair, bytes]) => ({
        text: `${pair}: "${decodeText(bytes)}"`,
        role: "connector",
      })),
      "the bytes the graph splices between adjacent answers (asked of the gist space)",
    );
  }
  return links;
}
// ── Pipeline mechanism ──────────────────────────────────────────────────────
export const coverMechanism = {
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
    if (sites.length === 0 && computed.length === 0) {
      return [];
    }
    const connectors = await resolveConnectors(ctx, sites);
    let splits = rec.splits;
    if (computed.length > 0) {
      splits = new Set(rec.splits);
      for (const u of computed) {
        splits.add(u.i);
        splits.add(u.j);
      }
    }
    const concepts = await resolveConcepts(ctx, sites);
    const coverDeps = [
      ctx.trace?.lastIndex("recognise"),
      ctx.trace?.lastIndex("computeExtensions"),
      ctx.trace?.lastIndex("resolveConcepts"),
      ctx.trace?.lastIndex("resolveConnectors"),
    ].filter((x) => x !== undefined);
    // Convert ComputedSpan[] to ComputedResult[] for the graph search.
    const computedResults = computed.map((u) => ({
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
    const solved = ctx.search.cover(
      query.length,
      sites,
      concepts,
      rec.leaves,
      splits,
      undefined,
      connectors,
      computedResults,
      ctx.trace ? (steps) => traceDerivation(ctx, steps) : undefined,
    );
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
    if (segs === null) {
      return [];
    }
    const composed = liftAnswer(segs, query.length);
    if (composed === null) {
      return [];
    }
    ctx.trace?.step(
      "liftAnswer",
      segs.map((s) =>
        rItem(s.bytes, s.rec ? "chosen" : "scaffolding", s.node, [s.i, s.j])
      ),
      [rItem(composed, "answer", resolve(ctx, composed) ?? undefined)],
      "lift the recognised region out of the asker's framing",
      tCover ? [tCover.index] : undefined,
    );
    // accounted = RECOGNISED cover spans only — PASS-carried bytes
    // are priced in cost already; the diagnostic label reflects the
    // same distinction.
    const accounted = segs
      .filter((s) => s.rec)
      .map((s) => [s.i, s.j]);
    return [{
      bytes: composed,
      accounted,
      moves: 0,
      weight: solved.cost, // A*LD derivation's g-value IS the weight
      unexplained: unexplainedLabel(query, accounted),
    }];
  },
};
