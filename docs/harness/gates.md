# Gates

There are four executable gates. The laws in `docs/architecture/` are enforced
by these and by the pins each law lists.

## 1. Correctness — every suite

```bash
npm test          # tsc, then node --test over test/**/*.test.mjs against dist/
```

This gate guards every pinned contract, and two in particular:

- **Honest silence.** An unrelated question grounds to nothing (`test/28`,
  `test/50`, `test/56`, `test/67`, `test/76-reference-binding`, `test/84`).
- **Determinism.** The same seed, deposit order and question give a
  byte-identical answer (`test/20`).

The docs themselves are read by `test/137`: an export that only the docs
describe counts as documented.

## 2. Work accounting — the profiler

```js
const mind = new Mind({ profile: true });
await mind.respondText(q);
console.log(formatReport(mind.lastCost)); // sumReports() over several
```

The public path is the harness: there is no separate bench script (`AGENTS.md`
§6, `meter.md`). Compare cold runs by their counters. Attaching an
`inspectRationale` callback must not change the answer (`test/42`).

## 3. Dependency footprint

```bash
node --test test/88-dependency-footprint.test.mjs
```

`dist/src` may import only `node:` builtins and relative paths, and
`package.json` declares no `dependencies` (`AGENTS.md` §7).

## 4. Fold invariance and sublinear scaling

```bash
node --test test/59-fold-invariance.test.mjs test/63-fold-invariants.test.mjs
node --test test/14-scaling.test.mjs
```

- `test/59` and `test/63`: segmentation is content-defined, so the grid's 14.3%
  shift survival cannot pass (`fold-contract.md`).
- `test/14`: inference is sublinear in corpus size, measured as a log–log slope
  over independent corpora, and linear in input length (`bounded-reads.md`).
