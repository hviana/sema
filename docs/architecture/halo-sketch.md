# Halo & Sketch — Distributional Memory

A node's **halo** is its distributional signature: the superposition of
identity-bound company signatures poured from every episode it participated in.
Its **gist** is the VSA fold of its own bytes — content, not company.

## Two vectors per node, two indexes

| Vector | Encodes                       | Index         | Query          |
| ------ | ----------------------------- | ------------- | -------------- |
| gist   | what the node _is made of_    | content index | `resonate`     |
| halo   | what _company_ the node keeps | halo index    | `resonateHalo` |

Both indexes are RaBitQ-IVF (`src/rabitq-ivf/`) — 1-bit ANN over the same
vectors; scores are estimates, never identity. Halos are also persisted durably
(see below).

## Quantization — 2-bit on disk, float in session

A halo is a superposition of quasi-orthogonal signatures, so coordinates are
Gaussian. Storage exploits this:

- **In-session accumulator** (`_haloExact` in `src/store.ts`): `Float32Array` —
  exact, additive, incremented by `pourHalo`.
- **Durable row** (`_dbUpsertHalo`): 2-bit Lloyd–Max quantizer — decision at
  ±0.9816σ, levels at ±0.4528σ / ±1.5104σ, σ derived from the stored norm
  (`norm/√D`). Header is the 4-byte norm; body is 2 bits/coordinate. Keeps ≥0.88
  correlation with the exact vector.
- **ANN index**: 1-bit RaBitQ, irreversible — answers only "which halos are near
  this query?"

Re-indexing is geometric: a halo re-enters the ANN when mass is small or crosses
a power of two (`geometricMass`), so index writes are O(log mass).

## Bottom-k sketch & company profile

A whole-partner signature alone records tokens, not types — halos of genuine
synonyms would be quasi-orthogonal. `companyProfile` (`src/mind/learning.ts`)
superposes:

1. the partner's own identity signature, plus
2. the bottom-k **constituent sketch** — the
   `k = profileCapacity(D) = floor(√D)` minimal units of its subtree with
   smallest `unitPriority`, deduped.

The sketch is composable (bottom-k of a union = bottom-k of children's
sketches), durable derived state via `sketchGet`/`sketchPut`, and bounded: at
most `k` constituents are classified, each by one `LIMIT`ed parent read
(`hubBound`). Beyond `√D` terms a single constituent contributes less than
`1/√D` — below RaBitQ noise — and extra terms shrink every accepted one; the cap
is a correctness limit.

## Gist vectors

Folded by the river (`src/geometry.ts`): leaves are alphabet vectors, groups
bind by two-ended seats, intermediate gists stay unnormalized (magnitude ∝
√len), only the root is normalized. Gist resonance reads byte-proportional
overlap; halo resonance reads distributional overlap — the two are independent.

## Thresholds & gating

All bars are derived in `src/geometry.ts`; no tunable constant:

| Symbol             | Formula        | Use                                                                                               |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------- |
| `estimatorNoise`   | `1/√D`         | 1σ RaBitQ noise; contrastive margin must clear it                                                 |
| `significanceBar`  | `3/√D`         | whole-query relatedness — 3σ above chance; gates consensus climb and `analogyStrength`            |
| `conceptThreshold` | `0.5 + 0.5/√D` | halo concept sharing — structural midpoint + ½σ; gates `haloSiblings`, concept hops, articulation |

The significance bar gates the whole query; `conceptThreshold` gates per-pair
halo cosine.

## Probes: `haloMass` and `hasHalo`

- `haloMass(id)` — count of poured episodes; evidence weight, tie-breaker in
  `chooseAmong`.
- `hasHalo(id)` — existence probe (indexed point check, no vector decode);
  mirrors `halo(id) !== null`. One tier of the `leadsSomewhere` admission
  predicate (with `hasNext`/`hasParents`).

Both are `meter`-counted probes, not full decodes — `halo(id)` is the bounded
vector read; `resonateHalo` is the IVF ANN query.

## Relation to invariants

- **Derived thresholds** — all bars above live in `geometry.ts`.
- **Exact decides / approximate proposes** — halo scores rank and gate; identity
  is content-addressed. The graded ladder is exact → halo → gist
  (`mind/match.ts`).
- **Bounded reads** — `hasHalo`/`haloMass` are point probes; `resonateHalo` is
  capped ANN; constituent classification uses `LIMIT hubBound+1` reads. No
  per-query scan grows with corpus.

## Pins

- `test/08 storage halo` — halo persistence, 2-bit round-trip,
  `haloMass`/`hasHalo` contract, index survival across reopen.
- `test/35 ivf` — RaBitQ-IVF contract (recall vs brute force, sublinear
  scaling); covers the halo index's own layer.
