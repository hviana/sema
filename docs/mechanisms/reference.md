# Reference — Read the Question Through Its Frame's Instances

`reference` learns a frame from worked examples and voices its slot with the
bytes the asker put in that position (`src/mind/mechanisms/reference.ts`). It
asserts _position_, not the equivalence a substitution asserts. The voiced bytes
are the asker's, so they cannot fabricate corpus knowledge; the relation claimed
about them can, and the licence withholds it.

## Matcher — the frame inventory

`Precomputed.frames()` reads the one inventory of proposed instances (the
top-`k` resonance and the climb's points, alternately; `evidence.md`) through
`frameSlots`, which reports and elects nothing (`match-project.md`).

## The frame reading — instances agree on the outcome

An instance leads somewhere, reads as one structure of substitution slots,
shares a window with the question, and dominates it. One frame is one set of
positions (same slots, each overlapping its counterpart); the largest is the
question's and needs `AGREEMENT = 2` instances. Each proposes its continuation
with its fillers replaced by the question's bytes (`substituteAll`): a
**template** answer holds a filler (`Run gcc hello.c` carries `main.c`), a
**constant** one holds none. All must propose the same bytes. Refusals: a fact
filed under a filler (`Zorblax` is not born in Wellington); a voiced referent
under one window, or voiced referents that are most of the question; fillers or
referents not distinct, or a referent inside an answered span; an answer that
restates the question, unless it IS the asker's referent.

## The precedent reading — when no frame licenses

The inventory forms that lead somewhere, share a window and cover most of the
question's discriminating bytes (scaffolding is nobody's evidence,
`commonality.md`) are **precedents**, insertions and deletions included: each
votes for its own continuation, said verbatim, never the asker's bytes. A
continuation holding a precedent's own filler (at window scale) is a carriage or
a fact about it, and the reading abstains (`Run gcc hello.c`,
`… hello is
"Bonjour"`). The answer is the one a majority of precedents lead to; no majority is silence,
and so is another question's answer about one of the question's subjects
(`answersUnasked`). `AGREEMENT` votes or more derive it (`reference`); one
precedent cannot show that what varies does not decide the answer (France says
nothing about Peru), and is said as the nearest stored form, under `recall`.

## Cost

Frame: `moves = STEP · voiced + STEP`, one binding per carried referent and one
edge followed; the matched frame and carried referents are `accounted`.
Precedent: `2·STEP`; what the winning precedents matched is `accounted`, the
rest pays `PASS` per byte. A constructed or precedent answer is `complete`; an
identity reading is not. The floor is `2·STEP`, checked with `worthRunning`
before `frames()`.

## Provenance

`reference` (or `recall` for one precedent), with the trace steps
`bindReferent`, `referenceLicence`, `bindPrecedent` (every precedent, for and
against, and the vote), `precedentLicence` and `unaskedPrecedent`.

## Pins

- `test/76-reference-binding` — carried, absorbed and refused frames; the
  multi-slot licence; `complete`; answered spans; a fact filed under its filler;
  precedents that agree, outvote, tie, or stand alone.
