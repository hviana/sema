# Witnessed Evidence — The Question Names the Step

> **Law:** a stored form is identified by the material at hand when every one of
> its bytes lies in a W-window that material holds — in any order, at any place,
> and wherever each piece of the material came from. A form witnessed in every
> byte but one contiguous span of content is ANOTHER INSTANCE of the same
> question: it says what the question's relation is, never what it asks about. A
> step the question did not name has to be paid for by material the question
> still owes.

## The operation — `src/mind/evidence.ts`

`witness(form, indexes, W)` reads one form against a list of window indexes
(`windowIndex`). It is the order-free reading of correspondence, beside
`alignRuns` (which produces runs) and `junctionContainersFrom(…, unordered)`
(which finds containers). It is exact, deterministic and linear: one index per
source and one probe per window of the form. A window is credited to the LAST
source that holds it, so source 0 (the question) is credited only with what
nothing else at hand supplies. A form shorter than W is never witnessed. The
form's own unwitnessed bytes come back as its `residue`.

## Where the material comes from

The corpus records, for every continuation, the questions that establish it: its
predecessors. A 2Wiki fact `The father of Frederick II is Peter III of
Aragon.`
is established by `Frederick II` and by `Frederick II father`. The asker's
question rarely repeats either one byte for byte, but it often holds every byte
of one of them.

The derivation stands on more than the question. The node it is following is
material too. On the second hop of
`Where was the place of death of the
director of film Beat Girl?` the node is
`Edmond T. Gréville`, which the first hop reached and the asker never wrote. The
establishing question `Edmond T.
Gréville place of death` is held by neither the
question nor the first hop's fact, only by both. Measured over 5,236 held-out
2WikiMultihopQA compositional questions, such a context is wholly witnessed by
the question alone 69 times, and by the question plus the first hop 2,153 times.

An establishing context is a DEPOSITED context: a predecessor with structural
parents or containers is a span interned inside bigger forms, and it inherits
their edges. Witnessing such a fragment named every fact it is a piece of (the
fragment `born?` named nine strangers' birthplaces on the 2Wiki fixture with
one-hop questions), so it never counts — the same structural predicate
`pivotInto` reads.

## Another instance of the question — `coInstanceFiller`, `byCoInstance`

The question rarely spells the relation the way the corpus does.
`When was the
director of film Jinpa born?` reaches `Pema Tseden`, whose fact is
established by `Pema Tseden date of birth`: no window joins `born` to
`date of birth`, so nothing is witnessed. What joins them is another instance of
the question.

A stored context the question witnesses in every byte but ONE contiguous span,
that span holding content (a window that is not scaffolding), is a
**co-instance**: the question's own frame around a different filler.
`Where was Peter Jackson born?`, read against
`Where was the director of film Beat Girl born?`, leaves `Peter Jackson`. A
residue made of scaffolding alone is the same question in other framing words,
not another instance.

The co-instance's continuation is established by other contexts too
(`Peter Jackson place of birth`), and the one holding the filler spells the
relation the corpus's way. The exact tier's second reading (`byCoInstance`, run
only when no establishing context is witnessed outright) puts the node the
derivation stands on where the filler was and looks the result up by content:
`Edmond T. Gréville place of birth` exists, so its continuation is named.
Neither the equivalence nor the frame is stored as a unit, and nothing is
approximate: the co-instance is witnessed, the substitution is bytes, the target
is an exact lookup. A frame the question shares only partly (`Where was … born?`
against `When was …`) leaves two residues and is no co-instance. Proposals come
from the edge-bearing ancestors of the question's windows the node does not hold
(`edgeAncestors`, memoised, a saturated window proposing nothing), rarest first,
at most √N of them.

The same reading refuses the co-instance as an ANSWER. Its own continuation
speaks of its own filler, so recall's consensus-anchor tier does not ground it
(`Where was the performer of song God (John Lennon Song) born?` elected
`Where was Nicki Minaj (Nicki Minaj Song) born?`), and fusion does not fuse it
as a further topic.

## Its consumers

