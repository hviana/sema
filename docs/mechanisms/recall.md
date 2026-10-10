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

| Tier | Name                                   | Gate                                                                                                                                                                                               | Action                                                                                      |
| ---- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0    | exact identity                         | the question resolves                                                                                                                                                                              | reverse-recall to its best-resonating predecessor, at `STEP`                                |
| 0b   | argument binding                       | one maximal recognised constituent of at least `2W` that is an edge source, nothing substantial outside it; fragments answering other questions set aside first; a blind pick asks the climb first | `follow` its continuation, guided by the whole question                                     |
| 1    | clean resonance                        | per hit, `score ≥ identityBar(D, W, len)`                                                                                                                                                          | `project` the hit. A hit that restates the question goes only through reverse-recall        |
| —    | an argument held under the equivalence | no argument recognised, and a canonical index present                                                                                                                                              | the climb's points that the question canonically contains bind as arguments (`evidence.md`) |
| 2    | scaffolding-dominated                  | resonance `≥ significanceBar`; the climb's anchor clears `consensusFloor(N)` (or is broad with a peak above `ln 2`); the question is not all scaffolding                                           | `project` the anchor at `CONCEPT`                                                           |
| 3    | last resort                            | the share of the question the grounding explains, `max(0, cos − sig)·√(lenG/lenQ) ≥ reachThreshold(W)`                                                                                             | `project` the best grounded hit, at `STEP`                                                  |
| 3b   | substitution bridge                    | only after every gist tier failed (below)                                                                                                                                                          | align and substitute                                                                        |

**Tier 2 refuses three things.** Each would voice the anchor's own occupant as
the asker's:

- a continuation that voices the anchor's displaced filler
  (`voicesDisplacedFiller`);
- a continuation that is a subspan of the question;
- an anchor that is a co-instance of the question (`evidence.md`).

Putting the asker's referent in that place is `reference`'s job, because it
needs the corpus's own evidence of carriage.

## Echo — the refusing tail

When no tier grounds, the top hit's exact cosine is recomputed from its bytes
and read with the same chance-corrected fraction. The outcome is one of two:

- **Silence,** when the fraction is below reach, or when the hit restates the
  question.
- **An echo,** otherwise: the hit's own bytes, labelled `recall-echo` and
  declaring `used: ∅`. It tells the asker that the answer is near, not derived.

## The substitution bridge — refusal path only (`src/mind/bridge.ts`)

The bridge aligns a candidate around the rarest stored windows. A mismatch
becomes a corroborated substitution only when all of these hold:

- the question's span is attested in the corpus;
- the geometry clears `conceptThreshold`, or the halo clears `significanceBar`;
- the frame is unanimous;
- the gap is balanced in length.

Coverage must dominate the question, and no dismissed gap may hide known content
(`dismissedKnownContent`). Each substitution costs `CONCEPT`, and the
substituted spans are accounted. A question made only of scaffolding abstains,
because one substituted word cannot carry it. A context that is another instance
of the question is refused, as tier 2's anchor is. A zero-substitution identity
bridge is `complete`.

## Cost

Tiers 0, 0b, 1 and 3 cost `STEP`. Tier 2 and the bridge cost `CONCEPT` per
substitution or scaffolding step. The floor is `STEP`.

## Pins

- `test/03` — exact identity and reverse-recall.
- `test/16`, `test/56` — corroborated substitutions, the bridge's admission by
  identity; `test/159` 159.11 — no co-instance is bridged.
- `test/73` — a question made only of scaffolding stays silent.
- `test/154.6`, `test/154.8` — no stranger fragment is bound; an argument held
  only under the equivalence binds.
