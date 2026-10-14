# Recall — The Nearest Stored Form

`recall` answers with the continuation of the stored form nearest the question.
Resonance proposes, and bytes decide (`src/mind/mechanisms/recall.ts`). Its
tiers degrade in order, and each one is priced as what it is. A tier that only
resembles accounts for little, so anything that explains more beats it.

## Supply and budget

All tiers read the response's single top-`k` resonance (`pre.resonance()`,
`k = 2·recallQueryK`), guided by the query gist. The last tier re-folds the
hit's bytes instead of trusting its estimate.

## Tiers

Argument binding (a question's sole edge-source constituent, its continuation
followed) is no recall tier: it is the cover's site and followed edge, voiced
under the cover's output law and taken on by the walk (`cover.md`). On 900 fresh
questions the 293 answers it won are the cover's.

| Tier | Name                  | Gate                                                                                                                                                     | Action                                                       |
| ---- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0    | exact identity        | the question resolves                                                                                                                                    | reverse-recall to its best-resonating predecessor, at `STEP` |
| 1    | self-match            | per hit, `score ≥ identityBar(D, W, len)` proposes; the hit's bytes restate the question                                                                 | reverse-recall to its best-resonating predecessor            |
| 2    | scaffolding-dominated | resonance `≥ significanceBar`; the climb's anchor clears `consensusFloor(N)` (or is broad with a peak above `ln 2`); the question is not all scaffolding | `project` the anchor at `CONCEPT`                            |
| 3b   | substitution bridge   | only after every gist tier failed (below)                                                                                                                | align and substitute                                         |

**Tier 2 refuses three things.** Each would voice the anchor's own occupant as
the asker's:

- a continuation that voices the anchor's displaced filler
  (`voicesDisplacedFiller`);
- a continuation that is a subspan of the question;
- an anchor that is a co-instance of the question (`evidence.md`).

Putting the asker's referent there is `reference`'s job: it needs the corpus's
evidence of carriage.

Two tiers in which the vector decided the grounding were measured to change no
answer (suite, three 2Wiki fixtures) and removed (invariant 3): voicing the
continuation of any hit above the identity bar, and a last resort grounding the
first hit whose projection merely resembled the question.

## Echo — the refusing tail

When no tier grounds, the top hit's exact cosine is recomputed from its bytes
and read with the same chance-corrected fraction. The outcome is one of two:

- **Silence,** when the fraction is below reach, or when the hit restates the
  question.
- **An echo,** otherwise: the hit's own bytes, labelled `recall-echo` and
  declaring `used: ∅`. It tells the asker that the answer is near, not derived.

## The substitution bridge — refusal path only (`src/mind/bridge.ts`)

The bridge reads each of recall's ranked hits that holds one of the question's
rarest stored windows as `reference` reads a frame instance (`frameSlots`). A
mismatch is a corroborated substitution only when:

- the question's span is attested in the corpus;
- the geometry clears `conceptThreshold`, or the halo clears `significanceBar`;
- the frame is unanimous;
- the gap is balanced in length.

The alignment's edges leave at most one window unexplained, and no dismissed gap
may hide known content (`dismissedKnownContent`). Each substitution costs
`CONCEPT`, and the substituted spans are accounted. A question made only of
scaffolding abstains, because one substituted word cannot carry it. A context
that is another instance of the question is refused, as tier 2's anchor is. A
zero-substitution identity bridge is `complete`.

## Cost

Tiers 0 and 1 cost `STEP`. Tier 2 and the bridge cost `CONCEPT` per substitution
or scaffolding step. The floor is `STEP`.

## Pins

- `test/03` — exact identity and reverse-recall.
- `test/16`, `test/56` — corroborated substitutions, the bridge's admission by
  identity; `test/159` 159.11 — no co-instance is bridged.
- `test/73` — a question made only of scaffolding stays silent.
- `test/154.6`, `test/154.8`, `test/154.12` — no stranger fragment is bound; an
  argument held only under the equivalence binds, from any point.
