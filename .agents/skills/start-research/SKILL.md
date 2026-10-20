---
name: start-research
description: Runs an automated research cycle on the Sema repository — refresh the dependency skills, fetch the trained store into data/, build a fast and a gate measurement harness over it, then scientific-brainstorming → hypothesis-generation → arbor → measure, and admit a change only when it passes every Sema quality criterion. Use when asked to start, continue, or automate research on Sema.
allowed-tools: Read, Write, Edit, Bash, Skill, Agent
license: PolyForm-Noncommercial-1.0.0
metadata:
  version: "1.0"
  dependencies: "scientific-brainstorming · hypothesis-generation · arbor"
---

# Start Research

Automated research on Sema. Six steps, in order. Each step ends with its ledger.

## Chain-of-Thought contract

One reasoning move per step. Never skip, merge, or reorder a step. Close every
step with exactly these three lines — no prose around them:

```
OBSERVED: <a measured fact + the counter or rationale step that carries it>
INFERRED: <only what that fact licenses>
NEXT:     <the single step that follows>
```

Rules:

- An `INFERRED` with no `OBSERVED` is a guess. Drop it.
- Measurement evidence is `mind.lastCost` and `inspectRationale`, plus the
  suites' pass/fail. Nothing else counts.
- One hypothesis in flight. Arbor's tree holds every other one.
- A failed gate is a result: revert the diff, write the refutation into the
  tree, continue. Never weaken the gate to pass it.

## 0 — Ground

```bash
mkdir -p .claude/skills && for s in .agents/skills/*/; do ln -sfn "../../${s%/}" ".claude/skills/$(basename "$s")"; done
cat docs/PHILOSOPHY.md docs/INDEX.md docs/failures/tempting-but-wrong.md
```

The first line is idempotent self-healing: the skills are versioned in
`.agents/skills/`, `.claude/` is the developer's own and is gitignored, so only
our four names are linked in. `docs/INDEX.md` routes each later step to the law
it touches.

## 1 — Update the dependency skills

Plain `git` + `cp`. No `npx`, no package manager, no installer.

```bash
U=https://github.com/K-Dense-AI/scientific-agent-skills.git
T=$(mktemp -d) && git clone --depth 1 "$U" "$T/up" && git -C "$T/up" rev-parse HEAD
for s in scientific-brainstorming hypothesis-generation arbor; do
  [ -d "$T/up/skills/$s" ] || { echo "ABSENT UPSTREAM: $s"; continue; }
  rm -rf ".agents/skills/$s" && cp -r "$T/up/skills/$s" ".agents/skills/$s"
done
cp "$T/up/LICENSE.md" .agents/skills/UPSTREAM-LICENSE.md && rm -rf "$T"
```

The copy is idempotent, so running it **is** the check. Compare the printed
commit with `.agents/skills/VENDOR.md`: if it moved, record it there with
today's date, re-run step 0's link loop, and re-read the three `SKILL.md` files
**from disk** — the host loaded them at startup, so what is in context is the
old copy.

## 2 — Get the real store

The harnesses measure on real data: `data/sema.sqlite` plus its two vector
indexes (`SQliteStore` finds them by stem). `data/` is gitignored — never commit
it. Download only what is missing or truncated:

```bash
B=https://huggingface.co/buckets/hviana/sema-trained-v1/resolve
mkdir -p data
for f in sema.sqlite sema.content.vec sema.halo.vec; do
  r=$(curl -sIL "$B/$f?download=true" | awk 'tolower($1)=="content-length:"{n=$2} END{print n+0}')
  [ "$r" -gt 0 ] || { echo "NO REMOTE SIZE: $f"; continue; }
  l=$(wc -c < "data/$f" 2>/dev/null || echo 0)
  [ "$l" = "$r" ] || curl -fL -C - -o "data/$f" "$B/$f?download=true"
done
```

## 3 — Build the two harnesses

Both live in `bench/` (gitignored), run against built `dist/`, open the store
once, and read **only** the official instruments. Speed is the point of the
split: research stalls on a slow gate.

> The store path is a **stem**: `data/sema`, not `data/sema.sqlite`. Give it the
> file name and `SQliteStore` silently creates a new, EMPTY store beside it
> (`data/sema.sqlite.sqlite`) — every number you then measure is a fiction.

| Harness          | Scope                                                         | Budget  |
| ---------------- | ------------------------------------------------------------- | ------- |
| `bench/gate.mjs` | final gate — one case per capability of inference/composition | ≤ 5 min |
| `bench/fast.mjs` | fast loop — only the gate cases being fixed                   | ≤ 30 s  |

Latency is I/O-bound and machine-specific — measured here, one cold distinct
query costs ~5 s against a 10 GB store on 7 GB of RAM. So the budget is a **case
count you calibrate once, by measuring**. Coverage is the floor (~12–15 cases:
the eight mechanisms, composition across them, honest silence, determinism),
never padding. Derive the cases from `docs/mechanisms/` — one file per mechanism
states what it answers by.

Three rules keep the counters comparable; break one and the gate lies:

- **One fresh process, fixed case order, every run.** Sema's session caches
  (`docs/architecture/caches.md`) make a case cheaper when an earlier case
  warmed it. That is fine — but only if the topology is identical on both sides
  of a before/after.
- **Compare counters, not milliseconds** (`meter.md`: counters are exact, ms are
  hints).
- **The determinism case asserts bytes only.** Re-asking in the same process
  returns the same bytes on far fewer counters (measured: `edgeProbes` 13,186 →
  111). A counter assertion there would pin the cache, not the law.

