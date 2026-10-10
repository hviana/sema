// confluence.ts — Confluence Join (Section 4 of the mind).
//
// THE CLASS THIS SOLVES: conjunctive queries — answers that are stored in NO
// single fact and exist only as the INTERSECTION of independent evidence
// streams.  "Which material is translucent and featherlight?"  No learnt form
// contains the answer; each constraint reaches its own set of exemplars, and
// the entity satisfying both lives exactly where those sets MEET.  Every
// other mechanism produces its answer by following ONE evidence path (a
// chain, a reverse step, a halo hop, one aligned frame); the consensus climb
// SUMS votes, fusion CONCATENATES topics, CAST COMPARES two seats — none of
// them intersects, so this class was previously answered wrong (fusion pairs
// one fact per constraint, from DIFFERENT entities).
//
// THE MEET IS NATIVE, NOT A BYTE SCAN.  The store is content-addressed: any
// content two deposits share IS the same node id, interned once at write
// time (hash-consing) — so "what do these two facts have in common?" is a
// SET INTERSECTION OF IDENTITIES the write side already computed, asked
// through the canonical window read (leafIdRun/findBranch — the same
// write/read contract recognition runs on).  Three identity/structure tests
// make the whole mechanism:
//
//   • constraint streams — the consensus climb's ranked anchors, each bound
//     to the query spans whose DISCRIMINATIVE windows it holds by identity
//     (a resonance-voted anchor holding none of the query's discriminative
//     content is no constraint at all); two streams are independent when
//     the content they bind is disjoint;
//   • the meet — window ids present in BOTH anchors and ABSENT from the
//     query: shared-with-query windows are the constraint being re-named
//     (or its scaffolding), so subtracting the query's own window ids
//     leaves exactly the content the question asks FOR — the open seat;
//   • the filler/scaffolding separator — the same structural IDF the climb
//     derives (edgeAncestors' contextsReached): shared content reaching a
//     corpus minority of contexts is an entity, content reaching a majority
//     is frame scaffolding.  No statistics, no learning — the same global-
//     quantity-from-capped-local-probes reading that makes the climb's IDF
//     work, pointed at a new question.
//
// HONESTY: the meet can only ever name content that structurally exists in
// two independently learnt exemplars — an empty intersection yields null and
// the ordinary pipeline decides.  Confluence cannot fabricate.

import type { MindContext } from "../types.js";
import { read } from "../primitives.js";
import {
  convergenceMeets,
  convergenceOf,
  corpusN,
  heldEntity,
  holdsAThing,
  hubBound,
  reachOf,
} from "../traverse.js";
import { dominates } from "../../geometry.js";
import { STEP } from "../graph-search.js";
import { insideAnsweredTurn } from "../derivation.js";
import type { PipelineMechanism, Precomputed } from "../pipeline-mechanism.js";
import { rItem, rNode } from "../trace.js";

/** A join answer plus its elementary evidence for think's grounding decider:
 *  `accounted` — the query spans whose votes carried the two constraint
 *  streams; `moves` — the ladder cost of the acts performed (two constraint
 *  matches and one meet, STEP each).  `used` carries the pair's exemplar
 *  anchors so the reasoning stage does not re-speak them. */
export interface JoinResult {
  bytes: Uint8Array;
  used: ReadonlySet<number>;
  accounted: Array<[number, number]>;
  moves: number;
}

/** The main confluence entry point.  Given a query, detect whether it weaves
 *  two or more INDEPENDENT constraints (ranked anchors supported by disjoint
 *  query spans), intersect the constraints' evidence by content-addressed
 *  identity, and return the discriminative content the streams share — the
 *  entity that satisfies all constraints at once.  Null when the query is
 *  not conjunctive or nothing lies in the intersection. */
