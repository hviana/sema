# ALU — Computation as an Extension

The ALU is a self-contained sublibrary (`src/alu/`, its own README) that knows
nothing about the pipeline. `aluToMechanism` (`src/mind/mechanisms/alu.ts`)
wraps it as an ordinary `PipelineMechanism`. It is the one way Sema produces
bytes that no deposit or asker supplied, and those bytes are authoritative.

## How it joins the market

Every mechanism may implement `parse(query) → ComputedSpan[]`. `think` collects
every parse into `pre.computed` before any `floor` runs. Each computed span is a
candidate at `STEP`, with `accounted = [[i, j]]`. The floor is `0` when there
are computed spans, and `null` otherwise.

## Computation always wins — by masking, not by price

`cover` masks any recognised site that overlaps a computed span, so a learnt
`2+2 → 5` is dropped and the computed `4` is the only cover there. A computed
span and a learnt edge both cost `STEP`: precedence is policy, enforced by
masking (`cost-model.md`). A computed span still composes with an unrelated
rewrite: `ice 2+2` → `cold 4`.

## Provenance

`cover`. Cover's derivation carries the computed answer out: 9 of 9 computed
probes, such as `137*24` and `1000 - 421`, report `cover`. A mechanism may not
invent a label outside the pipeline's `Provenance` vocabulary, because
post-grounding gates on it. The ALU's own act is named in the trace
(`evalComputation`, `computeExtensions`).

## Pins

- `test/18` — arithmetic, masking, and operations gated by resonance.
- `test/19` — `nd` lists, broadcast, and higher-order operations.
