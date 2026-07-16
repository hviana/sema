# How Sema Works

**A complete account of the theory and the algorithm — from the mathematical
foundations to the full inference pipeline, in plain language.**

This document explains _concepts_ and _algorithms_. It deliberately contains no
repository-level detail (file layout, module names, build and test concerns):
for that, see [AGENTS.md](AGENTS.md), the development manual. Everything here is
stated so that a careful reader with no background in machine learning — human
or machine — can follow it from first principles.

---

## Table of contents

- **Part I — Foundations**
  - [1. What kind of AI is this?](#1-what-kind-of-ai-is-this)
  - [2. Vector Symbolic Architectures](#2-vector-symbolic-architectures)
  - [3. Content-addressable memory and the Merkle DAG](#3-content-addressable-memory-and-the-merkle-dag)
  - [4. Distributional structure](#4-distributional-structure)
  - [5. Automated deduction: the lightest derivation](#5-automated-deduction-the-lightest-derivation)
  - [6. Approximate nearest-neighbour search](#6-approximate-nearest-neighbour-search)
- **Part II — The big picture**
  - [7. How the five foundations connect](#7-how-the-five-foundations-connect)
  - [8. Derived thresholds: the geometry of every decision](#8-derived-thresholds-the-geometry-of-every-decision)
  - [9. The concept inventory](#9-the-concept-inventory)
- **Part III — The ingestion pipeline**
  - [10. Perception: from bytes to a tree](#10-perception-from-bytes-to-a-tree)
  - [11. Deposition: interning the tree into the graph](#11-deposition-interning-the-tree-into-the-graph)
  - [12. Learning relations: edges and halos](#12-learning-relations-edges-and-halos)
  - [13. Ingestion, end to end](#13-ingestion-end-to-end)
- **Part IV — The inference pipeline**
  - [14. The shape of an answer](#14-the-shape-of-an-answer)
  - [15. Recognition: decomposing the query](#15-recognition-decomposing-the-query)
  - [16. Computation: extensions and the ALU](#16-computation-extensions-and-the-alu)
  - [17. The consensus climb: points of attention](#17-the-consensus-climb-points-of-attention)
  - [18. Grounding I — counterfactual transfer (CAST)](#18-grounding-i--counterfactual-transfer-cast)
  - [19. Grounding II — cover: the graph search](#19-grounding-ii--cover-the-graph-search)
  - [20. Grounding III — extraction by skill](#20-grounding-iii--extraction-by-skill)
  - [21. Grounding IV — recall by resonance](#21-grounding-iv--recall-by-resonance)
  - [22. Reasoning: the multi-hop chain](#22-reasoning-the-multi-hop-chain)
  - [23. Fusion: multi-topic answers](#23-fusion-multi-topic-answers)
  - [24. Articulation: answering in the asker's words](#24-articulation-answering-in-the-askers-words)
  - [25. Disambiguation: choosing among alternatives](#25-disambiguation-choosing-among-alternatives)
  - [26. Auditability: provenance and the rationale](#26-auditability-provenance-and-the-rationale)
- **Part V — The whole algorithm in pseudocode**
  - [27. End-to-end pseudocode](#27-end-to-end-pseudocode)
- **Part VI — Reference**
  - [28. Glossary](#28-glossary)
  - [29. Complexity summary](#29-complexity-summary)
  - [30. Bibliography](#30-bibliography)

---

---

# Part I — Foundations

Sema rests on five independent bodies of theory, each decades old and each well
established in the academic literature. None of them is a neural network, and
none of them requires training in the gradient-descent sense. Part I presents
each one on its own terms; Part II shows how they interlock.

---

## 1. What kind of AI is this?

### 1.1 The classification problem

Sema is not a large language model: it has no learned weight matrices, no
gradient descent, no probabilistic sampling. But calling it simply "symbolic AI"
is also inaccurate — classical symbolic AI (logic programming, production
systems, description logics) operates on discrete tokens with exact matching and
has no notion of _similarity_, _generalization by proximity_, or _graceful
degradation_, all of which Sema exhibits. And industry labels such as "RAG +
Reasoner" describe _pipelines of separate components_ (a retriever feeding a
generator), which misrepresents Sema's single-mechanism design and has no
standing in the academic literature as a category of system.

The academically precise classification is:

> **Sema is a non-parametric, instance-based reasoning system: a Vector Symbolic
> Architecture (VSA) coupled to a content-addressable memory, with inference
> performed by weighted automated deduction.**

Each term in that sentence is a recognised concept with its own literature:

| Term                              | Meaning                                                                                                                                                                                                                                   | Field                                                                                          |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| **Non-parametric**                | The system has no fixed-size parameter vector that training adjusts. Capacity grows with the data itself; the stored instances _are_ the model.                                                                                           | Statistics; machine learning                                                                   |
| **Instance-based** (memory-based) | Learning is storing experiences; generalization happens at _query time_ by comparing the query to stored instances, not at training time by fitting a function.                                                                           | Machine learning; cognitive science exemplar theory                                            |
| **Vector Symbolic Architecture**  | Structured knowledge (sequences, trees, role–filler bindings) is encoded into fixed-width high-dimensional vectors using algebraic operations (binding, superposition), so that _similarity of structure_ becomes _proximity of vectors_. | Connectionist/cognitive modelling (Plate 1995; Kanerva 2009; Gayler 2003)                      |
| **Content-addressable memory**    | Items are retrieved by _what they are_ (their content or something similar to it), not by _where they are_ (an address or key assigned externally).                                                                                       | Computer architecture and associative-memory theory                                            |
| **Weighted automated deduction**  | Answers are _derived_ by applying inference rules with costs, and the system returns the derivation of minimal total cost — a strict generalization of shortest-path search.                                                              | Automated reasoning; parsing theory (Knuth 1977; Goodman 1999; Felzenszwalb & McAllester 2007) |

### 1.2 What this system is _not_

To sharpen the category, the contrasts matter as much as the definition:

- **Not a parametric statistical model.** An LLM compresses its corpus into a
  fixed number of floating-point weights and answers by sampling from a learned
  conditional distribution. Sema stores its corpus as an explicit, losslessly
  reconstructible graph and answers by _deduction over that graph_. There is no
  distribution to sample; identical inputs always produce identical outputs.

- **Not classical (crisp) symbolic AI.** In a Prolog-style system, `mona_lisa`
  and `monalisa` are unrelated atoms; nothing matches unless it unifies exactly.
  In Sema, every stored structure also carries a high-dimensional vector (its
  _gist_), and geometric proximity of gists gives the system the soft matching,
  analogy, and noise tolerance that crisp symbols lack — while the underlying
  identities remain exact and content-addressed.

- **Not a retrieval pipeline with a bolted-on reasoner.** In a
  retrieval-augmented generation system, retrieval and generation are two
  different mechanisms with an interface between them. In Sema there is one
  mechanism: a single lightest-derivation search whose _axioms_ come from
  recognition and resonance (the "retrieval") and whose _rules_ are the learned
  edges and compositions (the "reasoning"). Retrieval and inference are two
  descriptions of one search.

- **Not neuro-symbolic in the usual sense.** The term "neuro-symbolic" usually
  denotes hybrids of neural networks with symbolic components. Sema contains no
  neural network. Its vectors are constructed by deterministic algebra (random
  projections, permutations, sums), not learned by backpropagation. The correct
  lineage for its vector side is _hyperdimensional computing / VSA_, which grew
  out of connectionism but does not require learning.

### 1.3 Where it sits in the literature

Systems close in spirit, each sharing one facet:

- **Holographic Reduced Representations** (Plate 1995) and **hyperdimensional
  computing** (Kanerva 2009): the representational substrate. Sema shares the
  algebra (superposition + binding); it differs by anchoring every vector to an
  exact, reconstructible symbolic structure in a Merkle DAG.
- **Semiring-weighted deduction** (Goodman 1999) and the **Generalized A\***
  architecture (Felzenszwalb & McAllester 2007): the inference engine. Sema
  shares the formalism exactly; its contribution is _what_ the items and rules
  are — spans of a query, nodes of a learned graph, learned continuations.
- **Case-based reasoning** (Kolodner 1992): solve new problems by retrieving and
  adapting stored cases. Sema's counterfactual-transfer mechanism (Section 18)
  is a formalized, byte-level version of case adaptation.

The short label used in the rest of this document: **a vector-symbolic,
memory-based reasoning system**.

---

## 2. Vector Symbolic Architectures

### 2.1 The problem VSAs solve

Fixed-width vectors are attractive as a representation: comparing two of them
(one dot product) is trivially fast, and "similar" has a natural meaning (small
angle between them). But a bag of numbers has no obvious way to represent
_structure_ — the difference between "the dog bit the man" and "the man bit the
dog" is not a difference in _which_ words occur but in _how they are arranged_.

A **Vector Symbolic Architecture** (VSA; also _hyperdimensional computing_) is
an algebra over high-dimensional vectors that solves exactly this problem. It
provides:

1. **Atoms.** Elementary symbols are assigned (usually random) high-dimensional
   vectors.
2. **Superposition** (bundling): a way to combine several vectors into one
   vector that is _similar to each of its inputs_ — typically element-wise
   addition followed by normalization. Superposition represents _sets_: the
   result "contains" its inputs in the sense that each input can be detected in
   it by a similarity test.
3. **Binding**: a way to combine vectors into one that is _dissimilar to its
   inputs_ — it represents an _association_ (a role filled by a filler, a
   position occupied by an item) rather than a collection. Crucially, binding is
   invertible (or at least, structurally distinguishable), so bound structure
   can be probed.
4. **A similarity measure**, usually cosine similarity, under which all of the
   above has meaning.

Different VSA families use different binding operators: circular convolution in
Plate's Holographic Reduced Representations (1995), element-wise XOR in
Kanerva's binary spatter codes, element-wise multiplication in Gayler's
Multiply–Add–Permute (2003). Sema uses **permutation binding**: applying a fixed
random permutation of the vector's coordinates.

### 2.2 Why high dimensions work: quasi-orthogonality

The entire edifice rests on a fact of high-dimensional geometry sometimes called
_concentration of measure_: **two independently chosen random unit vectors in D
dimensions are almost exactly orthogonal**. Their expected cosine similarity is
0, with standard deviation approximately 1/√D. At D = 1024, that standard
deviation is about 0.031 — so unrelated random vectors reliably score within a
few hundredths of zero, while a vector scores 1.0 against itself. There is an
enormous, dependable gap between "same" and "unrelated", and an entire usable
band in between for "partially similar".

This has three consequences that Sema uses constantly:

- **Capacity.** A superposition of a handful of random vectors is still clearly
  similar to each of them and clearly dissimilar to everything else, because the
  cross-talk between the components is O(1/√D) noise.
- **Statistical decision thresholds.** "Is this similarity real or chance?" has
  a principled answer: a cosine of k/√D is k standard deviations above what
  chance produces. Sema's significance bar is exactly 3/√D — three sigma
  (Section 8).
- **Robustness.** Corrupting a few coordinates of a high-dimensional vector
  barely moves it; every comparison degrades gracefully rather than breaking.

### 2.3 Permutation binding and why order becomes visible

A permutation π rearranges a vector's coordinates: the value at position π(i)
moves to position i. Two properties make permutations excellent binding
operators:

- **They preserve lengths and angles** (they are orthogonal linear maps), so
  permuting a vector produces an equally well-behaved vector.
- **A random permutation decorrelates.** For a random vector v, the permuted
  vector πv is (with overwhelming probability) nearly orthogonal to v — the
  permutation "hides" the vector's identity behind the role.

Sema keeps a fixed **keyring** of independent random permutations π₀, π₁, π₂, …
— one per _seat_ (ordinal position in a group). To encode an ordered group of
children (c₀, c₁, …, cₖ), each child's vector is bound to its seat and the
results are superposed:

```
encode(c₀, c₁, …, cₖ)  =  π₀·v(c₀) + π₁·v(c₁) + … + πₖ·v(cₖ)
```

Because the seats are _different_ permutations, "A in seat 0, B in seat 1" and
"B in seat 0, A in seat 1" produce nearly orthogonal encodings — **order is part
of the representation**. And because independent permutations do not commute,
nesting the operation encodes _paths_: "the x that sits in seat 2 of the thing
in seat 1" has a distinct signature from "the x in seat 1 of the thing in seat
2". A whole tree can thus be folded, level by level, into one fixed-width vector
whose geometry reflects the tree's entire shape and content. Sema calls the
result of this fold the tree's **gist**.

Note that this encoding step is **not** followed by a normalize: unlike the
classical VSA recipe (which renormalizes after every superposition), Sema's fold
leaves every interior sum at its natural length and only ever normalizes the
_root_ of a fold — see §2.6, where this is the basis of the system's
angle-and-magnitude semantics.

The trade this makes is deliberate and important to understand: the fold is
**lossy** as a vector (a 1024-dimensional gist cannot losslessly hold a kilobyte
of text), but Sema never needs to _decode_ a gist — the exact content is always
recoverable from the symbolic side (the DAG, Section 3). Gists exist purely to
make _similarity of structured content computable in one dot product_. This
division of labour — vectors for geometry, the DAG for identity — is the single
most important design fact in Sema.

### 2.4 The alphabet: atoms with graded similarity

The atoms of Sema's VSA are the 256 possible byte values. Each byte value is
assigned a fixed unit vector at construction time, deterministically from a
seed. But the assignment is not uniformly random: the 256 vectors are built by
**recursive refinement** — 16 coarse random directions are each refined into 4
intermediate directions, each of which is refined into 4 final directions (16 →
64 → 256). Refinement means: keep a weighted portion of the parent direction and
mix in fresh randomness.

The result is an alphabet with _graded similarity_: byte values that share a
refinement ancestor have moderately similar vectors, while distant byte values
are quasi-orthogonal. This gives perception a mild, structured tolerance at the
very lowest level, while preserving the global quasi-orthogonality the algebra
needs. (The mixing ratio is the alphabet's _roughness_; the construction is
deterministic given the seed, which is what makes all of Sema reproducible.)

### 2.5 What the VSA contributes to Sema, in one sentence

> The VSA turns "how similar are these two _structures_?" into "what is the
> cosine of these two vectors?" — a question answerable in microseconds and
> indexable at scale — without ever being trusted to _store_ the structures
> themselves.

Sema's word for cosine similarity between gists is **resonance**, and this
document uses both terms interchangeably.

### 2.6 Magnitude: the second axis of similarity

A fold whose interior sums are never renormalized (§2.3) carries more
information than its angle alone. Because the leaf vectors it superposes are
close to orthogonal, the length of an unnormalized interior gist grows with the
_amount_ of content folded into it: a span of `len` bytes has a gist whose norm
is approximately √len. Only the root of a completed fold is normalized to unit
length (so that content and halo indexes, which compare roots, still compare
directions on the unit sphere); every gist below the root retains this natural,
byte-proportional magnitude.

This turns the fold into what the codebase calls a **linear** fold: it is a
genuine linear operator (superposition of seat-bound leaf vectors, nothing
else), and a resonance score between two such unnormalized quantities reads as
**byte-proportional overlap**, not scale-free cosine. Concretely: the cosine
between two spans' gists is (shared content) / √(len₁ · len₂) — the geometric
mean of their lengths in the denominator, exactly as an inner product between
two sums of near-orthogonal unit vectors predicts. Reading a magnitude back out
of a stored gist is therefore reading a byte count: a node's gist norm (or,
equivalently, its stored content length) IS its size in the fold's own units.

This is Sema's **angle-and-magnitude** semantics: the ANGLE between two gists
carries the _fraction_ of content they share; the MAGNITUDE (recovered from the
stored span length) converts that fraction into an absolute count of shared
bytes. Every mechanism that must ask a scale-sensitive question — "does this
score mean the query is entirely explained, or merely brushed by a much larger
stored form?" — reads both axes explicitly rather than trusting the cosine
alone. Two examples used constantly in Part IV:

- The **identity bar** for a whole-span claim (§8.1) tightens as the span grows,
  because a fixed cosine tolerates a growing number of foreign bytes once the
  span is long — the magnitude correction keeps "near-identical" meaning the
  same absolute thing at every scale.
- **Recall's last-resort tier** (§21) and the **consensus climb's** per-region
  vote (§17.3) both convert a raw resonance score into a _query-relative
  fraction_ — how much of the smaller side the larger side's content actually
  accounts for — using exactly this norm-as-byte-count reading, rather than
  trusting the raw cosine, which conflates "small thing fully inside a big
  thing" with "big thing loosely touching a small one".

Nothing about content addressing or the DAG changes: identity is still decided
by exact, byte-verified lookup (§3.1), never by a magnitude reading. Magnitude
is strictly a refinement of the _geometric_ half of the system — it makes
resonance scores honest about scale, it does not replace the exact half.

---

## 3. Content-addressable memory and the Merkle DAG

### 3.1 Content addressing

In a conventional memory, an item lives at an _address_, and you must know the
address to retrieve the item. In a **content-addressable memory** (CAM), the
item's own content determines where it is: to ask "do I know this?" you present
the content itself, and the memory answers with the stored item (or its
identity) directly. Associative memories of this kind have been studied since
the earliest days of computer architecture.

Sema's long-term store is content-addressed in the strict sense: **a node's
identity is a pure function of its content**. Storing the same content twice
yields the same node, always. This gives three properties for free:

- **Idempotent learning.** Re-ingesting a document changes nothing; there is no
  duplicate to create.
- **Intrinsic deduplication.** Storage grows with _distinct_ content, not with
  volume. A phrase seen a million times occupies one node.
- **Exact identity tests.** "Is this span something I have seen?" is a lookup,
  not a similarity estimate. Sema leans on this constantly: soft (vector)
  evidence _suggests_, but identity decisions are always made by
  content-addressed lookup, never by a similarity score crossing 1.0.

### 3.2 The Merkle DAG

A **Merkle structure** (Merkle 1987) is one in which a composite object's
identifier is derived from the identifiers of its parts. If two composites have
the same parts in the same arrangement, they _are_ the same object. Applied to
trees this is also known in programming-language circles as **hash-consing**:
construct each node "modulo equality", so structurally equal subtrees are
physically shared.

Sema's memory is a Merkle **DAG** (directed acyclic graph) of nodes:

- A **leaf** node is a span of raw bytes.
- A **branch** node is an ordered list of child node identities.
- A node's identity is determined by exactly that content (bytes, or the ordered
  child list). Equal content ⇒ same node.

Because identical subtrees collapse into one shared node, the "tree" of any
single perceived input becomes, in storage, a subgraph woven into every other
input that shares material with it. A sentence deposited yesterday and a
paragraph deposited today that contains that sentence _share the sentence's
node_; the paragraph's branch simply points at it. Three consequences:

1. **Every span ever perceived is individually addressable.** Not just whole
   documents: every intermediate grouping the perception process produced is a
   node with an identity, and can be the target of an association or a
   similarity probe.
2. **The graph can be climbed.** From any node one can ask "which larger
   structures contain me?" (its _parents_) — the reverse of the child lists.
   Recognising a fragment of an experience thus gives a path _upward_ to the
   whole experiences that contain it. This upward climb is the backbone of
   Sema's attention mechanism (Section 17).
3. **Reconstruction is exact.** Concatenating a node's leaves, left to right,
   reproduces the original bytes losslessly. The memory is not an approximation
   of the corpus; it _is_ the corpus, shared and structured.

### 3.3 The marriage of CAM and VSA

Each node carries both halves of Sema's dual representation:

| Facet        | Representation                                     | Answers                                                                   |
| :----------- | :------------------------------------------------- | :------------------------------------------------------------------------ |
| **Identity** | content-addressed node in the Merkle DAG           | "Is this exactly something I know? What contains it? What are its parts?" |
| **Geometry** | the gist vector (the VSA fold of the same content) | "What does this _resemble_? How strongly?"                                |

The store maintains a vector index over gists (Section 6) so that "find the
stored nodes most similar to this vector" is fast. The two facets discipline
each other: geometric search proposes candidates cheaply; content-addressed
structure verifies and grounds them exactly. Nothing in Sema ever acts on a
similarity score alone when an exact structural check is available — a rule
stated once here and honoured throughout the pipeline.

One refinement deserves mention because it is conceptually load-bearing:
**near-deduplication is byte-verified**. When a freshly perceived experience is
geometrically almost identical to one just stored (cosine above the _merge
threshold_, Section 8), Sema considers treating them as the same node — but
geometric closeness alone is scale-blind, so the decision is made by the bytes:
the two contents must be identical except for **one local span no wider than the
perception window**. Geometric evidence proposes; bytes dispose.

---

## 4. Distributional structure

### 4.1 The distributional hypothesis

The **distributional hypothesis** (Harris 1954) — often summarized as "you shall
know a word by the company it keeps" — holds that linguistic items with similar
meanings occur in similar contexts — that _meaning_, to a useful approximation,
is _distribution of use_. It is the theoretical foundation of every modern
word-embedding method, but the hypothesis itself is prior to and independent of
neural networks: it is a claim about language, testable by counting.

Sema implements the distributional hypothesis directly and transparently.
Alongside its gist (which encodes _what a node is made of_), a node that takes
part in learned associations accumulates a second vector: its **halo** — a
superposition of **company signatures** of the _partners it appeared with_ (what
preceded it, what followed it, bound to a role seat so that "appears as context"
and "appears as answer" are distinguishable). The halo encodes _the company the
node keeps_.

A company signature is a deterministic unit vector derived from the partner's
**node identity** (a seeded function of the node id), not from the partner's
gist. This decouples content similarity from company similarity: two halos
correlate exactly as much as their episode-participation histories overlap,
never because their partners merely contain similar bytes. Pouring raw partner
gists instead would let any byte-overlap between partners leak _content_
similarity into _distributional_ similarity, silently shifting the halo null
model that the concept threshold's derivation (unrelated halos ⇒ cosine 0 ±
1/√D) depends on.

Two nodes whose halos are similar have occurred in similar circumstances — they
are **distributional siblings**: synonyms, paraphrases, items of the same
category, two names for one thing. Note the complementarity:

| Vector   | Encodes                              | Two nodes are close when…                                                    |
| :------- | :----------------------------------- | :--------------------------------------------------------------------------- |
| **Gist** | the node's own content and structure | they are _made of_ similar material ("colour" ≈ "colours")                   |
| **Halo** | the node's contexts of use           | they are _used_ the same way ("colour" ≈ "hue"), even with zero shared bytes |

### 4.2 What halos do in the pipeline

Halos give Sema its capacity for synonymy and analogy without any trained
embedding model:

- **Concept hops.** A recognised form that has no learned continuation of its
  own can borrow the continuation of a distributional sibling — the system
  answers about "hue" using what it learned about "colour" (Section 19's concept
  rule).
- **Articulation.** An answer is re-voiced in the asker's own vocabulary by
  substituting answer forms with query forms that share a halo (Section 24).
- **Analogy strength.** Whether two entities are genuinely analogous — the gate
  on counterfactual comparison (Section 18) — is measured by halo similarity,
  directly or through shared siblings (a second-order distributional test).
- **Evidence weight.** How many episodes poured into a node's halo (its _mass_)
  is a direct count of distributional corroboration, consulted when choosing
  among competing continuations (Section 25).

Like gists, halos live in a vector index of their own so that "which nodes keep
this kind of company?" is a fast query.

### 4.3 A note on scientific hygiene

Because the halo is an explicit superposition of explicit episode signatures,
distributional claims in Sema are _auditable_: one can enumerate exactly which
learning events contributed to a halo and with what role. This distinguishes
Sema's distributional layer from learned embeddings, whose geometry is real but
whose provenance is diffused across an entire training run.

---

## 5. Automated deduction: the lightest derivation

### 5.1 Weighted deduction systems

**Automated deduction** is the field concerned with deriving conclusions from
premises by mechanical application of inference rules. A **weighted deduction
system** attaches a non-negative cost to each rule application:

```
premise₁ ∧ premise₂ ∧ … ∧ premiseₖ  --(cost c)-->  conclusion
```

A **derivation** of an item is a proof tree: leaves are axioms, and each
internal node is a rule application whose children derive its premises. The
derivation's cost is the sum of the costs of the rules it uses. The **lightest
derivation** of a goal item is the derivation of minimal total cost. This
formalism, developed principally in parsing theory (Goodman 1999 gave the
general semiring formulation), strictly generalizes shortest-path search: a
graph is the special case in which every rule has exactly one premise.

Rules with _multiple_ premises are what make the formalism powerful. A
two-premise rule is a **conjunction**: it composes two independently derived
results into one, paying a join cost. The search space is therefore an AND/OR
**hypergraph**, not a graph — and finding the lightest derivation is the
hypergraph analogue of finding a shortest path.

### 5.2 Knuth's algorithm and the A\* generalization

Knuth (1977) showed that Dijkstra's algorithm generalizes from graphs to
weighted deduction: process items in order of cost; when an item is removed from
the priority queue, its cost is final (given non-negative, monotone rules).
Felzenszwalb & McAllester (2007) then generalized A\* the same way — **A\*
Lightest Derivation (A\*LD)**: if an admissible heuristic (a lower bound on the
cost remaining from an item to the goal) is available, the queue is ordered by
_cost so far + lower bound_, and provably no item is expanded whose lightest
derivation costs more than the goal's. The search is **output-sensitive**: its
work is proportional to the answer, not to the size of the (implicit,
potentially enormous) space of derivations.

Sema's inference engine is an implementation of A\*LD, with one deliberate
extension described next. Four standard disciplines keep it tractable:

1. **Chart memoization** — equivalent partial derivations collapse to one
   canonical entry (the cheapest).
2. **Lazy rule generation** — rules are enumerated only when one of their
   premises has been finalised, never up front.
3. **Demand filtering** — rules whose conclusions cannot reach the goal are
   never emitted.
4. **Admissible heuristic pruning** — the A\* bound keeps the frontier focused
   on the goal.

### 5.3 The semiring extension: evidence pooling

Classic lightest-derivation search operates in the **tropical semiring** (min,
+): among competing derivations of the same conclusion, only the cheapest
survives. That is the right regime for _choosing_ — one best answer, one best
parse.

But some of Sema's decisions are not choices; they are _accumulations of
evidence_. When several independent regions of a query each independently point
at the same stored fact, the fact should be credited with the _sum_ of their
support, not merely the strongest single vote. For those decisions the engine
supports a second combining mode operating in the **arithmetic semiring** (+,
+): every derivation of a marked conclusion _adds_ its cost into a pooled total,
and every contribution is recorded rather than discarded. Semiring-general
deduction is standard theory (Goodman 1999); running both regimes in one search
— minimum-cost for structure, sum for evidence — is how Sema keeps consensus
formation (Section 17) inside the same formal system as everything else, rather
than as an ad-hoc tally alongside it.

### 5.4 Why deduction, and not generation

The choice of weighted deduction as the inference engine is what makes Sema's
central claims true rather than aspirational:

- **Auditability.** The answer _is_ a proof tree. Every byte of output is the
  conclusion of an explicit chain of rule applications over explicit stored
  facts, and that chain can be read back (Section 26).
- **Determinism.** Lightest derivation is an optimization with a well-defined
  optimum (ties broken by fixed conventions), not a sample from a distribution.
- **Honest silence.** If no derivation of the goal exists, the search returns
  nothing. The system cannot "make something up": fabrication is not expressible
  in the formalism.

---

## 6. Approximate nearest-neighbour search

### 6.1 The role of ANN search

Both of Sema's vector relations — gists and halos — need the same primitive:
_given a query vector, find the k stored vectors with highest cosine
similarity_, over a store that may hold millions of vectors, in milliseconds, on
a CPU, without holding everything in RAM. Exact search is linear in the
collection size; **approximate nearest-neighbour (ANN)** search trades a small,
controlled amount of recall for sub-linear query time.

Sema uses two established techniques in combination:

- **IVF (inverted-file partitioning)** — the collection is split into clusters,
  each with a binary pivot code; a query ranks the pivots and scans only the few
  nearest clusters. Cluster size is bounded (an oversized cluster
  deterministically splits in two), so the work per query is set by the number
  of probes, not by the collection — decisively sub-linear. Inserting is
  route-and-append: one RAM scan of the pivot table, no graph maintenance, so
  ingestion cost stays flat as the collection grows.
- **RaBitQ 1-bit quantization** (Gao & Long 2024). Each stored vector is
  randomly rotated and reduced to one _sign bit_ per dimension — a 32×
  compression — with an unbiased, theoretically-grounded estimator of the
  original cosine computable from the code alone. Sema stores _only_ the codes;
  the original float vectors are never kept by the index.

### 6.2 The epistemological consequence

This layer is the one place where Sema's answers to "what is similar?" are
_estimates_: the scores returned by the index are RaBitQ estimates over 1-bit
codes, not exact cosines, and the ranking is approximate. Sema's discipline
about this is strict and worth stating as a principle, because it shapes several
pipeline decisions:

> **Approximate scores may rank and propose; they may never decide identity or
> be compared against exactness.** Any decision of the form "this _is_ that" is
> made by content-addressed resolution in the DAG. Thresholds compared against
> estimated scores gate broad regions (three-sigma bands, half-window bars),
> never knife-edge equalities.

### 6.3 Space-filling curves: geometry as reading order

One more piece of classical machinery belongs to this layer of fundamentals.
Sema's perception consumes _streams of bytes_; images, video, and other
grid-shaped data must first become a stream. Sema linearizes n-dimensional grids
along a **Hilbert curve** — the space-filling curve with the strongest locality
guarantees (points close on the curve are close in the grid, and vice versa to
the extent topology allows). This means spatial neighbourhoods in an image
become contiguous runs in the stream, so the same stream-folding perception that
reads text reads pixels — _geometry is only a reading order_, and every modality
meets the same memory.

---

---

# Part II — The big picture

## 7. How the five foundations connect

### 7.1 One structure, two verbs, one memory

Everything Sema does reduces to two operations over one store:

- **Deposit** (learn): perceive an input into a tree, intern the tree into the
  Merkle DAG, and record its relations (continuation edges, halo pours).
- **Ask** (think): perceive the query the same way, and run one
  lightest-derivation search whose axioms come from recognising the query
  against the store and whose rules are the store's learned relations.

There is no third operation. There is no training phase distinct from
depositing, no fine-tuning, no consolidation pass required for correctness. The
store _is_ the model; a deposit is immediately available to every subsequent
ask.

### 7.2 The division of labour

Each foundation from Part I owns one aspect of the system, and the seams between
them are explicit:

```
                     ┌─────────────────────────────────────────┐
                     │              INPUT (any modality)        │
                     │   text · bytes · images · video          │
                     └──────────────────┬──────────────────────┘
                                        │  Hilbert linearization (§6.3)
                                        ▼
PERCEPTION            ┌─────────────────────────────────────────┐
(VSA, §2)             │  the river fold: bytes → leaves → tree  │
                      │  every node gets a GIST (permutation-    │
                      │  bind + superpose + normalize)           │
                      └──────────────────┬──────────────────────┘
                                         │ identical bytes ⇒ identical tree
                                         ▼
MEMORY                ┌─────────────────────────────────────────┐
(CAM/Merkle, §3)      │  the DAG: hash-consed nodes             │
                      │  identity = content;                     │
                      │  parents ↑ / kids ↓ climbable            │
                      ├─────────────────────────────────────────┤
RELATIONS             │  continuation edges (what follows what)  │
(distributional, §4)  │  halos (what company each node keeps)    │
                      ├─────────────────────────────────────────┤
INDEXES               │  gist index + halo index                 │
(ANN, §6)             │  (IVF over 1-bit RaBitQ codes)           │
                      └──────────────────┬──────────────────────┘
                                         │ axioms & rule candidates
                                         ▼
INFERENCE             ┌─────────────────────────────────────────┐
(deduction, §5)       │  ONE lightest-derivation search:         │
                      │  cover the query · follow edges ·        │
                      │  hop concepts · fuse & recompose ·       │
                      │  splice connectors · pool evidence       │
                      └──────────────────┬──────────────────────┘
                                         ▼
                      ┌─────────────────────────────────────────┐
                      │  answer bytes + provenance + rationale   │
                      │  (a readable proof tree)                 │
                      └─────────────────────────────────────────┘
```

Read the seams carefully, because they are where the design earns its
properties:

- **Perception → Memory.** Perception is a _pure, deterministic function of
  bytes_. The same bytes always fold into the same tree with the same gists.
  This is what makes content addressing possible at all: if perception were
  stochastic or context-dependent, the same content would not reproduce the same
  nodes.
- **Memory → Indexes.** The vector indexes are _derived_ data — pure
  accelerators. Every fact they suggest is verified against the DAG before it is
  acted on. Deleting the indexes loses speed, never knowledge.
- **Memory → Inference.** The deduction system's rules are read off the store: a
  continuation edge is a one-premise rule; a learned composite is a two-premise
  fusion rule; a distributional sibling licenses a (more expensive) concept-hop
  rule. Inference has no rules of its own beyond the cost algebra — _everything
  it can do, it can do only because something was learned_ (plus the manual
  computation rules of Section 16).

### 7.3 The two vector relations, side by side

It is worth fixing firmly, once, the two distinct vector spaces in play —
confusing them is the commonest way to misunderstand the system:

|                         | **Gist (content) space**                      | **Halo (concept) space**                                           |
| :---------------------- | :-------------------------------------------- | :----------------------------------------------------------------- |
| A node's vector encodes | its own bytes and structure                   | the episodes it took part in                                       |
| Built by                | the perception fold (deterministic)           | superposing seat-bound partner company signatures at learning time |
| Two nodes close means   | similar content                               | similar usage (synonymy, categoryhood)                             |
| Typical query           | "what stored form resembles this query span?" | "which nodes are used like this one?"                              |
| Indexed in              | the content index                             | the halo index                                                     |

### 7.4 What "learning" and "generalizing" mean here

- **Learning a fact** = depositing a (context, continuation) pair: both sides
  are interned, one continuation edge is recorded from the context's root to the
  continuation's root, and each side's signature is poured into the other's
  halo.
- **Generalization** happens at query time, by three distinct, inspectable
  mechanisms rather than one opaque one: _geometric proximity_ (a query near a
  learned form resonates with it), _distributional substitution_ (a form can
  stand in for its halo siblings), and _structural analogy_ (a query that
  aligns, byte-wise, with the shapes of several learned experiences can have
  structure transferred between them — Section 18).
- **Forgetting** does not happen implicitly. Nodes are never silently discarded;
  the store only ever grows more connected. (Index maintenance can prune
  _acceleration_ entries, but that affects speed, not knowledge.)

---

## 8. Derived thresholds: the geometry of every decision

A system that makes soft (geometric) decisions needs thresholds, and thresholds
are where hidden empiricism usually creeps in ("0.7 worked on the dev set").
Sema's design rule is strict: **every threshold is derived from the geometry of
the representation itself — from the dimension D, the perception window W, or
the corpus size N — never tuned.** Any constant that cannot be derived is not
used. The five bars below govern the entire pipeline; each is stated with its
derivation.

Throughout: D is the vector dimension, W ("maxGroup") is the maximum number of
children a perception fold groups at once, N is the number of learned contexts
(nodes bearing at least one outgoing continuation edge).

### 8.1 The merge threshold: 1 − 1/√D — "geometrically the same"

The standard deviation of chance resonance between unrelated vectors is 1/√D
(§2.2). A cosine within one such unit _of 1.0_ is closer to identity than chance
can measure apart: the store treats two gists this close as candidates for being
the _same_ node (subject to the byte verification of §3.3). Recall reuses the
same bar to accept "the query is essentially a stored form".

This fixed bar is the identity threshold for two gists of comparable size (in
particular, two roots, which are always unit vectors — §2.6). A claim of the
form "this whole SPAN of `len` bytes is essentially identical to that stored
form" needs a **scale-aware** version of the same idea, because under the linear
fold a cosine reads as a byte-proportional overlap fraction (§2.6): a fixed
cosine bar admits a foreign-byte budget that _grows_ with the span, so naively
reusing 1 − 1/√D on a long span would tolerate far more corruption than
"essentially the same" should mean. The scale-aware bar instead fixes the
tolerated foreign-byte budget at one perception window W — the same
single-window budget near-dedup's byte check grants (§3.3, §11.1) — and converts
it into a cosine floor for the span's own length: **1 − W/len**, floored at the
fixed bar 1 − 1/√D (below which the RaBitQ estimator cannot certify identity
regardless of scale). The scale-aware bar `1 − W/len` tolerates exactly one
perception window W of foreign content — the same single-window budget the byte
check grants, now expressed in cosine space; a span barely longer than W
tolerates almost none. Derived from W, D, and the span length; never tuned.

### 8.2 The reach threshold: 1 − 1/(2W) — "related at all"

Perception folds children in groups of at most W. Two structures that differ in
_one whole child_ — the smallest difference perception can express — sit at
cosine ≈ 1 − 1/W (one of W superposed, permuted components differs). Half that
quantum, 1 − 1/(2W), is therefore _closer than any real single-child difference
can be_: anything scoring above it is a positional echo of the same content, and
anything whose _best_ match in the store falls below it is structurally
unrelated to everything stored. The reach threshold is Sema's confidence floor:
rather than answer from an unrelated neighbour, the system returns nothing.
**Silence is a first-class output.**

### 8.3 The significance bar: 3/√D — "not chance"

Chance resonance has mean 0 and standard deviation 1/√D, so a cosine of 3/√D is
three standard deviations above chance — the conventional statistical bar for
"this relationship is real". Whole-query evidence below this bar is not followed
into the more trusting inference tiers.

### 8.4 The estimator noise floor: 1/√D — "above quantisation noise"

One standard deviation of the cosine between two independent random vectors in D
dimensions (§2.2). It is the smallest difference in cosine that is
distinguishable from the rotation-uniformised RaBitQ estimation error: a
contrastive margin below it is quantisation noise, not evidence. The consensus
climb gates a region's vote on its _discriminative margin_ — the score gap
between the best and second-best anchor — clearing this floor. One σ, not the
stricter 3σ relatedness bar: the minimal "above noise" threshold. Derived from
D, never tuned.

### 8.5 The concept threshold: ½ + 1/(2√D) — "same concept"

Halos are superpositions of episode signatures. The structural midpoint 0.5
separates "more similar than dissimilar"; the added half-sigma 1/(2√D) widens
the bar slightly at low dimension (where chance noise is broader) and vanishes
as D grows. Two halos above this bar mark their nodes as distributional siblings
— eligible for concept hops, articulation substitutions, and analogy.

### 8.6 The consensus floor: ln N + ½ — "corroborated, not echoed"

In the consensus climb (Section 17), a query region's vote for an anchor is
weighted by _inverse document frequency_: reaching an anchor through c of the N
learned contexts is worth ln(N/c), so the maximum any single region can
contribute is ln N (a maximally specific region, c = 1). Requiring a pooled vote
to exceed ln N + ½ therefore demands _strictly more than any one region could
say alone_ — genuine multi-region corroboration at the current corpus scale —
before an anchor is trusted as an independent point of attention. The floor
grows with the corpus exactly as the maximum single-region vote does.

### 8.7 The half-dominance test: ½ — "a part that swallows its whole"

A span covering strictly more than half of its whole can no longer discriminate
the whole's own content — the test behind three pipeline decisions: liftAnswer
keeps the framing when a single recognised span dominates the query (the rest of
the cover is scaffolding), collectRegions excludes a wrapper region that would
drown multi-topic queries, and CAST's frame-depth majority classifies shared
material as non-discriminative structure. Derived from the structural midpoint:
half is the threshold at which the part outweighs what remains. Never tuned.

### 8.8 The hub bound: √N — "stop at non-discriminative fan-out"

Not a similarity bar but the same spirit: any walk over the graph's fan-out (a
node's parents, a context's continuations, an answer's reverse fan-in) is capped
at √N candidates. A node connected to more than √N others is a _hub_ — its
connections are so numerous that each individual one carries almost no
discriminative information. The cap is applied at the _store level_: the store
provides LIMITed read operations so that no per-query read ever materialises a
corpus-sized fan-out list. Consumers of partial fan-outs use the LIMITed reads
to decide their question exactly — "hub or not?", "saturated or voted?" —
without ever expanding past √N distinct contexts. The full materialising reads
remain available for maintenance and inspection paths, but every hot-path
decision consults only the LIMITed prefix or an indexed existence probe. Every
fan-out-limited decision in the pipeline uses this one bound, so the trade is
made once, consistently, and the cost of inference stays bounded by √N rather
than growing with the corpus.

### 8.9 The cost ladder: the one currency of every decision

The deduction system's rule costs form the **single cost currency of the whole
mind**: every grounding mechanism's candidate answer is weighed in these same
units, so a mechanism-level choice (should the answer come from CAST, the cover
search, or recall?) and a byte-level choice (should this span be a recognised
completion or a carried literal?) are the _same kind of decision_ — a lightest
derivation. The ladder is:

```
ε  (MICRO: bridge a recognised span into the     — essentially free; the
    cover)                                          per-byte unit of the
                                                    admissible A* heuristic
1  (STEP: follow one learned edge; one computed   — the unit of inference
    result; one projection; one frame location)
10 (CONCEPT: borrow a sibling's edge; one halo-   — one order dearer than a
    mediated act; one consensus climb)               literal continuation
1000·bytes (PASS: carry an unrecognised literal)  — coverage dominates
                                                    everything: the search
                                                    prefers to recognise
```

The constants are chosen as a strict _ordering_ — any set preserving the order
yields identical lightest derivations. The one quantitative role of ε: it is the
cheapest per-position cost, so "ε × (bytes remaining)" is an admissible A\*
lower bound on the cost to finish covering the query — the heuristic that keeps
the search output-sensitive (§5.2).

The grounding decider (§14.1) uses the same ladder: a candidate answer's weight
is its mechanism's moves (STEP per projection, CONCEPT per halo-mediated act)
plus PASS for every query byte the mechanism did _not_ account for (did not
match against learnt structure). The lightest grounding candidate wins — the
same elementary decision, lifted to the mechanism level.

### 8.10 Two measures of commonality

Every mechanism that asks "is this content discriminative?" must choose a
**reference set** — the population over which _commonality_ is measured. The
system provides exactly two, and they are formally independent: neither quantity
bounds the other, and no derived threshold can convert one into the other. The
choice between them is the single most consequential design decision a mechanism
makes, because it determines what counts as _scaffolding_ and what counts as
_evidence_.

#### Corpus-global commonality

The reference set is **every learned context in the store** — the durable,
corpus-wide population of edge-bearing nodes (counted by `corpusN`). A node's
corpus-global commonality is the number of distinct contexts whose
containment/edge climb reaches it — `reachOf(id, N)`, read through
`edgeAncestors`, capped at √N.

Corpus-global commonality is a **property of a node**, stable across queries.
The same node always reaches the same number of contexts (modulo new deposits).
It answers: _does this content discriminate anything in what the system has
learned?_

Content reaching a corpus **minority** of contexts (¬dominates(reach, N))
discriminates — it is an entity, a filler, a name. Content reaching a corpus
**majority** (dominates(reach, N)) is frame scaffolding — it discriminates
nothing anywhere. This is the half-dominance convention of §8.7, applied to the
entire store.

The climb's IDF weighting (§17.3), confluence's filler/scaffolding gate (§18.5),
and every decision of the form "is this node a hub?" use corpus-global
commonality. The halo index (§4, §12.2) is also corpus-global: a node's
distributional signature is the superposition of ALL episodes it took part in,
not just those relevant to the current query.

#### Weave-local commonality

The reference set is **the structures aligned with this query** — the transient,
query-specific population of anchors the consensus climb ranked and whose
contexts produced literal or distributional runs against the query bytes. The
population size is `aligned`, counted fresh per query; commonality at byte
position `i` is `depth[i]`, the sum of alignment weights covering that byte.

Weave-local commonality is a **property of a query-byte position**, not of a
node. The same byte can be frame for one query and content for another, because
the aligned population changes. It answers: _does this content discriminate
among the structures THIS query activates?_

A byte covered by a weave-local **minority** of aligned structures
(¬dominates(depth[i], aligned)) discriminates among them — it differentiates one
aligned context from another. A byte covered by a weave-local **majority**
(dominates(depth[i], aligned)) is shared scaffolding of the weave — it carries
no information about which aligned structure is which, regardless of how rare or
common it is in the corpus.

CAST's frame gate (§18.3) uses weave-local commonality. The grounding decider's
`unaccounted` bytes (§14.1) are also weave-local in spirit: they measure what
THIS query's mechanisms did not explain, priced against the query's own length.

#### Independence

The two measures are computed over **different data structures** with
**different stopping criteria**:

- Corpus-global: `edgeAncestors` walks the DAG's parent edges (`parentsFirst`,
  `prevFirst`), counting distinct edge-bearing contexts, capped at √N. It
  answers a question about a node's position in the permanent store.

- Weave-local: `alignGraded` aligns raw bytes (literal W-gram seed-and-extend,
  then halo-matched recognised sites), incrementing a per-byte `depth` array. It
  answers a question about this query's transient alignment.

Neither computation is a special case of the other. A phrase common to 2 of 3
aligned exemplars but rare in the corpus (low reach, high weave-local share)
**is** frame for the weave — it is shared scaffolding of this particular
analogy, not differentiating content. A phrase with high corpus reach (common
everywhere) that happens to appear in only 1 of 3 aligned exemplars **is**
content for the weave — it differentiates that exemplar from the others. The two
coincide often (semantically rich exemplars tend to share corpus-wide
scaffolding), but neither derives the other. They cannot be treated as
interchangeable: replacing CAST's weave-local gate with the structural IDF lets
the substitution branch fire on reordered single-fact queries.

#### Which measure for which question

The system provides both measures. Each mechanism picks the one that answers its
question:

| Mechanism                 | Question                                                                  | Measure                                        |
| ------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| Consensus climb (§17)     | Does this region's anchor discriminate among learned contexts?            | Corpus-global (IDF weight)                     |
| Confluence (§18.5)        | Does this shared content name an entity or is it scaffolding?             | Corpus-global (dominates(reach, N))            |
| CAST frame gate (§18.3)   | Do the aligned structures share this byte, or does it differentiate them? | Weave-local (dominates(depth[i], aligned))     |
| Grounding decider (§14.1) | Which mechanism explains more of THIS query?                              | Weave-local (unaccounted bytes / query length) |
| Recognition (§15)         | Is this span a stored form?                                               | Neither — exact, content-addressed             |
| Cover search (§19)        | Can the query be covered by recognised completions?                       | Neither — cost-ladder, output-sensitive        |

A mechanism that uses the wrong measure answers the wrong question. The system
cannot prevent this — both measures are available, and the architecture does not
enforce which one a mechanism consults. The distinction is a design discipline,
not a type-level guard.

Concretely: in a query that weaves 3 painting exemplars, the phrase " describe
it" has high weave-local depth (all 3 aligned contexts contain it) but low
corpus-global reach (only those 3 of 20 learned contexts do).
`dominates(depth, 3)` says frame — shared scaffolding of this particular
analogy. `dominates(reach, 20)` says content — a minority of the corpus, hence
discriminative. The frame gate correctly ignores the corpus and asks the
weave-local question. A mechanism that asked the corpus-global question here
would classify " describe it" as content and let substitution fire on a
reordered single-fact query. The same node, the same bytes, two different
answers — because two different questions were asked over two different
populations.

---

## 9. The concept inventory

Every named concept in the system, one line each, with its home section. This is
the vocabulary the rest of the document (and the codebase) speaks.

**Representation**

- **Gist** — the VSA fold of a span's content; content similarity in one dot
  product (§2.3).
- **Seat / keyring** — the fixed random permutations that bind ordinal position
  into a fold (§2.3).
- **Alphabet** — the 256 deterministic byte vectors with graded similarity
  (§2.4).
- **River fold** — the level-by-level grouping of leaves into a tree, W at a
  time (§10). **Linear**: only the fold's root is normalized, so every interior
  gist keeps a byte-proportional magnitude — the basis of angle-and-magnitude
  semantics (§2.6).
- **Magnitude / contentLen** — the byte-proportional length an unnormalized
  interior gist carries (norm ≈ √len); read back from the store as a span's
  content length and used to convert a raw cosine into a query-relative or
  scale-aware fraction (§2.6, §8.1, §17.3, §21).
- **Stable prefix** — the already-known head of a stream, folded independently
  so its structure is reproducible (§10.3).

**Memory**

- **Node** — a leaf (bytes) or branch (ordered children); identity = content
  (§3.2).
- **isChunk** — the predicate for "children are all leaves" — the perception
  tree's smallest grouped unit, behind region collection, canonical seams, and
  sub-span indexing (§10, §11.3, §17.2).
- **Interning / hash-consing** — storing a tree bottom-up so equal subtrees
  share one node (§11).
- **Near-dedup** — merging a fresh root onto a geometrically identical,
  byte-verified stored root (§11.2).
- **Containment edge** — a durable "this window of bytes occurs inside that
  chunk" record for sub-spans that are not structural children (§11.3).
- **Transparent chain (chainRun)** — a run of nodes each with exactly one
  structural parent and no continuation edges in or out; climbed in a single
  bounded read instead of one probe per node. Used by the structural DAG climb
  to skip scaffolding when ascending to edge-bearing contexts.
- **Continuation edge** — the learned relation "this followed that"; the atom of
  factual knowledge (§12.1).
- **Company signature** — a deterministic unit vector derived from a node's
  identity (seeded by its id), used as the halo-pour unit instead of the node's
  gist (§4, §12.2). Decouples content similarity from distributional similarity.
- **Halo / halo mass** — a node's distributional signature (superposition of
  partner company signatures) and the count of episodes poured into it (§4,
  §12.2).
- **Resonance target** — a node whose gist is admitted to the content index
  (lazily: roots, edge/halo bearers, and interior forms of experiences) (§12.3).
- **Junction** — a learnt whole that literally contains two forms, found by
  content-addressed DAG ascent (parents + containment links) from the two sides'
  canonical identities — not by a resonance guess. The walk is **order-free** (a
  junction evidences that two forms were learnt together; which one the query
  mentions first is a fact about the query, not the learnt whole — the
  byte-containment test probes both orders, costing two indexOf calls per
  visited node, never a second walk). Overlapping or abutting occurrences are
  accepted (grid fragments of one whole legitimately overlap inside it), with a
  strict-super-form requirement (holding both must be more than restating either
  side). The bridge's Tier 1 connector search (§19.5) and cross-region
  attention's joint-context recovery (§17.6) ascend by the same shared, bounded,
  cached walk. A per-response walk cache memoises every identity read across all
  walks of one response, and junction seeds are computed once per candidate and
  reused across all its pairs. Synonym junctions extend the ascent to halo
  siblings (Tier 2.5), sharing one expansion budget across all sibling walks.

**Inference**

- **Match-and-project** — the ONE elementary operation every generalising
  mechanism configures: match a learned structure under a matcher, project along
  a learned relation in a direction, accept past a derived gate (§14.4).
- **Matcher** — the matching relation of a match-and-project: exact
  (content-addressed), locate (the graded exact→halo→gist ladder), aligned
  (literal W-gram runs), or distributional (analogy strength) (§14.4).
- **Projection / direction** — the learned relation a matched node is projected
  along: forward (`follow`, to the continuation fixpoint), reverse
  (`reverseContext`, to the establishing context), both (`project`), read-out,
  insert, or substitute (§14.4).
- **Hub cap** — the one √N fan-out convention (§8.8), applied in two forms:
  `hubBound` (≥ 2, the numerical cap passed to the store's LIMITed reads) and
  `hubCap` (the list-side reading). Every fan-out walk and disambiguation uses
  one of them; the store enforces the cap at read time so no per-query cost
  grows with the corpus.
- **Estimator noise floor** — 1/√D, one standard deviation of chance cosine
  between random vectors. The smallest difference distinguishable from RaBitQ
  quantisation error (§8.4). The consensus climb gates a region's vote on its
  discriminative margin clearing this floor.
- **Half-dominance** — a part covering strictly more than half of its whole can
  no longer discriminate it (§8.7). The structural midpoint, derived, never
  tuned. Used by liftAnswer, region collection, and CAST frame classification.
- **Commonality (corpus-global vs. weave-local)** — the TWO reference sets over
  which "is this content shared or discriminative?" is measured (§8.10).
  Corpus-global: the durable population of all learned contexts (N); answers
  "does this discriminate anything in the store?" Weave-local: the transient
  population of structures aligned with this query (aligned); answers "does this
  discriminate among the structures this query activates?" The two are formally
  independent — a phrase rare in the corpus can be scaffolding of the weave, and
  a phrase common everywhere can differentiate two aligned exemplars. The system
  provides both; each mechanism chooses the one that answers its question.
- **Corpus N** (`corpusN`) — the count of distinct learned contexts floored at
  2, so its derived readings (ln N, √N) stay meaningful on a near-empty store.
  Defined once; every consumer of the corpus scale reads it. (§8.8, §17)
- **Expand-until-decided** — the climb's work is bounded by stopping the moment
  the answer (saturated vs. voted) is known, through LIMITed store reads only
  (§17.4). The walk is exact below √N distinct contexts and stops at the first
  proof of saturation past it.
- **Canonical contract** — the write/read convention for the store's
  segmentation: the write side interns W−1 and W sliding windows and a
  whole-stream flat branch; the read side chains leaf ids up to W² positions and
  probes every prefix as a flat branch. Defined in one module; a drift between
  the sides silently breaks recognition. (§10.3, §11.3, §15.2)
- **Window IDs** — the canonical content-addressed identity of every W-sized
  slice of a byte stream, offset → node id. Under this mapping, any content two
  deposits share IS the same node (hash-consing paid the comparison at write
  time). Confluence's meet and CAST's frame detection read shared content
  through this — never through a byte scan. (§18.1, §18.5)
- **Reach (structural IDF)** — the number of distinct learnt contexts a single
  node's containment/edge climb reaches, or Infinity when it reaches none or
  saturates. Paired with the half-dominance convention: content reaching a
  corpus minority of contexts discriminates (an entity, a filler); content
  reaching a majority is frame scaffolding. (§18.3, §18.5)
- **Recognition** — decomposing a query into every stored form it contains, by
  structural and canonical readings (§15).
- **Site** — one recognised form: a query span plus the node it names (§15).
- **Cover** — the lightest-derivation goal: the query covered left to right by
  recognised completions and carried literals (§19).
- **Fuse / recompose** — the search's discovery that adjacent fragments spell a
  deeper learned form (§19.4).
- **Connector (bridge)** — learned material that belongs _between_ two spans,
  found by a graded junction ladder: Tier 1 containment ascent by
  content-addressed identity, then Tier 2 edge junctions (a continuation/context
  carrying the glue), then Tier 2.5 synonym junctions (the same ascent over halo
  siblings), then resonance as last resort; disambiguated by the response guide,
  with the shortest interior preferred. The junction ascent is shared with
  cross-region attention (§19.5, §17.6).
- **Concept hop** — borrowing a distributional sibling's continuation via
  `haloSiblings` (the unified halo-sibling enumeration) and `guidedFirst` (the
  guided-or-first convention for edge picks) (§19.3).
- **Join with bridge** — the shared composition step for out-of-search assembly:
  a learned connector between two spans, or a bare join with a visible
  `bridgeMiss` trace step. Used by multi-topic fusion and CAST. (§19.5, §23)
- **Recompletion** — covering a produced answer's own bytes with the same
  machinery, recursively, to let composites resolve deeper (§19.6).
- **Consensus climb / point of attention** — regions of the query vote, through
  the DAG's parents, for the learned contexts they belong to. Regions come from
  TWO sources: perceived subtrees (the river fold's positional chunks) and
  recognised sites (content-addressed nodes — exact anchors that skip the ANN
  resonance step). Sites capture whole words that cross W-boundaries, which
  perceived chunks alone miss. Pooled votes select the query's independent
  topics (§17).
- **Saturation** — a region whose upward climb hits hub fan-out abstains rather
  than voting noise (§17.4).
- **Cross-region attention** — direct region-to-region interaction: two regions
  that independently voted (at least one strongly) pair to recover their joint
  context — the learnt whole containing both — by the same order-free junction
  ascent the bridge uses. Corpus-independent: any voted region composes, and a
  known but non-voting region may serve as the weak side of a pair whose other
  side voted (a word never trained standalone still binds through its stored
  byte fragments); two non-voting regions never pair (the shared-prefix trap).
  N-ary: pair containers are filtered by the remaining candidate forms — the
  container covering the most of the query's composable forms wins, so three
  cross-cutting attributes resolve to their unique triple at the cost of one
  cached read + indexOf per (container, extra), never an extra walk. Explaining
  away: when a junction binds, any individual vote whose bytes the joint
  container literally contains and whose roots are fully disjoint from the
  junction's is superseded — the exact joint evidence explains those bytes away;
  partial agreement corroborates and is kept. Self-evidence guard: a container
  whose joined occurrence is itself a substring of the query is rejected —
  binding is only evidence when the query mentions the forms apart. Consumed
  candidates never re-pair. A joint container is exact evidence, voting at full
  strength. Additive pooling alone cannot surface a context zero regions
  individually voted for; cross-region evidence fills that gap (§17.6).
- **CAST (counterfactual transfer)** — substitution / redirection / comparison
  between independently learned structures the query weaves together. Alignment
  is **graded** (literal W-grams → halo-matched sites); frame gates are
  **derived** (`MIN_WEAVE` from the weave minimum, `dominates` from
  half-dominance) and **weave-local** (majority of _aligned_ structures, not
  corpus-global IDF). (§18)
- **Confluence join** — the meet of independent constraint streams by
  content-addressed identity: window IDs present in both anchors and absent from
  the query name the entity satisfying all constraints at once. Answers
  conjunctive queries ("Which X is A and B?") that no single-fact mechanism can
  resolve. (§18.5)
- **Skill / exemplar** — a learned fact shaped "answer-is-a-span-of-context",
  reusable as an extraction template on unseen text (§20).
- **Recall tiers** — the graded fallback for whole-query resonance, from exact
  self-match to honest echo. Each tier reports _what it matched_ (`accounted`),
  its _moves_, and `unexplained` — a human-readable label for the query bytes it
  left on the table — so the grounding decider can compare it against every
  other mechanism in the same currency with full diagnostic visibility. (§21)
- **Accounted spans** — the query byte ranges a mechanism's own structural
  evidence explains (aligned runs, located frames, voted regions, constraint
  content). Query bytes outside them are priced at PASS each — the same rate the
  cover search pays for a literal connective — so "which mechanism explains more
  of the query with learnt structure" is the primary axis of the grounding
  decider. (§14.1, §20, §21)
- **Open seat (read-out content is not evidence)** — the span extraction reads
  between located frames is structurally explained (we know _where_ to read it)
  but content-novel (we do not know _what_ it says). It is the variable being
  read, not the structure doing the reading — the same role the cover's
  unrecognised literals play, and priced the same way (PASS each, by exclusion).
  Counting it as explained would let a mechanism claim credit for bytes it
  merely copied from the query. (§20)
- **Forward asymmetry (reverse is not derivation)** — the deduction system has
  no backward rule; a reading against the edge direction (`reverseContext`)
  produces bytes but no forward derivation. The grounding decider expresses this
  exactly: reverse readings get `accounted = []`, their weight the full
  PASS·|query|. The decider derives this from the evidence the formalism itself
  declares. (§21)
- **Weave-local vs. corpus-global commonality** — CAST's frame gates are
  weave-local (majority of _aligned_ points, per query), not corpus-global
  (majority of contexts, across the store). The two quantities are formally
  independent — a phrase common to 2 of 3 aligned exemplars but rare in the
  corpus IS frame for CAST's purposes; substituting global IDF misfires on
  reordered single-fact queries. (§18.2)
- **Free-will architecture** — the grounding decider as a market: mechanisms are
  decoupled (zero cross-imports), self-gating (binary structural preconditions),
  budget-capped (√N, k, LIMITed reads), and evidence-carrying (`accounted`,
  `moves`, `unexplained`). The decider compares weights in one currency; it does
  not know which mechanism produced which candidate. The same four constraints —
  decoupling, declared competence, visible budget, traveling evidence — are the
  structural principle that makes any budget-limited reasoner honest, from
  Sema's `√N` to a model's `max_tokens`. (§14.5)
- **Grounding decider** — the unified choice among grounding mechanisms: every
  self-gating mechanism yields a candidate answer weighed in the one cost
  ladder, and the lightest grounding derivation wins. Moves (STEP per
  projection, CONCEPT per halo-mediated act) discriminate residually; PASS per
  unexplained byte dominates. Ties keep the mechanism list's order (cover, CAST,
  confluence, extract, recall). The decider uses admissible-floor pruning (a
  mechanism whose best-case floor cannot beat the incumbent is never run) — and
  a mechanism whose floor itself needs expensive precomputation to refine checks
  the SAME incumbent before paying for it (§14.1, §14.2).
- **Pivot** — the longest unconsumed learned context contained in the current
  answer; the stepping stone of multi-hop reasoning (§22).
- **Fusion** — grounding each independent point of attention and joining the
  results with learned connectors (§23).
- **Articulation** — re-voicing the answer in the asker's own words via halo
  siblings (§24).
- **Echo** — the last-resort output that returns a stored form verbatim,
  explicitly flagged as not grounded (§21.4, §26).
- **Provenance** — which grounding mechanism produced the answer; part of every
  response (§26).
- **Rationale** — the replayable trace of every rule application behind an
  answer (§26).

**Computation**

- **PipelineMechanism** — the ONE uniform interface every grounding mechanism
  (CAST, confluence, cover, extraction, recall, the ALU, any user extension)
  implements: an optional `parse` (authoritative computed spans, pre-loop), a
  `floor` (admissible lower bound), and a `run` (candidate answers). The
  pipeline never special-cases any mechanism by name or kind (§14.1, §16).
- **Precomputed** — the shared, response-scoped container every mechanism's
  `floor`/`run` (and the post-grounding stages) receive: eager fields
  (recognition, computed spans, guide) plus lazily-cached methods for the
  expensive structural analyses (the consensus climb `attention()`, the weave,
  span-shape classification, the identity-window reads), each computed at most
  once, reused across every consumer, and never computed at all when no
  mechanism asks (§14.1, §14.2).
- **Extension** — a user- or built-in-supplied `PipelineMechanism` whose `parse`
  recognises computations (arithmetic, logic, …) the mind should not have to
  learn fact-by-fact; joins via `mechanismFactories` (§16).
- **ALU** — the built-in extension: arithmetic, logic, and numerical computation
  derived from an irreducible kernel (§16.2).
- **Masking** — computed spans override colliding learned facts for exactly
  their bytes ("computation always wins") (§16.3).

---

---

# Part III — The ingestion pipeline

Ingestion is the learning half of the system: input bytes in, a more
knowledgeable graph out. It has three stages — perception, deposition, relation
learning — and the whole of it is deterministic: the same inputs in the same
order always produce a structurally identical store.

```
                     THE INGESTION PIPELINE

  input (text / bytes / grid / frames)
        │
        │ 1. modality flattening (grids → Hilbert-ordered byte stream)
        ▼
  byte stream  b₀ b₁ b₂ … bₙ
        │
        │ 2. leaf lift: each byte → a leaf carrying its alphabet vector
        ▼
  leaves  [l₀][l₁][l₂] … [lₙ]
        │
        │ 3. RIVER FOLD: group ≤ W siblings per level, seat-bind + superpose
        │    (splitting at the stable-prefix boundary when the head of the
        │     stream is already known)
        ▼
  perceived tree  (every node: bytes-or-kids  +  gist vector)
        │
        │ 4. INTERN bottom-up into the Merkle DAG
        │    exact dedup → near-dedup (byte-verified) → mint new node
        ▼
  root node id  +  id of every subtree
        │
        ├─ 5a. sub-span windows + containment edges  (recognition seams)
        ├─ 5b. whole-stream flat branch              (canonical byte identity)
        │
        │ 6. RELATIONS
        │    single input: chain part → part continuation edges
        │    pair (context, continuation):
        │        edge  context-root ──▶ continuation-root
        │        halos: pour each side's seat-bound company signature into the other
        ▼
  updated store  (DAG + edges + halos + lazily-updated vector indexes)
```

---

## 10. Perception: from bytes to a tree

### 10.1 Every modality is a stream

Perception's contract is minimal: it accepts a _byte stream_ and returns a tree.
Text becomes bytes by UTF-8 encoding; raw binary is already bytes; an image, a
volume, or a stack of video frames is linearized along a Hilbert curve (§6.3) so
that spatial locality becomes stream locality. Nothing downstream knows or cares
which modality produced the stream — _geometry is only a reading order_.

### 10.2 The river fold

The fold builds the tree level by level, like a river merging tributaries:

```
riverFold(leaves):
    level ← leaves
    while |level| > 1:
        next ← []
        for each complete group g of W consecutive items in level:
            next.append( foldGroup(g) )        # one parent node
        append the trailing incomplete items (fewer than W) unchanged
        level ← next                            # recurse upward
    normalize( level[0].gist )                  # ONLY the finished root
    return level[0]

foldGroup(children c₀ … cₖ):                    # k < W
    gist ← Σᵢ  πᵢ · gist(cᵢ)                     # seat-bind + superpose (§2.3)
                                                 # — NOT normalized here
    return branch node with kids (c₀ … cₖ) and that gist
```

Properties worth noting:

- **Determinism.** Grouping is purely positional; the same stream always yields
  the same tree shape and, therefore (given the fixed alphabet and keyring), the
  same gists everywhere.
- **Logarithmic depth.** Each level shrinks by roughly a factor of W, so a
  stream of n bytes folds in ⌈log_W n⌉ levels.
- **Every level is meaningful.** Intermediate nodes are not scaffolding to be
  discarded; each one is a content-addressable span with a gist — perception
  manufactures the _addressable sub-structure_ that recognition and attention
  later depend on.
- **Linear, not renormalized per level.** Only the completed root is normalized
  to unit length; every interior gist is left at its raw superposed length. This
  is a deliberate choice of similarity semantics, not a shortcut: an interior
  node's magnitude grows with the amount of content folded into it (§2.6), so
  the fold gives every span both an angle (what it resembles) and a magnitude
  (how much of it there is) for free, in the same vector.
- **W is the resolution quantum.** W bounds how much material one fold step
  mixes; it reappears throughout the system as the "one perceptual step" unit
  (the reach threshold, the near-dedup window, the fusible span ceiling,
  alignment seed size).

### 10.3 The stable prefix

One refinement protects structure across growing inputs. Consider training on a
dialogue where each turn's context is the previous context plus one more
exchange. Folded naively, adding bytes at the end can shift every group
boundary, so the shared prefix folds _differently_ in each deposit — the store
would never notice that the prefix is the same knowledge.

Perception therefore checks, before folding, whether some head of the stream is
_already a known form_ (a store-recognised sequence of leaves — an exact,
content-addressed check, not a similarity guess). If a known **proper** prefix
of length p exists, the fold is split at p: the prefix folds exactly as it did
when it was learned, the suffix folds independently, and the two join only at
the top. Identical prefixes thus produce identical subtrees — and hash-consing
then collapses them to the very same nodes — regardless of what follows them.

(The prefix must be _proper_ — shorter than the whole input — because a
full-length match would mean the entire input is already stored, and splitting
there would hide the true internal structure.)

### 10.4 Perception pseudocode, complete

```
perceive(input):
    bytes ← flatten(input)                      # UTF-8 / identity / Hilbert
    if bytes is empty: return the empty tree
    leaves ← [ leaf(bᵢ, alphabet[bᵢ]) for each byte bᵢ ]
    p ← longest proper prefix of `bytes` whose leaf-sequence is a known form
    return riverFold(leaves, splitAt = p if p > 0 else none)

# riverFold with a split: at every level, items are partitioned at the
# boundary containing byte-offset p; each side folds as if standalone.
```

---

## 11. Deposition: interning the tree into the graph

### 11.1 Bottom-up interning

The perceived tree is interned into the DAG bottom-up:

```
intern(tree node n) → node id:
    if n is a leaf:
        return internLeaf(n.bytes, n.gist)
    kidIds ← [ intern(k) for k in n.kids ]      # children first
    return internBranch(kidIds, n.gist)
```

Both interning operations follow the same ladder:

```
internLeaf / internBranch(content, gist):
    1. EXACT DEDUP     if a node with this exact content exists → return it
    1b. CROSS-REP      if this is a branch whose kid ids flatten to a known
                       flat branch's bytes, reuse that flat branch's id
                       (§3.2 — content addressing across representations)
    2. NEAR DEDUP      (branches only, against whole-experience roots only)
                       if some fresh root's gist is within the merge
                       threshold (§8.1) AND the two byte strings differ by
                       at most ONE local span of ≤ W bytes → return that id
    3. MINT            otherwise create a new node; record, for each child,
                       the reverse (child → parent) structural edge
```

Points of principle:

- **Exact dedup is the primary compression** and is intrinsic: it is what makes
  identity a function of content (§3.1). It works for leaves and branches alike.
- **Near-dedup is deliberately narrow.** It applies only to branches, only
  against _genuine whole experiences_ (roots that bear edges or halos — never
  interior scaffolding), and only with byte verification. The geometric bar
  alone is scale-blind: in a deep fold, a large localized difference dilutes
  toward cosine 1, so _any_ fixed bar below 1 would eventually merge things that
  differ in exactly the span that matters. The byte check — identical except one
  window of at most W bytes — is the perception system's own definition of "the
  smallest real difference", so the merge can never corrupt reconstruction.
- **The parent edges minted in step 3 are the climb.** Every branch records
  itself as a parent of each distinct child. These reverse edges are what later
  lets a recognised fragment climb to the experiences containing it (§17).
  Single-byte leaves are exempt: a byte occurs in nearly everything, so its
  parent set would be a useless corpus-sized hub.

### 11.2 Why interior nodes matter

After interning, _every_ subtree of the deposit — not just the root — is an
addressable node. This is not an implementation convenience; it is the mechanism
behind three capabilities:

- **Partial recall**: a query naming only a slice of an experience can resonate
  with that slice's node directly.
- **Multi-topic attention**: different regions of one query can anchor to
  interior nodes of _different_ experiences (§17).
- **Compositional generalization**: fresh input that shares any sub-span with
  old input shares nodes with it, so the new is literally built out of the old.

### 11.3 Sub-span windows and containment

Perception's grouping is positional, so a meaningful unit (say, a name) may
straddle a group boundary and never be a node of any tree. Deposition therefore
additionally interns **sliding windows** of W and W−1 leaves across the stream,
as flat branches. A window that does not coincide with a structural child of any
chunk is linked to the chunk(s) it overlaps by a durable **containment edge** —
a second, weaker parent relation meaning "these bytes occur inside that chunk".
When a later climb starts from such a window (which has no structural parents of
its own), it climbs through its containment parents instead. This closes the
recognition seams that pure positional chunking would leave.

Deposition also interns the **whole stream as one flat branch** (the sequence of
its byte-leaves). This gives every deposit a canonical byte-level identity
independent of tree shape — the form the stable-prefix check of §10.3 looks up,
and a second content-addressed route to the same experience.

---

## 12. Learning relations: edges and halos

### 12.1 Continuation edges: the atom of factual knowledge

A **fact**, in Sema, is an ordered association: _this_ was followed by _that_.
Depositing a pair (context, continuation) records one continuation edge from the
context's root node to the continuation's root node. Edges are:

- **Idempotent** — the same pair deposited twice is one edge (though its halo
  evidence accumulates; see below).
- **Directional** — "what follows X" (forward) and "what does X follow"
  (reverse) are both readable, and both are used: forward for answering, reverse
  for recognising that a query _is_ some context's answer (reverse recall,
  §21.1) and for counting evidence (§25).
- **Plural** — a context may accumulate many continuations (the same question
  answered differently across a corpus). Choosing among them is a first-class
  disambiguation problem (§25), not an error.

A _single_ input (no pair) still learns sequence: the parts of its root are
chained by edges at stride W, so a long document is traversable as a sequence of
its chunks.

### 12.2 Halo pours: distributional bookkeeping

When a pair (context, continuation) is deposited, each side's **company
signature** — a deterministic unit vector derived from the partner's node
identity — is superposed ("poured") into the other side's halo, bound to a role
seat so that "I appeared as context" and "I appeared as answer" are
geometrically distinct:

```
pour( halo(contextPart) ,  π₁ · companySignature(continuation) )
pour( halo(continuation) , π₀ · companySignature(contextPart)  )
```

The company signature is seeded by the partner's node id. Node ids are
content-addressed (mint order), stable for a given corpus (including
checkpoint/resume, which re-derives identical ids), so the same partner always
contributes the same signature. But two partners with the _same bytes_ and
_different ids_ contribute nearly orthogonal signatures — so two halos correlate
only through shared episode history, never through accidental byte-level content
overlap.

Over many episodes, a node's halo becomes the superposition of everything it has
kept company with — the distributional signature of §4. Each pour also
increments the node's **halo mass**, the direct count of corroborating episodes.

One subtlety guards the signal's quality: in a _tracked_ sequence of deposits
(e.g. a growing dialogue), the context's pour targets only the **changed nodes**
— the subtree that is new relative to the previous deposit — so a boilerplate
prefix repeated in every turn does not soak up halo mass and drown the
discriminating content.

### 12.3 Lazy indexing: what enters the vector indexes, and when

The DAG holds every node, but the _content index_ (the ANN structure over gists,
§6) holds only nodes worth resonating to — and admission is lazy:

- A node's gist is _captured_ at intern time but _indexed_ only when the node
  becomes a **resonance target**: it gains an edge, gains a halo, is a deposit
  root, or is an interior form of an experience (when either end of an edge is
  learned, that experience's whole subtree is admitted, because partial queries
  must be able to resonate with its interior).
- A node that structurally **bridges** two experiences (its parent count crosses
  1 → 2) is promoted at exactly that moment — the moment it becomes useful for
  cross-experience recall.
- Pure intermediate scaffolding that never becomes any of those is never indexed
  at all. It still exists in the DAG (identity, reconstruction, climbing all
  work); it simply is not a resonance destination.

The halo index is maintained on a geometric schedule (a node's halo is
re-indexed when its mass is small or crosses a power of two), since a halo's
_direction_ stabilizes as mass grows.

The principle: **the DAG is the truth; the indexes are lazy, rebuildable views
of the parts of the truth that queries actually land on.**

---

## 13. Ingestion, end to end

The complete deposit algorithm, in pseudocode:

```
ingest(input, second = none):

  # ── forms ────────────────────────────────────────────────────────────
  if input is a list of items / (context, continuation) pairs:
      for each element: ingest it by the rules below
      return

  if second is given:  ingestPair(input, second)
  else:                ingestOne(input)


deposit(input, tracked):
    bytes ← flatten(input)
    tree  ← perceive(bytes)                          # §10
    ids   ← intern every node of tree, bottom-up     # §11.1
    intern sliding W / W−1 windows; record containment edges     # §11.3
    intern the whole stream as a flat branch                     # §11.3
    changed ← if tracked and a previous deposit exists:
                  the maximal new subtree vs. the previous deposit  # §12.2
              else: [ tree ]
    return (tree, rootId, ids, changed)


ingestOne(input):                                    # a bare experience
    (tree, root, ids, _) ← deposit(input, tracked = true)
    mark root as a resonance target                  # §12.3
    parts ← the root's immediate children
    if |parts| > W:
        link parts[i] ──▶ parts[i+W]  for each stride-W step   # §12.1
    else:
        mark each part as a resonance target


ingestPair(context, continuation):                   # a fact
    (ctxTree, ctxRoot, ctxIds, changed) ← deposit(context,      tracked = true)
    (conTree, conRoot, _,       _     ) ← deposit(continuation, tracked = false)

    link  ctxRoot ──▶ conRoot                        # the fact itself
    for each part in changed:                        # distributional evidence
        pour halo(part)    += π₁ · companySignature(conRoot)
        pour halo(conRoot) += π₀ · companySignature(part)
    # linking / pouring admits both subtrees' interiors to the content
    # index (lazily), per §12.3
```

Costs, in broad strokes: perception is linear in the input length; interning is
one content-addressed lookup per tree node (the tree has O(n/W · logᵂ n) nodes
but is dominated by its O(n) leaves); relation learning is O(1) edges plus
O(changed parts) halo pours. Nothing in the deposit path scans the corpus.
**Training a fact takes one pass over the fact.**

### 13.1 Why storage stays viable: the economics of the store

The claims above ("one pass", "nothing scans the corpus", "bounded RAM") are not
free consequences of the data model — they are earned by a specific set of
cost-control mechanisms in the store. They deserve their own account, because
each one is a _deliberate trade_ whose failure mode is well understood, and
together they are what makes a corpus-scale store run on ordinary hardware. The
organizing principle:

> **Exactness is mandatory only for identity and reconstruction. Everything else
> — caches, indexes, buffers — is a bounded, rebuildable accelerator whose miss
> costs work, never correctness.**

The mechanisms, each with its trade:

**1. Implicit leaves and flat branches (representation compression).** Single
bytes are not stored at all — a byte's node id is derived from its value (the
negative range), so the 256 most common nodes in existence cost zero rows. A
branch whose children are all single-byte leaves (the vast majority of small
spans) stores its _bytes_ (1 byte per child) instead of a packed child-id list
(4 bytes per child) — a 4× saving on the store's most numerous row shape,
content-addressed through the same lookup path.

**2. Bounded caches everywhere (RAM viability).** Every in-memory acceleration
structure — the exact-dedup key maps, the reconstructed-bytes cache, the
node-record cache, the pending-gist capture, the exact halo accumulators — is an
LRU map with a _byte budget_, not an entry count. Reconstruction caches evict
smallest-first (protecting entries that are expensive to rebuild); all others
evict least-recently used. A miss re-derives from durable state. Resident memory
is therefore capped by configuration regardless of corpus size.

**3. Lazy, selective vector indexing (index viability).** The ANN index is the
most expensive thing the store maintains — every entry costs an encode, graph
edges, and future query work. So admission is lazy and selective (§12.3): a
node's gist is _captured_ cheaply at intern time into a bounded buffer, and
_indexed_ only at the moment the node demonstrably becomes a resonance
destination — when it gains an edge (which also admits its whole subtree's
interior forms), gains a halo, is a deposit root, or crosses the 1→2 parent
transition that makes it a bridge between experiences. Pure scaffolding is never
indexed. The trade: an evicted-before-promotion gist means that node is
reachable only by the structural climb until a batch repair pass regenerates it
— reduced reach, never wrong answers.

**4. No per-branch ANN probes on the write path (write viability).**
Near-deduplication (§11.1 step 2) consults only the _write buffer's_ few
whole-experience roots — an O(buffer) exact scan — never the flushed ANN index.
Probing the ANN index for every new branch is both the dominant potential
training cost and _unsound_: 1-bit estimates can rank a byte-distinct branch
nearest, and merging on that corrupts reconstruction. The principle:
**approximate structures are kept off the write path entirely.**

**5. Write batching with deferred durability (I/O viability).** Node rows,
edges, halos, containment sets, and vector-index entries accumulate in buffers
and commit in coalesced batches (one transaction, one index upsert) once a size
threshold is reached — turning what would be per-node fsync-bounded writes into
large sequential ones. Within a batch, repeated halo pours to the same node
coalesce to one index write.

**6. Two quantizations, two purposes (halo viability).** Halo accumulators would
otherwise be the largest table in an episodically-trained store (one float
vector per fact-bearing node). Gists avoid this problem entirely — a gist is a
deterministic function of a node's content (`perceive → fold`), so it can live
in a volatile buffer and be regenerated on demand. A halo is a function of
_training history_ (the sum of every episode signature poured into it) — it
cannot be regenerated from the node's bytes and must be durable. The system uses
two different quantizations because durability and search have different
requirements:

- **Durable row: 2-bit Lloyd–Max, reversible.** The halo vector is stored on
  disk at 16× compression (260 bytes for D=1024 vs. 4096 for float32). It must
  be decodable back to an approximate float32 vector because it serves as an
  _accumulator_: a session loads it, adds new pours to it in float32, and writes
  it back. The round-trip through the quantizer preserves ≥ 0.88 correlation
  with the exact accumulator — the coarsest grain that survives repeated
  load→accumulate→flush cycles without the direction drifting. One bit would
  _not_ suffice for this purpose: decoded back, a sign-only vector is binary
  (±1), and accumulating on top of it degrades with every cycle.

- **ANN index: 1-bit RaBitQ, irreversible.** The same halo vector, projected
  through a random rotation and reduced to one sign bit per dimension (32×
  compression), serves as a search code in the IVF index. This code is _never_
  decoded back — it only answers "which halos are near this query?" The
  estimator is unbiased (expected cosine is recoverable from the bit count), so
  ranking quality is preserved despite the loss of reversibility.

The session's actively poured accumulators are kept exact in a bounded float32
cache, so within-session accumulate-then-compare never round-trips through
either quantizer. The ANN index re-enters only when a halo's mass is small or
crosses a power of two (mechanism 7 below), at which point the durable 2-bit row
is decoded to float32, normalized, rotated, and re-encoded to 1-bit RaBitQ.

**7. Geometric re-index schedule (index-write viability).** A halo's _direction_
stabilizes as mass grows, so re-indexing it on every pour is waste. Halos
re-enter the index only when their mass is small or crosses a power of two —
O(log mass) index writes per node over its lifetime instead of O(mass) — while
the durable (quantized) row is always current.

**8. Counting instead of materialising (read viability).** Evidence questions on
the hot path ("how many distinct contexts predict this?", "how many learned
contexts exist?", "does this lead somewhere?") are answered by indexed counts
(`prevCount`, an incrementally-maintained distinct-source count for `corpusN`,
`hasNext`, `hasHalo`) — never by materialising corpus-sized edge lists. Full
materialising reads (`prev`, `parents`) exist for maintenance and inspection but
are kept off every hot path. The hub bound √N (§8.8) is enforced at the _store
level_: every fan-out read on the hot path uses a LIMITed variant
(`nextFirst(id, √N)`, `prevFirst(id, √N)`, `parentsFirst(id, √N+1)`,
`containersSlice(id, offset, √N)`) whose work is bounded by the cap regardless
of the actual fan-out size. A consumer that needs the full fan-out (the
consensus climb, §17) instead uses these to decide its question exactly — "does
this reach cross √N distinct contexts?" — without ever materialising a
corpus-sized list. The principle: **a per-query read must never grow with the
corpus.**

**9. Compaction on write-volume cadence (long-run viability).** Updates and
deletions in the vector indexes leave tombstones. After every configured volume
of index writes, an index whose physical size exceeds 2× its live size is
rebuilt from its surviving codes (lossless — the build is code-based).
Post-training, a batch pass can additionally remove index entries for
structurally isolated nodes (single-parent, no edges, no halo — they bridge
nothing), and a converse repair pass re-indexes bridges that were missed.
Failures of these best-effort passes are counted visibly, never silent.

### 13.2 The store's cost machinery, in pseudocode

```
# ── the intern ladder with its caches (§11.1, refined) ────────────────
intern(content, gist):                      # content = bytes | kidIds
    # 1. exact dedup: bounded LRU first, durable probe second — so dedup
    #    survives a cold cache (a resumed run still recognises old content)
    id ≔ dedupCache[key(content)] ?? durableFind(content)
    if id ≠ ∅:
        dedupCache[key(content)] ≔ id
        captureIfUnindexed(id, gist)        # keep the gist available for
        return id                           # lazy indexing (mech. 3)
    # 1b. content addressing across representations: a branch spanning the
    #     same bytes as a stored flat branch reuses that id
    if content is kidIds and their leaf-id flattening is a known branch:
        return that id (capture as above)
    # 2. near-dedup: BUFFERED whole-experience roots only — never an ANN
    #    probe (mech. 4); geometric proposal + byte verification (§11.1)
    if content is kidIds:
        best ≔ argmax over nearDedupBuffer of dot(gist, root.gist)
        if best ≥ MERGE and differsByOneWindow(content, best, W):
            return best.id
    # 3. mint
    id ≔ nextId++                           # dense ids; leaves are implicit
    write node row (flat-branch encoding when applicable — mech. 1)
    for each real child c:                  # (byte leaves get no parent
        insert kid edge c → id              #  rows — hub avoidance)
        if |parents(c)| just became 2:      # the 1→2 bridge transition
            indexGist(c)                    # promote NOW (mech. 3)
    pendingGist[id] ≔ gist                  # captured, not yet indexed
    maybeFlush()
    return id

# ── lazy index admission (mech. 3) ────────────────────────────────────
indexGist(id, dedupTarget = false):
    if id already indexed (session set, else one durable point query):
        return                              # a resumed run replays deposits
                                            # at read speed — no re-upserts
    v ≔ pendingGist[id];  if v = ∅: return  # evicted ⇒ retry on a future
                                            # encounter or repair pass
    contentBuffer += (id, v);  mark indexed
    if dedupTarget: nearDedupBuffer += (id, v)

indexSubtree(root):                         # fired by link() on both ends
    indexGist(root, dedupTarget = true)     # only the ROOT may be merged
    walk the subtree, pruning at already-classified nodes:
        indexGist(interior)                 # reach-only: partial queries
                                            # must resonate with interiors

# ── halo pour (mech. 6–7) ─────────────────────────────────────────────
pourHalo(id, addVec):
    indexGist(id, dedupTarget = true)       # a halo-bearer is a target
    acc ≔ exactCache[id] ?? dequantize(durableRow[id]) ?? 0⃗
    acc += addVec;  exactCache[id] ≔ acc    # exact in-session
    mass += 1
    durableRow[id] ≔ quantize2bit(acc), mass    # always current, 16× small
    if mass ≤ 4 or mass is a power of two:      # geometric schedule
        haloBuffer[id] ≔ normalize(acc)         # O(log mass) index writes

quantize2bit(v):                            # Lloyd–Max for unit Gaussian
    store ‖v‖ exactly; per coordinate: sign bit + |x| ≷ 0.9816·σ bit
    (σ ≔ ‖v‖/√D; decode to ±0.4528σ / ±1.5104σ, rescaled to ‖v‖)

# ── batching and compaction (mech. 5, 9) ──────────────────────────────
maybeFlush():
    if |contentBuffer| + |haloBuffer| ≥ batchSize: flush()

flush():
    merge containment buffer into packed rows
    upsert contentBuffer into the content index   (one batch)
    upsert haloBuffer into the halo index         (one batch)
    clear nearDedupBuffer                         (mirrors contentBuffer)
    commit the deferred write transaction         (one commit per batch)
    writtenSinceCompact += batch size
    if writtenSinceCompact ≥ compactEvery:
        for each vector index with physicalSize > 2 × liveSize:
            rebuild it from its live codes        (lossless; code-based)

# ── post-hoc maintenance (mech. 9) ────────────────────────────────────
compactContentIndex(minParents = 2):        # archived-store trade:
    remove entries with < minParents parents and no edges and no halo
                                            # they bridge nothing
repairContentIndex(regenerate, minParents = 2):
    for each branch node not in the index with ≥ minParents parents and
            (edges or a halo):
        re-perceive its bytes; add its gist to the index
```

Two summary facts fall out of this machinery. First, the _asymptotics_: storage
is O(distinct subtrees); the ANN index is bounded by the number of distinct byte
patterns that ever became resonance destinations (not by deposits, and not by
corpus volume — hash-consing sees to that); every per-deposit cost is a bounded
number of O(1) probes and amortized-O(1) buffered writes. Second, the
_degradation order_: under memory pressure or eviction, what is lost is always
acceleration (a duplicate probe, a re-perception, reduced resonance reach until
repair) and never identity, reconstruction, or an already-learned relation.

---

---

# Part IV — The inference pipeline

## 14. The shape of an answer

### 14.1 The pipeline at a glance

Every ask travels one road:

```
                        THE INFERENCE PIPELINE

  query bytes
      │
      │  perceive (same fold as ingestion — the query gets a tree & gists)
      ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │ RECOGNISE (§15)      every stored form the query contains          │
  │ COMPUTE   (§16)      every mechanism's parse() evaluates spans it  │
  │                      is authoritative for (arithmetic, logic, …)   │
  │ PRECOMPUTE           build Precomputed: recognition, computed      │
  │                      spans, the response's gist — shared,          │
  │                      response-scoped data every mechanism (and the │
  │                      post-grounding stages) read; every expensive  │
  │                      analysis (consensus climb, weave, span-shape) │
  │                      is a lazily-cached method, computed at most   │
  │                      once and only if some consumer asks           │
  └──────────────────────────────┬────────────────────────────────────┘
                                 ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │ GROUND — ONE lightest-derivation choice among UNIFORM mechanisms:  │
  │                                                                    │
  │   The pipeline sees every mechanism through the SAME               │
  │   PipelineMechanism interface (parse?/floor/run) — no branch       │
  │   anywhere names a specific mechanism or asks "is this an          │
  │   extension?".  Each mechanism's `floor` yields an admissible       │
  │   lower bound (or null when it structurally cannot fire); each      │
  │   `run` yields CANDIDATEs weighed in the one cost ladder (§8.9),    │
  │   and the lightest grounding derivation wins.  A candidate's        │
  │   weight is:                                                       │
  │                                                                    │
  │     moves  +  PASS · (query bytes the mechanism did not account    │
  │                       for — did not match against learnt           │
  │                       structure)                                   │
  │                                                                    │
  │   — PASS per unexplained byte is the cover's own price for a       │
  │     literal connective, so the primary axis is "which mechanism    │
  │     explains more of the query", and move costs (STEP per          │
  │     projection, CONCEPT per halo-mediated act) discriminate        │
  │     residually.  Ties keep the mechanism list's own order.         │
  │                                                                    │
  │   Admissible-floor pruning, uniformly:  `floor` is called for      │
  │   EVERY mechanism, every time; `run` only for one whose floor      │
  │   can still beat the incumbent.  A mechanism whose floor itself    │
  │   needs expensive precomputation to refine (CAST's weave          │
  │   alignment) checks the SAME incumbent, via a `worthRunning`       │
  │   predicate passed into `floor`, before paying for it — the        │
  │   pipeline's own pruning tool, exposed one level earlier, so no    │
  │   mechanism special-cases what beat it.                            │
  │                                                                    │
  │   The mechanisms, in list order (cover runs first: a computed       │
  │   span — from the ALU or any user extension — masks in at near-    │
  │   zero cost, so a cheap incumbent is established before CAST/       │
  │   confluence would otherwise invest in their own precomputation):   │
  │                                                                    │
  │   1. COVER      (§19)  the query's own decomposition composes an   │
  │                        answer — ONE lightest-derivation search;     │
  │                        computed spans (§16) mask colliding sites    │
  │                        and enter the search at zero cost            │
  │   2. CAST       (§18)  the query weaves ≥2 independent learned     │
  │                        structures → transfer structure between them │
  │   3. CONFLUENCE (§18.5) the query carries ≥2 independent           │
  │                        constraints → intersect their evidence       │
  │   4. EXTRACT    (§20)  a learned span-in-context skill reads the   │
  │                        analogous span out of the query              │
  │   5. RECALL     (§21)  whole-query resonance, four graded tiers     │
  │                        (…or NOTHING — silence below the reach bar)  │
  └──────────────────────────────┬────────────────────────────────────┘
                                 ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │ REASON (§22)   extend the grounded answer across facts, hop by hop │
  │ FUSE   (§23)   ground the query's OTHER points of attention and    │
  │                join them with learned connectors                   │
  │ ARTICULATE(§24) re-voice the result in the asker's own vocabulary  │
  └──────────────────────────────┬────────────────────────────────────┘
                                 ▼
  answer bytes  +  provenance  +  (optionally) the full rationale
```

The decider also emits three diagnostic signals — purely observational, never
affecting the decision itself:

- **Unexplained label** — every candidate carries `unexplained`, a
  human-readable label for the query bytes its evidence left on the table.
  Appears in the rationale trace; does not affect the weight (the PASS-per-byte
  pricing already accounts for it arithmetically).
- **Narrow decision** — when the winner beats the runner-up by ≤ 1 grade unit
  (⌊w/STEP⌋), the rationale records a `narrowDecision` step. A margin of 0 means
  the tie-break (the mechanism list's own order: cover, cast, confluence,
  extract, recall) decided — the answer could change with one more training
  fact.
- **Thin grounding** — when the winning candidate's density (fraction of query
  bytes actually accounted for by learnt structure) falls below `1/W` (the
  smallest fraction the store's perceptual window can discriminate), the
  rationale records a `thinGrounding` step. The answer stands; the label is a
  signal for downstream consumers that the grounding is sparse.

### 14.2 Design invariants of the pipeline

Four rules hold everywhere and are worth reading the rest of Part IV against:

1. **Uniform mechanisms, self-gating, weighed together.** Every grounding
   mechanism (CAST, confluence, cover, extraction, recall, the ALU, any user
   extension) implements the SAME `PipelineMechanism` interface — an optional
   `parse` (pre-loop computed spans), a `floor` (admissible lower bound), and a
   `run` (candidate answers). The pipeline (`think`) never imports a
   mechanism-specific type and never branches on which mechanism it is holding;
   adding or removing a mechanism means adding or removing one object from the
   list. Each mechanism checks its own _structural preconditions_ (does the
   query weave two structures? did a cover compose? is any anchor a skill
   exemplar?) inside `floor`/`run` and abstains when they fail — no mechanism
   runs on a query it cannot structurally explain. Every mechanism whose gate
   passes yields a candidate answer **weighed in the one cost ladder** (§8.9):
   its moves plus PASS per query byte it did not account for. The lightest
   grounding derivation wins — the same elementary decision the cover search
   makes among spans, lifted to the mechanism level. Ties keep the mechanism
   list's own order (cover, cast, confluence, extract, recall).

   `floor` is called for EVERY mechanism, every response, in list order, BEFORE
   any `run`; `run` is called only for a mechanism whose floor can still beat
   the incumbent (`worthRunning`). Every expensive analysis a floor might need
   (the consensus climb `pre.attention()`, the weave `pre.weave()`, span-shape
   classification) is a lazily-cached method on the response's `Precomputed`:
   computed at most once, shared by every consumer — mechanisms AND the
   post-grounding stages — and never computed at all if nobody asks (a query an
   extension decided outright never pays for a climb). The INVESTMENT DISCIPLINE
   closes the loop: `worthRunning` only gates `run` on the pipeline's side, so a
   `floor` that would first-touch an expensive analysis (CAST's climb + weave,
   which decide only whether its floor EXISTS — the number is always exactly
   2·STEP, never below) checks `worthRunning(cheapestBound)` first, and when
   that already fails it RETURNS THE BOUND uninvested — still admissible, and
   the pipeline's own check then prunes `run` and records the truthful "cannot
   beat incumbent" trace note. This is the same admissible-floor pruning the A\*
   search lives by, applied uniformly — no mechanism asks "did an extension
   already decide?"; it only ever asks "can I still beat what already won?", and
   cover running first in the list means a computed span's near-zero cost prunes
   everything after it the same way any other cheap incumbent would.
2. **Read-only store.** Asking never writes. All the memoization inference uses
   is per-response and is possible _because_ the store cannot change mid-answer.
3. **One guide.** The whole response shares the query's gist as its
   disambiguation guide, and shares its per-context choices, so every mechanism
   of one answer follows the _same_ reading of every ambiguous fact.
4. **Honesty outlets.** At every stage there is a sanctioned way to say less:
   mechanisms abstain when their structural preconditions fail, recall returns
   silence below the reach bar, an un-grounded echo is labelled as such, a
   missing connector joins pieces bare and says so in the trace.
5. **Bounded inference.** No per-query read grows with the corpus. Every fan-out
   walk is capped at √N, and the cap is enforced at the store level through
   LIMITed reads and indexed existence probes. The climb uses
   expand-until-decided: it stops the moment saturation or a concrete vote is
   determined, with work bounded by √N distinct contexts regardless of corpus
   size. The cost of answering a query is dominated by the query's own
   structure, not by how much the system has learned.

### 14.3 How the mind's mechanisms integrate

The pipeline of §14.1 shows the _order of execution_; this diagram shows the
_order of dependency_ — which mechanism is built on which. It is a strict
layering: every arrow points downward, a mechanism only ever calls mechanisms in
layers below it, and there are no cycles. (The layers correspond one-to-one to
the modules of the implementation; see AGENTS.md, "Where things live".)

```
             THE MIND'S MECHANISMS — DEPENDENCY LAYERS
     (arrows = "is built on"; every arrow points to a lower layer)

 L6  ORCHESTRATION      ┌───────────────────────────────────────────────┐
                        │ respond ─▶ think (the grounding decider, §14.1)│
                        │           ─▶ articulate                       │
                        │ rationale/trace: cross-cuts every layer       │
                        └──────┬───────┬──────────┬──────────┬──────────┘
                               │       │          │          │
 L5  GROUNDING &        ┌──────▼──┐ ┌──▼────┐ ┌───▼─────┐ ┌──▼──────┐
     POST-GROUNDING     │ cover   │ │ CAST  │ │ confl.  │ │ extract │
     (§18–§23)          │ (§19)   │ │ (§18) │ │ (§18.5) │ │ (§20)   │
                        └──┬───┬──┘ └──┬───┬─┘ └──┬───┬──┘ └──┬───┬──┘
                        ┌──▼───▼───────▼──────────▼──────────────▼──────┐
                        │ recall (§21) · reason (§22) · fuse (§23)     │
                        └──┬────────────────┬───────────────────┬──────┘
                           │                │                   │
 L4  QUERY-LEVEL        ┌──▼────────────────▼───┐   ┌───────────▼──────┐
     EVIDENCE           │ consensus climb (§17) │   │ graph search:    │
                        │ regions → votes →      │   │ the deduction    │
                        │ cross-region → pool →  │   │ system (§19.1–6) │
                        │ commit                 │   │                  │
                        └──┬──────────┬─────────┘   └──┬────────┬──────┘
                           │          │                │        │
 L3  MATCH & PROJECT    ┌──▼──────────▼────────────────▼───┐ ┌──▼──────┐
     (the elementary    │ match (§14.4):                   │ │ derive: │
     operation, §14.4)  │   matchers: locate · alignGraded ·│ │ A*LD    │
                        │             analogyStrength      │ │ engine  │
                        │   projections: follow ·          │ │ (§5)    │
                        │     conceptHop · reverseContext ·│ │         │
                        │     project                      │ │         │
                        ├───────────────────────────────────┤ └─────────┘
                        │ resonance (§19.5, §21, §22):     │
                        │ bridge (→ junction) ·             │
                        │ recallByResonance ·               │
                        │ pivotInto · meaningOf             │
                        └──┬──────────────┬────────────────┘
                           │              │
 L2  DECOMPOSITION      ┌──▼──────────┐ ┌─▼────────────────────────────┐
     & TRAVERSAL        │ recognition │ │ traverse: edgeAncestors ·    │
                        │ (§15):      │ │ nextOf/prevOf · contains ·   │
                        │ sites/      │ │ chooseNext / chooseAmong     │
                        │ leaves/     │ │ (§25) · hubCap (§8.8)        │
                        │ splits      │ │                              │
                        └──┬──────────┘ └─┬────────────────────────────┘
                           │              │
 L1  PRIMITIVES         ┌──▼──────────────▼────────────────────────────┐
                        │ perceive · gistOf · resolve · read (§10, §27)│
                        └──┬───────────────────────────────────────────┘
                           │
 L0  SUBSTRATE          ┌──▼───────────────────────────────────────────┐
                        │ the store: DAG (nodes, parents, containment) │
                        │ + edges + halos + the two vector indexes     │
                        └──────────────────────────────────────────────┘

 Sideways (same-layer) collaborations, all mediated by lower layers:
   · the ALU and any user extension are ORDINARY L5 mechanisms — the same
     `PipelineMechanism` shape as CAST, confluence, cover, extraction, and
     recall (§16). Only `parse()` (pre-loop, collected from every mechanism
     that implements it) makes them distinctive: its computed spans feed into
     cover's masking, which hands them INTO the L4 graph search as axioms —
     an extension never talks to another mechanism directly, and think never
     branches on "is this an extension?".
   · CAST, confluence, extract, and recall all consume the SAME memoised
     consensus climb (via the response's shared `Precomputed`); cover instead
     consumes recognition directly (its axioms are the query's own
     decomposition).
   · reason and fuseAttention run AFTER whichever grounding mechanism
     fired, and reuse its consumed-node set — the one piece of state that
     crosses between L5 mechanisms.
   · articulate re-enters the L4 graph search in substitution mode: the
     revoiced answer is itself a lightest derivation.
```

How to read the layers:

- **L0–L1** are the shared substrate every mechanism stands on: the store's
  exact relations, and perception as a pure function. Nothing above them touches
  bytes or vectors except through them.
- **L2** produces the two elementary readings of anything: _what stored forms
  does this byte string contain_ (recognition) and _what does this node connect
  to_ (traversal — raw edge reads, the two disambiguation regimes of §25, and
  the one √N fan-out cap of §8.8). The shared **junction** ascent belongs here:
  it climbs the DAG from content-addressed seeds to find containers holding two
  forms, serving both the bridge (L3) and cross-region attention (L4) from the
  same bounded, cached walk.
- **L3** is the elementary **match-and-project** operation (§14.4): the matcher
  family (graded locate, literal alignment, distributional analogy) and the
  projection family (forward fixpoint, concept hop, reverse context, and their
  composition), plus the resonance patterns built directly on them.
- **L4** holds the two big composite engines: the consensus climb (which turns
  L2/L3 readings into _pooled evidence_ through the derive engine's arithmetic
  semiring — voting each region independently, then recovering joint contexts
  through cross-region junction ascent), and the graph search (which turns them
  into a _cover_ through the tropical semiring). Both are clients of the same
  A\*LD engine — that is the sense in which all of Sema's thinking is one kind
  of computation. The junction ascent sits as a shared utility consumed by both
  L3 (the bridge's Tier 1 connector search) and L4 (cross-region attention's
  joint-context recovery).
- **L5** are the five grounding strategies plus the two post-grounding
  extenders. Their candidates are **weighed together** by the grounding decider
  of §14.1 — no fixed priority ladder; the lightest grounding derivation wins.
  Their _dependency_ structure is what the diagram shows — e.g. extraction
  depends on the climb (to find an exemplar) and on resonance (to locate
  frames), but never on cover or CAST. Confluence (like CAST) depends on the
  climb and on canonical window identity.
- **L6** is orchestration only: `think` sequences L5, `articulate` closes the
  loop, and the rationale tracer observes every layer without being depended on
  by any.

The layering is also the _isolation_ structure: a defect in one grounding
strategy cannot corrupt another, because they share nothing above L4 except the
memoised climb (read-only) and the consumed set (explicitly handed forward).

### 14.4 The elementary operation: match → project, under a gate

Every generalising mechanism in Part IV is a configuration of **one** elementary
operation:

> **Match** a learned structure against bytes under some _matching relation_,
> bind whatever did not match as the variable, then **project** along a learned
> relation in some _direction_ — accepting the result only past a derived
> **gate**.

The three parameters, and their complete value sets:

**The matcher** — how strictly "this query material IS that learned structure"
is decided, from strictest to loosest:

| Matcher                                | Decides by                                                                                                                                                  | Cost                                         | Used as                                                          |
| :------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------- | :--------------------------------------------------------------- |
| **exact**                              | content-addressed identity (the DAG)                                                                                                                        | O(1) probe                                   | recognition's sites; recall tier 0; the pivot's byte containment |
| **locate**                             | the graded ladder exact → halo → gist: literal bytes first, then distributional role (gate: concept threshold), then perceived gist (gate: merge threshold) | one resonance per relaxation                 | extraction locating an exemplar's frames in the query            |
| **aligned**                            | maximal literal runs by seed-and-extend over W-grams — every span two whole structures share, not one position                                              | O(\|a\|+\|b\|+runs)                          | CAST detecting the structures a query weaves                     |
| **distributional** (`analogyStrength`) | graded three-tier test: direct halo cosine, then mutual halo sibling, then shared learnt W-window frames (gate: significance bar)                           | ≤ 2 halo-index queries + O(\|a\|+\|b\|) scan | CAST validating a genuine analog                                 |

**The direction** — which learned relation the matched node is projected along,
and which way:

| Direction                      | Operation                                                                                             | Meaning                                                   |
| :----------------------------- | :---------------------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| **forward** (`follow`)         | walk continuation edges to the fixpoint; the first hop may cross a concept (halo) link                | "what does this lead to?"                                 |
| **reverse** (`reverseContext`) | the context this continuation follows — guide-resonance pick with a guide, halo-mass pick without one | "what establishes this?"                                  |
| **both** (`project`)           | forward, else reverse                                                                                 | the universal grounding step                              |
| **read-out**                   | read the query span the matched frame delimits                                                        | extraction: the variable comes _out_ of the query         |
| **insert**                     | place the matched filler into the learned structure's seat                                            | CAST substitution: the variable goes _into_ the structure |
| **substitute**                 | replace the matched form with its concept sibling's bytes                                             | articulation's revoicing                                  |

**The gate** — the derived threshold (§8) the match/projection must clear:
concept threshold for anything distributional, merge threshold for gist
identity, significance bar for analogy, reach threshold for accepting any final
answer, the consensus floor for a further point of attention. Never a tuned
constant.

Under this decomposition, the mechanism catalogue of Part IV reads as a
configuration table:

| Mechanism               | Matcher                           | Direction                | Gate                          |
| :---------------------- | :-------------------------------- | :----------------------- | :---------------------------- |
| cover follow-edge (§19) | exact                             | forward                  | — (cost ladder)               |
| concept hop (§19.3)     | halo sibling                      | forward                  | concept threshold             |
| recall tiers 0–1 (§21)  | identity / whole-query gist       | both                     | merge threshold               |
| skill extraction (§20)  | locate (on the exemplar's frames) | read-out                 | per-step ladder gates         |
| CAST substitution (§18) | graded (literal → halo)           | insert                   | frame (MIN_WEAVE + dominates) |
| CAST redirection (§18)  | graded (literal → halo)           | both (on the substitute) | frame (MIN_WEAVE + dominates) |
| CAST comparison (§18)   | graded + distributional           | reverse, juxtaposed      | significance bar              |
| multi-hop pivot (§22)   | exact (byte containment)          | forward                  | —                             |
| articulation (§24)      | halo sibling                      | substitute               | concept threshold             |

**Why this is stated here, prominently.** The machinery is factored exactly
once: the matcher and projection families are one shared family (with the one √N
fan-out convention beside the disambiguators), and each mechanism states _only
its configuration_. This is a standing architectural rule:

> **Before adding a new generalising mechanism, express it as a (matcher,
> direction, gate) triple.** If its matcher, projection, and gate already exist,
> the mechanism is a configuration — write only the configuration. If it
> genuinely needs a new matcher or a new direction, add that _to the shared
> family_ (with its gate derived in the geometry, §8), never as a private helper
> inside the mechanism. A mechanism file that re-implements locating, aligning,
> edge-following to a fixpoint, predecessor-picking, or fan-out capping is
> re-introducing the exact duplication this decomposition removed.

Two boundaries of the unification are deliberate, not omissions:

- **The cover search keeps its own internal edge-chain.** Inside the deduction
  system (§19), following an edge is a _rule application_ — one step of the
  proof tree, individually costed and traced. Collapsing it into the shared
  forward projection would erase the derivation's granularity and cross the
  synchronous/asynchronous seam (the search is synchronous; the projections may
  touch the ANN indexes). The two implementations of "follow an edge" are
  therefore one _concept_ with two _obligations_: proof-grained inside the
  search, fixpoint-grained outside it.
- **Arbitration between mechanisms is one lightest-derivation decision.** The
  grounding decider (§14.1) weighs every mechanism's candidate in the one cost
  ladder, so a mechanism-level choice and a byte-level choice are the same kind
  of decision. Ties (at STEP resolution — sub-STEP costs like MICRO are
  non-ordering bookkeeping and must not decide a cross-mechanism choice) keep
  the mechanism list's own order (cover, cast, confluence, extract, recall) —
  cover runs first not because it is prioritised over the others by fiat, but
  because a computed span (§16) masks in at near-zero cost, which then prunes
  the rest through the SAME admissible-floor mechanism every mechanism is
  subject to (§14.2), not a special rule.

### 14.5 The free-will architecture

The grounding decider is not a priority ladder with a special-case branch for
every mechanism. It is a **market**: mechanisms produce candidates, each priced
in one currency, and the lightest wins. This works because every mechanism obeys
four constraints that are the same constraints a budgeted reasoner — human,
language model, or automated deduction engine — must obey to be composable:

**1. Decoupling.** A mechanism imports nothing from other mechanisms — and
implements exactly the same `PipelineMechanism` shape as every other one, so the
pipeline imports nothing mechanism-specific either. CAST does not know
extraction exists. Extraction does not know confluence exists (or that an
extension might have fired). Each receives `ctx`, `query`, and the response's
shared `Precomputed` (recognition, computed spans, the gist — plus lazily-cached
methods for every expensive analysis a mechanism opts into: the consensus climb,
the weave, span-shape classification, the identity-window reads), and returns a
candidate or nothing. Adding a mechanism never touches an existing mechanism
file.

**2. Declared competence.** A mechanism gates itself with a structural
precondition — a binary, auditable condition, not a learned score — inside its
own `floor`. CAST checks `query.length < 2W`. Extraction checks whether any
ranked anchor is span-shaped. When a mechanism does not fire, the rationale says
exactly why. A mechanism whose floor needs its own expensive precomputation to
refine also receives `worthRunning`, so declaring "structurally impossible" and
declaring "cannot beat the incumbent, don't bother computing further" cost the
same: nothing.

**3. Visible budget.** Every loop over corpus-scale data is capped at a named
constant: `k = 2·recallQueryK` for the alignment loop, `√N` for every fan-out
walk. The cap is enforced at the store level through LIMITed reads and indexed
existence probes. No per-query cost grows with the corpus.

**4. Evidence travels with the answer.** Every candidate carries `accounted`
(what it explained), `moves` (what its acts cost), and `unexplained` (what it
left on the table). The decider does not know which mechanism produced which
candidate — it only sees weights in the one cost ladder.

These four constraints are the same structural principle that makes a
budget-limited reasoner honest. A language model has a context window (visible
budget), stops when it converges (declared competence via early-stopping),
reports its chain of thought (evidence traveling with the answer), and composes
with tools via structured output schemas (decoupling). The architecture is the
same. What Sema calls `√N`, a model calls `max_tokens`. What Sema calls
`admissible floor`, a model calls `skip-if-unpromising`. What Sema calls
`unexplained`, a model calls `I don't know`.

The difference is that Sema's caps are **derived** from the system's own
geometry (D, W, N) rather than chosen by an external budget. A mechanism's
admissible floor is computed from the memoised climb before the mechanism runs.
A fan-out cap is `Math.ceil(Math.sqrt(corpusN))` — the point at which further
evidence no longer discriminates. The principle is the same; the derivation is
internal.

---

## 15. Recognition: decomposing the query

Recognition answers: _which stored forms does this byte string contain, and
where?_ Its output — the **sites** (span → node), the query's perceived
**leaves**, and the **split** positions where a form boundary falls inside a
leaf — is the raw material of every downstream mechanism.

Two complementary readings run over the query:

### 15.1 The structural reading

Perceive the query (the same fold as ingestion) and walk its own tree, asking
the store, bottom-up, to name each subtree: leaves by their bytes, branches by
their children's ids. Because perception is deterministic, any part of the query
that was ever deposited _as it appears here_ folds into the identical subtree
and is named exactly. Additionally, within each leaf-parent chunk, every
contiguous sub-run of leaves is probed, so forms smaller than a chunk are found
too.

### 15.2 The canonical reading

The query's own fold may cut the stream differently from how training cut it
(different surroundings ⇒ different group boundaries). The canonical reading
re-derives the _store's_ segmentation directly on the query's bytes: at each
position, chain the known single-byte leaves forward and probe each growing
sequence as a flat branch — recovering forms _as training stored them_,
regardless of how the query's tree happens to chunk. Where such a form's
boundary falls strictly inside one of the query's leaves, that position is
recorded as a **split**: the search may later cut the leaf there (§19.4).

### 15.3 What counts as a site

A recognised span is admitted as a site only if its node **leads somewhere** —
it bears a continuation edge or a halo. A form that leads nowhere contributes
nothing to any derivation, so recognition filters it out at the source.

```
recognise(query):
    sites, leaves, splits ← ∅
    # structural
    tree ← perceive(query)
    for each subtree s of tree (bottom-up, with byte offsets):
        id ← store lookup of s (leaf bytes / branch kid-ids)
        if id exists and (next(id) ≠ ∅ or halo(id) ≠ ∅):
            sites += (span(s), id)
        collect leaves; probe sub-runs within leaf-parents likewise
    # canonical
    for each position p in query:
        chain known leaves from p; for each chained prefix that is a known
        flat branch, resolve its span and admit it as above
    splits ← form boundaries that fall inside a perceived leaf
    return (sites, leaves, splits)
```

Everything here is a bounded number of O(1) content-addressed probes per byte —
never a scan of the corpus.

---

## 16. Computation: extensions and the ALU

### 16.1 Manual rules beside learned ones

Some knowledge is _rules_, not facts: nobody should teach a memory system
arithmetic one sum at a time. Sema accommodates this with **extensions**:
`PipelineMechanism`s (§14.1, §14.2) whose distinguishing feature is `parse` —
consulted once per query, before the grounding loop, over EVERY mechanism that
implements it. An extension's `parse` receives the raw query and returns
**computed spans** — byte ranges it recognises as computations, together with
the authoritative result bytes for each. The mind lends every extension the same
four neutral capabilities it already has (resonant meaning-matching, grounded
continuation lookup, geometric segmentation, and the perception window W)
through the `ExtensionHost` port; it learns nothing about what the extension
computes.

An extension joins through `Mind`'s `mechanismFactories` option: a factory
receiving the `ExtensionHost` and returning a `PipelineMechanism`. Once
constructed, it is indistinguishable to the pipeline from CAST, confluence,
cover, extraction, or recall — same `floor`/`run` shape, same admissible-floor
pruning, same weight ladder. The ONLY place its computed spans get special
treatment is cover's masking (§16.3), which is a property of cover's own `run`,
not of the pipeline singling out "extensions" as a concept.

### 16.2 The ALU

The built-in extension — wrapped into a `PipelineMechanism` by `aluToMechanism`
and appended to the mechanism list at `Mind` construction (`cfg.alu.enabled`) —
is a small **arithmetic–logic unit** built the way a mathematician would want
it: an irreducible kernel — one logic gate (NAND), the field-and-order
primitives (0, 1, add, negate, multiply, reciprocal, sign), one limit operator
(converge-to-tolerance), and three structural list operations (construct,
length, project) — from which everything else (comparison, powers, roots,
calculus, equation solving, map/reduce over nested lists, element-wise
broadcasting) is _derived by rewriting_, not separately implemented. It parses
infix notation directly, and can also recognise an operation _by meaning_ — a
span whose gist resonates with a registered operation's learned anchor — using
the host's resonance capability. Results are computed exactly (or to declared
tolerance) and deterministically rendered to bytes.

### 16.3 Masking: computation always wins

A computed span enters the cover search (§19) as a recognised completion at the
cost of one inference step — an authoritative _derived fact_, on par with
following a learned edge. Precedence over memory is enforced not by cost but by
**masking**: any recognised site that overlaps a computed span is removed before
the search, so within those bytes the computation is the only available
completion. A corpus deliberately taught "2+2 → 5" therefore cannot outvote the
ALU on "2+2", while remaining free to associate whatever it likes _around_ the
computation — a computed result and an unrelated learned rewrite still compose
within one answer.

---

## 17. The consensus climb: points of attention

### 17.1 The problem: what is this query about?

Several mechanisms need to know which learned context(s) a query is _about_ —
especially when the query's wording matches nothing directly (scaffolding words
dominate), or when it is about _two things at once_. The consensus climb answers
this with the machinery already on hand: geometry proposes, structure climbs,
and pooled weighted deduction decides.

### 17.2 The algorithm

```
climbAttention(query, k):

  # 1. REGIONS — TWO sources, both structural:
  #    a) PERCEIVED SUBTREES of the query (every branch level of the river
  #       fold).  A region that dominates the query (covers more than half)
  #       is admitted only if it is the sole structure.
  #    b) RECOGNISED SITES — content-addressed nodes the query literally
  #       contains (§15).  A site IS an exact structural anchor; perceived
  #       sub-regions are approximate (W-byte chunks whose gist must resonate
  #       to find an anchor).  Sites fill the gap perception creates: a word
  #       crossing a W-boundary is split into chunks whose partial gists may
  #       not resonate distinctively, but the site names the whole word by
  #       exact content identity.  Sites that overlap sub-regions add
  #       corroborating evidence; sites in gaps fill them.
  #       Recognition is memoised per response — adding sites costs zero.
  regions ← subtrees of perceive(query)  ∪  recognise(query).sites

  # 2. VOTE — each region finds its best anchor in the DAG and climbs to
  #    the edge-bearing contexts ("roots") that contain it.
  #    Perceived sub-regions resonate their gist into the content index;
  #    site-regions already carry an exact node id and skip the ANN query
  #    entirely — they climb directly from the resolved node.
  #    The climb uses EXPAND-UNTIL-DECIDED (§17.4): it stops the moment the
  #    answer (saturated vs. voted, with exact contextsReached) is known —
  #    all reads through it are LIMITed at √N, so the cost is bounded by the
  #    hub convention, never by the corpus.
  for each region r:
      anchor ← r.nodeId ?? (canonical chunk id ?? contentIndex.nearest(gist(r), k)[0])
      # contrastive-margin gate: for APPROXIMATE regions only, the gap
      # between the best and second-best score must exceed the estimator
      # noise floor (§8.4); otherwise the region abstains
      if not r.known and (bestScore − secondBestScore) ≤ NOISE: ABSTAIN
      reach ← expandUntilDecided(anchor):
                for each level: check prevCount (indexed O(1)) to decide
                "edge-bearing?" without materialising prev lists; read
                parentsFirst(√N+1) — getting √N+1 proves "hub" exactly;
                containment parents page via containersSlice(offset, √N)
                so a common window's climb stops at the first saturated
                page; distinct contexts past √N decide "saturated" by an
                indexed count, never a materialised list.
      if anchor climbs nowhere and is not saturated:
          try the remaining hits, nearest first          # ranking is
                                                          # approximate; an
                                                          # orphan top hit is
                                                          # an accident
      if saturated: the region ABSTAINS                   # §17.4
      mutual ← mutualExplanation(score, region, anchor)   # angle + magnitude
      w ← mutual · ln(N / contextsReached) / |roots|      # IDF weighting
      the region votes w for each root it reached

  # 2b. CROSS-REGION — voteRegions climbs each region INDEPENDENTLY;
  #     additive pooling can only surface contexts at least one region
  #     already votes for.  Two regions whose individual climbs land on
  #     DIFFERENT contexts ("red" → `red square`, "circle" → `circle`)
  #     leave their JOINT context (`red circle`) with no vote — no amount
  #     of pooling can recover it.  Cross-region attention recovers it by
  #     the SAME content-addressed junction ascent the bridge uses
  #     (the shared junction ascent):
  #
  #     Candidate regions: ANY voted region composes — not just recognised
  #     sites (corpus independence).  At least one side must be a STRONG
  #     voter (individually discriminative).  A known but non-voting region
  #     may serve as the WEAK side (a word never learnt standalone still
  #     binds through its stored byte fragments).  Two non-voting regions
  #     never pair (the shared-prefix trap).  Only MAXIMAL spans compose
  #     (a span contained in another candidate is not independent of it).
  #     A single known region covering both is skipped — the whole form
  #     already votes directly.  Byte-sorted left-to-right.
  #
  #     junctionSeeds are precomputed ONCE per candidate across all its
  #     pairs (cost hoisting).  The junction ascent is ORDER-FREE (a
  #     junction is evidence the forms were learnt together; which one the
  #     query mentioned first is a fact about the query, not the learnt
  #     whole — the byte-containment test probes both orders).  All reads
  #     go through the shared per-response walkCache.
  #
  #     N-ARY SELECTION: the container covering the MOST remaining
  #     candidate forms wins (then tightest interior, then lowest id).
  #     A consumed candidate never re-pairs — its evidence is already
  #     composed at full joint strength.
  #
  #     SELF-EVIDENCE GUARD: a container whose joined occurrence (left
  #     through right including interior) is a literal substring of the
  #     query is rejected — shards of a contiguous phrase pairing "around"
  #     a gap chunk would merely rediscover the phrase they are shards of.
  #
  #     EXPLAINING AWAY: when a junction binds, any individual vote whose
  #     bytes the joint container LITERALLY CONTAINS yet whose roots are
  #     FULLY DISJOINT from the junction's is SUPERSEDED — the exact joint
  #     evidence explains those bytes away (grid aliasing).  Partial
  #     agreement (shared roots) corroborates and is kept.
  crossVotes ← []
  superseded ← ∅
  seedsOf(ri) ≔ junctionSeeds(ctx, query[regions[ri].start..regions[ri].end])
                # computed once, reused across all pairs of this candidate
  consumed ← ∅   # a candidate in one junction never re-pairs
  for each pair (a, b) of eligible candidates (non-overlapping,
         at least one strong voter, not both covered by one known region,
         ≤ k total probes, skipping consumed candidates):
      left  ← query[a.start..a.end]
      right ← query[b.start..b.end]
      containers ← junctionContainersFrom(left, right, cap,
                    seedsOf(a), seedsOf(b), undefined, unordered = true)
      if containers is empty:
          # Tier 2.5 fallback — same ascent over halo siblings
          containers ← junctionSynonyms(left, right, maxInterior,
                        unordered = true)
      if containers not empty:
          best ← the container covering the MOST remaining candidates
                 (cachedRead + indexOf per extra, never an extra walk);
                 ties → shortest interior → lowest id
          if best's joined occurrence is a query substring: continue
          reach ← edgeAncestors(best.id)
          if reach is discriminative (not saturated, idf > 0):
              w ← mutual · ln(N / contextsReached) / |roots|
              crossVotes.push(vote for best.id's roots at weight w,
                              span covering all composed candidates)
              consumed.add(a); consumed.add(b); consumed.add(all extras)
              # Explaining away: individual votes whose bytes the container
              # literally contains and whose roots are fully disjoint from
              # the junction's are superseded
              for each individual vote rv:
                  if rv.roots shares any root with reach.roots: keep
                  if containerBytes literally contains rv's query bytes:
                      superseded.add(rv)
      break  # a is consumed — move to next unconsumed candidate

  # 3. POOL — votes (INDEPENDENT, minus any superseded by cross-region
  #    evidence, + CROSS-REGION) accumulate through the
  #    arithmetic semiring (§5.3): each region is an axiom; each
  #    (region → anchor) contribution is a summing rule; a vote for a
  #    TERMINAL answer node redistributes to the ≤ √N contexts that lead
  #    to it (via prevFirst, capped at the store level). Independent
  #    corroboration ADDS.
  votes ← pooledConclusions

  # 4. COMMIT — rank anchors by vote. The dominant anchor always stands.
  #    A FURTHER (non-overlapping) anchor becomes an independent point of
  #    attention only if its vote clears BOTH:
  #      · the natural break (the steepest ratio drop in the sorted votes —
  #        a scale-free "where does signal end" test), and
  #      · the consensus floor ln N + ½ (§8.6 — more than any single
  #        region could contribute alone).
  return the surviving points, each with its query span and vote
```

### 17.3 Why inverse document frequency

A region that climbs to few contexts is _specific_ — strong evidence about what
the query concerns. A region that climbs to half the corpus (a common phrase)
says almost nothing. Weighting a region's vote by ln(N/c) — the classical
inverse-document-frequency form (Spärck Jones 1972) — expresses exactly this,
with N the store's count of learned contexts, and dividing by the number of
roots reached splits a region's voice among the candidates it cannot
distinguish.

The geometric factor is not the raw resonance score but a **mutual-explanation
weight** that reads both angle and magnitude (§2.6). Under the linear fold,
cosine = shared / (‖region‖ · ‖hit‖), and each unnormalized norm is recoverable
as a byte count (the region's own span length; the hit's, read from the store).
Splitting the cosine by each side's own magnitude gives two fractions — how much
of the _region_ the hit explains, and how much of the _hit_ the region pins down
— each capped at 1 (an estimated cosine can imply more shared content than the
smaller side even holds; left uncapped, that impossible surplus would let a
small region echoing inside a large context, or the reverse, vote above its
physical evidence). The product of the two capped fractions is the mutual weight
that replaces a bare score: it is exactly the same quantity a plain squared
cosine approximated implicitly (score² ≈ (shared/len_region)·(shared/len_hit)
when the two sides are close in size), made explicit and safe at every scale.
The margin gate that precedes this weighting (§17.2, the noise-floor check
before the vote is computed) stays in raw cosine units deliberately: it tests
the RaBitQ estimator's own noise floor, which lives in cosine space, not in
byte-magnitude space.

### 17.4 Saturation: expand-until-decided

The climb's work is bounded by **expand-until-decided**: the walk stops as soon
as it knows whether the reach is saturated (the material is too common to
discriminate) or a concrete vote (exact roots and contextsReached). The decision
uses only LIMITed store reads:

- **Is this node edge-bearing?** `prevCount` — an indexed O(1) count — answers
  "does this node follow at least one learned context?" without materialising
  the (potentially corpus-sized) predecessor list.
- **Is this node a hub?** `parentsFirst(id, √N+1)` — reading √N+1 parents proves
  "more than √N" exactly; the walk aborts at that step. Below √N, the read IS
  the full parent list, so the walk is exact.
- **Distinct contexts past √N?** If the set of learned contexts visited crosses
  √N, the region is saturated — decided by a set-size check, never by counting
  every reachable context.
- **Containment paging.** A window's containers are paged in chunks of √N via
  `containersSlice`. A distinctive window's containers (few, converging on one
  context) are walked in full — exact. A common window's corpus-sized container
  list is abandoned at the first page whose climbs push contexts past √N, with
  O(√N) page-work.

A region whose climb triggers any of the "decided: saturated" conditions
abstains rather than vote noise. Saturation is also _recorded_: a leading
saturated stretch of the query (a boilerplate preamble) is treated as
scaffolding, and further points of attention are only admitted beyond it. The
dual use — abstain from voting, and mark scaffolding — is what keeps long
templated queries from diluting their own payload.

### 17.5 What consumes the climb

The climb is computed once per response (memoised) and consumed by five
mechanisms: recall's scaffolding tier (§21.3), extraction's search for a skill
exemplar (§20), CAST's identification of woven structures (§18), confluence's
constraint-stream detection (§18.5), and fusion's grounding of further topics
(§23). The cross-region attention pass (§17.6) also runs inside the climb,
consuming its region votes and the junction module.

### 17.6 Cross-region attention: the binding problem

Additive pooling has a blind spot. Two regions whose independent climbs land on
_different_ contexts leave their **joint context** — the learnt whole that
contains both — with zero votes. "red" votes for `red square`, "circle" for
`circle`; nothing votes for `red circle`, the only fact holding both. No amount
of pooling can recover it: addition can only amplify what at least one region
already said. This is the attention counterpart of the binding problem —
independent evidence disaggregates what belongs together.

Cross-region attention recovers the missing joint contexts by the **same
content-addressed junction ascent** the bridge uses (§19.5), extracted into the
shared junction ascent. "Which learnt whole contains these forms?" is a bounded
DAG ascent from the forms' canonical identities — not a resonance guess on a
synthesised gist.

**Why not fold the two vectors?** Folding two region gists cannot even
reconstruct the stored joint form. Sema builds a multi-word gist from byte-chunk
folds, so isolated word vectors superpose into a different direction and
resonate to `red circle` and `red square` indistinguishably. The junction ascent
sidesteps this by matching **bytes** (content-addressed identities), not
vectors.

**Candidate selection — corpus independence.** Candidates are ANY region that
participated in the independent vote, not only recognised sites. At least one
side of each pair must be a **strong** voter (individually discriminative — idf

> 0, non-saturated). A **known** (content-addressed) region that did _not_ vote
> (saturated, or idf ≤ 0) may still serve as the **weak side** of a pair whose
> other side voted: saturation is an abstention about where the region _climbs_;
> the junction asks a different question — "which whole holds both?" — and the
> container's own idf gate still guards the conclusion. This is **corpus
> independence**: a word never trained standalone has no site, but its stored
> chunks still vote and their bytes still compose — the ascent matches byte
> containment, so a fragment pair evidences the same joint container the whole
> word would.

Two disciplines prevent this openness from becoming noise:

- **Two non-voting regions never pair.** That is exactly the shared-prefix trap:
  ascending from two non-discriminative fragments can land on an
  incidentally-unique descendant container, manufacturing confidence the query
  gave no reason to have. At least one side must be individually discriminative.
- **Only maximal spans compose.** A span wholly contained in another candidate
  is a fragment of that candidate's evidence, never independent of it.
  Contiguous shards of one word that are both covered by a single known region
  are skipped — the whole form already votes directly, and re-deriving it from
  its own pieces would only double-count.

Pairs are byte-sorted left-to-right; searches are capped at k probes total.

**Cost hoisting.** Junction seeds are computed once per candidate for the whole
pairing loop (a candidate recurs in up to |cand|−1 pairs, and its seeds are a
pure function of its bytes). All reads go through a shared per-response walk
cache — one response issues many walks whose ancestries overlap heavily, so
every identity read is a cache hit instead of a durable read or byte
reconstruction.

**Order-free binding.** The junction ascent is order-free: a junction is
evidence the two forms were learnt _together_; which one the query happened to
mention first is a fact about the query, not about the learnt whole. The walk is
identical (the seed ascent does not depend on order) — only the byte-containment
test gains a second probe, so order-freedom costs two `indexOf` calls per
visited node, never a second walk. The test also accepts overlapping or abutting
occurrences: two grid-aligned fragments of one whole ("red " at 0 and " cir" at
3 in `red circle`) legitimately overlap inside it. A strict-super-form
requirement applies (the container must be longer than either side alone):
holding both must be more than restating either side.

**N-ary binding.** Binding is not intrinsically pairwise. When a pair's
containers are found, each container is tested against every _remaining_
unconsumed candidate form: the container covering the **most** of the query's
composable forms (by total byte length of contained extras) wins, with ties
going to shortest interior then lowest id. This means three cross-cutting
attributes — where every pair is ambiguous across two contexts — resolve to
their unique triple, at the cost of one cached byte read + `indexOf` per
(container, extra), never an extra walk. A consumed candidate (one whose
evidence is already composed in a junction) never re-pairs — its evidence is
already at full joint strength, and re-pairing would vote the same container
twice.

**Self-evidence guard.** A container whose joined occurrence (left through right
including its interior) is literally a substring of the query is rejected.
Binding is only evidence when the query mentions the forms _apart_. Without this
guard, shards of a contiguous phrase ("s pa" + "d by" around "inte" in "was
painted by") pair to rediscover the phrase they are shards of, then explain away
its rivals — breaking multi-candidate tests where the query legitimately weaves
several exemplars.

**Explaining away — the aliasing complement of corpus independence.** A chunk of
the query can straddle the byte grid so that it exists verbatim in the _wrong_
deposit (" cir" of "red then circle" is a stored chunk of `blue circle`, never
of `red circle` — a pure alignment accident) and its independent climb then
votes for a context the query gives no reason to believe. When a junction binds,
any individual vote whose bytes the joint container **literally contains** AND
whose climb roots are **fully disjoint** from the junction's is **superseded**:
the exact joint evidence explains those bytes away, so their disagreeing vote is
grid aliasing, not signal. A vote sharing even one root with the junction
_corroborates_ it (partial agreement — a different slice of the same context)
and is kept. Votes whose bytes the container does not hold at all (a genuine
second topic) are untouched.

**Graded ladder.** The junction ascent follows the same evidence discipline as
the bridge: Tier 1 (exact containers of the two forms themselves, order-free)
first; only when it finds nothing does Tier 2.5 (synonym junctions — the same
ascent over halo siblings of one side, sharing one expansion budget across all
sibling walks) run as a fallback. Exact evidence outranks distributional
approximation; a synonym junction can never override an exact one.

**Voting.** A joint container is **exact** evidence — it literally holds the
composed forms — so it votes at full strength (score = 1, no estimator).
Weighting uses the same mutual-explanation and IDF discipline as single-region
votes, with the combined byte length of all composed candidates as the region
size. The combined pool (independent, minus any superseded by cross-region
evidence, + cross-region) means a joint context with no single-region support
can still become a point of attention when its combined evidence clears the
consensus floor (§8.6).

---

## 18. Grounding I — counterfactual transfer (CAST)

### 18.1 When it applies

Some queries do not ask about one learned thing; they _weave together several_ —
"what if X had Y's property?", "compare X and Y", a sentence that grafts one
learned frame onto another's subject. CAST (Counterfactual trAnSfer) detects the
weave by **graded alignment** — the same evidence ladder as `locate()`: literal
W-gram runs first, then distributional role (halo-matched recognised sites
filling gaps where the query has no literal coverage). It transfers structure
between the woven parts. CAST is the byte-level, formalized descendant of
case-based reasoning's _adaptation_ step (Kolodner 1992).

Preconditions (all structural, per invariant §14.2): the query is at least two
perception windows long; the climb (§17) ranks at least two anchors; aligning
the anchors' contexts against the query (below) leaves at least two anchors with
_free_ aligned runs; the dominant anchor is a committed point of attention; and
at least one aligned run falls **outside every recognised site** — the
definition of "woven": material from a learned structure appearing where
recognition's normal reading has no account of it. If any of this fails, CAST
returns null — the grounding decider considers the remaining candidates.

### 18.2 Graded alignment

Alignment follows the same graded-evidence ladder as `locate()` (§14.4):
**literal first, then distributional role.** For each ranked anchor:

1. **Literal** — `alignRuns`: W-gram seed-and-extend. Every W-gram of the query
   is indexed; each W-gram of the context that matches seeds a run, extended
   greedily in both directions; overlaps resolved longest-first. Weight = 1.0
   (exact match is full evidence).

2. **Halo** — where the query has **no literal coverage** from this anchor,
   recognised sites with halos are matched to the exemplar context's own
   recognised sites via `bestHaloMate` (gate: `conceptThreshold`). A query site
   whose halo resonates with a context site above the bar produces a run with
   `cs` = the context site's structural byte position and `weight` = the cosine
   itself (measured evidence, not an invented constant).

The per-byte depth `depth[i]` is the **sum of weights** of aligned structures
covering byte `i` — a byte covered by two literal runs has depth 2.0; a byte
covered by one literal (1.0) and one 0.7-halo run has depth 1.7. The `cs`
(position in the context) is a real byte offset regardless of run kind, so the
substitution and redirection schemas work unchanged on conceptual alignment.

### 18.3 Frame gate

Both components of the frame gate are **derived from the weave itself**, not
tuned:

1. **MIN_WEAVE** — the minimum number of aligned structures to form a weave: the
   same `2` that gates CAST entry (`points.length < 2`). Frame requires evidence
   **beyond** the minimum pair — a third structure agreeing — so the depth gate
   is `depth[i] > MIN_WEAVE`. One definition, two uses.

2. **Half-dominance** — `dominates(part, whole)` (§8.7), the same test
   `collectRegions`, `liftAnswer`, and confluence's filler gate all use. A byte
   is frame when `dominates(depth[i], aligned)` — the structures covering it are
   a majority of all aligned structures. A run is usable when the framed bytes
   are NOT a majority: `¬dominates(framedCount, runLen)`.

In full:

```
frame(i)      ⇔  depth[i] > MIN_WEAVE  ∧  dominates(depth[i], aligned)
usable(qs,qe) ⇔  ¬dominates(framedCount(qs, qe), qe − qs)
```

The frame gate is the canonical example of **weave-local commonality** (§8.10):
`aligned` counts the structures aligned with _this query_, not the corpus. The
choice of reference set is load-bearing — replacing the weave-local majority
with corpus-global IDF misfires on reordered single-fact queries. See §8.10 for
the general theory and the full table of which mechanism uses which measure.

### 18.4 Three transfer schemas

Each schema is tried independently — every one that fires contributes its own
candidate to the grounding decider, with its own `accounted` (the runs of
exactly the points that schema used, not the whole weave's alignment) and
`moves`. The decider's weight comparison replaces CAST's former internal
priority order.

**Substitution** — _the query puts a new subject into a learned structure's
seat._ Detected when one structure's run starts mid-context (its head — the seat
— is displaced) and another structure, wholly present earlier in the query, fits
that seat. The answer is built by projecting the displaced structure onto the
new filler: filler + (learned connector if one exists, §19.5) + the displaced
structure's tail, then following the projected structure's continuation if it
adds something new.

**Redirection** — _the query names a substitute for the thing the dominant
structure is about._ Detected when the latest-positioned structure's run starts
at its context's very beginning (it is wholly, freshly named), and none of the
dominant anchor's own continuations appears in the query (its usual answer is
displaced). The answer is the substitute's own grounded fact: the named thing's
knowledge replaces the displaced structure's.

**Comparison** — _the query juxtaposes two entities of the same kind._ Candidate
analogs are the non-dominant points (and their continuation targets, which often
name the entity a long exemplar sentence is about). The gate is **analogy
strength** (§4.2), a graded three-tier test: (1) the direct halo cosine between
dominant and candidate, thresholded at the significance bar; (2) failing that,
the strongest _mutual_ halo sibling — two things are analogous if they keep
company with the same third things; (3) failing that, **shared-frame strength**
— a structural tier that measures what fraction of the shorter side's bytes are
covered by a learnt W-window that also occurs in the longer side (two sentences
sharing " is " measure as analogs even when their halos never overlapped). If no
candidate passes any tier, a deterministic structural fallback picks the
best-evidenced genuine hub among the candidates. The answer voices each analog
by the context that establishes its role, joined by a learned connector when one
exists.

Whatever CAST produces, the anchors it consumed are marked as such, so the
reasoning stage (§22) does not re-walk the same facts. Each schema reports its
own `accounted` — the runs of exactly the points that schema transferred
between, not the whole weave's alignment. `castFloor` pre-computes the consensus
climb (memoised per response, zero extra cost) and returns `null` when the climb
cannot possibly support a weave; when non-null, its ranked anchors are reused by
the alignment loop, eliminating a redundant second climb call. Every candidate
also carries `unexplained` — a human-readable label for the query bytes CAST
left unexplained (§14.1).

---

### 18.5 Confluence Join — the meet of independent constraints

#### When it applies

Some queries carry two or more _independent constraints_ — "Which material is
translucent and featherlight?" — where each constraint reaches its own set of
exemplars, and the entity satisfying both lives exactly where those sets
**intersect**. No single-fact mechanism can answer this: any one evidence path
grounds only one constraint, and fusion concatenates one fact per constraint
from _different_ entities (wrong answer). Confluence detects independent
constraint streams and intersects them by content-addressed identity.

Preconditions (all structural): the query is at least two perception windows
long; the consensus climb (§17) ranks at least two anchors; at least two of them
hold disjoint discriminative query windows (they are _independent_ constraints,
each answering a different part of what was asked); and the intersection of
those anchors' content — the **meet** — contains at least one discriminative
span (content reaching a corpus minority of contexts, per the half-dominance
convention).

#### The meet is native, not a byte scan

The store is content-addressed: any content two deposits share IS the same node
id, interned once at write time (hash-consing). So "what do these two facts have
in common?" is a **set intersection of identities** the write side already
computed, asked through the canonical window read — `windowIds` (§9), the same
write/read contract recognition runs on. Three identity/structure tests make the
whole mechanism:

1. **Constraint streams.** The consensus climb's ranked anchors, each bound to
   the query spans whose _discriminative_ windows it holds by identity (a
   resonance-voted anchor holding none of the query's discriminative content is
   no constraint at all). Two streams are independent when the content they bind
   is disjoint.

2. **The meet.** Window ids present in _both_ anchors and _absent from the
   query_: shared-with-query windows are the constraint being re-named (or its
   scaffolding), so subtracting the query's own window ids leaves exactly the
   content the question asks _for_ — the open seat.

3. **Filler/scaffolding separation.** The same structural IDF the climb derives
   (`reachOf`, §9): shared content reaching a corpus minority of contexts is an
   entity (a filler); content reaching a majority is frame scaffolding. No
   statistics, no learning — the same global-quantity-from-capped-local-probes
   reading that makes the climb's IDF work, pointed at a new question.

The meet thus names content that _byte-literally exists_ in two independently
learnt exemplars. An empty intersection yields null and the ordinary pipeline
decides — confluence cannot fabricate.

#### Evidence for the grounding decider

Confluence reports the query spans whose constraint content the two streams hold
by identity (`accounted`), its acts (`moves`: two constraint matches + one meet
= 3×STEP), and `unexplained` — a human-readable label for query bytes outside
those spans (§14.1).

---

## 19. Grounding II — cover: the graph search

The cover is the heart of the system: **one lightest-derivation search (§5) that
composes an answer out of the query's own decomposition**. All of "retrieval",
"rewriting", "multi-part answers", and "synonym use" are individual _rules_ of
this one search.

### 19.1 Items

Three kinds of item populate the deduction system:

- **Cover(p)** — "the query is covered from position 0 up to p". The axiom is
  Cover(0); the **goal is Cover(len(query))**.
- **Form(i, j, node)** — "the node `node` names the query span [i, j)". A form
  is a _foothold in the graph_: rules walk out of it.
- **Out(i, j, bytes)** — "the span [i, j) will be answered by these bytes". An
  out may be _recognised_ (a grounded completion — essentially free to cover) or
  a _literal_ (unrecognised query bytes carried through at PASS cost).

### 19.2 Axioms

- Cover(0), at cost 0.
- One Out per perceived leaf of the query (its own bytes, literal) — the
  covering fabric.
- One Form per recognised site (§15) — the graph entry points.
- One recognised Out per computed span (§16), at STEP cost.

### 19.3 Rules

Stated abstractly (costs from the ladder, §8.9):

```
BRIDGE      Cover(i) ∧ Out(i, j)            → Cover(j)
            cost: ε if the out is recognised; PASS·(j−i) if literal.
            The frontier advances; literal connectives (spaces, commas —
            anything unrecognised) are CARRIED, so the asker's own linking
            material survives between rewritten parts.

FOLLOW-EDGE Form(i, j, n)                    → Form(i, j, n′)   cost STEP
            where n ──▶ n′ is a learned continuation edge. With several
            continuations, the disambiguator (§25) picks n′.

CONCEPT-HOP Form(i, j, n), n edge-less       → Form(i, j, s′)   cost CONCEPT
            where s is a halo sibling of n above the concept threshold and
            s ──▶ s′ — answering through a synonym, one order dearer than
            a literal edge. (Siblings are pre-resolved before the search,
            since index queries are asynchronous.)

GROUND      Form(i, j, n), n terminal, reached via edges
                                             → Out(i, j, bytes(n))  cost 0
            The chain's endpoint becomes answer bytes for the span. Before
            emitting, RECOMPLETION (§19.6) may resolve deeper.

SPLIT       Out literal, containing a split position k (§15.2)
                                             → the two halves     cost 0
            The query's own chunking is not sacred; a form boundary the
            store knows can cut a leaf.

FUSE        Out(i, j) ∧ Out(j, k) adjacent    → Out(i, k)          cost 0
            The concatenation may name a known node (by content-addressed
            lookup: as a short leaf; as the branch of the two sides'
            nodes; or by canonical re-perception when a side is a
            completed rewrite). If it does, also:

RECOMPOSE   the fused pair                    → Form(i, k, node)   cost 0
            Two already-rewritten parts fusing into a node that itself
            continues is a RECOMPOSITION: its onward FOLLOW-EDGE is free,
            so the consolidated whole strictly beats leaving the parts
            split. A guard requires the fused node to be halo-bearing —
            i.e. learned as a meaningful unit, not an accidental interior
            chunk of some one-shot phrase.

SPLICE      Out(recognised L) ∧ Out(recognised R), a learned connector
            exists between L's and R's answers  → Out(L+connector+R)  cost 0
            (§19.5. Fires only when the gap between them is empty or
            wholly recognised — never across the asker's own literal
            separator, which BRIDGE carries instead.)
```

The A\* heuristic is ε per uncovered byte beyond an item's right edge —
admissible because ε is the minimum per-position cost, and what keeps the search
output-sensitive (§5.2, §8.9).

### 19.4 What the cost ladder buys, concretely

- Coverage dominates: the search _must_ account for every byte, and prefers
  recognising to carrying.
- A literal continuation beats a synonym's (STEP < CONCEPT); either beats
  leaving a span unrewritten (≪ PASS).
- Free fusion/recomposition means the search always finds the _deepest
  consolidated reading_: if "D E" recomposes into a learned "DE" that continues
  to F, the answer is F, not "D′ E′".
- Ties resolve by the fixed conventions of §25 — deterministically.

### 19.5 Connectors: learned joins (the bridge)

When an answer has several parts, what belongs _between_ them? Sema asks the
store through a **graded junction ladder** — exact evidence before approximate,
the same discipline as `locate` (§14.4). The junction search is extracted into
one shared procedure so that both the bridge (a connector between answer pieces)
and cross-region attention (§17.6, the joint context of query regions) ascend by
the same bounded, cached walk:

1. **Junction containers, by content-addressed identity.** Hash-consing means
   "which learned wholes ran L and R together?" is a structural question, not a
   similarity guess: any deposit containing L's bytes shares L's node (or L's
   canonical-window identities), so ascending the DAG's parent and containment
   links from the two sides reaches every containing whole _exactly_, under the
   one √N fan-out discipline. A container whose bytes literally hold L and then
   R yields the bytes between them as the **connector** ("and", ", ", " is the
   opposite of " — whatever the corpus actually joins such things with).
2. **Edge junctions.** A continuation edge _is_ junction information: a learned
   continuation of L that contains R carries the glue as its prefix; a learned
   context of R that contains L carries it as its suffix. An _empty_ interior
   found this way is a confirmed adjacency — returned as such, never confused
   with a miss.
3. **Synonym junctions.** The content-addressed junction search applied to halo
   siblings of the two sides: when L or R has no direct junction, one of its
   distributional siblings may. Container evidence stays exact (same DAG ascent
   as tier 1, with window-id-enhanced seeds); the relaxation is only in which
   form occupies one side.
4. **Resonance** (the last resort): the gist of the bare concatenation is
   resonated into the content index and the nearest containment-passing form
   supplies the connector — approximate, but it still reaches containers whose
   identity links are absent or saturated.

When several junctions qualify, the **response guide** (the query's gist — the
same disambiguator every projection uses) picks by resonance; ties prefer the
shortest interior (a junction should not insert unnecessary glue), then the
lowest node id (deterministic — a property of the corpus, not the seed). No
learned evidence at any tier ⇒ no connector invented.

Connectors are pre-resolved for the query's adjacent site pairs (and for
first-to-later pairs of longer groups), then handed to the search, where SPLICE
applies them inside the derivation — so multi-part answers are assembled as one
globally-coherent whole, not stitched afterwards.

### 19.6 Recompletion: answers that resolve deeper

A followed edge may land on a _composite_ node that leads nowhere as a whole
(say, "p1 p2") yet whose parts each continue. Before emitting such a node as
terminal, the search **re-covers the node's own bytes** — the very same solve,
recursively: recognition, edges, fusion, recomposition. If that inner cover
produces something new that itself names a learned node, the deeper completion
becomes the answer for the span. Recursion needs no depth cap: a node already
being recompleted is not re-entered (cycle guard), node identities are finite,
and finished recompletions are memoised — so chains run exactly as deep as the
graph licenses, and stop.

### 19.7 Reading out the answer

The finished derivation's chosen spans, left to right, are the cover.
**Lifting** extracts the answer from the asker's framing: if one span is
recognised, its bytes are the answer (unless it dominates — covers more than
half of — the query, in which case the whole cover is kept); with several,
everything from the first to the last recognised span (inclusive of carried
connectives between them) is kept, and the unrecognised framing outside is
dropped.

---

## 20. Grounding III — extraction by skill

### 20.1 Skills are facts with a shape

Nothing in ingestion marks anything as a "template". But some learned facts
_have a shape_: the answer is literally a span of the context (or a few pieces
of it), and the context is the frame around it — e.g. ("The Mona Lisa was
painted by Leonardo da Vinci.", "Leonardo da Vinci"). Such a fact is a
**span-in-context exemplar**, and it can be _applied_ to fresh text: find where
the exemplar's frame appears in the query, and read out the analogous span. This
is instance-based learning in its purest form (§1.1): the stored episode itself,
unmodified, functions as the rule.

Span-shapedness is read at two deliberately different strengths, and they are
not interchangeable:

- **OPEN reading** (exemplar acceptance): the answer is a sparse subsequence of
  the context — bytes in order, arbitrary gaps. Permissive, so a multi-piece
  answer stitched from several context runs validates. Used to _accept_ an
  exemplar candidate.
- **STRONG reading** (answer decomposition): a greedy longest-run decomposition
  into contiguous pieces. Greedy-longest is strictly stronger than subsequence
  (a long late match can consume context an earlier shorter choice needed), so
  an accepted exemplar can still fail to decompose — the mechanism then falls
  through to recall. Used to _read pieces out_ of the query.

### 20.2 The algorithm

```
extractBySkill(query):
    ranked ← climbAttention(query).ranked          # §17 — every voted anchor
    exemplar ← the first ranked anchor that is span-shaped:
        context ← the anchor's bytes (or, for a terminal answer node, the
                  longest span-shaped context among ≤ √N of its
                  predecessors; query-gist resonance breaks length ties)
        answer  ← its continuation
        span-shaped ⇔ answer is a contiguous span of context, a recognised
                      subtree of it, or an ordered sparse subsequence
                      (a multi-piece answer)
    if none: return ∅                # no skill applies; decider moves on

    runs ← decompose the exemplar answer into its pieces within the context
    for each piece:
        framePre  ← up to W bytes of context before the piece
        framePost ← up to W bytes after (or the next piece's pre-frame)
        locate framePre / framePost in the QUERY — by exact bytes first,
            else by halo resonance (the frame's distributional role
            matches a query form), else by gist resonance against the
            query's segments                         # graded matching, §4
        the query bytes between the located frames are this piece's analog
    answer ← the concatenated analogs
```

The demo in the README is this mechanism: three "X was painted by Y" examples
make ("…was painted by …", painter) a span-shaped exemplar; the unseen
sentence's frames locate; the analogous span — a painter never taught as an
answer — is read out of the query itself.

Extraction reports its **elementary evidence** for the grounding decider: the
located frame occurrences in the query (the matched evidence), plus the read
span itself when it is **bounded on both sides** — both the pre-border and
post-border frames were located, so the read is structurally delimited and its
content is a consequence of that match. An open-ended read (the answer reaches
the context's end, with no right border located) is NOT accounted — it is the
variable being read without a closing delimiter, priced by exclusion through the
`unaccounted` bytes the decider charges at PASS each. The act is costed at one
CONCEPT (the skill is an analogy) plus one STEP per accounted span.

This is the mechanism's defining asymmetry. Extraction reads an unknown by
structural analogy to a known exemplar: the frames prove "this query has the
same shape as this skill" (matched evidence). When both borders are located, the
span between them is structurally explained (we know both _where_ and _that_ it
should be read); an open-ended read is structurally explained only on one side
(we know _where_ to start but not _where_ to stop) — it is the content-novel
variable being read, priced the same way the cover's unrecognised literals are:
at PASS each. Counting a bounded read as unexplained would let a single-frame
extraction tie-weight with mechanisms that genuinely explain more of the query.

The same discipline applies to recall's consensus tier (§21): the climb's vote
explains exactly the query region whose evidence carried the winning point of
attention (`Attention.start`–`end`), not the whole query. A consensus vote for
"ice" among scaffolding does not explain the word "steel".

The decider thus prices each mechanism's _actual_ explanatory work — never the
bytes it reads out: counting an open-ended read as accounted would let
extraction outweigh mechanisms (e.g. CAST on a reworded single-fact question)
whose aligned runs are real structural evidence while the extraction's open seat
is merely copied. `extractionFloor` pre-computes the consensus climb (zero extra
cost) and returns `null` when no anchor exists; when non-null, its ranked
anchors are reused by `extractBySkill`, eliminating a redundant climb call.
Every extraction candidate carries `unexplained` — a human-readable label for
query bytes its frames did not cover (§14.1).

---

## 21. Grounding IV — recall by resonance

Recall handles queries whose own decomposition composed nothing: resonate the
_whole query's gist_ and ground the nearest learned form. It is the most
fallback-like mechanism — its weight carries the full PASS·|query| for most
tiers, so it can only win as the sole grounding (the honest price of an
ungrounded answer) — but it participates in the same decider as every other
mechanism. Four tiers, each gated on structural evidence, orderly degrading from
exactness to an honest echo.

#### The asymmetry of forward and reverse

The deduction system (§5, §19) is a **forward** engine: its rules (FOLLOW-EDGE,
CONCEPT-HOP, FUSE, SPLICE) all move from premises toward conclusions in the
direction of the learned edges. There is no backward rule — no inference step
that consumes a conclusion to produce a premise. This is not an omission; it is
the formalism: a derivation is a directed hyperpath from axioms to a goal, and
the cost ladder prices each forward step. A reading against the edge direction —
`reverseContext`, which asks "what establishes this?" rather than "what does
this lead to?" — produces bytes but no derivation. It explains nothing about the
query in the forward direction the search operates in.

The grounding decider expresses this exactly: reverse readings get
`accounted = []` (nothing matched against learnt structure in the forward
direction), so their weight is the full PASS·|query| plus a STEP — the most
expensive grounding, available when nothing composes forward, impossible to
prefer when anything does. The decider _derives_ this from the evidence the
formalism itself declares: a backward step carries no explanatory weight.

Every tier grounds through the shared projections of §14.4: `reverseContext` for
the reverse cases, `project` (forward-else-reverse) for the rest — recall owns
no grounding machinery of its own.

**Tier 0 — exact self-match (content-addressed).** If the query _resolves_ — it
is literally a stored node — answer with the context that predicts it (the
reverse projection; among several predecessors, the query gist picks by
resonance). This tier never consults the ANN index: identity is exactly
decidable, and an estimated score must never stand in for it (§6.2). The
grounding is a pure reverse reading: `accounted = []`, `moves = STEP`. The
decider prices this honestly: a reverse reading is the designated last resort,
never a peer of forward evidence.

**Tier 1 — clean resonance.** If the top hit's estimated score clears the merge
threshold (§8.1), the query essentially _is_ a learned form: `project` tries
forward first (to the continuation fixpoint), then reverse (to the establishing
context). A forward grounding accounts for the _whole_ query (identity-grade
match, `accounted = [[0, query.length]]`); a reverse reading accounts for
nothing. Cost: one STEP either way.

**Tier 2 — scaffolding-dominated.** If the top score clears only the
significance bar (§8.3) — real but diluted, typically because shared boilerplate
dominates the gist — run the consensus climb (§17) and ground its dominant
anchor, provided the anchor's pooled vote clears the consensus floor (§8.6).
Accounts for exactly the query spans whose evidence carried the winning point of
attention — not the whole query. Cost: one CONCEPT (the climb is a halo-mediated
act).

**Tier 3 — last resort.** This tier is gated on the **fraction of the query the
grounding explains**, not the raw cosine (§2.6). Root gists are unit vectors,
but under the linear fold cosine = shared / √(len_query · len_grounding), so the
raw cosine of a query fully contained in a much longer grounded answer is
√(len_query / len_grounding) — a number that shrinks the longer the honestly-
containing answer is, and would refuse a perfectly good containment while
letting a same-length answer that shares only scaffolding pass. Converting the
cosine into `cos · √(len_grounding / len_query)` — a query-relative fraction —
measures exactly what the reach bar is supposed to mean: how much of THE QUERY
the store accounts for, regardless of how much longer the matched form is.

Walk the hits nearest-first and ground the first one whose query-relative
fraction clears the reach threshold (§8.2). Failing that: if even the nearest
hit's fraction is _below_ the reach threshold, **return nothing** — the store
holds nothing related. Otherwise return the nearest form's own bytes verbatim,
explicitly flagged as an **echo**: within reach, but not a grounded fact — it
accounts for nothing and carries no move cost, so it can only win as the sole
grounding (the honest price of an ungrounded answer). The flag travels in the
response's provenance (§26) so a confident-looking parrot is always
distinguishable from an answer. Each tier also carries `unexplained` — a
human-readable label for the query bytes its evidence left on the table (§14.1)
— appearing in the rationale trace alongside `accounted` and `moves`.

---

## 22. Reasoning: the multi-hop chain

Grounding produces a _first_ answer; reasoning asks what that answer _implies_,
iteratively:

```
reason(query, answer, consumed₀):
    if the query itself is some context's learned continuation:
        return answer            # echo guard: hopping forward from an
                                 # answer-shaped query would chain through
                                 # the very fact that produced it
    consumed ← consumed₀         # everything grounding already spoke for,
                                 # expanded through halo siblings (synonyms
                                 # of consumed nodes are consumed too)
    repeat up to K times:
        1. FORWARD ABSORB: if the current answer resolves to a node with an
           unconsumed continuation, follow it (guided, §25) to its fixpoint
           and absorb — the answer is itself a learned fact; state what it
           leads to.
        2. else PIVOT: find the longest unconsumed learned CONTEXT whose
           bytes the answer literally CONTAINS (candidates proposed by
           resonating the answer's subtree gists and by exact recognition;
           confirmed only by byte containment — resonance alone never
           hops).  Follow the pivot's continuation.  If none: stop.
        mark the followed fact and its neighbours consumed
    return the fixpoint
```

The consumed-set discipline is what makes the chain _progress_: each hop must
bring in a fact not already spoken for, so the walk cannot circle, and the same
content is never restated. This is how "The Weeping Woman was painted by Pablo
Picasso" continues onward to what the store knows _about Picasso_: the extracted
answer contains the learned context "Pablo Picasso", whose continuation is the
Cubism fact.

---

## 23. Fusion: multi-topic answers

If the query carries several independent points of attention (§17) — and the
grounded answer was _not_ drawn from the query's own text (extraction already
spans all its pieces; fusing would add noise) — each further committed point
grounds its own answer, and the pieces are joined in query order, with a learned
connector (§19.5) between each adjacent pair where one exists. A missing
connector joins the pieces bare and records the degradation in the trace. Thus
"ice fire" (two topics) becomes "cold hot" — or "cold and hot", if the corpus
ever joined such answers with "and".

---

## 24. Articulation: answering in the asker's words

The final pass adjusts _voice_, not content. The asker's query is decomposed
into its recognised, halo-bearing forms — the asker's _vocabulary_. Each
recognised form of the answer whose halo resonates (above the concept threshold,
§8.5) with one of the asker's forms is a concept the two express in different
words; the answer's wording is substituted with the asker's. The substitutions
are spliced by the same cover search (§19), run over the _answer_ with
substitute emissions as the only rules — so voicing is a derivation too, subject
to the same composition discipline (and traced like everything else).
Single-byte forms are excluded on principle: a one-byte form's halo keeps
company with everything, so it licenses spurious substitutions. If the revoiced
cover does not compose, the answer stands unchanged.

---

## 25. Disambiguation: choosing among alternatives

Learned knowledge is plural: a context may have many continuations; a
continuation may follow many contexts. Sema's choices among them follow two
fixed regimes — and which regime applies is a matter of _direction_:

- **Forward (which continuation?): structural evidence.** Candidates are often
  short spans whose gists are dominated by accidental byte correlations, so
  geometry is _not_ consulted. The winner is the candidate predicted by the most
  **distinct contexts** (diversity of independent evidence), tie-broken by
  **halo mass** (sheer episodic repetition), then by insertion order
  (first-learned). Candidates are capped at the hub bound √N.
- **Reverse (which context?): geometric evidence.** Candidate contexts are whole
  learned experiences — long enough that their gists are semantically meaningful
  — so the winner is the context whose gist best resonates with the query's gist
  (again capped at √N). Without a query in flight, the most-corroborated
  (highest halo mass) context wins.

Two response-wide conventions (invariant §14.2): every mechanism of one response
consults the same query-gist guide and shares one memo of picks, so an ambiguous
fact reads the same everywhere in the answer; and all tie-breaks bottom out in
fixed, corpus-determined orderings — never in anything nondeterministic.

Both regimes, and the √N cap they share, are defined exactly once: `corpusN` →
`hubBound` (≥ 2, the count of contexts the cap reads from) is the numerical
bound passed to the store's LIMITed reads (`nextFirst(id, hubBound)`,
`prevFirst(id, hubBound)`); `hubCap` is the list-side reading of the same
convention. The forward regime lives inside `chooseNext` (called by the shared
`guidedFirst`, which merges guided-pick with the first-inserted fallback into
one LIMITed read), and the reverse regime inside `chooseAmong` — both consumed
by every mechanism only through the shared projections (`follow`,
`reverseContext`, `project`). The store's existence probes (`hasNext`,
`hasHalo`) answer "does this lead anywhere?" without materialising edge lists.
No mechanism can drift onto a private disambiguation rule, and no per-query read
grows with the corpus.

---

## 26. Auditability: provenance and the rationale

Sema's answers carry their epistemology with them, at two grains:

**Provenance** — every response is tagged with the mechanism that grounded it:
`cast`, `join`, `cover`, `extract`, `recall`, or `recall-echo`. The `join` tag
means the answer was produced by intersecting independent constraint streams
(confluence, §18.5) — a conjunctive query where no single fact holds the answer.
The `recall-echo` tag is the honesty flag of §21's tier 3: the bytes are a
stored form returned verbatim for being _near_, not a derived fact. A consumer
can gate on this tag mechanically.

**Rationale** — on request, the response includes the complete replayable trace:
every mechanism's entries and exits, and — at the finest grain — every rule
application of the lightest derivation itself (each FOLLOW-EDGE, CONCEPT-HOP,
FUSE, RECOMPOSE, SPLICE, BRIDGE, and pooled vote, with its premises, conclusion,
local cost, and data-flow edges to the steps that produced its premises). This
is a direct serialization of the proof tree of §5.4: the answer _is_ this
derivation, so the trace is not instrumentation bolted onto an opaque process —
it is the process.

Together with determinism (same store + same query ⇒ same answer, always), this
yields the property regulated and safety-critical settings actually require: any
output can be reproduced exactly and attributed to enumerable stored facts and
rules.

---

---

# Part V — The whole algorithm in pseudocode

## 27. End-to-end pseudocode

This section restates the entire system as one connected program, at a level of
detail sufficient to reimplement it. Notation: `≔` binds; `∅` is empty; D, W, N
as in §8; thresholds by their §8 names. Store operations (`resolve`, `next`,
`prev`, `parents`, `halo`, `resonate`, …) are as defined in Parts I–III.

### 27.1 Shared primitives

```
# ── geometry (VSA, §2) ────────────────────────────────────────────────
alphabet[b]          ≔ deterministic unit vector for byte b (recursive
                       refinement 16→64→256, seeded)
π₀ … π_{S−1}         ≔ fixed independent random permutations (the keyring)
fold(v₀ … vₖ)        ≔ Σᵢ πᵢ·vᵢ                     # NOT normalized — only
                                                    # a fold's finished ROOT is
                                                    # (§2.6): interior gists
                                                    # keep a byte-proportional
                                                    # magnitude, ‖·‖ ≈ √len
companySignature(id) ≔ seeded random unit vector from `id`
                       # halo pours use identity-based signatures, not gists
resonance(a, b)      ≔ cosine(a, b)
contentLen(id)       ≔ the byte length recoverable from a stored gist's own
                       (unnormalized) magnitude, or the store's exact record
                       of it — the linear fold's ‖·‖ ≈ √len read backward
fracOfQuery(cos, otherLen, qLen) ≔ min(1, cos · √(otherLen / max(1, qLen)))
                       # converts a raw cosine into a query-relative fraction
                       # of shared content (§2.6, §21)

# ── perception (§10) ──────────────────────────────────────────────────
perceive(bytes):
    leaves ≔ [ node(bytes = bᵢ, gist = alphabet[bᵢ]) ]
    p ≔ longest proper prefix already known as a stored leaf-sequence
    level ≔ leaves
    while |level| > 1:
        partition level at the item containing offset p (if p > 0)
        within each partition, fold complete groups of W;
            carry incomplete trailing items up unchanged
        if nothing folded (stall): force-fold in groups of W
        level ≔ the folded row
    normalize(level[0].gist)           # ONLY the finished root — every
                                       # interior gist keeps its raw,
                                       # byte-proportional magnitude (§2.6)
    return level[0]                    # tree: every node has gist + kids/bytes

gistOf(bytes)   ≔ perceive(bytes).gist
resolve(bytes)  ≔ intern-lookup of perceive(bytes), bottom-up:
                  leaves by findLeaf, branches by findBranch(kidIds);
                  null the moment any part is unknown
read(node)      ≔ concatenation of the node's leaf bytes, left to right

# ── thresholds (§8) ───────────────────────────────────────────────────
MERGE  ≔ 1 − 1/√D          REACH ≔ 1 − 1/(2W)      SIG ≔ 3/√D
NOISE ≔ 1/√D               CONCEPT_BAR ≔ ½ + 1/(2√D)
FLOOR(N) ≔ ln N + ½        HUB(N) ≔ ⌈√N⌉
DOMINATES(pLen, wLen) ≔ pLen·2 > wLen               # half-dominance (§8.7)
corpusN ≔ max(2, edgeSourceCount)                   # N floored at 2 (§8.8)
```

### 27.2 Ingestion

```
ingestPair(context, continuation):
    (ctxTree, ctxRoot, ctxIds, changed) ≔ deposit(context, tracked)
    (conTree, conRoot, _, _)            ≔ deposit(continuation, untracked)
    link(ctxRoot → conRoot)
    for part in changed:
        pourHalo(ctxIds[part], π₁·companySignature(conRoot));  massOf(part) += 1
        pourHalo(conRoot,      π₀·companySignature(part));    massOf(conRoot) += 1
    # link/pour lazily admit both subtrees' interiors to the content index

deposit(input, tracked):
    tree ≔ perceive(flatten(input))
    for node in postorder(tree):
        id(node) ≔ intern(node)                       # §11.1 ladder:
                                                      # exact-dedup →
                                                      # byte-verified near-
                                                      # dedup → mint (+ the
                                                      # child→parent edges)
    intern sliding windows of W and W−1 leaves as flat branches;
        containment-link each to the chunks it overlaps          # §11.3
    intern the whole stream as one flat branch                   # §11.3
    changed ≔ tracked ? maximal-new-subtree(tree, previousDeposit) : [tree]
    return (tree, rootId, ids, changed)
```

### 27.3 respond

```
respond(input):
    query ≔ flatten(input)
    guide ≔ gistOf(query)             # the response-wide disambiguation guide
    thought ≔ think(query)
    if thought = ∅: return SILENCE
    answer ≔ articulate(thought.bytes, query)                    # §24
    return (answer, thought.provenance [, rationale])

think(query, mechanisms ≔ defaultMechanisms):
    rec ≔ recognise(query)                                       # §15

    # Phase 1 — parse: EVERY mechanism that implements it (only computational
    # ones do — the ALU, any user extension) contributes computed spans
    # BEFORE any floor()/run() is called.  No mechanism-specific branch: the
    # pipeline just asks "does this one have parse?".
    computed ≔ ⋃ mech.parse(query) for each mech in mechanisms with parse

    # Phase 2 — the shared precomputation container, response-scoped, read
    # by every mechanism's floor/run AND by the post-grounding stages:
    guide ≔ gistOf(query)
    pre   ≔ Precomputed(rec, computed, guide, k)      # eager fields only.
            # Every EXPENSIVE analysis is a lazily-cached method:
            #   pre.attention()      — the consensus climb (§17)
            #   pre.weave()          — graded alignment over ranked anchors
            #   pre.spanShapedOf(a)  — per-anchor skill classification
            #   pre.windowsOf(a) / pre.queryWindows / pre.reachMemo — the
            #                          content-addressed identity reads
            # Computed at most once, shared by every consumer; NEVER computed
            # if no surviving mechanism asks — a query an extension decided
            # outright never pays for a climb.

    # ── Phase 3 — Grounding: ONE lightest-derivation choice among UNIFORM
    # mechanisms.  Every mechanism implements the SAME PipelineMechanism
    # shape (floor, run); think never imports a mechanism-specific type and
    # never branches on which one it is holding.  Each yields a CANDIDATE
    # weighed in the one cost ladder (§8.9).  A candidate's weight is:
    #
    #     moves  +  PASS · unaccounted(query, accounted)
    #
    # — moves is the ladder cost of the mechanism's acts (STEP per projection/
    # locate, CONCEPT per halo-mediated act); unaccounted counts query bytes
    # NOT covered by the union of accounted spans.  PASS per unexplained byte
    # is exactly the cover's own price for a literal connective.
    #
    # Weights are compared at STEP resolution (grade ≔ ⌊w/STEP⌋): sub-STEP
    # costs (MICRO) are non-ordering bookkeeping.  Grade TIES keep the
    # earlier candidate — the mechanism list's own order (cover, cast,
    # confluence, extract, recall — see defaultMechanisms).

    best ≔ ∅
    grade(w) ≔ ⌊w / STEP⌋
    unaccounted(spans) ≔ query.length − total bytes covered by the union of spans
    weigh(accounted, moves) ≔ moves + PASS · unaccounted(accounted)

    consider(c):
        if c.bytes.length = 0: return
        if best = ∅ or grade(c.weight) < grade(best.weight): best ≔ c

    worthRunning(floor) ≔ best = ∅ or grade(floor) < grade(best.weight)

    # `floor` runs for EVERY mechanism, every time, in list order — BEFORE
    # `run` is even considered.  `worthRunning` gates `run`.  A mechanism
    # whose floor itself needs expensive precomputation to refine (CAST's
    # weave alignment: existence only, the number is always 2·STEP) receives
    # `worthRunning` too, and checks ITS OWN cheapest possible floor against
    # the incumbent before paying for that precomputation — the same
    # admissible-floor economy, applied one level earlier, uniformly.  cover
    # runs FIRST in the list: a computed span masks in at near-zero cost, so
    # by the time CAST/confluence ask worthRunning, a cheap incumbent may
    # already have pruned them — not because they know "an extension fired",
    # only because they know "the incumbent is cheap".
    for mech in mechanisms:
        floor ≔ mech.floor(ctx, query, pre, worthRunning)
        if floor = ∅: continue                          # structurally can't fire
        if not worthRunning(floor): continue             # can't beat the incumbent
        for r in mech.run(ctx, query, pre):
            consider({ bytes: r.bytes, provenance: r.provenance ?? mech.provenance,
                       weight: r.weight ?? weigh(r.accounted, r.moves),
                       used: r.used, accounted: r.accounted,
                       unexplained: r.unexplained })

    if best = ∅: return ∅
    # ── Diagnostics (observational, never affect the decision) ──────────
    if |candidates| > 1 and runnerUp exists:
        margin ≔ grade(runnerUp.weight) − grade(best.weight)
        if margin ≤ 1: emit narrowDecision trace with both candidates
    density ≔ |union(best.accounted)| / query.length
    if density < 1/W: emit thinGrounding trace

    (answer, provenance, consumed) ≔ (best.bytes, best.provenance,
                                       best.used ?? ∅)

    # ── Post-grounding ──────────────────────────────────────────────────
    consumed ≔ per provenance: cast.used | join.used | sites of
               recognise(answer) | ∅ (recall/recall-echo consume nothing)
    # cast and join pre-consume their own consumed set for reasoning
    answer ≔ reason(query, answer, consumed)                     # §22
    if provenance ∈ {recall, recall-echo}:
        answer ≔ fuseAttention(query, answer)                    # §23
    return (answer, provenance)
```

### 27.4 The cover search (grounding II, §19)

```
coverMechanism.run(query, pre):                 # rec, computed read from pre
    sites ≔ rec.sites minus any site overlapping a computed span   # masking §16.3
    connectors ≔ resolveConnectors(sites)      # §19.5, async pre-resolution
    concepts   ≔ resolveConcepts(sites)        # halo siblings with edges,
                                               # for edge-less sites (§19.3)
    solved ≔ lightestDerivation( system(query.len, sites, concepts,
                                       rec.leaves, rec.splits,
                                       connectors, computed) )
    if solved = ∅: return ∅
    segs ≔ solved.segs
    answer ≔ liftAnswer(segs)                  # §19.7
    # accounted = RECOGNISED cover spans only (PASS-carried bytes are priced
    # in `cost`; the diagnostic `unexplained` label reflects the same distinction)
    accounted ≔ [s.span for each span s in segs where s.rec]
    return { bytes: answer, cost: solved.cost, accounted,
             unexplained: unexplainedLabel(query, accounted) }

system(L, sites, concepts, leaves, splits, connectors, computed):
    axioms:  Cover(0)@0;  Out(leaf)@0 ∀ leaves;  Form(site)@0 ∀ sites;
             Out(computed, recognised)@STEP ∀ computed
    goal:    Cover(L)
    h(item): ε · (L − rightEdge(item))         # admissible (§8.9)
    rules(item):
      Cover(p):    BRIDGE across every coverable Out starting at p
                     — ε if recognised, PASS·width if literal
      Form(i,j,n):
        if substitutionMode: emit the substitute Out@0 (articulation only)
        elif next(n) ≠ ∅:    Form(i,j, chooseNext(n))@(rcmp? 0 : STEP)
        elif reached-via-edge:
             deeper ≔ recomplete(n)            # §19.6: re-cover n's own
                                               # bytes; cycle-guarded, memoised
             Out(i,j, deeper ?? read(n), recognised)@0
        elif concepts[n] exists: Form(i,j, concepts[n])@CONCEPT
        else: (no rule — the form leads nowhere)
      Out(i,j,b):
        SPLICE with any finalised partner Out whose (leftNode,rightNode)
            has a connector, gap empty-or-wholly-recognised          @0
        SPLIT at any split position k ∈ (i,j) if literal             @0
        BRIDGE from Cover(i) if already finalised (symmetric case)
        FUSE with any adjacent finalised Out:
            node ≔ findLeaf(bytes) if short | findBranch(nodes)
                   | resolve(bytes) if a side is a completed rewrite
            require halo(node) ≠ ∅ when a completed rewrite fuses in
            yield Out(i,k,bytes)@0 [kept only while it could still grow]
            if node: yield Form(i,k,node, rcmp = both-sides-rewritten
                                          ∧ next(node) ≠ ∅)@0
```

### 27.5 The consensus climb (§17)

```
climbAttention(query, k):
    regions ≔ subtrees of perceive(query), excluding any region that
              dominates (covers more than half of) the query unless it is
              the sole structure
    # sites name content-addressed nodes — exact anchors, no ANN needed
    regions ∪= recognise(query).sites (as {start, end, gist, nodeId})
    for each region:
        anchor ≔ region.nodeId  # site: exact, skip resonance
               ?? canonicalChunkId(region.bytes, HUB(N))
               ?? contentIndex.nearest(region.gist, k)[0]
        reach  ≔ expandUntilDecided(anchor, HUB(N)):
                   # uses ONLY LIMITed store reads, bounded by √N:
                   #  · prevCount(id) — indexed O(1) "edge-bearing?" check
                   #  · parentsFirst(id, HUB(N)+1) — hub if |result| > HUB(N)
                   #  · containersSlice(anchor, offset, HUB(N)) — paged
                   #  · distinct contexts past HUB(N) → saturated
                   #  · below √N, every read IS the full set → exact
                   # fall back to lower hits if orphaned and not saturated
        if reach.saturated: abstain
        mutual ≔ min(1, score · ratio) · min(1, score / ratio)   # §17.3
               where ratio ≔ √( max(1, contentLen(anchor, region.len·D))
                              / max(1, region.len) )
               # contentLen capped at region.len·D — beyond that the
               # mutual weight approaches zero and the full walk is waste
        w ≔ mutual · ln(N / reach.contexts) / |reach.roots|
        vote w for each root (a terminal answer root redistributes its
            vote over prevFirst(root, HUB(N)) of the contexts that lead
            to it — capped at the store level, never materialised)
    # cross-region: any two regions (at least one strong voter) pair to
    # recover joint contexts their independent climbs missed (junction ascent).
    # Corpus-independent: known but non-voting regions may serve as weak side.
    # Order-free, n-ary, with self-evidence guard and explaining away.
    cross ≔ []
    superseded ≔ ∅
    seedsOf(ri) ≔ junctionSeeds(ctx, query[regions[ri].start..regions[ri].end])
                  # precomputed once per candidate, reused across all its pairs
    consumed ≔ ∅
    for each pair (a, b) of eligible candidates (non-overlapping,
           at least one strong voter, not both covered by one known region,
           ≤ k total probes, skipping consumed):
        containers ≔ junctionContainersFrom(left, right, cap,
                      seedsOf(a), seedsOf(b), undefined, unordered = true)
        if containers = ∅:
            containers ≔ junctionSynonyms(left, right, maxInterior,
                          unordered = true)
        if containers ≠ ∅:
            best ≔ the container covering the MOST remaining candidates
                   (cached reads, never an extra walk); ties → shortest
                   interior → lowest id
            if best's joined occurrence is a query substring: continue
            reach ≔ edgeAncestors(best.id, HUB(N))
            if not saturated and idf > 0:
                w ≔ mutual · ln(N / reach.contexts) / |reach.roots|
                cross.push(vote for best.id's roots at weight w,
                           span covering all composed candidates)
                consumed.add(a); consumed.add(b); consumed.add(all extras)
                # Explaining away: supersede individual votes whose bytes the
                # container literally contains and whose roots are disjoint
                for each individual vote rv:
                    if rv.roots shares any root with reach.roots: keep
                    if containerBytes literally contains rv's query bytes:
                        superseded.add(rv)
        break  # a is consumed
    pooled ≔ lightestDerivation in the (+,+) semiring over the union
              of the independent votes (minus superseded) and cross  # §5.3
    ranked ≔ anchors by pooled vote, descending
    cut    ≔ steepest ratio drop in the sorted focus votes (natural break)
    roots  ≔ [ranked[0]] ∪ { further non-overlapping anchors past any
              leading saturated stretch whose vote ≥ max(cut, FLOOR(N)) }
    return (roots, ranked)
```

### 27.6 Recall, reasoning, fusion (§21–23)

```
recallByResonance(query):
    whole_ ≔ [[0, query.length]]    # identity-grade match: the whole query
    nothing ≔ []                    # reverse readings/echoes: nothing matched
    q ≔ resolve(query)
    if q ≠ ∅:                                                    # tier 0
        g ≔ reverseContext(q, guide)
        if g ≠ ∅: return { bytes: g, accounted: nothing, moves: STEP }
    hits ≔ contentIndex.nearest(gistOf(query), k)
    if hits = ∅: return ∅
    if hits[0].score ≥ MERGE:                                    # tier 1
        for h in hits:
            g ≔ project(h, guide)                                # forward first
            if g ≠ ∅: return { bytes: g, accounted: whole_, moves: STEP }
        # all reverse — accounted: nothing (no forward rule)
        g ≔ reverseContext(hits[0], guide)
        if g ≠ ∅: return { bytes: g, accounted: nothing, moves: STEP }
    if hits[0].score ≥ SIG:                                      # tier 2
        forest ≔ climbAttention(query).roots
        if forest[0].vote ≥ FLOOR(N):
            g ≔ project(forest[0].anchor, guide)
            if g ≠ ∅: return { bytes: g,
                               accounted: [[forest[0].start, forest[0].end]],
                               moves: CONCEPT }                  # the climb
    for h in hits:                                               # tier 3
        g ≔ project(h, guide)
        if g ≠ ∅ and fracOfQuery(resonance(gistOf(query), gistOf(g)),
                                  contentLen(g), query.length) ≥ REACH:
            return { bytes: g, accounted: nothing, moves: STEP }
    if fracOfQuery(hits[0].score, contentLen(hits[0]), query.length) < REACH:
        return ∅                                                  # silence
    return { bytes: read(hits[0]), accounted: nothing,
             moves: 0, echoed: true }                            # honest echo

reason(query, answer, consumed₀):                                # §22
    q ≔ resolve(query)
    if q ≠ ∅ and prevCount(q) > 0: return answer       # echo guard
    consumed ≔ consumed₀
    # synonym expansion — CAPPED at the hub bound: a common continuation's
    # reverse fan-in is corpus-sized, and no per-hop operation may grow
    # with the corpus (the same visibility trade chooseNext documents)
    for id in consumed₀:
        for sib in haloSiblings(id):                   # unified enumeration,
            consumeNode(sib.id)                        # above CONCEPT_BAR
    cur ≔ answer
    repeat up to K times:
        c ≔ resolve(cur);  consumeNode(c)
        if c ≠ ∅ and nextFirst(c, hubBound).some(n ∉ consumed):
            fwd ≔ follow(c, guide)                     # forward absorb
            if fwd ≠ ∅ and fwd ≠ cur and resolve(fwd) ∉ consumed:
                consumeAll(c);  cur ≔ fwd;  continue
        consumeAll(c)
        pivot ≔ pivotInto(cur, consumed)               # below
        if pivot = ∅: break
        fc ≔ follow(pivot, guide);  consumeAll(pivot)
        if fc = ∅ or fc = cur: break
        cur ≔ fc
    return cur

# consume-set expansion: prevs and nexts are capped at hubBound —
# a node suppressed only by a beyond-cap neighbour may still fire,
# the same visibility trade the disambiguators make.

pivotInto(answer, consumed):            # §22 — the stepping stone
    tree ≔ perceive(answer)              # ONE perception, shared by the
                                          # probe budget and the walk
    candidates ≔ ∅
    for each branch node b of tree, breadth-first,
            at most min(number of branch nodes, k) probes:
        for hit in contentIndex.nearest(b.gist, k):
            if hit ∉ consumed and hasNext(hit): candidates += hit
    for site in recognise(answer).sites:               # exact beats
        if site ∉ consumed and hasNext(site):           # approximate
            candidates += site (full confidence)
    return the candidate whose bytes `answer` literally CONTAINS,
           longest such span wins; ∅ if none          # resonance proposes,
                                                       # bytes confirm

fuseAttention(query, primary):                                   # §23
    if primary is strictly contained in query: return primary
    roots ≔ climbAttention(query).roots
    if |roots| ≤ 1: return primary
    qv ≔ guide (the response guide, already computed — once, not per root)
    pieces ≔ [primary] ∪ [ project(r.anchor, qv) for r in roots[1:] ,
                           dropping ∅ and duplicates ]
    sort pieces by their supporting query span
    out ≔ pieces[0]
    for p in pieces[1:]:
        out ≔ joinWithBridge(out, p)     # learned connector when one exists;
                                          # bare join + bridgeMiss trace step
                                          # otherwise — degradation is never
                                          # silent (§19.5, §23)
    return out

bridge(left, right):                    # §19.5 — the graded junction ladder
    # Tier 1 — junction containers, by content-addressed identity:
    # ascend parents + containment links from resolve(left)/resolve(right)
    # (or their canonical-window ids), √N-disciplined; collect ancestors
    # whose bytes contain left then right.
    cands ≔ junctionContainers(left, right)
    # Tier 2 — edge junctions: a continuation of left containing right
    # (glue = its prefix), or a context of right containing left (glue =
    # its suffix).  An empty interior is a CONFIRMED adjacency, not a miss.
    if cands = ∅: cands ≔ junctionEdges(left, right)
    # Tier 2.5 — synonym junctions: tiers 1 + 2 applied to halo siblings
    if cands = ∅: cands ≔ junctionSynonyms(left, right)
    if cands ≠ ∅:
        # guide resonance picks; ties → shortest interior → lowest id
        return pick(cands, guide).interior
    # Tier 3 — the resonance fallback (last resort):
    for hit in contentIndex.nearest(gistOf(left ⧺ right), 2k), nearest first:
        f ≔ read(hit)
        if f contains left at position i, and right at position j > i+|left|:
            return f[i+|left| … j]      # the bytes the corpus puts between
    return ∅

joinWithBridge(left, right):            # the ONE out-of-search assembly step
    link ≔ bridge(left, right)
    if link = ∅: emit bridgeMiss trace; return left ⧺ right
    return left ⧺ link ⧺ right

# ── the projection family (§14.4) — shared by every mechanism above ──

follow(node, guide):                    # FORWARD: the continuation fixpoint
    nxt ≔ chooseNext(node, guide)
    if nxt = ∅:
        nxt ≔ conceptHop(node)          # first hop may cross a synonym:
                                        # the first halo sibling above
                                        # CONCEPT_BAR that has an edge
        if nxt = ∅: return ∅
    walk chooseNext from nxt until revisit or dead end (cycle-guarded)
    return read(final node)

reverseContext(node, guide, rev?):      # REVERSE: the establishing context
    candidates ≔ rev ?? prevFirst(node, hubBound)  # CAPPED at √N: a common
                                                   # continuation's reverse fan-in
                                                   # is corpus-sized; prevFirst
                                                   # reads only the first √N
    if candidates = ∅: return ∅
    pick ≔ |candidates| = 1 ? candidates[0]         # skip needless gisting
         : guide ≠ ∅        ? chooseAmong(candidates, guide)
         :                    argmax haloMass over candidates (already capped)
    g ≔ read(pick)
    return |g| > 0 ? g : ∅              # empty bytes are no grounding

project(node, guide):                   # BOTH: the universal grounding step
    return follow(node, guide) ?? reverseContext(node, guide)

# ── the disambiguators + the one fan-out convention (§25, §8.8) ──

corpusN   ≔ max(2, edgeSourceCount)    # floored at 2 so ln N and √N stay
hubBound  ≔ ⌈√corpusN⌉                 # meaningful on a near-empty store

hubCap(ids):                            # THE fan-out cap, defined once
    return the first hubBound of ids (insertion order); no copy when under

guidedFirst(node):                      # guided-or-first, for answer-shaped reads
    return chooseNext(node, guide) ?? nextFirst(node, 1)[0]
                                        # LIMIT 1 read when no guide is in flight

chooseNext(node, guide):                # §25, forward regime
    nx ≔ nextFirst(node, hubBound)      # only the first √N continuations
                                        # are ever candidates — a hub context's
                                        # full fan-out is never materialised
    if |nx| ≤ 1 or guide = ∅: return nx[0]
    among nx (already capped):
        maximize ( prevCount(candidate) , haloMass(candidate) )  # indexed,
        ties → first inserted                  # never materialised

chooseAmong(candidates, guide):         # §25, reverse regime
    among candidates (already capped by the caller):
        maximize resonance(guide, gistOf(read(candidate)))
    return the winner
```

### 27.7 Counterfactual transfer (grounding I, §18)

```
counterfactualTransfer(query, sites, roots, ranked):
    # castFloor already checked |query|<2W, N=0, |ranked|<2 — these
    # gates are checked once in the floor, not duplicated here.
    # If roots/ranked not given (standalone call), compute the climb.

    # ── graded alignment (literal → halo) ────────────────────────────
    MIN_WEAVE ≔ 2;  points ≔ ∅;  depth ≔ Float64Array(|query|)
    for cand in the first 2k of ranked:
        ... (alignment as before) ...
    if |points| < 2: return []
    # frame gate (weave-local): frame(i) ⇔ depth[i] > MIN_WEAVE ∧ dominates(depth[i], |points|)
    dominant ≔ points[0];  require dominant ∈ roots
    require some run outside every recognised site

    results ≔ []   # multi-candidate: each schema records independently
    runSpans(p) ≔ p's free runs as [qs, qe] pairs

    # ── 1. substitution ──────────────────────────────────────────────
    ... (same detection logic) ...
    if found:
        record({ bytes: joinWithBridge(filler, tail) + follow(p.anchor),
                 used: {before, p}, moves: STEP+STEP,
                 accounted: runSpans(before) ∪ runSpans(p),
                 unexplained: query bytes not in those runs })

    # ── 2. redirection ───────────────────────────────────────────────
    ... (same detection logic) ...
    if found:
        record({ bytes: g, used: {dominant, last}, moves: STEP,
                 accounted: runSpans(dominant) ∪ runSpans(last),
                 unexplained: query bytes not in those runs })

    # ── 3. comparison ────────────────────────────────────────────────
    ... (same detection logic) ...
    if found:
        record({ bytes: joinWithBridge(a, b),
                 used: {dominant, bestAnalog},
                 moves: CONCEPT+STEP+STEP,
                 accounted: runSpans(dominant) ∪ (bestAnalog.point ? runSpans(bestAnalog.point) : []),
                 unexplained: query bytes not in those runs })

    return results   # possibly empty — the decider weighs whatever fired
```

### 27.7a Confluence join (§18.5)

```
confluenceJoin(query):
    if |query| < 2W or N = 0: return ∅
    (roots, ranked) ≔ climbAttention(query, 2k)
    if |ranked| < 2: return ∅

    queryWin ≔ windowIds(query)      # offset → id, canonical W-window read
    queryIds ≔ set of queryWin values
    N ≔ corpusN

    # ── constraint streams ────────────────────────────────────────────
    streams ≔ ∅
    for cand in ranked (capped at 2k):
        ids ≔ set of windowIds(read(cand.anchor)).values
        cover ≔ ∅   # query spans this anchor holds DISCRIMINATIVE windows of
        held  ≔ ∅   # query spans this anchor holds AT ALL (scaffolding included)
        for (off, wid) in queryWin where ids has wid:
            merge off into held
            if not dominates(reachOf(wid, N), N):   # scaffolding never binds
                merge off into cover
        if cover ≠ ∅: streams += (cand.anchor, cand.vote, ids, cover, held)
    if |streams| < 2: return ∅

    # ── find the MEET of two independent streams ─────────────────────
    disjoint(a, b) ≔ a.cover and b.cover share no query byte
    for each pair (a, b) where disjoint(a, b):
        wa ≔ windowIds(read(a.anchor))
        # window ids in BOTH anchors, ABSENT from the query — merged into
        # maximal contiguous spans (overlapping windows weave one span)
        for each contiguous span [s, e) of offsets where
                wa[off] ∈ b.ids and wa[off] ∉ queryIds:
            # scaffolding gate: the span's most DISCRIMINATIVE window decides
            reach ≔ min reachOf(wa[off], N) for each window in [s, e)
            if not isFinite(reach) or dominates(reach, N): continue
            # feasible — the entity where the constraints meet
            met ≔ the one with smallest reach, longest span (tie-break)
    if met = ∅: return ∅

    return { bytes: read(a.anchor).subarray(met.s, met.e),
             used: {a.anchor, b.anchor},
             accounted: a.held ∪ b.held,        # ALL matched content
             moves: 3·STEP }                     # two matches + one meet
```

### 27.8 Extraction and articulation (§20, §24)

```
extractBySkill(query):
    ranked ≔ climbAttention(query, 2k).ranked
    for cand in ranked:                          # first span-shaped wins
        ex ≔ skillExemplar(cand.anchor):
            if hasNext(anchor):
                (context, answer) ≔ (read(anchor), follow(anchor, guide))
            else:
                answer ≔ read(anchor)
                context ≔ the longest span-shaped context among
                          prevFirst(anchor, hubBound); chooseAmong
                          (the reverse-regime disambiguator) breaks
                          length ties via query-gist resonance
            require answer is a sparse subsequence of context
                    # OPEN reading: in-order, arbitrary gaps (§20.1)
                    # the subsequent DECOMPOSITION step uses a STRONGER
                    # greedy-longest-run reading; an accepted exemplar
                    # can still fail to decompose → extraction returns ∅
        if ex ≠ ∅: break
    if no exemplar: return ∅
    runs ≔ the answer's pieces, decomposed by greedy longest-run
           matching inside the context (the STRONG reading); contiguous
           adjacent runs merged
    accounted ≔ ∅
    for each run, with isLast flags:
        pre  ≔ up to W context bytes before the run
        post ≔ up to W after (or the NEXT run's pre)
        locate pre then post in the query via locate() — the graded
        matcher ladder of §14.4:
            1. exact bytes  2. halo-role match via bestHaloMate above
            CONCEPT_BAR  3. gist match against query segments above MERGE
        accounted += the located pre/post frames in the query
        piece ≔ the query bytes between the located frames
        # bounded on BOTH sides ⇒ the read span itself is explained
        if pre-located and post-located: accounted += piece's span
    return { bytes: concatenation of the pieces,
             accounted }  (∅ if none located)
    moves ≔ CONCEPT + STEP · |accounted|

articulate(answer, query):
    voices ≔ recognised multi-byte forms of the QUERY that bear halos
    if voices = ∅ or they cover none of the query: return answer
    subs ≔ ∅
    for each recognised multi-byte, halo-bearing form f of the ANSWER:
        v ≔ argmax over voices of cosine(halo(f), halo(v)), ≥ CONCEPT_BAR
        if v exists and v ≠ f and f is not a fragment of v's own subtree:
            subs[f] ≔ v.bytes
    if subs = ∅: return answer
    solved ≔ the cover search over the ANSWER with subs as the only form
           rules (each voiced form emits its substitute at cost 0)
    return solved ? solved.segs composed : answer  # unchanged if no cover
```

### 27.9 A worked example, end to end

The README's demo, traced through the pipeline. Deposits:

```
("The Mona Lisa was painted by Leonardo da Vinci.",  "Leonardo da Vinci")
("The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh")
("The Night Watch was painted by Rembrandt van Rijn.","Rembrandt van Rijn")
("Pablo Picasso",  "Pablo Picasso co-founded the Cubist movement")
```

Each pair interns both sides (sharing every repeated span: "was painted by" is
one set of nodes across all three sentences), records one continuation edge, and
pours halos both ways. The three painter names, having each appeared as an
answer following a painting-frame, acquire similar halos; "was painted by …"
spans become shared, many-parent interior structure.

Query: `"The Weeping Woman was painted by Pablo Picasso."`

1. **Recognise (§15).** Sites include "was painted by" material (shared interior
   forms), " Pablo Picasso" (a learned context — it has an edge to the Cubism
   fact), and assorted chunks. "The Weeping Woman" resolves to nothing: never
   seen.
2. **Compute (§16).** No extension claims any span.
3. **Grounding decider (§14.1).** Every self-gating mechanism weighs in:
   - **CAST (§18):** The climb ranks the three painting exemplars and the
     Picasso context; alignment finds runs, but no substitution seat or
     redirection shape fits — CAST yields no candidate.
   - **Confluence (§18.5):** Only one constraint stream (the query asks about
     one painting, not a conjunction of independent properties) — returns null.
   - **Cover (§19):** The recognised forms do not compose a cover that lifts an
     answer clear of the framing (the unseen painting title blocks a clean
     composition) — returns null. _(On other seeds/corpora this query can also
     ground via cover; the strategies are redundant by design, and provenance
     records which one fired.)_
   - **Extraction (§20):** The climb's ranked anchors include the exemplar "The
     Mona Lisa was painted by Leonardo da Vinci." — span-shaped. Its frames are
     located in the query; the analogous span reads out **"Pablo Picasso"**. The
     candidate's weight: CONCEPT (one skill analogy) + STEP per located frame +
     PASS per unexplained byte. It is the lightest grounding derivation.
   - **Recall (§21):** Its best candidate carries the full PASS·|query| plus a
     STEP — heavier.
   - **Decider:** Extraction wins — lightest grounding derivation.
4. **Reason (§22).** "Pablo Picasso" resolves — and it is a learned context with
   an unconsumed continuation. Forward absorb follows the edge: **"Pablo Picasso
   co-founded the Cubist movement"**. The next iteration finds no unconsumed
   pivot; the chain fixes.
5. **Fuse / articulate (§23–24).** One point of attention grounded from the
   query's text; no halo-sibling substitutions apply. The answer stands.

Provenance: `extract`. Every step above is present, with spans, node ids, costs,
and data-flow edges, in the rationale when one is requested.

The second demo query, `"a museum charges 12*4 for a family ticket"`: the ALU
claims the span `12*4` with result bytes `48`; recognition's sites overlapping
that span are masked; the cover search bridges the literal framing (PASS) and
the computed span (recognised, STEP + ε), and lifting drops the framing:
**"48"**, provenance `cover`.

### 27.10 Determinism, stated as an invariant

Every function above is deterministic given (seed, store contents): the alphabet
and keyring are seeded; perception is positional; interning is
content-addressed; the deduction engine breaks ties by fixed conventions;
disambiguation bottoms out in corpus-determined orderings; the ANN index is
deterministic for a fixed build. Hence: **same seed + same deposits (in order) +
same query ⇒ byte-identical answer.** The only approximation in the system — ANN
ranking — affects which _candidates are proposed_, never what any accepted
answer _asserts_, and it too is deterministic run to run.

---

---

# Part VI — Reference

## 28. Glossary

The one-line inventory of §9 doubles as the glossary; this section adds only the
terms of art borrowed from the literature.

- **A\*LD** — A\* Lightest Derivation: A\* generalized from shortest paths to
  weighted deduction (Felzenszwalb & McAllester 2007). §5.2.
- **Binding / superposition** — the two VSA combination operators:
  association-forming (order-visible) vs. set-forming (similarity- preserving).
  §2.1.
- **Company signature** — a deterministic unit vector derived from a node's
  identity (seeded by id), used as the halo-pour unit. Decouples content
  similarity from distributional similarity. §4, §12.2.
- **Concentration of measure** — the high-dimensional phenomenon making random
  vectors quasi-orthogonal; the statistical basis of every threshold. §2.2.
- **Content-addressable memory** — retrieval by content, not location. §3.1.
- **Distributional hypothesis** — meaning ≈ distribution of use (Harris 1954).
  §4.
- **Hash-consing** — constructing structures modulo equality so equal
  substructures are shared. §3.2.
- **IVF** — inverted-file partitioned ANN index; bounded-probe sub-linear search
  over clustered codes. §6.1.
- **Hilbert curve** — the locality-preserving space-filling curve used to
  linearize grids. §6.3.
- **Hyperdimensional computing** — Kanerva's (2009) umbrella term for computing
  with high-dimensional random vectors; synonym of VSA as used here. §2.
- **IDF** — inverse document frequency; the specificity weighting of the
  consensus climb (Spärck Jones 1972). §17.3.
- **Instance-based learning** — generalization at query time from stored
  instances. §1.1.
- **Merkle DAG** — a graph whose node identities derive from content (Merkle
  1987). §3.2.
- **Non-parametric** — model capacity residing in the data, not a fixed
  parameter vector. §1.1.
- **RaBitQ** — 1-bit quantization with an unbiased similarity estimator (Gao &
  Long 2024). §6.1.
- **Semiring-weighted deduction** — the algebraic generalization of weighted
  inference (Goodman 1999); Sema uses tropical (min,+) for structure and
  arithmetic (+,+) for evidence pooling. §5.
- **Tropical semiring** — (min, +): the algebra of shortest paths and lightest
  derivations. §5.3.
- **VSA** — Vector Symbolic Architecture (Plate 1995; Gayler 2003). §2.

## 29. Complexity summary

n = input/query length; D = dimension; W = fold window; N = learned contexts; k
= retrieval breadth. All store lookups are content-addressed O(1) (amortized);
all index queries are sub-linear in the collection (empirically ≈ N^0.32
distance computations).

| Operation                  | Cost                                                                                                                                                                    | Where     |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------- |
| Perceive                   | O(n·D) vector work; O(n) nodes                                                                                                                                          | §10       |
| Deposit (intern + windows) | O(n) content-addressed probes                                                                                                                                           | §11       |
| Learn a pair               | O(1) edge + O(changed) halo pours                                                                                                                                       | §12       |
| Recognise                  | O(n·W) bounded probes                                                                                                                                                   | §15       |
| Consensus climb            | O(regions · k) index queries + expand-until-decided: work bounded by √N per region regardless of corpus size (LIMITed store reads, indexed existence probes)            | §17       |
| Cover search               | output-sensitive A\*LD: proportional to the lightest derivation, not the corpus (§5.2); the dominant per-query index cost is connector pre-resolution, O(sites) queries | §19       |
| Recall                     | O(k) index probes + graded structural checks                                                                                                                            | §21       |
| Reasoning                  | ≤ K hops, each bounded by the answer's subtree                                                                                                                          | §22       |
| Storage                    | O(distinct subtrees); vector index over resonance targets only, 1-bit codes (32× compression)                                                                           | §3, §12.3 |

Nothing on any per-query path scans the corpus; every fan-out is capped at the
hub bound, and the cap is enforced at the _store level_ through LIMITed reads
and indexed existence probes — no per-query read materialises a corpus-sized
list. That — not hardware — is why the system runs on a CPU and why inference
cost stays decoupled from corpus growth.

## 30. Bibliography

Foundations cited in this document, in alphabetical order:

- Felzenszwalb, P. F. & McAllester, D. (2007). _The Generalized A\*
  Architecture._ Journal of Artificial Intelligence Research 29, 153–190.
- Gao, J. & Long, C. (2024). _RaBitQ: Quantizing High-Dimensional Vectors with a
  Theoretical Error Bound for Approximate Nearest Neighbor Search._ Proc. ACM
  SIGMOD.
- Gayler, R. W. (2003). _Vector Symbolic Architectures Answer Jackendoff's
  Challenges for Cognitive Neuroscience._ Proc. ICCS/ASCS.
- Goodman, J. (1999). _Semiring Parsing._ Computational Linguistics 25(4),
  573–605.
- Harris, Z. S. (1954). _Distributional Structure._ Word 10(2–3), 146–162.
- Kanerva, P. (2009). _Hyperdimensional Computing: An Introduction to Computing
  in Distributed Representation with High-Dimensional Random Vectors._ Cognitive
  Computation 1, 139–159.
- Knuth, D. E. (1977). _A Generalization of Dijkstra's Algorithm._ Information
  Processing Letters 6(1), 1–5.
- Kolodner, J. L. (1992). _An Introduction to Case-Based Reasoning._ Artificial
  Intelligence Review 6, 3–34.
- Merkle, R. C. (1987). _A Digital Signature Based on a Conventional Encryption
  Function._ Proc. CRYPTO.
- Plate, T. A. (1995). _Holographic Reduced Representations._ IEEE Transactions
  on Neural Networks 6(3), 623–641.
- Spärck Jones, K. (1972). _A Statistical Interpretation of Term Specificity and
  Its Application in Retrieval._ Journal of Documentation 28(1), 11–21.

---

_This document describes concepts and algorithms only. For the codebase —
layout, build, tests, invariants, and how to extend the system — see
[AGENTS.md](AGENTS.md)._
