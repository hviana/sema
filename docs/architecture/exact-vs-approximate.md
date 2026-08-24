# Exact vs Approximate — The Law and Its Five Ladders

Vector scores (`resonate` / `resonateHalo`) are RaBitQ **estimates**. They rank
candidates and gate broad regions; they never decide identity. Identity is
decided only by content-addressed lookup — `resolve` / `findLeaf` / `findBranch`
/ `canonResolve` — and by re-folding bytes to verify.

## The law

> Scores propose, bytes dispose.

Even recall's echo decision re-folds the top hit's bytes rather than trusting
the estimate it already has. No `score >= threshold` path may mint an identity
claim; thresholds derived in `geometry.ts` gate search breadth, not truth.

## Graded evidence ladders

Five subsystems share one shape — **exact → distributional → geometric** — with
earlier tiers strictly preferred. Never reorder tiers; never let an approximate
tier override an exact one.

| # | Site               | Ladder (strong → weak)                                                                                                   | File                                      |
| - | ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 1 | `resolve`          | exact content-addressed fold → `canonResolve` (equivalence class, hash-then-verify)                                      | `mind/primitives.ts`                      |
| 2 | `locate`           | exact bytes → halo role → gist                                                                                           | `mind/match.ts`                           |
| 3 | `alignGraded`      | literal W-gram runs → halo-matched sites + climb proposals (weave)                                                       | `mind/match.ts` / `pipeline-mechanism.ts` |
| 4 | `bridge`           | junction containers → edge → synonym → whole-gist                                                                        | `mind/resonance.ts`                       |
| 5 | `crossRegionVotes` | exact containers → single synonym → double → `structuralResonance` (synthetic gist, gated hardest — no byte containment) | `mind/attention.ts`                       |

## Asymmetries (attention)

Two rules in `attention.ts` encode "exact decides" and must not be flattened:

- Only the **EXACT** tier may explain ordinary votes away.
- Only **container-backed** evidence may consume its endpoints.

## Pins

- `test/51` pins the cross-region tier ladder and its gating.
- Recognition idempotence under trace (`test/42`) depends on exact identity
  remaining byte-determined, not score-determined.

## Adding a matcher

Add a tier to the shared family in `mind/match.ts` with a derived gate
(`geometry.ts`), never a private `score >= k` check. A new mechanism is a
`(matcher, direction, gate)` configuration over that family (§2.5).
