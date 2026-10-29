# Exact vs Approximate — Scores Propose, Bytes Dispose

> **Law:** vector scores rank candidates and gate breadth. They never decide
> identity. Identity is content-addressed lookup: `resolve`, `findLeaf`,
> `findBranch`, `canonResolve`.

**Why.** Every score is a RaBitQ estimate: 1-bit stored codes against an 8-bit
query, never re-ranked (`geometry.ts`). A decision taken on a score inherits the
estimator's error, and an identity minted from one corrupts every count built on
it; a content address cannot be near-but-wrong. So vectors (gists and halos) say
where to look, and bytes say what is there. Even recall's last echo re-folds the
top hit's bytes.

Two different contents share an id only in the store's near dedup at deposit,
and there structure proposes and bytes decide: one differing span of at most `W`
bytes, the gist clearing `identityBar` besides (`store.md`). Thresholds gate
breadth, not truth.

## Identity, equivalence, and the licence of a transfer

Three relations, never standing in for one another:

- **Identity**: the same content, by content address. A part of a form is
  identical (`identicalAt`) within one window each side, of like size, its raw
  parts at `conceptThreshold`, or where no stored form tells the position apart
  (`discriminates`): `sea-level` is `sea level`; `melting point` is not a stored
  `boiling point`.
- **Company**: halo similarity on the windows touching the mismatch
  (`partingHalo`). It proposes; alone it is a hypothesis (grade 1), never
  testimony.
- **Contextual equivalence** (`licensedSubstitution`): **shown** by a minimal
  pair (a frame holding one span whose twin with the other, found by content
  address, leads to the same continuation; **refuted** if elsewhere, both read
  whole) or by convergence (contexts each holding one span, the asked one where
  the stored one stands, lead to the same continuation: `Did X pass away in E?`
  and `X end`); else **unread**.

`substitutionGrade`: 0 refuted or below the proposal floor, 1 unread with
company at `conceptThreshold` (counted), 2 shown; grade 1 transfers where
nothing refutes, yielding to 2. Every substitution reads it, each side at its
strongest grade (`licensedVariants`). A use names a step only at grade 2
(`evidence.md`); a swapped span answers only under the licence
(`unlicensedSwap`). A canonical site swaps spelling, refused where its role and
the member's (`role.ts`) meet below `significanceBar` on every side both read.
Bars: `thresholds.md`.

## Graded ladders — exact first, never reordered

Six ladders run exact, then halo, then gist; an earlier tier is preferred and
never overridden. A new matcher is a tier of the shared family
(`match-project.md`), gated in `geometry.ts`, never by a private `score >= k`.

- `resolve` (`mind/primitives.ts`): exact fold → canonical class
  (`canonResolve`, hash-then-verify).
- `locate` (`mind/match.ts`): exact bytes → halo role (`substitutes`) → gist
  (identical differing parts, `identicalParts`).
- `alignGraded` (`mind/match.ts`): literal `W`-gram runs → halo-matched sites →
  climb proposals.
- junction `bridge` (`mind/resonance.ts`): containers by DAG ascent →
  continuation edges → halo-synonym containers → resonance.
- `crossRegionVotes` (`mind/attention.ts`): exact joint containers → one synonym
  → two synonyms → `structuralResonance` (an imagined whole: hardest gate, no
  byte containment).
- `chooseNext` (`mind/traverse.ts`): a continuation the question names
  (`evidence.md`) → distributional support (`prevCount`, then halo mass) →
  first-inserted.

## Asymmetries in attention

Two rules in `attention.ts` encode the law, and they must not be flattened:

- Only the **exact** tier may explain other votes away.
- Only **container-backed** evidence may consume its endpoints.

## Pins

- `test/16`, `test/51`, `test/56` — the edge junction, the cross-region ladder,
  and a bridge that admits only what bytes explain end to end.
- `test/42` — recognition is idempotent: identity is byte-determined.
- `test/47`, `test/49`, `test/51`, `test/53`, `test/154` — the licence: refuted
  pairs refuse, shown pairs transfer, company stands alone only at
  `conceptThreshold`, identity within one window, a use named only when shown, a
  pair read past its bound refutes nothing (`test/154.19`).
