# Reference — Voice a Slot With the Asker's Bytes

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

## Election and voicing gates

`electFrame` keeps the modal group of instances that place the question's slots
alike. It needs at least `MIN_INSTANCES = 2`, because one alignment agrees with
nothing. Each instance must also be voiceable:

1. the frame dominates the question, covering more than half of it;
2. every slot reaches one window `W` on both sides;
3. substitutions only, with no insertion or deletion;
4. the fillers are pairwise distinct, the referents are distinct, and no slot
   lies inside an already answered span.

## The licence — what a new referent may inherit

Each instance's continuation is followed, one at a time, because refusal is the
common outcome and usually comes on the second instance. Two checks apply:

- **Co-variation.** `carriesFillers` requires
  `substituteAll(contA, fillersA → fillersB) == contB`, byte for byte, for all
  slots at once. Content that depends on which filler stands in the slot is
  refused.
- **A fact filed under a filler is not a carriage.** A continuation that does
  not vary passes co-variation vacuously, and coincidence lives there. If an
  instance's answer is a continuation of its own filler, it is something the
  corpus knows _about_ that filler. Two people born in Wellington can give an
  unknown `Zorblax` the same birthplace. `Run gcc hello.c` is filed under the
  question alone, so it still carries.

## Cost

`moves = STEP · slots + STEP`: one binding per slot and one edge followed. It is
not `CONCEPT`, because the reading is byte identity, not halo. The matched frame
and every slot are `accounted`, the answer is `complete`, and no scaffolding is
reported. The floor is `2·STEP`, checked with `worthRunning` before `frames()`
is touched.

## Provenance

`reference`, with the trace steps `bindReferent` and `referenceLicence`.

## Pins

- `test/76-reference-binding` — the split between inventory and gate; carried,
  absorbed and refused frames; the multi-slot licence; `complete`; the guard on
  answered spans; a fact filed under its filler is no carriage.
- `test/76-type-level-company` — the halo company by type that the inventory's
  supply relies on.
