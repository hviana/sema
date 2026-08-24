# AGENTS.md — the Sema development manual

The working manual for anyone (human or AI agent) changing Sema. For pattern
detail, see `docs/INDEX.md` → `docs/architecture/*.md`. You should be able to
develop against this document and docs/ alone; read the theory in
`docs/architecture/` when you need why a pattern holds, not to get work done.

## 1. Orientation

Sema is a deterministic reasoning engine with no ML runtime: a content-addressed
DAG store (the knowledge), two RaBitQ-IVF vector indexes over it (the search
accelerators), and a cost-based search that composes answers from stored facts
(the inference). Everything is plain TypeScript, CPU-only, with `node:sqlite` as
the only runtime dependency.

```bash
npm install        # dev tooling + parquet reader used by one example
npm run build      # tsc → dist/
npm test           # tsc && node --test test/**/*.test.mjs
npm run demo       # example/demo.ts — the four-note README demo
```

Hard facts:

- **Node >=22.5** (`node:sqlite`). No native add-ons.
- **ES modules with explicit `.js` extensions** in imports. Keep the convention.
- **Determinism is the product.** Same seed + same deposit order + same query ⇒
  byte-identical answer.

Mental model, top to bottom:

```
mind/pipeline.ts     grounding decider: mechanisms compete on one cost scale
mind/mechanisms/*    cover · cast · confluence · extraction · reference · recall · prefix-completion · alu
mind/*               match/project, attention, recognition, junction ascent, graph search, learning, rationale
store.ts             AbstractStore: ALL DAG store domain logic
store-sqlite.ts      the one concrete backend (thin SQL wrappers)
geometry.ts + vec/alphabet/sema/canon  vectors, fold, every derived threshold, canonicalizer
derive/ · alu/ · rabitq-ivf/  firewalled sublibraries (own READMEs, own tests)
```

Lower layers never import higher ones. Sublibraries import nothing from Sema
except `../bytes.ts` (ALU); Sema reaches them via `DeductionSystem`,
`PipelineMechanism`, `VectorDatabase`.

## 2. Invariants — routing table

Five invariants. Violate one and the system degrades silently — tests pin them.

| # | Invariant                           | Rule                                                                                                                                                   | Where it lives                                                                              |
| - | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1 | Determinism                         | No `Math.random`/`Date.now` in behaviour; all randomness from `seed`; tie-breaks are corpus-determined (insertion order / lowest id)                   | `docs/architecture/determinism.md` → `src/config.ts`, `src/alphabet.ts`                     |
| 2 | Derived thresholds                  | Every cutoff is a formula over D/W/N in `geometry.ts`; `config.ts` holds capacities and budgets only — no tunable thresholds                           | `docs/architecture/thresholds.md` → `src/geometry.ts`                                       |
| 3 | Exact decides, approximate proposes | Vector scores (`resonate`) rank only; identity via content-addressed lookup (`resolve`/`findLeaf`/`canonResolve`); graded ladders are exact tier first | `docs/architecture/exact-vs-approximate.md` → `src/mind/primitives.ts`, `src/mind/match.ts` |
| 4 | One cost currency                   | Single ladder `MICRO`/`STEP`/`CONCEPT`/`PASS`; `weight = moves + PASS·unaccounted`; compare at `STEP` grade                                            | `docs/architecture/cost-model.md` → `src/mind/graph-search.ts`, `src/derive/`               |
| 5 | Bounded reads                       | No per-query read grows with N; cap is `hubBound = √N` enforced at the store via `LIMIT` reads, existence probes, and `bytesPrefix` caps               | `docs/architecture/bounded-reads.md` → `src/store.ts`, `src/mind/traverse.ts`               |

Cross-cutting contracts (single-definition, import everywhere): `contentLevels`
in `src/geometry.ts` is the one boundary rule; `src/mind/canonical.ts` is the
write/read contract for canonical segmentation; `src/mind/junction.ts` is the
shared content-addressed ascent; `Precomputed` in
`src/mind/pipeline-mechanism.ts` is the per-response lazy memo; `src/meter.ts`
is the write-only work accounting surface. See `docs/INDEX.md` for the full
contract table and `docs/architecture/factored-machinery.md` for ownership.

## 3. Where things live

