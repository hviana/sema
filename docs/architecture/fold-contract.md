# Fold Contract — One Tree for the Same Bytes

> **Law:** perception is a pure function of the bytes. A deposit
> (`perceiveDeposit`) and a question (`perceive`) fold the same bytes into the
> same tree, and the read side names that tree with the node the write side
> interned. Nothing absent from the bytes may shape the tree: turn boundaries,
> offsets and index-aligned grids are excluded.

Identity is content (`store.md`), so a question finds what memory holds only if
it is cut exactly as the deposit was. When the two sides disagreed, alignment
went quadratic (5.2M cells on a 476-byte context, against 0 when they agree),
and cumulative contexts stopped resolving to what they were trained as.
Conversation state (`ConversationState`, `answeredSpans`, `currentTurnStart`) is
API metadata and never reaches the geometry. Passing turn boundaries into the
fold is a correctness bug, not a tuning choice.

## The boundary rule — `contentLevels`

`contentLevels` is the one boundary rule, and `contentBoundaries` is its
projection.

- **Cuts.** A rolling hash runs over a bounded window of the bytes, and a cut
  falls where it vanishes. A cut is level `L` when the hash vanishes mod
  `W^(L+1)`, so level-`L` cuts nest inside level-`(L−1)` cuts, and a level-`L`
  span averages `W^(L+1)` bytes.
- **Segments.** A segment runs from `W−1` bytes to `seats.length` bytes, the
  most one flat node folds, with a forced cut at the maximum.
- **Grouping.** `groupByLevel` groups segments by their level, never by count.

**Why content, not position.** A change moves only the cut it falls inside.
After shifts of 1–7 bytes, 99.7% of cuts on real deposits survive, against 14.3%
for a fixed grid. Grouping by index (a stride, a tile, a fixed-arity row such as
`riverFold`'s `W`-ary grouping from byte 0) makes the same run a different
subtree at a different offset.

**The distribution is load-bearing.** Each of these has been changed
experimentally, and each change broke tests:

| Change                  | Tests broken    |
| ----------------------- | --------------- |
| cut rate                | 15–18           |
| bits read               | 19–21           |
| normalized chunking     | 5–6             |
| relaxing the forced cut | the same suites |

The forced cut accounts for 32% of all cuts. Every mechanism downstream is
fitted to this distribution, so any change here must be re-measured on the whole
suite. A second copy of the hash loop, which `contentBoundaries` once carried,
lets the write side and the read side drift without a type error.

## One shape, two algebras

`groupByLevel` and `foldSlice` are written once, over a fold algebra (`join`,
`key`), and run over two algebras:

- **The vector fold (`perceive`)** produces gists.
- **The identity fold (`contentIdentity`)** names the node a stream folds to by
  asking the store bottom-up as it folds.

Inside an over-long row, grouping also reads each item's `itemKey`: eight raw
gist coordinates. The identity fold computes only those coordinates, lazily,
with the same float32 additions in the same order. `exactNode` is the identity
fold, so resolving a span builds no `D`-dimensional gist. On the 31.7M-node
store, one join query went from 185 s and 4.4 GB retained to 40 s and 81 MB,
with the same answer. Written once, the two folds cannot disagree about the
tree.

## The read side names as the write side names

The store's `intern` names a branch by its children first. When the children
name nothing, it reuses the flat node over the same bytes ("same bytes, same
node"). Deposits intern flat nodes, so a later deposit's branch is often stored
as an earlier deposit's window: `ver` + `!` is stored as the window `ver!`.
`branchNaming` (`mind/primitives.ts`) applies the same order on the read side,
in `exactNode` and `foldTree`, and an unnamed child does not settle the
question. On the 31.7M-node store, 7 of 80 dialogue turns asked verbatim used to
resolve to nothing, costing 26–41 s each on the composition path. They now
resolve to their own context.

A name found only through the bytes is a flat entry, not a learnt structure. In
that case `resolve` also asks the canonical class (`exactNaming`'s `byBytes`)
for the member that leads somewhere. That class is an optional capability
(`store.md`), and its candidates are hash-then-verified.

Known limit: a context stored with cuts at the ends of earlier turns does not
resolve. No current deposit path produces that shape, and reproducing it would
mean guessing turn boundaries, which this contract forbids.

## Canonical windows — finding a span whatever the fold did

Besides its tree, every deposit interns flat nodes:

- its whole stream;
- each window of `W−1` and `W` bytes, contained by the chunks it overlaps
  (`canonicalWindows`, `indexSubSpans`).

Recognition's canonical reading chains these windows up to `chainReach = W²`
leaf ids from a position. This write/read pair finds a form embedded at an
offset where the question's own cuts do not line up with it (`canonical.ts`).

## Incremental folds — reuse is not boundaries

`contentFoldIncremental` reuses already-folded segments of a byte-identical
prefix. The result is the cold fold's tree, so the reuse changes cost only. It
is the only fold any internal path computes: `perceiveDeposit` keys the reuse on
the prefix bytes, and a conversation advances only by appending.

`stablePrefixFold` is a separate, public geometry capability. It takes cuts
supplied by the caller and nests them to the left, so that each prefix root is
an identical subtree inside the grown stream. No path inside the mind supplies
such cuts, and confusing the two capabilities is how an imposed boundary set
once reached inference.

Both capabilities require `prev` to be a fold of a byte-identical prefix. Reuse
is keyed on offsets, and offsets cannot witness that the bytes agree: a
mismatched `prev` produced a wrong tree on 336 of 400 random streams. A caller
that cannot prove its prefix must pass no `prev`.

## Pins

- `test/59` — shift invariance: content-defined cuts survive shifts in random
  binary and in prose.
- `test/63` — offset and `W` invariance, and the expected `contentLevels`
  distribution.
- `test/148` — the identity fold names exactly what the vector fold names, and
  groups as it does over long low-entropy streams that force the `itemKey`
  split.
- `test/152` — a deposit stored through an earlier deposit's flat window
  resolves to its own context, and is answered on the exact path.
