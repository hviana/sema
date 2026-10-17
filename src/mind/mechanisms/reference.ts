// mechanisms/reference.ts — Reference: read the question through the instances
// of its frame (Grounding IV).
//
// THE READING.  A stored form that aligns with the question as ONE structure
// with variable positions (`frameSlots`) is an INSTANCE of the question's frame.
// Each instance shows how ITS answer depends on what fills its slots: carry the
// asker's referents through that answer — its fillers replaced by the bytes the
// question holds in the same slots — and the instance PROPOSES the question's
// answer.  Two kinds of dependence fall out of the one construction:
//
//   template   the answer holds a filler: `Run gcc hello.c` carries `main.c`;
//              the limit where the answer IS the filler is extraction
//              (`The dog is named Rex.` → `Rex` reads `Clover`);
//   constant   the answer holds no filler: every occupant gets the same one.
//
// THE LICENCE IS AGREEMENT ON THE OUTCOME.  The instances of one frame — the
// same variable positions, wherever chance shared bytes move a slot's border
// (`Darwin`/`Einstein` both end in `in`; `Poland` read against `England` keeps
// `land` in the template and still says `England`) — must ALL propose the same
// bytes, and at least AGREEMENT of them must exist: one instance cannot tell a
// carriage from a fact about its filler, and one breaking the pattern refuses
// all.  An answer that is a fact filed under its filler (`The place of birth of
// Peter Jackson is Wellington.`) is knowledge ABOUT that filler, a derivation,
// not a carriage: two such facts can agree by chance (test/76-reference-binding,
// Goodman 1955).
//
// THE PRECEDENTS, WHEN NO FRAME LICENSES.  The stored forms covering most of
// the question's discriminating bytes vote for their own continuations, said
// verbatim and only when they hold nothing the precedent varies in — nothing is
// carried, so the frame's positions do not matter.  A majority of AGREEMENT or
// more is a derivation; a lone precedent is the nearest stored form and is said
// as that, under recall's provenance; no majority is silence (`bindPrecedent`).
//
// WHAT KIND OF ACT THIS IS.  bridge.ts refuses this shape and is right to:
// `attestedQ` demands the query-side span be corpus-attested, because a
// SUBSTITUTION asserts equivalence ("these two spans mean the same").  A
// REFERENCE asserts POSITION — "this is the thing you named, where the corpus
// keeps one" — and the bytes come from the asker, so voicing them cannot
// fabricate corpus knowledge; what could is the relation claimed about them,
// which the licence withholds.

import type { MindContext } from "../types.js";
import type { FrameInstance } from "../match.js";
import { distinct, follow, substituteAll } from "../match.js";
import { resolve } from "../primitives.js";
import { hubBound, scaffoldSpans } from "../traverse.js";
import { AGREEMENT, dominates, twoQuanta } from "../../geometry.js";
import { bytesEqual, indexOf } from "../../bytes.js";
import { restates } from "../derivation.js";
import { STEP } from "../graph-search.js";
import type {
  MechanismResult,
  PipelineMechanism,
  Precomputed,
} from "../pipeline-mechanism.js";
import { rItem, rNode, traceFail } from "../trace.js";
import type { Scope } from "../rationale.js";

/** One frame is one set of variable positions: the same number of slots, each
 *  overlapping its counterpart.  Where a slot's borders fall is decided by
 *  bytes two forms share by chance, so the borders do not name the frame — the
 *  positions do. */
function sameFrame(a: FrameInstance, b: FrameInstance): boolean {
  return a.slots.length === b.slots.length &&
    a.slots.every((s, i) => {
      const o = b.slots[i];
      return s.gq[0] < o.gq[1] && o.gq[0] < s.gq[1];
    });
}

/** Voice the question's answer as the instances of its frame agree it is, or
 *  null when they do not. */
export async function bindReference(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
): Promise<MechanismResult | null> {
  const t = ctx.trace?.enter("bindReference", [rItem(query, "query")]);
  const framed = await bindFrame(ctx, query, pre, t);
  if (typeof framed !== "string") return framed;
  // The frame licenses nothing; the precedents may still.  They voice no
  // referent, so no frame refusal — all about voicing — bears on them.
  const precedent = await bindPrecedent(ctx, query, pre);
  if (precedent === null) return traceFail(t)(framed);
  t?.done(
    [rItem(precedent.bytes, "answer")],
    "reference — the precedents covering the question carry this answer, " +
      "which holds nothing they vary in",
  );
  return precedent;
}

