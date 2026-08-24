# Memoization — Shared Evidence Without Duplication

> **Law:** asking never writes, so structural reads are pure during one
> response. Memoization elides probes, not evidence.

Two layers: `Precomputed` (response-scoped shared analyses) and `Mind`
per-response memos. Both are accelerators that must not change what inference
computes.

## Precomputed — one response, one container

`Precomputed` (`src/mind/pipeline-mechanism.ts`) is the sole place a response's
shared evidence lives. Created by `think` (`src/mind/pipeline.ts`) before the
mechanism loop.

### Eager — populated before any `floor`/`run`

- `rec: Recognition` — structural + canonical decomposition (`recognise`)
- `computed: ComputedSpan[]` — `parse()` results from all mechanisms (e.g. ALU)
- `guide: Vec` — query gist, the response-wide disambiguation guide
- `k: number` — `cfg.recallQueryK * 2`, the breadth for resonance/weave/climb

### Lazy — computed on first touch, cached by promise

Expensive analyses are `async` and cached by promise: the first caller starts
the work, every later caller awaits the same promise.

- `attention()` — `climbAttentionAll` (roots + ranked anchors)
- `weave()` — `alignGraded` over top-k anchors
- `resonance()` — `store.resonate(guide, k)` (single ANN query)
- `frames()` — `frameSlots` inventory from resonance
- `spanShapedOf(anchor)` / `spanShapedAll()` — per-anchor `skillExemplar`,
  memoised per id
- `queryWindows` / `queryResolved` / `windowsOf(anchor)` — W-window identities
- `reachMemo` — `sharedReachMemo(ctx)` (ancestor reach, § below)

A mechanism that never asks pays nothing; two mechanisms asking the same
question pay once. `floor()` must gate on `worthRunning` before first-touching
an expensive analysis.

## Mind memos — `beginResponse` → `endResponse`

`Mind` (`src/mind/mind.ts:beginResponse`/`endResponse`) swaps per-response state
for each inference call. `respond` takes fresh maps; `respondTurn` reuses the
conversation's persistent ones (content-keyed, cross-turn).

| Memo                | Key                                       | Scope                                        |
| ------------------- | ----------------------------------------- | -------------------------------------------- |
| `perceiveMemo`      | `perceiveKey(bytes)` (latin1)             | response / conversation                      |
| `recogniseMemo`     | `latin1Key(bytes)`                        | response / conversation                      |
| `climbMemo`         | `latin1Key(bytes)`                        | response / conversation                      |
| `canonMemo`         | `latin1Key(bytes)`                        | response (when `canon` set)                  |
| `_resolvedSubtrees` | `WeakMap<Sema, {id,len}>` (node identity) | response / conversation                      |
| `_edgeChoice`       | `Map<nodeId, pick>`                       | response only — **cleared** in `endResponse` |
| `_gistCache`        | `BoundedMap<nodeId, Vec>` 32 MB           | **session-lifetime** (not per-response)      |

`_gistCache` (≈ 8K gists at D=1024) survives across responses; all others are
dropped or cleared at `endResponse`. `_resolvedSubtrees` elides store probes
when `visit` is absent; with a visitor it still walks in full (see
`src/mind/primitives.ts:foldTree`).

## Trace boundary — what is bypassed

Traced responses must emit every step, but must not change the answer.

- **Bypassed:** `_edgeChoice` via `guidedNext`
  (`src/mind/traverse.ts:guidedNext`) and `sharedReachMemo`
  (`src/mind/traverse.ts:sharedReachMemo`). Both return fresh empty maps when
  `ctx.trace !== null`; `chooseNext` recomputes identically (pure over store +
  guide).
- **Always consulted:** `perceiveMemo`, `recogniseMemo`, `climbMemo` (and their
  underlying `perceive`/`recognise`/`climbAttention` caches). Bypassing breaks
  idempotence.

`foldTree`'s subtree fast path is taken only when no `visit` is supplied. With a
visitor (recognition, attention) the walk still descends; the cache elides only
probes. Bypassing `recogniseMemo` under trace re-ran `recogniseImpl` with a warm
`_resolvedSubtrees` and emitted fewer sites (observed 31 → 5) — a correctness
change, not just a slowdown.

## Meter — charge work to itself

Shared analyses are charged to their own phase (`meter.time(phase, fn)` in
`Precomputed.shared`), not to the mechanism that first touched them
(`src/meter.ts:PhaseCost`). Without this, the profile reads "cast.floor costs 2
s" when the cost was the consensus climb cast paid for on everyone's behalf.

## Adding a shared analysis

Add one lazy method to `Precomputed`. No new memo map elsewhere. Gate it behind
`worthRunning` in `floor()`.

## Pins

- `test/42` — recognition idempotence under trace: traced and untraced
  `recognise` return the same site count and cached object.
