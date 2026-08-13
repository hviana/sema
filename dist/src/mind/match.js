// match.ts — the ONE elementary operation behind every generalising mechanism:
// MATCH a learned structure against bytes, then PROJECT along a learned
// relation, gated by a derived threshold.
//
// Every grounding/generalisation mechanism in the mind is a configuration of
// this single (matcher, direction, gate) operation:
//
//   mechanism           matcher                        direction     gate
//   ─────────────────── ────────────────────────────── ───────────── ────────────────
//   cover follow-edge   exact (content-addressed)      forward       —
//   concept hop         halo sibling                   forward       conceptThreshold
//   recall tier 0–1     identity / whole-query gist    fwd/reverse   identityBar
//   skill extraction    locate() ladder (exact→halo→   read-out      per-step gates
//                       gist) on the exemplar's frames
//   CAST substitution   alignGraded() (graded ladder:  insert        frame shapes
//                       literal W-grams → halo sites)
//   CAST comparison     analogyStrength() (halo,       juxtapose     significanceBar
//                       direct or mutual-sibling)
//   multi-hop pivot     byte containment               forward       —
//   articulation        halo sibling                   substitute    conceptThreshold
//   reference           frameSlots() (the shared       carry into    carriesFillers
//                       aligner, gaps contracted)      the answer
//
// This module holds the shared vocabulary those configurations are built
// from — the MATCHERS (locate, alignRuns, alignGraded, alignAround/frameSlots,
// analogyStrength) and the PROJECTIONS (follow, conceptHop, reverseContext,
// project) — so each mechanism file states only its configuration, never its
// own copy of the machinery.  Most gates live in geometry.ts (derived, never
// tuned); the two STRUCTURAL gates that are byte predicates rather than
// thresholds — isSpanShaped and carriesFillers — live here beside the matchers
// they gate.
import { addInto, cosine, dot, normalize, zeros } from "../vec.js";
import { conceptThreshold, dominates, identityBar, significanceBar, } from "../geometry.js";
import { bytesEqual, indexOf } from "../bytes.js";
import { chainReach, leafIdRun } from "./canonical.js";
import { foldTree, gistOf, perceive, read, resolve } from "./primitives.js";
import { argmaxCosine, chooseAmong, chooseNext, corpusN, edgeAncestors, guidedFirst, hubBound, hubCap, sharedReachMemo, } from "./traverse.js";
import { recognise, segment } from "./recognition.js";
// ═══════════════════════════════════════════════════════════════════════════
// MATCHERS — locating learned structure in/against bytes, by graded strictness
// ═══════════════════════════════════════════════════════════════════════════
/** The graded LOCATE ladder: find `needle` in `haystack` starting at
 *  `fromPos`, strictest matcher first, relaxing only when the stricter one
 *  fails.  This is the read-out matcher skill extraction locates exemplar
 *  frames with.
 *
 *  1. exact    — literal byte match (the fast path).
 *  2. halo     — the needle's distributional role matches a recognised query
 *                form (gate: conceptThreshold).
 *  3. gist     — the needle's perceived gist matches a query segment
 *                (gate: identityBar — scale-aware).
 *
 *  Returns the absolute byte position, or −1. */
export function locate(ctx, haystack, needle, fromPos, sites) {
    // 1. Exact match — fast, preserves backward compatibility.
    const exact = indexOf(haystack.subarray(fromPos), needle, 0);
    if (exact >= 0)
        return fromPos + exact;
    // 2. Halo-based: the frame bytes' distributional role matches a query form.
    if (sites && sites.length > 0) {
        const frameId = resolve(ctx, needle);
        if (frameId !== null) {
            const frameHalo = ctx.store.halo(frameId);
            if (frameHalo) {
                const bestSite = bestHaloMate(ctx, frameHalo, sites.filter((s) => s.start >= fromPos), (s) => ctx.store.halo(s.payload));
                if (bestSite !== null)
                    return bestSite.item.start;
            }
        }
    }
    // 3. Gist resonance: the frame's perceived gist against query segments.
    const frameGist = gistOf(ctx, needle);
    const segments = segment(ctx, haystack.subarray(fromPos));
    // The gist tier claims the WHOLE needle appears as a segment — an
    // identity claim over `needle.length` bytes, so its bar is the
    // scale-aware {@link identityBar} (one river window of tolerated foreign
    // bytes), not the fixed estimator floor.  For quantum-sized frames the
    // two coincide; for long needles the fixed bar accepted segments that
    // differed by whole windows.
    const bestSeg = argmaxCosine(frameGist, segments, (s) => s.v, identityBar(ctx.store.D, ctx.space.maxGroup, needle.length), true);
    if (bestSeg !== null)
        return fromPos + bestSeg.item.start;
    return -1;
}
/** The ALIGNED matcher: maximal literal matching runs between `query` and
 *  `ct` (a learned context's bytes), by seed-and-extend over
 *  `space.maxGroup`-sized n-gram seeds.  Where locate() finds ONE position of
 *  a short frame, this finds EVERY run two whole structures share — the
 *  matcher CAST detects a woven query with.  Returns non-overlapping runs
 *  sorted by query position. */
