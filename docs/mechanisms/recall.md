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

A question's sole edge-source constituent, its continuation followed, is the
cover's site, not a recall tier (`cover.md`).

| Tier | Name                  | Gate                                                                                                                                                     | Action                                                       |
| ---- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0    | exact identity        | the question resolves                                                                                                                                    | reverse-recall to its best-resonating predecessor, at `STEP` |
| 1    | self-match            | per hit, `score ≥ identityBar(D, W, len)` proposes; its bytes restate the question, or write it with one identical part (`writesTheQuestion`)            | reverse-recall; a hit written differently is `project`ed     |
| 2    | scaffolding-dominated | resonance `≥ significanceBar`; the climb's anchor clears `consensusFloor(N)` (or is broad with a peak above `ln 2`); the question is not all scaffolding | `project` the anchor at `CONCEPT`                            |
| 3b   | substitution bridge   | only after every gist tier failed (below)                                                                                                                | align and substitute                                         |

**Tier 2 refuses five things.** Each would voice the anchor's own occupant, or
another question's answer, as the asker's:

- a continuation that voices the anchor's displaced filler
  (`voicesDisplacedFiller`);
- a continuation that is a subspan of the question;
- an anchor that is a co-instance of the question (`evidence.md`);
- an anchor that is the question with one piece swapped, unlicensed
  (`unlicensedSwap`, `exact-vs-approximate.md`): `… largest planet …` is no
  answer to `… largest ocean …`, while `sea-level` is `sea level`;
- an answer to another question about one of the question's subjects
  (`answersOtherQuestions`, `answersUnasked`; trace `unaskedAnchor`).

Putting the asker's referent there is `reference`'s job: it needs the corpus's
evidence of carriage.

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
- the two are identical (`identicalAt`), or the swap is licensed (`substitutes`,
  `exact-vs-approximate.md`);
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

- `test/03` — exact identity and reverse-recall; a stored question written
  differently answers by its continuation, a told-apart neighbour does not.
- `test/16`, `test/56` — corroborated substitutions, the bridge's admission by
  identity; `test/159.11` — no co-instance is bridged.
- `test/73` — a question made only of scaffolding stays silent.
