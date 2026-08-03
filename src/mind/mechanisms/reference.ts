// mechanisms/reference.ts — Reference: voice a slot with the context's own
// bytes (Grounding V).
//
// This file is a CONFIGURATION of the shared frame reading in match.ts, not a
// pipeline of its own.  The three parts it configures live where §2.5 puts
// them and are reachable by any mechanism:
//
//   matcher     Precomputed.frames() — the frame INVENTORY: which ranked
//               candidates read as instances of the query's own frame, and
//               where each leaves the query VARIABLE.  Shared, election-free.
//   projection  follow() — each instance's own learnt continuation.
//   gate        carriesFillers() — the carriage licence.
//
// What this file adds is the reading and the price: elect one frame from the
// inventory, demand the licence of it, splice, and state the cost.
//
// WHAT KIND OF ACT THIS IS.  bridge.ts refuses this shape and is right to:
// `attestedQ` demands the query-side span be corpus-attested, because a
// SUBSTITUTION asserts equivalence ("these two spans mean the same"), and
// nothing can corroborate an equivalence claim about bytes the corpus has
// never seen.  A REFERENCE asserts no equivalence.  It asserts POSITION —
// "this is the thing you named, where the corpus keeps one" — and the bytes
// come from the asker, so voicing them cannot fabricate corpus knowledge.
// What CAN be fabricated is the relation claimed about them, which is exactly
// what the licence withholds.
//
// The same reasoning is why the bridge is NOT rewired to consult the frame
// inventory, though it is now free to: the bridge grounds through its
// candidate's continuation UNSUBSTITUTED, so admitting a slot-gap there would
// voice the corpus's filler for the asker's referent — the misreference
// measured live on the trained store ("How do you say 'flurbish' in French?"
// answered "the way to say hello is \"Bonjour\"").  Nor is CAST rewired: its
// frame gate is WEAVE-local while a slot is COHORT-local, and substituting one
// population for the other is the error §2.7 names.  The notion is made
// AVAILABLE, never imposed.

import type { MindContext } from "../types.js";
import type { FrameInstance } from "../match.js";
import { carriesFillers, distinct, follow, substituteAll } from "../match.js";
import { bytesEqual, indexOf } from "../../bytes.js";
import { unexplainedLabel } from "../rationale.js";
import { STEP } from "../graph-search.js";
import type {
  MechanismResult,
  PipelineMechanism,
  Precomputed,
} from "../pipeline-mechanism.js";
import { rItem, rNode, traceFail } from "../trace.js";

/** The minimum number of instances that can establish a frame.  One instance
 *  agrees with nothing, so no carriage is attested — the same "two or no
 *  constituent" reading frame-filler's contentRuns applies.
 *
 *  THIS IS ALSO THE MECHANISM'S REACH.  Evidence comes from the shared top-k
 *  resonance, so a frame the corpus instantiates only ONCE within k is not
 *  reachable here.  Measured on the trained store: `How do you say 'flurbish'
 *  in French?` finds one instance of its frame in the top 24 — the rest are
 *  `How do you make …`, a different frame — so this abstains and recall's
 *  scaffolding-dominated tier answers with the CORPUS's filler.  That
 *  misreference is recall's, and widening the supply is not the fix: the
 *  exhaustive √N list recall's refusal path builds costs hundreds of
 *  milliseconds and this runs before it.  Abstaining on thin evidence is the
 *  honest reading (§2.13). */
const MIN_INSTANCES = 2;

/** Elect ONE frame from the inventory: the instances that place the slots in
 *  the same query spans.
 *
 *  THE ELECTION IS THIS MECHANISM'S, not the inventory's (see
 *  Precomputed.frames).  Demanding that everything which aligned agree would
 *  be the wrong population: the top-k is ranked by gist, not by frame, so it
 *  mixes them — measured, `How do you say 'flurbish' in French?` returns one
 *  instance of its own frame and a dozen of `How do you make …`, which align
 *  on the shared opening and put their slot somewhere else entirely.  One
 *  dissenting frame would then veto every binding.
 *
 *  Instances of ONE frame put their slots in ONE place, so grouping by the
 *  whole slot signature and keeping the modal group IS the frame.  The
 *  signature is every slot, not one: two candidates agreeing about a file name
 *  but disagreeing about whether a second thing was named are instances of two
 *  different frames, and mixing them would let a one-slot instance vouch for a
 *  two-slot binding it says nothing about. */