export function alignRuns(ctx, query, ct) {
    if (ctx.meter) {
        ctx.meter.alignments++;
        // The alignment family's honest unit: the seed index is O(|query|) but
        // the run extension is O(|query|·|ct|) in the worst case, and a weave
        // that starts scanning conversation-length contexts shows up HERE long
        // before it shows up in a call count.
        ctx.meter.alignCells += query.length * ct.length;
    }
    // MEASURED AND REFUTED — seeding at the write side's unit floor W−1 instead
    // of W.  `canonicalWindows` interns both lengths precisely so a form
    // straddling a group boundary is reachable from either cut, and the runs
    // found here are exactly such remnants: test/29 C1's query shares only `ce `
    // with `Ice is cold` — three bytes, never seeded at W, so that structure
    // enters the weave carrying nothing but the scaffolding run every exemplar
    // shares.  But this is a byte MATCHER between two streams, not an index, and
    // at W−1 the corpus is dense with spurious 3-byte agreements: the extra runs
    // reshuffle which point claims which span, and test/29 A2 loses its analog.
    // C1 does not pass either way.  The store's unit floor does not transfer to
    // the aligner's seed length.
    const quantum = Math.min(ctx.space.maxGroup, ct.length);
    if (quantum < 1 || query.length < quantum)
        return [];
    const gram = (b, at) => {
        let s = "";
        for (let i = 0; i < quantum; i++)
            s += String.fromCharCode(b[at + i]);
        return s;
    };
    const seeds = new Map();
    for (let i = 0; i + quantum <= query.length; i++) {
        const k2 = gram(query, i);
        const bucket = seeds.get(k2);
        if (bucket === undefined)
            seeds.set(k2, [i]);
        else
            bucket.push(i);
    }
    const found = [];
    for (let j = 0; j + quantum <= ct.length; j++) {
        const bucket = seeds.get(gram(ct, j));
        if (bucket === undefined)
            continue;
        for (const i of bucket) {
            if (i > 0 && j > 0 && query[i - 1] === ct[j - 1])
                continue;
            let len = quantum;
            while (i + len < query.length && j + len < ct.length &&
                query[i + len] === ct[j + len])
                len++;
            found.push({ qs: i, qe: i + len, cs: j, len });
        }
    }
    found.sort((a, b) => b.len - a.len);
    const runs = [];
    for (const r of found) {
        const clash = runs.some((o) => (r.qs < o.qe && o.qs < r.qe) ||
            (r.cs < o.cs + (o.qe - o.qs) && o.cs < r.cs + r.len));
        if (!clash)
            runs.push({ qs: r.qs, qe: r.qe, cs: r.cs });
    }
    return runs.sort((a, b) => a.qs - b.qs);
}
/** The GRADED alignment matcher: extends literal W-gram alignment
 *  ({@link alignRuns}) with halo-matched recognised sites in query regions
 *  that have no literal coverage.  Same ladder as {@link locate}: literal
 *  first, then distributional role (halo-matched sites, gate:
 *  conceptThreshold, enforced by {@link bestHaloMate}).  Returns weighted
 *  runs sorted by query position.
 *
 *  `querySites` are the pre-computed recognition sites for the query
 *  (optional — when absent, only literal alignment fires and graded degrades
 *  to the original behaviour).  Context sites are recognised internally. */
export function alignGraded(ctx, query, contextBytes, querySites) {
    const lit = alignRuns(ctx, query, contextBytes);
    const out = lit.map((r) => ({ ...r, weight: 1 }));
    if (!querySites || querySites.length === 0)
        return out;
    // Mark query positions ALREADY covered by literal runs — halo fills gaps.
    // If literal coverage is already complete, skip the halo step entirely
    // (recognise is O(|ctx|·W) — wasted when every byte is accounted for).
    const covered = new Uint8Array(query.length);
    let gaps = false;
    for (const r of lit) {
        for (let i = r.qs; i < r.qe; i++)
            covered[i] = 1;
    }
    for (let i = 0; i < query.length; i++) {
        if (!covered[i]) {
            gaps = true;
            break;
        }
    }
    if (!gaps)
        return out;
    // Recognise sites in the exemplar context — structural positions for halo
    // matching.  (Circular import with recognition.ts is safe: recognise() is
    // called lazily, never at module load — the same pattern `segment` uses.)
    const ctxSites = recognise(ctx, contextBytes).sites;
    if (ctxSites.length === 0)
        return out;
    // Context sites with halos, hoisted: the same set serves every query site.
    const ctxCands = ctxSites.filter((cs) => ctx.store.hasHalo(cs.payload));
    if (ctxCands.length === 0)
        return out;
    // Candidate halos, also hoisted (lazily, first query site that needs them):
    // bestHaloMate consults every candidate's halo PER QUERY SITE, and sites
    // share the candidate set — without this memo the same few dozen halos were
    // re-fetched thousands of times per response.  Distinct payloads can repeat
    // across sites, hence the map by payload id.
    const ctxHalos = new Map();
    const ctxHaloOf = (cs) => {
        let h = ctxHalos.get(cs.payload);
        if (h === undefined) {
            h = ctx.store.halo(cs.payload);
            ctxHalos.set(cs.payload, h);
        }
        return h;
    };
    for (const qs of querySites) {
        // Only sites that overlap UNCOVERED query regions add new evidence.
        let touchesGap = false;
        for (let i = qs.start; i < qs.end; i++) {
            if (!covered[i]) {
                touchesGap = true;
                break;
            }
        }
        if (!touchesGap)
            continue;
        const qHalo = ctx.store.halo(qs.payload);
        if (!qHalo)
            continue;
        // bestHaloMate already gates at conceptThreshold — no second check needed.
        const match = bestHaloMate(ctx, qHalo, ctxCands, ctxHaloOf);
        if (match === null)
            continue;
        out.push({
            qs: qs.start,
            qe: qs.end,
            cs: match.item.start,
            weight: match.score,
        });
    }
    out.sort((a, b) => a.qs - b.qs);
    return out;
}
/** Extend a seed match (query offset qo ↔ candidate offset co) to its maximal
 *  common run, then walk outward in both directions collecting further common
 *  runs of at least W bytes across bounded mismatch gaps (each side ≤
 *  chainReach).  Returns the matched query spans and the mismatch pairs
 *  between consecutive runs.
 *
 *  This is the SEEDED aligner, distinct from {@link alignRuns}: that one finds
 *  every run two structures share anywhere (a weave), this one reads two
 *  streams as ONE structure that diverges in bounded places (a frame with
 *  slots).
 *
 *  Gaps come back in SWEEP order (right sweep, then left), not query order,
 *  and only the INTERIOR ones are reported — a consumer that needs the query's
 *  unmatched head or tail derives it from `matched`.  Both are the bridge's
 *  contract, which prices its edges separately (see its matchStart/matchEnd
 *  window test); {@link frameSlots} takes the other reading. */
