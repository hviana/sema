// resonance.ts — Pattern A: Resonance Search.
//
//   Address → Resonate → filter by Traverse/Read predicates → transform.
//   Used by bridge, recallByResonance, meaningOf; pivotInto (exact only).
//   (The graded locate() matcher formerly here lives in match.ts.)
import { rItem } from "./trace.js";

import { cosine, Vec } from "../vec.js";
import { mergeThreshold } from "../geometry.js";
import { concat2, concatBytes, indexOf, latin1 } from "../bytes.js";
import type { MindContext } from "./types.js";
import { gistOf, read, resolve } from "./primitives.js";
import { argmaxCosine, candidateGist, hubBound } from "./traverse.js";
import {
  cachedRead,
  type Junction,
  junctionContainers,
  junctionSynonyms,
  walkCache,
} from "./junction.js";
import { thingsIn } from "./recognition.js";

// ── The bridge — the junction between two adjacent results ──────────────────
//
// A GRADED evidence ladder, exact before approximate (the same discipline as
// locate/alignGraded):
//
//   1. JUNCTION CONTAINERS by content-addressed identity.  Hash-consing means
//      "which learnt wholes ran L and R together?" is a DAG ascent, not a
//      similarity guess: any deposit containing L's bytes shares L's node (or
//      L's canonical-window ids — position-independent identities), so
//      climbing parents + containment links from L and R reaches every
//      container exactly.  The legacy resonance seed (gist of the bare
//      concatenation — an object never learnt) could rank the true container
//      out of its top-k; the ascent cannot.
//
//   2. EDGE JUNCTIONS.  A continuation edge IS junction information: when a
//      learnt continuation of L contains R, the prefix before R is the learnt
//      glue ("what comes after L on the way to R"); symmetrically, a learnt
//      context of R that contains L yields its suffix after L.  The legacy
//      bridge ignored edges entirely.
//
//   3. RESONANCE (the legacy path), kept as the last resort: containment
//      links absent or saturated, the ANN may still surface a container.
//
// Selection among several junctions: the response guide (ctx._edgeGuide — the
// same disambiguator every projection uses) picks by gist resonance through
// the session gist cache; ties prefer the SHORTEST interior (a junction
// should not insert unnecessary glue), then the lowest node id
// (deterministic, a property of the corpus, not the seed).  An EMPTY interior
// found by evidence is a confirmed adjacency — returned as such, never
// confused with a miss (null).

/** Rank junction candidates and return the best interior (see the module
 *  note above for the order), or null when there are none. */
function pickJunction(
  ctx: MindContext,
  cands: Junction[],
): Junction | null {
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  const guide = ctx._edgeGuide;
  const scored = cands.map((c) => {
    const g = guide !== null ? candidateGist(ctx, c.id) : null;
    return { ...c, score: g !== null && guide !== null ? cosine(guide, g) : 0 };
  });
  scored.sort((a, b) =>
    b.score - a.score ||
    a.interior.length - b.interior.length ||
    a.id - b.id
  );
  return scored[0];
}

/** Tier 2: junctions learnt as EDGES.  A continuation of left that contains
 *  right carries the glue as its prefix; a context of right that contains
 *  left carries it as its suffix.  Fan-outs read through the store's LIMITed
 *  edge reads at the hub bound, like every edge walk. */
