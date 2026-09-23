# Meter — Work Accounting

`src/meter.ts` is the one computational-usage accounting surface. It counts what
inference _cost_ so a slow response can be attributed instead of guessed at. The
rationale says why an answer was chosen; the meter says what it cost to choose
it. Harness: `bench/profile-inference.mjs`.

## Five contracts

1. **Write-only from inference.** No counter reaches a decision, a threshold, or
   an ordering. Determinism survives only because the meter is observed, never
   consulted. Every call site is `meter?.x++` on a nullable field.

2. **Counters vs hints.** Counters are deterministic and diffable between runs;
   the same query on the same store meters identically, so a regression is
   visible in a diff. Millisecond fields (`elapsedMs`, per-phase `ms`) are
   non-deterministic hints reported separately — never use them to gate
   behaviour.

3. **Phases nest, they do not partition.** Each phase is charged by the layer
   doing the work (`recognise`, the climb's two, the bridge), and a mechanism's
   `floor` contains whatever shared analysis it first-touched. Read a phase as
   inclusive wall-clock; never sum phases. `CostReport.elapsedMs` is the only
   whole.

4. **Count once.** Off by default and free when off
   (`new Mind({ profile:
   true })` to attach). A layer that wants to be
   visible bumps a field in `meter.ts` — it does not grow a private counter.
   (Legacy `danglingReads` / `compactFailures` in `store.ts` are health
   counters, not per-response work.)

5. **Shared analyses charged to themselves.** The first toucher pays the wall
   clock, but every later consumer gets the result free. Attribution follows the
   analysis, not the mechanism that first triggered it — otherwise the profile
   misreads which work is expensive (e.g. the consensus climb billed through
   whichever mechanism happened to need it first).

## Where counters live

`src/meter.ts:Meter` is the only definition of a counter name. Phases are
charged via `meter.time(phase, fn)` / `meter.timeSync(phase, fn)`, which
snapshot counters on entry and attribute the delta to the phase. The sync/async
seam is load-bearing: synchronous layers (perception, recognition, graph search)
must use `timeSync` so the profiled path does not await where the unprofiled
path does not.

`CostReport` is plain JSON (`version`, `elapsedMs`, `queryBytes`, `counters`,
`phases`). Zero-valued counters are dropped; `formatReport` renders the three
heaviest counters per phase.

## Pins

- `test/55` — `Meter`, `CostReport`, `searchPops` / `searchPushes`, phase
  nesting.