export function alignAround(ctx, q, c, qo, co) {
    const W = ctx.space.maxGroup;
    const reachCap = chainReach(W);
    // Maximal run around the seed.
    let qs = qo, ss = co;
    while (qs > 0 && ss > 0 && q[qs - 1] === c[ss - 1]) {
        qs--;
        ss--;
    }
    let qe = qo, se = co;
    while (qe < q.length && se < c.length && q[qe] === c[se]) {
        qe++;
        se++;
    }
    const matched = [[qs, qe]];
    const gaps = [];
    // The next common run of ≥ W bytes past (qi, si), with each side's gap
    // bounded by chainReach; smallest total gap wins (nearest continuation).
    const runLenAt = (qi, si) => {
        let n = 0;
        while (qi + n < q.length && si + n < c.length && q[qi + n] === c[si + n]) {
            n++;
        }
        return n;
    };
    // RIGHT sweep.
    let qi = qe, si = se;
    for (;;) {
        let found = false;
        for (let total = 1; total <= 2 * reachCap && !found; total++) {
            for (let gq = 0; gq <= Math.min(total, reachCap); gq++) {
                const gs = total - gq;
                if (gs > reachCap)
                    continue;
                if (qi + gq >= q.length || si + gs >= c.length)
                    continue;
                const n = runLenAt(qi + gq, si + gs);
                if (n >= W || qi + gq + n === q.length) {
                    if (n === 0)
                        continue;
                    if (gq > 0 || gs > 0) {
                        gaps.push({ qs: qi, qe: qi + gq, cs: si, ce: si + gs });
                    }
                    matched.push([qi + gq, qi + gq + n]);
                    qi = qi + gq + n;
                    si = si + gs + n;
                    found = true;
                    break;
                }
            }
        }
        if (!found)
            break;
    }
    // LEFT sweep (mirror).
    qi = qs;
    si = ss;
    for (;;) {
        let found = false;
        for (let total = 1; total <= 2 * reachCap && !found; total++) {
            for (let gq = 0; gq <= Math.min(total, reachCap); gq++) {
                const gs = total - gq;
                if (gs > reachCap)
                    continue;
                if (qi - gq <= 0 || si - gs <= 0)
                    continue;
                // Run ENDING at (qi - gq, si - gs).
                let n = 0;
                while (n < qi - gq && n < si - gs &&
                    q[qi - gq - 1 - n] === c[si - gs - 1 - n]) {
                    n++;
                }
                if (n >= W || n === qi - gq) {
                    if (n === 0)
                        continue;
                    if (gq > 0 || gs > 0) {
                        gaps.push({ qs: qi - gq, qe: qi, cs: si - gs, ce: si });
                    }
                    matched.push([qi - gq - n, qi - gq]);
                    qi = qi - gq - n;
                    si = si - gs - n;
                    found = true;
                    break;
                }
            }
        }
        if (!found)
            break;
    }
    return { matched, gaps };
}
/** Contract a gap to its VARYING CORE: strip the prefix and suffix the two
 *  sides share.  {@link alignAround} cannot match a shared affix shorter than
 *  W, so that affix lands INSIDE the gap — measured, the slot of
 *  `How do I compile main.c?` against `…hello.c?` comes back as
 *  `main.c?`/`hello.c?`, three bytes of which (`.c?`) both sides hold.
 *
 *  Splicing the uncontracted gap carries the query's own punctuation into the
 *  answer; worse, it hides what actually VARIES, which is the only thing a
 *  cohort can agree about.  Returns null when nothing is left on either side —
 *  a pure insertion or deletion, which names no slot. */
export function contractGap(q, c, g) {
    let { qs, qe, cs, ce } = g;
    while (qs < qe && cs < ce && q[qs] === c[cs]) {
        qs++;
        cs++;
    }
    while (qe > qs && ce > cs && q[qe - 1] === c[ce - 1]) {
        qe--;
        ce--;
    }
    return qe > qs && ce > cs ? { qs, qe, cs, ce } : null;
}
/** THE SLOT MATCHER: read one query ↔ context pairing as one structure with
 *  variable positions.
 *
 *  IT REPORTS; IT DOES NOT JUDGE.  This returns every gap the aligner found,
 *  contracted to its varying core and tagged with its kind, plus the shared
 *  coverage — and rejects nothing.  That is the whole point of the split, and
 *  it was got WRONG first: four VOICING gates (the frame must dominate the
 *  query, each slot must reach one window on both sides, an insertion or
 *  deletion disqualifies the pairing, fillers must be pairwise distinct) were
 *  applied here, and every one of them is a requirement for SUBSTITUTING AND
 *  SPEAKING, not for knowing where a pairing varies.  With them in place the
 *  shared reading was reference-shaped: measured over four real pairings, three
 *  were hidden from every consumer —
 *
 *    `What is the capital of the country where the Eiffel Tower is?`
 *        against `What is the capital of France?`  (covered 23/61)  HIDDEN
 *    `What is the capital of France, really?`      (an insertion)   HIDDEN
 *    `What is the capital of Fran?`                (sub-window)     HIDDEN
 *
 *  — including the case of the one consumer that most obviously needed it.  A
 *  shared layer with one usable consumer is private code at a public address.
 *  Each gate now lives with the mechanism that needs it (see reference.ts).
 *
 *  Seeded at the origin, because a frame is shared structure the query and its
 *  instances both OPEN with: the maximal run around (0,0) is the frame's head
 *  and the sweeps find the rest.
 *
 *  Null only for a degenerate pairing (either side empty). */
