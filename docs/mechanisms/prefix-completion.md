# Prefix Completion — Literal Opening of One Trained Form

The query is a proper prefix of exactly one trained form. That form is voiced
whole; nothing is invented.

## Gate — exactly one opener

A candidate is a form whose bytes literally open with the query (every query
byte matched in order from offset zero). Grounding requires **exactly one
distinct continuation** over the candidate set:

- **Candidates** = `formsOpenedBy` (content-addressed window index) ∪ memoised
  `resonance` top-k — evaluated as one union so an exact-index ambiguity cannot
  be hidden by the approximate tier.
- **Distinctness** is by continuation bytes, not form id.
- **Zero or ≥2 distinct continuations → refuse** (the prefix trap).

## Cost (`src/mind/graph-search.ts`)

| Symbol | Value | Rule                                              |
| ------ | ----- | ------------------------------------------------- |
| `STEP` | 1     | maximal claim: every query byte literally matched |

`floor` returns `STEP`; `run` returns one candidate with `moves = STEP`,
`accounted = [[0, query.length]]`, `bytes = form`.

## `complete` flag

The result carries `complete` semantics: the grounded bytes are a trained form
reached by identity. Post-grounding (`reason` → `fuse`) must not extend them.

## Guards (from `src/mind/mechanisms/prefix-completion.ts`)

1. **Unreadable veto** — a saturating `bytesPrefix` read is a standing
   disagreement; if any candidate saturates, none is licensed.
2. **One grouping window** — continuation must be ≥ `W` (`maxGroup`);
   sub-quantum tails are unvoiceable and also count as disagreement.
3. **Uniqueness** — as above.

Structural pre-check (`floor`): `query.length * W < query.length + W` → `null`
(no room for a perceivable continuation).

## Where it runs

Last grounding mechanism in `defaultMechanisms` (`mind/pipeline.ts`); registered
after recall so an exact self-match (`IDENTITY`) wins ties. Shares
`formsOpenedBy` (`mind/traverse.ts`) and `Precomputed.resonance()`.

## Pins

- `test/70-prefix-completion.test.mjs` — literal prefix, ambiguity, sub-quantum,
  saturating-read veto, determinism.
- `test/72-prefix-candidate-supply.test.mjs` — `formsOpenedBy` ∪ `resonance`
  union supply; resonance alone cannot rank a proper prefix.
