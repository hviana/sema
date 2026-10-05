# Bounded Reads — No Per-Query Read Grows With the Corpus

> **Law:** a query's cost is proportional to the query, not to how much was
> learned. Every fan-out, walk and disambiguation reads at most the oldest
> `hubBound = ⌈√N⌉` entries, and the store enforces it.

**Why.** Keeping everything means some nodes sit inside everything. A read that
follows them in full makes a bigger memory a slower thinker. The cap is a trade:
a better-supported candidate beyond the oldest `√N` is invisible. There is one
convention for this trade, and no second one. Deciding _when to stop_ inside the
cap is the walk's own saturation (`saturation.md`).

## Scale — defined once (`mind/traverse.ts`)

```
corpusN(ctx)     = max(2, store.edgeSourceCount())   // distinct learnt contexts
hubBound(ctx)    = ⌈√corpusN⌉                        // the store cap
hubCap(ctx, ids) = ids.slice(0, hubBound(ctx))       // the list-side reading
boundFor(n)      = ⌈√max(2, n)⌉                      // the ctx-free reading
```

Import these, and never re-derive them inline: no `edgeSourceCount()` or
`Math.sqrt` at a call site, and no private per-walk limit.

## Enforcement — the store, not the caller

| Kind                | Methods                                                          | Contract                                                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LIMITed reads       | `nextFirst`, `prevFirst`, `parentsFirst`, `containersSlice`      | A real `LIMIT ?`, with the same `ORDER BY` as the full read, never a materialise-then-slice. Reading `bound + 1` decides "hub or not" exactly.                                                                                                   |
| existence probes    | `hasNext`, `hasParents`, `hasContainers`, `hasHalo`, `prevCount` | One indexed `EXISTS`/`COUNT`, with no vector decode and no blob unpack. Use these, never `next(id).length > 0`.                                                                                                                                  |
| prefix-capped reads | `bytesPrefix(id, cap)`, `contentLen(id, cap)`                    | They stop at the cap: `contentLen` is exact below it and reports `≥ cap` otherwise. An oversized candidate is rejected on the length probe alone. Uncapped reads in the weave, junction walks or bridge cost seconds per query on a large store. |
| transparent runs    | `chainRun(id)`                                                   | One recursive CTE climbs a run of single-parent, edge-less nodes. It is cached for the store's lifetime and dropped on writes that break transparency.                                                                                           |

The full reads (`next`, `prev`, `parents`, `containers`) exist for inspection
and maintenance only (`compactContentIndex`, `repairContentIndex`).

## Pins

- `test/14` — inference is sublinear in corpus size and linear in input length;
  recall stays exact at scale.
- `test/89` — completion recursion is output-sensitive: the _number_ of reads is
  bounded, not just their size.
- `test/90` — the connector probe reads by the query's length, not by the learnt
  continuation's.
- `test/119` — the derivation's work is flat in `N` for a byte-identical answer.
