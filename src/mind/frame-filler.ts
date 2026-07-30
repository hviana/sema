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
  // it" says nothing when the structures share nothing to begin with.  Two
  // readings were measured and BOTH fail:
  //
  //   • ALL resonance candidates.  They are merely near in gist, so a majority
  //     never forms, every byte reads as content, any span becomes a filler —
  //     and it does not merely fail to answer, it FABRICATES ("Tell me the name
  //     of the biggest planet orbiting our sun." grounded a list of animals).
  //   • candidates holding the query's discriminative content.  These are
  //     exemplars about the same THING, not instances of the same FRAME: the
  //     seven holding "Eiffel" share `" the Eiffel Tower"` and nothing else, so
  //     a whole clause reads as content and no constituent is isolated.
  //
  // The cohort of a subject is its STRUCTURAL NEIGHBOURS — the candidates whose
  // alignment covers the most of it — because instances of one frame are
  // exactly the forms that share that frame's bytes.  Two weaker readings were
  // measured and both fail: ALL candidates share nothing, so a majority never
  // forms, every byte reads as content and the tier FABRICATES; candidates
  // holding the query's rarest content are exemplars about the same THING, not
  // the same FRAME (the seven holding "Eiffel" share `" the Eiffel Tower"` and
  // nothing else), so no constituent is isolated.
  //
  // THE CUT is half-dominance against the BEST neighbour, not against the
  // subject's length.  Coverage is bounded by how much frame two forms can
  // share at all — measured, the best neighbour covered 23 of 59 bytes — so
  // `dominates(n, subject.length)` can never fire and the cohort is always
  // empty.  Read against the best coverage the profile actually offers, the
  // same convention becomes scale-free and needs no constant: a form sharing
  // more than half of what the closest instance shares is another instance.
  const coverageOf = (
    subject: Uint8Array,
    other: Uint8Array,
    keepEdges: Set<number> | null = null,
  ): number => {
    const seen = new Uint8Array(subject.length);
    for (const r of alignRuns(ctx, subject, other)) {
      if (keepEdges !== null) {
        keepEdges.add(r.qs);
        keepEdges.add(r.qe);
      }
      for (let i = r.qs; i < r.qe && i < seen.length; i++) seen[i] = 1;
    }
    let n = 0;
    for (const x of seen) n += x;
    return n;
  };
  // WHERE ANY EXEMPLAR'S SHARED MATERIAL STARTS OR STOPS.  Collected over EVERY
  // candidate, not just the cohort: the cut decides whose AGREEMENT establishes
  // the frame, which is a different question from where a boundary EXISTS.  One
  // exemplar ending a run at an offset is already evidence of an edge there,
  // however unrelated it is otherwise — measured, drawing edges from the cohort
  // alone loses the boundary between `"is"` and `"?"` (2 candidates of 563
  // attest it, 0 of 131 in the cohort), and without it the two-hop description
  // cannot be expressed at all.
  const edgesMemo = new Map<Uint8Array, Set<number>>();
  const cohortMemo = new Map<Uint8Array, Uint8Array[]>();
  const cohortOf = (subject: Uint8Array): Uint8Array[] => {
    const seen = cohortMemo.get(subject);
    if (seen !== undefined) return seen;
    const eset = new Set<number>([0, subject.length]);
    edgesMemo.set(subject, eset);
    let best = 0;
    const scored: Array<{ c: Uint8Array; n: number }> = [];
    for (const c of contexts) {
      if (c === subject) continue;
      const n = coverageOf(subject, c, eset);
      if (n < W) continue;
      if (n > best) best = n;
      scored.push({ c, n });
    }
    const out = scored.filter((x) => dominates(x.n, best)).map((x) => x.c);
    cohortMemo.set(subject, out);
    return out;
  };
  /** Split each run at the boundaries other exemplars attest for `subject` — a
   *  run is a stretch the cohort does not share, not itself a constituent, so
   *  taking it whole asks the evidence for a span no exemplar holds. */
  const cutAtEdges = (
    subject: Uint8Array,
    runs: Array<[number, number]>,
  ): Array<[number, number]> => {
    const eset = edgesMemo.get(subject);
    if (eset === undefined) return runs;
    const inner = [...eset].sort((a, b) => a - b);
    const out: Array<[number, number]> = [];
    for (const [rs, re] of runs) {
      let prev = rs;
      for (const o of inner) {
        if (o <= rs || o >= re) continue;
        if (o - prev >= W) out.push([prev, o]);
        prev = o;
      }
      if (re - prev >= W) out.push([prev, re]);
      out.push([rs, re]);
    }
    return out;
  };

  const queryContent = contentRuns(query, cohortOf(query));

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
    let bestAttested = 0;
    let bestLen = 0;
    // A content run is a stretch the cohort does not share; it is not itself a
    // constituent, and taking it whole asks the evidence for a span no exemplar
    // holds (measured: `" Eiffel Tower is?"` qualified NO candidate, so the tier
    // never probed).  Cut each run at the boundaries other exemplars attest —
    // the same edge set the descriptions are enumerated over — so the unit is a
    // span the corpus has actually seen begin and end.
    //
    // A unit may span ANY two attested edges, not just adjacent ones.  Slicing
    // only between consecutive edges makes the unit set depend on how DENSE the
    // evidence is rather than on what it says: measured, at k = 24 the query
    // carries 17 edges and `"Eiffel Tower"` is one slice (elected, attested),
    // while at k = 571 it carries 55 and every consecutive slice is 1-3 bytes —
    // all under the constituent bar — leaving only the whole unattested run and
    // electing nothing at all.  More evidence made the tier blinder.  Taking
    // every edge-bounded sub-span removes that dependence: the corpus decides
    // which spans exist, never how finely it happened to mark them.
    const pieces: Array<[number, number]> = [];
    for (const [cs0, ce0] of queryContent) {
      const inner = bs.filter((o) => o > cs0 && o < ce0);
      let prev = cs0;
      for (const o of [...inner, ce0]) {
        pieces.push([prev, o]);
        prev = o;
      }
      pieces.push([cs0, ce0]);
    }
    for (const [cs0, ce0] of pieces) {
      const s = Math.max(cs0, from);
      const e = Math.min(ce0, to);
      // ATTESTED, or it is not evidence.  Rarity is read over the span's FIRST
      // window, so every longer span sharing that window scores identically —
      // and the longer-wins tie-break below then elects the longest of them,
      // which is a claim about bytes the measurement never looked at.  Measured
      // live: the elected unit was `"Eiffel Tower is?"`, held by 0 of the 24
      // candidates, so guard 1 rejected every one and the tier never probed
      // (`descs=14, qualified=0, probes=0`).  Requiring the unit to occur in the
      // evidence is not an extra gate — guard 1 demands exactly this — it just
      // has to hold at ELECTION time, or election spends itself on a span no
      // candidate can qualify.
      let attested = 0;
      for (const c of contexts) {
        if (indexOf(c, query.subarray(s, e), 0) >= 0) attested++;
      }
      if (attested === 0) continue;
      // THE CONSTITUENT BAR — two quanta, the same reading argument binding
      // holds its constituents to.  Content runs are not units of a modality's
      // making, so a run may be as short as one window, and a single window is
      // too weak to say what a description is ABOUT: measured, the W-byte
      // fragment `phot` qualified `What is photosynthesis?` against an
      // unrelated "photo-sharing app" and fabricated an answer.
      if (e - s < 2 * W) continue;
      const r = rarityOf(s, e);
      if (r === Infinity) continue;
      // Rarity is read over the FIRST window, so spans sharing it are
      // indistinguishable to the measurement; among them the only measured
      // difference is how much evidence actually holds the span.  Preferring the
      // LONGER one asserts bytes never looked at — measured, it elected
      // `"Eiffel Tower "` (trailing space, 1 context) over `"Eiffel Tower"`
      // (2 contexts), so the one candidate that could complete the description
      // never qualified.  Length breaks only a genuine tie in both.
      if (
        r < bestRarity ||
        (r === bestRarity &&
          (attested > bestAttested ||
            (attested === bestAttested && e - s > bestLen)))
      ) {
        bestRarity = r;
        bestAttested = attested;
        bestLen = e - s;
        best = [s, e];
      }
    }
    return best;
  };

  const qEdges = edgesMemo.get(query) ?? new Set<number>([0, query.length]);
  for (const [cs0, ce0] of queryContent) {
    qEdges.add(cs0);
    qEdges.add(ce0);
  }
  const bs = [...qEdges].sort((a, b) => a - b);

  // The query's own discriminative content — every candidate description must
  // contain it, or the substitution is not about what the query is asking.
  const queryRare = rarestUnit(0, query.length);
  if (queryRare === null) {
    return done(
      null,
      "no corpus-attested unit in the query — nothing to describe",
      {
        contexts: contexts.length,
        qc: queryContent.length,
        edges: bs.length,
        runs: queryContent.map(([a, b]) => spanKey(query, a, b)),
      },
    );
  }

  let probes = 0;
  let descs = 0, qualified = 0, fillers = 0;
  const chosen = new Map<string, number>();
  const fillerSeen = new Set<string>();
  const budget = hubBound(ctx);
  // resolved form id -> the description span and filler that reached it
  const found = new Map<number, FrameFillerHit>();
  // Candidate description edges: every offset some exemplar's shared material
  // begins or ends at, plus the query's own extremes.

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
      descs++;
      {
        const u = spanKey(query, dRare[0], dRare[1]);
        chosen.set(u, (chosen.get(u) ?? 0) + 1);
      }
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
        qualified++;

        // Fillers: this hit's CONTENT — the spans its fellow candidates do not
        // share.  What the exemplars have in common is the frame they are all
        // instances of; what is left distinguishes THIS one, and that is the
        // constituent standing where the query's description stands.
        const runs = cutAtEdges(hit, contentRuns(hit, cohortOf(hit)));

        for (const [fs, fe] of runs) {
          if (fe - fs < W) continue;
          fillers++;
          if (fillerSeen.size < 40) fillerSeen.add(spanKey(hit, fs, fe));
          const filler = hit.subarray(fs, fe);
          if (indexOf(query, filler, 0) >= 0) continue;
          if (probes >= budget) {
            // Uniqueness cannot be established on a truncated search, and an
            // unestablished uniqueness claim is the ambiguity guard 4 exists
            // to refuse.
            return done(
              null,
              `probe budget (${budget}) exhausted — uniqueness unestablished`,
              {
                version: 1,
                probes,
                rarityReads,
                resolved: found.size,
                contexts: contexts.length,
                edges: bs.length,
                qc: queryContent.length,
                descs,
                qualified,
                fillers,
              },
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
    contexts: contexts.length,
    edges: bs.length,
    qc: queryContent.length,
    descs,
    qualified,
    fillers,
    fillerSeen: [...fillerSeen],
    chosen: [...chosen.entries()].map(([u, n]) => {
      const b = new Uint8Array(u.length);
      for (let i = 0; i < u.length; i++) b[i] = u.charCodeAt(i);
      const inAny = contexts.filter((c) => indexOf(c, b, 0) >= 0).length;
      return `${JSON.stringify(u)} x${n} inContexts=${inAny}`;
    }),
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
