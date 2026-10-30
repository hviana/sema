# Mechanism Market — Many Ways of Thinking, One Price

> **Law — universal inference isonomy:** every inference logic, present or
> future, applies alike to every mechanism (Sema's, the ALU, a caller's) and
> reads only what a candidate declares, never who produced it. All join through
> one factory and one interface (`mind/pipeline-mechanism.ts`); the decider
> (`think`, `mind/pipeline.ts`) weighs them in one currency. Refused: the ALU's
> `parse` path and masking, a topic answered by one procedure, a regime read off
> one floor.

A question can be answered in several ways that are not interchangeable: compose
it, carry structure between woven forms, intersect conditions, read a frame,
voice a slot, recall the nearest form, complete a beginning, or compute. Sema
keeps all of them and lets the evidence choose.

## The interface

```ts
interface PipelineMechanism {
  name; provenance;
  floor(ctx, query, pre, worthRunning): Promise<number | null>; // a bound never above the cost, or null: cannot apply
  run(ctx, query, pre): Promise<MechanismResult[]>;
  readsPoints?(ctx, query, pre): boolean; // what a rerun would read off the climb's points
}
interface MechanismResult {
  bytes;
  accounted: Array<[number, number]>; // spans of the query explained
  moves: number; // work done, on the cost ladder
  used?; scaffolding?; complete?; provenance?;
  piece?; // an answer of its one accounted stretch alone
}
```

## The decider

Every mechanism is a factory handed the mind's port (`ExtensionHost`).
`defaultMechanisms` (`src/mechanisms.ts`) registers
`cover, cast, confluence, extraction, reference, recall, prefix-completion, alu`;
a caller appends its own (`[...defaultMechanisms, mine]`). A mechanism reports
what it did; the decider prices it in one place (`cost-model.md`):

```
weight = moves + PASS · unaccounted    grade = ⌊weight / STEP⌋
```

The lowest grade wins. At equal grade, fewer `scaffolding` bytes win, then the
earlier mechanism in the declared order.

**Pieces combine.** When the incumbent leaves bytes unexplained that a `piece`
explains, the decider composes the question again (`composition.ts`, one more
candidate `compose`): sites and pieces enter one lightest-derivation search, a
piece used as a learnt form is: `ice 2+2` → `cold 4`.

## Four constraints

1. **Decoupled.** No mechanism imports another or asks what already decided.
   Adding one touches no other.
2. **Declared competence.** A mechanism abstains through binary structural gates
   (query length, anchor shape, whether a weave exists), never a learned score,
   and the rationale says why.
3. **Visible budget.** Every loop at corpus scale is capped by a named bound:
   `hubBound`, or `Precomputed.k = 2·recallQueryK` (`bounded-reads.md`).
4. **Evidence travels.** A candidate carries `accounted` and `moves`, and
   optionally `scaffolding` (answer bytes lifted from unrecognised spans; only
   breaks ties), `complete` (a continuation reached by identity, which
   nothing after grounding may extend), `used` (the anchors it speaks for),
   `piece` (which composes) and `provenance`, honoured whoever set them.

## Two disciplines

**Never compute what cannot change the decision.** Every `floor` runs before
any `run`, and a mechanism runs only if
`worthRunning(floor) = best === null || grade(floor) < grade(best)`. A `floor`
that would first touch an expensive shared analysis (`attention()`, `weave()`,
`resonance()`) asks `worthRunning` first, and returns its uninvested bound if it
would lose (`cast.ts` and `extraction.ts` are the references).

**Look at a cheaper bound first.** Before a mechanism touches anything, every
later one with a strictly lower floor grade runs ahead, cheapest first;
the lowest grade they reach skips every mechanism floored above it
(`meter.mechanismsBounded`). The decision stays the declared order's: candidates
above the bound lose to the winner, mechanisms at or below it meet the decision
they would in order, and equal floors are never skipped. Never extra work: on
the 31.7M-node store a grade-1 recall run ahead of CAST's climb answers a
lowercased Persian turn in 1.2 s, not 18.0 s.

A result read before the consensus climb (run ahead, or the cover's) missed
its points, so other instances of the question could not name its pick
(`evidence.md`). Once the climb ran, it is read again (`mechanismReruns`) only
where the reading would differ: instances carry a relation
(`readsOffInstances`), or the mechanism declares what it reads off the points
(`readsPoints`: the cover admits a site held under its equivalence,
`Man At Bath`, or a subject of several questions). Recall's
`The place of birth of John Lennon is Liverpool.` owes 49 bytes before the climb,
28 after. Rerunning on every climb read 26% more bytes on the 31.7M-node store
(cover and recall rerun on 52 of 100 2Wiki questions), changing no answer.

## Accounting rules

- **Extraction.** Located frames are evidence. The span between two frames
  counts only when both borders were located; an open-ended read is priced by
  exclusion.
- **Reverse reading.** `reverseContext` explains nothing forward
  (`accounted = []`): the last resort by arithmetic, not by rule.
- **A paid act is accounted.** The bridge charges `CONCEPT` per substitution, so
  the substituted spans are `accounted`; else one act is charged twice.

## Pins

- `test/04` — the decider, end to end.
- `test/93` — the regime is read off the response: composition exactly when the
  market ran the climb.
- `test/153` — the run-ahead bound skips, the decision is the declared order's,
  and a result read before the climb is read again when instances name its pick.
- `test/18`, `test/160` — no mechanism privileged; pieces compose.
