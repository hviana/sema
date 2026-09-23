# Match → Project → Gate

Every grounding mechanism is a configuration of one shared operation in
`src/mind/match.ts`. The family is defined once and imported many times;
duplicating it forks the corpus contract, moving it hides who owns the gate.

## The shared family in `mind/match.ts`

The match layer locates structure, the project layer moves along the store, and
the gate layer decides whether the shape licences voicing. All three are pure
functions over bytes and the store — no mechanism owns a private copy.

## The triple

| Role                          | Symbols                                                                                                                                                                                                                                                                                          | What it does                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Match** (locate structure)  | `locate` (exact → halo → gist ladder), `alignRuns` (literal W-gram weave), `alignGraded` (literal + halo gaps), `alignAround` / `frameSlots` (seeded frame with contracted gaps), `bestHaloMate` (in-list halo), `analogyStrength` / `sharedFrameStrength` (distributional + structural analogy) | Finds where a query sits in a learnt form.                                              |
| **Project** (direction)       | `follow` (forward to fixpoint, first hop may `conceptHop`), `reverseContext` (reverse to context), `project` (forward else reverse), `conceptHop` (halo sibling with edge)                                                                                                                       | Moves along the store from the match — forward toward answers, reverse toward contexts. |
| **Gate** (structural licence) | `isSpanShaped` (OPEN reading — sparse subsequence), `containsSpan` (STRICT reading — contiguous run or resolved node), `skillExemplar` (anchor → context + answer), `carriesFillers` (substitution carriage — strict voicing licence)                                                            | Two readings; not interchangeable.                                                      |

Mechanisms declare only `(matcher, direction, gate)`. Thresholds behind gates
live in `src/geometry.ts` — the match layer never invents a cutoff.

The graded ladder inside `locate` is exact → distributional → geometric:
content-addressed identity first, halo similarity second, gist resonance last.
Reordering the ladder or letting an approximate score override an exact hit is a
correctness bug (see `exact-vs-approximate.md`).

## Frame reading — matcher reports, gate judges, inventory elects nothing

`frameSlots` is the shared frame reader. It contracts every gap via
`contractGap` to its varying core, tags it `substitution` / `insertion` /
`deletion`, and attaches `covered` — the bytes the frame accounts for. It
applies no gate; it reports.

`carriesFillers` is the substitution gate. It judges byte-exactly:

```
substituteAll(contA, fillersA → fillersB) == contB
```

If the equality holds, voicing through the slot is a derivation; if not, the
slot cannot carry. This is the only place that decision is made.

`Precomputed.frames` is the inventory. It enumerates every frame pairing the
match layer finds and elects nothing — ranking and refusal belong to the
consumer.

## Voicing gates belong to the consumer

The shared layer never refuses on a consumer's behalf. Reference owns its four
gates: frame dominates the query, each slot reaches `W` on both sides, no
insertion/deletion, fillers pairwise distinct — plus `carriesFillers` on the
chosen pair. CAST, recall, and cover each apply their own gate over the same
shared inventory. Moving a consumer's gate into `match.ts` would hide who is
responsible for the refusal.

## Pins

- `test/47` — frame reading split (matcher vs gate vs inventory).
- `test/50` — CAST / reference voicing via `carriesFillers`.
- `test/24` / `test/76` — match/project family and span-shape readings.
