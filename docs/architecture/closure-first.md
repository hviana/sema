# Closure first, short-circuits never

**This is a permanent rule of this project, written down because it was broken.**
It is not a suggestion and it does not expire with a session.

## The rule

A change to this engine must come from a **universal theory of closure** — one
law, stated once, from which every reach, depth, scope and offer **follows**.
Anything else is a patch, and patches here do not compose: they hide the real
problem until it returns as rework.

Concretely, forbidden as an answer to a correctness or cost problem:

1. **Scattered local fixes.** Four cut-offs in four layers, each tuned until its
   own test passes, is not a design. If a fix needs a new number somewhere, the
   theory is missing — find the law, not the number.
2. **Hardcoded numbers to make a test pass.** A constant chosen so a fixture
   goes green is a lie about the engine's behaviour, and the test it satisfies
   stops being evidence.
3. **"Derived" formulas that are fitted.** Moving a tuned constant into
   `geometry.ts` does not make it derived. A formula is derived only when its
   shape and its constants follow from the geometry's own quantities, and when
   changing the corpus, the window or the input length changes it correctly —
   never when it was reverse-engineered from a failing test.
4. **Short-circuits dressed as budgets.** A budget is an **accounting**: the work
   is charged in the one cost currency (`MICRO`/`STEP`/`CONCEPT`/`PASS`), the
   charge is visible in the rationale and the meter, and the search itself
   decides whether the work is worth paying. A cap that silently stops a
   computation early is a **short-circuit**: it changes what the engine can
   reach, hides that fact from the answer, and is exactly how a capability is
   lost without a single test failing.
5. **Hiding information.** A regression, a deferred finding, an adversarial
   reviewer's objection, a measurement that contradicts the story — all of it is
   reported **immediately and in full**, in the same round it is seen. Deferring
   an objection as "documented" is hiding it.

## The evidence this rule was written from

Measured on this repository, same fixture, same test, both trees green:

```
tree before the change                     67 776 ms ·  775 MB
tree after (my DIREÇÃO/E3 lots)            95 284 ms · 1073 MB   +40 % time, +38 % peak
```

The tests passed on **both** sides. The regression was invisible to the suite
and was only found by an A/B measurement the user had to demand five times. Its
cause was not a missing budget: it was a **duplicate computation** — a second
offset scan (`canonicalQueryNodes`) re-deriving, per byte offset, what the
response's own recognition had already resolved once and memoised. Removing the
duplication recovered all of it (`69 733 ms · 777 MB`) **without any constant,
cap or cutoff** — which is what a theory-shaped fix looks like.

Along the way the following were tried and must not be repeated:

- an "`exploreCap`" offer bound with an invented plurality floor — a
  short-circuit on what a hop may offer;
- `alignGapPairs: 4096`, a work budget picked by hand to keep one test near its
  old time, then "lowered" to 256 to see a number move — tuning, twice;
- `alignSweepPairs`, a "derived" formula written to satisfy a boundary the
  fixture happened to sit on: it *reduced* capability (a legitimate 24-byte slot
  stopped being reachable) and was reverted. Moving a number into `geometry.ts`
  did not make it a budget.

## What this means for the next change

State the closure law first — what it means for a derivation to be **closed**,
in terms of the structure the engine already has (bounds, reach, accounted
bytes, the ladder) — and then let the reach of an alignment gap, the offer of a
hop, the depth of a join and the scope of a substitution be **consequences** of
it. If a change cannot be expressed that way, it is not ready.