function junctionEdges(
  ctx: MindContext,
  left: Uint8Array,
  right: Uint8Array,
  maxContainer: number,
): Junction[] {
  const bound = hubBound(ctx);
  const out: Junction[] = [];
  const lId = resolve(ctx, left);
  if (lId !== null) {
    // A FULL √N page of continuations means the side is an edge hub: its
    // fan-out is non-discriminative for a junction (the same common-content
    // abstention as tier 1's containment gate), and reading √N capped
    // continuations per pair is exactly the cost a miss must not pay.
    // Below the page the list IS the full fan — read exactly.
    const nexts = ctx.store.nextFirst(lId, bound);
    if (nexts.length < bound) {
      const cache = walkCache(ctx);
      for (const n of nexts) {
        // Prefix-capped read (same phrase-scale discipline as tier 1): a
        // continuation longer than any admissible container cannot carry a
        // junction-sized glue — skipped without reconstructing it.
        const b = cachedRead(ctx, cache, n, maxContainer);
        if (b.length > maxContainer) continue;
        const ri = indexOf(b, right, 0);
        if (ri >= 0) out.push({ id: n, interior: b.subarray(0, ri) });
      }
    }
  }
  const rId = resolve(ctx, right);
  if (rId !== null) {
    const prevs = ctx.store.prevFirst(rId, bound);
    if (prevs.length < bound) {
      const cache = walkCache(ctx);
      for (const p of prevs) {
        const b = cachedRead(ctx, cache, p, maxContainer);
        if (b.length > maxContainer) continue;
        const li = indexOf(b, left, 0);
        if (li >= 0) {
          out.push({ id: p, interior: b.subarray(li + left.length) });
        }
      }
    }
  }
  return out;
}

/** Per-response memo of bridge results, keyed by the response's lifecycle
 *  object (ctx.climbMemo — created fresh by respond() and nulled after, so
 *  entries can never outlive the read-only window they are valid in).  The
 *  cover's connector pre-resolution asks for the same byte pair through up
 *  to eight (site, answer) combinations, and fusion/CAST re-ask pairs the
 *  cover already resolved — each unique (left, right, allowance) is walked
 *  once per response.  Outside a response (climbMemo null) nothing is
 *  memoised, preserving standalone behaviour. */
const bridgeMemo = new WeakMap<object, Map<string, Uint8Array | null>>();

/** The connector that belongs BETWEEN two adjacent results — the graded
 *  junction ladder described in the module note above.  Returns null when
 *  the graph holds no evidence that the two ever ran together. */
export async function bridge(
  ctx: MindContext,
  left: Uint8Array,
  right: Uint8Array,
  interiorAllowance?: number,
): Promise<Uint8Array | null> {
  if (left.length === 0 || right.length === 0) return null;

  let memo: Map<string, Uint8Array | null> | undefined;
  let memoKey: string | undefined;
  if (ctx.climbMemo !== null) {
    // Per guide: the pick among several junctions reads the question's gist
    // (`pickJunction`), and a conversation's memos outlive one question.
    const life = ctx._edgeGuide ?? ctx.climbMemo;
    memo = bridgeMemo.get(life);
    if (memo === undefined) bridgeMemo.set(life, memo = new Map());
    // KEYED ON BYTES, NOT ON TEXT.  This key used to be built with
    // `decodeText`, which decodes lossily AND strips NUL — so it is not
    // injective on raw bytes, and a cache key that is not injective returns
    // one input's answer for another's.  `bridge` takes arbitrary byte
    // strings, and this system pads with NUL, so the collision is reachable:
    // [65,0,66] and [65,66,0] have the same length and both decode to "AB",
    // giving them the same key and the same cached bridge.
    //
    // `latin1` maps each byte to exactly one code unit and is therefore
    // injective; both lengths are included so the two sides cannot be
    // confused by a shared boundary, which is what the separator was for.
    memoKey = `${interiorAllowance ?? -1}:${left.length}:${right.length}:` +
      latin1(left) + latin1(right);
    const hit = memo.get(memoKey);
    if (hit !== undefined) return hit;
  }
  const result = await bridgeUncached(ctx, left, right, interiorAllowance);
  if (memo !== undefined && memoKey !== undefined) memo.set(memoKey, result);
  return result;
}

