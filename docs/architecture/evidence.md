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
stranger's fact. `Who is the director of The Jerk?` walks on to Carl Reiner's
citizenship.

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
questions, the question alone witnessed such a context 69 times; with the first
hop, 2,153.

Only a **deposited** context establishes anything. A predecessor with structural
parents or containers is a span inside bigger forms and inherits their edges.
Witnessing it named every fact it is a piece of: `born?` named nine strangers'
birthplaces.

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
(`AGREEMENT`).

`byCoInstance` puts the node into each frame and looks the result up by content.
If `Edmond T. Gréville place of birth` exists, its continuation is named. Where
no context spells the frame around the node, because the node's fact is
established by its bare name alone, the fact states the relation instead. The
co-instance's fact spells it before the entity (`The place of birth of`), and
the node's continuation that opens with those bytes followed by the node is
named (`test/154.17`). Neither the frame nor the equivalence is stored, and
nothing in the reading is approximate.

**One measure ranks the two readings:** the question material that evidences a
continuation. Witnessing counts the question bytes an establishing context
holds; another instance counts the question frame it shares.
`In which country
was the paternal grandmother of Z born?` witnesses `Z mother`
with the `mother` inside `grandmother` (10 bytes), while three instances of the
whole frame (40 bytes) spell `· father` there, so the frame names the step. The
whole question's frames, read once per question, bound what any material could
evidence: when none spans more than the witnessing did, the co-instance reading
is not made.

The same measure ranks the frames among themselves, not their number of
instances. Three instances of `Who is Y's dad?` share only `Who is` and `?` with
a grandparent question (9 bytes), yet spell `· father` at the father as often as
the derivation (36 bytes) spells `· mother` there. Frames within one window of
the strongest are evidence perception cannot tell apart, and name together.

Instances that contradict one another (two of `elder grandmother` reading
`· father → · mother`, two `· mother → · mother`) name both continuations.
Refusing instead changes no answer, since the walk still commits through the
most corroborated first hop; abstaining would need the mechanisms to share that
the relation is unresolved.

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

A one-step reading does not replace the path. A context that establishes the
answer and holds the filler may be another way to ask the same question
(`Who among the children of Y is the medic?` beside
`Which child of Y is a medic?`). Its reading names nothing at a new question, so
both readings are kept, and agreement and the question's evidence decide.
Keeping only the one-step reading loses conditioned selections that paraphrased
instances teach.

The path is searched breadth first, so the shortest derivation the corpus holds
is the one read, and its length comes from the corpus. Each entity expanded is
one read of its facts out of the exact tier's allowance. A hub is not expanded,
and a search that spends the allowance reads nothing (`pathReadsSaturated`). A
path's entities are the ones its facts hold whole and learnt as contexts of
their own (`entitiesIn`): `Henry IV of France`, never the `Henry` inside it, and
never `mother`, a piece that holds continuations only by suffix inheritance. A
fact is read whole, since a prefix cut at the material's length holds the
shorter name. Which entities and paths a form gives does not depend on the
question, so both are kept for the session and dropped on a write.

The sequence is replayed in order (`replayOf`). Its first step applies at the
question's own entity. Step `i + 1` applies only at an entity the replay of
steps `1..i` from that entity reaches. So the frame a product already said does
not withhold a later step, and no step is taken out of order or taken again.

**Every way to an entity, once per depth.** Two relations can reach one entity
at one depth (`Y child` and `Y heir`, both to `C`). The search stands on the
entity once and keeps every way it reached it there, so an instance carries both
derivations. Kept by node alone, only the first way deposited is read, and two
instances deposited in different orders agree on none. An entity reached at a
shallower depth is not stood on again, so the paths kept are the shortest ones,
and each entity is still expanded once. Every further way into an entity is
charged to the same allowance as an expansion (`pathWays`): chained fans
multiply ways while entities only add up. Uncharged, a diamond chain 16 deep
costs 90M branch lookups; charged, the search saturates (`pathReadsSaturated`)
at a cost that does not grow with depth.

