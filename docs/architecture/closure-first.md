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

## The closure law

> **A derivation is closed for a query when the structure it built accounts for
> the query's remainder under the engine's own identity and admission rules, and
> every step pays for the bytes it leaves unaccounted in the one currency.**

Written in the quantities the engine already has, and checkable in the code:

| quantity | where | what it means |
| --- | --- | --- |
| `accounted` | pipeline.ts (candidate field) | the query spans the candidate's structural evidence touched |
| `unexplainedSpans(queryLen, spans)` | rationale.ts | the reading the rationale shows: what those spans leave |
| `weight = moves + PASS · unaccounted(accounted)` | pipeline.ts:255–261 | the price of a candidate; `PASS = 1000` (graph-search.ts:146) |
| `resolve` / `canonLeaf` / `canonResolve` | primitives.ts | identity: exact first, then canonical — this is what "accounts for" means |
| `leadsSomewhere` | traverse.ts | admission: an edge or a halo — the ONE predicate |
| `hubBound = √N` | traverse.ts:529 | the read cap |

The answer **is** a closure. A byte the structure does not account for is charged,
so the search itself prefers the closure that leaves less unexplained.

**The one mechanical requirement.** Work the accounting cannot see —
enumeration, scans, sweeps — must be **proportional to the bytes it is given**,
by choosing an algorithm whose cost is structural. Capping such work is not a
budget: it is a short-circuit, and it silently removes capability.

## Consequences — each one derived, none decided

1. **Scope of a substitution.** A substitution spans exactly the **unaccounted
   interval between two accounted anchors**; its extent is that interval's own,
   and its price is PASS per byte of it — already on the ladder. So an alignment
   gap needs **no cap at all**: a 24-byte slot is spanned when it is worth
   paying, and a longer one costs more, so the search decides. What the
   alignment's *sweep* needs is not a bound but a **structural algorithm**:
   walking outward from the anchors costs O(bytes), while enumerating
   `(gapQ, gapC)` pairs costs O(bytes²). The shape is the defect, not its cap.
   *(Open debt: `alignGapPairs`. `alignSweepPairs` was wrong precisely here — it
   bounded the enumeration instead of replacing it, and lost reach.)*
2. **Offer of a hop.** A hop offers **the continuations the corpus holds** — its
   structure — and the search pays for exploring each. A continuation that
   accounts for none of the remainder costs a move and buys nothing, so the
   search stops by price, not by a cap. *(Open debt: `exploreCap` with its
   invented `PLURALITY` floor is the short-circuit; the honest form charges the
   offer on the ladder, where the rationale shows what was paid.)*
3. **Depth of a join.** A join consumes the query's tail; a step that accounts
   for nothing is paid and loses, so the chain's length follows from the
   remainder shrinking. No "max hops", and no shortest-prefix rule invented for
   a fixture: the tail prefix that is the relation is the one the accounting
   rewards.
4. **Extension (pivot).** A hop is closed only if its step is charged for what it
   leaves of the remainder. A hop that ignores the question's material is
   expensive *by the ladder*, not filtered by a local window test.
5. **Produced parts.** A produced composite is decomposed by its own tree
   (`recompleteNode`), because that tree is the structure that accounts for its
   bytes — the form's own structure is the authority, and it decides what the
   bytes mean. This one has no performance cost: duplicating the recomputation
   was, and removing that duplication recovered a measured 27% of runtime with
   no constant, cap or cutoff (see the evidence above).
6. **Reads.** `hubBound = √N` bounds every read; the law adds that no per-query
   *work* grows with N either — which is why the work in 1–4 must be structural
   in the bytes, never in the corpus.

## How a change must be judged

- Name which consequence it is, and show the accounting that changes (meter and
  rationale), not just a passing fixture.
- No number may appear that is not a quoted existing quantity. A bound must be
  the *price* of something, visible in the rationale.
- If a change makes the engine **unable** to reach something it reached before,
  that must be said and proved to be required by the law. Losing reach silently
  is forbidden.
