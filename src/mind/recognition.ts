// recognition.ts — Section 2 of the mind:
// Address + Read over byte streams — decompose a query into its known forms.
//
//   recognise — structural + canonical decomposition into every stored form
//               that leads somewhere (has a continuation edge or a halo).
//   segment   — leaf-parent segmentation using the geometry's own groupings.
import { rItem } from "./trace.js";

import type { MindContext, Recognition, Segment } from "./types.js";
import {
  canonResolve,
  foldTree,
  gistOf,
  latin1Key,
  perceive,
  resolve,
} from "./primitives.js";
import { atomIsHub, bearsEdge, corpusN, leadsSomewhere } from "./traverse.js";
import { chainReach, leafIdAt, leafIdRun } from "./canonical.js";
import { canonHash } from "../canon.js";
import { isChunk, type Sema } from "../sema.js";
import type { Leaf, Site } from "./graph-search.js";

/** Decompose a byte stream into every stored form that leads somewhere
 *  (has a continuation edge or a halo).  Two complementary readings:
 *
 *   • structural — walk the query's own perceived tree, naming each subtree
 *     by findLeaf at the leaves and findBranch above.  Catches every form
 *     aligned to the query's segmentation.
 *
 *   • canonical — re-derive the store's segmentation directly: at each byte,
 *     the longest known leaf, chained into flat branches.  Names forms the
 *     query's own cut cannot, and records sub-leaf boundaries as `splits`.
 *
 *  Both O(n · maxGroup) bounded O(1) probes — never a scan of the corpus. */
/** Decompose `bytes` into the learnt forms it contains.  `trimmed` skips the
 *  edge-trim fallbacks (which recover misaligned FRAGMENTS) — for callers whose
 *  own gate rejects fragments anyway (the pivot), so the O(n·W²) trim search is
 *  paid only where its output can be used.  Byte-identical for every caller
 *  that keeps only top-level forms. */
export function recognise(
  ctx: MindContext,
  bytes: Uint8Array,
  trimmed = false,
): Recognition {
  // Content-keyed memo — works for both single-turn respond() and multi-turn
  // respondTurn() (where the map persists across calls).  ALWAYS consulted,
  // regardless of tracing — matching perceive()'s own memo, which carries no
  // trace gate at all.
  //
  // This memo is an accelerator, and that is now the whole of it: repeated
  // recognition of the same query is ordinary within one response (cover,
  // reason and articulate all recognise it) and recogniseImpl is O(n ·
  // maxGroup) probes each time.
  //
  // IT USED TO BE LOAD-BEARING FOR CORRECTNESS, and the history is worth
  // keeping because it explains why there is no trace gate here.  foldTree's
  // subtree-resolution fast path (primitives.ts) once returned on a cache hit
  // WITHOUT recursing, so it skipped invoking `visit` — and therefore skipped
  // EMITTING SITES — for any subtree already in ctx._resolvedSubtrees.  A
  // conversation's incremental fold deliberately shares node OBJECTS across
  // turns, so by the second call on the same bytes large swaths of the tree
  // were already cached and recogniseImpl silently found FEWER sites than the
  // first call (observed live: 31 → 5).  Skipping this memo "only while
  // tracing" therefore meant every traced turn re-ran recogniseImpl at each of
  // those call sites, each result more incomplete than the last — changing
  // which mechanism grounded the answer, not merely costing time.
  //
  // foldTree no longer does that: it takes the fast path only when no `visit`
  // is supplied, so a walk that emits sites always walks in full and the id
  // cache is reduced to eliding store probes (see primitives.ts).  recognise()
  // is idempotent on its own now — verified with the memo bypassed, the
  // subtree cache warm and the tree object shared: three consecutive calls on
  // the same 544-byte context returned sites=2 leaves=544 splits=0 starts=88,
  // identical every time.
  //
  // The unconditional consult STAYS regardless.  A memo whose absence can only
  // cost time is still not something to gate on whether an audit happens to be
  // attached: tracing must not change what the pipeline computes, and the
  // cheapest way to guarantee that is for the trace flag to touch nothing but
  // the trace.  The trace step must still fire on every call (a cache hit is
  // not silent), so it is emitted here directly rather than only inside
  // recogniseImpl.
  if (ctx.recogniseMemo) {
    const key = (trimmed ? "t" : "f") + latin1Key(bytes);
    const hit = ctx.recogniseMemo.get(key);
    if (hit !== undefined) {
      if (ctx.meter) ctx.meter.recogniseHits++;
      ctx.trace?.step(
        "recognise",
        [rItem(bytes, "query")],
        hit.sites.map((s) =>
          rItem(bytes.subarray(s.start, s.end), "form", s.payload, [
            s.start,
            s.end,
          ])
        ),
        `decompose the query into ${hit.sites.length} learnt form(s) that ` +
          `lead somewhere (over ${hit.leaves.length} perceived leaves) [cached]`,
      );
      return hit;
    }
    const fresh = recogniseImpl(ctx, bytes, trimmed);
    ctx.recogniseMemo.set(key, fresh);
    return fresh;
  }
  return recogniseImpl(ctx, bytes, trimmed);
}

