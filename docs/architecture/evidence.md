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
- **The filler is an entity, and it is what differs.** It is the longest stored
  context with continuations of its own that covers the byte where the two forms
  part (`slotEntity`). It may open up to `chainReach(W)` bytes earlier, because
  fillers that begin alike share their first word (`Princess Louise …`,
  `Princess Augusta …`), and it need not fill the slot: the record's `John V` is
  the question's `John V, Count Of Oldenburg`. The `mother` inside a frame's own
  `grandmother` never covers that byte, so it is frame. A filler the record
  spells only under the equivalence (`3Rd Baron` for `3rd Baron`) is found
  through the canonical class. In
  `Explain how photosynthesis converts
  sunlight…` the slot holds a description
  of the subject, and that is no other instance.
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
If `Edmond T. Gréville place of birth` exists, its continuation is named.
Neither the frame nor the equivalence is stored, and nothing in the reading is
approximate.

**One measure ranks the two readings:** the question material that evidences a
continuation. Witnessing counts the question bytes an establishing context
holds; another instance counts the question frame it shares.
`In which country
was the paternal grandmother of Z born?` witnesses `Z mother`
with the `mother` inside `grandmother` (10 bytes), while three instances of the
whole frame (40 bytes) spell `· father` there, so the frame names the step. The
whole question's frames are read once per question, and they bound what any
material could evidence. When none spans more than the witnessing did, the
co-instance reading is not made.

**A derivation, read off other instances.**
`Who is the paternal
great-grandmother of Z?` answered `The mother of Y2 is W.`
is a co-instance whose continuation no context holding `Z` establishes: it is
the end of a derivation from `Z`. The derivation is read as a **path**
(`pathSteps`). Each fact on it is established by a context holding the entity
the path stands on (`Z father` → `The father of Z is Y1.`), and holds the entity
the next fact stands on (`Y1`). The path ends where an establishing context of
the answer holds that entity (`Y2 mother`). Each step is its context with the
entity cut out, so the relation is the sequence `· father`, `· father`,
`· mother`, counted only where two instances spell it alike.

The path is searched breadth first, so the shortest derivation the corpus holds
is the one read, and its length comes from the corpus. Each entity expanded is
one read of its facts out of the exact tier's allowance. A hub is not expanded,
and a search that spends the allowance reads nothing (`pathReadsSaturated`). A
path's entities are the ones its facts hold whole and learnt as contexts of
their own (`entitiesIn`): `Henry IV of France`, never the `Henry` inside it, and
never `mother`, a piece that holds continuations only by suffix inheritance. A
fact is read whole for this, because a prefix cut at the material's length holds
the shorter name. Which entities and paths a form gives does not depend on the
question, so both are kept for the session and dropped on a write.

The sequence is replayed in order (`replayOf`). Its first step applies at the
question's own entity. Step `i + 1` applies only at an entity the replay of
steps `1..i` from that entity reaches. So the frame a product already said does
not withhold a later step, and no step is taken out of order or taken again.

The derivation starts at what the question's slot names (`startOf`):

- **An entity that fills the slot** (to less than one window) is the start.
- **A remainder that names nothing** only qualifies the entity, so the entity is
  still the start: `(1259–1321)` after `Blanche of Portugal`.
- **A remainder that names one fact of the entity**, witnessed by the slot's own
  material, describes something through it: the start is the one other entity
  that fact holds. For
  `the paternal grandmother of Eleanor of
  Aquitaine's father`, that is the
  father.
- **Anything less determined is no start.** Replaying from the entity alone
  would answer a question about someone else.

**The proposals are the climb's, and their siblings.** One region votes for one
context, so the climb's points hold one instance of a frame that several
instances share. Once a co-instance has shown the frame, the contexts its rarest
non-hub window reaches (`siblingInstances`, the climb's own memoised reach, a
saturated window proposing nothing) are read as further candidates. What a form
says as an instance does not depend on the material it is read against, so its
bytes, filler and relations are read once per question (`instanceBook`); each
later material, such as the walk's after each product, pays only the frame
check.

Where the points hold no two agreeing instances, the question's own entity shows
the frame instead: the longest point the question holds whole, exactly or under
the equivalence, with continuations of its own (`heldEntity`). What the question
says around it is read as the frame, and its siblings are read the same way.
That frame is a hypothesis, not one a co-instance has shown, so it is dropped
once the first `chainReach(W)` siblings hold no co-instance. A frame every
window of which is shared by more than `√N` contexts (`maternal grandfather`
among the other grandparent questions) has no window that enumerates its
instances under the read bound. Its instances are reachable only through a
conjunction of windows, and the question stays unanswered.

The tier reads the `chainReach(W)` most corroborated of the consensus climb's
ranked points (`asked.points`), and climbs nothing itself. A first version
climbed on its own and cost 16% more climb visits for no naming at all. This has
two consequences:

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

A fragment with a single continuation is no safer when it was never learnt as a
context. Suffix inheritance admits a reused piece once two deposits share it, so
`ther` carries only the fact of the first `… mother` context deposited after
that, and cover voiced `Otto the Great`'s mother for
`Anne of Kiev's
grandmother`. A piece with no company of its own (no halo) holds
only inherited continuations, so it answers other questions however few it
holds. A form learnt as a context keeps its one continuation; the definition,
bridge and ALU suites fail without that exception. On the 2Wiki fixtures the
rule cost one answer (a title reached through the subword `sistance`,
`Resistance` for `résistance`), removed a stranger's fact glued onto another,
and cut search and lookups by 3–5%. The 116-query battery did not change: on the
trained store such pieces carry many continuations, and the older rule already
set them aside.