async function bridgeUncached(
  ctx: MindContext,
  left: Uint8Array,
  right: Uint8Array,
  interiorAllowance?: number,
): Promise<Uint8Array | null> {
  const joined = concat2(left, right);

  // The PHRASE-SCALE contract: a junction container is a learnt whole the
  // pair nearly exhausts.  By default the glue between the two sides may be
  // up to W (the perceptual quantum) times the content it joins; a caller
  // that KNOWS its interior legitimately carries more (the n-ary connector,
  // whose interior holds the intermediate answers themselves) passes its own
  // allowance.  This is what lets the identity walks read every candidate
  // with a hard byte cap instead of reconstructing corpus-sized deposits.
  const maxInterior = interiorAllowance ??
    (left.length + right.length) * ctx.space.maxGroup;
  const maxContainer = joined.length + maxInterior;

  // Tier 1 — junction containers, by content-addressed identity.
  const container = pickJunction(
    ctx,
    junctionContainers(ctx, left, right, maxContainer),
  );
  if (container !== null) {
    ctx.trace?.step(
      "bridge",
      [rItem(left, "left"), rItem(right, "right")],
      [rItem(container.interior, "connector", container.id)],
      "junction container — a learnt whole runs the two together (content-addressed ascent)",
    );
    return container.interior;
  }

  // Tier 2 — junctions learnt as edges.  An edge is not a containment: a
  // continuation of left holding right runs the two together with no learnt
  // whole holding both, so the containment ascent above cannot read it.
  const edge = pickJunction(
    ctx,
    junctionEdges(ctx, left, right, maxContainer),
  );
  if (edge !== null) {
    ctx.trace?.step(
      "bridge",
      [rItem(left, "left"), rItem(right, "right")],
      [rItem(edge.interior, "connector", edge.id)],
      "edge junction — a learnt continuation/context carries the glue between the two",
    );
    return edge.interior;
  }

  // Tier 3 — synonym junctions: the content-addressed container search
  // applied to halo siblings of left/right.  Container evidence is exact
  // (same DAG ascent as tier 1, with window-id-enhanced seeds); the
  // relaxation is only in which form occupies one side.
  const synonym = pickJunction(
    ctx,
    await junctionSynonyms(ctx, left, right, maxInterior),
  );
  if (synonym !== null) {
    ctx.trace?.step(
      "bridge",
      [rItem(left, "left"), rItem(right, "right")],
      [rItem(synonym.interior, "connector", synonym.id)],
      "synonym junction — a halo sibling of one answer runs together with the other in a learnt whole",
    );
    return synonym.interior;
  }

  // Tier 4 — the legacy resonance path (approximate, last resort).
  const hits = await ctx.store.resonate(
    gistOf(ctx, joined),
    ctx.cfg.recallQueryK * 2,
  );
  // `hits` arrive nearest-first, so the first containment-passing hit is also
  // the best-scoring container — no further evidence comparison is needed.
  for (const h of hits) {
    // Same phrase-scale cap as the identity tiers: a hit longer than any
    // admissible container is skipped without reconstructing it.
    const f = read(ctx, h.id, maxContainer + 1);
    if (f.length > maxContainer) continue;
    if (f.length <= joined.length) continue; // no room for a connector
    const li = indexOf(f, left, 0);
    if (li < 0) continue;
    const ri = indexOf(f, right, li + left.length);
    if (ri < 0) continue;
    ctx.trace?.step(
      "bridge",
      [rItem(left, "left"), rItem(right, "right")],
      [rItem(f.subarray(li + left.length, ri), "connector", h.id)],
      "resonant container — found by whole-gist resonance (approximate fallback)",
    );
    return f.subarray(li + left.length, ri);
  }
  return null;
}

/** Join two spans with the learnt connector between them, when one exists —
 *  the composition step every out-of-search assembly (multi-topic fusion,
 *  CAST's substitution and comparison) shares.  A miss joins the pieces BARE
 *  and is never silent: it emits the same `bridgeMiss` trace step everywhere,
 *  so a degraded join is visible in the rationale regardless of which
 *  mechanism paid it.  (The in-search connector splice in graph-search.ts is
 *  the same concept inside the deduction, where the join is a costed rule.) */
export async function joinWithBridge(
  ctx: MindContext,
  left: Uint8Array,
  right: Uint8Array,
): Promise<Uint8Array> {
  const link = await bridge(ctx, left, right);
  if (link === null) {
    ctx.trace?.step(
      "bridgeMiss",
      [rItem(left, "left"), rItem(right, "right")],
      [],
      "no learnt connector resonated between these pieces — concatenated bare",
    );
    return concat2(left, right);
  }
  return concatBytes([left, link, right]);
}