**What the derivation says of the entities it stands on.** A path says how it
leaves each entity, not what the entity is. `Which child of Y is a medic?`
answered `The occupation of C is surgeon.` is `· child → · occupation` from `Y`,
and `Y` has other children. What picks `C` is a fact of `C` the question never
spells: in every instance, the child is a surgeon. So the facts each entity on
an instance's path holds are read with the entity cut out (`factFrames`:
`The occupation of · is surgeon.`), the way a step is read off an establishing
context. The derivation keeps the ones every instance's entity there holds; an
instance reaching it by several ways (two children of `Y` sharing the answer)
holds a fact when one of its entities does, so no way deposited first becomes a
requirement. A fact one instance lacks says nothing of the derivation: this is
the certain test over the instances. It is taken over the instances that spell
the derivation, so it holds where the derivation does: once two instances agree.
Only once a second instance agrees on the steps is the first one's entity read
for its facts. Each later instance is then asked only for the facts still
shared, by an exact lookup of the whole fact. At the question, a step names only
a continuation holding an entity that holds every such fact (`satisfies`;
`conditionWithheld` counts what a condition withheld). The replay that places
the walk on a later step is conditioned the same way (`replayOf`). Otherwise an
entity the step rejects, reached by other means (recall voicing the first
child), is stood on anyway: the derivation's next step names its fact
(`The occupation of C is
painter.`) and credits the question's frame to a branch
the condition refused. The question's own entity is given, not selected, so it
takes no condition.

A narrower naming wins over witnessing by the same measure as a different one:
the reading that explains more of the question names the step. Witnessing names
both children (`child of`, 10 bytes), and the derivation (30 bytes) names the
surgeon.

**What a slot says, on both sides.** The slot between a frame holds an entity
and may say more of it (`slotSteps`). The entity is the stored context with
continuations covering the byte where the forms part (`slotEntity`), or, where a
description comes first (`the paternal grandmother of Z`), the one covering the
slot's last byte (`closingEntity`). It is the longest any reading spells: the
question, read under the canon (`… of eric i of denmark born?`), holds short
exact runs (`mark`) inside a name only the canonical class spells, so there the
canonical class is asked for longer spans holding the exact one; a form in its
own spelling holds its names exactly. The readings that refuse a co-instance
(`coInstanceFiller`: never voiced, never compared) find the entity the same way,
or CAST compares the question with an instance whose slot opens with a
description. The rest of the slot is read in order:

- **Less than one window** says nothing.
- **A description other forms hold** around another entity is read off them
  (`describedSteps`). `Y's dad` is held by `Who is Z's dad?` (`· father`) and by
  `Where was Z's dad born?` (`· father → · place of birth`). A description is
  applied first, nearest its entity, so it reads as the beginning those
  derivations share: the shortest sequence two forms spell alike, if every other
  sequence two forms spell begins with it — two readings that part ways name
  nothing (`test/157.18`). The forms come from the description's rarest window.
- **Else, one fact the slot witnesses** is that step
  (`Eleanor of Aquitaine's
  father`).
- **Else, a qualifier**: `(1259–1321)` after `Blanche of Portugal` adds nothing.
  That holds only for an entity the slot opens with. Where the entity is found
  only at the close, the forms part on the remainder, and an unread remainder
  leaves the slot undetermined.

The question's derivation is what its slot says, then what the frame says,
replayed in order from the slot's entity.
`Where was the paternal grandmother
of Z born?` is `· father → · mother`, read
off one family of forms, then `· place of birth`, read off another; no instance
asks it. An instance's derivation, read from its own entity, is the same two
parts. The frame's relation is what follows what the instance's slot already
said, so `Where was
Y's dad born?` spells `· place of birth`, as
`Where was Y born?` does. An instance whose derivation does not begin with its
slot's steps reads nothing; one whose slot says it all asks for the entity it
names. Where the question's slot is undetermined, a one-step relation still
applies to any node but that slot's entity: the walk may reach the spouse of
`Where was the husband of X
born?` by other means, but
`Where was the maternal great-grandmother of Z
born?` is not about Z's birth.

