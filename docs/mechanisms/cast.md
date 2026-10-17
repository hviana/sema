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
frame(i)  ⇔ depth[i] > AGREEMENT ∧ dominates(depth[i], aligned)     AGREEMENT = 2
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
- no schema transfers through a co-instance of the question (`evidence.md`):
  what it shares is frame, its seat another filler's answer.

## Schemas

- **Substitution.** A subject the question supplies takes the seat of a
  displaced structure. The filler is what the subject contributes before the
  seat, clipped at the seat, so the result does not depend on the weave's
  elimination order. It must displace something, the subject is no fragment
  answering other questions (`director`), and the question names the displaced
  structure and the subject apart (`namesApart`, below), or a stranger's
  question is displaced (`test/29`).
- **Redirection.** The question names a substitute by quoting its opening bytes,
  beyond scaffolding (`…were Lyon?` for `Lyon is a city in France`, never
  `The`), after what it displaces. A substitute that is a fragment answering
  other questions (`ong)?`, of every `… (… Song)?` question) is refused, and so
  is a redirection of a dominant the question does not displace: a question
  restating one of its continuations keeps that answer (`test/29` D2).
- **Comparison.** The dominant is seated against one analog (`seatOfNode`),
  corroborated by `analogyStrength`: halo company at `conceptThreshold`, else
  the frame tier (`test/47`). The question names each with a run it holds apart
  from the other's (its runs, its form, the fact it voices), not scaffolding,
  held by no other context (`heldElsewhere`), or a stranger's fact is glued to
  the answer. A frame-tier analog dismisses no stored content
  (`dismissedKnownContent`), the largest gap is smaller than the dominant's
  context, and the climb committed one root: several roots are several things
  asked (`test/32` C1). Past the similarity gates, the analog is the candidate
  holding the most question bytes (`namedBytes`), none on a tie (`test/29` C5).
  A seat echoing the question gives way to its continuation, as a conjunction
  holds its parts (`test/47`).

## Cost

Each transfer act costs `STEP + STEP`, plus `CONCEPT` for a halo-mediated
analogy. `accounted` covers only the points that schema transferred between. The
floor, `2·STEP`, asks `worthRunning` before first touching the climb or the
weave (`mechanism-market.md`).

## Provenance

`cast`.

## Pins

- `test/17` — a reordered single fact does not trigger substitution; it pins the
  cohort frame.
- `test/29` — substitution, redirection and comparison, and the displacement of
  their seats. C3: a further hop inside a comparison's seat waits to be asked.
- `test/43` — the direction of `seatOfNode`.
- `test/47`, `test/50` — comparison coverage, the junk analog refused by the
  ignored-known principle, and the shared guards.
- `test/154.7`, `test/154.11`, `test/154.18`, `test/155.9`, `test/155.12` — a
  comparison names two things apart; no schema transfers through a co-instance.
