// rationale.ts — the inference, told as it happens.
//
// Sema's edge over a weight matrix is that every answer is a DERIVATION over
// explicit facts, not a sample from an opaque distribution.  This module turns
// that derivation into a stream a human (or a debugger) can read: as {@link
// Mind.respond} thinks, each inference MECHANISM it runs emits a {@link
// RationaleStep} the moment it completes — what it was handed, what it produced,
// where it sits in the nesting of mechanisms, and which earlier steps fed it.
//
// Nothing here drives the inference; it only WITNESSES it.  When no
// `inspectRationale` callback is supplied the tracer is never constructed and
// the cost is exactly zero — every emit site in src/mind/mind.ts is guarded by `?.`, and
// optional-chaining short-circuits its arguments, so the items are not even
// built (see {@link Mind.respond}).
//
// The shape of a step mirrors how Sema reasons.  A mechanism is rarely a 1→1
// map: {@link Mind.recognise} DECOMPOSES one query into many recognised forms;
// the cover COMBINES many forms back into one answer; resonance fans one gist
// out into a ranked list of hits.  So a step's `inputs` and `outputs` are each a
// VECTOR — an ordered list of {@link RationaleItem}s, one per element — and the
// fan-out / fan-in is visible in their lengths.
/** Decode bytes to text for display, dropping the NUL padding the encoder uses
 *  (the same cleanup {@link Mind.respondText} does for its result). */
export function decodeText(bytes) {
  return new TextDecoder().decode(bytes.filter((b) => b !== 0x00));
}
/** The `[start, end)` gaps of `[0, queryLen)` NOT covered by `accounted` —
 *  the same union-of-spans reading think's grounding decider prices at PASS
 *  per byte, exposed here so a mechanism can turn it into a human label. */
export function unexplainedSpans(queryLen, accounted) {
  const sorted = accounted
    .map(([s, e]) => [Math.max(0, s), Math.min(queryLen, e)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let reach = 0;
  for (const [s, e] of sorted) {
    if (s > reach) {
      gaps.push([reach, s]);
    }
    if (e > reach) {
      reach = e;
    }
  }
  if (reach < queryLen) {
    gaps.push([reach, queryLen]);
  }
  return gaps;
}
/** A human-readable label for the query bytes a mechanism's `accounted`
 *  spans leave unexplained — purely diagnostic (Task 2's negative evidence):
 *  it never changes a candidate's weight, only what the rationale trace
 *  says the mechanism left on the table. `""` when nothing is unexplained. */
export function unexplainedLabel(query, accounted) {
  const gaps = unexplainedSpans(query.length, accounted);
  if (gaps.length === 0) {
    return "";
  }
  return gaps.map(([s, e]) => decodeText(query.subarray(s, e))).join(" … ");
}
/** The live tracer: a stack of open mechanisms over one {@link Mind.respond}.
 *
 *  Sema's inference is single-threaded and strictly sequential — every async
 *  step is awaited before the next begins, and `respond` holds no two thoughts
 *  at once — so a plain stack exactly tracks the current nesting: {@link enter}
 *  pushes, {@link Scope.done} pops, and {@link step} (a mechanism with no
 *  sub-steps) is the two fused.  The tracer never branches the control flow; it
 *  only records it. */
export class Rationale {
  sink;
  next = 0;
  /** Open mechanisms, outermost first.  Each frame remembers the last child it
   *  has spawned so the next sibling can default its data-flow edge to it. */
  stack = [];
  /** The most recent step index emitted under each mechanism name — the handle
   *  a later step uses to name an EARLIER mechanism as its data-flow producer
   *  (e.g. cover depends on the latest recognise / computeExtensions).  One tracer is
   *  built per response and inference is sequential, so "most recent" is exactly
   *  "the one that produced the inputs I am about to consume". */
  lastByName = new Map();
  constructor(sink) {
    this.sink = sink;
  }
  /** The index of the most recent step with this mechanism name, or undefined if
   *  none has run.  Used to wire an explicit producer edge into {@link
   *  Scope.done} / {@link step}'s `deps`. */
  lastIndex(name) {
    return this.lastByName.get(name);
  }
  /** The mechanism names currently open, outermost → innermost. */
  path(leaf) {
    const p = this.stack.map((f) => f.name);
    p.push(leaf);
    return p;
  }
  /** The default data-flow edge for a step entering now: the previous sibling
   *  inside the current mechanism, else the enclosing mechanism, else nothing
   *  (the root).  An explicit `deps` overrides this. */
  defaultDeps() {
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      return [];
    }
    return [top.lastChild ?? top.index];
  }
  /** Reserve this step's index and register it as the current mechanism's most
   *  recent child (so the NEXT sibling chains to it) and as the most recent step
   *  of its own NAME (so a later mechanism can name it as a producer). */
  reserve(name) {
    const index = this.next++;
    const top = this.stack[this.stack.length - 1];
    if (top) {
      top.lastChild = index;
    }
    this.lastByName.set(name, index);
    return index;
  }
  emit(index, mechanism, inputs, outputs, deps, note) {
    this.sink({
      index,
      mechanism,
      parent: this.stack.length > 0
        ? this.stack[this.stack.length - 1].index
        : -1,
      dependsOn: deps ?? this.defaultDeps(),
      inputs,
      outputs,
      note,
    });
  }
  /** Enter a mechanism that has sub-steps.  Captures its inputs and the nesting
   *  now; the matching {@link Scope.done} supplies the outputs when it finishes.
   *  `deps` overrides the default data-flow edge (previous sibling / parent). */
  enter(name, inputs, deps) {
    const mechanism = this.path(name);
    const resolvedDeps = deps ?? this.defaultDeps();
    const index = this.reserve(name);
    this.stack.push({ index, name, lastChild: null });
    let closed = false;
    const emit = this.emit.bind(this);
    const pop = () => {
      // Pop down to and including this frame — tolerant of a sub-mechanism that
      // forgot to close, so one missed `done` cannot desync the whole stack.
      const at = this.stack.findIndex((f) => f.index === index);
      if (at >= 0) {
        this.stack.length = at;
      }
    };
    return {
      index,
      done: (outputs, note) => {
        if (closed) {
          return;
        }
        closed = true;
        pop();
        emit(index, mechanism, inputs, outputs, resolvedDeps, note);
      },
    };
  }
  /** Record a mechanism that has no sub-steps — its inputs and outputs are both
   *  known at the call site.  Returns its index, for a later step to depend on. */
  step(name, inputs, outputs, note, deps) {
    const mechanism = this.path(name);
    const resolvedDeps = deps ?? this.defaultDeps();
    const index = this.reserve(name);
    this.emit(index, mechanism, inputs, outputs, resolvedDeps, note);
    return index;
  }
}
