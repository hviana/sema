// graph-search.ts — the weighted deduction system that thinking runs on.
//
// Thinking is ONE thing: a lightest derivation over the Sema graph (derive's
// adapted A*LD engine).  This file is that one thing, factored out of the mind: it
// states the items, axioms, goal, and weighted rules, and returns the chosen
// spans of the lightest cover.  Every behaviour — covering the query, following
// edges to a fixpoint, jumping a concept (halo) link, fusing fragments into a
// deeper learned form, splicing a learnt connector between two rewrites, and
// re-voicing an answer in the asker's words — is a rule here, not a separate
// algorithm.
//
// It reaches Sema only through the {@link Store} interface and one injected
// callback, {@link GraphSearch.resolve} (canonical node id of a byte span).  The
// async hints the synchronous search cannot gather for itself — concept targets
// and connectors — are pre-resolved by the caller (see src/mind/pipeline.ts) and handed in.
// So this engine stays decoupled: it knows the graph's shape, never how the
// graph was learnt.
import { lightestDerivation } from "../derive/src/index.js";
import { bytesEqual, concat2, concatBytes, latin1 } from "../bytes.js";
import { ALL } from "./types.js";
// The cost ladder is a strict ORDERING, not tuned magic:
//   • Coverage dominates everything: leaving one query byte unrecognised (PASS)
//     outweighs any chain of graph steps a covering derivation could take, so
//     the search always prefers to recognise.
//   • A direct edge (STEP) is the cheapest move; fusing adjacent fragments is
//     free (cost 0) — it only re-NAMES a span, it does not advance the cover.
//   • A concept jump (CONCEPT) is dearer than a direct edge, so a literal
//     continuation is preferred to a synonym's.
// Any constants with this ordering give the same lightest derivations.
//
// EXPORTED because the ladder is the ONE cost currency of the whole mind:
// think's grounding decider (pipeline.ts) weighs every mechanism's candidate
// answer in these same units, so a mechanism-level choice and a byte-level
// choice are the same kind of decision — a lightest derivation.
export const STEP = 1;
export const CONCEPT = 10;
export const PASS = 1000;
/** The cheapest local cost in the ladder: a recognised completion bridging into
 *  the cover.  Far below STEP, so connecting two recognised spans never disturbs
 *  the ordering — and, being the minimum per-position cost, it is the per-byte
 *  unit of the admissible search heuristic (see {@link GraphSearch.buildSearch}). */
export const MICRO = 1e-3;
/** Append `v` to the list at `mp[k]`, creating the list on first use. */
function pushInto(mp, k, v) {
  const a = mp.get(k);
  if (a) {
    a.push(v);
  } else {
    mp.set(k, [v]);
  }
}
/** Read the chosen spans back off a derivation: the goal is a chain of bridge
 *  steps, each whose second premise is the `out` it crossed.  Walk the chain to
 *  the axiom and reverse into left-to-right order. */
function readCover(derivation) {
  const segs = [];
  let node = derivation;
  while (node && node.rule) {
    const out = node.premises[1].item;
    if (out.kind === "out") {
      segs.push({
        i: out.i,
        j: out.j,
        bytes: out.bytes,
        rec: out.rec,
        node: out.node,
      });
    }
    node = node.premises[0];
  }
  segs.reverse();
  return segs;
}
/** Flatten a {@link GItem} into the {@link DerivationItem} a rationale shows. */
function derivationItem(it) {
  if (it.kind === "cover") {
    return { kind: "cover", span: [it.p, it.p] };
  }
  if (it.kind === "form") {
    return { kind: "form", span: [it.i, it.j], node: it.node };
  }
  return { kind: "out", span: [it.i, it.j], bytes: it.bytes, node: it.node };
}
/** Name the reasoning act a rule performed, from the shape of what it consumed
 *  and produced — the one mapping from rule geometry to a human move.  Mirrors
 *  the rule set in {@link GraphSearch.coverRules}/{@link formRules}/{@link
 *  outRules}/{@link fuse}; kept here beside {@link readCover} so the two readers
 *  of a derivation sit together. */