## Its consumers

| Where                                          | What it decides                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chooseNext` (`traverse.ts`)                   | **The exact tier.** A continuation is named when one of its establishing contexts other than the node is witnessed by the question plus the node, and the question supplies a window the node lacks. Named picks rank first; then the co-instance reading; then the distributional ladder. |
| `askedEvidence` (`traverse.ts`)                | the question spans that named a pick, which a projecting mechanism then accounts for                                                                                                                                                                                                       |
| `preConsumed` (`pipeline.ts`)                  | when a grounding declares no `used`: the forms inside its answer that the question already holds. The entity the answer added stays pivotable                                                                                                                                              |
| the walk (`reasoning.ts`)                      | a named pivot moves; an unnamed one is offered only while the derivation still owes something, and the closure law decides it by carrying                                                                                                                                                  |
| `answersOtherQuestions` (`traverse.ts`)        | a fragment (a form inside others, with several continuations or one it only inherited, that leaves a window of the question outside it) leads somewhere only if the question names one of its continuations. Read by cover sites, recall's binding and CAST's redirection                  |
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

The fixtures hold the evidence triples of 300 held-out 2Wiki rows, deposited as
`wiki2.ts` does, with the canonical index built. "Plus instances" adds 261
one-hop questions about other entities; "plus inference instances" adds 228
inference questions about other entities (`paternal grandmother`,
`father-in-law`, …), each answered with its chain's last fact. No test entity
has a question of its own.

| Correct (strict), of the test rows       | Witnessing only | 0.9.5 | Now |
| ---------------------------------------- | --------------- | ----- | --- |
| compositional, fixture (133)             | 52              | 56    | 57  |
| compositional, plus instances (133)      | 41              | 89    | 102 |
| inference, plus inference instances (37) | —               | 6     | 23  |

The first hop is right on 114 and 109 of 133. Most of the remaining first-hop
failures are aliases (`Clara Novello` for `Clara Anastasia Novello`), which no
reading of bytes recovers. The answers gained with instances are relations no
window spells: `born` → place of birth, `work at` → employer, `is from` →
citizenship, `nationality` → citizenship, and the inference pairs.

On the 31.7M-node store's 116-query battery, the derivation reading and the
entity's frame changed no answer against 0.9.5. Bytes read rose 0.7%, canonical
lookups 6%, and container reads 13% (about 19 point reads per question, for the
frame windows' rarity). There the frame windows are scaffolding and the
instances are absent, so the tier names nothing.

A constructed world tests what 2Wiki cannot: derivations of 1 to 5 steps,
paraphrased and reordered frames, frames composed with a stated relation,
branching, ambiguous names, and negative controls. It holds 2,098 people and
5,578 triples, deposited as `wiki2.ts` does, with 60 instances and 152 test
questions about subjects with no question of their own.

| Correct, of the test questions          | Two-step reading | Path reading |
| --------------------------------------- | ---------------- | ------------ |
| depth 1–2, incl. paraphrase, cross-kind | 35 of 52         | 50           |
| depth 3–5, incl. cross-kind             | 0 of 42          | 41           |
| a frame composed with a stated relation | 0 of 6           | 6            |
| all 152                                 | 52               | 115          |

Wrong first hops fell from 42 to 10. With the instances removed, or their
answers scrambled so that no path joins filler and answer, every answer was the
same under both readings: the gain is the path, not the instances' answers.

## Pins

- `test/154` — witnessing: a named continuation beats the most-poured one;
  question plus node names the second hop; an unnamed step is not taken; a
  fragment voices nothing it was not asked, even its one inherited continuation;
  a comparison needs two named things; an argument held only under the
  equivalence binds.
- `test/155` — the relation read off another instance: it needs two agreeing
  instances; it refuses a partly shared frame, a said frame and a description in
  the slot; it is never voiced as the answer; traced and untraced responses
  agree; neither fusion nor a comparison takes a co-instance.
- `test/157` — a derivation of any length: three and four steps (across kinds);
  each frame by its own sequence, in order; the reading that explains more of
  the question names the step; the start is what the slot names, and a remainder
  that names nothing only qualifies; a fact holds its entity whole; traced and
  untraced responses agree. Its scrambled-answer case is a control: no mutation
  of the reading short of inventing a path breaks it.
- `test/156` — a derivation read off other instances: it answers a new entity's
  question; one instance agrees with nothing; its steps are followed in order,
  each frame by its own pair; a filler spelled only under the equivalence is an
  instance.
- `test/76` — a fact the corpus files under an instance's filler is no carriage.
- `test/29` C3 — a further hop inside a comparison's seat waits to be asked.
- Measured only at fixture scale, with no pin: excluding fragments from
  establishing contexts (16 answers), refusing a fragment as CAST's redirection
  substitute (4 answers), the siblings of a co-instance (3 inference and 6
  compositional answers), the second step held whole (1 inference answer, where
  a piece of the entity took a step again), and the frame shown by the
  question's own entity (3 inference and 3 compositional answers). The last
  resisted a constructed fixture: on small stores the climb keeps the instances
  among its points. Reducing the fixture showed that no eighth of it could be
  removed without changing the outcome.