/** The frame reading (see the file header): the answer, or why the frame
 *  licenses none. */
async function bindFrame(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
  t: Scope | undefined,
): Promise<MechanismResult | string> {
  const fail = (why: string): string => why;
  const W = ctx.space.maxGroup;

  // THE INSTANCES: forms that lead somewhere (an answer that aligns with the
  // question is no instance of what it asks), read as one structure whose
  // slots are all substitutions (an insertion or deletion has no occupant to
  // carry), sharing at least one window with the question (a frame with no
  // window in common is chance), and covering most of it (a frame the
  // question does not dominate is another sentence).  The largest frame is the
  // question's.
  const classes: FrameInstance[][] = [];
  for (const inst of await pre.frames()) {
    if (inst.slots.length === 0 || !ctx.store.hasNext(inst.id)) continue;
    if (inst.slots.some((s) => s.kind !== "substitution")) continue;
    if (!inst.matched.some(([a, b]) => b - a >= W)) continue;
    // THE FRAME MUST DOMINATE THE QUESTION, or this is a different sentence
    // that happens to align somewhere: `The capital of Peru is the city of …`
    // aligned with `how do you say thank you in the language of Nepal and …`
    // carried the slot `Nepal and in the language of Oman` into `The …town
    // parliament sits by the river`.  (The redesign around agreement on the
    // outcome dropped this gate; agreement says the instances agree, not that
    // they are instances of THIS question.)
    if (!dominates(inst.covered, query.length)) continue;
    const cls = classes.find((c) => sameFrame(c[0], inst));
    if (cls === undefined) classes.push([inst]);
    else cls.push(inst);
  }
  let frame: FrameInstance[] = [];
  // Ties keep the FIRST class, in resonance order (determinism.md).
  for (const c of classes) if (c.length > frame.length) frame = c;
  if (frame.length < AGREEMENT) {
    return fail(
      `${frame.length} instance(s) of one frame — agreement needs ${AGREEMENT}`,
    );
  }

  let bound: Uint8Array | null = null;
  let identity = false;
  let voiced: Array<[number, number]> = [];
  for (const inst of frame) {
    const fillers = inst.slots.map((s) => s.filler);
    const referents = inst.slots.map((s) => query.subarray(s.qs, s.qe));
    // A referent is the ASKER's, never the engine's own completed reply —
    // quoting one back would launder the engine's output into evidence.
    if (
      inst.slots.some((s) =>
        ctx.answeredSpans.some(([a, b]) => s.qs < b && a < s.qe)
      )
    ) return fail("a referent lies inside a completed reply — not the asker's");
    // Two slots holding the same bytes make the mapping ambiguous.
    if (!distinct(fillers) || !distinct(referents)) {
      return fail("two slots name the same bytes — the binding is ambiguous");
    }
    const cont = await follow(ctx, inst.id, pre.guide);
    if (cont === null || cont.length === 0) {
      return fail("an instance of the frame leads nowhere");
    }
    const c = resolve(ctx, cont);
    if (
      c !== null && inst.slots.some((s) => {
        const f = resolve(ctx, s.filler);
        return f !== null && ctx.store.nextFirst(f, hubBound(ctx)).includes(c);
      })
    ) return fail("the frame's answer is a fact filed under its filler");
    // What the answer carries of the asker: each voiced referent reaches one
    // window (below it, byte agreement is chance), and together they are a
    // minority of the question — the rest is what makes it an instance of this
    // frame at all.
    const carried: Array<[number, number]> = [];
    for (const [i, s] of inst.slots.entries()) {
      if (indexOf(cont, fillers[i], 0) < 0) continue;
      if (s.qe - s.qs < W) {
        return fail("a voiced referent is shorter than one window");
      }
      carried.push([s.qs, s.qe]);
    }
    const voicedBytes = carried.reduce((n, [a, b]) => n + b - a, 0);
    if (dominates(voicedBytes, query.length)) {
      return fail("the referents voiced are most of the question");
    }
    const bytes = substituteAll(
      cont,
      fillers.map((needle, i) => ({ needle, repl: referents[i] })),
    );
    if (bytes.length === 0) return fail("the binding produced nothing");
    if (bound !== null && !bytesEqual(bound, bytes)) {
      ctx.trace?.step(
        "referenceLicence",
        [rItem(bound, "proposed"), rNode(ctx, inst.id, "against")],
        [rItem(bytes, "proposed")],
        "refused — the frame's instances carry the asker's referents to " +
          "different answers",
      );
      return fail("the frame's instances propose different answers");
    }
    if (bound === null) voiced = carried;
    bound = bytes;
    if (referents.some((r) => bytesEqual(r, bytes))) identity = true;
  }
  // Answering with the question is not answering — unless the instances agree
  // that the answer IS the asker's referent (an identity carriage).
  if (!identity && restates(query, bound!, 0, { proper: true })) {
    return fail("the binding restates part of the question");
  }
  ctx.trace?.step(
    "bindReferent",
    frame.map((i) => rNode(ctx, i.id, "instance")),
    [rItem(bound!, "bound")],
    `${frame.length} instances of one frame carry the asker's referent(s) ` +
      `to the same answer`,
  );
  t?.done(
    [rItem(bound!, "answer")],
    "reference — the asker's referent(s) voiced through a frame whose " +
      "instances agree on the answer",
  );
  return {
    bytes: bound!,
    // WHAT THE ANSWER EXPLAINS: the frame it matched and the referents it
    // carries — one STEP per carried referent plus the follow across the
    // frame's continuation.  A slot the answer does not carry is not explained.
    accounted: [...frame[0].matched.filter(([s, e]) => e > s), ...voiced]
      .sort((a, b) => a[0] - b[0]),
    moves: STEP * voiced.length + STEP,
    // A CONSTRUCTED answer is complete: the walk must not take bytes the corpus
    // never said for a trained fact (the binding `Run gcc main.c` once pivoted
    // on to `then execute ./a.out`).  The asker's own referent read back is not
    // constructed, and reasoning may go on from it (`Rome` → its fact).
    complete: !identity,
  };
}