| Concept                              | File(s)                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Public surface / assembly            | `src/index.ts`, `src/mind/mind.ts`                                                                 |
| Config (capacities, budgets, seed)   | `src/config.ts`                                                                                    |
| Derived thresholds, fold, Hilbert    | `src/geometry.ts`                                                                                  |
| Content canonicalizer (injected)     | `src/canon.ts`                                                                                     |
| Vector primitives, alphabet, seats   | `src/vec.ts`, `src/alphabet.ts`, `src/sema.ts`                                                     |
| Perceive / resolve / read primitives | `src/mind/primitives.ts`                                                                           |
| Store domain logic / SQLite adapter  | `src/store.ts`, `src/store-sqlite.ts`                                                              |
| Mechanism contract + `Precomputed`   | `src/mind/pipeline-mechanism.ts`                                                                   |
| Grounding decider (`think`)          | `src/mind/pipeline.ts`                                                                             |
| Grounding mechanisms (one file each) | `src/mind/mechanisms/{cover,cast,confluence,extraction,reference,recall,prefix-completion,alu}.ts` |
| Weighted deduction + cost ladder     | `src/mind/graph-search.ts` (engine in `src/derive/`)                                               |
| Match/project family                 | `src/mind/match.ts`                                                                                |
| Graph traversal, corpus scale        | `src/mind/traverse.ts`                                                                             |
| Consensus climb + attention          | `src/mind/attention.ts`                                                                            |
| Substitution bridge (recall tier)    | `src/mind/bridge.ts`                                                                               |
| Recognition / junction / resonance   | `src/mind/recognition.ts`, `src/mind/junction.ts`, `src/mind/resonance.ts`                         |
| Learning / ingestion                 | `src/mind/learning.ts`, `src/ingest-cache.ts`                                                      |
| Rationale / trace / meter            | `src/mind/rationale.ts`, `src/mind/trace.ts`, `src/meter.ts`                                       |
| Extension host types                 | `src/extension.ts`                                                                                 |
| Sublibraries (own READMEs)           | `src/derive/`, `src/alu/`, `src/rabitq-ivf/`                                                       |

Mind functions are free functions over `MindContext` (`src/mind/types.ts`), not
methods — `mind.ts` is a thin assembly that delegates.

## 4. Recipes

### Add a grounding mechanism or extension

Implement `PipelineMechanism` (`floor` → admissible bound or `null`; `run` →
candidates with `bytes`/`accounted`/`moves`/`unexplained` + optional
`scaffolding`/`complete`). Register via
`new Mind({ mechanismFactories: [host => yourMechanism(host)] })`. Verify the
four market constraints (decoupled, declared competence, visible budget,
evidence travels). → `docs/architecture/mechanism-market.md`

### Add an ALU operation

One `registry.derive(name, arity, surfaceForms, body)` in
`src/alu/src/kernel-*.ts` composing existing ops. No parser/search/mind edits. →
`src/alu/README.md`

### Add a deduction rule

Rules live in `GraphSearch` (`coverRules`/`formRules`/`outRules`/`fuse`). Place
cost deliberately on the ladder, keep the A* heuristic admissible, extend
`classifyMove`, add a rationale-visible test. Pre-resolve async data in the
pipeline. → `docs/architecture/cost-model.md`

### Add a store backend

Subclass `AbstractStore`; implement `_db*`/`_vec*` as thin wrappers. `LIMIT`
variants must be real `LIMIT ?` queries; existence probes must be point probes.
Run the full suite with your store substituted. → `docs/architecture/store.md`
(+ `docs/architecture/bounded-reads.md` for caps)

## 5. Testing norms

Tests are `node:test` suites in `test/*.test.mjs`, numbered by theme, run
against built `dist/` (`npm test`; single suite:
`node --test test/22-multihop.test.mjs` after `tsc`). New behaviour ⇒ test in
the matching numbered suite or a new one. Many tests pin contracts that look
like implementation details (ladder order, span-shape readings,
`MechanismResult.complete`, fold invariance, recognition idempotence, honest
silence). A simplification that fails an existing test is wrong until the test
is proven wrong. Sublibraries test themselves in
`src/{alu,derive,rabitq-ivf}/test/` with zero Sema dependency.

## 6. Dependencies and licensing

PolyForm Noncommercial 1.0.0 with separate commercial licensing (see
`LICENSE.md`, `COMMERCIAL-LICENSE.md`, `TRADEMARKS.md`). The library has **no
runtime dependencies** — pinned by `test/88-dependency-footprint.test.mjs`
(`dist/src` may import only `node:` builtins and relative paths; `package.json`
has no `dependencies`). Examples may use dev dependencies lazily via dynamic
import only on the code path that needs them (`example/train_base` + `hyparquet`
is the reference). Training corpora: a store retains text verbatim, so upstream
licences apply in full — NonCommercial and ShareAlike corpora cannot enter a
trainer; see `DATASETS.md`.
