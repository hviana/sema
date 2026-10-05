# INVARIANTS — Where Each Law Lives and What Pins It

`AGENTS.md` §2 names the five invariants that every change must keep. This table
routes all fifteen laws (numbered as in `INDEX.md`) to the code that defines
them and the tests that fail when they break.

| #  | Law                    | Defined in                                                                                                                                 | Pins                                         |
| -- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 1  | Determinism            | `config.ts` (`seed`), `alphabet.ts`, `traverse.ts` (`guidedFirst`, `chooseNext`)                                                           | `test/20`, `test/42`                         |
| 2  | Derived thresholds     | `geometry.ts`, `traverse.ts` (`corpusN`, `hubBound`, `atomReach`), `canonical.ts` (`chainReach`)                                           | `test/40`, `test/64`, `test/78`              |
| 3  | Exact decides          | `mind/primitives.ts` (`resolve`, `exactNode`), `match.ts` (`locate`, `alignGraded`), `resonance.ts` (`bridge`), `attention.ts`             | `test/51`, `test/56`                         |
| 4  | One cost currency      | `graph-search.ts` (`MICRO`, `STEP`, `CONCEPT`, `PASS`), `src/derive` (min, +), `attention.ts` (`poolVotes`, +, +), `pipeline.ts` (`weigh`) | `test/04`, `test/55`, `test/151`             |
| 5  | Match → project → gate | `match.ts`                                                                                                                                 | `test/24`, `test/47`, `test/76`              |
| 6  | Mechanism market       | `pipeline-mechanism.ts` (`PipelineMechanism`, `Precomputed`), `pipeline.ts` (`think`, `worthRunning`)                                      | `test/01`, `test/04`, `test/153`             |
| 7  | Commonality            | `traverse.ts` (`reachOf`, `dominates`, `hubWindows`), `cast.ts` (`depth[]`, `MIN_WEAVE`), `bridge.ts` (rarity)                             | `test/17`, `test/34`, `test/73`              |
| 8  | Bounded reads          | `store.ts` (`*First`, `containersSlice`, `has*`, `bytesPrefix`, `chainRun`), `traverse.ts` (`hubBound`, `hubCap`)                          | `test/14`, `test/89`, `test/90`, `test/119`  |
| 9  | Store                  | `store.ts` (`AbstractStore`, `intern`), `store-sqlite.ts`                                                                                  | `test/02`, `test/08`, `test/36-bloom`        |
| 10 | Fold contract          | `geometry.ts` (`contentLevels`, `contentIdentity`), `primitives.ts` (`branchNaming`), `canonical.ts`, `canon.ts`                           | `test/59`, `test/63`, `test/148`, `test/152` |
| 11 | Memoization            | `pipeline-mechanism.ts` (`Precomputed`), `mind.ts` (`beginResponse`, `endResponse`)                                                        | `test/42`, `test/155.4`                      |
| 12 | Saturation             | `traverse.ts` (`edgeAncestors`), `junction.ts` (`junctionContainersFrom`), `resonance.ts` (`pivotInto`), `types.ts` (`SaturationStop`)     | `test/16`, `test/27`, `test/34`, `test/49`   |
| 13 | Meter                  | `meter.ts`, `Precomputed.shared`                                                                                                           | `test/55`                                    |
| 14 | Closure                | `derivation.ts` (`admissible`, `advance`, `closeOver`)                                                                                     | `test/133`–`151`                             |
| 15 | Witnessed evidence     | `evidence.ts` (`witness`, `windowIndex`), `traverse.ts` (`chooseNext`, `answersOtherQuestions`, `coInstanceFiller`, `scaffoldExtents`)     | `test/154`, `test/155`, `test/76`            |

Caches (`caches.md`: every acceleration is a `BoundedMap`, and a miss
re-derives) are pinned by `test/91` and `test/96`.

## Honest silence

Every law above serves one contract the code cites by this file's name: **when
the evidence does not decide, say less, never something invented.** A budget
that runs out abstains and is counted (`junctionBudgetExhausted`). A cache miss
re-derives, never approximates. A question whose every window is scaffolding is
not bridged. When nothing accounts for the question, the price makes silence the
lightest answer, and an answer that is only near says so. A gap is honest; an
assembly carrying content the evidence did not license is a fabrication. Pinned
by `test/28`, `test/73` and `test/84`.
