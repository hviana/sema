# ALU — Computation as a Mechanism

The ALU is a self-contained sublibrary (`src/alu/`, its own README) whose code
lives apart from Sema's, importing nothing from it, to show that a mechanism
need not be Sema's own. It spells its mechanism itself
(`src/alu/src/mechanism.ts`, `aluMechanism`) and joins as every mechanism does:
one factory in the registration (`src/mechanisms.ts`, `defaultMechanisms`),
handed the mind's port (`ExtensionHost`).

## How it competes

`floor` parses the query: `null` with nothing to compute, else one move
(`host.step`), the least an answer costs. `run` returns one candidate per
computed span: the result, `accounted = [[i, j]]`, one move, and `piece`, for it
is a function of its span alone. The decider weighs them like any candidate
(`cost-model.md`): `2+2` explains its three bytes at `STEP`, `what is 2+2`
leaves the frame unaccounted, and a piece composes with the rest of the
question: `ice 2+2` → `cold 4`.

Nothing privileges it: no mechanism reads its spans, and at an equal grade the
declared order decides, so a corpus that learnt `2+2 → 5` answers `5` (the
cover, earlier, explains the same bytes at the same price).

## Provenance

`alu`: a mechanism names its own act. Provenance is reported, compared nowhere.

## Pins

- `test/18` — arithmetic, numerical operations, and operations by resonance.
- `test/19` — `nd` lists, broadcast, and higher-order operations.
- `src/alu/test/` — the ALU alone, with no Sema dependency.
