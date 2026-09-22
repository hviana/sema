# CAST — Counterfactual Transfer via Weave

Counterfactual transfer over the query's **weave**: when byte-string evidence
from multiple independently-learnt structures aligns to genuinely different
query spans, CAST transfers structure between them (substitution, redirection,
analogical comparison). One `alignGraded` weave, multiple schemas; each firing
schema yields its own candidate and `think`'s single weight comparison picks.

## Matcher

`alignGraded` over the current query bytes: literal W-gram runs first, then
halo-matched `pre.rec.sites`. The product is `pre.weave()` — `points[]` (each
with graded `runs[]`) and a per-query-byte `depth[]` (how many structures cover
that byte). CAST's single-vs-multi test is measured from those runs: a second
point must add ≥ one perception quantum of coverage the widest point does not.

## Gate — weave-local discriminative frame

Two derived components, both from the weave itself (no tuned threshold):

1. **MIN_WEAVE = 2** — CAST needs ≥ 2 points to form a weave. Frame requires
   _more_ than the minimum: `depth[i] > MIN_WEAVE`, i.e. ≥ 3 structures agree on
   the byte. With only the minimum pair no byte is frame.

2. **Half-dominance** — `dominates(n, total)` (> half scaffolding no longer
   discriminates). Per byte:
   `frame(i) ⇔ depth[i] > MIN_WEAVE ∧ dominates(depth[i], aligned)`. Per run:
   `usable(r) ⇔ ¬dominates(framedCount(qs,qe), runLen)`.

`depth` counts **distinct structures**, not accumulated weight — a byte covered
by the same structure twice still has depth 1. Counting weight instead lets
shared frame (" describe it", "the importance of") survive as content and makes
substitution fire on reordered single-fact queries. The split is 29/42 vs 6/42
when wrong.

This frame gate is **weave-local** ("what the aligned structures share among
themselves"), not corpus-local (`reachOf` + `dominates` IDF). A phrase common to
the aligned exemplars is frame here even when it reaches a corpus minority. Do
not replace it with the structural IDF — refuted on the `test/17` reorder probe.
The gate does not use `frameSlots` and therefore **does not consume frame
slots** — it is not the cohort-local `frameSlots` voice gate.

Other admission gates (query ≥ 2 quanta, ≥ 2 ranked anchors, weave touches a
committed attention root, genuinely woven — not every run restating a recognised
site) are structural competence checks; see `cast.ts`.

## Cost

**2·STEP** (`STEP + STEP`): one projection per transfer act that the taken
branch performs (halo-mediated analogy adds `CONCEPT`). Weight is
`moves + PASS·unaccountedBytes` as usual; `accounted` is schema-specific — only
the two points that schema actually transferred between.

## Investment discipline

Floor is `2·STEP`. Before touching the shared expensive analyses
(`pre.attention()` climb, `pre.weave()`), check `worthRunning(2*STEP)` and
return the uninvested bound when it already loses. Never compute a shared
analysis just to discard it.

## Provenance

`cast` — the answer came from counterfactual transfer (substitution,
redirection, or analogical comparison), not from a literal continuation.

## Pins

- **test/17 intelligence** — reordered single-fact must not trigger
  substitution; the weave-local frame (depth as distinct-structure count +
  half-dominance) is what suppresses it.
- **test/29 counterfactual** — B/C families pin substitution / redirection /
  comparison and their seat displacements.
- **test/43 seat** — `seatOfNode` direction (establishing reverse vs forward vs
  fallback) that the schemas displace through.

## Source

`src/mind/mechanisms/cast.ts` (`counterfactualTransfer`, `seatOfNode`,
`MIN_WEAVE`), `src/mind/match.ts` (`alignGraded`, `project`, `depth`),
`src/geometry.ts` (`dominates`), `src/mind/graph-search.ts` (`STEP`).
