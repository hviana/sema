// reasoning.ts — multi-hop reasoning + multi-topic fusion (Section 4 of the mind).
//
//   reason       — extend an answer forward across facts (multi-hop)
//   fuseAttention — fuse independent points of attention (multi-topic)
import { rItem, rNode } from "./trace.js";

import { bytesEqual, indexOf } from "../bytes.js";
import type { MindContext } from "./types.js";
import { resolve } from "./primitives.js";
import { corpusN } from "./traverse.js";
import { follow, haloSiblings, project } from "./match.js";
import { joinWithBridge, pivotInto } from "./resonance.js";
import type { Precomputed } from "./pipeline-mechanism.js";
import type { Rationale } from "./rationale.js";

/** Extend a grounded answer forward across facts (multi-hop reasoning).
 *  Pivots on the longest unconsumed learnt context each answer contains,
 *  then follows the pivot's continuation to the next fact.  Repeats up
 *  to `cfg.recallQueryK` hops.  `preConsumed` carries node ids already
 *  spoken for by the grounding stage (cover/extract/CAST).  `pre` is the
 *  response's shared pre-computation — the post-grounding stages read the
 *  same container the mechanisms did. */
export async function reason(
  ctx: MindContext,
  query: Uint8Array,
  answer: Uint8Array,
  preConsumed: ReadonlySet<number>,
  pre: Precomputed,
): Promise<Uint8Array> {
  // Echo guard: a query that is ITSELF a learnt continuation (some context's
  // answer) is being asked back at the system — hopping forward from it would
  // chain through the very fact that produced it and echo the conversation
  // back.  The grounded answer alone is the honest read-out.  Deliberately a
  // broad structural gate; pinned by test/31-audit.
  const qId = pre.queryResolved;
  if (qId !== null && ctx.store.prevCount(qId) > 0) return answer;

  const consumed = new Set<number>();
  // Consume a node and its neighbours for pivot-cycle prevention — CAPPED at
  // the hub bound, via the store's LIMITed edge reads: a common continuation's
  // reverse fan-in (and a hub context's forward fan-out) is corpus-sized, and
  // no per-hop operation may grow with the corpus.  The cap follows the one
  // convention every fan-out decision uses (first √N in the relation's own
  // read order); a pivot suppressed only by a beyond-cap neighbour may now
  // fire — the same visibility trade chooseNext documents.
  const hubBound = Math.ceil(Math.sqrt(corpusN(ctx)));
  const consumeNode = (id: number | null) => {
    if (id === null) return;
    consumed.add(id);
    for (const p of ctx.store.prevFirst(id, hubBound)) consumed.add(p);
  };
  const consumeAll = (id: number | null) => {
    if (id === null) return;
    consumeNode(id);
    for (const n of ctx.store.nextFirst(id, hubBound)) consumed.add(n);
  };

  // Pre-consume whatever the grounding stage already spoke for.  The halo
  // sweep is one ANN query per node — cap it at haloQueryK sweeps (cover
  // grounding can pre-consume one node per recognised site, O(query length));
  // nodes past the cap are still consumed directly, they just skip the
  // synonym expansion.
  let haloSweeps = 0;
  for (const id of preConsumed) {
    consumeNode(id);
    if (haloSweeps >= ctx.cfg.haloQueryK) continue;
    const h = ctx.store.halo(id);
    if (!h) continue;
    haloSweeps++;
    for (const sib of await haloSiblings(ctx, id, h)) consumeNode(sib.id);
  }

  let cur = answer;
  const qv = pre.guide; // the response-wide guide IS the query's gist
  let t: ReturnType<Rationale["enter"]> | undefined;
  const startedFrom = answer;
  for (let hop = 0; hop < ctx.cfg.recallQueryK; hop++) {
    const curId = resolve(ctx, cur);
    consumeNode(curId);

    // Forward-absorb: follow only UNCONSUMED continuations.  The gate below
    // checks an unconsumed edge EXISTS, but follow()'s chooseNext knows
    // nothing of `consumed` and may still walk to a consumed fixpoint —
    // absorbing it would repeat content the grounding stage already spoke
    // for, so a consumed fixpoint falls through to the pivot step instead.
    if (
      curId !== null &&
      ctx.store.nextFirst(curId, hubBound).some((n) => !consumed.has(n))
    ) {
      const fwd = await follow(ctx, curId, qv);
      const fwdId = fwd !== null ? resolve(ctx, fwd) : null;
      if (
        fwd !== null && !bytesEqual(fwd, cur) &&
        (fwdId === null || !consumed.has(fwdId))
      ) {
        consumeAll(curId);
        t ??= ctx.trace?.enter("reason", [
          rItem(startedFrom, "grounded"),
        ]);
        ctx.trace?.step(
          "absorbForward",
          [rItem(cur, "answer", curId)],
          [rItem(fwd, "answer", resolve(ctx, fwd) ?? undefined)],
          "the answer is itself a learnt fact — follow its continuation to the fixpoint",
        );
        cur = fwd;
        continue;
      }
    }

    // Pivot: find the longest unconsumed learnt context the answer contains.
    consumeAll(curId);
    const pivot = await pivotInto(ctx, cur, consumed);
    if (pivot === null) break;

    const fc = await follow(ctx, pivot, qv);
    consumeAll(pivot);
    if (fc === null || bytesEqual(fc, cur)) break;
    t ??= ctx.trace?.enter("reason", [rItem(startedFrom, "grounded")]);
    ctx.trace?.step(
      "pivotStep",
      [rItem(cur, "answer"), rNode(ctx, pivot, "pivot")],
      [rItem(fc, "answer", resolve(ctx, fc) ?? undefined)],
      "pivot on the shared span this answer contains, then step forward across that fact",
    );
    cur = fc;
  }
  t?.done(
    [rItem(cur, "answer", resolve(ctx, cur) ?? undefined)],
    "the multi-hop chain's fixpoint",
  );
  return cur;
}

