# Witnessed Evidence — The Question Names the Step

> **Law:** the material at hand identifies a stored form when every byte of the
> form lies in a `W`-window that the material holds, in any order and wherever
> each piece came from. A form witnessed in every byte but one contiguous span
> of content is **another instance** of the same question: it says what the
> question's relation is, never what the question asks about. A step the
> question did not name is paid for from what the question still owes.

**Why.** A question rarely repeats the corpus's wording or byte order, and a
derivation stands on nodes the asker never wrote. Without a reading of what the
question _names_, a chain follows the most-poured continuation and voices a
stranger's fact. `Who is the director of The Jerk?` once walked on to Carl
Reiner's citizenship.

## The operation — `witness` (`src/mind/evidence.ts`)

`witness(form, indexes, W)` reads one form against one window index per source
of material (`windowIndex`). It is the order-free reading, beside `alignRuns`
(ordered runs) and the unordered `junctionContainersFrom` (containers).

- It is exact and linear: one probe per window of the form.
- A window is credited to the last source that holds it, so the question
  (source 0) is credited only with what nothing else supplies.
- A form shorter than `W` is never witnessed.
- The form's unwitnessed bytes come back as its `residue`.

## The material

For every continuation, the corpus records the contexts that establish it, its
predecessors. `The father of Frederick II is Peter III of Aragon.` is
established by `Frederick II` and by `Frederick II father`. The material is the
question plus the node the derivation stands on. On the second hop of
`Where was the place of death of the director of film Beat Girl?`, the node is
`Edmond T. Gréville`, and `Edmond T. Gréville place of death` is held by neither
the question nor the node alone, only by both. Over 5,236 held-out 2Wiki
questions, the question alone witnessed such a context 69 times, and the
question plus the first hop 2,153 times.

Only a **deposited** context establishes anything. A predecessor with structural
parents or containers is a span inside bigger forms and inherits their edges.
Witnessing that fragment named every fact it is a piece of: `born?` named nine
strangers' birthplaces.

## Another instance of the question — `coInstanceFiller`, `byCoInstance`

`When was the director of film Jinpa born?` reaches `Pema Tseden`, whose fact is
established by `Pema Tseden date of birth`. No window joins `born` to
`date of birth`. What joins them is another instance of the question.

A **co-instance** is a stored context that shares the question's frame, its
opening and its close byte for byte under the response's equivalence (together
at least `W`), around one different filler. Three conditions make that reading
exact, and each was measured to be necessary:

- **Order.** Read order-free, `Lyon is a city in France` passes for an instance
  of `what if the capital of France were Lyon?`.
- **The filler is an entity.** It is the longest stored context with
  continuations of its own that opens where the slot opens, or up to one window
  earlier. In `Explain how photosynthesis converts sunlight…` the slot holds a
  description of the subject, and that is no other instance.
- **The frame is unsaid.** Every frame window must be held by the material, with
  scaffolding windows exempt. So a frame a product already said cannot name a
  second step: `father of` names the second hop of a father question, never the
  grandfather.

The co-instance's continuation is also established by contexts that hold the
filler (`Peter Jackson place of birth`), and they spell the relation the
corpus's way, as a **relation frame** (`relationFrames`). A frame counts only
where two co-instances spell it alike, the same bar `reference` holds
(`MIN_INSTANCES`).

`byCoInstance` puts the node into each frame and looks the result up by content.
If `Edmond T. Gréville place of birth` exists, its continuation is named. It
runs only when nothing is witnessed outright. Neither the frame nor the
equivalence is stored, and nothing in the reading is approximate.

**The proposals are the climb's.** The tier reads the `chainReach(W)` most
corroborated of the consensus climb's ranked points (`asked.points`), and climbs
nothing itself. A first version climbed on its own and cost 16% more climb
visits for no naming at all. This has two consequences:

- the pick memo is cleared when the points arrive (`memoization.md`);
- recall's argument binding asks for the climb first when its choice would
  otherwise be blind.

A question stored verbatim is its own instance and reads no frames.

**A co-instance is never the answer.** Its own continuation speaks of its own
filler. So:

- recall's consensus anchor refuses it, where once
  `Where was Nicki Minaj (Nicki Minaj Song) born?` answered another performer's
  question;
- fusion does not fuse it as a further topic;
- a CAST comparison does not take it as its dominant, where once Shakira's
  birthplace was voiced against `John Lennon`.

