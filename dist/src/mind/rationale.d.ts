import type { Vec } from "../vec.js";
/** One element of a step's input or output vector.
 *
 *  Modality-neutral and deliberately partial: an element might be a byte span of
 *  the query, a resolved graph node, a resonance hit with its score, a spliced
 *  connector — so every descriptive field is optional and a mechanism fills only
 *  the ones that carry meaning for what it did.  `text` is always present (the
 *  human-readable rendering); the rest is provenance a debugger can lean on. */
export interface RationaleItem {
    /** Human-readable rendering — decoded text for a byte span, else a label like
     *  "‹none›" or an operator name.  Always set, so a step always reads. */
    text: string;
    /** The graph node this element is, or resolved to, when known — the handle to
     *  point back at the exact stored fact in the content-addressed DAG. */
    node?: number;
    /** The `[start, end)` span this element occupies in its step's frame of
     *  reference (usually the query or the answer being composed). */
    span?: [number, number];
    /** The resonance / cosine score that selected this element, when it was chosen
     *  by similarity rather than by exact structure. */
    score?: number;
    /** A short role tag — "query", "leaf", "form", "hit", "connector", "answer",
     *  … — naming what KIND of element this is within the step. */
    role?: string;
    /** The gist vector, only when the element fundamentally IS a vector and a
     *  caller asked to carry it (off by default — a D-float array per item would
     *  bury the reasoning it is meant to explain). */
    v?: Vec;
}
/** A single completed act of inference — one mechanism, run once.
 *
 *  Steps are emitted in COMPLETION order (a sub-mechanism finishes, and is
 *  reported, before the mechanism that called it), while `index` is assigned in
 *  ENTRY order (a parent reserves its index before its children run).  So a
 *  parent's `index` is always lower than its children's, and the two orderings
 *  together give a valid topological reading of the dependency graph. */
export interface RationaleStep {
    /** This step's index, assigned when the mechanism was ENTERED — a strict,
     *  incremental ordering over the whole inference. */
    index: number;
    /** The mechanism and its enclosing mechanisms, outermost → innermost, e.g.
     *  `["respond", "think", "recognise"]`.  The last entry is this step; the
     *  prefix is the nest of sub-mechanisms it ran inside. */
    mechanism: string[];
    /** The enclosing mechanism's step index, or -1 at the root — the NESTING edge
     *  of the dependency graph (which step this one is a part of). */
    parent: number;
    /** The earlier steps whose OUTPUTS became this step's inputs — the DATA-FLOW
     *  edges of the dependency graph.  Defaults to the previous sibling (the step
     *  run just before this one inside the same mechanism), or the parent when
     *  this is the first sub-step; a mechanism that fuses several earlier results
     *  names them all explicitly. */
    dependsOn: number[];
    /** The vector of elements handed to the mechanism (one or more). */
    inputs: RationaleItem[];
    /** The vector of elements the mechanism produced (one or more) — longer than
     *  `inputs` when it decomposed, shorter when it combined. */
    outputs: RationaleItem[];
    /** A one-line, human account of what the mechanism did and why — the sentence
     *  that turns the data into an explanation. */
    note?: string;
}
/** The callback {@link Mind.respond} / {@link Mind.respondText} accept.  It is
 *  invoked once per completed step, AS the inference unfolds — never batched at
 *  the end — so a caller can stream the reasoning live or accumulate it. */
export type InspectRationale = (step: RationaleStep) => void;
/** Decode bytes to text for display, dropping the NUL padding the encoder uses
 *  (the same cleanup {@link Mind.respondText} does for its result). */
export declare function decodeText(bytes: Uint8Array): string;
/** The `[start, end)` gaps of `[0, queryLen)` NOT covered by `accounted` —
 *  the same union-of-spans reading think's grounding decider prices at PASS
 *  per byte, exposed here so a mechanism can turn it into a human label. */
export declare function unexplainedSpans(queryLen: number, accounted: ReadonlyArray<[number, number]>): Array<[number, number]>;
/** A human-readable label for the query bytes a mechanism's `accounted`
 *  spans leave unexplained — purely diagnostic (Task 2's negative evidence):
 *  it never changes a candidate's weight, only what the rationale trace
 *  says the mechanism left on the table. `""` when nothing is unexplained. */
export declare function unexplainedLabel(query: Uint8Array, accounted: ReadonlyArray<[number, number]>): string;
/** An open mechanism — the handle {@link Rationale.enter} returns.  Hold it for
 *  the duration of the mechanism and call {@link Scope.done} with the outputs
 *  when it finishes; that emits the step and pops the nesting. */
export interface Scope {
    /** The step index reserved for this mechanism at entry — pass it as an
     *  explicit dependency of a later step that consumes this one's output. */
    readonly index: number;
    /** Close the mechanism: emit its step with these outputs and pop it off the
     *  nesting stack.  Idempotent — a second call is ignored, so a `finally` that
     *  closes after an early return is safe. */
    done(outputs: RationaleItem[], note?: string): void;
}
/** The live tracer: a stack of open mechanisms over one {@link Mind.respond}.
 *
 *  Sema's inference is single-threaded and strictly sequential — every async
 *  step is awaited before the next begins, and `respond` holds no two thoughts
 *  at once — so a plain stack exactly tracks the current nesting: {@link enter}
 *  pushes, {@link Scope.done} pops, and {@link step} (a mechanism with no
 *  sub-steps) is the two fused.  The tracer never branches the control flow; it
 *  only records it. */
export declare class Rationale {
    private readonly sink;
    private next;
    /** Open mechanisms, outermost first.  Each frame remembers the last child it
     *  has spawned so the next sibling can default its data-flow edge to it. */
    private readonly stack;
    /** The most recent step index emitted under each mechanism name — the handle
     *  a later step uses to name an EARLIER mechanism as its data-flow producer
     *  (e.g. cover depends on the latest recognise / computeExtensions).  One tracer is
     *  built per response and inference is sequential, so "most recent" is exactly
     *  "the one that produced the inputs I am about to consume". */
    private readonly lastByName;
    constructor(sink: InspectRationale);
    /** The index of the most recent step with this mechanism name, or undefined if
     *  none has run.  Used to wire an explicit producer edge into {@link
     *  Scope.done} / {@link step}'s `deps`. */
    lastIndex(name: string): number | undefined;
    /** The mechanism names currently open, outermost → innermost. */
    private path;
    /** The default data-flow edge for a step entering now: the previous sibling
     *  inside the current mechanism, else the enclosing mechanism, else nothing
     *  (the root).  An explicit `deps` overrides this. */
    private defaultDeps;
    /** Reserve this step's index and register it as the current mechanism's most
     *  recent child (so the NEXT sibling chains to it) and as the most recent step
     *  of its own NAME (so a later mechanism can name it as a producer). */
    private reserve;
    private emit;
    /** Enter a mechanism that has sub-steps.  Captures its inputs and the nesting
     *  now; the matching {@link Scope.done} supplies the outputs when it finishes.
     *  `deps` overrides the default data-flow edge (previous sibling / parent). */
    enter(name: string, inputs: RationaleItem[], deps?: number[]): Scope;
    /** Record a mechanism that has no sub-steps — its inputs and outputs are both
     *  known at the call site.  Returns its index, for a later step to depend on. */
    step(name: string, inputs: RationaleItem[], outputs: RationaleItem[], note?: string, deps?: number[]): number;
}
