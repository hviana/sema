# Reference — Read the Question Through Its Frame's Instances

`reference` learns a frame from worked examples and voices its slot with the
bytes the asker put in that position (`src/mind/mechanisms/reference.ts`). It
asserts _position_ ("this is the thing you named, where the corpus keeps one"),
not the equivalence a substitution asserts, which no corpus can corroborate for
bytes it never saw. The voiced bytes are the asker's, so they cannot fabricate
corpus knowledge; the relation claimed about them can, and the licence withholds
it.

## Matcher — the frame inventory

`Precomputed.frames()` reads the one inventory of proposed instances (the
top-`k` resonance and the climb's points, alternately; `evidence.md`) through
`frameSlots`, which reports and elects nothing (`match-project.md`). A frame
instantiated once there is out of reach: `How do you say 'flurbish' in French?`
finds one instance in the trained store's top 24: `reference` abstains.

## The reading — instances agree on the outcome

An instance leads somewhere, reads as one structure whose slots are all
substitutions (an insertion has no occupant to carry), shares a window with the
question, and dominates it, or it is another sentence that happens to align
(`… the language of Nepal and in the language of Oman` is no instance of
`The capital of X is …`).

**One frame is one set of positions.** Same number of slots, each overlapping
its counterpart: borders move with bytes shared by chance (`Darwin`/`Einstein`
end in `in`). The largest is the question's, and needs `AGREEMENT = 2`
instances.

**Each instance proposes the answer**: its continuation, its fillers replaced by
the question's bytes in the same slots (`substituteAll`):

- **template**: the answer holds a filler (`Run gcc hello.c` carries `main.c`);
  at the limit it IS the filler, an extraction (`The dog is named Rex.`);
- **constant**: the answer holds no filler; every occupant gets the same one.

Every instance must propose the same bytes; one breaking the pattern refuses
all. Refusals:

- **A fact filed under a filler is not a carriage.** An answer continuing its
  own filler is knowledge _about_ it: two people born in Wellington would give
  `Zorblax` their birthplace.
- **A voiced referent reaches one window**, and the voiced referents are a
  minority of the question.
- Fillers and referents are distinct; no referent lies inside an answered span.
- **Restatement**: an answer inside the question, unless the instances agree it
  IS the asker's referent (identity carriage).

## Cost

`moves = STEP · voiced + STEP`: one binding per carried referent and one edge
followed, not `CONCEPT`: the reading is byte identity. The matched frame and the
carried referents are `accounted`. A constructed answer is `complete`, so the
walk never extends bytes the corpus never said; an identity reading is not. The
floor is `2·STEP`, checked with `worthRunning` before `frames()`.

## Provenance

`reference`, with the trace steps `bindReferent` and `referenceLicence`.

## Pins

- `test/76-reference-binding` — inventory apart from gate; carried, absorbed and
  refused frames; the multi-slot licence; `complete`; answered spans; a fact
  filed under its filler.
- `test/76-type-level-company` — the halo company by type that the inventory's
  supply relies on.
