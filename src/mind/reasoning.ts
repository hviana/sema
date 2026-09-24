// reasoning.ts — multi-hop reasoning + multi-topic fusion (Section 4 of the mind).
//
//   reason       — extend an answer forward across facts (multi-hop)
//   fuseAttention — fuse independent points of attention (multi-topic)
import { rItem, rNode } from "./trace.js";

import { bytesEqual, indexOf } from "../bytes.js";
import type { Attention, MindContext } from "./types.js";
import { resolve } from "./primitives.js";
import { corpusN, hubBound } from "./traverse.js";
import { containsSpan, follow, haloSiblings, project } from "./match.js";
import { joinWithBridge, pivotInto } from "./resonance.js";
import { admissible, advance, type Continuation } from "./derivation.js";
import type { Precomputed } from "./pipeline-mechanism.js";
import { type Rationale } from "./rationale.js";
import {
  closure,
  type DerivationState,
  type Offer,
  restates,
  type Span,
  unaccountedBytes,
} from "./derivation.js";
import { STEP } from "./graph-search.js";

/** Extend a grounded answer forward across facts (multi-hop reasoning).
 *  Pivots on the longest unconsumed learnt context each answer contains,
 *  then follows the pivot's continuation to the next fact.  **The chain ends
 *  when it STOPS, never when a count runs out**: every exit is a refusal (no
 *  pivot, no forward step, no question material carried) and the walk is bounded
 *  by the material and the graph — `consumed` refuses to revisit a node.  There
 *  is no hop allowance, so this doc deliberately names no `cfg` capacity: the
 *  cover prices every hop at `STEP` and lets the search decide the depth, and a
 *  second count here would be a second decision about the same thing.
 *  `preConsumed` carries node ids already
 *  spoken for by the grounding stage (cover/extract/CAST).  `voiced` carries
 *  the BYTES of the anchors a mechanism declared it voiced (its `used` set),
 *  when it declared one — see the pivot's own containment rule.  `pre` is the
 *  response's shared pre-computation — the post-grounding stages read the
 *  same container the mechanisms did. */
