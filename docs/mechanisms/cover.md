# Cover — Compose the Question From What It Contains

`cover` answers by graph search. Its axioms are the question's own recognised
sites, and its goal is the lightest derivation that covers the question's bytes
and follows their continuations (`src/mind/mechanisms/cover.ts`, `GraphSearch`).
It runs first: a cover backed by a computation becomes an incumbent near zero
cost, and prunes the rest of the market through the ordinary floor check
(`mechanism-market.md`).

## Matcher — recognition sites

Sites are the spans of the question that name a stored form (`recognition.ts`),
and the climb's points it holds under the equivalence (`Man At Bath` for a
stored `Man at Bath`; `canonHeldPoints`), which the cover declares it reads
(`readsPoints`, `mechanism-market.md`). A span named only under the equivalence
stands where its member does (`role.ts`): `father` is no film `Father`.

## Gates

- **The site must lead somewhere.** It has a continuation or a halo
  (`leadsSomewhere`).
- **A site needs to be asked.** A site that answers other questions (a
  fragment, a subject of several questions, a form asked a relation it lacks:
  `answersOtherQuestions`, `evidence.md`) is dropped unless the question names
  one of its continuations. Otherwise the cover accounts its bytes as explained
  by a stranger's answer (`unaskedFragments`).
- **Scaffolding accounts for nothing.** A span made only of hub windows
  (`scaffoldSpans`) is not accounted (`evidence.md`).

## Projection

- **Continuation edges.** `formRules` follow continuation edges at `STEP` per
  hop, forking over continuations up to the hub bound. The continuation chosen
  is `guidedFirst`'s: first one the question names, then distributional support,
  then the first inserted (`determinism.md`).
- **Concept hops.** A form with no edge of its own may borrow a halo sibling's
  continuation, at `CONCEPT`.
- **Dominance.** A span's cheapest completion dominates the rest, so a hub's
  degree generates no work in the chart (`cost-model.md`).

## Premises resolved where the search reaches them

The synchronous search cannot run the async reads two of its rules need (a
concept target's halo lookup, a connector's `bridge`), so `offerConcepts` and
`offerConnectors` offer the keys up front, and the search asks for one only when
it reaches it: a connector when a splice's premises meet, a concept target when
its asking form is popped. A cover that asked is provisional: `cover.run` grants
the asked keys and covers again until a cover asks for nothing, the cover that
resolving every key in advance would produce. Joins licensed by rounds that
asked for nothing are kept across re-covers.

## What the answer voices

- **The product does not voice the ask**: around a dominating form, a
  window-long edge run of scaffolding is the ask (`Why did … 's wife die?`), and
  the answer is the form's replacement alone; shorter runs are glue (`2+2.` →
  `4.`).
- **What the question already says is no answer**: a chosen span whose followed
  bytes the question holds elsewhere (a prior turn's continuation, said later in
  the same question) is trimmed and not accounted, and the other spans stay
  (`segRestatesQuery`).
- **Evidence travels**: the spans that named a followed site's step are
  accounted (`askedEvidence`).
- **`used` is declared**, the facts composed, never inferred (`John II` is not
  the question's `John III`).
- **A chain's intermediate is not voiced**: a fact voicing another composed
  fact's subject is a step toward it, and none is voiced twice. A comparison's
  two facts both stay.

## Provenance

`cover`, including fusion and recomposition steps that name a deeper learnt
form. `join` belongs to `confluence`, not to `cover`.

## Pins

- `test/09` — edge following and hop semantics.
- `test/22` — a partial result is the pivot into the next fact.
- `test/45` — a restated span is trimmed; the other spans stay.
- `test/151` — connectors and concept hops resolved where the search reaches
  them; dominance.
- `test/154` — an unasked fragment voices nothing; a site held only under the
  equivalence binds, from any climb point (`test/154.8`, `test/154.12`).
