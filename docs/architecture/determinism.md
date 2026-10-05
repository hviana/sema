# Determinism — Same Seed, Same Deposits, Same Question, Same Bytes

> **Law:** the same `seed`, the same deposit order and the same query give a
> byte-identical answer. Every path that can reach output is a function of
> `(seed, store contents, query bytes)`.

**Why.** An answer meant to be audited, contested or certified must replay.
Reproducibility is a property of the architecture, not a flag.

## Forbidden on a behavioural path

- `Math.random` and `Date.now`.
- Iteration over an unordered collection whose order can reach output.

If a test becomes flaky, the contract was broken, not the test. Uses inside
`example/` are outside the library contract.

## All randomness flows from `seed`

`MindConfig.seed` (`config.ts`) is the only entropy root:

- the **alphabet** (`alphabet.ts`) is drawn from `rng(seed ^ seedMask)`;
- the **keyring of seats** (`makeKeyring`) is drawn from the seed in `Mind`;
- the **vector indexes** (`rabitq-ivf`) are seeded from config, and insertion
  order is their stored order;
- **company signatures** are seeded by node id (`companySignature`), not by the
  seed or by observation order. That is why halo comparisons survive a change of
  seed while gist comparisons do not (`halo-sketch.md`).

## Ties are broken by the corpus

Every choice bottoms out in a fixed order, and the fallback is
**first-inserted**: the lowest node id, or the `LIMIT 1` insertion order. Never
last-inserted, because that would make an answer depend on recency instead of
evidence. The order of teaching is part of what was taught, and a correction
prevails only by evidence.

- **`chooseNext` / `guidedFirst`** (`traverse.ts`) try three things in turn: a
  continuation the question names (`evidence.md`); then distributional support,
  `prevCount` and then halo mass; then first-inserted.
- **`chooseAmong`** takes `argmaxCosine` over `candidateGist`, capped at
  `hubCap`, and resolves ties by stable scan.
- **Ties in the junction bridge** go to the shortest interior, then the lowest
  node id.

When you add a choice among equals, name its tie-break explicitly and make it
corpus-determined.

## Memoization and tracing must not change the answer

Memos are sound because asking never writes. Which ones a trace bypasses, and
why the pick memo is cleared when the climb publishes its points, is
`memoization.md`'s trace boundary.

## Pins

- `test/20`, `test/03`, `test/04`, `test/08` — the same seed and the same
  training give byte-identical answers and stores.
- `test/42` — recognition is idempotent under trace.
- `test/155.4` — traced and untraced responses agree after the climb publishes.
- `test/34` — tie-breaks are corpus-determined, not interchangeable.