export async function confluenceJoin(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
): Promise<JoinResult | null> {
  const W = ctx.space.maxGroup;
  if (query.length < 2 * W || ctx.store.edgeSourceCount() === 0) return null;
  const { ranked } = await pre.attention();
  if (ranked.length < 2) return null;

  // WHERE INSTANCES SHOW HOW THE CONSTRAINTS MEET, the meet is theirs.  A
  // question about two things whose instances agree on the derivation each
  // thing takes to their answer (traverse.ts, `convergenceOf`: `· mother`
  // from one, `· spouse` from the other) is met where those derivations,
  // replayed from the question's own things, reach one entity — exact
  // lookups, the facts on both sides its evidence.
  const reading = convergenceOf(ctx);
  if (reading !== null) {
    const meets = convergenceMeets(ctx, reading);
    if (meets.length > 0) {
      const m = meets[0];
      const bytes = m.name;
      const t = ctx.trace?.enter("confluence", [rItem(query, "query")]);
      ctx.trace?.step(
        "convergeDerivations",
        [
          rNode(ctx, m.facts[0], "constraint", m.by),
          rNode(ctx, m.facts[1], "constraint", m.by),
        ],
        [rItem(bytes, "meet")],
        `the entity both of the question's things reach by the derivations ${m.by} instances agree on`,
      );
      t?.done(
        [rItem(bytes, "answer")],
        "conjunctive join — learnt convergence",
      );
      const steps = reading.frames[0].steps;
      return {
        bytes,
        used: new Set(m.facts),
        accounted: [[0, query.length]],
        moves: STEP * (steps[0].length + steps[1].length + 1),
      };
    }
  }

  const N = corpusN(ctx);
  // Response-scoped shared memos: the anchor-window identities and the
  // structural-IDF reach live on Precomputed, so any other identity-based
  // mechanism in the same response reuses them.
  const reachMemo = pre.reachMemo;
  const windowsOfAnchor = (anchor: number) => pre.windowsOf(anchor);

  // The query's own window identities, offset → id (the canonical
  // content-addressed read, canonical.windowIds): whatever the meet shares
  // with the query is the CONSTRAINT being re-named (or its scaffolding),
  // never the open seat the question asks for — subtracted by identity,
  // below.
  // Completed assistant turns are context the engine already produced, not
  // independent constraints asserted by the asker. Treating their windows as
  // fresh constraints makes a cumulative dialogue's confluence work grow with
  // every prior answer and can join the engine's own prose back into a reply.
  // Recognition and attention still see the full transcript; only this
  // mechanism's constraint population excludes answered spans.
  const queryWin = new Map<number, number>();
  const answered = { at: 0 };
  for (const [off, id] of pre.queryWindows) {
    if (insideAnsweredTurn(ctx.answeredSpans, answered, off, off + W)) continue;
    queryWin.set(off, id);
  }
  const queryIds = new Set(queryWin.values());

  // ── Constraint streams: which query content does each anchor CONTAIN ──
  // An anchor is a constraint of the query spans whose windows it holds BY
  // IDENTITY — and only DISCRIMINATIVE windows bind (scaffolding like
  // " is " is contained everywhere and constrains nothing; the same
  // half-dominance reading of the structural IDF as the meet's gate).
  // This is exact where a vote span is approximate: a resonance-voted
  // anchor that contains none of the query's discriminative windows is no
  // constraint at all.
  interface Stream {
    anchor: number;
    vote: number;
    ids: Set<number>;
    /** What the anchor's evidence holds: the anchor and what it establishes
     *  (`evidenceOf`), each text read once the stream binds. */
    evidence?: number[];
    evidenceIds?: Set<number>;
    /** The question's discriminative windows this anchor holds. */
    binds: Set<number>;
    /** Merged [start, end) query spans whose DISCRIMINATIVE windows this
     *  anchor holds — what the constraint BINDS (disjointness reads this). */
    cover: Array<[number, number]>;
    /** Merged [start, end) query spans this anchor holds AT ALL, scaffolding
     *  included — what the evidence EXPLAINS (the decider's accounted reads
     *  this: a contained " is " does not bind a constraint, but it is
     *  genuinely matched content, the same way the cover search counts a
     *  recognised common form). */
    held: Array<[number, number]>;
  }
  // A constraint must bind a CONSTITUENT, not a shard.  A genuinely shared
  // form weaves a contiguous RUN of shared discriminative windows — its
  // merged cover span is the form's own length, beyond one perception
  // quantum (2W: the same "two quanta of structure" bar the conjunctive
  // precondition `query.length < 2W` and CAST's weave live under).  A long
  // stored document holds thousands of W-windows and will hold a FEW of any
  // query's by accident, but accidental sharing is one window (a merged
  // span of W, at most ~W+overlap bytes: "ow ma", "ys a", "ías " —
  // observed), never a run ("​ translucent", " featherlight" — the genuine
  // constraints).  Shard-bound streams are no constraints, and their meets
  // are connective debris (". Sure,", "ngul" — observed).
  const bindsAConstituent = (cover: Array<[number, number]>): boolean =>
    cover.some(([cs, ce]) => ce - cs >= 2 * W);

  // THE VOTE ENTERS AS ORDER, NEVER AS A BAR.  This is the only one of the
  // climb's four consumers (recall, fuseAttention, cast, here) that uses the
  // evidence's MAGNITUDE without a floor, and it is legitimate by construction:
  // `ranked` answers "which anchor is stronger" — a question about votes, so the
  // comparison stays within one dimension — and the vote is otherwise only
  // REPORTED (Stream.vote travels to the rationale's constraint nodes).  What
  // actually SELECTS a constraint is byte-structural and never the magnitude: a
  // run of at least 2W (`bindsAConstituent`, with its accidental-sharing
  // counter-examples above), disjoint covers (`disjoint`), and scaffolding never
  // binds at all (`dominates(reachOf(…), N)`).  The MEET such a stream may
  // produce is selected the same way: a span shorter than 2W is rejected, and
  // the winner is the one with the smallest `reach` (ties broken by the longer
  // span) — a corpus quantity and bytes, never the vote, which appears only in
  // the trace item.
  // binds at all (`dominates(reachOf(…), N)`).  The only cut in this loop is a
  // BUDGET, and it is measured: stopping the scan at 2W anchors saves 50-70% of
  // confluence's cost on non-conjunctive queries while preserving every genuinely
  // conjunctive case, whose top anchors ARE its constraints.
  // MEASURED (this goal, on THIS file's own conjunctive fixture): the two
  // streams appear at ranks 1 and 4 against a budget of 2W = 8, on a query whose
  // `ranked` is 9 — so the cut IS live (it would have returned null at the 8th
  // anchor) and it does NOT prune the case it exists to protect.  The other
  // conjunctive fixture (the Leonardo one) finds them at ranks 0 and 1.  Scope:
  // these are the repo's conjunctive fixtures, and no more.
  const streams: Stream[] = [];
  const rankedCapped = ranked.length > pre.k ? ranked.slice(0, pre.k) : ranked;
  // CONJUNCTIVITY EARLY-EXIT: a conjunctive query's top-ranked anchors
  // (largest vote weight) must already form at least two independent
  // constraint streams.  When the first W anchors yield fewer than 2, the
  // query has at most one topic — no join to compute.  The full pre.k scan
  // would produce the same null result after reading every anchor's bytes
  // and computing window identities (profiled at 18K–50K leaf lookups per
  // refusing query), so cutting the scan short here saves 50–70% of
  // confluence cost on non-conjunctive queries while preserving every
  // genuinely conjunctive case (whose top anchors ARE its constraints).
  const earlyExit = Math.min(rankedCapped.length, ctx.space.maxGroup * 2);
  let exitAfter = earlyExit;
  for (const cand of rankedCapped) {
    if (streams.some((s) => s.anchor === cand.anchor)) continue;
    const ids = new Set(windowsOfAnchor(cand.anchor).values());
    if (ids.size === 0) continue;
    const cover: Array<[number, number]> = [];
    const held: Array<[number, number]> = [];
    const binds = new Set<number>();
    let curC: [number, number] | null = null;
    let curH: [number, number] | null = null;
    for (const [off, wid] of queryWin) {
      if (!ids.has(wid)) continue;
      if (curH !== null && off <= curH[1]) curH[1] = off + W;
      else held.push(curH = [off, off + W]);
      if (dominates(reachOf(ctx, wid, N, reachMemo), N)) continue; // scaffolding never binds
      binds.add(wid);
      if (curC !== null && off <= curC[1]) curC[1] = off + W;
      else cover.push(curC = [off, off + W]);
    }
    if (cover.length > 0 && bindsAConstituent(cover)) {
      streams.push({
        anchor: cand.anchor,
        vote: cand.vote,
        ids,
        cover,
        held,
        binds,
      });
    }
    // Early-exit: after 2W anchors, a non-conjunctive query is decided.
    if (--exitAfter <= 0 && streams.length < 2) return null;
  }
  if (streams.length < 2) return null;

  // WHAT A CONSTRAINT SAYS IS WHAT ITS ANCHOR ESTABLISHES.  An anchor binds a
  // part of the question by its own bytes, but the thing it says of the open
  // seat may be in its continuation: `Porcelain is translucent` holds its
  // entity itself, while `Richard Fox mother` establishes `The mother of
  // Richard Fox is Mary Dudley.`, and only there is `Mary Dudley`.  So a
  // stream's evidence is the anchor and the continuations that still speak of
  // what it bound — holding a constituent of it, by the rule the anchor binds
  // by (`bindsAConstituent`: `Richard Fox`).  Another instance of the
  // question binds its frame, and its answer (`The answer is Ashgrove.`, `The
  // place of birth of Liu Yuan is Ashgrove.`) holds none of it, at most a
  // shard (`birt` of `birthplace`): no evidence of where Kublai Khan was
  // born.  A hub's continuations come back at the read
  // bound and say nothing in particular (bounded-reads.md).
  const bound = hubBound(ctx);
  const evidenceOf = (st: Stream): number[] => {
    if (st.evidence === undefined) {
      const nx = ctx.store.nextFirst(st.anchor, bound);
      st.evidence = [st.anchor];
      if (nx.length < bound) {
        for (const c of nx) {
          const has = new Set(windowsOfAnchor(c).values());
          const runs: Array<[number, number]> = [];
          let cur: [number, number] | null = null;
          for (const [off, wid] of queryWin) {
            if (!st.binds.has(wid) || !has.has(wid)) continue;
            if (cur !== null && off <= cur[1]) cur[1] = off + W;
            else runs.push(cur = [off, off + W]);
          }
          if (bindsAConstituent(runs)) st.evidence.push(c);
        }
      }
      st.evidenceIds = new Set(
        st.evidence.flatMap((e) => [...windowsOfAnchor(e).values()]),
      );
    }
    return st.evidence;
  };
  const asked = ctx._edgeAsked;

  // Two streams are INDEPENDENT constraints when the query content they
  // hold is disjoint — each answers a different part of what was asked.
  const disjoint = (a: Stream, b: Stream): boolean =>
    a.cover.every(([as, ae]) =>
      b.cover.every(([bs, be]) => be <= as || bs >= ae)
    );

  interface Meet {
    bytes: Uint8Array;
    reach: number;
    len: number;
    a: Stream;
    b: Stream;
  }
  let met: Meet | null = null;
  // Whether the question names a thing of its own (see THE SEAT IS A THING).
  let names: boolean | undefined;
  const asksAThing = (): boolean =>
    names ??= heldEntity(ctx, asked?.bytes ?? query, true) !== null;

  for (let i = 0; i < streams.length; i++) {
    for (let j = i + 1; j < streams.length; j++) {
      const a = streams[i];
      const b = streams[j];
      if (!disjoint(a, b)) continue;
      evidenceOf(b);
      const wb = b.evidenceIds!;
      for (const text of evidenceOf(a)) {
        const wa = windowsOfAnchor(text);

        // ── The MEET: in both anchors, not in the query ────────────────────
        // Offsets of A whose window id is shared with B and absent from the
        // query — merged into maximal contiguous spans (windows overlap, so
        // consecutive shared offsets weave one span).
        const spans: Array<[number, number]> = [];
        let cur: [number, number] | null = null;
        for (const [off, wid] of wa) {
          const inMeet = wb.has(wid) && !queryIds.has(wid);
          if (inMeet) {
            if (cur !== null && off <= cur[1]) cur[1] = off + W;
            else spans.push(cur = [off, off + W]);
          }
        }
        if (spans.length === 0) continue;

        const aBytes = read(ctx, text);
        for (const [s, e] of spans) {
          // Scaffolding gate: the span's MOST discriminative window decides.
          // Content reaching a corpus MAJORITY of contexts discriminates
          // nothing (the same half-dominance convention every wrapper test
          // uses); the query-subtraction above already removed everything the
          // question names, so what survives here is a genuine open-seat
          // entity.
          const len = e - s;
          if (len < 2 * W) continue;
          // THE SEAT IS A THING.  Where the question names a thing of its
          // own (`heldEntity`: `Zhu Gaoxu`, `My Wife's Lodger` under the
          // equivalence), what it asks for is one too, and a meet holding no
          // thing the corpus learnt whole is no answer: what two facts of one
          // relation share is that relation's frame (`The date of birth of `),
          // however rare its windows read.  Where it names none (`Which
          // material is translucent and featherlight?`), the bytes are all the
          // evidence spells.
          const piece = aBytes.subarray(s, e);
          if (asksAThing() && !holdsAThing(ctx, piece)) continue;
          let reach = Infinity;
          for (let off = s; off + W <= e; off++) {
            const wid = wa.get(off);
            if (wid !== undefined && wb.has(wid) && !queryIds.has(wid)) {
              reach = Math.min(reach, reachOf(ctx, wid, N, reachMemo));
            }
          }
          // ONE WINDOW IS NOT AN ENTITY.  The reach above is read at the
          // finest grain the fold can address, where content-defined window
          // identity is at its most phase-sensitive: a scaffolding phrase
          // whose cut happens to land in a rare phase reads as rare content.
          // Measured on test/29 C3, a 13-context store: the meet of `The Mona
          // Lisa was painted by Leonardo da Vinci.` and `Hamlet was written by
          // William Shakespeare.` came out as ` by ` at reach 3 — pure frame,
          // priced as the corpus's third-rarest content, and voiced as the
          // entity where the two evidence streams meet.  A single quantum
          // agrees with half the corpus by accident (the same argument
          // pipeline-mechanism.ts's proposed-run gate makes about a 4-byte
          // span), so a meet must clear the two-quantum floor this file's own
          // entry gate uses — the smallest span that carries a perceivable
          // unit BEYOND the one being matched.
          if (!isFinite(reach) || dominates(reach, N)) continue;
          if (
            met === null || reach < met.reach ||
            (reach === met.reach && len > met.len)
          ) {
            met = { bytes: piece, reach, len, a, b };
          }
        }
      }
    }
  }
  if (met === null) return null;

  const t = ctx.trace?.enter("confluence", [rItem(query, "query")]);
  ctx.trace?.step(
    "intersectEvidence",
    [
      rNode(ctx, met.a.anchor, "constraint", met.a.vote),
      rNode(ctx, met.b.anchor, "constraint", met.b.vote),
    ],
    [rItem(met.bytes, "meet")],
    `the discriminative content BOTH constraints' evidence shares, by content-addressed identity (reach ${met.reach} of ${N} contexts)`,
  );
  t?.done(
    [rItem(met.bytes, "answer")],
    "conjunctive join — the entity where the independent evidence streams meet",
  );
  // Evidence: the query spans whose content the two streams hold by
  // identity (scaffolding included — held, not just the binding cover);
  // the acts were two constraint matches and one meet.
  const accounted: Array<[number, number]> = [
    ...met.a.held,
    ...met.b.held,
  ];
  return {
    bytes: met.bytes,
    used: new Set([met.a.anchor, met.b.anchor]),
    accounted,
    moves: 3 * STEP,
  };
}

// ── Pipeline mechanism ──────────────────────────────────────────────────────

export const confluenceMechanism: PipelineMechanism = {
  name: "confluence",
  provenance: "join",
  async floor(_ctx, query, pre, worthRunning) {
    const W = _ctx.space.maxGroup;
    if (query.length < 2 * W || _ctx.store.edgeSourceCount() === 0) return null;
    // Confluence's floor is always exactly 3*STEP when it exists — same
    // investment discipline as CAST's (see cast.ts): when the bound already
    // cannot beat the incumbent, return it UNINVESTED (never first-touch the
    // climb just to be pruned) and let the pipeline record the truthful
    // "cannot beat incumbent" note.
    if (!worthRunning(3 * STEP)) return 3 * STEP;
    if ((await pre.attention()).ranked.length < 2) return null;
    return 3 * STEP;
  },
  async run(ctx, query, pre) {
    const met = await confluenceJoin(ctx, query, pre);
    if (!met) return [];
    return [{
      bytes: met.bytes,
      accounted: met.accounted,
      moves: met.moves,
      used: met.used,
    }];
  },
};
