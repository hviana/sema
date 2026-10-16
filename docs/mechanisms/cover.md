# Cover — Compose the Question From What It Contains

`cover` answers by graph search. Its axioms are the question's own recognised
sites, and its goal is the lightest derivation that covers the question's bytes
and follows their continuations (`src/mind/mechanisms/cover.ts`, `GraphSearch`).
It runs first: a cover backed by a computation becomes an incumbent near zero
cost, and prunes the rest of the market through the ordinary floor check
(`mechanism-market.md`).

## Matcher — recognition sites

Sites are the spans of the question that name a stored form (`recognition.ts`).
Any site overlapping a computed span is masked: computation always wins,
enforced by masking rather than by price (`cost-model.md`).

## Gates

- **The site must lead somewhere.** It has a continuation or a halo
  (`leadsSomewhere`).
- **A fragment needs to be asked.** A site that answers other questions
  (`answersOtherQuestions`: inside other forms, several continuations or one
  only inherited, a window of the question outside it) is dropped unless the
  question names one of its continuations. Otherwise the cover accounts the
  fragment's bytes as explained by a stranger's answer (`unaskedFragments`).
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

The synchronous search cannot run the async reads that two of its rules need: a
concept target, which is a halo lookup, and a learnt connector between two
answers, which is a `bridge`. So `offerConcepts` and `offerConnectors` offer the
keys up front. The search then asks for a key only when it reaches it: a
connector when a splice's two premises meet, and a concept target when the form
asking for it is popped.

A cover that asked is provisional. `cover.run` grants the asked keys and covers
again, until a cover asks for nothing. That final cover is the one resolving
every key in advance would produce. Joins licensed by rounds that asked for
nothing are kept across re-covers.

## What the answer voices

The cover answers what recall's argument binding answered (a question's sole
edge-source constituent, its continuation followed), and four laws make it the
same answer:

- **The product does not voice the ask.** Around a dominating form, an edge run
  of scaffolding a window long is the question's ask
  (`Why did … 's wife
  die?`): the answer is the form's replacement alone.
  Shorter runs are glue, and the rewrite keeps them (`2+2.` → `4.`). A voiced
  ask also reads to the walk as already said, and stops it (`liftAnswerParts`,
  `types.ts`).
- **A form held under the equivalence is a site.** Recognition matches bytes, so
  `Man At Bath` is no site of the stored `Man at Bath`; the climb proposes it
  and the canonical question's bytes decide (`canonHeldPoints`). The cover reads
  it once the climb has run, and is read again then (`readsOffInstances`).
- **Evidence travels.** The question spans that named a followed site's step
  (`askedEvidence`) are accounted, with the site read as the question spells it
  or under the response's equivalence.
- **What it voices is declared.** `used` is the facts the cover composed. An
  inferred set (every form of the answer the question witnesses, order-free)
  took `John II` for the question's `John III` and consumed the walk's pivot.
- **A chain's intermediate is not voiced.** A composed fact that voices the
  subject of another composed fact is a step toward it
  (`The performer of Heaven
  is Namie Amuro.` before
  `The place of birth of Namie Amuro is …`), and a fact already voiced is not
  voiced again. A comparison's two facts hold neither one the other's subject,
  and both stay.

## Provenance

`cover`, including fusion and recomposition steps that name a deeper learnt
form. `join` belongs to `confluence`, not to `cover`.

## Pins

- `test/09` — edge following and hop semantics.
- `test/19` — form rules and multi-hop chains.
- `test/151` — connectors and concept hops resolved where the search reaches
  them; dominance.
- `test/154` — a fragment voices none of its continuations unless the question
  names one.
