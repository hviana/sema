# Gates

Four executable gates. Each: run the command, check what it guards, follow its
§.

## 1 — Correctness (all suites)

```bash
npm test
```

Guards honest silence, determinism, and every pinned contract. Silence:
unrelated queries ground to nothing (`test/28`, `50`, `56`, `67`, `76`, `84`).
Determinism: same seed + deposit order + query gives byte-identical answer
(`test/20`). Every invariant is pinned, the closure law included
(`test/133`–`137`). §14–25 (pipeline), §64 (derived thresholds), AGENTS.md §2
invariants 1–5.

## 2 — Work accounting (profiler)

```bash
node bench/profile-inference.mjs        # add [n] to limit probes
node bench/profile-inference.mjs --trace # trace is a debugging aid, not product
```

Guards without trace: counters exact and diffable between COLD runs; phases
nest (not disjoint — each phase is charged by its own layer); shared analyses
charged to themselves, not to the first toucher; millisecond fields are
non-deterministic hints only. With `--trace`, recognition idempotence still
holds (`test/42`). `src/meter.ts`, `docs/architecture/meter.md`, §55,
`AGENTS.md` §6.

## 3 — Dependency footprint

```bash
node --test test/88-dependency-footprint.test.mjs
```

Guards `dist/src` imports only `node:` + relative paths, and `package.json`
declares no `dependencies` (examples use `devDependencies` lazily). The
near-zero footprint is a product feature. AGENTS.md §7, §3 (store has one
runtime dep: `node:sqlite`).

## 4 — Fold invariance and sublinear scaling

```bash
node --test test/59-fold-invariance.test.mjs test/63-fold-invariants.test.mjs
node --test test/14-scaling.test.mjs
```

Guards: `59+63` — segmentation is content-defined (`contentBoundaries`), not
positional; grid regression (14.3% survival) cannot pass. `14` — inference cost
is sublinear in corpus size (power-law exponent ≪ 1) and constant-rate in input
length; measured on independent disjoint corpora via log–log slope.
`src/geometry.ts` (`contentLevels`), `docs/architecture/fold-contract.md` +
`bounded-reads.md`, §59, §63.