| Where                                                                             | What it decides                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chooseNext` (traverse.ts)                                                        | **The exact tier.** It names the continuation one of whose establishing contexts (other than the node) is witnessed by the question plus the node, with the question supplying at least one window the node does not. It ranks first among the readings; the distributional ladder decides only when nothing is named, or among continuations named equally.                                                                                                                     |
| `askedEvidence` (traverse.ts)                                                     | The question spans that named a pick. A mechanism projecting through the pick accounts for them, because evidence travels (mechanism-market.md). Recall's argument binding uses this.                                                                                                                                                                                                                                                                                            |
| `preConsumed` (pipeline.ts)                                                       | When a grounding does not declare `used`, what it spoke for is the forms inside its answer that the question already holds. The entity the answer added stays pivotable.                                                                                                                                                                                                                                                                                                         |
| The walk (reasoning.ts)                                                           | A pivot is NAMED when one of its continuation's establishing contexts is witnessed by what of the question no product has said yet, plus the pivot. A named pivot MOVES. An unnamed one is offered only while the derivation still owes something, and the law then decides by carrying. No grounding owns the next step: a CAST grounding used to move through any term inside its answer, unasked (`Who is the director of The Jerk?` walked on to Carl Reiner's citizenship). |
| `answersOtherQuestions` (traverse.ts) — cover sites and recall's argument binding | A FRAGMENT is a form that sits inside other forms, has several continuations, and leaves at least one window of the question beyond it. It answers other questions, so it leads somewhere for this question only when the question names one of its continuations. Recall's binding read the same fragment (`director`) and voiced the most-poured stranger's fact.                                                                                                              |
| `byCoInstance` (traverse.ts)                                                      | The exact tier's second reading: the relation read off another instance of the question, transferred to the node by an exact substitution.                                                                                                                                                                                                                                                                                                                                       |
| Recall's consensus anchor, fusion roots                                           | A co-instance of the question is never voiced as its answer, nor fused as a further topic.                                                                                                                                                                                                                                                                                                                                                                                       |
| CAST comparison (mechanisms/cast.ts)                                              | A comparison voices two structures, so the question must evidence the analog with a window of its own: neither inside the dominant's runs nor scaffolding. `father of Frederick II?` evidenced `Peter III of Aragon father` only with `father` and `of`, and the comparison glued that bare question onto the answer.                                                                                                                                                            |

A cover span made of nothing but scaffolding (every window a hub,
`scaffoldSpans`) is not accounted. The form recognised there, such as the song
`What` in the trained store, is one of thousands the bytes could name. This is
measured only on the trained store (`What country is Jerry Bock a citizen of?`
was won by `The performer of What is Melinda Marx.` glued onto the right fact).
A synthetic fixture could not reproduce that regime, because content addressing
folds every filler's `What` into a handful of shared nodes, so no suite test
pins this rule.

## What the question owes

The derivation is born owing only its discriminative material. The bytes a
corpus-global scaffolding window reaches (`scaffoldExtents`, the same "hub"
reading as `allWindowsAreScaffolding` and the bridge's `explainedSpan`) are
nobody's debt. Otherwise a step could claim to pay `Who is the` by restating
`is`, which every fact holds. Pricing is untouched: the ladder still charges
every unexplained byte, because for a question made only of scaffolding,
covering those bytes is the evidence. Making scaffolding free in the market was
measured and refused, because it changed dialogue answers
(`How are you
today?`).

The hub reading behind `scaffoldExtents` is floored at `chainReach(W)`
containers. Inside one deposit's fold, a window is already contained by up to
that many chunks and branches, so on a store of a few facts the √N reading would
call every window frame. That count measures fold structure, not corpus
commonality (`test/22`'s two-fact chains are exactly that regime).

## Bounds

The exact tier reads at most √N establishing contexts per decision, floored at
`chainReach(W)`. It asks the cheapest candidates first and compares scores
afterwards in the continuations' own order. It abstains, metered as
`askedReadsSaturated`, in two cases: the continuation read came back at the √N
cap, or the question holds no window the node lacks. One short prefix read
refuses most predecessors before a whole form is reconstructed. Picks are
memoized per node per question.

## Measured

| Measure                                                                                | Before | Witnessing | + instances |
| -------------------------------------------------------------------------------------- | ------ | ---------- | ----------- |
| 2Wiki held-out fixture (300 rows, deposited as `wiki2.ts` does), compositional correct | 13/133 | 47/133     | 44/133      |
| Same fixture, inference correct                                                        | 8/37   | 6/37       | 6/37        |
| Same evidence plus 261 one-hop questions about OTHER entities, compositional correct   | —      | 35/133     | 65/133      |

The third row is the co-instance's own measure. The one-hop questions were built
from other validation rows by replacing the first hop's phrase with its referent
(`Where was the director of film X born?` → `Where was Óskar Jónasson
born?`),
answered with the second hop's fact; no test entity has one. The 30 answers
gained are relations the question spells differently: `born` → place of birth,
`Why did … die` → cause of death, `study`/`graduate from` → educated at,
`work at` → employer. None was lost. Without one-hop questions the second row's
fall from 47 to 44 is the price of removing CAST's unasked step (six of its hops
were right paraphrases taken without evidence, and the same licence produced the
Carl Reiner extension), net of the fragment rules.

The inference drop is real. Two hops of `father` from a question that says
`father` once, as in `paternal grandfather`, used to be reached by
over-extension and are no longer. The store holds no evidence that `grandfather`
composes `father` twice.

On the 31.7M-node store's 116-query battery, two answers became correct
(`What country is Jerry Bock a citizen of?` and
`What is the country of citizenship of Frederick II?`), two lost a junk
composition, three changed between wrong answers, and no correct answer was
lost. CPU was 150 s against two baseline runs of 139 s and 166 s, inside the
noise. The deterministic read counters rose about 20% (`bytesRead`,
`nodeRecords`), with ANN queries unchanged.

## Pins

- `test/154` — witnessing semantics. The named continuation beats the
  most-poured one. The second hop is named by the question plus the introduced
  entity, whatever grounded the first hop. A question that names no further step
  is not extended. A fragment voices none of its continuations unless the
  question names one, in the cover and in recall's argument binding. A
  comparison needs two things named. Each assertion was verified by mutation.
- `test/155` — the relation read off another instance of the frame, absent
  without one, refused for a partly shared frame, and never voiced as the answer
  (verified by mutation).
- `test/29` C3 — a further hop inside a comparison's seat waits to be asked.
- Unpinned, measured only at fixture scale: fragments excluded from establishing
  contexts (2Wiki fixture with one-hop questions: first-hop answers 69 → 79),
  and the fusion refusal of a co-instance root (it removed three glued
  strangers' facts there).
