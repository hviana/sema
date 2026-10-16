# Match → Project → Gate

> **Law:** every grounding mechanism is a configuration
> `(matcher, direction, gate)` over one shared family in `src/mind/match.ts`.
> The family reports and moves. Only the consumer that speaks decides whether a
> shape may be voiced.

## The family

**Match: where the question sits in a learnt form.**

- `locate` — the graded ladder, exact bytes → halo role → gist
  (`exact-vs-approximate.md`); it returns the span found and whether it is the
  needle's bytes (`Located`).
- `alignRuns` — literal `W`-gram runs, the weave.
- `alignGraded` — literal runs plus halo-matched sites and climb proposals.
- `alignAround` / `frameSlots` — one monotone chain from the origin, its gaps
  contracted to their varying core (raw borders kept): the one reading
  `reference` and the substitution bridge both judge.
- `bestHaloMate` — the best halo match within a list.
- `analogyStrength` / `sharedFrameStrength` — distributional and structural
  analogy.

**Project: which way to move along the store from the match.**

- `follow` — forward to a fixpoint. The first hop may be a `conceptHop`, which
  borrows a halo sibling's edge.
- `reverseContext` — backward, to a context.
- `project` — forward, else backward.

**Gate: whether the shape licenses voicing.** There are two readings of
"contained", and they are not interchangeable:

- `isSpanShaped` — the open reading: a sparse subsequence.
- `containsSpan` — the strict reading: a contiguous run, or a resolved node.

One more gate function: `skillExemplar` maps an anchor to its context and
answer.

Every threshold behind a gate is derived in `geometry.ts`.

## Frame reading — the matcher reports, the gate judges, the inventory elects nothing

- **`frameSlots` reports.** It contracts every gap to its varying core
  (`contractGap`), tags it as a `substitution`, `insertion` or `deletion`, keeps
  the gap's position before contraction (`gq`), and attaches `covered`, the
  bytes the frame accounts for. It applies no gate.
- **`reference` judges, byte for byte:** each instance carries the asker's
  referents through its own answer, and the instances of one frame must all
  propose the same bytes (`docs/mechanisms/reference.md`).
- **`Precomputed.frames` is the inventory.** It enumerates every pairing and
  elects nothing. Its supply is the resonance list and the climb's points
  together — the one inventory of forms proposed as instances of the question.

## Why gates belong to the consumer

A gate placed in the shared layer refuses on everyone's behalf. When
`reference`'s voicing gates lived in `frameSlots`, the shared reading became
shaped like `reference`, and it hid three of four real pairings from every other
consumer, including a definite description standing where a noun stands. So each
consumer owns its own refusal:

- `reference` requires substitutions only, a window in common, agreement of the
  frame's instances on the outcome, and voiced referents of at least `W` that
  are a minority of the question.
- CAST, `recall` and `cover` apply their own gates to the same inventory.

## Pins

- `test/47` — the frame reading split into matcher, inventory and gate.
- `test/50` — the shared guards of CAST and `reference`.
- `test/76-reference-binding`, `test/31` I1 — `frameSlots` reports every
  pairing; the two readings of "contained" differ.
