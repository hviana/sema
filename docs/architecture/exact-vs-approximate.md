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

## Identity, equivalence, and the licence of a transfer

> Identity preserves what was observed; learnt equivalence allows transfer;
> contextual evidence decides when the transfer is legitimate.

Three relations are kept apart, and no reader may stand one in for another:

- **Identity**: the same content. It is decided by content address, and for a
  part of a form by `identicalAt` (`mind/traverse.ts`). The part is identical
  when `identicalParts` holds: at most one window (`W`) on each side, of like
  size (`dominates`), and the raw parts' own geometry at `conceptThreshold`. The
  parts are read raw, never with the bytes the two share, because a shared run
  makes any two spans look alike. Within one window the part also counts as
  identical where the corpus never told the position apart: `discriminates`
  finds no other stored form that holds the same opening and close around it,
  has something else between, and leads elsewhere. `melting point` against a
  stored `boiling point` is another question. A hyphen in `sea-level` is the
  same one.
- **Distributional similarity**: halo company (`halo-sketch.md`). It _proposes_,
  and it never decides alone. Company is read only on the windows that touch the
  mismatch (`partingHalo`). Windows the two sides share would make any pair look
  alike.
- **Contextual equivalence**: the corpus shows that one span stands for another.
  That showing is the licence for a transfer (`licensedSubstitution`):
  - **Minimal pairs** (`minimalPairs`), read from the holders of each side. A
    holder is a frame around the span (a bare form is a category, not a role).
    Its twin with the other span in place is found by content address
    (`resolve`, `canonResolve`). Twins that lead to different continuations are
    **refuted**; twins that lead to the same one are **shown**.
  - **Convergence** (`convergent`): a context holding one span and another
    holding the other, each without the other's span, lead to the same
    continuation. What the stored context says besides its span must be said by
    the asked one too. `Did X pass away in E?` and `X end` converge;
    `Who is the mother of Y?` and `Y father` never do. Convergence is **shown**.
  - Otherwise the licence is **unread**.

`substitutionGrade` combines the two: 0 is refused (refuted, or company below
the proposal floor), 1 stands on company alone (unread, company at
`conceptThreshold`), and 2 is shown. `substitutes` is grade > 0. A reader that
replaces either side keeps each side's strongest grade (`licensedVariants`,
`mind/junction.ts`). Every substitution goes through the grade: synonym
junctions, structural variants, concept hops, `locate`'s halo tier,
articulation's revoicing, the substitution bridge and recall's anchor.

Two readings follow from the licence:

- **A use is company, so company cannot license it.** A step the question names
  by its use (`byUse`, `evidence.md`) is the question's evidence only at
  grade 2. Unlicensed, the use only ranks continuations.
- **A swap without licence is another question.** A stored form that is the
  question with one span swapped answers it only under the licence
  (`unlicensedSwap`). Identical parts are no swap, and neither are parts of
  unlike size. CAST's co-instance refusal and recall's anchor read it.

**Bars on halos.** `significanceBar` is the null of independent vectors, and
halos are not independent (`thresholds.md`). On halos it proposes or ranks.
Company that stands as evidence on its own is held to `conceptThreshold`: the
grade-1 claim, the synonym tiers, and CAST's halo-tier analogy.

## Graded ladders — exact first, never reordered

Six subsystems share one shape: an exact tier, then distributional (halo), then
geometric (gist) tiers. An earlier tier is always preferred, and an approximate
tier never overrides an exact one.

| Site                                     | Ladder, strong → weak                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `resolve` (`mind/primitives.ts`)         | exact fold → canonical class (`canonResolve`, hash-then-verify)                                                                    |
| `locate` (`mind/match.ts`)               | exact bytes → halo role (licensed: `substitutes`) → gist (a segment whose differing parts are identical, `identicalParts`)         |
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
- `test/49`, `test/51`, `test/53` — substitutions go only as far as the licence:
  refuted pairs refuse, shown pairs transfer, and the double synonym is read
  under the licence.
- `test/154`, `test/157` — a use names a step only when shown; agreement is
  unanimity.
- `test/47` — halo company stands alone only at `conceptThreshold`; a comparison
  seats neither a swapped question nor the question itself.
- `test/49` — identity within one window: `melting point` is not a stored
  `boiling point`, while `sea-level` is `sea level`.
- `test/16` — the edge junction end to end.
