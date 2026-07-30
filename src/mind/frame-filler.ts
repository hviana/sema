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
//   1. The evidence hit must literally contain the description's RAREST word.
//      Pooling fillers from every ranked hit gives the twohop query 9 resolving
//      keys, dominated by `What is the capital of India?` → "New Delhi.".  And
//      qualifying on any SHARED word rather than the rarest gives
//      `Can you write a short poem?` exactly one key,
//      `Can you write hello world in C?` — a confident wrong answer earned on
//      the scaffolding word "write".
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
//     → 452).  The twohop win survives because a sub-quantum word (< W)
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

import type { MindContext } from "./types.js";
import { indexOf } from "../bytes.js";
import { leafIdRun } from "./canonical.js";
import { hubBound } from "./traverse.js";
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

/** Separator bytes: whitespace plus the punctuation that delimits a written
 *  form.  Byte-level on purpose — a multi-byte UTF-8 sequence contains no
 *  separator byte, so its characters group into one word without decoding. */
function isSeparator(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d ||
    b === 0x3f || b === 0x2e || b === 0x2c || b === 0x21 ||
    b === 0x22 || b === 0x27;
}

/** Offsets at which a word-bounded span may begin or end. */
function boundaries(bytes: Uint8Array): number[] {
  const set = new Set<number>([0, bytes.length]);
  for (let i = 0; i < bytes.length; i++) {
    if (isSeparator(bytes[i])) {
      set.add(i);
      set.add(i + 1);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** `[start, end)` of every maximal run of non-separator bytes. */
function wordSpans(
  bytes: Uint8Array,
  from: number,
  to: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let i = from; i < to; i++) {
    if (isSeparator(bytes[i])) {
      if (start >= 0) out.push([start, i]);
      start = -1;
    } else if (start < 0) start = i;
  }
  if (start >= 0) out.push([start, to]);
  return out;
}

/** A stable memo key for a byte span — latin1, so no UTF-8 validation and no
 *  allocation beyond the string itself. */
function spanKey(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Find the query's own most discriminative word and the trained contexts that
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

  // Corpus rarity of a word, by how many trained forms contain its first
  // window — the same container-count reading the bridge's anchor picking uses.
  // Memoised per call: the same words recur across every candidate description.
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
  /** The most discriminative word of `[from, to)`, as its span, or null when it
   *  has none.  Rarest first; at EQUAL rarity the LONGER word wins, because the
   *  longer form carries more content at the same corpus frequency.  The
   *  tie-break is load-bearing on a small corpus, where every word's container
   *  count collapses to 1 and first-wins would pick the query's opening word
   *  ("What") over its subject ("Eiffel") — the subject is what a description
   *  must be about.  On a large corpus the counts separate on their own (54 vs
   *  1,586 for exactly that pair) and the tie-break never engages. */
  const rarestWord = (
    from: number,
    to: number,
  ): [number, number] | null => {
    let best: [number, number] | null = null;
    let bestRarity = Infinity;
    let bestLen = 0;
    for (const [s, e] of wordSpans(query, from, to)) {
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
  const queryRare = rarestWord(0, query.length);
  if (queryRare === null) {
    return done(
      null,
      "no corpus-attested word in the query — nothing to describe",
    );
  }

  let probes = 0;
  const budget = hubBound(ctx);
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
  // resolved form id -> the description span and filler that reached it
  const found = new Map<number, FrameFillerHit>();
  const bs = boundaries(query);

  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const [dStart, dEnd] = [bs[i], bs[j]];
      // GUARD 2 — the frame must be non-empty: replacing the whole query is
      // not substitution.
      if (dStart === 0 && dEnd === query.length) continue;
      if (dEnd - dStart < W) continue;
      // The description must carry the query's discriminative content.
      if (dStart > queryRare[0] || dEnd < queryRare[1]) continue;
      const dRare = rarestWord(dStart, dEnd);
      if (dRare === null) continue;
      const rareWord = query.subarray(dRare[0], dRare[1]);

      for (const sid of ranked) {
        // PHRASE SCALE — the same bound the bridge puts on a candidate's bytes
        // (`capBytes = query.length * W`): a form an order of magnitude longer
        // than the question is not a candidate for BEING that question with one
        // span replaced.  Reading candidates in full instead was measured at
        // +650 ms on the winning query, since a stored span can run to hundreds
        // of kilobytes.
        const hit = hitBytes(sid);
        if (hit === null) continue;
        // GUARD 1 — this hit must literally hold the description's rarest word.
        if (indexOf(hit, rareWord, 0) < 0) continue;

        // Fillers: maximal runs of consecutive hit words the query does not
        // already contain.  A run is broken by any word the query holds and by
        // any word below the fold quantum.
        let runStart = -1;
        let runEnd = -1;
        const runs: Array<[number, number]> = [];
        const closeRun = () => {
          if (runStart >= 0) runs.push([runStart, runEnd]);
          runStart = -1;
        };
        for (const [ws, we] of wordSpans(hit, 0, hit.length)) {
          const word = hit.subarray(ws, we);
          if (we - ws >= W && indexOf(query, word, 0) < 0) {
            if (runStart < 0) runStart = ws;
            runEnd = we;
          } else closeRun();
        }
        closeRun();

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