function classifyMove(premises, conclusion, articulating) {
  if (premises.length === 1) {
    const [p] = premises;
    if (p.kind === "form" && conclusion.kind === "form") {
      // form→form is an edge step; CONCEPT cost marks the synonym hop, but the
      // cost is on the rule, not the item — the caller passes it to refine this.
      return "follow-edge";
    }
    if (p.kind === "form" && conclusion.kind === "out") {
      // form→out: grounding to a terminal answer, or — under a substitution map —
      // the form emitting the asker's own wording (articulation's `voice`).
      if (!conclusion.rec) {
        return "step";
      }
      return articulating ? "voice" : "ground";
    }
    if (p.kind === "out" && conclusion.kind === "out") {
      return "split";
    }
    return "step";
  }
  if (premises.length === 2) {
    const [a, b] = premises;
    if (a.kind === "cover" || b.kind === "cover") {
      return "bridge";
    }
    if (conclusion.kind === "form") {
      return "recompose";
    }
    if (conclusion.kind === "out") {
      // A connector splice concatenates THREE pieces (l + link + r); a plain
      // fuse concatenates two (concat2).  Distinguish by BYTE width: a splice's
      // conclusion is wider than its two premises summed (the link sits between
      // them), whereas a fuse's conclusion is exactly their sum.  Position can't
      // tell them apart — in "icefire" the two rewrites are positionally
      // adjacent yet a connector is still spliced into the bytes.
      if (a.kind === "out" && b.kind === "out") {
        const summed = (a.bytes?.length ?? 0) + (b.bytes?.length ?? 0);
        return (conclusion.bytes?.length ?? 0) > summed
          ? "splice-connector"
          : "fuse";
      }
      return "fuse";
    }
  }
  return "step";
}
/** Walk a finished derivation into its rule applications, in post-order
 *  (premises before the conclusion they feed), deduplicating shared
 *  sub-derivations so a node reached by two rules is reported once.  This is the
 *  whole proof tree — every STEP, CONCEPT, fuse and bridge the lightest cover
 *  was built from — the finest granularity a rationale can reach. */
function readDerivation(root, articulating = false) {
  const steps = [];
  // The `order` assigned to each already-emitted derivation node, so a later
  // step that consumes it as a premise can name it as a producer — the proof
  // tree's data-flow edge, preserved exactly.  Only RULE-bearing nodes (the
  // emitted steps) get an entry; an axiom premise (a seed leaf/form/computed
  // result) has no producer and contributes no edge.  `order` therefore stays
  // contiguous with `steps`, so producers index directly into the emitted list.
  const orderOf = new Map();
  let order = 0;
  const walk = (d) => {
    if (orderOf.has(d)) {
      return; // a shared sub-derivation, already emitted
    }
    for (const p of d.premises) {
      walk(p);
    }
    if (!d.rule) {
      return; // an axiom: a seed, reported as its consumer's premise
    }
    const move = classifyMove(d.rule.premises, d.rule.conclusion, articulating);
    // Refine an edge step to a concept hop by its cost (CONCEPT > STEP).
    const refined = move === "follow-edge" && d.rule.cost >= CONCEPT
      ? "concept-hop"
      : move;
    const producers = [];
    for (const p of d.premises) {
      const o = orderOf.get(p); // defined iff p was itself an emitted rule step
      if (o !== undefined) {
        producers.push(o);
      }
    }
    const myOrder = order++;
    orderOf.set(d, myOrder);
    steps.push({
      order: myOrder,
      move: refined,
      premises: d.premises.map((p) => derivationItem(p.item)),
      conclusion: derivationItem(d.item),
      cost: d.rule.cost,
      producers,
    });
  };
  walk(root);
  return steps;
}
/** The lightest-derivation search over the Sema graph.  One instance binds the
 *  store, `maxGroup` (the fusible span ceiling), and the canonical
 *  {@link resolve} callback; {@link cover} then solves one query. */
