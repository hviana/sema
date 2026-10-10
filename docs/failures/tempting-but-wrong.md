# Tempting but Wrong — 14 Traps

Fourteen shortcuts that look plausible and break an invariant. Each states what
not to do, why it fails, and what to do instead. **Some things are universal:
discovering bugs:**

- A bug must be pinned by a test that shows it.
- This test cannot be accidental; it is subtle and requires deep analysis. That
  is, it is not the test itself that reveals the bug, but rather the class of
  errors to which the bug belongs.
- This is difficult to do because the suite's small synthetic corpus easily
  leads to accidental bugs, and real-world corpus must not be compromised.
- Something that happens due to deduplication, a tie-breaking rule, etc., isn't
  a bug—and that’s a subtle point.
- A change in behavior is not a behavioral regression: A change that shifts a
  response from correct to incorrect is not necessarily a regression. Sometimes,
  there may be many other responses that were incorrect but have become correct.
  Overall, there must be a net gain. Budget adjustments or computational
  optimizations often require this.
- Often, a pathological search is not necessarily resolved by a constant
  derivative. A constant derivative is typically a type of short-circuit
  breaker; it can cause truncation and is not necessarily a budget-related
  measure. Therefore, it must be used wisely.

Each trap below was tried, looked like an improvement, and was measured wrong.
The laws themselves live in `docs/architecture/`; this file keeps only the
shortcuts that pass review and fail the evidence.

### 1. Telling the fold where the boundaries are

- **Tempting:** cut a conversation at its turns before folding, or stamp a
  deposit as "the next turn" so its prefix is reused.
- **Refuted:** a cut the question cannot reproduce from its own bytes splits one
  identity in two. Alignment went quadratic (5.2M cells against 0), and turns
  asked verbatim stopped resolving. Reusing a `prev` that was not a
  byte-identical prefix gave a wrong tree on 336 of 400 streams.
- **Instead:** the content decides every cut, and reuse is keyed by the prefix
  bytes (`fold-contract.md`; `test/59`, `test/63`, `test/152`).

### 2. Asking the vector index whether two branches are the same

- **Tempting:** at intern, probe the ANN index for a near-duplicate to merge.
- **Refuted:** it was the dominant training cost, and the 1-bit code ranked a
  byte-distinct branch as nearest, so two different subtrees collapsed onto one
  id.
- **Instead:** exact dedup, then same-bytes reuse, then a near merge against the
  write buffer only, decided by bytes (`store.md`; `test/02`).

### 3. Reading one population's cut with another population's measure

- **Tempting:** "common" is common, so corpus reach can decide CAST's frame,
  weight can stand for distinct structures, and a window's containers can stand
  for the contexts it reaches.
- **Refuted:**
  - corpus reach for the cohort's frame failed the reorder probe (`test/17`);
  - counting weight instead of distinct structures gave 29/42 against 6/42;
  - container fan-out read as a hub called `fran` saturated, though it sits in 4
    containers and reaches only 2 contexts (`test/49`).
- **Instead:** name the population; three measures, never substituted
  (`commonality.md`, `saturation.md`).

### 4. Inventing a bar, or reusing one for a different quantity

- **Tempting:** a new number fitted to the case at hand, or a derived bar reused
  elsewhere because it is derived.
- **Refuted:** `consensusFloor` is priced for pooled votes, and gating a single
  fact's support with it refused clear corroboration at N≈325K. A fixed identity
  cosine tolerates four foreign windows on a long span.
- **Instead:** a bar is never a new number. Derive it from `D`, `W` and `N` for
  the quantity it gates (`thresholds.md`; `test/40`, `test/64`).

### 5. Stopping a junction walk early

- **Tempting:** stop when one side's upward cone is exhausted, or borrow
  `edgeAncestors`' lateral-cone limit.
- **Refuted:** a junction can be reachable from one side only (`cold or hot`
  from `cold`, while the cone of `hot` is empty), and the lateral limit
  discarded half of the successful junctions.
- **Instead:** per-node hub guards, plus the shared `bound·W` net
  (`saturation.md`; `test/16`, `test/34`).

### 6. Reading company by token

- **Tempting:** a halo of whole-partner signatures; or a sketch of depth 1; or
  one that stops at the first unit seen twice; or one that includes byte atoms.
- **Refuted:** in turn, these gave synonyms at 0.146 against a 0.516 bar; no
  signal (0.0319 against a 0.0416 control); pairs that never met (0.0165 against
  0.0375); and CAST's analogy gate silenced (0.3636 to 0.2004).