export async function reason(
  ctx: MindContext,
  query: Uint8Array,
  d0: DerivationState,
  preConsumed: ReadonlySet<number>,
  pre: Precomputed,
  voiced: readonly Uint8Array[] = [],
): Promise<DerivationState> {
  const answer = d0.product;
  /** The query material the GROUNDING left uncovered — the state's own
   *  remainder.  Only the reasoner's OWN extensions are judged against it; a
   *  mechanism carrying its own `used` set owns its shape. */
  const uncovered = d0.remainder;
  // Echo guard: a query that is ITSELF a learnt continuation (some context's
  // answer) is being asked back at the system — hopping forward from it would
  // chain through the very fact that produced it and echo the conversation
  // back.  The grounded answer alone is the honest read-out.  Deliberately a
  // broad structural gate; pinned by test/31-audit.
  const qId = pre.queryResolved;
  if (qId !== null && ctx.store.prevCount(qId) > 0) {
    return d0;
  }

  // Consume a node and its neighbours for pivot-cycle prevention — CAPPED at
  // the hub bound, via the store's LIMITed edge reads: a common continuation's
  // reverse fan-in (and a hub context's forward fan-out) is corpus-sized, and
  // no per-hop operation may grow with the corpus.  The cap follows the one
  // convention every fan-out decision uses (first √N in the relation's own
  // read order); a pivot suppressed only by a beyond-cap neighbour may now
  // fire — the same visibility trade chooseNext documents.
  const bound = hubBound(ctx);

  // ANSWERED DIRECTLY — the echo guard's other half, and the same principle:
  // the QUERY's own position in the graph, not the answer's content, says the
  // read-out is complete.  Above: the query is itself a learnt CONTINUATION.
  // Here: the query is a learnt CONTEXT and the grounded answer is one of ITS
  // OWN continuations.  Either way the question was answered directly and there
  // is nothing left to chain for.
  //
  // Every stopping condition in the loop below judges the ANSWER (`consumed` /
  // the law's `restates` / `bytesEqual`); none asks whether the QUESTION was
  // satisfied.  So a single-hop question whose answer happens to name another
  // learnt context extends past a correct answer and REPLACES it:
  //
  //   asked  "<subj> father"
  //   hop 1  "The father of <subj> is Ernest I of Anhalt-Dessau."   <- correct
  //   pivot  "Ernest I of Anhalt-Dessau"                <- a learnt context too
  //   got    "The date of death of Ernest I of Anhalt-Dessau is 12 June 1516."
  //
  // Any store holding a bare-entity context alongside a relation fact has that
  // shape; it is not exotic.
  //
  // Checked ONCE, before the loop, and ahead of BOTH extension branches:
  // `absorbForward` extends the answer too, and nothing about the defect is
  // specific to pivoting, so a guard between them would gate one arbitrary half
  // of the same step.  Hop 0 is also the only hop at which the question can be
  // answered directly at all — after a hop, `cur` is no longer the query's own
  // continuation, so re-testing per hop could only cost reads.
  //
  // Read from the ANSWER's side (`prevFirst`) rather than the query's
  // (`nextFirst`).  Same relation, but a CONTEXT's fan-out is hub-sized while
  // this is one answer's establishing-context fan-in.  Both the resolve and the
  // reverse read are exactly what hop 0 of the loop below would perform, so
  // they are computed ONCE here and handed down (`groundedId`, `groundedPrev`)
  // — the guard then costs nothing when it does not fire.  Stated because the
  // naive placement does NOT: `resolve` re-folds the answer bytes on every call
  // (no memo) and `prevFirst` is a direct read (no memo), so a guard that
  // recomputed them would add one fold plus one √N-bounded read per ask.
  // The √N cap carries the file-wide visibility trade, and fails SAFE in the
  // direction that matters: a missed guard costs an over-extended answer, never
  // a suppressed chain.
  //
  // A genuine multi-hop query is not a deposited context at all ("What is the
  // capital of the country of Eiffel Tower?" resolves to nothing), so this can
  // never gate a real chain.
  const groundedId = resolve(ctx, answer);
  const groundedPrev = groundedId === null
    ? null
    : ctx.store.prevFirst(groundedId, bound);
  if (qId !== null && groundedPrev !== null && groundedPrev.includes(qId)) {
    return d0;
  }

  const consumed = new Set<number>();
  /** `prev` lets a caller hand in an already-read reverse-edge list — hop 0
   *  reuses the guard's, above, instead of re-reading it. */
  const consumeNode = (
    id: number | null,
    prev?: readonly number[],
  ) => {
    if (id === null) return;
    consumed.add(id);
    for (const p of prev ?? ctx.store.prevFirst(id, bound)) consumed.add(p);
  };
  const consumeAll = (id: number | null) => {
    if (id === null) return;
    consumeNode(id);
    for (const n of ctx.store.nextFirst(id, bound)) consumed.add(n);
  };

  // Pre-consume whatever the grounding stage already spoke for.  The halo
  // sweep is one ANN query per node — cap it at haloQueryK sweeps (cover
  // grounding can pre-consume one node per recognised site, O(query length));
  // nodes past the cap are still consumed directly, they just skip the
  // synonym expansion.
  const preconsume = async () => {
    let haloSweeps = 0;
    for (const id of preConsumed) {
      consumeNode(id);
      if (haloSweeps >= ctx.cfg.haloQueryK) continue;
      const h = ctx.store.halo(id);
      if (!h) continue;
      haloSweeps++;
      for (const sib of await haloSiblings(ctx, id, h)) consumeNode(sib.id);
    }
  };
  if (ctx.meter) {
    await ctx.meter.time("reason.preconsumeHalos", preconsume);
  } else {
    await preconsume();
  }

  // ── THE WALK, AS THE LAW'S ───────────────────────────────────────────
  //
  // This function no longer decides whether a step may be taken: it OFFERS a
  // continuation — a forward step from the answer's own learnt edge, or a pivot
  // on a learnt context the answer contains — and `derivation.ts`'s law admits
  // or refuses it.  The state it offers against is the pipeline's own: the
  // grounding's remainder (what the question still owes), its accounting, its
  // cost.
  //
  // NO ALLOWANCE: THE CHAIN ENDS WHEN IT STOPS.  Every exit below is the law —
  // no pivot, no forward step, no question material carried — and the walk is
  // bounded by the material and the graph rather than by a count: the law
  // requires each step to engage what is left (or to move to new structure),
  // and `consumed` refuses to revisit a node.  `recallQueryK` no longer bounds
  // the reasoner here; it keeps its other roles (the bridge's candidate reads,
  // the pivot's probe budget, the resonance limits).
  //
  // Measured before removing the allowance: test/89 — the corpus-cost guard, the
  // heaviest case in the suite — is green and no slower without it (27 s against
  // 30 s); and raising it from 12 to 200 changed neither the answer nor
  // `pivotSteps` on the chain fixtures.
  const qv = pre.guide; // the response-wide guide IS the query's gist
  const W = ctx.space.maxGroup;
  // WHOSE EXTENSION IS THIS?  `voiced` is what the mechanism WITHHELD (the
  // pipeline sends the used anchors' CONTINUATIONS, not their bytes), so a
  // non-empty `voiced` means exactly what that note says: the grounding came
  // from a mechanism that carries its own short `used` set (cast/join) and
  // therefore OWNS the shape of its answer.  The further terms inside such a
  // seat are legitimately followable (test/29 C3's `Mona Lisa` lives inside the
  // voiced seat and leads on to a fact about neither analog), which the law
  // expresses as the identity species of progress — `moves` — declared by the
  // reporter and never inferred from the mechanism's name.
  const producerOwnsShape = voiced.length > 0;
  const startedFrom = answer;
  let hop = 0;
  let t: ReturnType<Rationale["enter"]> | undefined;
  // WHAT THE OFFERED STEP WOULD BE.  The law decides, so the accepted step is
  // traced where the decision went (`onTaken`) and a refused one is reported as
  // the law's refusal (`onRefused`) — a step is never reported before it is
  // admitted.
  let pending:
    | { kind: "absorb"; cur: Uint8Array; curId: number | null; fwd: Uint8Array }
    | { kind: "pivot"; cur: Uint8Array; pivot: number; fc: Uint8Array }
    | null = null;

  const offer: Offer = async (d) => {
    const cur = d.product;
    // The first step's `cur` IS the grounding's product, so the guard above
    // already resolved it and read its reverse edges — reuse both.
    const curId = hop === 0 ? groundedId : resolve(ctx, cur);
    consumeNode(curId, hop === 0 ? groundedPrev ?? undefined : undefined);
    hop++;

    // Forward-absorb: follow only UNCONSUMED continuations.  The gate below
    // checks an unconsumed edge EXISTS, but follow()'s chooseNext knows nothing
    // of `consumed` and may still walk to a consumed fixpoint — absorbing it
    // would repeat content the grounding stage already spoke for, so a consumed
    // fixpoint falls through to the pivot step instead.  Offered with `moves`:
    // completing the answer's OWN learnt form is an identity step, not a claim
    // about the asker's material.
    if (
      curId !== null &&
      ctx.store.nextFirst(curId, bound).some((n) => !consumed.has(n))
    ) {
      const fwd = await follow(ctx, curId, qv);
      const fwdId = fwd !== null ? resolve(ctx, fwd) : null;
      if (
        fwd !== null && !bytesEqual(fwd, cur) &&
        (fwdId === null || !consumed.has(fwdId)) &&
        !restates(query, fwd, 0, { proper: true })
      ) {
        consumeAll(curId);
        pending = { kind: "absorb", cur, curId, fwd };
        return { product: fwd, contains: true, reaches: true, cost: STEP };
      }
    }

    // Pivot: the longest unconsumed learnt context the answer contains.
    consumeAll(curId);
    const pivot = await pivotInto(ctx, cur, consumed, voiced);
    if (pivot === null) return null;
    const fc = await follow(ctx, pivot, qv);
    consumeAll(pivot);
    if (
      fc === null || bytesEqual(fc, cur) ||
      restates(query, fc, 0, { proper: true })
    ) {
      return null;
    }
    pending = { kind: "pivot", cur, pivot, fc };
    // Offered with the identity species ONLY when the grounding declared what it
    // speaks for; otherwise the law requires this step to carry question
    // material the grounding left unaccounted, which is the drift the extension
    // tests pin — refused by the law's own measure, not by a private window
    // test.
    return {
      product: fc,
      contains: true,
      reaches: producerOwnsShape,
      cost: STEP,
    };
  };

  const closed_ = await closure(
    d0,
    query,
    W,
    offer,
    (before, after) => {
      if (ctx.meter) {
        ctx.meter.closureDrainedBytes += unaccountedBytes(before.remainder) -
          unaccountedBytes(after.remainder);
      }
      const p = pending;
      pending = null;
      if (p === null) return;
      t ??= ctx.trace?.enter("reason", [rItem(startedFrom, "grounded")]);
      if (p.kind === "absorb") {
        ctx.trace?.step(
          "absorbForward",
          [rItem(p.cur, "answer", p.curId ?? undefined)],
          [rItem(p.fwd, "answer", resolve(ctx, p.fwd) ?? undefined)],
          "the answer is itself a learnt fact — follow its continuation to the fixpoint",
        );
      } else {
        if (ctx.meter) ctx.meter.pivotSteps++;
        ctx.trace?.step(
          "pivotStep",
          [rItem(p.cur, "answer"), rNode(ctx, p.pivot, "pivot")],
          [rItem(p.fc, "answer", resolve(ctx, p.fc) ?? undefined)],
          "pivot on the shared span this answer contains, then step forward across that fact",
        );
      }
    },
    (at) => {
      const p = pending;
      pending = null;
      if (p === null || p.kind !== "pivot") return;
      // THE BRAKE, MADE VISIBLE — and it is now the LAW's refusal, reported
      // where it happened.  The reasoner declines a step that carries none of
      // the material the grounding left unaccounted.  A refusal that leaves no
      // trace is the kind of silent cut AGENTS §6 forbids: the rationale is
      // where a reader learns that an extension was declined for want of
      // question material, and where the next person sees why the chain stopped
      // here.  Measured with the check disabled, test/110 and test/116 fail.
      const left = unaccountedBytes(at.remainder);
      ctx.trace?.step(
        "pivotRefused",
        [rItem(p.cur, "answer"), rItem(query, "query")],
        at.remainder.map(([a, b]) => rItem(query.subarray(a, b), "uncovered")),
        `the step carries none of the question material the grounding left ` +
          `unaccounted (${left} byte(s) in ${at.remainder.length} span(s)) — refused`,
      );
    },
  );

  // INSTRUMENTATION ONLY — the extension's two facts, untraced (meter.ts
  // contract 1: a counter never reaches a decision).  They are what a caller
  // needs to PRICE the extension instead of taking it unconditionally, and both
  // are now read off the state the law advanced rather than accumulated beside
  // it: the work it did is the cost it accumulated, and the material it carried
  // is the accounting the law's witnesses added.
  const steps = closed_.cost - d0.cost;
  if (ctx.meter) {
    ctx.meter.reasonSteps += steps;
    // The accounting the law's witnesses added, summed by the law's own function
    // over the tail of the state's list — and computed ONLY when a meter is
    // attached: this used to slice and MAP a fresh array on every response, for a
    // counter that usually does not exist.  One allocation, under the meter.
    ctx.meter.reasonCarriedBytes += unaccountedBytes(
      closed_.accounted.slice(d0.accounted.length),
    );
  }
  t?.done(
    [rItem(
      closed_.product,
      "answer",
      resolve(ctx, closed_.product) ?? undefined,
    )],
    // A FIXPOINT: no further step was offered, or the law refused the one that
    // was.  There is no allowance to exhaust, so the note is true by
    // construction.
    "the multi-hop chain's fixpoint",
  );
  return closed_;
}