export function frameSlots(ctx, query, cand, id) {
    if (query.length === 0 || cand.length === 0)
        return null;
    const { matched, gaps } = alignAround(ctx, query, cand, 0, 0);
    const spans = [...matched].sort((a, b) => a[0] - b[0]);
    // Where the alignment RAN OUT on each side.  Seeded at the origin there is
    // no leading gap, so both cursors are everything consumed so far: the
    // matched runs (equal length on both sides by construction) plus what each
    // interior gap ate of its own side.  Counting only the runs reads the
    // candidate cursor short by exactly the fillers already seen, and invents a
    // trailing gap on every well-aligned instance.
    const all = [...gaps];
    let qEnd = 0, cEnd = 0;
    for (const [s, e] of spans) {
        cEnd += e - s;
        qEnd = Math.max(qEnd, e);
    }
    for (const g of gaps)
        cEnd += g.ce - g.cs;
    if (qEnd < query.length || cEnd < cand.length) {
        all.push({ qs: qEnd, qe: query.length, cs: cEnd, ce: cand.length });
    }
    const slots = [];
    for (const gap of all.sort((a, b) => a.qs - b.qs)) {
        if (gap.qe <= gap.qs && gap.ce <= gap.cs)
            continue;
        // Contract to the varying core.  contractGap returns null when one side is
        // wholly shared with the other — a pure insertion or deletion, which is a
        // real variation and is reported AS ONE, not discarded.
        const core = contractGap(query, cand, gap);
        const g = core ?? gap;
        const kind = g.qe > g.qs && g.ce > g.cs
            ? "substitution"
            : g.qe > g.qs
                ? "insertion"
                : "deletion";
        slots.push({
            qs: g.qs,
            qe: g.qe,
            cs: g.cs,
            ce: g.ce,
            kind,
            filler: cand.slice(g.cs, g.ce),
        });
    }
    const covered = spans.reduce((n, [s, e]) => n + e - s, 0);
    return { id, slots, matched: spans, covered };
}
/** THE DISPLACED-FILLER GATE: does `projection` speak the ANCHOR's occupant of
 *  a position the query fills differently?
 *
 *  A mechanism grounding through an anchor voices that anchor's continuation.
 *  When the query is the same structure as the anchor with one position filled
 *  differently — a different filename, a different word — the anchor's
 *  continuation is ABOUT THE ANCHOR'S occupant, and voicing it answers a
 *  question the asker did not ask.  It is worse than silence, because it is
 *  fluent and specific and wrong:
 *
 *      trained  `How do I compile hello.c?` -> `Run gcc hello.c`
 *      asked    `How do I compile main.c?`
 *      voiced   `Run gcc hello.c`            <- the corpus's file, not the asker's
 *
 *  The same shape on the trained 15.7M-node store: `How do you say 'flurbish'
 *  in French?` answers "the way to say hello is \"Bonjour\"".
 *
 *  THIS IS NOT THE RESTATED-FRAGMENT GUARD.  That one asks whether the
 *  projection is a piece of the QUERY; this asks whether it is a piece of the
 *  ANCHOR that the query displaced.  Neither implies the other, and the
 *  observed failures pass the restatement guard cleanly.
 *
 *  Three conditions, all byte-exact and all necessary:
 *
 *  1. the query and the anchor must be ONE STRUCTURE — what they share has to
 *     dominate the query, or the query is not a variant of the anchor at all
 *     and the anchor's occupant of anything is beside the point;
 *  2. both sides of the position must reach one river window — below it byte
 *     overlap is chance, not evidence (the floor identityBar and the bridge's
 *     attestedQ both draw);
 *  3. the projection must voice the anchor's filler and NOT the query's
 *     referent.  Voicing both is a projection that carried the asker's own
 *     occupant through, which is exactly what a licensed reference does and
 *     must stay allowed;
 *  4. and the projection must share NO perceivable content with the query
 *     outside that position — no run of one river window.
 *
 *  GATE 4 IS WHAT SEPARATES A DIFFERENT THING FROM A DIFFERENT WORD, and
 *  without it this refuses correct answers.  A displaced slot alone cannot
 *  tell them apart: `symbol` <- `formula` and `main` <- `hello` are the same
 *  shape to the matcher — one substitution slot, frame dominating.  Measured
 *  on the trained store, gates 1-3 alone silenced
 *
 *      Q `What is the chemical symbol for water?`
 *      A `The chemical formula for water is H2O.`
 *
 *  which is right, and merely phrased in the corpus's own words.  The answer
 *  shares `the chemical ` and ` for water` with the question, so it is plainly
 *  about what was asked.  `Run gcc hello.c` against `How do I compile main.c?`
 *  shares nothing but `.c` — two bytes, below the window where overlap stops
 *  being chance — so it is not about what was asked at all.  No new constant:
 *  W is the same floor identityBar, attestedQ and the site test already draw. */
export function voicesDisplacedFiller(ctx, query, anchor, projection) {
    const W = ctx.space.maxGroup;
    const inst = frameSlots(ctx, query, anchor, 0);
    if (inst === null)
        return false;
    if (!dominates(inst.covered, query.length))
        return false;
    for (const slot of inst.slots) {
        if (slot.kind !== "substitution")
            continue;
        if (slot.qe - slot.qs < W || slot.filler.length < W)
            continue;
        if (indexOf(projection, slot.filler, 0) < 0)
            continue;
        const referent = query.subarray(slot.qs, slot.qe);
        if (indexOf(projection, referent, 0) >= 0)
            continue;
        // Gate 4: does the projection still speak about the query's FRAME?  A run
        // of one window anywhere outside the displaced position is enough — the
        // answer is then about the thing that was asked, in the corpus's own
        // wording.  Sharing nothing means it is about something else.
        const shared = alignRuns(ctx, query, projection).some((r) => r.qe - r.qs >= W && (r.qe <= slot.qs || r.qs >= slot.qe));
        if (shared)
            continue;
        return true;
    }
    return false;
}
/** Whether every member is byte-distinct from the others. */
export function distinct(items) {
    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            if (bytesEqual(items[i], items[j]))
                return false;
        }
    }
    return true;
}
/** Substitute every `needle -> repl` pair SIMULTANEOUSLY: one left-to-right
 *  pass, longest needle first at each position, and a replacement is never
 *  re-examined.
 *
 *  SIMULTANEOUS IS NOT A DETAIL.  Applying the pairs in sequence lets one
 *  substitution's OUTPUT be another's input: with slots `gcc -> zig` and
 *  `hello.c -> zig.c` a sequential pass rewrites bytes it had just written,
 *  and the result depends on the order the slots happened to be found in.
 *  Longest-first at each position makes the pass independent of pair order,
 *  which is what keeps {@link carriesFillers} and the binding it licenses the
 *  SAME operation — if they could disagree, the licence would not be testing
 *  what is voiced. */
