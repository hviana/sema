# Philosophy — The Path of Information

`docs/INDEX.md` routes the laws. This file follows one piece of information from
the moment it enters Sema to the moment it is used, and says at each step what
happens, why it must happen that way, and what it makes possible. One principle
runs through the whole path:

> **Keep exactly what was given. Build ways of finding it. Decide only on what
> was kept. Charge for what was not found.**

Every structure below is either something kept (exact, it may decide) or a way
of finding (approximate, it may only propose). Holding that distinction is what
lets a reader predict how any part of Sema behaves.

## 1. Information enters

**What enters.** A deposit is a pair, a context and what followed it, or a bare
experience. That is the only relation Sema assumes of the world: _this came
after that_. It imposes no schema, no entities and no types. Everything else
must be discovered from what follows what.

**As bytes.** There is no tokenizer, no vocabulary and no language. A modality
is only a reading order: text is read as written, and a grid along a Hilbert
curve, which keeps most of the plane's locality in the stream. Whatever can be
read as a stream can be learnt.

**Into a tree, cut by the content itself.** A rolling hash runs over the bytes.
Where it vanishes, a cut falls, and the more digits it vanishes on, the higher
the cut's level. Higher cuts nest inside lower ones, so the stream folds into a
tree of about `W` children per node (`W` = 4 by default), level by level
(`fold-contract.md`). There are three reasons for this shape:

- **Content-defined cuts make identity independent of position.** A phrase is
  cut the same way wherever it occurs, so in two different deposits it is the
  same subtree. After a shift, 99.7% of cuts survive, against 14.3% for a fixed
  grid.
- **A tree, not a flat list.** Recurrence happens at every scale: a word, a
  phrase, a sentence. The hierarchy makes every scale a node, so recurrence is
  caught wherever it happens, and an edit touches only the path from the change
  to the root.
- **Nothing is imposed that a later question could not reproduce.** No turn
  boundaries, no metadata: a question will be cut by the same rule from its own
  bytes, and any cut it could not reproduce would make the same thing two
  things. When the two sides disagreed, alignment went quadratic (5.2M cells
  against 0) and turns asked verbatim stopped resolving to themselves.

**Interned by content.** Every subtree becomes a node named by what it contains:
a branch by its children, a short run by its bytes. The same subtree in a
thousand deposits is one node with a thousand parents, so the store is a DAG,
not a forest. Every window of `W−1` and `W` bytes is also indexed as a node of
its own and linked to the chunks that contain it, so a span can be found
whatever the fold did around it. Teaching the same thing twice creates no
structure.

**Linked by succession.** The context's root gets an edge to the continuation's
root. Each suffix of the context that is already a known form inherits that edge
too, and inside a bare experience the parts are chained in order. An edge is a
unique pair, so how many contexts lead to a continuation counts distinct
contexts, not repetitions.

**What this structure can answer, exactly:**

- **Is this stored?** Fold it and look the name up. One byte apart is another
  name.
- **What contains this, and what is it part of?** Climb the parents and
  containers.
- **What followed this?** Read its edges.
- **How common is this?** Count the contexts that reach it: a minority
  discriminates, and what reaches nearly everything is scaffolding
  (`commonality.md`).
- **What of a question is already known?** Recognition decomposes the question
  into every stored form inside it that leads somewhere, with a bounded number
  of probes per byte.

**What it cannot answer:** what is _near_. A content address destroys locality
on purpose, because that is what makes it a name. `colour` and `colours` are as
far apart, by name, as `colour` and `Zanzibar`. Everything from here on exists
because of that gap.

## 2. Two ways of being near

Every node also gets vectors in a high-dimensional space (a vector-symbolic
architecture: Plate 1995; Kanerva 2009). There are two of them, because there
are two independent ways for things to be near.

**The gist: nearness of form.** Each byte value has a vector from an alphabet
built by refinement (16 coarse directions, then 64, then 256), so neighbouring
values resemble each other. A node's gist binds each child to its position, by a
fixed permutation per seat, counted from both ends so that growth at one edge
keeps the other edge's coordinates, and then adds them up. The fold is linear,
so the cosine of two gists reads how many bytes they share in place. The gist
exists at birth: it is computed from the bytes alone. It puts `colour` near
`colours`.

**The halo: nearness of use.** Each time a fact is deposited, two pours happen:

- every newly seen part of the context receives the continuation's signature, in
  the seat for _what it led to_;
- the continuation receives each part's signature, in the seat for _what led to
  it_.

A signature is keyed on a node's identity, never on its gist. Read as whole
partners, company would almost never recur, since whole deposits rarely repeat.
So each partner contributes its own signature together with a sketch of its
constituents: `√D` of them, the capacity of a superposition before each term
falls below noise, with scaffolding excluded (`halo-sketch.md`). Two words that
never meet can therefore still share the _kinds_ of things around them. Each
episode adds one unit, by addition, so order is forgotten and proportion kept.
The halo is earned by experience. It puts `colour` near `hue`.