**An instance shares more than it differs.** A form whose slot says more beyond
its entity than the frame it shares with the question is another question, not
this one's frame around another filler: `Who is Y's paternal grandmother?`
shares `Who is` and `?` (8 bytes) with `Who is the maternal grandfather of Z?`
and says 23 more. Reading such slots costs 13–20% more lookups on 2Wiki and
answers nothing more. They still count as forms that share a frame when the
question-entity fallback asks whether its hypothesis shows.

**The proposals are one inventory, and their siblings.** The climb's points and
the response's resonance inventory — the forms `reference` and the substitution
bridge read as instances — are taken alternately under one budget
(`instanceProposals`, `chainReach(W)`); the points alone miss co-instances the
resonance ranks. One region votes for one context, so the climb's points hold
one instance of a frame several share. Once a co-instance has shown the frame,
the contexts its rarest non-hub window reaches on both surfaces
(`siblingInstances`: the fold makes one window a chunk of one form and a run
across another's) are read as further candidates. What a form says as an
instance is independent of the material: its bytes, filler and relations are
read once per question (`instanceBook`); each later material pays only the frame
check.

Where the points hold no two agreeing instances, the question's own entity shows
the frame instead: the longest point the question holds whole, exactly or under
the equivalence, with continuations of its own (`heldEntity`). What the question
says around it is read as the frame, and its siblings are read the same way.
That frame is a hypothesis, dropped once the first `chainReach(W)` siblings hold
no co-instance. A frame whose windows sit in more than `√N` places is common
because its instances are: a hub's vote discriminates nothing, but these readers
enumerate. They sample the `chainReach(W)` oldest contexts of each side's
narrowest window, alternately (depth first, at most `allowance·W` rows; a side
may be another frame's), stop when two agree, and keep entity-only slots
(`instanceEntity`).

The tier reads the `chainReach(W)` most corroborated of the consensus climb's
ranked points (`asked.points`) and climbs nothing itself (a climb of its own
costs 16% more climb visits and names nothing more). So the pick memo is cleared
when the points arrive (`memoization.md`), and a grounding read before the climb
is read again (`mechanism-market.md`).

A question stored verbatim is its own instance and reads no frames.

**A co-instance is never the answer.** Its own continuation speaks of its own
filler. A form witnessing all the question's slot says the question and more
(`Hey, buddy. What's up?` for `hey, what's up?`): none (`otherInstance`). So:

- recall's consensus anchor refuses it, else
  `Where was Nicki Minaj (Nicki Minaj Song) born?` answers another performer's
  question, as does the substitution bridge;
- fusion does not fuse it as another topic;
- no CAST schema transfers through it, else Shakira's birthplace is set against
  `John Lennon`.

## Why another instance makes a step available

A deposit names its fact by content, so two contexts that reach the same fact
bytes reach one node. `Where was Y born?` and `Y place of birth`, both leading
to `The place of birth of Y is P.`, record what no deposit states: with the
filler cut out, `Where was · born?` asks for `· place of birth`. Two fillers
spelling it alike make it a relation; applying it to `x` is one more lookup by
content. The instances' facts are about other things, so what makes the step
available is the organization, never a fact about `x`.

A step at `x` is named with no new fact about `x` exactly when:

- **convergence:** an instance and an establishing context reach one fact node;
- **identity:** frame and filler are the same bytes under the response's
  equivalence;
- **agreement:** two fillers spell the relation alike;
- **target:** `A·x·B` is deposited.

The law is pinned by the constructed worlds of `test/154`–`test/158`. The
contrast that fixes the information: an instance's fact respelled on one side
(two nodes) names nothing, respelled on both (one node) names. The description
reader (`describedSteps`) obeys the same law. Limits:

- **Identity, not meaning.** A paraphrased frame, an alias or a fact respelled
  on one side leaves the step unavailable to every exact reading; only the use
  (`byUse`) crosses, approximately, below the hub.
- **Strength is not represented.** Two misleading instances weigh as eight true
  ones; only `x`'s own facts tell them apart, at the lookup of `A·x·B`. What is
  named grows with experience; that one thing is named does not.
- **Available is not found.** On held-out rows the readers miss a sixth to a
  half of it: a differently spelled entity grounds nothing, a frame is not
  reached, or the decision goes elsewhere.
- **No instance, no step.** A step no instance shows and the question does not
  witness (`husband` for `spouse`) stays unavailable however sufficient the
  facts.

## A step named by its use — `byUse`

Where neither reading names a step, the question may name it by use: in
`In which town did Z pass away?`, `pass away` is used as `end` is in `Z end`. A
span's use is the halos of the contexts its windows reach (at most `W` windows,
each by its `chainReach(W)` oldest contexts). The candidates are exact: the
node's continuations, and the establishing contexts holding it, whose rest is
the relation. The unsaid run free of scaffolding that tells them apart best
ranks them, its best ahead of the next by `significanceBar`: a ranking floor,
not a test of chance, since uses are bundles of halos sharing the corpus's
common company (unrelated runs clear it on 3–4% of single contexts, 11–15% of
bundles of 4–16). The use is evidence only where the corpus licenses it
(`substitutionGrade` 2). Unlicensed, it only ranks, on the whole question for
its own thing (`heldEntity`) with two continuations or more. On the walk (a node
reached, not written) and for a single continuation, only a licensed use names
(`test/154.15`): the licence is asked of the pair the company chose.

A fragment that answers other questions is set aside before the cover takes it
as a site (`answersOtherQuestions`). The same predicate refuses CAST's
substitution subject and redirection substitute (`ong)?`, the tail of every
`… (… Song)?` question).

A fragment with a single continuation is no safer when no deposit learnt it
whole (`learntWhole`): every continuation it holds is inherited. Suffix
inheritance admits a reused piece once two deposits share it, so `ther` carries
only the fact of the first `… mother` context deposited after that, and cover
would voice `Otto the Great`'s mother for `Anne of Kiev's grandmother`. A form
learnt whole keeps its one continuation (the definition, bridge and ALU suites
fail without that exception), unless every window of it is scaffolding: the song
`What` names nothing in `What country is Jerry Bock a citizen of?`
(`test/154.20`). On the 2Wiki fixtures the rule costs one answer, a title
reached through the subword `sistance` (`Resistance` for `résistance`). On the
trained store such pieces carry many continuations and are set aside as
fragments with several.

