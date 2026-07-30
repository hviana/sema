// frame-filler.ts — compositional substitution grounding (recall's last tier
// before refusal, after the substitution bridge).
//
// THE GAP (analyze_training.ts section G): `What is the capital of the country
// where the Eiffel Tower is?` returns silence, while the answer sits ONE edge
// away — `resolve("What is the capital of France?")` is a trained form with a
// continuation.  The query differs from it by a single contiguous span: a
// DEFINITE DESCRIPTION (`the country where the Eiffel Tower is`, 37 B) stands
// where a proper noun (`France`, 6 B) stands in the trained question.
//
// Every existing tier correctly declines.  Recall tier 0b needs the constituent
// to be an edge SOURCE (`Eiffel Tower` is out=0, in=1).  Every gist tier is
// blind here: cos(query, the trained form) = 0.0076, and `capital of Spain`
// scores 0.0174 — HIGHER than the correct one — so the target is not even in the
// ANN top-24.  The substitution bridge finds the alignment and then refuses it on
// RAW BALANCE, `dominates(6, 37)`, which it must: a short span standing for a
// long one is exactly how `France` → `Spain si(nce)` once voiced a wrong fact.
//
// THE REFRAMING.  The bridge asks whether the two spans are SIMILAR.  A definite
// description and the noun it denotes are not similar, they are CO-REFERENTIAL,
// so no similarity threshold can separate this case from that fabrication.  So
// this tier does not try.  Instead:
//
//     We invent a lookup KEY, never an answer.
//
// Build the query with the candidate filler in the description's place and
// require the STORE ITSELF to already hold that key, byte-exactly, by content
// address.  The answer is then the trained continuation of a form the store
// verifiably has — the same grounding tier 0 performs — so nothing is
// synthesised.  What is constructed is only a lookup key, and a key the store
// does not hold is discarded.
//
// FOUR GUARDS, each falsified into existence on the 15.7M-node store.  Dropping
// any one of them reintroduces a wrong answer or outright fabrication:
//
//   1. The evidence hit must literally contain the description's RAREST unit.
//      Pooling fillers from every ranked hit gives the twohop query 9 resolving
//      keys, dominated by `What is the capital of India?` → "New Delhi.".  And
//      qualifying on any SHARED unit rather than the rarest gives
//      `Can you write a short poem?` exactly one key,
//      `Can you write hello world in C?` — a confident wrong answer earned on
//      the scaffolding unit "write".
//   2. The frame must be NON-EMPTY: the description is a proper sub-span.
//      Otherwise two of the twohop keys replace the WHOLE query (`Immanuel
//      Kant`, `Africa`), which is not substitution at all.
//   3. The key must RESOLVE byte-exactly and lead somewhere.
//   4. Exactly ONE stored form may survive.  `What is the capital of Zamunda?`
//      produces 24 resolving keys in the weaker variants (Chile, India, Japan,
//      Italy …) — fabrication, refused here by ambiguity.  This is the same
//      discipline tier 0b applies ("two distinct maximal arguments mean the
//      query asks about neither alone").
//
// A NOTE ON WHY RESOLUTION ALONE IS NOT THE SAFETY ARGUMENT.  Holding the frame
// fixed and varying only the filler makes byte-exact resolution look like a
// perfect filter — every wrong filler tried returned null.  That is misleading:
// when the DESCRIPTION is searched too, 95,836 candidate keys were tried for the
// twohop query and 9 resolved.  Resolution is necessary, never sufficient; the
// guards above are what make it sound.
//
// COST — nothing on any answering path (this runs only where the alternative was
// silence), and no new retrieval: the ranked hits are the ones recall already
// computed.  On the refusal path, measured over 19 queries (every currently-empty
// battery probe, all three silence probes, three dialogue turns, and a 125-byte
// worst case): mean 22.7 ms, worst 452 probes / 102 ms, and 10 of the 19 need
// ZERO probes because guard 1 exits first.  Two things keep it there and both are
// load-bearing, not optimisations:
//
//   • fillers are MAXIMAL absent runs, not every sub-span of a hit (8,020 probes
//     → 452).  The twohop win survives because a sub-quantum unit (< W)
//     terminates a run: in `The most well-known landmark in France is the Eiffel
//     Tower.`, `in` breaks the run, so `France` IS itself a maximal run.
//   • rarity is memoised per response.  On the 125-byte query 3,882 rarity reads
//     collapse to 10 lookups, and that query drops from 309 ms to 22 ms.
//
// The probe budget is `hubBound` (√N), the same breadth every other bounded
// search here self-limits to.  Exhausting it REFUSES rather than answers:
// truncating the search would leave uniqueness (guard 4) unestablished, and an
// unestablished uniqueness claim is exactly the ambiguity the guard exists to
// catch.

