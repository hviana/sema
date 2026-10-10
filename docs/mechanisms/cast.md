# CAST — Carry Structure Between Woven Forms

When independently learnt structures align to genuinely different spans of the
question, CAST (counterfactual transfer) carries structure from one to another
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
- **`depth` counts distinct structures, never weight.** Counting weight lets a
  shared frame such as `describe it` survive as content, and makes substitution
  fire on reordered single-fact questions (the measured split was 29/42 against
  6/42).
- **The cohort reading cannot be replaced by corpus reach.** A phrase common to
  the aligned exemplars is frame here even when it is rare in the corpus
  (`test/17`).

Further competence checks:

- the question is at least two quanta long;
- there are at least two ranked anchors;
- the weave touches a committed point of attention;
- the weave is genuinely woven, not every run restating a recognised site.

## Schemas

- **Substitution.** A subject the question supplies takes the seat of a
  displaced structure. The filler is what the subject contributes before the
  seat, clipped at the seat, so the result does not depend on the weave's
  elimination order. The substitution must actually displace something.
- **Redirection.** The question names a substitute by quoting it from its own
  opening bytes (`…were Lyon?` against `Lyon is a city in France`), and names it
  after what it displaces. A substitute that is a fragment answering other
  questions is refused: `ong)?`, the tail of every `… (… Song)?` question, would
  voice a stranger's birthplace.
- **Comparison.** The dominant is seated against one analog, reached through
  `seatOfNode` and corroborated by `analogyStrength` (halo company). Two guards
  apply:
  - the question must evidence the analog with a window of its own, not inside
    the dominant's runs and not scaffolding;
  - the dominant must not be a co-instance of the question (`evidence.md`).

  Without them, a bare question is glued onto the answer, and Shakira's
  birthplace is set against `John Lennon`.

## Cost

Each transfer act costs `STEP + STEP`, plus `CONCEPT` for a halo-mediated
analogy. `accounted` covers only the points that schema actually transferred
between. The floor is `2·STEP`. Before first touching the climb or the weave,
the floor asks `worthRunning(2·STEP)` and returns its uninvested bound if it
would lose (`mechanism-market.md`).

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
- `test/154.7`, `test/155.9` — a comparison needs two named things, and never
  takes a co-instance as its dominant.
