# Reference — Voicing a Slot with the Asker's Bytes

Reference voices a slot of a learned frame with the bytes the asker supplied in
that position — asserting _position_, not equivalence. The bytes are the
asker's, so voicing them cannot fabricate corpus knowledge; the fabricable claim
is the _relation_ about them, which the licence withholds.

## Matcher — `frameSlots` inventory

The shared matcher is `frameSlots` (`src/mind/match.ts`) via
`Precomputed.frames()`.

- Seeded at origin `(0,0)`, `alignAround` finds common runs (seed `W`) then
  sweeps both directions; each gap is contracted by `contractGap` to its varying
  core (shared prefix/suffix stripped) and tagged
  `substitution | insertion | deletion`.
- `frameSlots` **reports, never judges**: every gap (any kind, any size), sorted
  by `qs`, plus `covered` (shared bytes) and `matched` spans. No gate is applied
  there.

## Gate — reference elects and licences; matcher does not

All voicing gates belong to the **consumer**
(`src/mind/mechanisms/reference.ts`), not the matcher. A shared layer that
refused on their behalf would be reference-shaped and hide most real pairings.

- **Election:** `electFrame` groups inventory by full slot signature
  (`qs:qe,...`) and keeps the modal group — one frame, not one slot.
- **Carriage licence:** `carriesFillers` —
  `substituteAll(contA, fillersA→fillersB) == contB` byte-exact, all slots
  simultaneously (longest needle first). Constant continuations pass vacuously;
  filler-dependent content is refused.
- **Four voicing gates** (in `voiceable` + caller):
  1. frame `dominates` query (`covered > |query|/2`);
  2. every slot reaches one window `W` on _both_ sides;
  3. no insertion/deletion (substitutions only);
  4. fillers pairwise distinct. Additional: referents pairwise distinct and no
     slot inside `answeredSpans`.

Matched frame + every slot is `accounted`; `complete: true`.

## Cost

`moves = STEP·slots + STEP` (one binding per slot + one edge follow). Not
`CONCEPT` — byte identity, not halo. `scaffolding` is never reported; a referent
is explained, not carried for lack of explanation.

`floor` is `STEP+STEP`, investment-disciplined before touching `frames()`.

## Provenance

`provenance: "reference"` with trace steps `bindReferent` / `referenceLicence`.

## Pins

- `test/76-reference-binding` — inventory vs gate split, carried/absorbed/
  refused, multi-slot licence, `complete` and answered-span guard.
- `test/76-type-level-company` — type-level halo company underpinning.