// CONSTITUENCY COMES FROM AGREEMENT, NOT FROM BYTES.  This mechanism
// substitutes one CONSTITUENT for another, so it must know where a constituent
// begins — and there is no character class here, no "separator", no "word",
// because Sema has none.  A byte value cannot say whether it delimits: the
// alphabet is 256 learnt directions, one per byte, and asserting a class over
// it overrides what the corpus is able to state itself.
//
// The reading this uses is the store's own, already spelled out twice
// (pipeline-mechanism.ts's `framed` and cast.ts's frame gate):
//
//   A byte is FRAME when more than half the aligned structures share it, and a
//   SPAN is frame when more than half its bytes are.
//
// Scaffolding is what many exemplars have in common; content is what tells them
// apart.  So the spans come from ALIGNMENT (match.ts's `alignRuns`, the same
// literal W-gram alignment the weave is built on) and the judgement is
// `dominates` — both modality-free by construction.  In a grid the padding
// value would be shared by every exemplar and fall out as frame on exactly this
// test, with nothing rewritten.
//
// This is why asking "what are the units of this byte string?" has no answer
// here and every attempt to derive one failed (measured: the fold's own
// `segment` cuts mid-constituent, "The ca"/"pital of"; interning is
// uninformative because EVERY W-window is interned; `recognise` returns only
// whole learnt forms).  All three read ONE string alone.  Constituency is
// RELATIONAL — a property of what the corpus agrees on across exemplars — and
// only a comparison can expose it.

import type { MindContext } from "./types.js";
import { indexOf } from "../bytes.js";
import { leafIdRun } from "./canonical.js";
import { hubBound } from "./traverse.js";
import { alignRuns } from "./match.js";
import { dominates } from "../geometry.js";
import { foldTree, perceive } from "./primitives.js";
import { rItem } from "./trace.js";

/** A grounded frame-filler substitution: the stored form the constructed key
 *  resolved to, and the spans that explain how it was reached. */
export interface FrameFillerHit {
  /** The trained form the key resolved to — grounded through its own edge. */
  id: number;
  /** `[start, end)` of the query span the filler stood in for. */
  described: [number, number];
  /** The filler's bytes, for the rationale trace. */
  filler: Uint8Array;
}

/** A stable memo key for a byte span — latin1, so no UTF-8 validation and no
 *  allocation beyond the string itself. */
