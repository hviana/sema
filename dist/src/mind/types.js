// types.ts — all interfaces, types, and free functions for the mind.
//
// GraphSearchHost is defined first (minimal imports) so GraphSearch can import
// it without pulling in the full MindContext.
import { bytesEqual, concatBytes, indexOf } from "../bytes.js";
import { dominates } from "../geometry.js";
// ═══════════════════════════════════════════════════════════════════════════
// FREE FUNCTIONS (pure, no state)
// ═══════════════════════════════════════════════════════════════════════════
/** Read a whole node's bytes. */
export const ALL = 0x7fffffff;
/** Splice every chosen span in order — the whole cover as one byte string. */
export function spliceAll(segs) {
    if (!segs.some((s) => s.rec))
        return null;
    return concatBytes(segs.map((s) => s.bytes));
}
/** Whether a chosen span RESTATES the query rather than answering it: its
 *  SUBSTITUTED bytes (an edge followed from a recognised site, not the
 *  site's own literal text read back) already occur elsewhere in the query
 *  — the same principle recall.ts's tiers apply to a whole-query projection
 *  ("a projection that is a proper byte-subspan of the query restates part
 *  of the question").  A LITERAL span (the site's own bytes, unchanged) is
 *  exempt: naming what's already there at its OWN position is not a
 *  substitution.  A recognised site that is itself an entire PRIOR TURN of
 *  a multi-turn query is exactly this shape: it carries a genuine learnt
 *  continuation, but that continuation is something the asker already said
 *  moments later in the SAME query, not a new answer.  Below one river
 *  window, byte overlap is chance, not evidence — the same floor
 *  identityBar and reachThreshold hold every other structural-overlap claim
 *  to. */
export function segRestatesQuery(s, query, queryLen, W) {
    if (!s.rec)
        return false;
    const literal = s.j - s.i === s.bytes.length &&
        bytesEqual(s.bytes, query.subarray(s.i, s.j));
    if (literal)
        return false;
    return s.bytes.length >= W && s.bytes.length < queryLen &&
        indexOf(query, s.bytes, 0) >= 0;
}
/** Lift the answer out of the cover for think: the recognised region, free of
 *  the asker's surrounding (unrecognised) framing — and free of any chosen
 *  span that only RESTATES content the query already contains (see {@link
 *  segRestatesQuery}).  A restating span is excluded from both the framing
 *  (lo/hi) decision and the final concatenation: it is stale, not a second
 *  answer, but the OTHER spans a derivation chose are independent evidence
 *  and must not be discarded along with it. */
/** The spans {@link liftAnswer} actually concatenates, in order — the answer
 *  before it is joined.  Exposed so a caller can ask what the lifted answer is
 *  MADE OF without re-deriving the selection: in particular how much of it is
 *  SCAFFOLDING (a `rec: false` span — query bytes carried through verbatim
 *  because nothing explained them, the same spans the liftAnswer trace labels
 *  "scaffolding" rather than "chosen").
 *
 *  That quantity is load-bearing for the grounding decision.  Two candidates
 *  can leave the SAME number of query bytes unaccounted and therefore grade
 *  identically, while one of them pads its answer with those bytes and the
 *  other does not — measured on test/22's two-fact chain, cover and recall
 *  both graded 11001 with 11 bytes unexplained, and cover won the tie only on
 *  consideration order, answering "The capital of France is Paris famous for"
 *  where recall had crossed the hop.  Carrying an unexplained span into the
 *  answer is strictly weaker than not explaining it: it manufactures fluency
 *  out of the asker's own words.  See the tie-break in pipeline.ts. */
