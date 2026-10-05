# Memoization — Shared Evidence, Computed Once

> **Law:** asking never writes, so within one response every structural read is
> pure. A memo may skip a probe. It may never change what inference computes.

**Why.** One question is read by up to eight mechanisms, and the same analysis
(the consensus climb, the weave, a resonance query) must not be paid eight
times. Nor may whoever asked first be billed for everyone.

## `Precomputed` — one response, one container (`mind/pipeline-mechanism.ts`)

`think` creates it before any mechanism runs. It is the only place a response's
shared evidence lives.

**Eager**, populated before any `floor` or `run`:

- `rec`, the recognition;
- `computed`, every mechanism's `parse` spans;
- `guide`, the query gist;
- `k = 2·recallQueryK`.

**Lazy**, cached by promise, so the first caller starts the work and every later
caller awaits it:

- `attention()`, the consensus climb;
- `weave()`;
- `resonance()`, the single top-`k` ANN query;
- `frames()`;
- `spanShapedOf(anchor)` / `spanShapedAll()`;
- the window identities `queryWindows`, `queryResolved` and `windowsOf`;
- `reachMemo`.

A mechanism that never asks pays nothing, and two that ask the same question pay
once. A `floor` checks `worthRunning` before it first touches an expensive
analysis (`mechanism-market.md`). Each shared analysis is charged to its own
meter phase through `Precomputed.shared`, never to whichever mechanism touched
it first (`meter.md`).

## Mind memos — `beginResponse` → `endResponse` (`mind/mind.ts`)

`respond` takes fresh maps. `respondTurn` reuses the conversation's maps, which
are content-keyed across turns.

| Memo                                                 | Key                   | Lifetime                            |
| ---------------------------------------------------- | --------------------- | ----------------------------------- |
| `perceiveMemo`                                       | bytes + boundary set  | response or conversation            |
| `recogniseMemo`, `climbMemo`                         | bytes                 | response or conversation            |
| `canonMemo`                                          | bytes                 | response, when a `canon` is set     |
| `_resolvedSubtrees`                                  | tree node (`WeakMap`) | response or conversation            |
| `_edgeChoice` (the pick memo), `_edgeAsked`          | node / question       | response; cleared at the end        |
| `sharedReachMemo`, structural probes (`traverse.ts`) | node                  | cleared on write or at 100K entries |

`foldTree` takes the `_resolvedSubtrees` fast path only when no visitor is
passed. A walk that emits sites always descends in full, and the cache only
elides store probes.

## The trace boundary

A traced response must emit every step and still give the same answer.

- **Bypassed under trace:** the pick memo (`guidedNext`) and `sharedReachMemo`.
  Both return fresh maps, and `chooseNext` recomputes the same pick from the
  store and the question.
- **Always consulted:** `perceiveMemo`, `recogniseMemo` and `climbMemo`.
  Bypassing `recogniseMemo` once re-ran recognition over a warm subtree cache
  and emitted 5 sites instead of 31. That was a change in the answer, not just a
  slowdown.
- **The pick memo is cleared when the climb publishes its points.** A pick made
  earlier read less evidence, and keeping it made traced and untraced responses
  disagree.

## Adding a shared analysis

Add one lazy method to `Precomputed`, never a memo map elsewhere, and guard it
behind `worthRunning` in `floor`.

## Pins

- `test/42` — recognition is idempotent under trace: same site count, same
  cached object.
- `test/155.4` — traced and untraced responses agree once the climb publishes
  its points.
