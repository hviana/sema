# Recall — Nearest Stored Form

Recall resonates the whole query's gist against the content index and grounds
the nearest learned form. Resonance proposes; bytes decide.

## Gist and budget

Query gist is `pre.guide`; the single top-k read is `pre.resonance()` shared
across the response. `Precomputed.k = 2·recallQueryK` tiers 0b/1/2/3 through it;
the last tier re-folds bytes.

## Tiers (degrading)

| Tier | Name                  | Gate                                                                                                                                                       | Action                                                                                                            |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 0    | Exact identity        | `pre.queryResolved` exists                                                                                                                                 | Reverse-recall (`reverseContext`) to best-resonating predecessor at `STEP`                                        |
| 0b   | RC8 argument binding  | One maximal `≥2W` edge-source constituent, no substantial `≥2W` form outside it                                                                            | `follow` its continuation; refuses if result is a subspan of the query                                            |
| 1    | Clean resonance       | `score ≥ identityBar(D,W,len)` per hit                                                                                                                     | `project` hit; restating hits (bytes or `canon`-equivalent) only via reverse-recall                               |
| 2    | Scaffolding-dominated | `score ≥ significanceBar(D)` and consensus-climb anchor clears `consensusFloor(N)` or `dominates(breadth,1) && peak>ln2`, and query is not all-scaffolding | `project` anchor at `CONCEPT`; refuses if continuation voices the anchor's displaced filler or is a query subspan |
| 3    | Last resort + bridge  | Query-relative fraction `max(0,cos−sig)·√(lenG/lenQ) ≥ reachThreshold(W)`                                                                                  | Best grounded `project` hit at `STEP`                                                                             |

W = `maxGroup` (river window); bars from `src/geometry.ts`.

## Echo — the refusing tail

If no tier grounded, the exact cosine of the top hit is re-folded (`gistOf` on
its bytes). It uses that exact value in the same chance-corrected fraction —
never the RaBitQ estimate. Below `reach` → silence; restating → silence;
otherwise the hit's own bytes are returned as an ungrounded echo.

## Provenance

Grounded answers carry `recall`; the echo carries `recall-echo` (`echoed: true`
on `RecallResult`); it declares `used: ∅`. Consumers distinguish a continuation
through learned edges from a near-identity echo.

## Substitution bridge — refusal-path only (`src/mind/bridge.ts`)

Runs only after every gist tier failed, reusing the same top-k proposals (the
bridge's cap is `2·recallQueryK`; every proposal is byte-verified). A candidate
context is byte-aligned around the rarest stored W-windows. A mismatch becomes a
corroborated substitution only when its query span is corpus-attested (every
W-window stored, one reused ≥2 containers), its geometry clears
`conceptThreshold(D)` or its halo clears `significanceBar(D)`, its frame is
unanimous, and the raw gap is length-balanced. Coverage must dominate the query
and no dismissed gap may hide known content (`dismissedKnownContent` gate). Cost
is `CONCEPT` per substitution plus `STEP`; accounted spans include matched and
substituted ranges (so a 28/29-byte paraphrase is not charged `PASS` per
substituted byte — the double-charge that let `cast` outbid the bridge).
Zero-substitution identity bridges carry `complete: true` (the whole read-out);
substituted bridges do not.

Scaffolding-only queries abstain: when every window that could anchor is
saturated (corpus-global scaffolding, `allWindowsAreScaffolding`), the bridge
returns nothing — one substituted word cannot carry the load.

## Cost

Tiers 0/1/3 price `STEP` (one hop); tier 2 and the bridge price `CONCEPT` per
substitution/scaffold step. Mechanism `floor` is `STEP`; weight is
`moves + PASS·unaccounted`.

## Pins

- `test/03-recall.test.mjs` — exact identity and reverse-recall
- `test/16-bridge.test.mjs` — corroborated substitutions
- `test/73-scaffolding-only-bridge-abstains.test.mjs` — scaffolding-only queries
  stay silent
