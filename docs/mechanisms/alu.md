# ALU — Computation as an Extension

The ALU is a self-contained sublibrary (`src/alu/`) that knows nothing about the
pipeline. `aluToMechanism` (`src/mind/mechanisms/alu.ts`) wraps it as an
ordinary `PipelineMechanism`; cover owns masking.

## How it joins search

Every mechanism may implement `parse(query) → ComputedSpan[]` (`{i,j,bytes}`).
`think` (`src/mind/pipeline.ts`) collects all parses before the grounding loop.
`pre.computed` holds the authoritative spans. Each becomes a candidate at `STEP`
(1) with `accounted: [[i,j]]`:

```ts
// src/mind/mechanisms/alu.ts — run()
{ bytes: u.bytes, accounted: [[u.i, u.j]], moves: STEP }
```

`floor` returns `0` when `pre.computed` is non-empty, else `null`.

## Masking — computation always wins

`cover` (`src/mind/mechanisms/cover.ts`) masks any recognised site whose bytes
overlap a computed span. A learned `2+2 → 5` is dropped; the computed `4` is the
sole cover there. Masking is the only precedence — a computed span and a learned
edge both cost `STEP`.

A computed span and an unrelated rewrite still compose (`"ice 2+2" → "cold 4"`).

## Registry — `derive` composes ops

`OperationRegistry` (`src/alu/src/operation.ts`) holds every op indexed by
canonical name and surface form. `prim` registers irreducible roots; `derive`
registers a rewrite over existing ops via `ctx.apply`:

```ts
registry.derive(
  "hypot",
  2,
  ["hypot"],
  (args, ctx) =>
    ctx.apply("sqrt", [ctx.apply("add", [
      ctx.apply("multiply", [args[0], args[0]]),
      ctx.apply("multiply", [args[1], args[1]]),
    ])]),
);
```

`derive(name, arity, surfaceForms, body)` — name it, list forms, write the body
in terms of existing ops. No kernel or graph-search edit.

## Broadcast — scalar ops over n-d

One place (`OperationRegistry.context`): a non-structural op applied to `nd`
lists lifts element-wise, recursing into nested `nd`. Structural ops (`nd`,
`length`, `at`, `reduce`, …) are broadcast-exempt — they consume the list whole.
So `add([1,2,3], 10) = [11,12,13]` without matrix code.

## Resonance — meaning pre-resolved

Operand meanings are pre-resolved before the synchronous kernel runs
(`AluResonance` / `prefetchResonance` in `src/alu/src/resonance.ts`):
`recogniseOp` maps a span to its operation concept, `opposite` finds the
resonant inverse of a symbol for the polymorphic `inverse`. Literal surface
forms need no host; meaning-based paths do.

## Provenance

`cover`. A computation is grounded by cover: this adapter's `parse` puts the
authoritative span into `pre.computed`, cover masks it, and cover's derivation
carries the answer out (measured: 9 of 9 computed probes report `cover` —
`137*24`, `1000 - 421`, `15 * 7`, `3+3`, `5*5`). The adapter therefore declares
`cover` — a mechanism may not invent a label outside the pipeline's `Provenance`
vocabulary, because post-grounding gates on it (see `pipeline-mechanism.ts`).
The ALU's own act is named in the TRACE (`evalComputation`/`computeExtensions`),
not in the provenance.

## Pins

- `test/18-alu.test.mjs` — arithmetic, masking, and resonance-gated ops
- `test/19-nd.test.mjs` — `nd` lists, broadcast, and higher-order ops