## Arguments held under the response's equivalence

2Wiki title-cases its questions (`Man At Bath` for the stored `Man at Bath`),
and such a title lines up with none of the fold's cuts. When recall's argument
binding finds no recognised argument, the stored forms the climb reaches become
candidates, if the question canonically contains them at their own offsets
(`canonHeldPoints`). The climb proposes, and exact containment decides. This
relies on the canonical index the trainer builds (`buildCanonIndex`).

A fragment that answers other questions is set aside before the binding looks
for one maximal argument, so `director` no longer cancels `Man at Bath`. The
same predicate refuses CAST's redirection substitute `ong)?`, the tail of every
`… (… Song)?` question.

## Its consumers

| Where                                          | What it decides                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chooseNext` (`traverse.ts`)                   | **The exact tier.** A continuation is named when one of its establishing contexts other than the node is witnessed by the question plus the node, and the question supplies a window the node lacks. Named picks rank first; then the co-instance reading; then the distributional ladder. |
| `askedEvidence` (`traverse.ts`)                | the question spans that named a pick, which a projecting mechanism then accounts for                                                                                                                                                                                                       |
| `preConsumed` (`pipeline.ts`)                  | when a grounding declares no `used`: the forms inside its answer that the question already holds. The entity the answer added stays pivotable                                                                                                                                              |
| the walk (`reasoning.ts`)                      | a named pivot moves; an unnamed one is offered only while the derivation still owes something, and the closure law decides it by carrying                                                                                                                                                  |
| `answersOtherQuestions` (`traverse.ts`)        | a fragment (a form inside others, with several continuations, that leaves a window of the question outside it) leads somewhere only if the question names one of its continuations. Read by cover sites, recall's binding and CAST's redirection                                           |
| recall's anchor, fusion roots, CAST comparison | a co-instance is never voiced or fused; a comparison needs a window of its own evidencing the analog                                                                                                                                                                                       |

## What the question owes

A derivation is born owing only its discriminating material. Bytes reached by a
scaffolding window (`scaffoldExtents`, the hub reading, `commonality.md`) are
nobody's debt, so no step pays `Who is the` by restating `is`. A cover span made
only of scaffolding is not accounted. The trained store's song `What` is one of
thousands the bytes could name. Pricing is untouched: the ladder still charges
every unexplained byte. Making scaffolding free in the market was measured and
refused, because it changed dialogue answers (`How are you today?`).

## Bounds

The exact tier reads at most `√N` establishing contexts per decision, floored at
`chainReach(W)`, asking the cheapest first. It abstains (`askedReadsSaturated`)
when the read hits the cap, or when the question holds no window the node lacks.
Picks are memoized per node and per question.

## Measured

The fixture holds the evidence triples of 300 held-out 2Wiki rows, deposited as
`wiki2.ts` does, with the canonical index built. "Plus instances" adds 261
one-hop questions about other entities.

| Compositional correct, of 133 | Witnessing only | Now |
| ----------------------------- | --------------- | --- |
| fixture                       | 52              | 56  |
| plus instances                | 41              | 89  |

The first hop is right on 114 and 109 of 133. Most of the remaining first-hop
failures are aliases (`Clara Novello` for `Clara Anastasia Novello`), which no
reading of bytes recovers. The answers gained with instances are relations no
window spells: `born` → place of birth, `work at` → employer, `is from` →
citizenship.

On the 31.7M-node store's 116-query battery:

- two dialogue answers changed, neither of which had been correct;
- the read counters rose about 4%;
- the co-instance tier named nothing, because there the frame windows are
  scaffolding and the one-hop instances are absent.

## Pins

- `test/154` — witnessing: a named continuation beats the most-poured one;
  question plus node names the second hop; an unnamed step is not taken; a
  fragment voices nothing it was not asked; a comparison needs two named things;
  an argument held only under the equivalence binds.
- `test/155` — the relation read off another instance: it needs two agreeing
  instances; it refuses a partly shared frame, a said frame and a description in
  the slot; it is never voiced as the answer; traced and untraced responses
  agree; neither fusion nor a comparison takes a co-instance.
- `test/76` — a fact the corpus files under an instance's filler is no carriage.
- `test/29` C3 — a further hop inside a comparison's seat waits to be asked.
- Measured only at fixture scale, with no pin: excluding fragments from
  establishing contexts (16 answers), and refusing a fragment as CAST's
  redirection substitute (4 answers).
