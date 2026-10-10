# Halo — Distributional Memory

> **Law:** a node's halo is the superposition of the company it was deposited
> in. It measures nearness of _use_, independently of the gist, which measures
> nearness of _form_. It is a statistic over the record: it may propose, never
> decide (`exact-vs-approximate.md`).

The gist puts `colour` near `colours`. Only the halo can put `colour` near
`hue`, two words whose bytes have nothing in common.

## How a halo is poured

Each deposited fact `(context → continuation)` makes two pours (`ingestPair`):

- every part of the context newly seen by this deposit receives the
  continuation's profile, bound to seat 1, _what it led to_;
- the continuation receives each such part's profile, bound to seat 0, _what led
  to it_.

Pours add. Each profile is normalized, so one episode pours one unit of mass
(`haloMass` counts episodes). Addition forgets order and keeps proportion, which
is why the halo is a statistic rather than a record.

## Company by type, not by token — the profile

A partner's own signature (`companySignature`, a random unit vector seeded by
its node id) records a token: "occurred near node #4711992". Whole deposits
almost never recur (whole-span dedup on the trained store is 0.98×), so by
tokens alone genuine synonyms are quasi-orthogonal: the best distributional
sibling of `Eiffel Tower` scores 0.146 against a bar of 0.516.

So `companyProfile` superposes the partner's own signature with the signatures
of its **bottom-k constituent sketch**: the `k = profileCapacity(D) = ⌊√D⌋`
minimal units of its subtree with the smallest identity-keyed priority.

- **The sketch descends to every depth.** Content-defined cuts depend on the
  surrounding bytes, so a shared unit such as `Paris` is often not a top-level
  chunk of either partner. A depth-1 read measured 0.0319 against 0.0416 for an
  unrelated control: no signal.
- **The sketch is independent of arrival order.** A stop rule like "descend
  until a unit is attested twice" depends on which partner was trained first,
  and its pairs never met (0.0165 against 0.0375). The priority is a hash of the
  unit's id, so a unit shared by two partners is kept by both or by neither.
- **Hubs are excluded, but still descended into.** A unit with more than `√N`
  parents (`is`, `the`) would put one shared term into every profile, all halos
  would correlate, and the concept bar's null model would collapse. Byte atoms
  are skipped for the same reason. So is a unit that dominates the partner,
  because that unit is the partner itself.
- **The sketch is composable and durable.** Bottom-k of a union is bottom-k of
  the children's sketches. Sketches are stored (`sketchGet`/`sketchPut`), so a
  partner met again costs `O(k)`.

Every term is a seeded function of a node identity, never of a gist, so
resemblance of spelling cannot leak into resemblance of use. Two partners
sharing `j` of `k` discriminating constituents meet at `j/(1+k)`. A profile is
fixed given the corpus seen so far. As `N` grows, a term can move only from
contributing to excluded-as-hub.

`k = √D` is a correctness limit, not a budget. Beyond it, one more term
contributes less than `1/√D`, below the estimator's noise, and dilutes every
accepted term.

## Storage — exact in session, quantized at rest

| Layer     | Form                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| session   | `Float32Array` accumulator, exact and additive (`pourHalo`)                                                             |
| durable   | 2-bit Lloyd–Max quantizer: decision at ±0.9816σ, levels ±0.4528σ / ±1.5104σ, σ = norm/√D. Correlation ≥ 0.88 with exact |
| ANN index | 1-bit RaBitQ, answering only "which halos are near this one?"                                                           |

A halo re-enters the index when its mass is at most 4 or a power of two, so
index writes are `O(log mass)`.

Halo comparisons do not depend on the configured seed, because signatures are
keyed on node ids. Gist comparisons do: a Mind built with a seed other than its
store's makes every gist comparison meaningless, while its halo comparisons
remain valid.

## Where halos are read

| Use                                                                                            | Gate               |
| ---------------------------------------------------------------------------------------------- | ------------------ |
| admission: a form _leads somewhere_ if `hasNext \|\| hasHalo` (`store.md`)                     | existence probe    |
| `locate`'s second tier (halo role), `alignGraded`'s halo-matched sites                         | best halo mate     |
| synonym tiers: junction bridge, `crossRegionVotes`, substitution bridge                        | `conceptThreshold` |
| concept hops in `cover`: an edge-less form borrows a halo sibling's continuation, at `CONCEPT` | `conceptThreshold` |
| CAST's analogy strength                                                                        | `significanceBar`  |
| `chooseNext`: halo mass breaks ties after `prevCount`                                          | ordering only      |
| articulation: an answer form is voiced in the asker's halo synonym, never the whole answer     | `conceptThreshold` |

The bars are derived in `geometry.ts` (`thresholds.md`).

`haloMass` and `hasHalo` are point probes. `halo(id)` is the bounded vector
read, and `resonateHalo` is the capped ANN query.

## Pins

- `test/08` — halo persistence, the 2-bit round trip, the `haloMass`/`hasHalo`
  contract, and the index surviving a reopen.
- `test/76-type-level-company` — company shared by type: synonyms meet through
  their constituents.
- `test/29` C1 — CAST's halo-tier analogy evidence. A profile polluted by byte
  atoms silenced it.
- `test/35-ivf` — the RaBitQ-IVF contract under the halo index.