## Its consumers

- `chooseNext` (`traverse.ts`): **The exact tier.** A continuation is named when
  one of its establishing contexts other than the node is witnessed by the
  question plus the node, and the question supplies a window the node lacks.
  Named picks rank first, then the instance and paraphrase readings, then the
  ladder.
- `askedEvidence` (`traverse.ts`): the question spans that named a pick, which a
  projecting mechanism then accounts for.
- `preConsumed` (`pipeline.ts`): when a grounding declares no `used`: the forms
  inside its answer that the question already holds. The entity the answer added
  stays pivotable.
- the walk (`reasoning.ts`): a named pivot moves; an unnamed one is offered only
  while the derivation still owes something, and the closure law decides it by
  carrying.
- `answersOtherQuestions` (`traverse.ts`): a fragment (a form inside others,
  with several continuations or one it only inherited, that leaves a window of
  the question outside it) leads somewhere only if the question names one of its
  continuations. Read by cover sites and CAST.
- recall's anchor, fusion roots, CAST schemas: a co-instance is never voiced or
  fused; a comparison names each side by a run no other context holds.

## What the question owes

A derivation is born owing only its discriminating material. Bytes reached by a
scaffolding window (`scaffoldExtents`, the hub reading, `commonality.md`) are
nobody's debt, so no step pays `Who is the` by restating `is`. A cover span made
only of scaffolding is not accounted. The trained store's song `What` is one of
thousands the bytes could name. Pricing is untouched: the ladder still charges
every unexplained byte: scaffolding made free in the market changes dialogue
answers (`How are you today?`, `failures/tempting-but-wrong.md`, trap 8).

## Bounds

The exact tier reads at most `√N` establishing contexts per decision, floored at
`chainReach(W)`, asking the cheapest first. It abstains (`askedReadsSaturated`)
when the read hits the cap, or when the question holds no window the node lacks.
A derivation's lookups read the oldest continuations up to the allowance
(`derivationReadsSaturated`).

## Measured

The fixtures hold the evidence triples of 300 held-out 2Wiki rows, deposited as
`wiki2.ts` does, with the canonical index built. "Plus instances" adds 261
one-hop questions about other entities; "plus inference instances" adds 228
inference questions about other entities (`paternal grandmother`,
`father-in-law`, …), each answered with its chain's last fact. No test entity
has a question of its own.

| Correct (strict), of the test rows       |     |
| ---------------------------------------- | --- |
| compositional, fixture (133)             | 58  |
| compositional, plus instances (133)      | 110 |
| inference, plus inference instances (37) | 30  |

The first hop is right on 116 and 114 of 133. Most of the remaining first-hop
failures are aliases (`Clara Novello` for `Clara Anastasia Novello`), which no
reading of bytes recovers. The answers gained with instances are relations no
window spells: `born` → place of birth, `work at` → employer, `is from` →
citizenship, and the inference pairs.

