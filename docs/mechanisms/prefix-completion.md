# Prefix Completion — Complete a Known Beginning

When the question is a proper prefix of exactly one trained form, that form is
voiced whole and nothing is invented
(`src/mind/mechanisms/prefix-completion.ts`).

## Supply — one union, decided once

Resonance cannot rank a proper prefix. On the trained store, the cosine between
a prefix and its form falls from 0.96 at one truncated byte to 0.62 at three,
against a reach bar of 0.875. So the candidates come from two supplies:

- **`formsOpenedBy`** (`traverse.ts`) reads the write side's window index, which
  is position-invariant, and climbs containment and then parents to the deposits
  a prefix opens. It is bounded by `hubBound`.
- **The response's top-`k` resonance.**

The two are concatenated, and the guards decide once over the union. A chain
that tried one supply and then the other would let the approximate tier override
an ambiguity the exact one found.

## Guards

1. **Literal opening.** Every byte of the question matches the form in order
   from offset 0.
2. **Exactly one distinct continuation**, compared by bytes, not by form id.
   Zero or two or more means refusal: that is the prefix trap.
3. **Readable.** If any candidate saturates its capped `bytesPrefix` read, none
   is licensed.
4. **At least one window.** A continuation shorter than `W` cannot be voiced,
   and counts as disagreement.

## Cost

`STEP`, with `accounted = [[0, query.length]]`, since every byte is literally
matched. The result is **not** `complete`: the form may carry more beyond the
remainder this step voiced. The floor checks `worthRunning(STEP)` before either
supply is touched, and returns `null` when the question leaves no room for a
continuation within the phrase cap.

The mechanism is registered after `recall`, so an exact self-match wins ties.

## Provenance

`prefix`.

## Pins

- `test/70` — a literal prefix, ambiguity, a sub-quantum tail, the veto on a
  saturating read, and determinism.
- `test/72` — the union supply; resonance alone cannot rank a proper prefix.
