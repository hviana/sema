# Commonality — What Is Shared, Relative to Whom

> **Law:** every judgement of relevance cuts a population into what it shares
> (frame, scaffolding) and what varies (filler, the discriminating part). The
> cut is always read over a named population. Sema uses three populations, with
> three measures, and never substitutes one for another.

Commonality and discrimination are the two sides of one cut, and the cut has no
absolute answer. `the importance of` is frame among the essay prompts aligned to
a question and filler across the corpus. Reading one population's cut with
another population's measure was refuted every time it was tried (`test/17`, and
the container-as-hub saturation in `saturation.md`).

## The three populations

**Corpus contexts: how widely a node is used.**

- Measure: `reachOf(id, N)`, the learnt contexts its climb reaches through its
  neighbourhood (`saturation.md`), capped and memoized in `sharedReachMemo`.
- Cut: `dominates(reach, N)`. A majority is scaffolding, and a minority
  discriminates. The climb reads the graded form of the same cut, weighing a
  region by `ln(N/c)`.
- Read by the consensus climb, `confluence`'s gate and the substitution bridge.

**The cohort: the structures aligned to this question.**

- Measure: `depth[i]`, the number of distinct structures in the weave that cover
  byte `i`. They are counted as distinct, never by weight.
- Cut: `frame(i) ⇔ depth[i] > AGREEMENT ∧ dominates(depth[i], aligned)`, with
  `AGREEMENT = 2`, because a pair is ambiguous when insertions are possible.
- Read by CAST (`cast.ts`).

**Places: where a window occurs.**

- Measure: `windowRarity(id, bound + 1)`, the distinct chunks the window
  overlaps plus the forms it is a child of: the fold interns one window as a
  chunk of one form and as a run across another's (a shared opening: one chunk,
  54 parents). Reuse, not holders (read by bytes, `heldElsewhere`).
- Cut: `0` anchors nothing, `≥ 2` marks reuse, and past the hub bound,
  scaffolding.
- Read by `hubWindows`, `scaffoldExtents`, `allWindowsAreScaffolding` and every
  rarest-window choice (the bridge's anchors, a frame's siblings).

**Scaffolding is nobody's evidence and nobody's debt.** A window in more than
`√N` places explains nothing, because every fact holds it. So a step cannot pay
the question by restating `is`, and a cover span made only of scaffolding is not
accounted (`evidence.md`).

`hubWindows` floors that bound at `chainReach(W) = W²`: one deposit's fold
already gives a window up to that many chunks and branches, so on a store of a
few facts `√N` alone would call every window scaffolding (`test/22`).

Two limits bound every cut. Below lies chance: one pair, or a resemblance under
`3/√D`, cannot be told from accident. Above lies ubiquity: what everyone holds
discriminates nothing and abstracts nothing.

## Pins

- `test/17` — the weave-local frame, `AGREEMENT` and `dominates`, against corpus
  reach (the reorder probe).
- `test/34` — containment and reach-driven disambiguation.
- `test/73` — a question made only of scaffolding is abstained from by the
  bridge; places are counted on both surfaces.
- `test/22` — the hub floor on small stores.