/** The pivot a produced answer bridges through: the longest UNCONSUMED learnt
 *  CONTEXT (a node bearing a continuation edge) whose bytes `answer` literally
 *  contains.  Candidates are the stored forms recognition reads in the answer
 *  (content-addressed, every offset), then confirmed by exact byte
 *  containment.
 *
 *  `voiced` carries the BYTES of the anchors the grounding mechanism declared
 *  it spoke for, and no candidate CONTAINED IN one of them may be pivoted
 *  through.  Node identity alone is too coarse a reading of "already spoken
 *  for": the same content is interned at several scales, so a strict fragment
 *  of a voiced anchor is a different id carrying no evidence the anchor did
 *  not already carry.  Measured on test/29 C2 — CAST voiced "William
 *  Shakespeare" (id 676) and the pivot hopped through "speare" (id 606, not
 *  in `consumed`) straight into that analog's own biography, which is exactly
 *  what the comparison had refused to voice.  The rule is CONTAINMENT, not
 *  overlap, so C3's further term — "Mona Lisa", inside the seat sentence but
 *  part of NEITHER analog — stays a candidate; whether the walk steps through
 *  it is the naming rule's decision (reasoning.ts, evidence.md). */
export async function pivotInto(
  ctx: MindContext,
  answer: Uint8Array,
  consumed: ReadonlySet<number>,
  voiced: readonly Uint8Array[] = [],
): Promise<number | null> {
  // THE THINGS THE ANSWER HOLDS (`thingsIn`): the stored forms recognition
  // reads in it and in its canonical spelling, each a thing — learnt WHOLE by
  // a deposit, leading on — with the span where the answer holds it.  The one
  // reader the engine's derive-through reads too.  Exact decides: recognition
  // is content-addressed, so containment is the span itself, never a re-read.
  //
  // A PIVOT MUST BE A THING, NOT A PIECE OF ONE.  Measured on a 200-line
  // templated log corpus, query "what happened to request_id=1042 and
  // request_id=1077?": one `pivotStep` replaced CAST's correct comparison by
  // pivoting through `s=70`, a four-byte tail of `latency_ms=70`, onto an
  // unrelated record.  The separator is not length — `Paris`, `Jupiter`,
  // `Mona Lisa` are short too — but what the deposit RECORDED: `Paris` was
  // learnt whole, `s=70` only as a piece.  (A resonance sweep of the answer's
  // sub-regions beside recognition proposed nothing more, and a structural
  // reading of the thing — no parents and no containers — answered the same;
  // both measured on the suite and 900 fresh queries.)
  //
  // LONGEST WINS, the corpus's order on a tie (recognition's, exact spelling
  // first): the span IS the thing's length, so the first candidate passing the
  // filters in descending length decides.
  const ranked = thingsIn(ctx, answer)
    .filter((t) => !consumed.has(t.id))
    .map((t, index) => ({ ...t, index }))
    .sort((a, b) =>
      (b.span[1] - b.span[0]) - (a.span[1] - a.span[0]) || a.index - b.index
    );
  for (const t of ranked) {
    const bytes = answer.subarray(t.span[0], t.span[1]);
    if (voiced.some((v) => indexOf(v, bytes, 0) >= 0)) continue;
    return t.id;
  }
  return null;
}

/** Which of the given labelled forms a span MEANS — generic resonance over
 *  perceived gists.  Each anchor form's gist is memoised; the span's gist
 *  is matched against them.  Returns null when nothing resonates closely
 *  enough — the caller declines rather than guessing. */
const anchorGists = new WeakMap<
  object,
  Array<{ name: string; v: Vec }>
>();
export async function meaningOf(
  ctx: MindContext,
  bytes: Uint8Array,
  anchors: ReadonlyArray<{ name: string; form: Uint8Array }>,
): Promise<string | null> {
  if (bytes.length === 0 || anchors.length === 0) return null;
  let gists = anchorGists.get(anchors);
  if (!gists) {
    gists = anchors.map((a) => ({
      name: a.name,
      v: gistOf(ctx, a.form),
    }));
    anchorGists.set(anchors, gists);
  }
  const qv = gistOf(ctx, bytes);
  const found = argmaxCosine(
    qv,
    gists,
    (g) => g.v,
    mergeThreshold(ctx.store.D),
  );
  return found?.item.name ?? null;
}