export function substituteAll(hay, pairs) {
    const usable = pairs.filter((p) => p.needle.length > 0);
    if (usable.length === 0)
        return hay;
    // Longest needle first, so a needle that is a prefix of another can never
    // pre-empt it.  Ties cannot arise: an instance whose fillers are not
    // pairwise distinct is refused by frameSlots.
    const order = [...usable].sort((a, b) => b.needle.length - a.needle.length);
    const out = [];
    let i = 0;
    let hit = false;
    outer: while (i < hay.length) {
        for (const p of order) {
            if (i + p.needle.length > hay.length)
                continue;
            let k = 0;
            while (k < p.needle.length && hay[i + k] === p.needle[k])
                k++;
            if (k < p.needle.length)
                continue;
            for (const b of p.repl)
                out.push(b);
            i += p.needle.length;
            hit = true;
            continue outer;
        }
        out.push(hay[i]);
        i++;
    }
    return hit ? Uint8Array.from(out) : hay;
}
/** THE CARRIAGE LICENCE — the gate that decides whether a slot may be VOICED
 *  through.  Given two instances of one frame and what each one continues to,
 *  it asks one byte question:
 *
 *      substituteAll(contA, fillersA -> fillersB) == contB
 *
 *  When it holds, the corpus attests byte-exactly that the continuation is a
 *  function of the fillers and nothing else, so putting a NEW occupant through
 *  the same carriage is derivation rather than invention.  No threshold, no
 *  similarity, no new constant: the store's own instances decide, exactly as
 *  the bridge's `unanimous` decides whether a frame is a value slot.
 *
 *  Its FAILURE is what this is really for.  A frame whose continuation carries
 *  filler-DEPENDENT content — `What is the capital of X?` answering a different
 *  city per X — fails it, and that failure is the only thing between a slot
 *  and an invented fact.  Measured on the trained 15.7M-node store (325,615
 *  contexts): `What is the capital of Zamunda?` resonates to a PURE cohort,
 *  every one of the top 14 hits an instance of that frame, with an unambiguous
 *  slot; every structural gate passes and only this one refuses, on
 *  `replace("Tokyo", "Japan" -> "France") != "Paris"`.
 *
 *  With SEVERAL slots the test is unchanged, which is the point of testing the
 *  whole substitution at once: a frame whose answer tracks one slot but
 *  invents around another fails exactly as a single-slot value slot does. */
export function carriesFillers(contA, fillersA, contB, fillersB) {
    if (fillersA.length !== fillersB.length)
        return false;
    const projected = substituteAll(contA, fillersA.map((needle, s) => ({ needle, repl: fillersB[s] })));
    return bytesEqual(projected, contB);
}
/** The IN-LIST halo matcher: the best halo-mate for `halo` among EXPLICIT
 *  candidates, above the concept threshold — the list counterpart of
 *  {@link haloSiblings}, which asks the halo INDEX for candidates instead.
 *  Behind locate()'s halo step and articulation's voice matching; a third
 *  "best halo among these" decision must come here, not inline. */
export function bestHaloMate(ctx, halo, items, haloOf) {
    return argmaxCosine(halo, items, haloOf, conceptThreshold(ctx.store.D));
}
/** The HALO-SIBLING matcher: the nodes that keep the same distributional
 *  company as `id`, nearest first — `resonateHalo` filtered to exclude the
 *  node itself and everything below `bar` (default: the concept threshold).
 *  `halo`, when the caller has already read the node's halo row, is reused
 *  instead of refetched (one read per relation).  Returns [] for a node with
 *  no halo.  The one sibling enumeration behind the concept hop, the
 *  reasoning stage's synonym expansion, and the analogy matcher below. */
const haloSiblingMemo = new WeakMap();
export async function haloSiblings(ctx, id, halo, bar = conceptThreshold(ctx.store.D)) {
    // Per-response memo for the DEFAULT-ARGUMENT reading (the one the concept
    // hop, the bridge's synonym tier, and reasoning's synonym expansion all
    // use): the same node's siblings are asked for repeatedly within one
    // response (bridge pairs share sides), each a full halo-ANN query, and the
    // store is read-only while a response is in flight.  Keyed by the response
    // lifecycle object (ctx.climbMemo — fresh per respond, nulled after).
    // Calls with an explicit halo or bar (analogyStrength's gated reading)
    // bypass the memo — their filter differs.
    const memoable = halo === undefined &&
        bar === conceptThreshold(ctx.store.D) && ctx.climbMemo !== null;
    let memo;
    if (memoable) {
        memo = haloSiblingMemo.get(ctx.climbMemo);
        if (memo === undefined) {
            haloSiblingMemo.set(ctx.climbMemo, memo = new Map());
        }
        const hit = memo.get(id);
        if (hit !== undefined)
            return hit;
    }
    const h = halo ?? ctx.store.halo(id);
    const out = h
        ? (await ctx.store.resonateHalo(h, ctx.cfg.haloQueryK))
            .filter((sib) => sib.id !== id && sib.score >= bar)
        : [];
    if (memo !== undefined)
        memo.set(id, out);
    return out;
}
/** Bundle the distributional company of every addressable W-window in a
 *  byte span.  This is the query-time counterpart of the write-side halo
 *  pours: no lexical unit or storage row is invented; the span is represented
 *  by VSA superposition of the window concepts the store already knows.
 *
 *  Components are normalized before bundling so repetition mass remains
 *  evidence about each stored node, not an accidental weight on one window
 *  inside the composed phrase.  Returns null when the corpus provides no
 *  distributional evidence for the span. */
