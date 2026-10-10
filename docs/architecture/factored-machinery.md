# Factored Machinery — One Definition, Many Consumers

> **Law:** every operation that more than one layer relies on is defined once
> and imported everywhere. A second copy is a write/read drift waiting to
> happen. A copy moved into a consumer hides who owns the gate.

Each row is a contract that broke at least once when it existed twice:

- `contentBoundaries` carried its own hash loop;
- the ingest cache re-implemented deposit;
- recall spelled its own fragment test.

## Single-definition contracts

| Symbol                                                                 | Home                                  | The one fact it owns                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentLevels`                                                        | `geometry.ts`                         | the boundary rule: cuts and levels from one rolling hash (`fold-contract.md`)                                                                                   |
| `groupByLevel` / `foldSlice`                                           | `geometry.ts`                         | the tree's shape, written once over two algebras (vector and identity)                                                                                          |
| `twoEndedSeat`                                                         | `sema.ts`                             | the seat algebra: low seats for the first half, high seats for the second                                                                                       |
| `isChunk`                                                              | `sema.ts`                             | the smallest grouped unit, a node whose children are all leaves                                                                                                 |
| `exactNode` / `branchNaming`                                           | `mind/primitives.ts`                  | exact lookup: the identity fold, naming a branch exactly as `intern` does                                                                                       |
| `canonicalWindows` / `chainReach` / `leafIdRun` / `windowIds`          | `mind/canonical.ts`                   | the window contract: deposits intern windows of `W−1` and `W`, and reads chain them to `W²`                                                                     |
| `leadsSomewhere`                                                       | `store.ts`, memoized in `traverse.ts` | admission: `hasNext \|\| hasHalo`                                                                                                                               |
| `boundFor` / `corpusN` / `hubBound` / `hubCap`                         | `geometry.ts`, `mind/traverse.ts`     | the scale and its cap (`bounded-reads.md`)                                                                                                                      |
| `sharedReachMemo`                                                      | `mind/traverse.ts`                    | one `AncestorReach` memo for every `reachOf`/`edgeAncestors` consumer                                                                                           |
| `answersOtherQuestions`                                                | `mind/traverse.ts`                    | the fragment predicate: a form inside other forms, with several continuations or one it only inherited, that the question leaves partly outside (`evidence.md`) |
| `junctionContainersFrom` + `WalkCache`                                 | `mind/junction.ts`                    | the content-addressed ascent shared by the bridge and attention                                                                                                 |
| `joinWithBridge`                                                       | `mind/resonance.ts`                   | joining two results outside the search: `bridge(left, right)`, or a bare join traced as `bridgeMiss`                                                            |
| `dismissedKnownContent`                                                | `mind/bridge.ts`                      | the gap guard shared by substitution and CAST: no dismissed window may resolve as known content                                                                 |
| `locate` / `alignGraded` / `frameSlots` / `project`                    | `mind/match.ts`                       | the matcher family; gates belong to the consumers (`match-project.md`)                                                                                          |
| `witness` / `windowIndex`                                              | `mind/evidence.ts`                    | order-free W-window coverage, the evidence reading (`evidence.md`)                                                                                              |
| `closed` / `admissible` / `advance` / `closeOver` / `unexplainedSpans` | `mind/derivation.ts`                  | the closure law, its span algebra and its engine (`closure.md`)                                                                                                 |
| `Precomputed`                                                          | `mind/pipeline-mechanism.ts`          | the per-response shared analyses (`memoization.md`)                                                                                                             |
| `weigh`                                                                | `mind/pipeline.ts`                    | the price, `moves + PASS·unaccounted` (`cost-model.md`)                                                                                                         |
| `Meter`                                                                | `meter.ts`                            | every counter name (`meter.md`)                                                                                                                                 |

## Pins

- `test/137` — the law lives once and below: no hand-built transition outside
  `advance`, no inline re-spelling of a law reading, and no dead export.
- `test/47` — the frame reading split into matcher, inventory and gate.
- `test/50` — CAST's shared guards: dismissed content, the frame from
  `MIN_WEAVE` and `dominates`, and the `carriesFillers` refusal.