- **Instead:** a bottom-k sketch of constituents at every depth, keyed by
  identity, with hubs and atoms excluded (`halo-sketch.md`;
  `test/76-type-level-company`).

### 7. Letting a fragment speak

- **Tempting:** a recognised form with continuations is evidence wherever it
  appears.
- **Refuted:** a fragment inherits the edges of every whole it sits in.
  Witnessing `born?` named nine strangers' birthplaces, the fragment `director`
  cancelled the argument `Man at Bath`, and `ong)?` voiced a stranger's
  birthplace.
- **Instead:** only deposited contexts establish anything, and a fragment that
  answers other questions leads somewhere only when the question names one of
  its continuations (`evidence.md`; `test/154`).

### 8. Making scaffolding free

- **Tempting:** scaffolding is nobody's evidence, so charge nothing for it in
  the market.
- **Refuted:** dialogue answers changed (`How are you today?`), because for a
  question made only of scaffolding, covering those bytes is the evidence.
- **Instead:** scaffolding is nobody's debt in the derivation, while the price
  still charges every unexplained byte (`evidence.md`).

### 9. Giving a new reading its own analysis

- **Tempting:** a new tier climbs, resonates or aligns for itself.
- **Refuted:** the co-instance tier's private climb added 16% climb visits and
  named nothing. Reading the shared climb's points named the same things for
  free.
- **Instead:** read `Precomputed`, and add an analysis there only if none exists
  (`memoization.md`).

### 10. Putting a consumer's gate in the shared matcher

- **Tempting:** `frameSlots` refuses what `reference` would refuse anyway.
- **Refuted:** the shared reading became shaped like `reference` and hid three
  of four real pairings from every other consumer.
- **Instead:** the matcher reports, the consumer judges (`match-project.md`;
  `test/47`).

### 11. Dropping weak evidence, or crediting it as strong

- **Tempting:** remove regions shorter than one window from the climb, or count
  them as exact because their bytes resolve.
- **Refuted:** dropping them took the suite from 441 to 406. Crediting them as
  exact let the 3-byte `of` lift a junk root past `consensusFloor`.
- **Instead:** they vote on their gist and pay the margin that approximate
  evidence pays, scaled by how much of them is not stored (`attention.ts`).

### 12. Trying the exact supply first, then the approximate

- **Tempting:** a chain of `exact ?? approximate` supplies.
- **Refuted:** the approximate tier then overrides an ambiguity the exact one
  found. For prefix completion, two forms opened by the index must refuse,
  whatever resonance ranks first.
- **Instead:** one union, decided once by the guards (`prefix-completion.md`;
  `test/72`).

### 13. Capping a combinatorial explosion instead of budgeting it

- **Tempting:** answer an explosion with a derived limit: a cap on the pairs a
  sweep enumerates, the continuations a hop offers, the candidates a scan
  probes.
- **Refuted:** a cap stops the computation silently. Reach is lost, the
  capability that depended on it goes with it, and no test fails, because the
  tests were written against the capped behaviour. Capping truncates; removing
  the cap lets the cost run; each failure hides the other.
- **Instead:** budget it. Charge the work in the one currency, make it visible
  in the meter and the rationale, and let the search decide whether it is worth
  paying (`cost-model.md`). Where the work is mechanical (enumeration, scans,
  sweeps), the answer is an algorithm whose cost is structural in its input, not
  a smaller cap. The ideal is one closure law from which the reach of a gap, the
  offer of a hop, the depth of a join and the scope of a substitution follow as
  consequences. Where the repository stands against that ideal is stated in
  `closure.md`, and nowhere else. A change must state which consequence it is,
  and show that it follows from the law.

### 14. Taking a search that found nothing as a refutation

- **Tempting:** when a question's instances agree on how its two things meet,
  and the derivations replayed from its own things meet nowhere, refuse every
  answer: "the instances say no entity is both".
- **Refuted:** an empty meet is the absence of a proof. The shared grandfather
  can lie on a route the instances did not show (the mother's father, not the
  father's), the meeting fact can lie past the read bound, and a premise can be
  missing. The refusal silenced all of these as if refuted. It turned 12 wrong
  answers per world into silence, but never on evidence of incompatibility
  (`test/159` 159.4).
- **Instead:** conclude only what the evidence proves. A meet is an answer; no
  meet is no conclusion, and the market decides as it would without it. A
  refusal needs evidence that the answer is incompatible, which a bounded search
  over stored facts cannot give.
