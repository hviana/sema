# Determinism — Same Seed + Same Deposits + Same Query ⇒ Same Bytes

## The law

> Same `seed` + same deposit order + same query ⇒ byte-identical answer.

Determinism is the product. Every code path that can reach output must be
deterministic given `(seed, store contents, query bytes)`.

## Forbidden

No `Math.random` or `Date.now` in behaviour, and no iteration over unordered
collections where order can reach output. Example-only uses
(`example/train_base`) are outside the library contract. If a test becomes
flaky, the contract was broken, not the test.

## All randomness flows from `seed`

`MindConfig.seed` (`src/config.ts:resolveConfig`, `DEFAULT_CONFIG`) is the sole
entropy root. Subsystems derive deterministically:

- **Alphabet** — `Alphabet` (`src/alphabet.ts`) via `rng` (`src/vec.ts:rng`)
  seeded as `seed ^ seedMask`; builds 16→64→256 vectors.
- **Keyring / Space** — `Space.seats` (`src/sema.ts:Space`) via `makeKeyring`
  (`src/vec.ts:makeKeyring`) and `rng` seeded from `seed` in `Mind`
  (`src/mind/mind.ts`); `fold`/`twoEndedSeat`/`companySignature` are pure over
  `Space`.
- **Vector indexes** — `VectorDatabase` (`src/rabitq-ivf/src/database.ts`) and
  `Prng` (`src/rabitq-ivf/src/rabitq.ts`) seeded from config; insertion order is
  the stored order, not a random choice.

No other PRNG source may affect grounding. Thresholds in `geometry.ts` are
derived from `D`/`W`/`N`, not sampled.

## Tie-breaks are corpus-determined

Every choice bottoms out in a fixed ordering — insertion order or lowest node id
— not interchangeable (`test/34`). The fallback is **first-inserted**:

- `guidedFirst` (`src/mind/traverse.ts:guidedFirst`) — guided pick via
  `chooseNext` else first-inserted edge (`nextFirst` LIMIT 1).
- `chooseNext` (`src/mind/traverse.ts:chooseNext`) — capped `nextFirst` read
  (`hubBound`), ranked by `prevCount` then `haloMass`; equal ⇒ first-inserted.
- `chooseAmong` (`src/mind/traverse.ts:chooseAmong`) — `hubCap` + `argmaxCosine`
  over `candidateGist`; first-inserted on tie via stable scan.
- `companySignature` (`src/sema.ts:companySignature`) — `rng(id ^ 0x9e3779b9)`,
  i.e. seeded by node id, not observation order.

Never use last-inserted.

## Memoization and trace must not break identity

Per-response memos (`Precomputed`, `perceiveMemo`, `recogniseMemo`, `climbMemo`,
`_resolvedSubtrees` via `foldTree`, `_edgeChoice`, `_gistCache` in
`src/mind/mind.ts` / `src/mind/pipeline-mechanism.ts` /
`src/mind/primitives.ts`) are sound because asking never writes. Only
`guidedNext`/`sharedReachMemo` are trace-bypassed;
`perceiveMemo`/`recogniseMemo`/`climbMemo` are always consulted — `foldTree`'s
subtree fast path skips `visit` (and site emission) for cached subtrees, so
bypassing makes `recognise` non-idempotent.

## Follow it

When you add any choice among equals, name the tie-break explicitly and make it
corpus-determined. Thread new randomness through `seed`-derived `rng`; never
call `Math.random`/`Date.now` on a behavioural path.

## Pins

- `test/42` pins recognition idempotence under trace — traced and untraced
  `recognise` must return the same cached object and site count.
- Determinism suites — `test/03`, `test/04`, `test/08`, `test/20` — assert same
  seed + same training ⇒ byte-identical answers and stores.
