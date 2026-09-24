# Thresholds — derived, never tuned

Every decision cutoff is a formula over `D` (vector dimension), `W` (`maxGroup`,
perception window), or `N` (corpus size). No threshold is tuned or added to
`src/config.ts`.

## Source of truth

- `src/geometry.ts` — all similarity/decision thresholds.
- `src/mind/traverse.ts` — corpus-scale readings that parameterise bounded
  walks.
- `src/sema.ts` — positional coordinate algebra.
- `src/config.ts` — capacities and budgets only (cache byte budgets, batch
  sizes, index parameters, query `k`, ALU precision, seed). Never a threshold.

## Geometry thresholds (`src/geometry.ts`)

| Symbol                  | Definition                                                                   | Formula                             |
| ----------------------- | ---------------------------------------------------------------------------- | ----------------------------------- |
| `mergeThreshold(D)`     | Cosine below which two gists are near enough to consider merging             | `1 - 1/√D`                          |
| `identityBar(D,W,len)`  | Scale-aware whole-span identity claim                                        | `max(mergeThreshold(D), 1 - W/len)` |
| `reachThreshold(W)`     | Recall confidence floor — half a river quantum                               | `1 - 1/(2·W)`                       |
| `estimatorNoise(D)`     | RaBitQ noise floor — 1σ of random cosine                                     | `1/√D`                              |
| `significanceBar(D)`    | Whole-query relatedness — 3σ above chance                                    | `3/√D`                              |
| `conceptThreshold(D)`   | Halo concept sharing — structural midpoint + ½σ                              | `0.5 + 0.5/√D`                      |
| `dominates(part,whole)` | Half-dominance predicate                                                     | `part*2 > whole`                    |
| `profileCapacity(D)`    | Superposition capacity — terms before readout collapses                      | `floor(√D)` (min 1)                 |
| `consensusFloor(N)`     | Pooled-vote significance floor                                               | `ln(N) + ½`                         |
| `coverageBar(_,D)`      | Reach-index gating (currently unused hot-path; batch compaction replaces it) | `conceptThreshold(D)`               |

`N` in `consensusFloor` is `corpusN` (edge-source count, floored at 2).

## Corpus-scale readings (`src/mind/traverse.ts`)

| Symbol           | Definition                                             | Formula                     |
| ---------------- | ------------------------------------------------------ | --------------------------- |
| `corpusN`        | Distinct learnt contexts, floored                      | `max(2, edgeSourceCount())` |
| `hubBound`       | Hub bound, used for every `LIMIT` read                 | `ceil(√max(2,N))`           |
| `hubCap(ids)`    | Fan-out cap — list-side reading of `hubBound`          | `ids.slice(0, hubBound)`    |
| `atomReach(N,W)` | Uniform-expectation floor on a byte atom's commonality | `max(1, ceil(N·W/256))`     |
| `atomIsHub(N,W)` | Whether atom abstains as consensus voter               | `atomReach > hubBound`      |

`hubBound` is enforced at the store level (`nextFirst`, `parentsFirst`,
`containersSlice`, `hasNext`/`hasParents`, `bytesPrefix`, `chainRun`).
`atomReach` is the honest floor for atoms — they carry no kid/contain rows, so
their reach is unmeasurable and must not default to "maximally rare".

## Seat algebra (`src/sema.ts`)

`twoEndedSeat(seatCount, size, index)` — the one positional-coordinate algebra
shared by perception, `fold`, and every synthetic/canonical fold. First half
uses low seats, second half uses high seats:
`index < (size+1)/2 ? index : seatCount-size+index`.

## Two derivations that bite

**1. `identityBar` is scale-aware.** A fixed cosine `1-1/√D` over a `4·√D`-byte
span tolerates four whole windows of foreign bytes while still claiming
"near-identical". An identity claim may tolerate at most one window `W` (the
perception quantum, same budget as `differsByOneWindow` in near-dedup), so the
bar must be `1-W/len` floored at `mergeThreshold`. Reusing `mergeThreshold` for
a whole-span claim silently widens the byte budget with span length.

**2. `consensusFloor` is priced for pooled climb votes, not for support
counts.** Each region contributes at most `ln(N/c) ≤ ln(N)`; `ln(N)+½` demands
corroboration beyond one maximally-specific region. `chooseNext`'s `bestSupport`
(`prevCount` of one destination) is N-invariant — bounded by retellings of that
fact, not by `N`. Gating it against `consensusFloor` guarantees failure once `N`
is large enough (observed: 2-vs-1-1-1 corroboration refused at N≈325K, falling
back to a noisy concept-hop).

## Pins

- `test/40-choosenext-scale-guard` — `consensusFloor` must not gate `chooseNext`
  support counts.
- `test/64-two-ended-thresholds` — `mergeThreshold` / `identityBar` /
  `reachThreshold` derivations and the scale-aware floor.
- `test/78-atom-hub-recognition-cliff` — `atomReach` / `atomIsHub` hub
  abstention at scale.
