import type { Store } from "../store.js";
import type { GraphSearchHost } from "./types.js";
/** A recognised form: a span of the query that names a node already in the
 *  store. `payload` is that node id. */
export interface Site {
    start: number;
    end: number;
    payload: number;
}
/** A perceived leaf of the query tree, carrying the node id it resolves to. */
export interface Leaf {
    start: number;
    end: number;
    bytes: Uint8Array;
    node: number | null;
}
/** A COMPUTED span: the result of applying a manual rule (an extension's
 *  operation — e.g. the `alu` extension's arithmetic) to a recognised stretch
 *  of the query.  Every
 *  bit of the intelligence — recognising the operator (literally or by
 *  resonance), parsing the operands, evaluating the operation — is done by the
 *  caller (src/mind/pipeline.ts), which hands the search the finished result span; the search
 *  treats it exactly like any other recognised completion (a learned fact that
 *  happens to be computed rather than stored).  `node` is the canonical id of
 *  the result bytes when the store already holds them, else undefined. */
export interface ComputedResult {
    i: number;
    j: number;
    bytes: Uint8Array;
    node?: number;
}
export type GItem = {
    kind: "cover";
    p: number;
} | {
    kind: "form";
    i: number;
    j: number;
    node: number;
    via: boolean;
    /** Set when this form was born by RECOMPOSING rewritten parts into a deeper
     *  learned whole (the fuse of ≥2 recognised completions that names an
     *  edge-bearing node).  Its onward continuation is charged at MICRO, not
     *  STEP: once parts are recomposed into a learned form, following that form
     *  to its grounded answer is the recomposition completing — so the
     *  consolidated, more-explanatory reading wins over leaving the parts split.
     *  See {@link GraphSearch.fuse} and {@link GraphSearch.formRules}. */
    rcmp?: boolean;
} | {
    kind: "out";
    i: number;
    j: number;
    bytes: Uint8Array;
    cover: boolean;
    rec: boolean;
    node?: number;
};
export declare const STEP = 1;
export declare const CONCEPT = 10;
export declare const PASS = 1000;
/** The cheapest local cost in the ladder: a recognised completion bridging into
 *  the cover.  Far below STEP, so connecting two recognised spans never disturbs
 *  the ordering — and, being the minimum per-position cost, it is the per-byte
 *  unit of the admissible search heuristic (see {@link GraphSearch.buildSearch}). */
export declare const MICRO = 0.001;
/** One chosen span of the cover, left to right.  `node` is the graph node the
 *  span resolved to (when known) — for a recognised completion it is the chain's
 *  terminal node, the foothold the bridge walks edges from. */
export interface Seg {
    i: number;
    j: number;
    bytes: Uint8Array;
    rec: boolean;
    node?: number;
}
/** One rule application inside the cover's lightest derivation — the FINEST
 *  grain of Sema's core reasoning, one node of the adapted A*LD proof tree.  `move`
 *  names which deduction rule fired (the reasoning act); `premises` and
 *  `conclusion` are the items it consumed and produced, each rendered as a
 *  positioned, possibly-node-bearing span; `cost` is the rule's local weight
 *  (STEP for a learned edge, CONCEPT for a synonym hop, 0 for a free fuse, …);
 *  `order` is its post-order position so a tracer can replay the proof in the
 *  order it was built (premises before conclusion). */
export interface DerivationStep {
    order: number;
    move: DerivationMove;
    premises: DerivationItem[];
    conclusion: DerivationItem;
    cost: number;
    /** The `order`s of the steps that produced this one's premises — the EXACT
     *  data-flow edges of the proof tree (a `bridge` names the `ground` whose
     *  `out` it crossed and the earlier `cover` it extended).  A premise that is
     *  an axiom (a seed leaf/form/computed result, never a rule conclusion) has no
     *  producer and contributes no edge, so this lists only the derived premises —
     *  the finest dependency structure the inference holds. */
    producers: number[];
}
/** A premise or conclusion of a {@link DerivationStep}, flattened from a {@link
 *  GItem} into the fields a rationale cares about. */
export interface DerivationItem {
    kind: "cover" | "form" | "out";
    /** `[i, j)` span for a form/out; for a cover item, `[p, p]`. */
    span: [number, number];
    /** The bytes an `out` carries (the only item kind that holds output bytes). */
    bytes?: Uint8Array;
    /** The graph node a form/out resolves to, when known. */
    node?: number;
}
/** The reasoning act a derivation rule performs — the human name for which of
 *  {@link GraphSearch}'s rules fired, recovered from the rule's premise/
 *  conclusion shape (the rules carry no label, so this classifies by structure,
 *  the single place that maps rule geometry to a name). */
export type DerivationMove = "axiom" | "follow-edge" | "concept-hop" | "voice" | "ground" | "splice-connector" | "split" | "fuse" | "recompose" | "bridge" | "pool-vote" | "step";
/** The lightest-derivation search over the Sema graph.  One instance binds the
 *  store, `maxGroup` (the fusible span ceiling), and the canonical
 *  {@link resolve} callback; {@link cover} then solves one query. */