function recogniseImpl(
  ctx: MindContext,
  bytes: Uint8Array,
  trimmed = false,
): Recognition {
  if (ctx.meter) {
    ctx.meter.recognitions++;
    ctx.meter.recognisedBytes += bytes.length;
  }
  const store = ctx.store;
  const sites: Site[] = [];
  const leaves: Leaf[] = [];
  const splits = new Set<number>();
  const starts = new Set<number>();
  // The same cuts in ASCENDING order.  The post-order walk below visits
  // leaf-parents left to right, so appending as they are added keeps this
  // sorted with no comparison — which is what lets the composite search find
  // its candidates by binary search instead of rescanning the whole set.
  const startList: number[] = [];
  if (bytes.length === 0) return { sites, leaves, splits, starts };

  // Span-resolve memo for THIS call: the structural pass (sub-runs inside
  // leaf-parents) and the canonical pass (leaf-id chains) probe overlapping
  // spans, and each resolve() is a full fold of the sub-span (fresh subarray
  // objects — the per-response perceive memo cannot see them).  Keyed
  // numerically by (start, end); resolve is pure and the store is read-only
  // here, so a hit is exact.
  const spanIds = new Map<number, number | null>();
  const resolveSpan = (start: number, end: number): number | null => {
    const key = start * (bytes.length + 1) + end;
    let id = spanIds.get(key);
    if (id === undefined) {
      id = resolve(ctx, bytes.subarray(start, end));
      spanIds.set(key, id);
    }
    return id;
  };

  // Byte atoms (implicit negative-id single-byte leaves) are admitted as
  // recognised sites only while atoms can still DISCRIMINATE at this corpus
  // scale (see {@link atomIsHub}).  On a small store a single-letter fact
  // ("a" → "A") is genuine learnt content and its site is essential; on a
  // large one every letter of every query would otherwise become a
  // "recognised form" — the bridge then finds junction connectors between
  // bare letters, cover follows edges hanging off them, and pure noise
  // ("qq8f3kz9…") grounds to an arbitrary learnt sentence instead of
  // silence.  Atoms stay available as leaves (PASS-carried literals) and
  // through exact tier-0 resolution regardless.
  const atomsAreHubs = atomIsHub(ctx, corpusN(ctx));
  // Distinct probes (structural exact match, canon fallback, edge trims at
  // several offsets) can legitimately re-derive the SAME (start, end, id)
  // site from different tree nodes — a wide edge-trim search is exactly
  // this on purpose (see below).  Duplicate site entries are not wrong
  // evidence, but they double the weight cover's derivation search gives
  // that span, distorting its cost model — the same span must count once.
  const seen = new Set<string>();
  const emit = (start: number, end: number, id: number) => {
    if (id < 0 && atomsAreHubs) return;
    // A SITE MUST SPAN ONE RIVER WINDOW.  Below W, byte overlap is chance,
    // not evidence — the principle identityBar already states ("below one
    // river window, byte overlap is chance") and the bridge's attestedQ
    // already applies ("spans shorter than W carry no window of their own").
    // No new constant.
    //
    // This REPLACES the false premise it used to share with fuse() and
    // tryChain: those gates asked "does this offset sit on a fold boundary?"
    // and read the answer from `starts`, which is exactly {0, W, 2W, …}
    // because riverFold groups fixed-arity — arithmetic, not evidence.
    //
    // Measured on the 17.9M-node store, over the sites of 7 probes (1 good,
    // 11 junk by hand-labelling, corrected for whole-query forms):
    //     len >= W        rejects "hi"(2) "of"(2) "is"(2) "di"(2) "the"(3),
    //                     admits  "Eiffel Tower"(12) and both whole-query forms
    //     len >= W-1      admits "the" — W-1 is the write side's straddle
    //                     neighbour for RETRIEVAL, never a claim about units
    //     §2.7 saturation admits 11/11 junk: edgeAncestors on a site node
    //                     reaches 1..48 contexts, so dominates(ctx, N) needs
    //                     ctx > 162805 and never fires; every site reads DISC
    //     rarity          does not separate: "hi" has 1 container, "the" 572
    //
    // A span covering the WHOLE query is exempt: then it is not a fragment of
    // something longer, it is the question ("hi" asked on its own).
    if (
      atomsAreHubs && end - start < ctx.space.maxGroup &&
      !(start === 0 && end === bytes.length)
    ) return;
    const key = start + "," + end + "," + id;
    if (seen.has(key)) return;
    seen.add(key);
    if (leadsSomewhere(ctx, id)) {
      sites.push({ start, end, payload: id });
    }
  };

  // ── structural: the query's own perceived tree ──────────────────────
  starts.add(0);
  startList.push(0);
  foldTree(ctx, perceive(ctx, bytes), 0, (n, start, end, node) => {
    if (n.kids === null) {
      leaves.push({ start, end, bytes: n.leaf ?? new Uint8Array(0), node });
    }
    if (node !== null) emit(start, end, node);
    // Canonical fallback: a subtree whose exact content-addressed lookup
    // missed may still be a stored form under the response's equivalence
    // (case, width, whitespace — whatever the injected canonicalizer says).
    // O(subtree bytes) per miss, memoised per response; a no-op when no
    // canonicalizer was injected or the store has no canon index.  A raw
    // leaf (n.kids === null) is single-byte and handled by the byte-atom
    // path above instead — canon equivalence only applies to composites.
    else if (n.kids !== null) {
      const cid = canonResolve(ctx, bytes.subarray(start, end));
      if (cid !== null) emit(start, end, cid);
      // The edge-trim fallbacks below remove 1 byte from a side; the
      // remainder must still be a composite (>= 2 bytes, the same floor
      // n.kids !== null enforces above) rather than degenerate into
      // single-byte-atom territory, which atomIsHub already governs
      // separately.
      else if (!trimmed && end - start - 1 >= 2) {
        // The chunk's own boundary is drawn by content geometry, not by
        // any notion of "form" — it can include one edge byte the query's
        // fold happened to attach here that the trained span never had
        // (e.g. a separator from the preceding chunk).  The core has no
        // idea what that byte means; it only knows resolve()/canonResolve
        // are self-verifying (hash-then-verify, same discipline as every
        // content lookup here), so a blind one-byte-shorter guess on
        // either edge costs nothing when wrong and is trustworthy when it
        // hits.  Two extra probes, only on the already-failed miss path.
        const left = resolve(ctx, bytes.subarray(start + 1, end));
        if (left !== null) emit(start + 1, end, left);
        const right = resolve(ctx, bytes.subarray(start, end - 1));
        if (right !== null) emit(start, end - 1, right);
        // A misalignment wider than one byte (e.g. more than one edge
        // separator swallowed) is not itself geometry-quantized — the
        // WRITE side's canonical index (canonicalWindows) interns sliding
        // W−1/W-length windows over leaf ids at EVERY offset, not just
        // radix-aligned ones (see canonical.ts) — so the offset that
        // recovers a trained span can be anything, not a multiple of W.
        // What IS bounded is how far it's worth looking: chainReach(W)=W²,
        // the same reach the canonical pass (tryChain) trusts for a chain
        // rebuilt off the query's own fold.  Every candidate offset is
        // gated by store.findBranch(leafIds) first — the SAME cheap,
        // fold-free existence check tryChain already uses — so the extra
        // resolve() fold (the real cost) is only paid when a branch could
        // plausibly exist there, not for every offset.  The node itself is
        // also bounded to chunk-scale (end - start <= W²): widening this at
        // whole-query/root scale can rediscover a smaller subtree's own
        // content as a second, overlapping site the structural walk's own
        // finer recursion already emits correctly on its own — a duplicate
        // that downstream derivation can stitch into a wrong answer.
        const W = ctx.space.maxGroup;
        for (
          let k = 1;
          end - start <= W * W && k <= W * W && start + k < end - 1;
          k++
        ) {
          const lIds = leafIdRun(ctx, bytes, start + k, end);
          if (lIds !== null && store.findBranch(lIds) !== null) {
            const eLeft = resolve(ctx, bytes.subarray(start + k, end));
            if (eLeft !== null) emit(start + k, end, eLeft);
          }
          const rIds = leafIdRun(ctx, bytes, start, end - k);
          if (rIds !== null && store.findBranch(rIds) !== null) {
            const eRight = resolve(ctx, bytes.subarray(start, end - k));
            if (eRight !== null) emit(start, end - k, eRight);
          }
        }
        // A trained form embedded at this span's left edge, past the
        // chunk-scale bound above.  The loop above probes exactly this — trim
        // k leading bytes, verify the remainder is a stored branch — but only
        // for spans of at most W².  A turn prefixed with a connective is
        // turn-scale, so it never qualified.
        //
        // Widening that loop's SIZE bound is what reopens test/46's
        // root-scale false positive.  Widening only its LEFT trim, to a
        // bounded W offsets, does not: every candidate is still verified by
        // exact content addressing (the leaf-id run must BE a stored branch),
        // and the result always ends where this span ends, so it can never
        // introduce the smaller-subtree duplicate that regression was about.
        //
        // This replaces an assumption that no longer holds — that such a
        // form's left edge must be a cut the fold itself drew.  It held while
        // cuts had long memory and a turn boundary reliably produced one; a
        // bounded-window rule re-synchronises a byte or two INTO the turn
        // instead, so the edge itself is often not a cut ("And " ends at 65,
        // and the fold's nearest cuts are 61 and 67).
        // No leaf-id prefilter here, unlike the loop above: a leaf id is the
        // LONGEST known leaf at a position, so the run itself is context
        // sensitive — measured, the embedded copy of a trained form yields a
        // different run from the standalone one and findBranch misses even
        // though the bytes resolve exactly (span [65,94): findBranch null,
        // resolve 91).  With only W candidates the exact fold is affordable,
        // and it is the stronger evidence anyway: if it resolves, these exact
        // bytes ARE a stored node.
        for (let k = 1; k <= W && start + k < end - 1; k++) {
          const eLeft = resolve(ctx, bytes.subarray(start + k, end));
          if (eLeft !== null) emit(start + k, end, eLeft);
        }
        // THE SAME SEARCH ON THE OTHER EDGE.  Everything above trims from the
        // LEFT and keeps this span's END fixed, so a stored form was findable
        // only when it ENDED where a fold node ends.  Measured on a 12-context
        // store, probing for a trained 47-byte sentence wrapped in filler:
        // 1-4 bytes of LEFT padding kept it recognisable, while ONE byte of
        // right padding lost it.  That asymmetry was never argued for — the
        // reasoning above is about a form's left edge landing on a cut, and it
        // says nothing about which side the noise is on.
        //
        // The stated hazard for widening this search is test/46's root-scale
        // false positive, and it is a hazard of the SIZE bound, not of the
        // direction: like its mirror this loop is bounded to W offsets and
        // every candidate is verified by exact content addressing, so it can
        // only ever emit spans that ARE stored nodes.  Measured: neutral on
        // the suite, and the right-padded cases above become recognisable.
        for (let k = 1; k <= W && start < end - k - 1; k++) {
          const eRight = resolve(ctx, bytes.subarray(start, end - k));
          if (eRight !== null) emit(start, end - k, eRight);
        }
        // A REAL extra word at the left edge (a discourse connective like
        // "And " prepended to a follow-up turn — not boundary noise, actual
        // content the injected canonicalizer has no equivalence for) shows
        // up as a canon-miss too big for the chunk-scale search above: the
        // turn is its OWN segment, so it can be turn/segment-scale, not
        // chunk-scale.  Widening the size bound itself reopens the root-scale
        // false-positive this module already fixed once (test/46); widening the
        // SEARCH instead does not, because every candidate is a cut the query's
        // OWN fold drew (`starts`, the same set the canonical pass privileges
        // with full chain reach) — fold EVIDENCE, never a blind guess.
        //
        // The candidates are the fold's own segment starts inside this span, in
        // order.  They used to be probed at `start + k*W`, which assumed cuts
        // land on multiples of W; content-defined cuts do not, so that stride
        // tested offsets no segment ever began at and this search silently
        // never fired (test/44 pins it).  Still bounded to W candidates, each
        // one O(1) from the sorted cut list before paying for a real
        // canonResolve fold — canonResolve, not resolve()/findBranch, because
        // the gap here is often exactly the kind of equivalence (case, in the
        // live trace) canon exists for, not an exact-content coincidence.
        // A deposit's ROOT is a whole-stream node, and a stream's ends are not
        // content cuts — so an embedded occurrence of a trained form reproduces
        // its SEGMENTS (which are offset-free) but never its root.  What is
        // being looked for is therefore a suffix of this span that happens to be
        // a whole trained form, and its left edge can only be a cut the fold
        // itself drew.  Candidates are taken from the RIGHT, nearest the end
        // first: the form ends where this node ends, so its start is near it.
        // Left-to-right was wrong — in test/44 the target's start is the 6th cut
        // from the end but the 12th from the beginning.
        //
        // `starts` is still filling (this runs inside the post-order walk), but
        // post-order guarantees every chunk BELOW this span is already in it —
        // exactly the set wanted.  Bounded to chainReach(W) candidates, the same
        // reach the canonical pass trusts, so cost stays O(reach · span).
        let hi = startList.length; // first index past the last usable cut
        let lo = 0;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (startList[mid] < end - 1) lo = mid + 1;
          else hi = mid;
        }
        const reach = chainReach(W);
        for (let k = 0; k < reach; k++) {
          const p = startList[lo - 1 - k];
          if (p === undefined || p <= start) break;
          const cid = canonResolve(ctx, bytes.subarray(p, end));
          if (cid !== null) emit(p, end, cid);
        }
      }
    }
    if (isChunk(n)) {
      starts.add(start);
      if (startList[startList.length - 1] !== start) startList.push(start);
      // Try every sub-span within this leaf-parent.
      const leafOffsets: number[] = [];
      let off = start;
      for (const k of n.kids) {
        leafOffsets.push(off);
        off += k.leaf?.length ?? 0;
      }
      // Sub-spans starting at i > 0 begin INSIDE the chunk, at an offset the
      // query's own fold did not itself choose as a boundary — the same
      // opportunistic byte-atom-chain risk `tryChain`'s `boundary` gate
      // guards below (see its comment).  Only the chunk's own left edge
      // (i === 0, already registered in `starts` above) carries the fold's
      // evidence; interior sub-starts are exempt from the guard only while
      // atoms themselves still discriminate at this corpus scale.
      for (let i = 0; i < n.kids.length; i++) {
        if (i > 0 && atomsAreHubs) break;
        const subIds: number[] = [];
        for (let j = i; j < n.kids.length; j++) {
          const kj = n.kids[j];
          if (kj.kids !== null || !kj.leaf) break;
          const lid = store.findLeaf(kj.leaf);
          if (lid === null) break;
          subIds.push(lid);
          const branch = store.findBranch(subIds);
          if (branch === null) continue;
          const subEnd = leafOffsets[j] + (kj.leaf?.length ?? 0);
          const resolved = resolveSpan(leafOffsets[i], subEnd);
          if (resolved !== null) emit(leafOffsets[i], subEnd, resolved);
        }
      }
    }
  });

  // ── canonical: longest-known-leaf re-segmentation ──────────────────
  const W = ctx.space.maxGroup;
  const singleLeaf: Array<{ id: number; end: number } | null> = new Array(
    bytes.length,
  ).fill(null);
  for (let p = 0; p < bytes.length; p++) {
    const id = leafIdAt(ctx, bytes, p);
    if (id !== null) singleLeaf[p] = { id, end: p + 1 };
  }

  const leafFrom = (p: number): { id: number; end: number } | null => {
    if (p >= bytes.length) return null;
    return singleLeaf[p];
  };

  // ── exact query-edge forms beyond the canonical chain reach ─────────
  //
  // At corpus scale off-boundary atom chains are deliberately suppressed,
  // but a whole trained form can be longer than chainReach(W) and sit at a
  // query edge without being a subtree of the query's larger root. Appending
  // another topic demonstrates the failure: the exact 30-byte trained
  // question `What is the capital of France?` ends inside the larger query's
  // [27,33) content segment, so neither the structural walk nor a W² chain
  // can name it.
  //
  // Probe only prefix/suffix endpoints within one maximum segment of the
  // query's own content cuts. The flat-branch lookup is byte-exact and runs
  // before resolveSpan pays for a fold; approximate evidence never enters.
  // This tier is needed only where atom chains are suppressed. Small stores
  // retain their existing decomposition unchanged.
  // ALWAYS ON, AND LINEAR.  This used to be gated on `atomsAreHubs` — small
  // stores were said to "retain their existing decomposition unchanged", which
  // was true only while the query's fold was told where the turns were: every
  // turn was then a NODE, so the structural walk found it and this tier had
  // nothing to add.  The fold no longer imposes turn boundaries (a turn start
  // is an ordinary interior offset now), so a trained form embedded in a
  // longer query is reachable ONLY here — the chain caps at chainReach(W)=W²
  // bytes and cannot span one.  Measured: with the fold imposing boundaries
  // every turn is a node; without it, none is.
  //
  // Ungating it alone made inference QUADRATIC (test/14's constant-KB/s guard
  // went to 41.8s): every offset near a cut is an endpoint, and each probe
  // costs O(span) to slice the leaf-id run and hash it.  The budget below is
  // what makes it affordable — see `spend`.
  {
    const allLeafIds = singleLeaf.map((x) => x?.id ?? null);
    if (allLeafIds.every((x): x is number => x !== null)) {
      const radius = ctx.space.seats.length;
      const endpoints = new Set<number>([0, bytes.length]);
      for (const cut of startList) {
        for (
          let p = Math.max(0, cut - radius);
          p <= Math.min(bytes.length, cut + radius);
          p++
        ) endpoints.add(p);
      }
      const ordered = [...endpoints].sort((a, b) => a - b);
      // The leaf-id run is BYTE-EXACT, while `resolveSpan` behind it resolves
      // exactly OR canonically — so this gate was strictly narrower than its
      // own resolver, and every embedded form differing from its deposit only
      // by the response's equivalence (case, width) was dropped before the
      // resolver ever saw it.  Rebuilding the run over canonicalized bytes
      // does NOT fix that: a differently-cased deposit's branch kid-ids are
      // not the query's leaf-id run under ANY canonicalization of the query,
      // so the second admission route has to be the canon INDEX itself — the
      // same candidate proposal `canonResolve` makes, and the same
      // cheap-probe-before-a-fold discipline the exact route already follows
      // (a hash and an indexed lookup; no fold, no vector, no scan).  Both
      // routes only PROPOSE; `resolveSpan` still decides, so a hash-bucket
      // collision costs one fold and can never emit a wrong site (test/71).
      const canonAdmits = (start: number, end: number): boolean => {
        const canon = ctx.canon;
        if (canon === null || !store.canonFind) return false;
        const key = canon(bytes.subarray(start, end));
        if (key.length === 0) return false;
        return store.canonFind(canonHash(key)).length > 0;
      };
      // The byte-exact route probes the SPAN ITSELF (see
      // Store.findFlatBranch): for a run of single-byte leaves the flat-kid
      // encoding is the identity, so the span's bytes ARE the branch key.
      // `subarray` is a view — this allocates nothing per probe, and the
      // bloom filter answers the misses without touching the database.
      const flatProbe = (start: number, end: number): number | null =>
        store.findFlatBranch
          ? store.findFlatBranch(bytes.subarray(start, end))
          : store.findBranch(allLeafIds.slice(start, end));
      // THE TWO ROUTES COST DIFFERENT THINGS, SO THEY ARE PRICED SEPARATELY.
      //
      // The exact route is a bloom-gated hash over a subarray VIEW: no
      // allocation, and a miss never reaches the database.  It is cheap enough
      // to run on every endpoint, and that is what makes this tier able to
      // find a trained form embedded anywhere in the query.
      //
      // The canon route is not: it runs the canonicalizer over the span
      // (NFKC, case-fold, whitespace) and allocates a fresh key for every
      // probe.  That is the O(span) cost with the heavy constant, and it is
      // the one worth a budget.  Sharing ONE budget between them made the
      // cheap route starve on the expensive one's behalf — measured, test/71's
      // embedded differently-cased form needed 64x the budget to be found,
      // while the exact route it was competing with needed none of it.
      const probe = (
        start: number,
        end: number,
        canonBudget: boolean,
      ): void => {
        if (end - start < W || end - start <= chainReach(W)) return;
        if (flatProbe(start, end) === null) {
          if (!canonBudget) return;
          if (!canonAdmits(start, end)) return;
        }
        const id = resolveSpan(start, end);
        if (id !== null) emit(start, end, id);
      };
      // A CUMULATIVE BYTE BUDGET, SPENT SHORTEST-SPAN-FIRST.
      //
      // Each probe costs O(span), and there are O(n) endpoints, so probing
      // them all is O(n²) — the quadratic this tier was gated to avoid.  The
      // budget caps TOTAL probe bytes at a multiple of the query's own length,
      // which is what keeps whole-query inference linear.
      //
      // Spending it shortest-first is what makes the cap a scale bound rather
      // than a position bound: the tier recovers embedded forms up to roughly
      // √(2·budget) bytes ANYWHERE in the endpoint set, instead of walking the
      // endpoints in order and running out partway along the query.  A form
      // longer than that is out of this tier's reach — but so is a form the
      // chain cannot span, and that is exactly the trade the budget prices.
      // The factor is chainReach(W), the same W² scale the chain already
      // trusts; no new constant.
      // The factor is chainReach(W) — the same W² scale the chain itself
      // trusts — so the cap is derived from the fold's geometry, never tuned.
      // (It was briefly an environment variable while the cost was being
      // measured; an env-read here would make inference non-reproducible,
      // which the determinism contract forbids outright.)
      // The factor is chainReach(W) — the same W² scale the chain itself
      // trusts — so the cap is derived from the fold's geometry, never tuned.
      // (It was briefly an environment variable while the cost was being
      // measured; an env-read here would make inference non-reproducible,
      // which the determinism contract forbids outright.)
      //
      // It now prices ONLY the canonicalizing route; the exact route runs on
      // every endpoint regardless, so exhausting this budget narrows which
      // equivalence-class forms are proposed, never which byte-exact ones.
      let budget = bytes.length * chainReach(W) * chainReach(W);
      const spend = (start: number, end: number): boolean => {
        const span = end - start;
        const afford = span <= budget;
        if (afford) budget -= span;
        probe(start, end, afford);
        // Always keep walking: the exact route is unbudgeted, so running out
        // of canon budget must not stop the scan.
        return true;
      };
      const prefixes = ordered.filter((e) => e > 0).sort((a, b) => a - b);
      const suffixes = ordered
        .filter((s2) => s2 < bytes.length)
        .sort((a, b) => b - a);
      for (let i = 0; i < Math.max(prefixes.length, suffixes.length); i++) {
        // Interleaved so neither edge starves the other when the budget runs
        // out — a query can carry a trained form at either end.
        if (i < prefixes.length && !spend(0, prefixes[i])) break;
        if (i < suffixes.length && !spend(suffixes[i], bytes.length)) break;
      }
    }
  }

  const chunkEnd = new Uint32Array(bytes.length);
  const chunkSpan = new Uint32Array(bytes.length);
  const sorted = [...starts].sort((a, b) => a - b);
  for (let si = 0; si < sorted.length; si++) {
    const chunkStart = sorted[si];
    const chunkLimit = si + 1 < sorted.length ? sorted[si + 1] : bytes.length;
    for (let p = chunkStart; p < chunkLimit; p++) {
      chunkEnd[p] = chunkLimit;
      chunkSpan[p] = chunkLimit - chunkStart;
    }
  }

  // A chain rebuilt from a NON-boundary offset (the query's own perceived
  // cut, `starts`, never chose to segment here) is opportunistic: the same
  // byte-atom coincidence the hub guard above already exists for, just
  // spelled over 2+ leaves instead of 1.  At small corpus scale that's fine
  // — coincidence is rare and every chain is real evidence (see `atomIsHub`).
  // Past the scale where atoms themselves stop discriminating, the same
  // uniform-expectation argument bounds a CHAIN'S commonality too: it is at
  // least as rare as its rarest atom, so a store where atoms are hubs makes
  // interior chain reconstructions no more trustworthy than the atoms they
  // are built from ("hi" resolving out of "W[hi]ch" is exactly this: two
  // hub-scale atoms, chained at an offset nothing in the query's own fold
  // selected).  Chains that start ON a boundary carry the fold's own
  // evidence instead and are exempt.
  //
  // NOTE (2026-07-24): that last sentence is FALSE — `starts` is exactly
  // {0, W, 2W, …} (riverFold groups fixed-arity), so the exemption is
  // arithmetic, not evidence.  Removing it wholesale was measured and
  // REVERTED: it also drops legitimate multi-byte chains (the 12-byte
  // "Eiffel Tower" site vanished with it).  The premise is wrong but the
  // trust it stood in for is real; a replacement signal is still open work.
  // See bench/README.md.
  //
  // THE REPLACEMENT SIGNAL (2026-08-13): `leadsSomewhere` on the BYTE-EXACT
  // branch the chain already found.  The blanket off-boundary suppression is
  // a decision that CHANGES WITH CORPUS SIZE — `atomsAreHubs` flips at
  // N = 4096 (atomReach = ⌈N·W/256⌉ exceeds √N there) — so a store crossing
  // that point silently loses interior sites it used to have.  Measured: with
  // the two-hop chain deposited, `recognise("The country of Eiffel Tower is
  // France.")` yields 4 sites including `France` at N = 3920 and 2 sites
  // without it at N = 4227; the pivot dies with the site and multi-hop goes
  // silent from there up (the trained store is N = 325,615).
  //
  // The honest gate is the one `emit` already applies, moved EARLIER and paid
  // for with existence probes instead of a fold: `findBranch` has already
  // proved these bytes are a stored branch, so the only remaining question is
  // whether that branch is a deposited whole (bears an edge or a halo) or an
  // interned fragment.  "hi" out of "W[hi]ch" leads nowhere and is still
  // suppressed; `France` bears both and is admitted.  Structural, not scalar
  // — no constant enters and nothing reads N, so the verdict no longer moves
  // when the corpus grows.
  //
  // COST: `bearsEdge` is the response-MEMOISED edge probe, not the full
  // `leadsSomewhere` — its uncached `hasHalo` tier took haloProbes from 922 to
  // 9,144 on a nine-query battery over the trained store, which is not a price
  // this pass may charge.  `emit` still applies the full predicate, so this is
  // a pre-filter that never widens what is admitted.
  const tryChain = (
    p: number,
    maxIds: number,
    boundary: boolean,
  ): void => {
    const first = leafFrom(p);
    if (!first) return;
    emit(p, first.end, first.id);
    const ids = [first.id];
    let pos = first.end;
    let prevId: number | null = null;
    for (let depth = 1; pos < bytes.length && ids.length <= maxIds; depth++) {
      const nx = leafFrom(pos);
      if (!nx) break;
      ids.push(nx.id);
      pos = nx.end;
      const branch = store.findBranch(ids);
      if (branch === null) continue;
      if (!boundary && atomsAreHubs && !bearsEdge(ctx, branch)) continue;
      const id = resolveSpan(p, pos);
      if (id === null || id === prevId) continue;
      prevId = id;
      emit(p, pos, id);
    }
  };

  for (let p = 0; p < bytes.length; p++) {
    if (starts.has(p)) {
      tryChain(p, chainReach(W), true); // boundary start — full reach
    } else {
      // THE INTERIOR BUDGET IS "ONE CHUNK PLUS A QUANTUM", MEASURED FROM THE
      // CHAIN'S OWN START.  It used to be `chunkEnd[p] + W - p`, which counts
      // from the chunk's END, so the reach an interior chain gets depended on
      // WHERE INSIDE its chunk it happened to begin: measured on a composed
      // answer, a chunk spanning [0,6) gave offset 1 nine ids and offset 4
      // only six — and the 9-id trained form `Mona Lisa` starting at 4 died
      // three ids short of itself.  The same form one byte earlier would have
      // been found.  That is the position artifact this module has been
      // removing everywhere else, not a budget.
      //
      // Stated from `p` the trust is unchanged — a chain may span its own
      // chunk and one quantum beyond it — and it no longer varies with phase.
      tryChain(p, Math.min(chunkSpan[p] + W, chainReach(W)), false);
    }
  }

  // ── splits: a form boundary that does not fall on a leaf edge ────────
  const leafEdges = new Set<number>([bytes.length]);
  for (const lf of leaves) leafEdges.add(lf.start);
  for (const s of sites) {
    if (!leafEdges.has(s.start)) splits.add(s.start);
    if (!leafEdges.has(s.end)) splits.add(s.end);
  }

  ctx.trace?.step(
    "recognise",
    [rItem(bytes, "query")],
    sites.map((s) =>
      rItem(bytes.subarray(s.start, s.end), "form", s.payload, [
        s.start,
        s.end,
      ])
    ),
    `decompose the query into ${sites.length} learnt form(s) that lead somewhere` +
      ` (over ${leaves.length} perceived leaves)`,
  );

  return { sites, leaves, splits, starts };
}