function electFrame(
  inventory: ReadonlyArray<FrameInstance>,
): FrameInstance[] {
  const bySignature = new Map<string, FrameInstance[]>();
  for (const inst of inventory) {
    const key = inst.slots.map(([s, e]) => `${s}:${e}`).join(",");
    const group = bySignature.get(key);
    if (group === undefined) bySignature.set(key, [inst]);
    else group.push(inst);
  }
  let best: FrameInstance[] = [];
  for (const group of bySignature.values()) {
    // Ties keep the FIRST group in insertion order, which is resonance rank —
    // corpus-determined, like every other tie-break here (§2.1).
    if (group.length > best.length) best = group;
  }
  return best;
}

/** Voice the query's referents through their frame's own attested carriage, or
 *  null when the corpus does not attest one. */
export async function bindReference(
  ctx: MindContext,
  query: Uint8Array,
  pre: Precomputed,
): Promise<MechanismResult | null> {
  const t = ctx.trace?.enter("bindReference", [rItem(query, "query")]);
  const fail = traceFail(t);

  const frame = electFrame(await pre.frames());
  if (frame.length < MIN_INSTANCES) {
    return fail(
      `${frame.length} instance(s) of one frame — agreement needs ` +
        `${MIN_INSTANCES}`,
    );
  }
  const slots = frame[0].slots;
  const referents = slots.map(([s, e]) => query.subarray(s, e));

  // A referent must be the ASKER's, never the engine's own words.  A completed
  // reply stays available to recognition and the climb as context, but quoting
  // it back as a referent launders the engine's own output into evidence — the
  // same rule the weave applies when it aligns only the asker's stream.  ANY
  // slot falling inside one refuses the whole binding.
  for (const [rs, re] of slots) {
    for (const [as_, ae] of ctx.answeredSpans) {
      if (rs < ae && as_ < re) {
        return fail(
          "a referent lies inside a completed reply — not the asker's",
        );
      }
    }
  }
  // Two slots may not name the same bytes, for the same reason two fillers may
  // not (frameSlots applies it to every instance): the mapping from occurrence
  // to referent would be ambiguous.
  if (!distinct(referents)) {
    return fail("two slots name the same bytes — the binding is ambiguous");
  }

  // ── THE LICENCE ────────────────────────────────────────────────────────
  // Every instance must agree, against the first, that its continuation is its
  // own fillers carried through one fixed form.  Unanimity, exactly as the
  // bridge's `unanimous` demands of a frame before it will substitute.
  //
  // Continuations are followed ONE AT A TIME, inside the test, because the
  // overwhelmingly common outcome is refusal and a refusal usually comes from
  // the first comparison — a filler-dependent frame disagrees on instance 2 of
  // 12.  Reading all of them up front pays the whole cohort's projections to
  // discard them.  Each goes through the shared projection, so an ambiguous
  // instance is disambiguated exactly as it would be anywhere else.
  const leadsNowhere = "an instance of the frame leads nowhere";
  const first = await follow(ctx, frame[0].id, pre.guide);
  if (first === null || first.length === 0) return fail(leadsNowhere);
  for (let i = 1; i < frame.length; i++) {
    const cont = await follow(ctx, frame[i].id, pre.guide);
    if (cont === null || cont.length === 0) return fail(leadsNowhere);
    if (!carriesFillers(first, frame[0].fillers, cont, frame[i].fillers)) {
      ctx.trace?.step(
        "referenceLicence",
        [rItem(first, "instance"), rNode(ctx, frame[i].id, "against")],
        [rItem(cont, "attested")],
        "refused — the frame's answer carries content that depends on WHICH " +
          "filler, so the corpus cannot supply it for a new one",
      );
      return fail("the frame's answer is not a carriage of its fillers");
    }
  }

  // THE BINDING IS A BYTE CONSTRUCTION, NOT A SEARCH, and deliberately so.
  // Articulation splices through ctx.search.cover because WHICH voicing wins is
  // genuinely searched — several candidate substitutions compete.  Here the
  // licence has already determined the substitution byte-exactly; a search that
  // can only confirm a determined result is ceremony, not composition.  The
  // precedent is frame-filler, which constructs its lookup key the same way.
  const bytes = substituteAll(
    first,
    frame[0].fillers.map((needle, s) => ({ needle, repl: referents[s] })),
  );
  if (bytes.length === 0) return fail("the binding produced nothing");
  // Answering with the question is not answering — the same restated-fragment
  // guard every recall tier applies.
  if (bytes.length < query.length && indexOf(query, bytes, 0) >= 0) {
    return fail("the binding restates part of the question");
  }
  const carried = !bytesEqual(bytes, first);

  ctx.trace?.step(
    "bindReferent",
    [
      ...referents.map((r, s) =>
        rItem(r, `referent ${s + 1}`, undefined, slots[s])
      ),
      ...frame.map((inst) => rNode(ctx, inst.id, "instance")),
    ],
    [rItem(bytes, "bound")],
    carried
      ? `carry the asker's ${slots.length} referent(s) through the frame's own ` +
        `answer — ${frame.length} instances attest the carriage byte-exactly`
      : `the frame's answer does not depend on its filler(s) — ` +
        `${frame.length} instances attest the same continuation`,
  );

  // WHAT THIS EXPLAINS: the frame it matched literally, AND every slot.  A slot
  // is not a hole in the explanation — it is an act this mechanism PAID for,
  // one STEP each in `moves` below, and leaving it unaccounted charges the same
  // act twice (once as a move, once at PASS per byte, which is far the larger).
  // The bridge records the same reasoning for its own substitutions.
  const accounted: Array<[number, number]> = [
    ...frame[0].matched.filter(([s, e]) => e > s),
    ...slots,
  ].sort((a, b) => a[0] - b[0]);

  t?.done(
    [rItem(bytes, "answer")],
    "reference — the asker's referent(s) voiced through a slot the corpus " +
      "attests as a carriage",
  );
  return {
    bytes,
    accounted,
    // The acts: one BINDING per slot plus one edge FOLLOW across the frame's
    // own continuation — the same per-projection price CAST's substitution
    // schema pays for the structurally analogous act.  Not CONCEPT: the ladder
    // reserves that for halo-mediated acts, and a reference is decided by byte
    // identity, not distributional company.  Per-slot matters: a two-slot
    // binding claims strictly more than a one-slot binding, so where both are
    // licensed the smaller claim wins.
    moves: STEP * slots.length + STEP,
    unexplained: unexplainedLabel(query, accounted),
    // NOT scaffolding.  That field counts answer bytes carried through BECAUSE
    // NOTHING EXPLAINED THEM; a referent is carried because the frame's slot
    // explains it, and it is accounted above.  Reporting it would make every
    // licensed binding lose its equal-grade tie-breaks by construction.
    //
    // COMPLETE — post-grounding must not extend a binding.  The bound answer is
    // a byte string this mechanism CONSTRUCTED; the corpus never said it, so
    // pivoting through it treats the engine's own construction as a trained
    // fact — the same laundering the answeredSpans guard above refuses in the
    // other direction.  Measured: with the frame "How do I compile X?" ->
    // "Run gcc X" and a stored "Run gcc main.c" -> "then execute ./a.out", the
    // binding produced "Run gcc main.c" and reason() pivoted straight past it,
    // answering "then execute ./a.out" — the referent gone AND the question
    // unanswered.  This is what MechanismResult.complete documents: the query
    // IS a trained context (here, an instance of a trained frame), so its
    // continuation is the whole read-out.  Fusion still runs; it is gated on
    // the query REMAINDER, which a binding accounting frame plus slots leaves
    // empty.
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
    if (query.length < 2 * ctx.space.maxGroup) return null;
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
    // Measured on the byte-modality fixture (test/76): the frame's windows sit
    // in all three instances and the referents' in none, so the gate fired and
    // the mechanism abstained on an answer it had already derived correctly.
    //
    // What holds this honest is not window rarity but the licence: instances
    // agreeing on one slot signature, each leading somewhere, and unanimous
    // BYTE-EXACT carriage across all of them.
    return bound;
  },
  async run(ctx, query, pre) {
    const bound = await bindReference(ctx, query, pre);
    return bound === null ? [] : [bound];
  },
};
