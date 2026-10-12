# CAST — Carry Structure Between Woven Forms

When independently learnt structures align to different spans of the question,
CAST (counterfactual transfer) carries structure from one to another
(`src/mind/mechanisms/cast.ts`). One weave serves three schemas. Each schema
that fires yields its own candidate, and the market's single comparison picks.

## Matcher — the weave

`pre.weave()` is `alignGraded` over the question: literal `W`-gram runs, then
halo-matched sites and the climb's proposals. It produces `points[]`, each with
graded `runs[]`, and `depth[]`, the number of distinct structures that cover
each byte. A second point counts only if it adds at least one perception quantum
of coverage that the widest point lacks.

## Gate — the cohort's frame

Frame is what the cohort of aligned structures shares (`commonality.md`):

```
frame(i)  ⇔ depth[i] > MIN_WEAVE ∧ dominates(depth[i], aligned)     MIN_WEAVE = 2
usable(r) ⇔ ¬dominates(framedCount(qs, qe), runLen)
```

- **More than a pair must agree.** A pair is ambiguous when insertions are
  possible, so with only two points no byte is frame.
- **`depth` counts distinct structures, never weight.** Weight lets a shared
  frame (`describe it`) survive as content, and substitution fire on reordered
  single-fact questions (29/42 against 6/42).
- **Corpus reach cannot replace the cohort reading.** A phrase common to the
  aligned exemplars is frame here even when rare in the corpus (`test/17`).

Further competence checks:

- the question is at least two quanta long;
- there are at least two ranked anchors;
- the weave touches a committed point of attention;
- the weave is genuinely woven, not every run restating a recognised site;
- no schema transfers through a co-instance of the question (`evidence.md`):
  what it shares is frame, its seat another filler's answer.

## Schemas

- **Substitution.** A subject the question supplies takes the seat of a
  displaced structure. The filler is what the subject contributes before the
  seat, clipped at the seat, so the result does not depend on the weave's
  elimination order. It must displace something; the subject is no fragment
  answering other questions (`director`).
- **Redirection.** The question names a substitute by quoting its opening bytes,
  beyond scaffolding (`…were Lyon?` for `Lyon is a city in France`, never
  `The`), after what it displaces. A substitute that is a fragment answering
  other questions (`ong)?`, of every `… (… Song)?` question) is refused.
- **Comparison.** The dominant is seated against one analog, reached through
  `seatOfNode` and corroborated by `analogyStrength` (halo company). The
  question must evidence the analog with a window of its own, not inside the
  dominant's runs and not scaffolding. Without this and the co-instance guard, a
  bare question is glued onto the answer, and Shakira's birthplace set against
  `John Lennon`.

## Cost

Each transfer act costs `STEP + STEP`, plus `CONCEPT` for a halo-mediated
analogy. `accounted` covers only the points that schema transferred between. The
floor is `2·STEP`. Before first touching the climb or the weave, the floor asks
`worthRunning(2·STEP)` and returns its uninvested bound if it would lose
(`mechanism-market.md`).

## Provenance

`cast`.

## Pins

- `test/17` — a reordered single fact does not trigger substitution; it pins the
  cohort frame.
- `test/29` — substitution, redirection and comparison, and the displacement of
  their seats. C3: a further hop inside a comparison's seat waits to be asked.
- `test/43` — the direction of `seatOfNode`.
- `test/47`, `test/50` — comparison coverage, the analog consensus floor and the
  shared guards.
- `test/154.7`, `test/155.9`, `test/155.12` — a comparison needs two named
  things; no schema transfers through a co-instance.