export function spanHalo(ctx, bytes, from = 0, to = bytes.length) {
    const W = ctx.space.maxGroup;
    if (to - from < W)
        return null;
    if (ctx.meter)
        ctx.meter.spanHalos++;
    const out = zeros(ctx.store.D);
    let found = false;
    const added = new Set();
    const episodeRoots = [];
    const N = corpusN(ctx);
    const reachMemo = sharedReachMemo(ctx);
    const addHalo = (id) => {
        if (added.has(id))
            return;
        const halo = ctx.store.halo(id);
        if (halo === null)
            return;
        const norm = Math.sqrt(dot(halo, halo));
        if (norm === 0)
            return;
        added.add(id);
        addInto(out, halo, 1 / norm);
        found = true;
    };
    const windowCount = to - from - W + 1;
    const offsets = [];
    const samples = Math.min(W, windowCount);
    for (let i = 0; i < samples; i++) {
        const relative = samples === 1
            ? 0
            : Math.floor((i * (windowCount - 1)) / (samples - 1));
        const off = from + relative;
        if (offsets[offsets.length - 1] !== off)
            offsets.push(off);
    }
    for (const off of offsets) {
        if (ctx.meter)
            ctx.meter.spanHaloWindows++;
        const ids = leafIdRun(ctx, bytes, off, off + W);
        if (ids === null)
            continue;
        const id = ctx.store.findBranch(ids);
        if (id === null)
            continue;
        addHalo(id);
        // Canonical flat windows are retrieval addresses and normally carry no
        // halo themselves. Their bounded structural ascent reaches the learned
        // episode forms that contain them; bundling those forms' company is the
        // distributional meaning of the window, derived entirely from existing
        // containment and halo state.
        if (!added.has(id)) {
            episodeRoots.push(edgeAncestors(ctx, id, N, reachMemo).roots);
        }
    }
    for (let rank = 0; added.size < ctx.cfg.haloQueryK; rank++) {
        let any = false;
        for (const roots of episodeRoots) {
            if (rank >= roots.length)
                continue;
            any = true;
            addHalo(roots[rank]);
            if (added.size >= ctx.cfg.haloQueryK)
                break;
        }
        if (!any)
            break;
    }
    return found ? normalize(out) : null;
}
/** Distributional synonym evidence between arbitrary byte spans. Whole words
 *  need not be independently interned: their stored W-window occurrences are
 *  lifted to episode halos, bundled, and compared. The caller chooses the
 *  derived gate appropriate to its claim (concept identity or analogy). */
export function spanSynonymStrength(ctx, a, b) {
    const ah = spanHalo(ctx, a);
    const bh = spanHalo(ctx, b);
    if (ah === null || bh === null)
        return 0;
    return cosine(ah, bh);
}
export async function analogyStrength(ctx, a, b) {
    const ha = ctx.store.halo(a);
    const hb = ctx.store.halo(b);
    if (ha && hb) {
        const bar = significanceBar(ctx.store.D);
        const direct = cosine(ha, hb);
        if (direct >= bar)
            return { score: direct, halo: true };
        const sibsA = await haloSiblings(ctx, a, ha, bar);
        const sibsB = await haloSiblings(ctx, b, hb, bar);
        let best = 0;
        for (const x of sibsA) {
            if (x.id === b)
                continue;
            const y = sibsB.find((s) => s.id === x.id);
            if (y !== undefined) {
                best = Math.max(best, Math.min(x.score, y.score));
            }
        }
        if (best > 0)
            return { score: best, halo: true };
    }
    return { score: sharedFrameStrength(ctx, a, b), halo: false };
}
/** The STRUCTURAL analogy tier: two nodes are analogs when their byte
 *  streams share a LEARNT frame — a content-addressed flat form of at least
 *  one full river window (W bytes, the perception quantum) that occurs in
 *  BOTH.  This is what "playing the same role" means structurally: "Ice is
 *  cold" and "Steel is hard" share the learnt " is " frame even though they
 *  keep disjoint distributional company.  Halos measure company by IDENTITY
 *  (company signatures — see sema.ts), so unrelated-company analogs must be
 *  validated by the frame itself, not by content leaking through halo
 *  vectors.  Strength is the shared learnt coverage of the SHORTER side —
 *  a fraction, comparable to the cosine tiers above.  Derived: the window
 *  is maxGroup, the same quantum differsByOneWindow and canonicalChunkId
 *  measure by; no tuned constants. */
export function sharedFrameStrength(ctx, a, b) {
    return sharedFrameStrengthOf(ctx, read(ctx, a), read(ctx, b));
}
/** The same measure over BYTES, for callers holding a role-establishing
 *  CONTEXT rather than the node whose role it establishes — CAST's comparison
 *  reads the tier this way when two candidate analogs are fillers (bare entity
 *  names) rather than frame-bearing structures themselves.  A role is a
 *  property of the context that establishes a filler, never of the filler's
 *  own bytes: measured on test/29's corpus, "Michelangelo" against "Homer"
 *  reads 0.000 while their establishing contexts ("The David was sculpted
 *  by…" against "The Iliad was written by…") read 0.452, and a context in a
 *  genuinely different frame ("Water boils at…") still reads 0.000 — the tier
 *  discriminates, it was simply being asked about the wrong bytes. */
