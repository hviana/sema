# Sema Documentation Index

Sema is one system, stated four ways:

| Where                | It says                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `docs/PHILOSOPHY.md` | the path of information from deposit to answer, and why it holds together. Read it first. |
| `docs/architecture/` | the laws: what holds and why, measured                                                    |
| `AGENTS.md`          | the prescription: what to do, and where                                                   |
| `test/`              | the proof: pins that fail when a law is broken                                            |

`docs/INVARIANTS.md` routes every law to its code and its pins.

## What to read for each task

| Task                           | Read                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| Understand the whole           | `PHILOSOPHY.md`                                                 |
| Change perception or identity  | `fold-contract.md`, `store.md`, `exact-vs-approximate.md`       |
| Add a store backend            | `store.md`, `bounded-reads.md`                                  |
| Add or change a threshold      | `thresholds.md`                                                 |
| Add a mechanism                | `mechanism-market.md`, `match-project.md`, `docs/mechanisms/`   |
| Add a deduction rule           | `cost-model.md`, `closure.md`, `determinism.md`                 |
| Change what counts as evidence | `evidence.md`, `commonality.md`                                 |
| Change vector search           | `exact-vs-approximate.md`, `halo-sketch.md`, `bounded-reads.md` |
| Add a walk or a fan-out        | `bounded-reads.md`, `saturation.md`                             |
| Profile or bound work          | `meter.md`, `memoization.md`, `caches.md`                       |
| Add an ALU operation           | `src/alu/README.md`                                             |
| Simplify something             | `docs/failures/tempting-but-wrong.md` first                     |

## The laws (`docs/architecture/`)

| #  | Doc                       | Law                                                                                                                |
| -- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1  | `determinism.md`          | the same seed, deposits and question give the same bytes; ties are broken by the corpus, never by chance           |
| 2  | `thresholds.md`           | every cutoff is a formula over `D`, `W`, `N`; `config.ts` holds budgets only                                       |
| 3  | `exact-vs-approximate.md` | scores propose, bytes dispose; every graded ladder is exact first                                                  |
| 4  | `cost-model.md`           | one currency: `MICRO < STEP < CONCEPT < PASS`, and the price is the unexplained question                           |
| 5  | `match-project.md`        | a mechanism is `(matcher, direction, gate)` over one family; the gate belongs to the consumer                      |
| 6  | `mechanism-market.md`     | one interface, one price; never compute what cannot change the decision                                            |
| 7  | `commonality.md`          | frame against filler is read over a named population: corpus, cohort or places, never substituted                  |
| 8  | `bounded-reads.md`        | no per-query read grows with `N`; the store enforces `hubBound = ⌈√N⌉`                                             |
| 9  | `store.md`                | a node is named by its content; `AbstractStore` owns every domain decision                                         |
| 10 | `fold-contract.md`        | deposit and question fold the same bytes into the same tree and the same node; nothing outside the bytes shapes it |
| 11 | `memoization.md`          | asking never writes; shared analyses are computed once per response, and tracing changes no answer                 |
| 12 | `saturation.md`           | every walk names the stop that decides it; the cap is only a net                                                   |
| 13 | `meter.md`                | the meter is write-only; counters are exact, milliseconds are hints                                                |
| 14 | `closure.md`              | a step is admitted only when it closes, moves to unconsumed structure, or carries what is owed                     |
| 15 | `evidence.md`             | the question names the step; another instance of its frame says what the relation is, never what it asks about     |

Supporting docs: `halo-sketch.md` (distributional memory), `caches.md` (every
acceleration is a budget), `factored-machinery.md` (one definition, many
consumers).

## Mechanisms (`docs/mechanisms/`)

| Mechanism           | Answers by                                                                    |
| ------------------- | ----------------------------------------------------------------------------- |
| `cover`             | composing the question from its recognised sites, by graph search             |
| `cast`              | carrying structure between woven forms: substitution, redirection, comparison |
| `confluence`        | intersecting conditions or two things' derivations                            |
| `extraction`        | reading a span between frames located in the question                         |
| `reference`         | voicing a learnt frame's slot with the asker's own bytes                      |
| `recall`            | the nearest stored form, or honest silence                                    |
| `prefix-completion` | completing a known beginning of exactly one form                              |
| `alu`               | computation, which is authoritative                                           |

## Elsewhere

- `docs/failures/tempting-but-wrong.md` — shortcuts that pass review and fail
  the evidence.
- `docs/harness/gates.md` — the four executable gates.
- `src/derive/`, `src/alu/`, `src/rabitq-ivf/` — firewalled sublibraries, each
  with its own README and tests.
