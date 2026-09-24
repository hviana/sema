# Sema Documentation Index

Sema is a single system stated three ways: the law lives in `docs/architecture/`
(what holds), the prescription in `AGENTS.md` (what to do and where), and the
proof in `test/` (pins that fail when the law is broken).

## Routing — what to read for each task

| Task                        | Read                                                                               | Why                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Add a mechanism             | `docs/architecture/mechanism-market.md` + `docs/mechanisms/*.md`                   | Market contract: the four constraints     |
| Add a threshold             | `docs/architecture/thresholds.md`                                                  | All cutoffs are formulas over D/W/N; `config.ts` holds budgets only  |
| Debug an answer             | `docs/architecture/cost-model.md` + `src/meter.ts`                                 | One ladder decides every grounding choice      |
| Understand the fold         | `docs/architecture/fold-contract.md`                                               | Deposit and inference compute the same tree    |
| Add a store backend         | `docs/architecture/store.md` + `docs/architecture/bounded-reads.md`                | `AbstractStore` owns domain logic; backends are thin wrappers with capped reads       |
| Add an ALU operation        | `src/alu/README.md`                                                                | One `registry.derive` per op composing existing ops; no new `derive` needed           |
| Add a matcher or projection | `docs/architecture/match-project.md`                                               | Mechanisms are `(matcher, direction, gate)` configs over the shared `match.ts` family |
| Add a deduction rule        | `docs/architecture/cost-model.md` + `docs/architecture/determinism.md`             | Place cost on the ladder, keep heuristic admissible, extend `classifyMove`            |
| Change vector search        | `docs/architecture/exact-vs-approximate.md` + `docs/architecture/bounded-reads.md` | Scores propose, bytes dispose; ANN is bounded by `hubBound`                           |
| Profile or bound work       | `docs/architecture/meter.md` + `docs/architecture/bounded-reads.md`                | `meter.ts` is write-only; counters are product, phases are hints                      |

## Architecture laws (14)

| Law | File                                        | Summary                                                                                                     | Pins                 |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | `docs/architecture/determinism.md`          | No `Math.random`/`Date.now` in behaviour; seed-derived randomness; corpus-determined tie-breaks             | `test/20`            |
| 2   | `docs/architecture/thresholds.md`           | Every decision cutoff derived in `geometry.ts` over D/W/N; no tunable knobs                                 | `test/40`, `test/64` |
| 3   | `docs/architecture/exact-vs-approximate.md` | Vector scores rank only; identity via content-addressed lookup; five graded ladders                         | `test/51`            |
| 4   | `docs/architecture/cost-model.md`           | Single ladder `MICRO`/`STEP`/`CONCEPT`/`PASS`; weight `moves + PASS·unaccounted`; `STEP`-grade compare      | `test/04`, `test/55` |
| 5   | `docs/architecture/match-project.md`        | Shared `match.ts` family (`locate`/`alignGraded`/`frameSlots`/`project`); voicing gates belong to consumers | `test/24`, `test/76` |
| 6   | `docs/architecture/mechanism-market.md`     | `PipelineMechanism` (`floor`/`run`/`parse`); admissible-floor pruning and investment discipline             | `test/01`, `test/04` |
| 7   | `docs/architecture/commonality.md`          | Two populations: corpus-global (`reachOf`+`dominates`) vs weave-local (`depth[]`)                           | `test/17`, `test/34` |
| 8   | `docs/architecture/bounded-reads.md`        | No per-query read grows with N; `hubBound=√N` enforced at store via LIMIT/probe/prefix caps                 | `test/77`, `test/90` |
| 9   | `docs/architecture/store.md`                | `AbstractStore` owns dedup/indexing/batch; `store-sqlite.ts` is thin wrappers; canon index optional         | `test/08`            |
| 10  | `docs/architecture/fold-contract.md`        | `perceiveDeposit` and `perceive` agree; `contentLevels` is single boundary rule; no W/offset dependence     | `test/59`, `test/63` |
| 11  | `docs/architecture/memoization.md`          | `Precomputed` is per-response lazy cache (promise-cached async); `beginResponse`/`endResponse` lifecycle    | `test/42`            |
| 12  | `docs/architecture/saturation.md`           | Every walk names a deciding saturation beside its cap; cap is safety net, not decision                      | `test/27`, `test/16` |
| 13  | `docs/architecture/meter.md`                | `meter.ts` is write-only work accounting; counts are exact, phases nest                             | `test/55`            |
| 14  | `docs/architecture/factored-machinery.md`   | A derivation is closed when its structure accounts for the question's remainder; every transition asks that law | `test/133`–`137`     |

## Mechanisms (8)

| Mechanism         | File                                   | Role                                                      |
| ----------------- | -------------------------------------- | --------------------------------------------------------- |
| cover             | `docs/mechanisms/cover.md`             | Exact/computed-span covering via `GraphSearch`            |
| cast              | `docs/mechanisms/cast.md`              | Weave-local analogy via `depth[]` frame gate              |
| confluence        | `docs/mechanisms/confluence.md`        | Corpus-global filler/scaffolding gate over climb          |
| extraction        | `docs/mechanisms/extraction.md`        | Located-frame read-out with anchored span accounting      |
| reference         | `docs/mechanisms/reference.md`         | Slot-bound voicing of asker-supplied referents            |
| recall            | `docs/mechanisms/recall.md`            | Nearest stored form; echo tier via substitution bridge    |
| prefix-completion | `docs/mechanisms/prefix-completion.md` | Literal prefix of exactly one trained form                |
| alu               | `docs/mechanisms/alu.md`               | Authoritative computed spans (`parse` → `aluToMechanism`) |

## Supporting docs

| Doc                                       | Role                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `docs/architecture/caches.md`             | Every acceleration is a `BoundedMap`; miss re-derives; budgets in `StoreConfig` |
| `docs/architecture/halo-sketch.md`        | Halo & sketch — distributional memory, quantization, bottom-k profiles          |
| `docs/architecture/factored-machinery.md` | Single-definition contracts table — one owner per shared symbol                 |

## Cross-cutting

- `docs/INVARIANTS.md` — the five invariants (determinism, derived thresholds,
  exact-decides, one cost currency, bounded reads) with file-level routing.
- `docs/failures/tempting-but-wrong.md` — refuted simplifications that passed
  review but failed pins.
- `docs/harness/gates.md` — how `AGENTS.md` recipes,
  `bench/profile-inference.mjs`, and `test/*.test.mjs` enforce the laws.
- `docs/architecture/` — per-law derivation: each file says why, not how.