/** THE PRECEDENT READING (see the file header).
 *
 *  THE PRECEDENTS are the proposed forms that lead somewhere, share a window
 *  with the question and cover most of its DISCRIMINATING bytes.  Scaffolding
 *  is nobody's evidence (commonality.md): `LEITE DE COCO FRASCO 500ML` shares
 *  `FRASCO … 500ML` with `CRISTAL FRASCO C/500ML` and none of what tells them
 *  apart, so coverage is read past the bytes `scaffoldSpans` claims.  An
 *  insertion or deletion is a difference like any other: nothing is carried.
 *
 *  WHAT IS SAID is one precedent's continuation, verbatim, and only while no
 *  precedent's continuation holds what it varies in (`Run gcc hello.c`, `the
 *  way to say hello is "Bonjour"`): that is a carriage or a fact about the
 *  filler, and stays with the frame licence.  Below one window, a filler turning
 *  up in a continuation is chance — the floor a voiced referent clears.
 *
 *  THE VOTE.  Each precedent — a distinct deposit — is one vote; the answer is
 *  the one a majority leads to (`dominates`).  Without one, what varies
 *  evidently decides the answer: silence.  AGREEMENT or more votes is the
 *  corpus showing that what varies does not decide it, and is a derivation; a
 *  lone precedent shows nothing of the kind (`What is the capital of France?`
 *  says nothing about Peru), and is said as the nearest stored form: recall's
 *  provenance, near, not derived.
 *
 *  THE PRICE is the floor's shape, one binding and one edge followed; what no
 *  winning precedent matched stays unexplained and pays PASS per byte.  It
 *  reads the inventory this mechanism already holds and the scaffolding the
 *  cover already read: no new search. */