/** Fuse independent points of attention into one answer (multi-topic).
 *  When the consensus climb finds more than one dominant point, each
 *  independent point grounds its own answer; they are bridged together
 *  by any learnt connector the graph holds between them. */
export async function fuseAttention(
  ctx: MindContext,
  query: Uint8Array,
  primary: Uint8Array,
  pre: Precomputed,
): Promise<Uint8Array> {
  // When the answer is structurally drawn from the query itself
  // (extraction), it already spans all the query's pieces — fusion
  // would only add noise from unrelated stored contexts.  The gate is
  // STRICT containment (resolved node in the query's tree, or a contiguous
  // byte run): the old sparse-subsequence test was trivially satisfied by
  // short answers over long queries, silently starving multi-topic queries
  // of fusion.
  if (containsSpan(ctx, query, primary)) return primary;

  // The committed points of attention ARE the shared climb's roots (same
  // query, same k, same DF mode) — read them from Precomputed instead of
  // re-climbing, so even a traced response pays for the climb once.
  const forest = (await pre.attention()).roots;
  if (forest.length <= 1) return primary;

  const pieces: Array<{ start: number; bytes: Uint8Array }> = [
    { start: forest[0].start, bytes: primary },
  ];
  const qv = pre.guide; // once, not per root
  const t = ctx.trace?.enter("fuseAttention", [
    rItem(primary, "primary"),
    ...forest.slice(1).map((r) => rNode(ctx, r.anchor, "point", r.vote)),
  ]);
  for (const root of forest.slice(1)) {
    const g = await project(ctx, root.anchor, qv);
    if (g === null || g.length === 0) continue;
    if (pieces.some((p) => indexOf(p.bytes, g, 0) >= 0)) continue;
    pieces.push({ start: root.start, bytes: g });
  }
  if (pieces.length === 1) {
    t?.done(
      [rItem(primary, "answer")],
      "no further independent point grounded",
    );
    return primary;
  }

  pieces.sort((a, b) => a.start - b.start);
  let out = pieces[0].bytes;
  for (let i = 1; i < pieces.length; i++) {
    // An approximate-resonance miss (or a genuinely unlearnt junction) joins
    // the pieces bare — joinWithBridge surfaces it as a bridgeMiss step.
    out = await joinWithBridge(ctx, out, pieces[i].bytes);
  }
  t?.done(
    [rItem(out, "answer", resolve(ctx, out) ?? undefined)],
    `fused ${pieces.length} independent points of attention into one answer`,
  );
  return out;
}

// (resonance.js is already a static dependency above — `bridge` — so the old
// dynamic import of pivotInto guarded against a cycle that does not exist.)
import { containsSpan } from "./mechanisms/extraction.js";
