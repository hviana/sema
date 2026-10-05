# Exact vs Approximate — Scores Propose, Bytes Dispose

> **Law:** vector scores rank candidates and gate breadth. They never decide
> identity. Identity is content-addressed lookup: `resolve`, `findLeaf`,
> `findBranch`, `canonResolve`.

**Why.** Every score is a RaBitQ estimate: 1-bit stored codes scored against a
4-bit query, never re-ranked with exact vectors (`geometry.ts`). A decision
taken on a score inherits the estimator's error, and an identity minted from one
corrupts every count built on it. A content address cannot be near-but-wrong. So
vectors, which cover both gists and halos, say where to look, and bytes say what
is there. Even recall's last echo re-folds the top hit's bytes rather than
trusting its estimate.

The one place two different contents share an id is the store's near-merge at
deposit. There, too, the gist only proposes, and the bytes decide: the two must
differ in a single span of at most `W` bytes (`store.md`). Nowhere else may a
`score >= threshold` test mint an identity. Thresholds gate breadth, not truth.

## Graded ladders — exact first, never reordered

Six subsystems share one shape: an exact tier, then distributional (halo), then
geometric (gist) tiers. An earlier tier is always preferred, and an approximate
tier never overrides an exact one.

| Site                                     | Ladder, strong → weak                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `resolve` (`mind/primitives.ts`)         | exact fold → canonical class (`canonResolve`, hash-then-verify)                                                                    |
| `locate` (`mind/match.ts`)               | exact bytes → halo role → gist                                                                                                     |
| `alignGraded` (`mind/match.ts`)          | literal `W`-gram runs → halo-matched sites → climb proposals                                                                       |
| junction `bridge` (`mind/resonance.ts`)  | containers by DAG ascent → continuation edges → halo-synonym containers → resonance                                                |
| `crossRegionVotes` (`mind/attention.ts`) | exact joint containers → one synonym → two synonyms → `structuralResonance` (an imagined whole: hardest gate, no byte containment) |
| `chooseNext` (`mind/traverse.ts`)        | a continuation the question names (`evidence.md`) → distributional support (`prevCount`, then halo mass) → first-inserted          |

## Asymmetries in attention

Two rules in `attention.ts` encode the law, and they must not be flattened:

- Only the **exact** tier may explain other votes away.
- Only **container-backed** evidence may consume its endpoints.

## Adding a matcher

Add a tier to the shared family in `mind/match.ts` with a gate derived in
`geometry.ts`, never a private `score >= k`. A new mechanism is a
`(matcher, direction, gate)` configuration over that family
(`match-project.md`).

## Pins

- `test/51` — the cross-region ladder and its gating.
- `test/56` — the substitution bridge admits a form as the same one only when
  bytes explain it end to end.
- `test/42` — recognition stays idempotent, because identity is byte-determined,
  not score-determined.