export declare class GraphSearch {
    private readonly store;
    private readonly maxGroup;
    /** The host whose capabilities the search consults: resolve (canonical node
     *  id of a byte span), recogniseSpan (content-addressed graph lookup for
     *  recursive completion), and chooseNext (distributional-evidence edge
     *  disambiguation when a recognised form has multiple continuations). */
    private readonly host;
    constructor(store: Store, maxGroup: number, 
    /** The host whose capabilities the search consults: resolve (canonical node
     *  id of a byte span), recogniseSpan (content-addressed graph lookup for
     *  recursive completion), and chooseNext (distributional-evidence edge
     *  disambiguation when a recognised form has multiple continuations). */
    host: GraphSearchHost);
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
    cover(queryLen: number, sites: ReadonlyArray<Site>, conceptTarget: ReadonlyMap<number, number>, leaves: ReadonlyArray<Leaf>, splits: ReadonlySet<number>, substitutions?: ReadonlyMap<number, Uint8Array>, connectors?: ReadonlyMap<string, Uint8Array>, computedResults?: ReadonlyArray<ComputedResult>, 
    /** When given, receives the lightest derivation's rule applications — the
     *  full adapted A*LD proof tree as classified {@link DerivationStep}s — for the TOP
     *  cover only (a recursive recompletion solves its own sub-cover and is not
     *  reported here, to keep the trace one layer per think).  Off by default,
     *  so the search pays nothing when no one inspects. */
    onDerivation?: (steps: DerivationStep[]) => void): {
        segs: Seg[];
        cost: number;
    } | null;
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
    private solve;
    /** The weighted deduction system the graph exploration solves (the four
     *  reductions of adapted A*LD live in {@link lightestDerivation}; this only states the
     *  items, axioms, goal, and rules — see {@link GItem} for the item kinds).
     *
     *  Forms that span across leaves are discovered BY the rules, which fuse
     *  adjacent fragments toward a known leaf (findLeaf) or branch (findBranch);
     *  a completion fused with its neighbour may spell a deeper learned form the
     *  flat probes can't name, recovered canonically by {@link resolve}. */
    private buildSearch;
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
    private coverRules;
    /** The BRIDGE rule, built once for its two arrival orders (cover-first in
     *  {@link coverRules}, out-first in {@link outRules}): ε for a recognised
     *  completion; PASS per byte for a literal connective — kept in the cover
     *  so the asker's own connector survives where it fits.  ONE definition of
     *  the cost expression, so the ladder's application cannot drift between
     *  the two sides. */
    private bridgeRule;
    /** The connector-SPLICE rule for an oriented (l, r) pair, or null when the
     *  pair does not qualify — the ONE body behind {@link outRules}' two
     *  mirror loops (this-as-left over resolved right partners, this-as-right
     *  over resolved left partners).  Fires only when both sides are
     *  recognised, r starts at or after l ends, and the gap between them is
     *  empty or wholly recognised — never across the asker's own literal
     *  separator. */
    private trySplice;
    /** form(i,j,node,via): follow the graph out of `node`, or (in articulation)
     *  emit its substitute voice directly. */
    private formRules;
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
    private recompleteNode;
    /** Per-cover memo of each produced node's completion (so the many terminal
     *  outs of a long query re-cover each distinct node at most once); reset at the
     *  top of {@link cover}. */
    private recompleteMemo;
    /** The nodes currently being re-completed — the recursion stack.  A node in
     *  this set is not re-entered, so a cyclic recomposition terminates naturally
     *  (the same cycle guard {@link completeForward} uses), with no depth cap. */
    private recompleteOpen;
    /** out(i,j,bytes,…): index it for the binary rules, then offer splicing a
     *  learnt connector (the in-search bridge), splitting (at a sub-leaf form
     *  boundary), bridging (cover(i) ∧ this → cover(j)), and fusing with an
     *  adjacent finalised out. */
    private outRules;
    /** Whether the query span [from, to) is wholly covered by RECOGNISED outs —
     *  the test that lets a connector jump across INTERIOR answers (an N-ary whole)
     *  but never across the asker's own unrecognised framing (a space or comma the
     *  asker wrote between parts).  Empty span (from === to, the adjacent case) is
     *  trivially recognised.  Otherwise step right-to-left: from `to`, find a
     *  recognised out ending there and continue from its start, until reaching
     *  `from`.  Greedy-longest is sufficient here — the spans in play are the few
     *  recognised answers of one query, not a general interval cover. */
    private gapRecognised;
    /** Fuse two adjacent finalised outs — the search's own discovery of forms
     *  that cross leaf boundaries.  The concatenation may be a known leaf
     *  (findLeaf, when short enough), or — when both sides resolved — their pair a
     *  known branch (findBranch); a completion fused with its neighbour may spell
     *  a deeper learned form, recovered canonically by {@link resolve} (gated on a
     *  completion being present, so it only runs along chains).  The fused span
     *  lives on as an intermediate out while it could still grow into a form, and
     *  enters the graph as a form the moment it names a node. */
    private fuse;
}
