# Factored Machinery — One Definition, Many Consumers

> **Law:** every operation that more than one layer relies on is defined once
> and imported everywhere. A second copy is a write/read drift waiting to
> happen. A copy moved into a consumer hides who owns the gate.

Each row is a contract that broke at least once when it existed twice:

- `contentBoundaries` carried its own hash loop;
- the ingest cache re-implemented deposit, then the pair law;
- recall spelled its own fragment test.

## Single-definition contracts

- `contentLevels` (`geometry.ts`): the boundary rule: cuts and levels from one
  rolling hash (`fold-contract.md`).
- `groupByLevel` / `foldSlice` (`geometry.ts`): the tree's shape, written once
  over two algebras (vector and identity).
- `twoEndedSeat` (`sema.ts`): the seat algebra: low seats for the first half,
  high seats for the second.
- `isChunk` (`sema.ts`): the smallest grouped unit, a node whose children are
  all leaves.
- `exactNode` / `branchNaming` (`mind/primitives.ts`): exact lookup: the
  identity fold, naming a branch exactly as `intern` does.
- `canonicalWindows` / `flatId` / `windowIds` (`mind/canonical.ts`): the window
  contract: deposits intern windows of `W−1` and `W`, and reads probe spans as
  flat branches.
- `leadsSomewhere` / `learntWhole` (`store.ts`, memoized in `traverse.ts`):
  admission: `hasNext || hasHalo`; what a deposit learnt whole (`store.md`), a
  thing when it leads on.
- `boundFor` / `corpusN` / `hubBound` / `hubCap` (`geometry.ts`,
  `mind/traverse.ts`): the scale and its cap (`bounded-reads.md`).
- `sharedReachMemo` (`mind/traverse.ts`): one `AncestorReach` memo for every
  `reachOf`/`edgeAncestors` voter.
- `answersOtherQuestions` (`mind/traverse.ts`): the fragment predicate: inside
  other forms, several or only inherited continuations, the question partly
  outside (`evidence.md`).
- `otherInstance` (`mind/traverse.ts`): another instance of the question,
  refused by recall's anchor and bridge, fusion and CAST (`evidence.md`).
- `heldWithin` (`mind/traverse.ts`): the piece: a node a larger form holds
  (parents or containers); its negation is a deposited top.
- `thingsIn` (`mind/recognition.ts`): the things a span holds, exact or
  canonical, learnt whole and leading on (the walk's pivot, derive-through).
- `instanceCap` (`geometry.ts`): the instance scale `2·len`: the cap on reading
  a form as another instance of the question.
- `spanHalo` (`mind/traverse.ts`): a span's company: halos of the oldest
  contexts its windows reach that hold it (a use, synonym tier).
- `licensedSubstitution` / `substitutionGrade` (`mind/traverse.ts`): the licence
  of a transfer, every substitution's one grade (`exact-vs-approximate.md`).
- `pairVariants` (`mind/junction.ts`): a pair up to synonyms: each side or both
  a halo sibling; `licensedVariants` keeps each side's best grade.
- `junctionContainersFrom` + `WalkCache` (`mind/junction.ts`): the
  content-addressed ascent of the bridge and attention.
- `joinWithBridge` (`mind/resonance.ts`): joining two results outside the
  search: `bridge(left, right)`, or a bare join traced as `bridgeMiss`.
- `bytesKey` (`bytes.ts`): the content key of a sequence of byte strings,
  length-prefixed, so injective for arbitrary bytes (`test/02`).
- `dismissedKnownContent` (`mind/bridge.ts`): the gap guard shared by
  substitution and CAST: no dismissed window may resolve as known content.
- `locate` / `alignGraded` / `frameSlots` / `project` (`mind/match.ts`): the
  matcher family; gates belong to the consumers (`match-project.md`).
- `witness` / `windowIndex` (`mind/evidence.ts`): order-free W-window coverage,
  the evidence reading (`evidence.md`).
- `closed` / `admissible` / `advance` / `closeOver` / `unexplainedSpans`
  (`mind/derivation.ts`): the closure law, its span algebra and its engine
  (`closure.md`).
- `Precomputed` (`mind/pipeline-mechanism.ts`): the per-response shared analyses
  (`memoization.md`).
- `weigh` (`mind/pipeline.ts`): the price, `moves + PASS·unaccounted`
  (`cost-model.md`).
- `Meter` (`meter.ts`): every counter name (`meter.md`).

## Pins

- `test/137` — the law lives once and below: no hand-built transition outside
  `advance`, no inline re-spelling of a law reading, and no dead export.
- `test/47` — the frame reading split into matcher, inventory and gate.
- `test/50` — CAST's shared guards: dismissed content, the frame from
  `AGREEMENT` and `dominates`.
