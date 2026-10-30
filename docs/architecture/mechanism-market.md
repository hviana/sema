# Mechanism Market — Many Ways of Thinking, One Price

> **Law — universal inference isonomy:** every piece of inference logic — the
> decider's, the composition's, the reasoning after grounding, and any added
> later — applies alike to every mechanism, Sema's own, the ALU or a caller's,
> and reads only what a candidate declares, never which mechanism produced it.
> Every mechanism joins through one factory and speaks one interface
> (`mind/pipeline-mechanism.ts`); the decider (`think`, `mind/pipeline.ts`)
> weighs every candidate in one currency.

A path, a precedence or a rule that one mechanism alone reaches, enjoys or is
named in breaks the law, whatever logic holds it. Instances it refused: the
ALU's own `parse` path and its "computation always wins" masking, a further
topic answered by one procedure instead of the market, a regime read off one
mechanism's floor (`test/18`, `test/160`, `test/93`).

A question can be answered in several ways that are not interchangeable: compose
it, carry structure between woven forms, intersect conditions, read a frame,
voice a slot, recall the nearest form, complete a beginning, or compute. Sema
keeps all of them and lets the evidence choose.

## The interface

```ts
interface PipelineMechanism {
  name;
  provenance;
  floor(ctx, query, pre, worthRunning): Promise<number | null>; // admissible bound, or null
  run(ctx, query, pre): Promise<MechanismResult[]>;
  readsPoints?(ctx, query, pre): boolean; // what a rerun would read off the climb's points
}
interface MechanismResult {
  bytes;
  accounted: Array<[number, number]>; // spans of the query explained
  moves: number; // work done, on the cost ladder
  used?;
  scaffolding?;
  provenance?;
  complete?;
  piece?; // the answer is a function of its one accounted stretch alone
}
```

`floor` returns `null` when the mechanism cannot apply. Otherwise it returns a
lower bound that never overstates the cost.

## The decider

Every mechanism is a factory handed the mind's port (`ExtensionHost`). The
default registration (`defaultMechanisms`, `src/mechanisms.ts`) is
`cover, cast, confluence, extraction, reference, recall, prefix-completion, alu`;
a caller appends its own (`[...defaultMechanisms, mine]`). A mechanism reports what it
did, never a price. The decider prices it in one place (`cost-model.md`):

```
weight = moves + PASS · unaccounted    grade = ⌊weight / STEP⌋
```

The lowest grade wins. At equal grade, fewer `scaffolding` bytes win, then the
earlier mechanism in the declared order.

**Pieces combine.** A candidate whose answer is a function of its one accounted
stretch alone declares it a `piece`. When the incumbent leaves bytes unexplained
that a piece explains, the decider composes the question again
(`composition.ts`): its recognised sites and every piece enter the one
lightest-derivation search, where a piece is fused, followed, spliced, joined or
recomposed as a learnt form is, at the moves it took. The composition is one
more candidate (`compose`): `ice 2+2` → `cold 4`. An answer read off the whole
question is no piece of it (`test/160`).

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
   - `piece`, an answer of its one stretch alone, which composes;
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

A result read before the consensus climb (run ahead, or the cover's, first in
order) did not see the climb's points, so other instances of the question could
not name its pick (`evidence.md`). Once a mechanism has run the climb, such a
result is read again (`mechanismReruns`) only when the reading would differ:
instances carry a relation (`readsOffInstances`), or the mechanism declares what
else it reads off the points (`readsPoints`: the cover admits a site the
question holds under its equivalence, `Man At Bath`, or a subject of several
questions the use may name, `evidence.md`). Recall's
`The place of birth of John Lennon is Liverpool.` owes 49 bytes before the climb
and 28 after it. Rerunning on every climb costs 26% more bytes read on the
31.7M-node store, and on every such point it reran the cover and recall on 52 of
100 2Wiki questions. Neither changed an answer.

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
- `test/153` — the run-ahead bound skips, the decision is the declared order's,
  and a result read before the climb is read again when instances name its pick.