A case is `{ id, mechanism, ask, expect }` of one of two kinds: a **pin**
(`expect` = what this build already answers — it catches regression) or a
**gap** (`expect` = the answer Sema ought to give, failing today). `fast.mjs`
runs the gaps. Probe the store before writing either: a gap must be a real
capability failure, never an expectation this corpus cannot support.

`gate.mjs` writes `bench/gate.json`: per case the expected/actual bytes, the
winning provenance, the runner-up margin, and the counters. `fast.mjs` reads
that file and runs the failing ids only (override with `FAST_IDS=a,b`). The
winning tag is not the file name: `confluence`→`join`, `extraction`→`extract`,
`prefix-completion`→`prefix`, `recall`→`recall`/`recall-echo`, `alu`→`cover`.

```js
import {
  formatReport,
  Mind,
  SQliteStore,
  sumReports,
} from "../dist/src/index.js";
const store = new SQliteStore({ path: process.env.SEMA_STORE ?? "data/sema" });
const mind = new Mind({ store, profile: true });
let decision = null; // the market's own verdict
const text = await mind.respondText(c.ask, (s) => {
  if (s.mechanism.at(-1) === "decideGrounding") decision = s.data;
});
reports.push(mind.lastCost); // formatReport(sumReports(reports)) at the end
```

`decision` stays `null` when nothing grounds — that is the honest-silence
assertion. `alu` grounds under the tag `cover`: assert the bytes. If the gate
ever needs to tell those two apart, close it **in the instrumentation**
(`AGENTS.md` §6), never with a private probe in the harness. Close the store
(`await mind.store.close()`) so a run ends clean.

```bash
npm run build && node bench/gate.mjs && node bench/fast.mjs
```

Record this as the **baseline** before step 4: `npm test` green and a
`bench/gate.json` from the unchanged build. Criteria 3 and 4 are read against it
— a change with no "before" is unmeasurable.

## 4 — Research loop

Run the skills in this order, once per cycle:

```
scientific-brainstorming → hypothesis-generation → arbor → bench/fast.mjs → bench/gate.mjs
```

| Call                              | Hands on                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `Skill(scientific-brainstorming)` | candidate directions, ranked by the objective below                                     |
| `Skill(hypothesis-generation)`    | one falsifiable hypothesis + the counter that would refute it                           |
| `Skill(arbor)`                    | `M_0` = this repo, `E_dev` = `bench/fast.mjs`, `E_test` = `bench/gate.mjs` + `npm test` |

Arbor's held-out merge gate is `bench/gate.mjs` **and** `npm test`; executors
optimize against `bench/fast.mjs` only. Two rules keep it held out: an executor
may **add** a test, never edit or delete an existing one, and never touch a
`bench/gate.mjs` case.

Arbor isolates executors in git worktrees, where `data/`, `node_modules/`,
`dist/` and `bench/` are absent — all gitignored. Seed each worktree, then build
it:

```bash
ln -s "$ROOT/data" "$W/data" && ln -s "$ROOT/node_modules" "$W/node_modules"
cp -r "$ROOT/bench" "$W/bench"          # its own gate.json; the store is shared
(cd "$W" && npm run build && node bench/fast.mjs)
```

Run harnesses **one at a time**: they share one store file, and concurrent runs
make the counters and the page cache incomparable.

### Objective, in priority order

1. **Fundamental machinery** that improves how Sema recovers information from
   the store, or how a mechanism uses that information in inference/composition.
2. **Fundamental machinery** that deduplicates code or mechanisms.
3. **A new mechanism** — may grow the code, so it needs an exceptional
   justification against 1 and 2.

A cycle that produces only 3 when 1 or 2 was reachable has failed.

## 5 — Adversarial review

Attack the diff against every criterion. State the evidence per row; a row
without evidence is a failure, not a pass. Any failure ⇒ revert and return to 4.

| # | Criterion                                                                                                                                                                                |
| - | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Official instrumentation only (`inspectRationale`, `meter.ts`). Any further need improves **those** instruments — no parallel channel, no ad-hoc logging.                                |
| 2 | Sema's principles, foundations and the five invariants hold (`docs/INVARIANTS.md`).                                                                                                      |
| 3 | No behavioural regression. Not the same as keeping all behaviour identical — see `docs/failures/tempting-but-wrong.md`.                                                                  |
| 4 | No prohibitive cost increase. Prefer better complexity (superlinear → linear → sublinear). Nothing may depend on corpus size (`test/14-scaling`).                                        |
| 5 | Every fix carries one test that proves the need irrefutably — quality over count, no accidental pass (`tempting-but-wrong.md`), in the matching numbered `test/` suite (`AGENTS.md` §5). |
| 6 | Clean code: OO practice, conventions and design patterns, sitting in — or spread across — the right layers, with no logical, semantic or conceptual duplication.                         |
| 7 | No store change and no new index, unless exceptionally justified.                                                                                                                        |
| 8 | Every code change is reflected in the `.md` files (excluding the root README and the licences) — see below.                                                                              |

**Criterion 8, how.** Those files hold the minimum text needed to understand the
whole. They must describe current behaviour. Do not rewrite them: they contain
human-written passages. Replace the pertinent passage, in place, and keep the
file's size from growing.

A cycle that passes: keep the diff, record the result in Arbor's tree, and
return to 4 with the next gap. Stop when no gap remains, or when the user says
so.

Close with the ledger, then report: hypothesis, evidence, diff, counters
before/after, and the criteria table.
