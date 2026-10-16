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
  elimination order. It must displace something; the subject is no fragment
  answering other questions (`director`). The displaced structure is what the
  answer speaks, so the question names it the way a comparison names its
  structures (`namesApart`, below), and so is the subject, each apart from the
  other's runs. Otherwise a question about `Orlan` displaces a stranger's
  question on windows other contexts hold (`did`, `Orlan`), and a title that
  opens with a common `When` fills the seat (`test/29`). On the 900 this refuses
  one right answer, which came through an unnamed step: `Who is the` filled the
  seat of `Clara Anastasia Novello` for `Clara Novello`, an identity the store
  does not hold.
- **Redirection.** The question names a substitute by quoting its opening bytes,
  beyond scaffolding (`…were Lyon?` for `Lyon is a city in France`, never
  `The`), after what it displaces. A substitute that is a fragment answering
  other questions (`ong)?`, of every `… (… Song)?` question) is refused, and so
  is a redirection of a dominant the question does not displace: a question that
  restates one of the dominant's continuations keeps that answer
  (`the
  capital of France is … and Paris is in` keeps `Tokyo`, `test/29` D2).
- **Comparison.** The dominant is seated against one analog, reached through
  `seatOfNode` and corroborated by `analogyStrength` (halo company, or a shared
  learnt frame). The question names each with a run it holds, outside the
  other's runs, not scaffolding, held by no other context (`heldElsewhere`).
  Otherwise a stranger's question or fact is glued to the answer. A frame-tier
  analog may not dismiss stored content of the question
  (`dismissedKnownContent`), the analog is no co-instance, and the largest gap
  the two leave is smaller than the dominant's own context. The climb committed
  ONE root: where it commits several, the question asks about each (a
  conjunction, several topics), and seating one against another voices two facts
  as analogs (`test/32` C1). (An evidence bar — naming, a trusted root —, the
  analog's scale and a gap dominating the question were measured redundant with
  these and removed; where the evidence bar refused on the 900, every case is
  refused by them.) When no candidate passes the similarity gates, the analog is
  the candidate whose bytes hold the most question bytes (runs of two windows,
  `namedBytes`), and none when two tie: the question naming it is the
  comparison's only warrant then. Popularity is none — a fallback that elected
  the best-supported structural hub (edge support, then poured mass) named an
  analog the question never said (`test/29` C5). Company stands alone as the
  analogy's evidence only at `conceptThreshold`; below it the frame tier reads
  the pair (`test/47`). A seat that echoes the question gives way to its
  continuation, whether the question holds it in one run or window for window. A
  conjunction elides what its parts share, so
  `What is the capital of France and the largest planet?` holds
  `What is the largest planet?` without one run of it (`test/47`).

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
- `test/47`, `test/50` — comparison coverage, the junk analog refused by the
  ignored-known principle, and the shared guards.
- `test/154.7`, `test/154.11`, `test/155.9`, `test/155.12` — a comparison names
  two things apart; no schema transfers through a co-instance.
