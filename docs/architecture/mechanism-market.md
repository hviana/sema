# Mechanism Market — Many Ways of Thinking, One Price

> **Law:** every grounding mechanism, including the ALU and user extensions,
> speaks one interface (`mind/pipeline-mechanism.ts`). The decider (`think`,
> `mind/pipeline.ts`) weighs every candidate in one currency and never asks
> which mechanism produced it.

A question can be answered in several ways that are not interchangeable: compose
it, carry structure between woven forms, intersect conditions, read a frame,
voice a slot, recall the nearest form, complete a beginning, or compute. Sema
keeps all of them and lets the evidence choose.

## The interface

```ts
interface PipelineMechanism {
  parse?(query): Promise<ComputedSpan[]>; // authoritative spans, collected before any floor
  floor(ctx, query, pre, worthRunning): Promise<number | null>; // admissible bound, or null
  run(ctx, query, pre): Promise<MechanismResult[]>;
}
interface MechanismResult {
  bytes;
  accounted: Array<[number, number]>; // spans of the query explained
  moves: number; // work done, on the cost ladder
  used?;
  scaffolding?;
  provenance?;
  complete?;
}
```

`floor` returns `null` when the mechanism cannot apply. Otherwise it returns a
lower bound that never overstates the cost.

## The decider

The default order is
`cover, cast, confluence, extraction, reference, recall,
prefix-completion`,
then the ALU (`aluToMechanism`), then extensions. A mechanism reports what it
did, never a price. The decider prices it in one place (`cost-model.md`):

```
weight = moves + PASS · unaccountedBytes      grade = ⌊weight / STEP⌋
```

The lowest grade wins. At equal grade, fewer `scaffolding` bytes win, then the
earlier mechanism in the declared order.

## Four constraints

1. **Decoupled.** No mechanism imports another or asks what already decided.
   Adding one touches no other.
2. **Declared competence.** A mechanism abstains through binary structural gates
   (query length, anchor shape, whether a weave exists), never through a learned
   score, and the rationale says why it abstained.
3. **Visible budget.** Every loop at corpus scale is capped by a named bound:
   `hubBound`, or `Precomputed.k = 2·recallQueryK` (`bounded-reads.md`).
4. **Evidence travels.** A candidate carries:
   - `accounted` and `moves`;
   - optionally `scaffolding`, the answer bytes lifted from unrecognised spans,
     which only breaks ties;
   - `complete`, a continuation reached by identity, which nothing after
     grounding may extend;
   - `used`, the anchors it speaks for;
   - `provenance`.

   The decider honours all of these without knowing who set them.

## Two disciplines

**Never compute what cannot change the decision.** `floor` runs for every
mechanism before any `run`, and a mechanism runs only if
`worthRunning(floor) = best === null || grade(floor) < grade(best)`. Every
`floor` that would first touch an expensive shared analysis (`attention()`,
`weave()`, `resonance()`) asks `worthRunning` first, and returns its uninvested
bound if it would lose. `cast.ts` and `extraction.ts` are the references.

**Look at a cheaper bound first.** Before a mechanism first touches anything,
every later mechanism whose floor grade is strictly lower runs ahead of it,
cheapest first. The lowest grade they reach becomes a bound, and any mechanism
floored above that bound is skipped (`meter.mechanismsBounded`). The decision
stays the declared order's:

- every candidate above the bound loses to the winner;
- every mechanism at or below the bound meets the same decision it would have
  met in order;
- equal floors are never skipped.

A result run ahead is the declared order's only if it saw what the declared
order would have shown it. A mechanism run ahead of the consensus climb reads
the question without the climb's points, so other instances of the question
cannot yet name its pick (`evidence.md`), and its result is priced as if the
question had not named it. When the climb has since run and other instances
carry a relation (`readsOffInstances`), the mechanism is run again at its
declared turn (`mechanismReruns`). On the 2Wiki fixture, recall's
`The place of
birth of John Lennon is Liverpool.` owed 49 bytes ahead of the
climb and 28 after it. Rerunning whenever the climb has run costs 26% more bytes
read on the 31.7M-node store and changes no answer, so the rerun waits for that
evidence.

This is never extra work. On the 31.7M-node store a grade-1 recall run ahead of
CAST's climb answers a lowercased Persian turn in 1.2 s, against 18.0 s in the
declared order.

## Accounting rules

- **Extraction.** Located frames are evidence. The span between two frames
  counts only when both borders were located, and an open-ended read is priced
  by exclusion.
- **Reverse reading.** `reverseContext` produces bytes but explains nothing
  forward, so `accounted = []`. It is the last resort by arithmetic, not by
  rule.
- **A paid act is accounted.** The bridge charges `CONCEPT` per substitution, so
  the substituted spans are `accounted`. Otherwise one act is charged twice, and
  `PASS` per byte decides against it.

## Pins

- `test/04` — the decider, end to end.
- `test/93` — the investment discipline: the climb runs exactly when
  `worthRunning(2·STEP)` holds, CAST being the cheapest mechanism to touch it.
- `test/153` — the run-ahead bound: a mechanism floored above it is skipped, the
  decision equals the declared-order oracle, and a mechanism run ahead of the
  climb is run again only when instances name its pick.