async function bindPrecedent(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
): Promise<MechanismResult | null> {
  const W = ctx.space.maxGroup;
  const scaffold = scaffoldSpans(ctx, query);
  const inScaffold = (a: number, b: number): number => {
    let n = 0;
    for (const [s0, e0] of scaffold) {
      n += Math.max(0, Math.min(b, e0) - Math.max(a, s0));
    }
    return n;
  };
  const discriminating = query.length - inScaffold(0, query.length);
  if (discriminating < W) return null; // the question is all frame
  const precedents: FrameInstance[] = [];
  for (const inst of await pre.frames()) {
    if (inst.slots.length === 0 || !ctx.store.hasNext(inst.id)) continue;
    if (!inst.matched.some(([a, b]) => b - a >= W)) continue;
    const shared = inst.matched.reduce(
      (n, [a, b]) => n + (b - a) - inScaffold(a, b),
      0,
    );
    if (dominates(shared, discriminating)) precedents.push(inst);
  }
  if (precedents.length === 0) return null;

  const votes: Array<{ bytes: Uint8Array; by: FrameInstance[] }> = [];
  for (const inst of precedents) {
    const cont = await follow(ctx, inst.id, pre.guide);
    if (cont === null || cont.length === 0) return null;
    const c = resolve(ctx, cont);
    for (const sl of inst.slots) {
      if (sl.filler.length < W) continue;
      if (indexOf(cont, sl.filler, 0) >= 0) return null;
      const f = resolve(ctx, sl.filler);
      if (
        c !== null && f !== null &&
        ctx.store.nextFirst(f, hubBound(ctx)).includes(c)
      ) return null;
    }
    const v = votes.find((x) => bytesEqual(x.bytes, cont));
    if (v === undefined) votes.push({ bytes: cont, by: [inst] });
    else v.by.push(inst);
  }
  // Ties keep the first, in inventory order (determinism.md) — and a tie is no
  // majority.
  let winner = votes[0];
  for (const v of votes) if (v.by.length > winner.by.length) winner = v;
  if (!dominates(winner.by.length, precedents.length)) {
    ctx.trace?.step(
      "precedentLicence",
      votes.map((v) => rItem(v.bytes, `proposed by ${v.by.length}`)),
      [],
      "refused — no answer is carried by a majority of the precedents",
    );
    return null;
  }
  if (restates(query, winner.bytes, 0, { proper: true })) return null;
  ctx.trace?.step(
    "bindPrecedent",
    [
      ...winner.by.map((p) => rNode(ctx, p.id, "precedent")),
      ...votes.filter((v) => v !== winner)
        .flatMap((v) => v.by.map((p) => rNode(ctx, p.id, "dissent"))),
    ],
    [rItem(winner.bytes, "bound")],
    `${winner.by.length} of ${precedents.length} precedent(s) carry this answer`,
    undefined,
    {
      version: 1,
      votes: winner.by.length,
      precedents: precedents.length,
      dissent: precedents.length - winner.by.length,
    },
  );
  return {
    bytes: winner.bytes,
    accounted: winner.by.flatMap((p) => p.matched.filter(([a, b]) => b > a)),
    ...(winner.by.length >= AGREEMENT ? {} : { provenance: "recall" }),
    moves: STEP + STEP,
    // A stored continuation, but the question is not its context: nothing is
    // walked on from it as though it were.
    complete: true,
  };
}

// ── Pipeline mechanism ──────────────────────────────────────────────────────

export const referenceMechanism: PipelineMechanism = {
  name: "reference",
  provenance: "reference",
  async floor(ctx, query, pre, worthRunning) {
    // The floor is exactly one binding plus one follow — the cheapest shape a
    // result can take.  INVESTMENT DISCIPLINE: when that already cannot beat
    // the incumbent, return it UNINVESTED rather than first-touching the shared
    // inventory (cast.ts and extraction.ts are the reference implementations).
    const bound = STEP + STEP;
    if (!worthRunning(bound)) return bound;
    // A frame needs a query long enough to hold one, and a slot needs at least
    // one window of its own beside it.
    if (query.length < twoQuanta(ctx.space.maxGroup)) return null;
    // A query the store holds outright is not a reference to anything — its own
    // edges answer it, and binding would re-derive what recall reads directly.
    // O(|query|) probes, already computed for this response.
    if (pre.queryResolved !== null) return null;
    // NO SCAFFOLDING GATE HERE, DELIBERATELY.  `allWindowsAreScaffolding` gates
    // recall's scaffolding-dominated tier and looks like the obvious third
    // gate, but it is calibrated for mechanisms grounding THROUGH the query's
    // stored windows, where "every window is a hub" means the query says
    // nothing the corpus can be held to.  A reference query's discriminative
    // content is the SLOT — exactly the part the corpus cannot attest — so the
    // predicate reports "all scaffolding" for the purest references there are.
    // Measured on test/76-reference-binding's byte-modality fixture: the
    // frame's windows sit in all three instances and the referents' in none,
    // so the gate fired and the mechanism abstained on an answer it had already
    // derived correctly.
    //
    // What holds this honest is not window rarity but the licence: AGREEMENT
    // instances of one frame, each leading somewhere, all proposing the same
    // answer byte for byte.
    return bound;
  },
  async run(ctx, query, pre) {
    const bound = await bindReference(ctx, query, pre);
    return bound === null ? [] : [bound];
  },
};