export function sharedFrameStrengthOf(ctx, A, B) {
    const W = ctx.space.maxGroup;
    if (A.length < W || B.length < W)
        return 0;
    // Mark every byte of the shorter side covered by a learnt W-window that
    // also occurs in the longer side.
    const [s, l] = A.length <= B.length ? [A, B] : [B, A];
    const covered = new Uint8Array(s.length);
    for (let off = 0; off + W <= s.length; off++) {
        const win = s.subarray(off, off + W);
        // Learnt: the window resolves as a content-addressed flat form.
        const ids = leafIdRun(ctx, s, off, off + W);
        if (ids === null || ctx.store.findBranch(ids) === null)
            continue;
        if (indexOf(l, win, 0) < 0)
            continue;
        covered.fill(1, off, off + W);
    }
    let n = 0;
    for (let i = 0; i < s.length; i++)
        n += covered[i];
    return n >= W ? n / s.length : 0;
}
// ═══════════════════════════════════════════════════════════════════════════
// PROJECTIONS — what a matched node is projected ALONG (the direction)
// ═══════════════════════════════════════════════════════════════════════════
/** FORWARD through a synonym: the continuation an edge-less node borrows from
 *  a concept (halo) sibling — resonate the node's halo, take the first
 *  sibling above the concept threshold that itself has a direct edge. */
export async function conceptHop(ctx, id) {
    for (const sib of await haloSiblings(ctx, id)) {
        const hop = guidedFirst(ctx, sib.id);
        if (hop !== undefined)
            return hop;
    }
    return null;
}
/** FORWARD projection: follow continuation edges from a node to its fixpoint.
 *  The first hop may cross a concept (halo) link — a synonym.  The rest
 *  follow direct edges.  Convergence is intrinsic: the seen set guards
 *  against cycles.  `guide` disambiguates multi-continuation nodes by
 *  resonance. */
export async function follow(ctx, id, guide) {
    const seen = new Set([id]);
    // First hop: a direct edge, else a concept sibling's edge (the synonym).
    let next = chooseNext(ctx, id, guide);
    if (next === undefined) {
        const hop = await conceptHop(ctx, id);
        if (hop === null)
            return null;
        next = hop;
    }
    // Direct successors to the fixpoint.  Only the FIXPOINT's bytes are
    // returned, so the walk tracks node ids and reads bytes exactly once at
    // the end — a K-hop chain used to pay K full reconstructions and discard
    // K−1 of them.
    while (!seen.has(next)) {
        seen.add(next);
        const fwd = chooseNext(ctx, next, guide);
        if (fwd === undefined || seen.has(fwd))
            break;
        next = fwd;
    }
    return read(ctx, next);
}
/** REVERSE projection: the context a learnt continuation follows, voiced as
 *  bytes.  A common continuation ("Yes.") follows MANY contexts; with a
 *  `guide` the context whose gist resonates with the query wins (seat
 *  symmetry) — without one, the most-corroborated context wins (poured halo
 *  MASS, the direct measure of how many episodes established it), falling
 *  back to first-learnt on equal mass.  Among many predecessors RECIPROCAL
 *  ones (mutual edges) are preferred when any exist (RC5).  Callers that
 *  HAVE a query gist must pass it, or they silently change disambiguation
 *  regime.
 *
 *  `rev`, when the caller has already materialised prevOf (one read per
 *  relation — a hub's reverse fan-in is corpus-sized), is reused instead of
 *  refetched.  Returns null when there is no predecessor or the picked
 *  context reads empty (a zero-length context is no grounding: an empty
 *  Uint8Array is truthy, and returning it would flow a hollow "answer"
 *  onward). */
export function reverseContext(ctx, id, guide, rev) {
    // CAPPED default read: only the first √N predecessors are ever candidates
    // (hubCap below / in chooseAmong), so only they are read.  hubBound ≥ 2
    // keeps the single-predecessor shortcut exact.
    const candidates = rev ?? ctx.store.prevFirst(id, hubBound(ctx));
    if (candidates.length === 0)
        return null;
    // RECIPROCAL PREFERENCE: among many predecessors, one that `id` also
    // continues TO (cand → id AND id → cand both learnt) is a mutually
    // established pairing — the strongest structural evidence a predecessor
    // can carry (bidirectional training deposits both directions of a genuine
    // pair).  A bare predecessor is one episode's adjacency; guide-resonance
    // over bare predecessors favours whichever stored document merely
    // CONTAINS the query's bytes (the linear fold's cosine is byte overlap —
    // the observed "merci → unrelated French document" failure).  One capped
    // forward read decides; when no reciprocal exists, behaviour is unchanged
    // — bare predecessors ARE the honest answer for a shared deposited
    // continuation (two questions → one answer; audited by 31-audit C1), and
    // this arm serves every mechanism's reverse projection, so abstaining
    // here starves far more than the one containment failure it would fix.
    let pool = candidates;
    if (candidates.length > 1) {
        const fwd = new Set(ctx.store.nextFirst(id, hubBound(ctx)));
        if (fwd.size > 0) {
            const mutual = candidates.filter((c) => fwd.has(c));
            if (mutual.length > 0)
                pool = mutual;
        }
    }
    const pick = pool.length === 1
        ? pool[0]
        : guide
            ? chooseAmong(ctx, pool, guide).id
            : pickByMass(ctx, pool);
    const g = read(ctx, pick);
    return g.length > 0 ? g : null;
}
/** The most-corroborated candidate by poured halo mass (first-seen wins a
 *  tie).  Capped at √N candidates by insertion order — the same hub bound
 *  every fan-out walk uses. */