export class GraphSearch {
  store;
  maxGroup;
  host;
  constructor(
    store,
    maxGroup,
    /** The host whose capabilities the search consults: resolve (canonical node
     *  id of a byte span), recogniseSpan (content-addressed graph lookup for
     *  recursive completion), and chooseNext (distributional-evidence edge
     *  disambiguation when a recognised form has multiple continuations). */
    host,
  ) {
    this.store = store;
    this.maxGroup = maxGroup;
    this.host = host;
  }
  /** Explore the Sema graph for the lightest cover of the query and return its
   *  chosen spans left-to-right — WITH the derivation's total weight (the g
   *  value of the goal item, in the exported cost ladder), which think's
   *  grounding decider compares against the other mechanisms' candidates —
   *  or null if the query cannot be covered.
   *
   *  The search runs on the query's tree leaves, not flat bytes — leaf-level
   *  cover axioms, recognised forms as graph entry points — and discovers
   *  cross-leaf forms by fusing adjacent fragments on demand (the only
   *  byte-processing it does, and only where a derivation needs it).  When
   *  `substitutions` is given, recognised forms emit substitute bytes directly
   *  (cost 0) — articulation splicing the asker's wording in.
   *
   *  Any learnt connector between two rewrites is spliced IN by the in-search
   *  connector rule (see {@link outRules}), so the returned spans already carry
   *  it — there is no post-pass. */
  cover(
    queryLen,
    sites,
    conceptTarget,
    leaves,
    splits,
    substitutions,
    connectors,
    computedResults,
    /** When given, receives the lightest derivation's rule applications — the
     *  full adapted A*LD proof tree as classified {@link DerivationStep}s — for the TOP
     *  cover only (a recursive recompletion solves its own sub-cover and is not
     *  reported here, to keep the trace one layer per think).  Off by default,
     *  so the search pays nothing when no one inspects. */
    onDerivation,
  ) {
    // Top-level entry: reset the per-call recursion state, then run the one
    // {@link solve} routine that both the query and any produced composite go
    // through (completion is cover, recursively — see {@link recompleteNode}).
    this.recompleteOpen.clear();
    this.recompleteMemo = new Map();
    return this.solve(
      queryLen,
      {
        sites,
        leaves,
        splits,
      },
      conceptTarget,
      substitutions,
      connectors,
      computedResults,
      onDerivation,
    );
  }
  /** Build the deduction system for one span and return its lightest cover's
   *  chosen spans — the SINGLE routine the query and every produced composite
   *  run through.  `recognition` carries the span's recognised forms; the query
   *  brings its own (with pre-resolved concepts/connectors), a recursive
   *  completion re-recognises the produced bytes (edge/fuse only).
   *
   *  No depth limit governs nesting — convergence is INTRINSIC, exactly as in the
   *  adapted A*LD chart and {@link completeForward}: a completion only recurses into a
   *  node it has not already entered ({@link recompleteNode}'s cycle guard), and
   *  the node ids are finite, so the recursion must terminate on its own.  A
   *  decomposition may therefore run as deep as the graph licenses — three
   *  decomposes, two recomposes, any mix — and stops only when it reaches a node
   *  that leads nowhere new, never at an arbitrary count. */
  solve(
    spanLen,
    recognition,
    conceptTarget,
    substitutions,
    connectors,
    computedResults,
    onDerivation,
  ) {
    const system = this.buildSearch(
      spanLen,
      recognition.sites,
      conceptTarget,
      recognition.leaves,
      recognition.splits,
      substitutions,
      connectors,
      computedResults,
    );
    const derivation = lightestDerivation(system);
    // When covering under a substitution map (articulation), a form→out rule is
    // the form EMITTING the asker's voice, not grounding to its own answer — so
    // tell the reader to name those moves `voice` rather than `ground`.
    if (derivation && onDerivation) {
      onDerivation(readDerivation(derivation, substitutions !== undefined));
    }
    return derivation
      ? { segs: readCover(derivation), cost: derivation.cost }
      : null;
  }
  /** The weighted deduction system the graph exploration solves (the four
   *  reductions of adapted A*LD live in {@link lightestDerivation}; this only states the
   *  items, axioms, goal, and rules — see {@link GItem} for the item kinds).
   *
   *  Forms that span across leaves are discovered BY the rules, which fuse
   *  adjacent fragments toward a known leaf (findLeaf) or branch (findBranch);
   *  a completion fused with its neighbour may spell a deeper learned form the
   *  flat probes can't name, recovered canonically by {@link resolve}. */
  buildSearch(
    queryLen,
    sites,
    conceptTarget,
    leaves,
    splits,
    substitutions,
    connectors,
    computedResults,
  ) {
    const W = this.maxGroup; // fusible span ceiling (shortest composite bound)
    const nodeBytes = (n) => this.store.bytesPrefix(n, ALL);
    // Content-addressed probes over the store's hash-cons maps — the same keys
    // training filled.  No byte-by-byte trie walk.
    const findLeafU = (b) => this.store.findLeaf(b) ?? undefined;
    const findBranchU = (k) => this.store.findBranch(k) ?? undefined;
    // Finalised `out` items, indexed for the binary (bridge, fuse) rules.
    const coversDone = new Set();
    const outsByStart = new Map();
    const outsByEnd = new Map();
    const outsByNode = new Map();
    const coverableByStart = new Map();
    // Index the connectors by their left and right answer-node, so the connector
    // rule iterates only this out's FEW resolved partners (selective, and for the
    // N-ary case O(parts) keys) instead of scanning every position pair — what
    // keeps the in-search bridge bounded when many parts are recognised at once.
    const linksByLeft = new Map();
    const linksByRight = new Map();
    if (connectors) {
      for (const [key, bytes] of connectors) {
        const comma = key.indexOf(",");
        const l = Number(key.slice(0, comma));
        const r = Number(key.slice(comma + 1));
        pushInto(linksByLeft, l, [r, bytes]);
        pushInto(linksByRight, r, [l, bytes]);
      }
    }
    return {
      key(it) {
        if (it.kind === "cover") {
          return "c" + it.p;
        }
        if (it.kind === "form") {
          return `f${it.i}.${it.j}.${it.node}.${it.via ? 1 : 0}.${
            it.rcmp ? 1 : 0
          }`;
        }
        return `o${it.i}.${it.j}.${it.cover ? 1 : 0}.${it.rec ? 1 : 0}.${
          it.node ?? -1
        }.${latin1(it.bytes)}`;
      },
      *axioms() {
        yield { item: { kind: "cover", p: 0 }, cost: 0 };
        // One out per tree leaf — content-defined chunks, far fewer than bytes.
        // Each carries the node id it resolves to (when known) so it can compose
        // toward a known branch by findBranch.
        for (const lf of leaves) {
          yield {
            item: {
              kind: "out",
              i: lf.start,
              j: lf.end,
              bytes: lf.bytes,
              cover: true,
              rec: false,
              node: lf.node ?? undefined,
            },
            cost: 0,
          };
        }
        for (const s of sites) {
          yield {
            item: {
              kind: "form",
              i: s.start,
              j: s.end,
              node: s.payload,
              via: false,
            },
            cost: 0,
          };
        }
        // Computed (extension) results — see {@link ComputedResult}.  Each enters as a
        // RECOGNISED covering completion, exactly like a learned terminal answer:
        // its bytes are the computed result, it bridges the cover at MICRO (rec),
        // and it carries the result's canonical node (when the store holds it) so
        // it can fuse as an operand of an outer form.  The STEP base cost marks a
        // computation as a unit of work — a derived fact, on par with following a
        // learned edge (STEP), so it decisively beats leaving the span
        // unrecognised (PASS) but never masquerades as a free perceived leaf.
        // Because this cost EQUALS a learned edge's, the search would tie a
        // computation against a colliding recall; the computation-always-wins policy lives
        // in the caller (src/mind/pipeline.ts think), which masks any recognised site a result
        // overlaps so the computation is the cover's sole completion there — the
        // search stays a neutral cost engine with no computation-vs-recall precedence baked
        // in.  When `computedResults` is empty (every non-arithmetic query) this loop
        // emits nothing, so the search is byte-identical to one with no extension at all.
        for (const u of computedResults ?? []) {
          yield {
            item: {
              kind: "out",
              i: u.i,
              j: u.j,
              bytes: u.bytes,
              cover: true,
              rec: true,
              node: u.node,
            },
            cost: STEP,
          };
        }
      },
      isGoal: (it) => it.kind === "cover" && it.p === queryLen,
      // Admissible, consistent lower bound on the cost remaining to the goal
      // cover(queryLen) — this is what makes the adapted A*LD search OUTPUT-SENSITIVE
      // (work proportional to the answer, not to how densely the corpus enriched
      // the query's sub-forms).  Without it the engine runs as uninformed
      // Dijkstra and pops every zero-cost fuse before the goal; with it the
      // agenda is ordered g + h, so the frontier is driven FORWARD toward full
      // coverage instead of wallowing in low-position fragment fusions.
      //
      // The bound: whatever an item is, reaching the goal still requires the
      // cover frontier to advance to queryLen, and the CHEAPEST any single
      // covered position can be is the recognised-completion bridge (ε = MICRO,
      // the minimum local cost in the ladder — every other move costs ≥ STEP).
      // So the remaining query past the item's right edge is a guaranteed
      // ≥ ε-per-byte cost.  cover(p) still owes [p,queryLen); a form/out at
      // [i,j) can contribute coverage no further than j, so it still owes
      // [j,queryLen).  Using ε (≤ every real per-byte cost, incl. PASS) keeps it
      // a true lower bound; counting only the suffix past the right edge keeps it
      // consistent (each forward rule pays ≥ ε per byte it advances the edge).
      heuristic: (it) => {
        const right = it.kind === "cover" ? it.p : it.j;
        return (queryLen - right) * MICRO;
      },
      rules: (it) => {
        if (it.kind === "cover") {
          return this.coverRules(it, coversDone, coverableByStart);
        }
        if (it.kind === "form") {
          return this.formRules(it, conceptTarget, substitutions, nodeBytes);
        }
        return this.outRules(it, {
          W,
          splits,
          coversDone,
          outsByStart,
          outsByEnd,
          outsByNode,
          coverableByStart,
          findLeafU,
          findBranchU,
          linksByLeft,
          linksByRight,
        });
      },
    };
  }
  /** cover(p): the BRIDGE rule — extend the cover across any coverable out that
   *  begins at p, stepping the frontier from p to that out's end.
   *
   *  This is what links the rewritten parts of a multi-form answer.  An out is
   *  either a recognised completion (`rec`, free) or a literal span the query
   *  carried between known forms — the connective: a space, comma, period,
   *  newline, or any run of bytes that was never recognised.  Bridging a literal
   *  costs PASS per byte (so the search still prefers to recognise), but it is
   *  the cheapest — indeed only — way to cross a gap that has no learned form,
   *  and it KEEPS that connective in the cover chain, so the asker's own linking
   *  material reappears when it still coheres ("ice, fire" → "cold, hot", not
   *  "coldhot").  A recognised completion bridges for a tiny ε (1e-3, far below
   *  STEP), so a single connected span beats two separate ones on coherence
   *  without disturbing the cost ladder's ordering.
   *
   *  Marks p finalised so the symmetric out-side bridge ({@link outRules}) can
   *  fire for outs that arrive after their start position is covered. */
  *coverRules(it, coversDone, coverableByStart) {
    coversDone.add(it.p);
    for (const o of coverableByStart.get(it.p) ?? []) {
      yield this.bridgeRule(it, o);
    }
  }
  /** The BRIDGE rule, built once for its two arrival orders (cover-first in
   *  {@link coverRules}, out-first in {@link outRules}): ε for a recognised
   *  completion; PASS per byte for a literal connective — kept in the cover
   *  so the asker's own connector survives where it fits.  ONE definition of
   *  the cost expression, so the ladder's application cannot drift between
   *  the two sides. */
  bridgeRule(cover, o) {
    return {
      premises: [cover, o],
      conclusion: { kind: "cover", p: o.j },
      cost: o.rec ? MICRO : PASS * (o.j - o.i),
    };
  }
  /** The connector-SPLICE rule for an oriented (l, r) pair, or null when the
   *  pair does not qualify — the ONE body behind {@link outRules}' two
   *  mirror loops (this-as-left over resolved right partners, this-as-right
   *  over resolved left partners).  Fires only when both sides are
   *  recognised, r starts at or after l ends, and the gap between them is
   *  empty or wholly recognised — never across the asker's own literal
   *  separator. */
  trySplice(l, r, link, outsByEnd) {
    if (!l.rec || !r.rec || r.i < l.j) {
      return null;
    }
    if (!this.gapRecognised(l.j, r.i, outsByEnd)) {
      return null;
    }
    return {
      premises: [l, r],
      conclusion: {
        kind: "out",
        i: l.i,
        j: r.j,
        bytes: concatBytes([l.bytes, link, r.bytes]),
        cover: true,
        rec: true,
        node: r.node,
      },
      cost: 0,
    };
  }
  /** form(i,j,node,via): follow the graph out of `node`, or (in articulation)
   *  emit its substitute voice directly. */
  *formRules(it, conceptTarget, substitutions, nodeBytes) {
    // Articulation: emit voice bytes at the recognised span; the hop/concept/
    // emit chain is suppressed — the form contributes only its substitute.
    if (substitutions) {
      const voice = substitutions.get(it.node);
      if (voice !== undefined) {
        yield {
          premises: [it],
          conclusion: {
            kind: "out",
            i: it.i,
            j: it.j,
            bytes: voice,
            cover: true,
            rec: true,
            node: it.node,
          },
          cost: 0,
        };
      }
      return;
    }
    // LIMIT 2 decides all three facts this rule needs — emptiness, plurality
    // (whether to consult the disambiguator), and the first-inserted
    // fallback — without materialising a hub context's corpus-sized fan-out.
    const nx = this.store.nextFirst(it.node, 2);
    if (nx.length) {
      // A direct edge — step along the chain toward its fixpoint.  A recomposed
      // form (parts already rewritten and fused into a learned whole) follows
      // its continuation at MICRO, so reaching the grounded answer of the
      // recomposition beats leaving the parts split; the flag rides the chain so
      // every step of the recomposition's completion stays cheap.
      //
      // WHICH edge: a context node often carries SEVERAL learnt continuations
      // (the same sentence trained against 100+ target languages, a question
      // answered differently across sessions).  `nx[0]` is an accident of
      // training order; when the host provides a `chooseNext` disambiguator
      // (see Mind.chooseNext) it picks the continuation with the most
      // distributional evidence (prevOf count — the structural manifestation
      // of its halo), falling back to first-inserted when evidence is equal.
      yield {
        premises: [it],
        conclusion: {
          kind: "form",
          i: it.i,
          j: it.j,
          node: (nx.length > 1 ? this.host.chooseNext?.(it.node) : undefined) ??
            nx[0],
          via: true,
          rcmp: it.rcmp,
        },
        // A recomposed form's continuation is FREE: the two (or more) parts were
        // already paid for as their own rewrites, and the single consolidated
        // span saves one cover-bridge versus leaving them split — so charging 0
        // here makes the grounded whole (e.g. "DE"→F) strictly beat the split
        // ("D","E") by exactly that saved bridge, deterministically.
        cost: it.rcmp ? 0 : STEP,
      };
    } else if (it.via) {
      // The chain reached a node with no WHOLE-node continuation.  Before
      // emitting it as terminal, CONTINUE THE EXPLORATION into its own structure:
      // a composite answer like "p1 p2" leads nowhere as a whole, yet recognising
      // it surfaces p1, p2 — each of which continues (→ R1, R2) and recomposes
      // into a deeper learnt form (→ FINAL).  {@link recompleteNode} re-covers the
      // node's bytes through the SAME recognition + edge/fuse machinery the top
      // query uses (a continued graph exploration, not a re-perception), and
      // returns the deeper completion's bytes when it genuinely leads somewhere
      // new.  Emit that; else emit the node itself as the terminal answer.
      const deeper = this.recompleteNode(it.node);
      yield {
        premises: [it],
        conclusion: {
          kind: "out",
          i: it.i,
          j: it.j,
          bytes: deeper ?? nodeBytes(it.node),
          cover: true,
          rec: true,
          node: it.node,
        },
        cost: 0,
      };
    } else {
      // Recognised but edge-less: borrow a concept (halo) sibling's edge.  No
      // edge and no concept means the form leads nowhere — it yields no rule, so
      // a query of only such forms produces no derivation, and think is silent.
      const target = conceptTarget.get(it.node);
      if (target !== undefined) {
        yield {
          premises: [it],
          conclusion: {
            kind: "form",
            i: it.i,
            j: it.j,
            node: target,
            via: true,
          },
          cost: CONCEPT,
        };
      }
    }
  }
  /** Complete a node that an edge produced but that bears no further whole-edge,
   *  by COVERING ITS OWN BYTES — the very same operation the top query runs.
   *  Completion is not a special pass: a produced composite ("p1 p2") is just
   *  another span to cover, and covering it re-applies recognition, edge-follow,
   *  fusion and recomposition to discover that its parts continue (p1→R1, p2→R2)
   *  and recompose into a deeper learnt form (→ FINAL).  This is why a single
   *  edge-target needs no bespoke logic — it routes back through {@link solve}.
   *
   *  Re-recognition (not the node's tree children) is what surfaces the learnt
   *  parts: content-defined chunking may cut "p1 p2" as "p1 p"|"2", so only
   *  recognising the bytes recovers p1 and p2 as the forms the graph knows.
   *
   *  The recovered answer is accepted only when it MOVED and names a LEARNT node
   *  ({@link resolve}) — the graph itself gates against re-expanding a contained
   *  form ("ice is cold" ⊅→ "ice is cold is cold").
   *
   *  Termination is INTRINSIC, not a depth limit: a node already on the
   *  completion stack ({@link recompleteOpen}) is not re-entered — a self-
   *  referential recomposition is a cycle that can yield nothing new, so it
   *  stops there, exactly as {@link completeForward} stops on a revisited edge.
   *  Distinct node ids are finite and each finished completion is memoised, so a
   *  legitimate chain runs as deep as the graph licenses and no further. */
  recompleteNode(node) {
    if (!this.host.recogniseSpan) {
      return null;
    }
    const memo = this.recompleteMemo;
    if (memo.has(node)) {
      return memo.get(node) ?? null;
    }
    // Cycle guard: a node being completed must not recurse back into itself.
    if (this.recompleteOpen.has(node)) {
      return null;
    }
    // A leaf or single-child node has no parts to recompose; skip before the
    // costly recognition so a plain terminal answer pays nothing.
    const nrec = this.store.get(node);
    if (!nrec || nrec.kids === null || nrec.kids.length < 2) {
      memo.set(node, null);
      return null;
    }
    const bytes = this.store.bytesPrefix(node, ALL);
    this.recompleteOpen.add(node);
    try {
      // Completion is cover: re-cover the produced bytes through the SAME solve
      // routine, recognising them afresh.  No concepts/connectors (those need the
      // caller's async pre-resolution) — the recursion explores edges and fusion,
      // which is what a deeper rewrite chain is made of.
      const solved = this.solve(
        bytes.length,
        this.host.recogniseSpan(bytes),
        new Map(),
      );
      const answer = solved && concatBytes(solved.segs.map((s) => s.bytes));
      const out = (answer !== null && !bytesEqual(answer, bytes) &&
          this.host.resolve(answer) !== null)
        ? answer
        : null;
      memo.set(node, out);
      return out;
    } finally {
      this.recompleteOpen.delete(node);
    }
  }
  /** Per-cover memo of each produced node's completion (so the many terminal
   *  outs of a long query re-cover each distinct node at most once); reset at the
   *  top of {@link cover}. */
  recompleteMemo = new Map();
  /** The nodes currently being re-completed — the recursion stack.  A node in
   *  this set is not re-entered, so a cyclic recomposition terminates naturally
   *  (the same cycle guard {@link completeForward} uses), with no depth cap. */
  recompleteOpen = new Set();
  /** out(i,j,bytes,…): index it for the binary rules, then offer splicing a
   *  learnt connector (the in-search bridge), splitting (at a sub-leaf form
   *  boundary), bridging (cover(i) ∧ this → cover(j)), and fusing with an
   *  adjacent finalised out. */
  *outRules(it, ctx) {
    const { splits, coversDone, outsByStart, outsByEnd, coverableByStart } =
      ctx;
    const outsByNode = ctx.outsByNode;
    const byRight = ctx.linksByRight ?? new Map();
    pushInto(outsByStart, it.i, it);
    pushInto(outsByEnd, it.j, it);
    if (it.rec && it.node !== undefined) {
      pushInto(outsByNode, it.node, it);
    }
    if (it.cover) {
      pushInto(coverableByStart, it.i, it);
    }
    // ── connector rule (the BRIDGE, in-search) ──────────────────────────
    // A connector keyed `L,R` carries everything a learnt whole holds BETWEEN
    // answer L and answer R — for an N-ary whole, that includes the interior
    // answers (see {@link Mind.resolveGroupConnectors}).  Splicing it joins L and
    // R into one recognised span L+connector+R, priced inside the search.  The
    // rule fires for ADJACENT parts (R begins where L ends) AND across a gap that
    // is ITSELF wholly recognised (an interior answer absorbed into the whole,
    // Points 2 & 5) — but NEVER across the asker's own unrecognised separator (a
    // space, comma), so "ice fire" stays "cold hot", never "cold or hot".
    //
    // Cost stays bounded by iterating only the FEW resolved connector targets of
    // this out's node (links are selective and, for the N-ary case, keyed first→
    // later — O(parts), not O(parts²)), and matching them against finalised outs
    // by node id, rather than scanning every position pair.
    const byLeft = ctx.linksByLeft;
    if (byLeft && it.rec && it.node !== undefined) {
      // L = this out, R = a later out whose node is a resolved target.
      for (const [rNode, link] of byLeft.get(it.node) ?? []) {
        for (const r of outsByNode.get(rNode) ?? []) {
          const rule = this.trySplice(it, r, link, outsByEnd);
          if (rule) {
            yield rule;
          }
        }
      }
      // R = this out, L = an earlier out whose node has a resolved target here.
      for (const [lNode, link] of byRight.get(it.node) ?? []) {
        for (const l of outsByNode.get(lNode) ?? []) {
          const rule = this.trySplice(l, it, link, outsByEnd);
          if (rule) {
            yield rule;
          }
        }
      }
    }
    // Split an unrecognised out at a sub-leaf form boundary — demand-driven,
    // only when a split point sits inside this out's range.  Each half carries
    // its own resolved node id so it can still anchor a fusion.
    if (it.cover && !it.rec && it.j - it.i > 1) {
      for (const k of splits) {
        if (k > it.i && k < it.j) {
          const lb = it.bytes.subarray(0, k - it.i);
          const rb = it.bytes.subarray(k - it.i);
          yield {
            premises: [it],
            conclusion: {
              kind: "out",
              i: it.i,
              j: k,
              bytes: lb,
              cover: true,
              rec: false,
              node: ctx.findLeafU(lb),
            },
            cost: 0,
          };
          yield {
            premises: [it],
            conclusion: {
              kind: "out",
              i: k,
              j: it.j,
              bytes: rb,
              cover: true,
              rec: false,
              node: ctx.findLeafU(rb),
            },
            cost: 0,
          };
        }
      }
    }
    // The BRIDGE, fired from the out side: cover(i) ∧ this → cover(j).  Same
    // rule as coverRules, the other order of arrival — an out finalised after
    // its start was already covered.  Either way the connective (this out, when
    // unrecognised) is carried into the cover chain so the asker's own link
    // survives between the rewritten parts.
    if (it.cover && coversDone.has(it.i)) {
      yield this.bridgeRule({ kind: "cover", p: it.i }, it);
    }
    for (const r of outsByStart.get(it.j) ?? []) {
      yield* this.fuse(it, r, ctx);
    }
    for (const l of outsByEnd.get(it.i) ?? []) {
      yield* this.fuse(l, it, ctx);
    }
  }
  /** Whether the query span [from, to) is wholly covered by RECOGNISED outs —
   *  the test that lets a connector jump across INTERIOR answers (an N-ary whole)
   *  but never across the asker's own unrecognised framing (a space or comma the
   *  asker wrote between parts).  Empty span (from === to, the adjacent case) is
   *  trivially recognised.  Otherwise step right-to-left: from `to`, find a
   *  recognised out ending there and continue from its start, until reaching
   *  `from`.  Greedy-longest is sufficient here — the spans in play are the few
   *  recognised answers of one query, not a general interval cover. */
  gapRecognised(from, to, outsByEnd) {
    let pos = to;
    while (pos > from) {
      let stepped = -1;
      for (const o of outsByEnd.get(pos) ?? []) {
        if (o.rec && o.i >= from && o.i < pos) {
          stepped = Math.min(stepped === -1 ? o.i : stepped, o.i);
        }
      }
      if (stepped < 0) {
        return false; // a position not spanned by a recognised out
      }
      pos = stepped;
    }
    return true;
  }
  /** Fuse two adjacent finalised outs — the search's own discovery of forms
   *  that cross leaf boundaries.  The concatenation may be a known leaf
   *  (findLeaf, when short enough), or — when both sides resolved — their pair a
   *  known branch (findBranch); a completion fused with its neighbour may spell
   *  a deeper learned form, recovered canonically by {@link resolve} (gated on a
   *  completion being present, so it only runs along chains).  The fused span
   *  lives on as an intermediate out while it could still grow into a form, and
   *  enters the graph as a form the moment it names a node. */
  *fuse(l, r, ctx) {
    const bytes = concat2(l.bytes, r.bytes);
    let node = bytes.length <= ctx.W ? ctx.findLeafU(bytes) : undefined;
    // Whether this pair ACTUALLY forms a 2-child branch — the hard evidence
    // that the fused bytes are a learned form worth keeping alive.  Derived
    // from the same findBranchU probe that sets `node`; when false, the pair
    // is structurally unrecognised and an intermediate span that carries no
    // node cannot contribute to any further fusion (findBranch needs two
    // nodes, resolve needs a completion, and findLeaf already had its chance).
    let pairFormsBranch = false;
    if (node === undefined && l.node !== undefined && r.node !== undefined) {
      node = ctx.findBranchU([l.node, r.node]);
      pairFormsBranch = node !== undefined;
    }
    if (node === undefined && (l.rec || r.rec)) {
      // Canonical recovery of a deeper learned form fused from a completion and
      // its neighbour.
      const id = this.host.resolve(bytes);
      if (id !== null) {
        node = id;
      }
    }
    // A completed rewrite (rec) must not be absorbed into an unrelated INTERIOR
    // chunk of a one-shot phrase: that lets the chunk's continuation swallow the
    // inter-part gap and corrupt the answer ("cold"+" " → "cold " ⊂ "cold or
    // hot"; "Y"+" " → "Y " ⊂ "X then Y then Z").  A node learnt as a meaningful
    // unit bears a halo (it took part in an episode); a bare phrase-interior
    // chunk does not.  So when a completion fuses into a node, require that node
    // to be halo-bearing — a real fused form (a learnt fact context like "4+3")
    // carries a halo and still passes.
    if (node !== undefined && (l.rec || r.rec) && !this.store.hasHalo(node)) {
      node = undefined;
    }
    // A node-less fused span is kept alive ONLY while it can still grow INTO a
    // learned form: it's still ≤ W bytes (so a wider fuse might yet name it via
    // findLeaf), or the pair ACTUALLY forms a branch (so the fused bytes are
    // a real learned form, even if the halo gate cleared its node above).  It is
    // NOT kept merely because both sides carry a node — that "potential" gate
    // let every pair of adjacent recognised forms produce an intermediate span
    // regardless of whether they name a branch together, generating O(N²) chart
    // items for N abutted forms where only O(N) pairs actually form branches.
    // The earlier O(2ⁿ) gate (kept alive whenever a side was a completion) is
    // already superseded by this one — a completion that genuinely deepens names
    // a node via findBranch or resolve and is yielded as a form regardless.
    const couldGrow = bytes.length <= ctx.W || pairFormsBranch;
    if (node === undefined && !couldGrow) {
      return;
    }
    yield {
      premises: [l, r],
      conclusion: {
        kind: "out",
        i: l.i,
        j: r.j,
        bytes,
        cover: false,
        rec: false,
        node,
      },
      cost: 0,
    };
    if (node !== undefined) {
      // A RECOMPOSITION: two already-rewritten parts (both rec completions)
      // fused into a node that itself CONTINUES.  Tag the form so its onward
      // step is charged at MICRO (see formRules) — the graph learned this whole,
      // so following it to its grounded answer must win over leaving the parts
      // split.  An ordinary cross-leaf fuse (not from rewrites) is not tagged and
      // keeps the normal STEP cost.
      const recomposed = l.rec && r.rec && this.store.hasNext(node);
      yield {
        premises: [l, r],
        conclusion: {
          kind: "form",
          i: l.i,
          j: r.j,
          node,
          via: false,
          rcmp: recomposed,
        },
        cost: 0,
      };
    }
  }
}