/** Segment bytes using the geometry's own groupings — leaf-parent
 *  nodes from the perceived tree, with consecutive bare leaves merged
 *  into one segment.  Each segment's gist is perceived from its bytes
 *  IN ISOLATION, so the same content has the same gist regardless of
 *  where it appears. */
export function segment(ctx: MindContext, bytes: Uint8Array): Segment[] {
  const tree = perceive(ctx, bytes);
  const out: Segment[] = [];
  let pendingStart = -1;
  let pendingEnd = -1;

  const flush = () => {
    if (pendingStart >= 0 && pendingEnd > pendingStart) {
      out.push({
        start: pendingStart,
        end: pendingEnd,
        v: gistOf(ctx, bytes.subarray(pendingStart, pendingEnd)),
      });
    }
    pendingStart = -1;
    pendingEnd = -1;
  };

  const walk = (n: Sema, start: number): number => {
    if (n.kids === null) {
      const end = start + (n.leaf?.length ?? 0);
      if (pendingStart < 0) pendingStart = start;
      pendingEnd = end;
      return end;
    }
    if (isChunk(n)) {
      flush();
      let end = start;
      for (const c of n.kids) end += c.leaf?.length ?? 0;
      out.push({ start, end, v: gistOf(ctx, bytes.subarray(start, end)) });
      return end;
    }
    flush();
    let pos = start;
    for (const c of n.kids) pos = walk(c, pos);
    return pos;
  };
  walk(tree, 0);
  flush();
  return out;
}
