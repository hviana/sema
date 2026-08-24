# Factored Machinery — One Definition, Many Consumers

Every shared operation is defined once and imported many times. Duplicating it
forks the corpus contract; moving it hides who owns the gate.

For the match → project → gate family see `match-project.md`; for the two
commonality measures see `commonality.md`; for work accounting see `meter.md`.

## Single-definition contracts

| Symbol                                                        | Defined in              | One fact                                                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentLevels`                                               | `src/geometry.ts`       | Single boundary rule: cuts + levels from one rolling hash pass; every segmentation reads it.                                                                              |
| `canonicalWindows` / `chainReach` / `leafIdRun` / `windowIds` | `src/mind/canonical.ts` | Write/read contract: training interns `W-1,W` windows, reading chains to `W²` and probes `W`-windows — drift silences recognition.                                        |
| `junction.ts` + `WalkCache`                                   | `src/mind/junction.ts`  | Shared junction ascent (parents + containers) with bounded `√N·W` walk; `WalkCache` memoizes capped reads/parents/containers per response; bridge and attention share it. |
| `joinWithBridge`                                              | `src/mind/resonance.ts` | One out-of-search assembly: `bridge(left,right)` or bare concat with `bridgeMiss` trace.                                                                                  |
| `dismissedKnownContent`                                       | `src/mind/bridge.ts`    | Pure attestation: any unaccounted `W`-window that resolves as known content — shared gap guard for substitution and CAST.                                                 |
| `sharedReachMemo`                                             | `src/mind/traverse.ts`  | One response-scoped `AncestorReach` memo (cleared on write and for traces); every `reachOf`/`edgeAncestors` consumer shares it.                                           |
| `guidedFirst`                                                 | `src/mind/traverse.ts`  | Guided-or-first answer bytes: `guidedNext` else first-inserted edge (`LIMIT 1`).                                                                                          |
| `leadsSomewhere`                                              | `src/mind/traverse.ts`  | Admission predicate: `hasNext` (cached) or `hasHalo`; sites that lead nowhere contribute no derivation.                                                                   |
| `isChunk`                                                     | `src/sema.ts`           | `kids !== null && kids.every(k=>k.kids===null)` — smallest grouped unit; governs regions, seams, indexing.                                                                |
| `twoEndedSeat`                                                | `src/sema.ts`           | One seat algebra: first half low seats, second half high seats; shared by perception, `fold`, and canonical folds.                                                        |

## Pins

- `test/47` — frame reading split (matcher vs gate vs inventory).
- `test/50` — CAST analog / consensus floor (dismissed content, `MIN_WEAVE` /
  `dominates` frame, `carriesFillers` refusal).