function pickByMass(ctx, ids) {
    const capped = hubCap(ctx, ids);
    let best = capped[0];
    let bestMass = ctx.store.haloMass(best);
    for (let i = 1; i < capped.length; i++) {
        const mass = ctx.store.haloMass(capped[i]);
        if (mass > bestMass) {
            best = capped[i];
            bestMass = mass;
        }
    }
    return best;
}
/** THE projection: ground a matched node to answer bytes — FORWARD to its
 *  continuation fixpoint (which may cross a concept hop), else REVERSE to
 *  the context it follows.  This is the direction ladder every mechanism's
 *  final grounding step reduces to. */
export async function project(ctx, id, guide) {
    const fc = await follow(ctx, id, guide);
    if (fc)
        return fc;
    return reverseContext(ctx, id, guide);
}
// ── The span-shape family ───────────────────────────────────────────────────
//
// "Is this answer drawn from this context?" has TWO formally distinct
// readings, and the pair plus the anchor classifier built on them are SHARED
// machinery — extraction proposes span-shaped exemplars with them, the
// shared `Precomputed.spanShapedOf` container computes them, and fusion
// (reasoning.ts) gates on the strict one.  They lived inside
// mechanisms/extraction.ts, so `pipeline-mechanism.ts` and `reasoning.ts`
// both had to import back OUT of a specific mechanism — an inversion the
// mechanism market forbids (AGENTS §2.6: the shared contract may not depend
// on any one mechanism; §2.5: a shared matcher belongs to this family, never
// to a mechanism's private helpers).  Deleting extraction must not break the
// shared container, so they live here.
//
//   • isSpanShaped  — the OPEN reading (sparse in-order embedding).
//   • containsSpan  — the STRICT reading (contiguous run or resolved node).
//   • skillExemplar — classify one anchor into (context, answer) using them.
//
// The two readings are NOT interchangeable; AGENTS §2.5 pins the distinction
// and each function's own doc states what breaks if it is substituted.
/** Check whether an anchor is a span-shaped skill exemplar: it represents a
 *  fact whose context and answer together form a span-in-context pattern.
 *  If the anchor has a nextOf continuation, that is the answer and the anchor
 *  itself is the context.  Otherwise the anchor's prevOf parents provide
 *  candidate contexts, and the longest one whose span is span-shaped wins. */
export async function skillExemplar(ctx, anchor, guide) {
    if (ctx.store.hasNext(anchor)) {
        const contextBytes = read(ctx, anchor);
        const answerBytes = await follow(ctx, anchor, guide);
        if (answerBytes !== null && isSpanShaped(ctx, contextBytes, answerBytes)) {
            return { contextBytes, answerBytes };
        }
        return null;
    }
    const answerBytes = read(ctx, anchor);
    // Candidate contexts, capped at the hub bound (a common answer's reverse
    // fan-in is corpus-sized).
    const capped = ctx.store.prevFirst(anchor, hubBound(ctx));
    const spanShaped = [];
    for (const p of capped) {
        const ctxB = read(ctx, p);
        if (ctxB.length > 0 && isSpanShaped(ctx, ctxB, answerBytes)) {
            spanShaped.push({ id: p, bytes: ctxB });
        }
    }
    if (spanShaped.length === 0)
        return null;
    // Among span-shaped contexts, the longest wins (the smallest spanning frame
    // heuristic's dual: more frame to locate in the query); the query gist,
    // when given, breaks LENGTH TIES via chooseAmong — the same reverse-regime
    // disambiguator every context pick uses, whose gist cache spares the
    // re-fold this block once paid per tied candidate.  Same strict first-seen
    // tie-break as the hand loop it replaces.
    const maxLen = Math.max(...spanShaped.map((s) => s.bytes.length));
    const longest = spanShaped.filter((s) => s.bytes.length === maxLen);
    let contextBytes = longest[0].bytes;
    if (guide && longest.length > 1) {
        const pick = chooseAmong(ctx, longest.map((s) => s.id), guide).id;
        contextBytes = longest.find((s) => s.id === pick).bytes;
    }
    return { contextBytes, answerBytes };
}
/** Whether the answer is a SPARSE subsequence of the context (bytes in
 *  order, arbitrary gaps) — the OPEN span-shape reading (see the section
 *  note above).  This is what lets extraction validate a MULTI-PIECE
 *  exemplar whose answer is stitched from several context runs — but it is
 *  deliberately permissive, so it must never be used as evidence that one
 *  span was "drawn from" another (see {@link containsSpan} for that).
 *
 *  There is deliberately NO containsSpan pre-check here: strict containment
 *  IMPLIES the subsequence embedding (a contiguous run, or a resolved node —
 *  whose content-addressed identity means its bytes occur contiguously — is
 *  an in-order embedding with zero gaps), so the scan below decides alone,
 *  with the same truth value.  The old pre-check re-perceived the context
 *  (a full river fold) per CANDIDATE in skillExemplar's √N-capped loop —
 *  pure cost, no discrimination. */
export function isSpanShaped(_ctx, context, answer) {
    let ai = 0;
    for (let ci = 0; ci < context.length && ai < answer.length; ci++) {
        if (context[ci] === answer[ai])
            ai++;
    }
    return ai === answer.length;
}
/** STRICT containment: the answer's resolved node appears in the context's
 *  folded tree, or the answer occurs as one CONTIGUOUS byte run of the
 *  context.  This is real evidence the answer was drawn from the context.
 *  Fusion gates on this — the sparse-subsequence reading of
 *  {@link isSpanShaped} is trivially satisfied by short answers over long
 *  queries ("cold" is a gap-tolerant subsequence of most sentences holding
 *  c…o…l…d in order), and gating fusion on it silently starved multi-topic
 *  queries of their further points of attention. */
export function containsSpan(ctx, context, answer) {
    const ansId = resolve(ctx, answer);
    if (ansId !== null) {
        let found = false;
        foldTree(ctx, perceive(ctx, context), 0, (_n, _s, _e, node) => {
            if (node === ansId)
                found = true;
        });
        if (found)
            return true;
    }
    return indexOf(context, answer, 0) >= 0;
}