export function liftAnswerParts(segs, queryLen, query, W) {
    const restated = segs.map((s) => segRestatesQuery(s, query, queryLen, W));
    const recognised = [];
    for (let k = 0; k < segs.length; k++) {
        if (segs[k].rec && !restated[k])
            recognised.push(k);
    }
    if (recognised.length === 0)
        return [];
    if (recognised.length === 1) {
        const s = segs[recognised[0]];
        if (s.computed && s.i > 0)
            return [s];
        if (dominates(s.j - s.i, queryLen)) {
            return segs.filter((_, k) => !restated[k]);
        }
        return [s];
    }
    const lo = recognised[0];
    const hi = recognised[recognised.length - 1];
    return segs.slice(lo, hi + 1).filter((_, k) => !restated[lo + k]);
}
/** The SCAFFOLDING byte count of a lifted answer: how many of its bytes come
 *  from spans nothing recognised (see {@link liftAnswerParts}).
 *
 *  ONLY RUNS OF AT LEAST ONE RIVER WINDOW COUNT.  Not all carried-through
 *  bytes are a failure to explain: a period, a question mark, the space
 *  between two fused topics are GLUE — they belong to the answer's surface,
 *  and dropping them to look better-derived would be a worse answer, not a
 *  more honest one.  A substantive phrase the derivation never explained
 *  ("famous for") is a different claim entirely.
 *
 *  W is the line between them, and it is the same line the rest of the mind
 *  already draws: below one river window byte overlap is chance, not evidence
 *  (see identityBar, the bridge's attestedQ, and recognition's site floor).
 *  Counting every scaffolding byte instead — which is what this did first —
 *  made punctuation preservation lose a tie it should win, and test/00's
 *  "period preserved" / "question mark preserved" caught it immediately. */
export function liftedScaffolding(segs, queryLen, query, W) {
    // MEASURED PER CONTIGUOUS RUN, not per span.  A PASS span is one BYTE — the
    // cover charges unrecognised bytes individually — so asking whether a single
    // span reaches W would find no run ever, whatever the query.  " famous for"
    // arrives as eleven one-byte spans in a row and is one eleven-byte run.
    let n = 0;
    let run = 0;
    const close = () => {
        if (run >= W)
            n += run;
        run = 0;
    };
    for (const s of liftAnswerParts(segs, queryLen, query, W)) {
        if (s.rec)
            close();
        else
            run += s.bytes.length;
    }
    close();
    return n;
}
export function liftAnswer(segs, queryLen, query, W) {
    // ONE selection rule, in {@link liftAnswerParts} — this is its join.  The
    // two used to be separate copies of the same lo/hi/restated reasoning, which
    // is exactly how an answer and the accounting OF that answer drift apart.
    const parts = liftAnswerParts(segs, queryLen, query, W);
    if (parts.length === 0)
        return null;
    return concatBytes(parts.map((x) => x.bytes));
}
/** The CHANGED NODES of a freshly-perceived `tree` against the node ids a previous
 *  tracked deposit interned (`prevSeen`). */
export function changedNodes(tree, ids, prevSeen) {
    const newCount = new Map();
    const count = (n) => {
        const memo = newCount.get(n);
        if (memo !== undefined)
            return memo;
        const id = ids.get(n);
        // PRUNE: a node whose id the previous deposit already interned is old,
        // and content addressing makes that transitive — the same id names the
        // same content, so every descendant was interned then too.  The whole
        // subtree counts 0 without walking it; with the pyramid fold sharing a
        // conversation's prefix subtree, this is what keeps the changed-nodes
        // read O(new nodes) instead of O(context).  (A node internTreeIds
        // memo-skipped has an id here exactly when it is such a shared root.)
        if (id !== undefined && prevSeen.has(id)) {
            newCount.set(n, 0);
            return 0;
        }
        let c = 1; // reachable only when NOT pruned above ⇒ this node is new
        if (n.kids) {
            for (const k of n.kids)
                c += count(k);
        }
        newCount.set(n, c);
        return c;
    };
    const total = count(tree);
    if (total === 0)
        return [tree];
    let n = tree;
    for (;;) {
        if (n.kids === null)
            return [n];
        let holder = null;
        for (const k of n.kids) {
            if (newCount.get(k) === total) {
                holder = k;
                break;
            }
        }
        if (holder === null)
            return [n];
        n = holder;
    }
}
