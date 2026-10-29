# ALU — Computation as a Mechanism

The ALU is a self-contained sublibrary (`src/alu/`, its own README) whose code
lives apart from Sema's to show that a mechanism need not be Sema's own. It
imports nothing from Sema. It spells its mechanism itself
(`src/alu/src/mechanism.ts`, `aluMechanism`), structurally, and joins the way
every mechanism does: one factory in the registration (`src/mechanisms.ts`,
`defaultMechanisms`), handed the mind's port (`ExtensionHost`).

## How it competes

`floor` parses the query. With nothing to compute it is `null`. Otherwise it is
one move (`host.step`), the least any computed answer costs. `run` returns one
candidate per computed span: the result bytes, `accounted = [[i, j]]`, one move.
The decider weighs them like any candidate (`cost-model.md`): `2+2` explains its
three bytes at `STEP`, `what is 2+2` leaves the frame unaccounted.

Nothing privileges it. No mechanism reads its spans, nothing masks a learnt
site for it, and at an equal grade the declared order decides, as for every
candidate: a corpus that learnt `2+2 → 5` answers `5`, since the cover, earlier
in the order, explains the same bytes at the same price.

## Provenance

`alu`: a mechanism names its own act. Provenance is reported, compared nowhere.

## Pins

- `test/18` — arithmetic, numerical operations, and operations by resonance.
- `test/19` — `nd` lists, broadcast, and higher-order operations.
- `src/alu/test/` — the ALU alone, with no Sema dependency.