On the 31.7M-node store's battery the frame windows are scaffolding and no
instance exists: the tier names nothing, at the cost of the frame windows'
container reads and of loose dialogue frames' long slots.

A constructed world tests what 2Wiki cannot (derivations of 1 to 5 steps,
paraphrase, composition, branching, ambiguous names, negative controls). It
holds 2,276 people and 6,048 triples, with 66 instances and 172 test questions
about subjects with no question of their own.

| Correct, of the test questions               |     |
| -------------------------------------------- | --- |
| depth 1–2, incl. paraphrase, cross-kind (60) | 60  |
| depth 3–5, incl. cross-kind (42)             | 42  |
| a frame composed with a stated relation (6)  | 5   |
| a frame composed with a description (12)     | 9   |
| all 172                                      | 138 |

Nine first hops are wrong. In three compositions no instance names the step, and
the `mother` in `grandmother` does; one stops at its first hop. With the
instances removed, 12 are correct, and 12 with their answers scrambled, so that
no path joins filler and answer: the gain is the path, not the instances'
answers.

A second constructed world asks for an entity selected by a condition: among the
children of `Y`, the one who is a medic (`The occupation of C is surgeon.`), the
question never spelling the value the facts hold. With instances answered by the
deciding fact, the condition selects the medic in every question phrased as the
instances are, in both deposit orders; a paraphrase no instance spells is
answered by deposit order (4 and 5 of 6 in all, 1 with the answers scrambled).
In constructed families with the condition at the end, before the answer
(`the spouse of the medic child`), two hops deep, and on another relation, 16 of
16 in either order (6 and 5 with the answers scrambled), and a grandchild
question whose premise is absent is left unanswered (2 of 2). Limits:

- candidates reached by different relations (`father`, `mother` for `parent`)
  agree only per relation, so the condition selects only among one relation's;
- where no candidate satisfies the condition, the step names nothing, but other
  mechanisms still answer: a `which child … is a medic` with no medic child is
  answered with a child;
- a fact every instance's entity holds by accident is a condition too, on a path
  or at a meet: instances alone cannot tell it from the deciding one;
- a value the question spells is no condition when the instances spell different
  ones: `Which child of Y is a sailor?` and `… a painter?` name the same child,
  by deposit order.

## Pins

- `test/154` — witnessing: a named continuation beats the most-poured one;
  question plus node names the second hop; an unnamed step is not taken; a
  fragment voices nothing it was not asked, even its one inherited continuation;
  a comparison needs two named things; an argument held only under the
  equivalence binds, from any point; a paraphrase names the step by its use
  (154.10); a scaffolding learnt whole answers other questions (154.20).
- `test/155` — the relation read off another instance: it needs two agreeing
  instances; it refuses a partly shared frame, a said frame and a description in
  the slot; it is never voiced as the answer; traced and untraced responses
  agree; neither fusion nor a comparison takes a co-instance; a form saying the
  question and more is none; the relation is available only where an instance
  and a context reach one node (155.14).
- `test/157` — a derivation of any length: three and four steps (across kinds),
  each frame by its own sequence, in order; the reading or frame that explains
  more of the question names the step; what the slot says (its entity, the
  longest any reading spells, a description read off the forms that hold it on
  both surfaces, a qualifier); traced and untraced agree. Its scrambled-answer
  case is a control.
- `test/158` — what a derivation says of its entities: the condition every
  instance's entity holds selects the branch in either deposit order; every way
  to an entity is read and charged; a paraphrase of an instance does not hide
  its derivation.
- `test/156` — a derivation read off other instances: it answers a new entity's
  question; one instance agrees with nothing; its steps are followed in order,
  each frame by its own pair; a filler spelled only under the equivalence is an
  instance.
- `test/76-reference-binding` — a fact the corpus files under an instance's
  filler is no carriage.
- `test/29` C3 — a further hop inside a comparison's seat waits to be asked.
- Measured only at fixture scale, with no pin (answers each gains): excluding
  fragments from establishing contexts (16), refusing a fragment as CAST's
  redirection substitute (4), a co-instance's siblings (9), the second step held
  whole (1), and the frame shown by the question's own entity (6; small stores
  keep the instances among the climb's points).
