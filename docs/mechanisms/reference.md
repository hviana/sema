# Reference — Read the Question Through Its Frame's Instances

`reference` learns a frame from worked examples and voices its slot with the
bytes the asker put in that position (`src/mind/mechanisms/reference.ts`). It
asserts _position_ ("this is the thing you named, where the corpus keeps one"),
not equivalence. The voiced bytes are the asker's, so they cannot fabricate
corpus knowledge. What can be fabricated is the relation claimed about them, and
the licence exists to withhold that.

The substitution bridge refuses this shape, and is right to. A substitution
asserts that two spans mean the same, which no corpus can corroborate for bytes
it has never seen.

## Matcher — the frame inventory

`Precomputed.frames()` reads the ranked candidates as instances of the
question's own frame, through `frameSlots`, which reports and elects nothing
(`match-project.md`).

Its supply is the shared top-`k` resonance, so a frame the corpus instantiates
only once within `k` is out of reach. Measured on the trained store,
`How do you say 'flurbish' in French?` finds one instance of its frame in the
top 24, so `reference` abstains. Widening the supply is not the fix: abstaining
on thin evidence is.

## The reading — instances agree on the outcome

An instance must lead somewhere (an answer that aligns with the question is no
instance of what it asks), read as one structure whose slots are all
substitutions (an insertion or deletion has no occupant to carry), and share at
least one window with the question (a frame with no window in common is chance).

**One frame is one set of positions.** Instances belong to the same frame when
they have the same number of slots, each overlapping its counterpart. A slot's
borders move with bytes two forms share by chance (`Darwin`/`Einstein` both end
in `in`), so the borders do not name the frame. The largest frame is the
question's, and it needs `AGREEMENT = 2` instances: one alignment agrees with
nothing.

**Each instance proposes the answer.** Its continuation is followed, its fillers
replaced by the bytes the question holds in the same slots
(`substituteAll(cont, fillers → referents)`), and the result is that instance's
proposal. Two kinds of dependence fall out of the one construction:

- **template** — the answer holds a filler (`Run gcc hello.c` carries `main.c`);
  its limit, the answer that IS the filler, is extraction
  (`The dog is named Rex.` → `Rex` reads `Clover`);
- **constant** — the answer holds no filler; every occupant gets the same one.

Every instance of the frame must propose the same bytes; one breaking the
pattern refuses all. The template keeps what two forms share, so `Poland` read
against `England` carries `Po` → `Eng` and still says `England`.

Refusals, each with its reason:

- **A fact filed under a filler is not a carriage.** If an instance's answer is
  a continuation of its own filler, it is something the corpus knows _about_
  that filler (a derivation). Two people born in Wellington would give an
  unknown `Zorblax` the same birthplace.
- **A voiced referent reaches one window**, and the referents voiced are a
  minority of the question: the rest is what makes it an instance of the frame.
- Fillers and referents are distinct; no referent lies inside an answered span.
- **Restatement.** An answer that is part of the question is refused, unless the
  instances agree that the answer IS the asker's referent (identity carriage).

## Cost

`moves = STEP · voiced + STEP`: one binding per carried referent and one edge
followed. It is not `CONCEPT`, because the reading is byte identity, not halo.
The matched frame and the carried referents are `accounted`; a slot the answer
does not carry is not explained by it. A constructed answer is `complete`, so
the walk never takes bytes the corpus never said for a trained fact; an identity
reading (the asker's referent read back) is not, and reasoning may go on from
it. The floor is `2·STEP`, checked with `worthRunning` before `frames()` is
touched.

## Provenance

`reference`, with the trace steps `bindReferent` and `referenceLicence`.

## Pins

- `test/76-reference-binding` — the split between inventory and gate; carried,
  absorbed and refused frames; the multi-slot licence; `complete`; the guard on
  answered spans; a fact filed under its filler is no carriage.
- `test/76-type-level-company` — the halo company by type that the inventory's
  supply relies on.
