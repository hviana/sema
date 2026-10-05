# Meter — What an Answer Cost

> **Law:** `src/meter.ts` is the one surface that accounts for work. Inference
> writes to it and never reads it. Its counters are exact. Its milliseconds are
> hints.

The rationale says why an answer was chosen; the meter says what choosing it
cost. Together they are Sema's development instrumentation, read only through
the public path: `new Mind({ profile: true })`, then `mind.lastCost`
(`formatReport`, `sumReports`).

## Five contracts

1. **Write-only.** No counter reaches a decision, a threshold or an ordering.
   Every call site is `meter?.x++` on a nullable field, so determinism survives
   because the meter is observed, never consulted.
2. **Counters decide; milliseconds hint.** Counters are deterministic and can be
   diffed. Compare two cold runs, because a repeated query meters less as memos
   warm. `elapsedMs` and per-phase `ms` depend on the machine: on a busy
   workstation, back-to-back runs of one build differ by up to ±15%. Judge a
   change by its counter deltas, never by time alone.
3. **Phases nest; they do not partition.** A phase is charged by the layer doing
   the work, and a mechanism's `floor` includes whatever shared analysis it
   touched first. Read a phase as inclusive wall-clock time and never sum
   phases. `CostReport.elapsedMs` is the only whole.
4. **One home for every counter name.** The meter is off by default and free
   when off. A layer that wants to be visible adds a field to `Meter`. It never
   grows a private counter, a log or a timing probe (`AGENTS.md` §6). The
   store's `danglingReads` and `compactFailures` are session health counters,
   not per-response work.
5. **A shared analysis has its own phase.** Phases are charged with
   `meter.time(phase, fn)`, or with `timeSync` for synchronous layers, so the
   profiled path never awaits where the unprofiled path does not.
   `Precomputed.shared` gives each shared analysis its own phase. Otherwise the
   profile would read "`cast.floor` costs 2 s" when the cost was the consensus
   climb, run on everyone's behalf.

`CostReport` is plain JSON: `version`, `elapsedMs`, `queryBytes`, `counters` and
`phases`. Zero counters are dropped, and `formatReport` shows the three heaviest
counters in each phase.

## Pins

- `test/55` — `Meter`, `CostReport`, `searchPops`/`searchPushes`, and phase
  nesting.
