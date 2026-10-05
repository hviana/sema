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

- Measure: `reachOf(id, N)`, the learnt contexts its containment and edge climb
  reaches, capped and memoized in `sharedReachMemo`.
- Cut: `dominates(reach, N)`. A majority is scaffolding, and a minority
  discriminates. The climb reads the graded form of the same cut, weighing a
  region by `ln(N/c)`.
- Read by the consensus climb, `confluence`'s gate and edge following.

**The cohort: the structures aligned to this question.**

- Measure: `depth[i]`, the number of distinct structures in the weave that cover
  byte `i`. They are counted as distinct, never by weight.
- Cut: `frame(i) ⇔ depth[i] > MIN_WEAVE ∧ dominates(depth[i], aligned)`, with
  `MIN_WEAVE = 2`, because a pair is ambiguous when insertions are possible.
- Read by CAST (`cast.ts`).

**Places: where a window occurs.**

- Measure: `containersSlice(id, 0, bound + 1).length`, the window's containers.
- Cut: `0` anchors nothing, and `≥ 2` marks the window as reused. Above the hub
  bound, the window is scaffolding.
- Read by the bridge and by attention, which anchor on the rarest window first,
  and by the scaffolding readings (`scaffoldExtents`,
  `allWindowsAreScaffolding`).

**Scaffolding is nobody's evidence and nobody's debt.** A window in more than
`√N` places explains nothing, because every fact holds it. So a step cannot pay
the question by restating `is`, and a cover span made only of scaffolding is not
accounted (`evidence.md`).

`hubWindows` floors that bound at `chainReach(W) = W²`. Inside one deposit's
fold, a window is already contained by up to that many chunks and branches. On a
store of a few facts, `√N` alone would call every window scaffolding, which
measures fold structure, not commonness (`test/22`).

Two limits bound every cut. Below lies chance: one pair, or a resemblance under
`3/√D`, cannot be told from accident. Above lies ubiquity: what everyone holds
discriminates nothing and abstracts nothing.

## Pins

- `test/17` — the weave-local frame, `MIN_WEAVE` and `dominates`, against corpus
  reach (the reorder probe).
- `test/34` — containment and reach-driven disambiguation.
- `test/73` — a question made only of scaffolding is abstained from by the
  bridge.
- `test/22` — the hub floor on small stores.
