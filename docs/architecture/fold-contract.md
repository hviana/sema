# Fold Contract — One Tree For The Same Bytes

> **Law:** `perceiveDeposit` ≡ `perceive` — same bytes ⇒ same tree and same node
> id. Deposit imposes nothing (no boundaries, no turn convention). Geometry
> never sees conversation metadata.

## The identity

Perception is a pure function of the bytes. The deposit path and the inference
path compute the same content-defined fold for the same input, so a trained
context node and `resolve(query)` reach the same node. When the two sides
disagreed, alignment went quadratic (measured 5.2M cells on a 476-byte context
vs 0 when they agree) and cumulative contexts stopped resolving to what they
were trained as.

## Deposit imposes nothing

No boundaries, no turn convention, nothing read out of the bytes. Conversational
turn offsets are API metadata — they feed `ConversationState`, `answeredSpans`
and `currentTurnStart`; the geometry never sees them. Passing turn boundaries
into the fold is a correctness bug, not a tuning choice.

## Boundaries vs reuse — two problems

`contentFoldIncremental` and `stablePrefixFold` solve different problems;
conflating them is what once put an imposed boundary set on the inference path.

| Mechanism                | What it buys                                              | Cost / shape                                                                                    |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `contentFoldIncremental` | Transparent segment reuse (cost only)                     | Imposes nothing; tree identical to the cold fold                                                |
| `stablePrefixFold`       | Caller-supplied cuts left-nested for prefix-ROOT identity | One prefix-ROOT per cut becomes an identical subtree (and same node id) inside the grown stream |

Both carry the same precondition: `prev` must be a fold of a byte-identical
prefix — reuse is keyed on `[start,end)` offsets, which cannot witness byte
agreement. A mismatched `prev` produced a wrong tree on 336 of 400 random
streams. `perceiveDeposit` discharges this via the prefix bytes as cache key; a
conversation advances only by append. A caller that cannot prove the prefix must
pass no `prev`.

## Identity must not depend on W or absolute offset

`contentLevels` is the single boundary rule (rolling hash over a bounded
window). Any grouping by index — stride, tile, fixed-arity row — reintroduces
the grid's phase bug: `riverFold` groups `W`-ary from byte 0, so the same byte
run is a different subtree at a different offset. The content-defined hash
removes this: a change upstream moves only the cut it falls inside; downstream
cuts and segments are unchanged (99.7% cuts preserved on real deposits after
shifts of 1..7 bytes vs 14.3% for the grid). The `groupByLevel` above the
segments splits by content level, not by count.

## `contentLevels` is single source; `contentBoundaries` is projection

`contentBoundaries(space, bytes)` is `contentLevels(space, bytes).cuts`. It once
carried its own rolling-hash loop, which is how a write side and a read side
drift without a type error. Levels are read from the hash the cut was accepted
at — level `L` when `h` vanishes mod `W^(L+1)` — so level-`L` cuts nest inside
level-`(L-1)` and expected span is `W^(L+1)` bytes.

## Optional canonical capability

`canonAdd`/`canonFind` (`src/store.ts` — `canonCount`/`eachContent`) is an
optional backend capability. A backend may omit all four; resolution then has no
equivalence fallback. The store never learns the equivalence — the canonicalizer
(`Canon` in `src/canon.ts`, e.g. `textCanon`) is injected by the caller and
every candidate is hash-then-verified (re-canonicalize stored bytes, compare). A
hash collision costs a read, never a wrong id.

## Cost of changing the cut distribution

The cut rate, which bits are read, `minLen`/`maxLen`, and the forced cut at
`maxLen` set the segment distribution every downstream mechanism is fitted to.
Each has been changed experimentally and cost 5–21 tests (rate: 15–18, bits:
19–21, normalized chunking: 5–6). `W-1` is the minimum (one window minus one);
`seats.length` is the maximum (one flat node folds exactly one segment). The
forced cut is load-bearing — relaxing it to reduce the current 32% forced rate
looked like a tidying but broke the same suites. Re-measure the whole suite for
any change here.

## Pins

- `test/59` — shift invariance floors (content-defined cuts preserved over
  random binary and prose).
- `test/63` — offset/W invariance and `contentLevels` distribution expectations.

See:
`src/geometry.ts:contentLevels`/`contentBoundaries`/`contentFoldIncremental`/`stablePrefixFold`;
`AGENTS.md` bootloader invariants.
