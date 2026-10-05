# Thresholds — Derived, Never Tuned

> **Law:** every decision cutoff is a formula over the vector dimension `D`, the
> perception window `W` (`maxGroup`) or the corpus size `N`. `config.ts` holds
> capacities and budgets only: cache bytes, batch sizes, index parameters, query
> `k`, ALU precision and the seed. It never holds a threshold.

**Why.** A kept memory grows, and a fixed number silently changes meaning as
`N`, `D` or a span's length changes. A derived bar is measured against the
medium's own chance and scale, so there is no development set to overfit and no
calibration that expires with new data. With nothing fitted, a wrong answer
indicts a law, never a parameter.

## Three sources of scale

**`D`: chance.** Random unit vectors have cosine about `N(0, 1/D)`, so one noise
unit is `1/√D`.

- `estimatorNoise = 1/√D`
- `significanceBar = 3/√D`, three noise units above chance
- `conceptThreshold = 0.5 + 0.5/√D`, for halo concept sharing: the structural
  midpoint plus half a noise unit
- `mergeThreshold = 1 − 1/√D`
- `profileCapacity = ⌊√D⌋`, the terms a superposition holds before each falls
  below noise

**`W`: the perception quantum.** Below one window, a byte overlap is chance.

- `identityBar(D, W, len) = max(mergeThreshold, 1 − W/len)`
- `reachThreshold = 1 − 1/(2W)`
- canonical windows of `W−1` and `W` bytes, and `chainReach = W²`

**`N`: commonness,** with `corpusN = max(2, edge sources)`.

- `hubBound = ⌈√N⌉`, the bound on every `LIMIT` read (`hubCap` on lists)
- `consensusFloor = ln N + ½`, for pooled climb votes
- `atomReach = max(1, ⌈N·W/256⌉)`; an atom is a hub when `atomReach > hubBound`

`dominates(part, whole) = 2·part > whole` is the one scale-free bar: a strict
majority.

The vector bars are compared against RaBitQ estimates, not exact cosines. That
is benign for inequality gates over broad regions, and it is why no bar ever
decides identity (`exact-vs-approximate.md`).

The formulas live in `src/geometry.ts`, `src/mind/traverse.ts` (corpus scale)
and `src/mind/canonical.ts` (windows). A new bar is added there, never to
`config.ts`.

## Two derivations that bite

**`identityBar` must scale with length.** A fixed cosine of `1 − 1/√D` over a
`4·√D`-byte span tolerates four whole windows of foreign bytes while still
claiming near-identity. An identity claim may tolerate at most one window (`W`),
so the bar is `1 − W/len`, floored at `mergeThreshold`. Reusing `mergeThreshold`
for a whole-span claim silently widens the tolerance as the span grows.

**A bar is priced for one quantity only.** `consensusFloor` is calibrated for
pooled climb votes, where each region contributes at most `ln(N/c) ≤ ln N`, so
`ln N + ½` asks for corroboration beyond one maximally specific region.
`chooseNext`'s support count is different: it is bounded by retellings of one
fact and does not grow with `N`. Gating that count by `consensusFloor` must
eventually fail, and it did: at N≈325K, a 2-against-1-1-1 corroboration was
refused, and the answer fell back to a noisy concept hop.

## Pins

- `test/64` — `mergeThreshold`, `identityBar` and `reachThreshold`, and the
  scale-aware floor.
- `test/40` — `consensusFloor` must not gate `chooseNext`'s support counts.
- `test/78` — `atomReach`/`atomIsHub`: atoms abstain once the corpus makes them
  hubs.