**Why two, and why kept apart.** Form and use are different axes of meaning, and
neither predicts the other. The halo is built from identities and never from
gists, so that resemblance of spelling cannot leak into resemblance of use. When
the two agree, it is corroboration, not echo.

**Why vectors at all, and why they never decide.** A vector restores the
locality the name destroyed. An index over the vectors (RaBitQ-IVF) finds the
near ones among millions in one query. But a vector is a lossy summary, and its
score is an estimate. So the space proposes and the structure decides
(`exact-vs-approximate.md`). The bars are set against the space's own chance:
random vectors are nearly orthogonal, with noise `1/√D`, so a resemblance counts
at `3/√D`, and two halos share a concept at `0.5 + 0.5/√D` (`thresholds.md`).
The single exception is the store's near-merge at deposit, bounded to one window
of difference.

**Two memories.** The deposits are a record: verbatim, enumerable, each with
provenance. The halos are a statistic accumulated over that record. This is the
episodic/semantic distinction (Tulving 1972) with fixed roles: **the statistic
proposes, the record decides.** A halo can say that two things are of a kind; it
never says they are the same thing, and it never establishes a fact.

**How the three readings are ordered.** Where Sema looks for a span, it tries
exact bytes first, then the halo's role, then the gist (`match.ts`). A form
counts as knowledge only if it _leads somewhere_: it has a continuation, or it
has a halo. Something that never led anywhere is not used.

**What the vectors add to reasoning.** They add three things:

- **Paraphrase:** a question one byte off its stored twin is found by its gist.
- **Substitution:** a form with no continuation of its own may borrow a halo
  sibling's, at the price of a concept hop.
- **Imagination, bounded:** binding stored parts gives the gist of a whole never
  seen, which can be searched for. That search is the most approximate tier of
  all, and is gated hardest, because nothing about it is contained in bytes.

## 3. A question arrives

The question is folded by the same rule as every deposit, and the identity fold
names each part by asking the store as it folds. So perceiving a question is
already recognising what of it memory holds; representation and search begin as
one act. Recognition returns the question's _sites_: every stored form inside it
that leads somewhere, each with its exact identity.

## 4. Attention, built on the structure

The sites say what the question contains. They do not say what the question is
_about_, meaning which stored contexts its parts point to together. That is
attention's job, the consensus climb (`attention.ts`).

1. **Regions.** Every node of the question's tree, and every recognised site, is
   a region.
2. **Lookup.** A region that is a stored form looks itself up exactly. Any other
   region searches by gist, and pays a margin: it must beat the best rival
   conclusion by the noise floor, scaled by how much of it is not stored.
3. **Climb.** Each region climbs the DAG, through parents and containers, to the
   stored contexts it reaches. The climb stops at a named saturation when a node
   reaches more than `√N` contexts, because past that point reading further
   cannot discriminate (`saturation.md`).
4. **Weigh by rarity.** A region that reaches `c` of `N` contexts weighs
   `ln(N/c)`. This is inverse document frequency, read over structure.
5. **Agree.** Independent regions add, pooled in the (+, +) semiring of the same
   deduction engine the search uses.
6. **Join.** When two regions point to different contexts, the stored whole that
   contains both is sought, by exact junction first, then through halo synonyms,
   then by an imagined whole. Exact joint evidence explains the separate votes
   away.

The output is a set of points of attention: stored contexts where independent
parts of the question agree, ranked.

Compared with a transformer's attention, which is soft content addressing over a
context window:

- **The keys are stored contexts,** reached by containment across the whole
  memory, not tokens in a window. This is cross-attention, from the question
  into memory.
- **The weights are rarity,** derived and not learned.
- **The votes are absolute.** A softmax must attend somewhere, because its
  weights sum to one. Sema's anchors count only above floors derived from `D`
  and `N`, so attention can come back empty.
- **Nothing is blended.** Mixing values would produce bytes nobody deposited.
  Attention selects, and does not mix.
- **Exact evidence outranks resemblance.** Only exact evidence may explain a
  vote away.

Attention is also spent, not assumed. The climb is the shared analysis the
market defers until no cheaper bound can rule it out (`mechanism-market.md`).

**Why this is the right notion of relevance.** Every judgement of relevance in
Sema divides a population into what it shares (frame) and what varies (filler).
Commonality and discrimination are the two sides of that one cut, and the answer
depends on the population. Sema reads three populations and never confuses them:
the corpus, the cohort of structures aligned to this question, and the
containers of a window (`commonality.md`). The rarity weighting is the graded
form of the cut over the corpus. Attention's deeper role is to _choose the
population_: its points are the cohort the next steps cut.

## 5. How it is used

**Many ways of thinking.** Each grounding mechanism reads the same material
differently:

- `cover` composes the question from its sites and follows their edges, by graph
  search.