function spanKey(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Find the query's own most discriminative unit and the trained contexts that
 *  hold it, then try the store for the query with a candidate filler in the
 *  described span's place.  Returns the sole surviving stored form, or null. */
export function frameFillerSubstitution(
  ctx: MindContext,
  query: Uint8Array,
  ranked: ReadonlyArray<number>,
): FrameFillerHit | null {
  const W = ctx.space.maxGroup;
  const _t0 = Date.now();
  const t = ctx.trace?.enter("frameFiller", [rItem(query, "query")]);
  const done = (
    hit: FrameFillerHit | null,
    note: string,
    data?: unknown,
  ): FrameFillerHit | null => {
    t?.done(
      hit === null ? [] : [rItem(hit.filler, "filler", hit.id)],
      note,
      data,
    );
    return hit;
  };

  // ── CONSTITUENCY BY AGREEMENT ─────────────────────────────────────────
  // Read the candidate contexts once, bounded to phrase scale (a stored span
  // can run to hundreds of kilobytes, and a form an order of magnitude longer
  // than the question is not a candidate for BEING it with one span replaced).
  const capBytes = query.length * W;
  const hitMemo = new Map<number, Uint8Array | null>();
  const hitBytes = (sid: number): Uint8Array | null => {
    const seen = hitMemo.get(sid);
    if (seen !== undefined) return seen;
    const b = ctx.store.bytesPrefix(sid, capBytes + 1);
    const v = b.length === 0 || b.length > capBytes ? null : b;
    hitMemo.set(sid, v);
    return v;
  };
  const contexts: Uint8Array[] = [];
  for (const sid of ranked) {
    const h = hitBytes(sid);
    if (h !== null) contexts.push(h);
  }

  /** How many of `others` an alignment covers each byte of `subject` with —
   *  the same per-byte depth the weave accumulates, over the same literal
   *  alignment. */
  const depthOver = (
    subject: Uint8Array,
    others: ReadonlyArray<Uint8Array>,
  ): Uint16Array => {
    const depth = new Uint16Array(subject.length);
    for (const other of others) {
      if (other === subject) continue;
      for (const r of alignRuns(ctx, subject, other)) {
        for (let i = r.qs; i < r.qe && i < depth.length; i++) depth[i]++;
      }
    }
    return depth;
  };
  /** The maximal runs of `subject` that the majority does NOT share — its
   *  content, as opposed to the frame.  This is the constituent notion: a span
   *  no character class produced, only agreement. */
  const contentRuns = (
    subject: Uint8Array,
    others: ReadonlyArray<Uint8Array>,
    from = 0,
    to = subject.length,
  ): Array<[number, number]> => {
    // A single exemplar agrees with nothing, so nothing can be called frame
    // and no constituent is established — the honest reading is "none".
    if (others.length < 2) return [];
    const depth = depthOver(subject, others);
    const out: Array<[number, number]> = [];
    let start = -1;
    for (let i = from; i < to; i++) {
      const frame = dominates(depth[i], others.length);
      if (!frame) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        out.push([start, i]);
        start = -1;
      }
    }
    if (start >= 0) out.push([start, to]);
    return out;
  };

  // THE FRAME COHORT.  A frame is only established among exemplars that are
  // instances of the SAME frame — "more than half the aligned structures share
  // it" says nothing when the structures share nothing to begin with.  The
  // resonance candidates are not that set: they are merely near in gist, and
  // read as one cohort a majority never forms, so every byte reads as content
  // and any span at all becomes a filler.  Measured, and it does not merely
  // fail to answer — it FABRICATES ("Tell me the name of the biggest planet
  // orbiting our sun." grounded a list of animals).
  //
  // The cohort is the candidates that hold the query's own discriminative
  // content: exemplars talking about the same thing, whose agreement is
  // therefore about the frame rather than about coincidence.  Bootstrapped in
  // two passes, because naming that content needs constituents and constituents
  // need a cohort: pass 1 reads the query against everything to name its rarest
  // content, pass 2 keeps only the candidates holding it and re-reads.
  let cohort = contexts;
  let queryContent = contentRuns(query, cohort);

  // Corpus rarity of a unit, by how many trained forms contain its first
  // window — the same container-count reading the bridge's anchor picking uses.
  // Memoised per call: the same units recur across every candidate description.
  const rarityMemo = new Map<string, number>();
  let rarityReads = 0;
  const rarityOf = (from: number, to: number): number => {
    if (to - from < W) return Infinity;
    const key = spanKey(query, from, to);
    const seen = rarityMemo.get(key);
    if (seen !== undefined) return seen;
    rarityReads++;
    let value = Infinity;
    const ids = leafIdRun(ctx, query, from, from + W);
    if (ids !== null) {
      const wid = ctx.store.findBranch(ids);
      if (wid !== null) value = ctx.store.containers(wid).length;
    }
    rarityMemo.set(key, value);
    return value;
  };
  /** The most discriminative unit of `[from, to)`, as its span, or null when it
   *  has none.  Rarest first; at EQUAL rarity the LONGER unit wins, because the
   *  longer form carries more content at the same corpus frequency.  The
   *  tie-break is load-bearing on a small corpus, where every unit's container
   *  count collapses to 1 and first-wins would pick the query's opening unit
   *  ("What") over its subject ("Eiffel") — the subject is what a description
   *  must be about.  On a large corpus the counts separate on their own (54 vs
   *  1,586 for exactly that pair) and the tie-break never engages. */
  const rarestUnit = (
    from: number,
    to: number,
  ): [number, number] | null => {
    let best: [number, number] | null = null;
    let bestRarity = Infinity;
    let bestLen = 0;
    for (const [cs0, ce0] of queryContent) {
      const s = Math.max(cs0, from);
      const e = Math.min(ce0, to);
      if (e - s < W) continue;
      const r = rarityOf(s, e);
      if (r === Infinity) continue;
      if (r < bestRarity || (r === bestRarity && e - s > bestLen)) {
        bestRarity = r;
        bestLen = e - s;
        best = [s, e];
      }
    }
    return best;
  };

  // The query's own discriminative content — every candidate description must
  // contain it, or the substitution is not about what the query is asking.
  const queryRare = rarestUnit(0, query.length);
  if (queryRare !== null) {
    const mark = query.subarray(queryRare[0], queryRare[1]);
    const narrowed = contexts.filter((c) => indexOf(c, mark, 0) >= 0);
    if (narrowed.length >= 2) {
      cohort = narrowed;
      queryContent = contentRuns(query, cohort);
    }
  }
  if (queryRare === null) {
    return done(
      null,
      "no corpus-attested unit in the query — nothing to describe",
    );
  }

  let probes = 0;
  const budget = hubBound(ctx);
  // resolved form id -> the description span and filler that reached it
  const found = new Map<number, FrameFillerHit>();
  // Candidate description edges: where the query's content begins and ends.
  // Frame bytes are shared scaffolding, so a description that starts or stops
  // inside one is not a constituent boundary the corpus attests.
  const bset = new Set<number>([0, query.length]);
  for (const [cs0, ce0] of queryContent) {
    bset.add(cs0);
    bset.add(ce0);
  }
  const bs = [...bset].sort((a, b) => a - b);

  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const [dStart, dEnd] = [bs[i], bs[j]];
      // GUARD 2 — the frame must be non-empty: replacing the whole query is
      // not substitution.
      if (dStart === 0 && dEnd === query.length) continue;
      if (dEnd - dStart < W) continue;
      // The description must carry the query's discriminative content.
      if (dStart > queryRare[0] || dEnd < queryRare[1]) continue;
      const dRare = rarestUnit(dStart, dEnd);
      if (dRare === null) continue;
      const rareUnit = query.subarray(dRare[0], dRare[1]);

      for (const sid of ranked) {
        // PHRASE SCALE — the same bound the bridge puts on a candidate's bytes
        // (`capBytes = query.length * W`): a form an order of magnitude longer
        // than the question is not a candidate for BEING that question with one
        // span replaced.  Reading candidates in full instead was measured at
        // +650 ms on the winning query, since a stored span can run to hundreds
        // of kilobytes.
        const hit = hitBytes(sid);
        if (hit === null) continue;
        // GUARD 1 — this hit must literally hold the description's rarest unit.
        if (indexOf(hit, rareUnit, 0) < 0) continue;

        // Fillers: this hit's CONTENT — the spans its fellow candidates do not
        // share.  What the exemplars have in common is the frame they are all
        // instances of; what is left distinguishes THIS one, and that is the
        // constituent standing where the query's description stands.
        const runs = contentRuns(hit, cohort);

        for (const [fs, fe] of runs) {
          if (fe - fs < W) continue;
          const filler = hit.subarray(fs, fe);
          if (indexOf(query, filler, 0) >= 0) continue;
          if (probes >= budget) {
            // Uniqueness cannot be established on a truncated search, and an
            // unestablished uniqueness claim is the ambiguity guard 4 exists
            // to refuse.
            return done(
              null,
              `probe budget (${budget}) exhausted — uniqueness unestablished`,
              { version: 1, probes, rarityReads, resolved: found.size },
            );
          }
          probes++;
          // The KEY: the query with this filler in the described span's place.
          const key = new Uint8Array(
            dStart + filler.length + (query.length - dEnd),
          );
          key.set(query.subarray(0, dStart), 0);
          key.set(filler, dStart);
          key.set(query.subarray(dEnd), dStart + filler.length);
          // GUARD 3 — the store must already hold it, and it must lead
          // somewhere.  EXACT content address only, deliberately not
          // resolve(): that falls through to canonResolve on a miss, and a
          // constructed key misses by design — 451 of the 452 probes on the
          // winning query do — so each miss would pay a canon index query.
          // Measured: +650 ms on that query, for a claim WEAKER than the one
          // this guard wants.  A canon hit would mean the store holds a
          // case/width variant of a key we invented; guard 3 asks for the key
          // itself.
          const id = foldTree(ctx, perceive(ctx, key), 0).node;
          if (id === null || !ctx.store.hasNext(id)) continue;
          if (!found.has(id)) {
            found.set(id, {
              id,
              described: [dStart, dEnd],
              filler: filler.slice(),
            });
          }
        }
      }
    }
  }

  const data = {
    version: 1 as const,
    probes,
    rarityReads,
    resolved: found.size,
    budget,
    ms: Date.now() - _t0,
  };
  // GUARD 4 — exactly one trained form, or the query is ambiguous about its own
  // subject and neither is licensed.
  if (found.size === 1) {
    const hit = [...found.values()][0];
    return done(
      hit,
      "frame-filler substitution — the store holds this query with a " +
        "corroborated filler in the described span's place",
      data,
    );
  }
  return done(
    null,
    found.size === 0
      ? "no filler makes this query a stored form"
      : `${found.size} fillers make this query a stored form — ambiguous subject`,
    data,
  );
}