/** Fuse independent points of attention into one answer (multi-topic).
 *  When the consensus climb finds more than one dominant point, each
 *  independent point grounds its own answer; they are bridged together
 *  by any learnt connector the graph holds between them. */
export async function fuseAttention(
  ctx: MindContext,
  query: Uint8Array,
  state: DerivationState,
  pre: Precomputed,
  /** True when `primary` never touched the consensus climb at all — e.g. a
   *  pure ALU computation, which has no anchor of its own.  commitVotes
   *  ALWAYS admits the dominant root regardless of its vote (attention.ts:
   *  "roots.length === 0 || …") on the assumption a lone root already IS
   *  primary's own source; that assumption is exactly backwards when
   *  primary is unclimbed.  Absent or false preserves the original
   *  behaviour exactly. */
  unclimbed = false,
  /** The query spans `primary`'s own grounding stands on — used ONLY to place
   *  primary in the fused reading order (see below).  Resolved by the caller,
   *  which is the layer that knows how a given grounding records its evidence;
   *  fuseAttention just reads a position from it.  Empty or absent preserves
   *  the original behaviour exactly. */
  primarySpans: ReadonlyArray<Span> = [],
): Promise<DerivationState> {
  // THE STATE, NOT BARE BYTES: fusion is one more transition of the derivation
  // the walk returned, so it reads that state's product and hands back a state.
  // Its own structural gates stay here — this is the layer that can resolve
  // those witnesses, and the law never re-derives one.
  const primary = state.product;
  // When the answer is structurally drawn from the query itself
  // (extraction), it already spans all the query's pieces — fusion
  // would only add noise from unrelated stored contexts.  The gate is
  // STRICT containment (resolved node in the query's tree, or a contiguous
  // byte run): the old sparse-subsequence test was trivially satisfied by
  // short answers over long queries, silently starving multi-topic queries
  // of fusion.
  if (containsSpan(ctx, query, primary)) return state;

  // The committed points of attention ARE the shared climb's roots (same
  // query, same k, same DF mode) — read them from Precomputed instead of
  // re-climbing, so even a traced response pays for the climb once.
  const forest = (await pre.attention()).roots;
  // A LONE root is ordinarily primary's own source — nothing to fuse.  But
  // when primary is unclimbed, the lone root was never checked against
  // anything: it is admitted by commitVotes unconditionally, so it may be
  // genuine consensus (Attention.breadth dominates — most of the query's
  // OWN regions corroborate it) or a coincidental echo (breadth does not
  // dominate — see test/35-attention-confidence).  breadth is the SCALE-
  // INVARIANT read of exactly this question: the raw IDF vote cannot serve
  // here, since it is an absolute ln(N)-scaled quantity (a genuine root on
  // a large store can score BELOW its own floor while a coincidental echo
  // on a small one scores comfortably above its own, smaller, floor).
  //
  // Breadth alone is not enough when primary is a pure COMPUTATION.  The ALU
  // answers "2+2 equals what?" with 4, and the store's own arithmetic table
  // then supplies a lone root — an exemplar like "1+2" — whose breadth
  // dominates because it is corroborated by the computation's OWN bytes.
  // Fusing it projected that exemplar's continuation and the bridge voiced
  // "4+3" (test/11 seed 99).  A second point of attention must stand on
  // evidence that is structurally SEPARATE from primary's: at least one
  // perceptual quantum of query between them, the same separation
  // countClusters uses to tell independent evidence neighbourhoods apart.
  // Not a score, and not a tuned bar — the fold's own quantum.
  //
  // With no primarySpans (the caller did not resolve them) every span
  // vacuously qualifies, preserving the original behaviour exactly.
  const quantum = ctx.space.maxGroup;
  const independentOfPrimary = (root: Attention): boolean =>
    primarySpans.every(([s, e]) => {
      const gap = root.end <= s
        ? s - root.end
        : e <= root.start
        ? root.start - e
        : 0;
      return gap >= quantum;
    });
  const lonePromotes = unclimbed && forest.length === 1 &&
    forest[0].breadth > 0.5 && independentOfPrimary(forest[0]);
  if (forest.length === 0 || (forest.length <= 1 && !lonePromotes)) {
    return state;
  }

  // WHERE THE QUERY ASKED FOR IT.  The sort below orders the fused pieces by
  // query position, which is the whole point of the `start` field: a
  // multi-topic answer should read in the order the question posed its
  // topics.  Every ROOT carries its own start.  `primary` did not — it was
  // given forest[0].start, the FIRST attention root's position, which is
  // primary's own source only when primary happens to come from that root.
  // When it does not, primary is sorted to a position it never occupied.
  //
  // Observed live: "What is the capital of France? And what is 2 + 2?"
  // answered "4The capital city of France is Paris." — the ALU result, whose
  // evidence is the "2 + 2" span near the END of the query, inherited the
  // France root's start of 0 and sorted ahead of the France answer.  Both
  // pieces were right; only the order was.
  //
  // primary's own position is the earliest query byte its grounding stands
  // on.  `accounted` is the cost-ladder read of that and is authoritative
  // when non-empty; when it is empty the grounding is a pure COMPUTATION,
  // whose evidence is its computed span — the same cost-ladder-vs-coverage
  // distinction think() already draws for the fusion remainder ("`accounted`
  // alone undercounts this ... cover prices its computed spans at near-zero
  // and deliberately leaves them out"), read here for position instead of
  // for coverage.  With neither, nothing is known and the old behaviour
  // (forest[0].start) stands.
  const primaryStart = primarySpans.length > 0
    ? primarySpans.reduce((m, [s]) => Math.min(m, s), Infinity)
    : forest[0].start;
  const pieces: Array<{ start: number; bytes: Uint8Array }> = [
    { start: primaryStart, bytes: primary },
  ];
  const qv = pre.guide; // once, not per root
  const rest = lonePromotes ? forest : forest.slice(1);
  const t = ctx.trace?.enter("fuseAttention", [
    rItem(primary, "primary"),
    ...rest.map((r) => rNode(ctx, r.anchor, "point", r.vote)),
  ]);
  for (const root of rest) {
    // DISPERSION: this root's contributing regions are confined to a
    // single cluster (see Attention.clusters) — one local neighbourhood of
    // the query, not several separate places.  Raw region count already
    // failed to discriminate a coincidental match from a genuine further
    // topic (test/24 gap 3.1 vs test/35's echo); dispersion is a different
    // question — not how MUCH evidence, but how many separate PLACES in the
    // query corroborate it — and a coincidental match is structurally
    // confined to one cluster no matter how strongly it resonates.
    //
    // EXCEPTION: crossRegionVotes' own joint conclusions (a query naming
    // two attributes that were only ever learnt TOGETHER — test/34's own
    // binding corpus) are inherently ONE fused context and are pooled from
    // a single synthetic region, so they always read as one cluster even
    // though they already, by construction, account for both original
    // mentions.  `breadth` (dominates — the same > half-the-query bar used
    // everywhere else) still correctly recognises these: a genuine joint
    // binding explains the MAJORITY of the query's regions on its own,
    // which a coincidental echo never does (verified: test/35's echo tops
    // out at 0.40).  So a root is trusted when EITHER measure alone
    // indicates real signal — excluded only when BOTH are weak.  Cheap and
    // synchronous — checked before the async already-answered walk below.
    if (root.clusters < 2 && root.breadth <= 0.5) {
      ctx.trace?.step(
        "singleCluster",
        [rNode(ctx, root.anchor, "point", root.vote)],
        [],
        "this point's evidence is confined to one local neighbourhood of the query — not trusted as an independent topic",
      );
      continue;
    }
    // ALREADY ANSWERED: this root's own learnt continuation — the same
    // content-addressed walk reason()'s echo guard already trusts
    // (`ctx.store.prevCount(qId) > 0`), here applied per-candidate instead
    // of to the whole query — is VERBATIM present later in the query.  A
    // query that embeds both an exchange's ask and its own already-given
    // reply (a conversation's turn plus its own prior answer, concatenated
    // raw by addTurn — or any caller pasting a transcript into one
    // respond() call; the check is Mind-bookkeeping-free, so it treats both
    // identically) has already spoken this root's answer — fusing it in
    // again would only restate it.  Deliberately NOT a magnitude measure:
    // it fires on exact content-addressed recurrence, not on how strongly
    // the root resonates.
    const cont = await follow(ctx, root.anchor, qv);
    if (
      cont !== null && cont.length > 0 &&
      // The law's positional reading: the caller knows the material it is
      // looking for lies AT OR AFTER this root, which is the witness; the law
      // owns the containment test itself.  The `cont.length > 0` guard stays
      // here because an EMPTY continuation indexes at every offset — the law
      // has no opinion about whether "nothing" counts as said.
      restates(query, cont, 0, { from: root.end })
    ) {
      ctx.trace?.step(
        "alreadyAnswered",
        [rNode(ctx, root.anchor, "point", root.vote)],
        [rItem(cont, "continuation")],
        "this point's own learnt continuation already appears later in the query — already answered, not fused",
      );
      continue;
    }
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
    return state;
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
  // THE FACT IS THE FUSED ANSWER, not the call: every early return above hands
  // back `primary` untouched.  Untraced on purpose (meter.ts contract 1).
  if (ctx.meter) ctx.meter.fuseRuns++;
  // A FUSION IS A TRANSITION, and the only one in the engine that can splice the
  // QUESTION'S OWN material into the product.  So it is OFFERED to the law rather
  // than built by hand: the law reads the window the fused product holds — the
  // same reading the carries admission uses, one definition — accounts for the
  // span it carried, and lets the question's remainder drain on EVIDENCE.  A
  // fusion that carries nothing consumes nothing, because the reading finds no
  // window; and `reaches` is declared only when the fusion composed another root,
  // which is structure this derivation had not stood on.
  const fusedT: Continuation = {
    product: out,
    contains: true,
    reaches: rest.length > 0,
    cost: STEP,
  };
  const fusedWitness = admissible(state, fusedT, query, ctx.space.maxGroup);
  if (fusedWitness === null) return { ...state, product: out };
  const fused = advance(state, fusedT, fusedWitness);
  if (ctx.meter) {
    ctx.meter.closureDrainedBytes += unaccountedBytes(state.remainder) -
      unaccountedBytes(fused.remainder);
  }
  return fused;
}