- CAST aligns the attention points to the question and cuts that cohort into
  frame and filler. It then carries structure between them: substitution,
  redirection, comparison.
- `confluence` intersects what independent anchors share, as long as it is not
  scaffolding.
- `extraction` reads out a located frame.
- `reference` learns a frame from worked examples and voices its slot with the
  asker's own bytes.
- `recall` takes the nearest stored form by gist.
- `prefix-completion` completes a known beginning.
- The ALU computes, and what it computes is authoritative.

**One price.** Every candidate weighs `moves + PASS·unaccounted`, and `PASS` per
byte of unexplained question outweighs any move (`cost-model.md`). The price is
not confidence. It is how much of the question remains unaccounted for, so the
winner is the reading that explains the most. When nothing accounts for the
question, silence wins, and silence is a first-class answer. An answer that is
only near says so.

**Reasoning that answers to the question.** The winner may be extended, step by
step, along succession. A step is admitted only if it closes the derivation,
moves to structure not yet consumed, or carries what the question still owes
(`closure.md`). A step counts as _named_ when the question, together with the
node the step stands on, witnesses one of the contexts that establish it
(`evidence.md`). A step the question did not name is paid from its remaining
debt. The question owns the inference, so a chain cannot wander off to a fact
nobody asked for.

**Generalization, read and never stored.** When no context is named outright,
attention's points may hold another instance of the question.
`Where was Peter Jackson born?` shares the frame of
`Where was the director of film Beat Girl born?`. Peter Jackson's fact is also
established by `Peter Jackson place of birth`, which is how the corpus spells
the relation. The node at hand, `Edmond T. Gréville`, is put into that frame,
and the result is looked up by content.

This is anti-unification (Plotkin 1970): keep what two instances share, put a
variable where they differ. It is admitted only under three conditions:

- the variable is a thing the store knows;
- two instances agree;
- what the corpus files under one filler is not credited to the frame.

The third condition comes from a real failure. Two people born in Wellington
once gave an unknown `Zorblax` the same birthplace (`test/76`), Goodman's (1955)
accidental generalization. The frame is never stored, and neither is any answer.
A conclusion kept as a deposit would become evidence for itself.

**Every answer replays.** The derivation is a hyperpath in an AND/OR hypergraph
whose axioms are stored nodes (`src/derive/`). Its trace replays byte for byte,
and ties are broken by the order of teaching, never by chance
(`determinism.md`). A correction erases nothing. It is a further deposit, and it
prevails by evidence.

## 6. The path, seen whole

| Step              | What it adds                                   | Kept or finding | It may           |
| ----------------- | ---------------------------------------------- | --------------- | ---------------- |
| bytes, fold       | one tree per stream, cut by content            | kept            | decide identity  |
| DAG, edges        | identity, parthood, succession, commonality    | kept            | decide           |
| gist              | nearness of form                               | finding         | propose          |
| halo              | nearness of use                                | finding         | propose          |
| recognition       | what of the question is known                  | kept            | decide           |
| attention         | where the question's parts agree; a population | finding         | propose          |
| mechanisms        | readings of the same material                  | both            | offer candidates |
| price and closure | what remains unexplained; what may follow      | kept            | decide           |

Representation, search and reasoning are separate modules, but not separate
ideas. One fold serves deposit and question. One identity serves every lookup.
One price serves every mechanism. One law admits every step. Everything that
finds is kept out of every decision, and everything that decides rests on what
was given.

## 7. Hypotheses the path invites

Each of these follows from a gap visible on the path, and none is a plan.

- **One cut.** Frame against filler is computed in several places: the three
  commonality measures, `frameSlots`, `coInstanceFiller` and CAST's `depth[]`.
  Is it one operation read over different populations, or several, as
  `commonality.md` holds?
- **Form, use and identity together.** Two forms with near halos that can stand
  for each other in every stored frame — Leibniz's substitution _salva veritate_
  — would be one referent. That is aliases (`Clara Novello` and
  `Clara Anastasia Novello`) seen by the record, with the halo proposing.
- **Imagination as hypothesis.** Binding stored parts proposes wholes never
  seen, and today it only joins regions. Proposals made this way, then checked
  by content, are abduction with a guaranteed verifier.
- **Derivations as instances.** Anti-unify derivations, not texts, and `father`
  twice reads as `grandfather` wherever an instance shows it. Derived material
  must never count as a new context.
- **Richer company.** The halo has two seats, _what it led to_ and _what led to
  it_. What other relations of use would a seat capture, and what would they let
  attention see?
- **Other streams.** Whatever has a reading order that preserves locality can
  enter by the same path.

## References

Goodman (1955), _Fact, Fiction, and Forecast_ · Kanerva (2009), _Cognitive
Computation_ 1(2) · Plate (1995), _IEEE TNN_ 6(3) · Plotkin (1970), _Machine
Intelligence_ 5 · Tulving (1972), "Episodic and semantic memory", in
_Organization of Memory_.
