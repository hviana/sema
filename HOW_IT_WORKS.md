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
  - [24.5 Conversations: the accumulated context](#245-conversations-the-accumulated-context)
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

### 2.3 Seat binding and why order becomes visible

A permutation π rearranges a vector's coordinates: the value at position π(i)
moves to position i. Two properties make permutations excellent binding
operators:

- **They preserve lengths and angles** (they are orthogonal linear maps), so
  permuting a vector produces an equally well-behaved vector.
- **A random permutation decorrelates.** For a random vector v, the permuted
  vector πv is (with overwhelming probability) nearly orthogonal to v — the
  permutation "hides" the vector's identity behind the role.

Sema keeps a fixed **keyring** of independent random permutations π₀, π₁, π₂, …
— one per _seat_ (a positional coordinate inside a group). To encode an ordered
group of children (c₀, c₁, …, cₖ), each child's vector is bound to its seat and
the results are superposed:

```
encode(c₀, c₁, …, cₖ)  =  π_{s(0)}·v(c₀) + π_{s(1)}·v(c₁) + … + π_{s(k)}·v(cₖ)
```

Because the seats are _different_ permutations, "A in seat 0, B in seat 1" and
"B in seat 0, A in seat 1" produce nearly orthogonal encodings — **order is part
of the representation**. And because independent permutations do not commute,
nesting the operation encodes _paths_: "the x that sits in seat 2 of the thing
in seat 1" has a distinct signature from "the x in seat 1 of the thing in seat
2". A whole tree can thus be folded into one fixed-width vector whose geometry
reflects the tree's entire shape and content. Sema calls the result of this fold
the tree's **gist**.

#### The two-ended coordinate frame

The seat assignment `s(k)` is not simply `k`. A group of `size` children is
anchored at **both ends of the keyring**: the front half of the children take
the lowest seats (0, 1, …), and the back half take the highest seats, counted
inward from the keyring's last slot. Formally, with `S` seats on the ring,

```
s(k)  =  k                     for k < ⌈size/2⌉      (anchored at the left end)
s(k)  =  S − size + k          otherwise             (anchored at the right end)
```

The assignment stays injective for any `size ≤ S`, so the algebra is unchanged;
what changes is _robustness_. Under a plain `s(k) = k` frame, prepending one
byte to a group re-seats every subsequent child and the group's gist rotates
into a nearly orthogonal direction. Under the two-ended frame, a byte inserted
at one edge moves only the coordinates anchored at _that_ edge; everything
anchored at the far end keeps its seat, and the interior of the group keeps its
geometry. This is the vector-side counterpart of the content-defined boundaries
of §10.2: one makes _identity_ insensitive to absolute offset, the other makes
_geometry_ insensitive to edge perturbation.

The keyring is sized `max(8, W)` seats, which is also the largest group the fold
is allowed to build (§10.2).

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
  vote (§17.4) both convert a raw resonance score into a _query-relative
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

### 3.4 Equivalence classes: canonical resolution

Content addressing on raw bytes is exact, and exactness cuts both ways: "What",
"WHAT" and "ｗｈａｔ" are three different hashes, so a query that differs from
the trained form only in _surface_ resolves to nothing even though the content
is the same. Sema closes this gap without weakening content addressing, by a
second, explicitly labelled index.

A **canonicalizer** is an injected pure function mapping a byte span to the
canonical representative of its equivalence class. It is **modality-specific and
always supplied by the caller** — nothing in the store or the mind's core knows
what "case" or "whitespace" is. The text canonicalizer (the one the text entry
points inject) applies Unicode NFKC compatibility normalization, case folding,
and collapses interior whitespace runs to one space, while leaving _edge_
whitespace, punctuation, digits and word order untouched. A grid or audio
modality supplies its own, or none.

The store keeps a small **canon index** — a map from the 32-bit hash of a
canonical key to candidate node ids — built (and incrementally refreshed) by a
batch pass over the store's content-bearing nodes, exactly like index repair.
Only nodes whose canonical key _differs_ from their raw bytes are indexed; an
already-canonical form is found by the ordinary exact lookup.

Resolution therefore has two tiers, in the system's standing order of exact
before approximate:

1. the exact content-addressed fold-and-lookup (§3.1);
2. failing that, canonical resolution: canonicalize the span, try the exact
   lookup of the _canonical bytes_, then probe the canon index by key hash.

Crucially, canonical keys are equivalence-class **labels, never content**. Every
candidate the hash proposes is verified by re-canonicalizing its stored bytes
and comparing, so a hash collision costs one read and never a wrong id — the
same hash-then-verify discipline the node table's own content hash uses. Among
verified candidates, one that leads somewhere (bears a continuation edge) is
preferred, ties breaking to the lowest id — a property of the corpus, not of the
seed. A verified candidate is then re-folded to the deposit-shaped node that
actually carries the edges and halos, so canonical resolution lands on the same
node the exact path would have reached had the query been spelled canonically.

Two adjacent conveniences belong to the same modality boundary. The text entry
point **retries a whole query with its outer edge whitespace trimmed** when the
first, byte-exact attempt grounds nothing: at the outer edges of a whole input
there is no neighbouring form for a trimmed span to swallow, so the hazard that
makes the canonicalizer preserve edge whitespace cannot arise there. The retry
is on the already-failed path only, so a form deliberately trained _with_ edge
padding still answers exactly.

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
(VSA, §2)             │  the fold: content-defined cuts → flat   │
                      │  segments → level grouping → tree        │
                      │  every node gets a GIST (seat-bind +     │
                      │  superpose; only the ROOT normalizes)    │
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

The bound has two derived companions, both readings of "too common to
discriminate" that a single node's parent count cannot express:

- **The lateral-cone bound — the cumulative dual.** Within one deposit, an
  upward climb is a _chain_ (each node's first parent); every parent _beyond_ a
  node's first is an entry into another containing structure (hash-consing: a
  shared subtree's extra parents are other deposits' chunks). A climb whose
  _accumulated_ lateral entries exceed √N has spread across just as many
  distinct containing structures as a single hub node would have — the same
  commonness, distributed along the cone instead of concentrated at one node —
  and is decided saturated. A deep chain inside _one_ structure accrues no
  laterals, so legitimate deep scaffolding still climbs to its root at any
  depth; what dies is cross-structure drift (profiled on a 17.7M-node store:
  ~20K distinct nodes visited per climb family, over 95% of them unique — not
  memoisable — while the context account never decided).

- **The byte-atom commonality floor: N·W/256.** A single-byte leaf has no
  structural parents _by construction_ (atoms are never linked into the kid or
  containment tables), so a climb cannot observe its containment at all. Left
  alone, the walk would see only the atom's own edges and report one context —
  turning the most common content in the store into its most discriminative
  voter (observed on a 325K-context store: every recognised single-letter site
  voted a full ln N, and their pooled sum out-voted every genuine anchor). An
  _unmeasurable_ commonality must not default to "maximally rare": it is bounded
  below by the uniform expectation over the alphabet — N contexts, each holding
  at least one segment of up to W of the 256 possible byte values, so an atom is
  contained in ≥ N·W/256 contexts on average. When that floor exceeds √N, the
  atom is a hub at this corpus scale and abstains from voting. Its own edges
  remain fully traversable (exact recall, continuation picks, projections); only
  its say as a consensus voter is withdrawn. Derived from N, W and the alphabet
  size; never tuned.

A third device bounds work without bounding evidence: a **transparent chain** —
a run of nodes each with exactly one structural parent and no edges in or out —
contributes no root, no context and no lateral entry, so the whole run to its
first non-transparent ancestor is skipped in one bounded store read instead of
three probes per node.

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

The climb's IDF weighting (§17.4), confluence's filler/scaffolding gate (§18.5),
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
- **Seat / keyring** — the fixed random permutations that bind positional
  coordinate into a fold; assigned in the **two-ended coordinate frame** (front
  children anchored at the ring's low seats, back children at its high seats) so
  an edge insertion re-seats only that edge (§2.3).
- **Alphabet** — the 256 deterministic byte vectors with graded similarity
  (§2.4).
- **Content boundary / cut level** — where a stream segments, chosen by a
  bounded-window rolling hash over the bytes rather than by absolute offset; the
  same hash's divisibility gives each cut a LEVEL, and level-L cuts nest inside
  level-(L−1) cuts, which is what makes every node at every scale
  content-delimited (§10.2, §10.3).
- **Segment** — the phrase-scale flat unit between two level-0 cuts; folds as
  ONE node with two-ended seats (§10.3).
- **The fold** — segments folded flat, then grouped upward by cut level until
  one root remains (§10.3). **Linear**: only the fold's root is normalized, so
  every interior gist keeps a byte-proportional magnitude — the basis of
  angle-and-magnitude semantics (§2.6).
- **Incremental fold** — a stream extending an already-folded one reuses every
  segment left of the new bytes (cuts are stable under append; a segment is a
  pure function of its own bytes), so growth costs O(new bytes) (§10.4).
- **Magnitude / contentLen** — the byte-proportional length an unnormalized
  interior gist carries (norm ≈ √len); read back from the store as a span's
  content length and used to convert a raw cosine into a query-relative or
  scale-aware fraction (§2.6, §8.1, §17.4, §21).
- **Stable prefix** — a caller-imposed (or store-detected) boundary set at which
  the fold splits and joins left-nested, so every cumulative prefix reappears as
  the same node inside the grown stream. Distinct from incremental reuse, which
  imposes nothing (§10.4).

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
- **Canonicalizer / canon index** — an injected, modality-specific map from a
  span to its equivalence class's representative, plus the store's hash index
  from canonical keys to node ids. The read-path fallback when exact
  content-addressed resolution misses; every candidate is verified by
  re-canonicalizing its bytes, so a collision costs a read, never a wrong id
  (§3.4).
- **Suffix propagation** — every established right-edge suffix of a learned
  context inherits that context's continuation edge, so a fact stays reachable
  when it arrives with a different amount of history in front of it (§12.1).
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
  attention's joint-context recovery (§17.8) ascend by the same shared, bounded,
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
  grows with the corpus. Its two derived companions are the **lateral-cone
  bound** (the same √N applied to a climb's accumulated cross-structure entries)
  and the **byte-atom commonality floor** N·W/256 (the honest stand-in for a
  containment an atom's structure cannot express) (§8.8).
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
  (§17.5). The walk is exact below √N distinct contexts and stops at the first
  proof of saturation past it. Five such proofs exist, each recorded by name in
  the trace: predecessor fan-in, distinct-context limit, parent fan-out, the
  lateral-cone limit, and byte-atom commonality (§8.8, §17.5).
- **Canonical contract** — the write/read convention for the store's
  segmentation: the write side interns W−1 and W sliding windows and a
  whole-stream flat branch; the read side chains leaf ids up to W² positions and
  probes every prefix as a flat branch. Defined in one module; a drift between
  the sides silently breaks recognition. (§10.4, §11.3, §15.2)
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
  structural and canonical readings plus a query-edge pass (§15). Memoised by
  content and ALWAYS consulted, even under trace: the subtree-resolution cache
  makes a repeat call find FEWER sites, so the memo is a correctness contract,
  not an accelerator (§15.4).
- **Site** — one recognised form: a query span plus the node it names. Admitted
  only if it leads somewhere, spans at least one perception window, and (for a
  byte atom) atoms still discriminate at this corpus scale (§15.3).
- **Split / starts** — a form boundary falling inside a perceived leaf (the
  cover may cut there), and the offsets the query's own fold cut at (§15).
- **Cover** — the lightest-derivation goal: the query covered left to right by
  recognised completions and carried literals (§19).
- **Stop-here** — the cover's option to abandon an edge chain mid-way and emit
  the node as it stands, priced at CONCEPT above the chain's cost, so a shorter
  premature stop beats a longer one and a genuine fixpoint beats both (§19.3).
- **Atom-chain gate** — a pure leaf-leaf FUSE is admitted only below the
  atom-hub scale; the fold-boundary exemption it replaced carried zero content
  information and once grounded a greeting as a fact (§19.3).
- **Fuse / recompose** — the search's discovery that adjacent fragments spell a
  deeper learned form (§19.4).
- **Connector (bridge)** — learned material that belongs _between_ two spans,
  found by a graded junction ladder: Tier 1 containment ascent by
  content-addressed identity, then Tier 2 edge junctions (a continuation/context
  carrying the glue), then Tier 2.5 synonym junctions (the same ascent over halo
  siblings), then resonance as last resort; disambiguated by the response guide,
  with the shortest interior preferred. The junction ascent is shared with
  cross-region attention (§19.5, §17.8).
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
  THREE sources: fold nodes, recognised sites (content-addressed nodes carrying
  their own identity — exact anchors that skip the ANN step), and coalesced
  resolvable windows recovering forms the query's own content cut split (marked
  _corroborating_: evidence for someone else's anchor, never a topic of their
  own). Pooled votes select the query's independent topics (§17).
- **Saturation** — a region whose upward climb hits hub fan-out abstains rather
  than voting noise (§17.5).
- **Peak / breadth / clusters** — the three read-outs beside an anchor's pooled
  vote: what its strongest single region said alone (the bar a consensus-floor
  consumer must read), the scale-invariant fraction of the query's own regions
  that corroborated it, and how many separate PLACES in the query did — the
  dispersion test that separates a genuine further topic from a strong
  coincidental echo (§17.6).
- **Window coverage** — the fraction of a region's W-windows that are
  content-addressed; it SCALES the contrastive-margin bar rather than switching
  it, so grouping churn is not taxed as uncertainty and a 20%-attested region
  does not get a fully-attested one's exemption (§17.3).
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
  strength. The ladder has FIVE tiers — exact containers, single synonym, double
  synonym, then structural resonance (a synthetic gist composed from the two
  sides' own vectors, the one tier with no byte containment behind it, gated on
  both sides being exact AND individually discriminative, plus a self-evidence
  and a contrastive-margin check). Two asymmetries follow: only EXACT evidence
  may explain ordinary votes away, and only container-backed evidence may
  consume its endpoints. Additive pooling alone cannot surface a context zero
  regions individually voted for; cross-region evidence fills that gap (§17.8).
- **CAST (counterfactual transfer)** — substitution / redirection / comparison
  between independently learned structures the query weaves together. Alignment
  is **graded** (literal W-grams → halo-matched sites → the climb's own
  proposal, gated on literal dominance and non-frame); the weave is capped at
  query scale, aligned over the ASKER's stream only, and deduplicated by "one
  place, one structure". Frame gates are **derived** (`MIN_WEAVE` from the weave
  minimum, `dominates` from half-dominance) and **weave-local** (majority of
  _aligned_ structures, not corpus-global IDF). (§18)
- **Two-topic gate** — CAST's own single-vs-multi test, measured from the query
  rather than from how many points survived elimination: a second point must
  contribute a quantum of query bytes the widest point does not, OR the climb
  must report the query dispersed with the points elected a quantum apart and a
  quantum still unexplained (§18.3).
- **Ignored-known principle** — a mechanism standing on its weakest licence must
  account for every STORED window of the query; leaving the query's own trained
  content in its gaps is the byte-structural signature of a scrap match. Guards
  CAST's frame-tier comparison and the bridge (§18.4, §19.5).
- **Confluence join** — the meet of independent constraint streams by
  content-addressed identity: window IDs present in both anchors and absent from
  the query name the entity satisfying all constraints at once. Answers
  conjunctive queries ("Which X is A and B?") that no single-fact mechanism can
  resolve. (§18.5)
- **Skill / exemplar** — a learned fact shaped "answer-is-a-span-of-context",
  reusable as an extraction template on unseen text (§20).
- **Recall tiers** — the graded fallback for whole-query resonance: exact
  self-match, argument binding, clean resonance, scaffolding-dominated
  consensus, the nearest grounded hit, then the three REFUSAL-PATH tiers
  (substitution bridge, prefix completion, frame-filler substitution), then echo
  or silence. Each reports _what it matched_ (`accounted`), its _moves_, and
  `unexplained`, so the decider compares it against every other mechanism in the
  same currency. (§21)
- **Substitution bridge** — refusal-path grounding through corroborated
  substitutions: align the query byte-for-byte against a trained context and
  accept a mismatch only under corroboration, graded identity, and RAW BALANCE
  (the pre-expansion mismatch must be length-balanced). Its zero-substitution
  reading is the IDENTITY bridge, which is `complete` (§21.5).
- **Prefix completion** — the query is a proper byte PREFIX of exactly one
  trained form, which is then voiced whole. Guarded by unreadable-continuation
  veto, a sub-quantum floor, and uniqueness on the continuation BYTES. Repairs a
  retrievability gap no k can close (§21.5).
- **Frame-filler substitution** — INVENT A LOOKUP KEY, NEVER AN ANSWER: put a
  candidate filler where a definite description stands and require the store to
  already hold that key byte-exactly. Constituency is read relationally, from
  what a cohort of exemplars does NOT share (§21.5).
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
  reordered single-fact queries. (§18.3)
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
  unexplained byte dominates. Grade ties prefer the candidate carrying fewer
  scaffolding bytes into its answer, then the mechanism list's order (cover,
  CAST, confluence, extract, recall). The decider uses admissible-floor pruning
  (a mechanism whose best-case floor cannot beat the incumbent is never run) —
  and a mechanism whose floor itself needs expensive precomputation to refine
  checks the SAME incumbent before paying for it (§14.1, §14.2).
- **Scaffolding count** — answer bytes a candidate lifted from spans nothing
  recognised: the asker's own words carried through rather than derived.
  Reported, never priced — the ladder prices what is left _unaccounted_, and
  this orders candidates that tie on exactly that (§14.1).
- **Complete** — a mechanism's declaration that its result is a stored form's
  own continuation reached through an identity claim about the query, so
  post-grounding must not extend it (§14.1, §22).
- **Remainder** — the query bytes touched by neither the winning candidate's
  accounted spans nor any computed span; fusion fires only on a remainder of at
  least one perception quantum W (§14.1, §23).
- **Pivot** — the longest unconsumed learned context contained in the current
  answer; the stepping stone of multi-hop reasoning (§22).
- **Fusion** — grounding each independent point of attention and joining the
  results with learned connectors (§23).
- **Articulation** — re-voicing the answer in the asker's own words via halo
  siblings (§24).
- **Echo** — the last-resort output that returns a stored form verbatim,
  explicitly flagged as not grounded (§21.6, §26).
- **Provenance** — which grounding mechanism produced the answer; part of every
  response (§26).
- **Rationale** — the replayable trace of every rule application behind an
  answer (§26).
- **Meter / cost report** — the optional per-response accounting of the WORK an
  inference call performed, by layer and by nested phase. The profiling
  counterpart of the rationale: deterministic counters (diffable between runs),
  non-deterministic times, never read by inference (§26).
- **Conversation** — an accumulated context (the full exchange as one byte
  stream) plus turn-boundary offsets and answered spans. Turns append raw bytes;
  the fold advances incrementally; the weave aligns only the asker's stream
  (§24.5).

**Computation**

- **PipelineMechanism** — the ONE uniform interface every grounding mechanism
  (CAST, confluence, cover, extraction, recall, the ALU, any user extension)
  implements: an optional `parse` (authoritative computed spans, pre-loop), a
  `floor` (admissible lower bound), and a `run` (candidate answers). The
  pipeline never special-cases any mechanism by name or kind (§14.1, §16).
- **Precomputed** — the shared, response-scoped container every mechanism's
  `floor`/`run` (and the post-grounding stages) receive: eager fields
  (recognition, computed spans, guide, the evidence-breadth constant k) plus
  lazily-cached methods for the expensive structural analyses (the consensus
  climb `attention()`, the weave, span-shape classification, the identity-window
  reads and the shared reach memo), each computed at most once — async ones
  cached by promise, so concurrent askers await the same computation — reused
  across every consumer, billed to their own profiling phase, and never computed
  at all when no mechanism asks (§14.1, §14.2).
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
        │ 3. THE FOLD: content-defined cuts segment the stream; each segment
        │    folds FLAT (two-ended seat binding), and the segment roots group
        │    upward by cut LEVEL — every node at every scale delimited by
        │    content, never by absolute offset
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

### 10.2 Content-defined boundaries: why identity must not depend on offset

The naive fold groups a fixed number of items at a time, counting from byte 0.
That is fatal for a content-addressed store, and the reason is worth stating
precisely, because it is the single most consequential change in the perception
layer.

Under a fixed-arity grid, a byte's contribution is a function of its **absolute
offset**: the same run of bytes lands in different seats at a different
position, so it folds into a _different subtree_ and interns as a _different
node_. Insert one byte at the front of a stream and every downstream grouping
shifts; the shared material with the previous deposit stops being shared. The
size of the grouping quantum has nothing to do with it — any fixed modulus does
this, and identity must not depend on the fold's arity at all.

Sema therefore lets the **bytes choose where the stream segments**. A rolling
hash runs over a bounded window of the recent bytes; a cut is offered where that
hash vanishes modulo W. Because the decision reads only a bounded window, a
change upstream can move only the cut it falls inside — every downstream
boundary, and therefore every downstream segment, is unchanged. Since each
segment folds from its own seat 0, byte-identical content produces
byte-identical subtrees wherever it occurs, and hash-consing then makes it the
very same node id.

The rule is entirely mechanical, and every constant in it is derived:

- **The window** is W bytes wide, implemented as a cyclic polynomial (each byte
  enters as a table value and leaves rotated by the window width), so the
  register holds _exactly_ the last W raw bytes and nothing before them can
  reach the decision. The raw window is put through a two-round avalanche mix
  before the test, which is what makes the rule behave the same on a gradient or
  a sparse binary stream as it does on prose.
- **The cut rate** is one offer per W bytes (`mix % W === 0`).
- **The minimum segment length** is expressed _locally_, not as a count from the
  previous cut (a count carries the stream's initial phase forever, which is
  exactly the offset dependence being removed): a hit is taken only if the
  previous two positions did not hit.
- **The maximum segment length** is the keyring's seat count, because a segment
  folds as one flat node and the fold has exactly that many seats to bind
  children into. An over-long stretch is split at strides from its own start —
  content-relative, and rare enough (mean segment ≈ 5–7 bytes against a bound of
  8) not to reintroduce a systematic phase.

The expected segment is therefore `minLen + W − 1` bytes — deliberately coarser
than the fold's own arity. A segment is the flat **phrase-scale unit** the W-ary
groups are built _from_, not a group of W children; the mechanisms downstream
are fitted to that scale, and forcing the two to coincide was measured and
refuted.

This reads **bytes, never text**. Measured over 400 real deposits under 1–7 byte
shifts, downstream cuts survive 99.6–99.9% of the time and segments stay
byte-identical 98.3–99.2% of the time — and the three rows that matter (deposit
prose, non-Latin scripts, random binary) agree with each other. The arithmetic
grid, on the same corpus, preserves 14.3%: only the shifts that happen to be
multiples of the quantum. A boundary rule justified by where words or sentences
fall would be importing an assumption the architecture rejects; random binary
must, and does, behave exactly like prose.

### 10.3 The fold: segments, levels, and the tree above them

One rolling hash serves every scale. A cut is **level 0** when its mixed hash
vanishes mod W, **level 1** when mod W², and so on — so level-L cuts are by
construction a subset of level-(L−1) cuts, which is exactly the nesting a tree
needs. Levels are read off the hash the cut was accepted at, so they cost
nothing beyond the divisions already being done.

```
perceive(bytes):
    cuts, levels ← contentLevels(bytes)         # §10.2, one pass
    segments ← the byte spans between consecutive cuts
    row ← [ flatFold(s) for each segment s ]    # each segment = ONE flat node
    tree ← groupByLevel(row, levels, level = 1) # recurse upward
    normalize(tree.gist)                        # ONLY the finished root
    return tree

flatFold(segment):                              # 1 … maxSeats bytes
    gist ← Σₖ π_{s(k)} · alphabet[byteₖ]        # two-ended seats (§2.3)
    return a node whose kids are the segment's byte leaves

groupByLevel(items, levels, L):
    group runs of items separated by cuts of level < L; a cut of level ≥ L
    ends the group.  A group that would exceed the keyring is split at its
    STRONGEST interior cut (ties → the items' own content hash, so the split
    point is content-determined even where the levels are flat).
    if this level split nothing: climb to L+1 rather than spin.
    recurse on the groups until one root remains.
```

Properties worth noting:

- **A segment is one flat node.** Not a W-ary sub-tree: the cuts already claim
  the segment is a unit, and folding it flat is both lighter (one node instead
  of a group-plus-remainder pair) and the natural reading. Measured, splitting
  segments into `[W][rest]` cost 3,590 partial-arity nodes where the flat form
  costs 504, and inflated the distinct-node count by ~20%.
- **The shape above the segments is content's too.** Grouping segment roots
  W-at-a-time from index 0 would reintroduce, one level up, the very bug content
  cuts exist to remove: a form spanning segments 12…17 would straddle two groups
  and be no node at all. Level-based grouping makes every node at every scale
  delimited by content, so identity is offset-free at _all_ scales.
- **The tree is not a spine.** Joining segments left-nested would cost a node
  per segment on a single spine (a 3 KB deposit becoming a 450-deep chain of
  fresh D-vectors). Level grouping keeps the depth logarithmic in the number of
  segments.
- **Linear, not renormalized per level.** Only the completed root is normalized
  to unit length; every interior gist is left at its raw superposed length. This
  is a deliberate choice of similarity semantics, not a shortcut: an interior
  node's magnitude grows with the amount of content folded into it (§2.6), so
  the fold gives every span both an angle (what it resembles) and a magnitude
  (how much of it there is) for free, in the same vector. A single-leaf input is
  exempt — its "root" _is_ the shared alphabet vector, and normalizing in place
  would mutate the alphabet itself.
- **Every level is meaningful.** Intermediate nodes are not scaffolding to be
  discarded; each one is a content-addressable span with a gist — perception
  manufactures the _addressable sub-structure_ that recognition and attention
  later depend on.
- **W is the resolution quantum.** W sets the cut rate and the window width, and
  reappears throughout the system as the "one perceptual step" unit (the reach
  threshold, the near-dedup window, the canonical window lengths, alignment seed
  size).
- **Total on any input.** A level that fails to split, or a row that would
  exceed the keyring, falls through to a plain fixed-arity fold for that row —
  rare enough not to reintroduce a systematic alignment.

### 10.4 Growing streams: incremental folding and the stable prefix

Because a cut is decided from a bounded window, **cuts are stable under
append**: bytes added at the right edge cannot move a cut to their left
(measured over a growing 12-turn context: 100% of prior cuts survive every
append, zero tail churn). And because a level-0 segment is a pure function of
its own bytes, a segment whose byte span is unchanged can be _reused_ rather
than refolded — bit-identically, since reuse cannot change the tree, only skip
work.

Both the deposit path and the conversation path exploit this. A stream that
extends a previously folded one reuses every segment left of the new material
and refolds only the right edge, costing O(new bytes) instead of O(context); the
grouping above the segments is re-run whole, but it operates on segment roots (a
few dozen items for a several-hundred-byte context) and only its right edge
actually changes shape — measured at ~40 rebuilt nodes per turn, flat as the
context grows sevenfold.

The reuse carries one precondition, discharged structurally by every caller
rather than by care: the previous fold must be over a **byte-identical prefix**.
Reuse is keyed on a segment's offsets, which is what makes it O(1) per segment,
and offsets alone cannot witness that the underlying bytes agree — so the
deposit cache is keyed by the prefix's own bytes, and a conversation's fold
state advances only by append. A caller that cannot make that argument passes no
previous fold at all; the cold path is always correct.

Nothing about this imposes structure. The deposit path folds over the stream's
own content cuts and nothing else — it imposes no boundaries, knows nothing
about turns, and reads no convention out of the bytes. That train/inference
agreement is the whole contract: the node a context was trained as and the node
`resolve(query)` reaches must be the _same_ node, and the only way to guarantee
it is to give the deposit fold nothing extra to say.

**The stable prefix** is the one place a caller may impose boundaries, and it is
a different property from incremental reuse. Given a sorted set of proper byte
offsets, the fold splits there: each span between consecutive boundaries folds
independently and the segment roots join **left-nested**, so every cumulative
prefix reappears as an identical subtree — and, by hash-consing, the very same
node — inside the grown stream. That buys prefix-_root_ identity, which a
conversation's state machinery may want; conflating it with incremental reuse
once put an imposed boundary set on the inference path and left it folding
differently from the deposits it was querying.

Perception can also detect a stable prefix itself, when handed the store's
lookup capabilities: the longest **proper** prefix of the stream whose
leaf-sequence is already a known flat branch becomes a boundary. The prefix must
be proper — a full-length match would mean the entire input is already stored,
and splitting there would hide the input's own internal structure.

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

Interning is memoised by tree-node identity. Because a grown stream shares its
prefix's subtree _objects_ with the previous deposit (§10.4), a node already
interned needs nothing again — its id is permanent and its intern-time side
effects fired at first mint — so a memo hit skips the whole shared subtree and
the intern walk costs O(new nodes) per deposit rather than O(context).

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

Content-defined cuts make a segment's identity offset-free, but they still cut
_somewhere_: a meaningful unit (say, a name) may straddle a boundary and never
be a node of any tree. Deposition therefore additionally interns **sliding
windows** of W and W−1 leaves across the stream, as flat branches — the two
lengths being the quantum and its off-by-one neighbour, so a form straddling a
seam is reachable from either cut. (Widening this to the reader's full segment
scale was measured and refuted: it tripled the store and slowed ingest 80%
without fixing a single test.) A window that does not coincide with a structural
child of any chunk is linked to the chunk(s) it overlaps by a durable
**containment edge** — a second, weaker parent relation meaning "these bytes
occur inside that chunk". When a later climb starts from such a window (which
has no structural parents of its own), it climbs through its containment parents
instead. This closes the recognition seams that any chunking, however chosen,
leaves behind.

Deposition also interns the **whole stream as one flat branch** (the sequence of
its byte-leaves). This gives every deposit a canonical byte-level identity
independent of tree shape — the form the stable-prefix check of §10.4 looks up,
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

**Suffix propagation.** One edge per pair would make a learned fact reachable
only from the _whole_ context that carried it — a problem for cumulative
contexts, where the same question arrives with a different amount of history in
front of it. So when a pair is deposited, every right-edge **suffix** of the
context is checked, and a suffix that is itself an established form inherits the
same continuation edge. Two disciplines keep this cheap and honest:

- The scan is gated by an existence probe, not by perception. Every deposit
  interns its whole byte stream as a flat branch of per-byte leaf ids (§11.3),
  so a suffix is a stored form exactly when that flat twin exists — one
  content-hash probe per offset, and only a hit pays for the deposit-shaped
  fold. The scan is skipped entirely for contexts shorter than 2W.
- The inheriting suffix must already be **established**: reused across deposits
  (at least two structural parents), or bearing a halo _and_ already an edge
  source. A suffix that is merely someone's answer does not qualify.

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


deposit(input, tracked, conversational):
    bytes ← flatten(input)
    tree  ← perceive(bytes, reusing the segments of any cached fold over a
                     byte-identical prefix)          # §10.3, §10.4
    ids   ← intern every node of tree, bottom-up     # §11.1 (memoised by
                                                     #  tree-node identity)
    intern sliding W / W−1 windows; record containment edges     # §11.3
        (windows wholly inside chunks the previous deposit already
         interned are skipped)
    intern the whole stream as a flat branch                     # §11.3
    changed ← if tracked and a previous deposit exists:
                  the maximal new subtree vs. the previous deposit  # §12.2
              else: [ tree ]
    if conversational: cache this fold's segments under the stream's bytes
    return (tree, rootId, ids, changed)


ingestOne(input):                                    # a bare experience
    (tree, root, ids, _) ← deposit(input, tracked = true)
    mark root as a resonance target                  # §12.3
    parts ← the root's immediate children
    if |parts| > W:
        link parts[i] ──▶ parts[i+W]  for each stride-W step   # §12.1
        link the last strided part ──▶ the final part, when the stride
            does not land on it exactly (no tail is left unreachable)
    else:
        mark each part as a resonance target


ingestPair(context, continuation):                   # a fact
    (ctxTree, ctxRoot, ctxIds, changed) ← deposit(context,      tracked = true,
                                                  conversational = true)
    (conTree, conRoot, _,       _     ) ← deposit(continuation, tracked = false)

    link  ctxRoot ──▶ conRoot                        # the fact itself
    propagateSuffixes(ctxRoot, conRoot)              # §12.1: established
                                                     # suffixes inherit the edge
    for each part in changed:                        # distributional evidence
        pour halo(part)    += π₁ · companySignature(conRoot)
        pour halo(conRoot) += π₀ · companySignature(part)
    # linking / pouring admits both subtrees' interiors to the content
    # index (lazily), per §12.3
```

Costs, in broad strokes: perception is linear in the input length (and, for a
stream extending an already-folded one, linear in the _new_ bytes); interning is
one content-addressed lookup per tree node, dominated by the O(n) leaves;
relation learning is O(1) edges plus O(changed parts) halo pours, plus one
content-hash probe per suffix offset. Nothing in the deposit path scans the
corpus. **Training a fact takes one pass over the fact.**

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

**10. The canon index is batch-built, never maintained on the write path
(equivalence viability).** The canonical-form index (§3.4) is built by a scan
over content-bearing nodes, run after training and refreshed incrementally
afterwards — the last indexed id is remembered in store metadata, so a refresh
after further training visits only new rows. Keeping it current per deposit
would put a canonicalization (a Unicode normalization, in the text case) on the
hot write path for a capability that is a _fallback_ on the read path. The
trade: a store that has never built the index simply has no canonical fallback —
exact resolution is unaffected.

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
  │     residually.  Grade ties prefer the candidate that carries    │
  │     fewer unrecognised query bytes into its answer, then the      │
  │     mechanism list's own order.                                   │
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
  │                — skipped when the winner declared itself COMPLETE  │
  │ FUSE   (§23)   ground the query's OTHER points of attention and    │
  │                join them with learned connectors — only when a     │
  │                genuine REMAINDER of ≥ W query bytes was touched by │
  │                neither the winner's evidence nor any computed span │
  │ ARTICULATE(§24) re-voice the result in the asker's own vocabulary  │
  └──────────────────────────────┬────────────────────────────────────┘
                                 ▼
  answer bytes  +  provenance  +  (optionally) the full rationale
```

#### The tie-break: at equal grade, prefer the answer that invents less

Weights are compared at STEP resolution (`grade = ⌊weight/STEP⌋`), so sub-STEP
bookkeeping never decides a cross-mechanism choice. The ladder prices what a
candidate leaves _unaccounted_, which is the right primary question but cannot
separate two candidates that leave the same bytes unaccounted. What still
separates them is what they _did_ with those bytes: a candidate that carries an
unexplained span into its answer is passing the asker's own words back as if
they were derived; one that leaves them out has made a smaller, honest claim. So
at equal grade the candidate reporting fewer **scaffolding** bytes (answer bytes
lifted from spans nothing recognised) wins. Measured on a two-fact chain: cover
and recall both graded 11001 over 11 unexplained bytes, cover answering "The
capital of France is Paris famous for" — 11 bytes of scaffolding — against
recall's 0, and only the list order decided it, in favour of the shallower
reading. This never overrides the ladder; it orders _within_ one grade. Only
when scaffolding also ties does the mechanism list's own order stand (cover,
cast, confluence, extract, recall).

#### Completeness

A mechanism may declare its own result **complete** — a stored form's own
continuation, reached through an identity claim about the query. Post-grounding
then leaves it alone: a further multi-hop pivot could only chain _past_ the fact
that produced the answer. This is the same reasoning the multi-hop stage's echo
guard applies to a query that resolves exactly (§22), carried by the mechanisms
that establish the identity by another route. Observed without it: a correct
"What is the process of photosynthesis?" grounding was pivoted forward four
times, out of the fact that answered it and into an unrelated conversational
turn. The decider honours the property and never asks which mechanism set it —
the market stays uniform.

#### Diagnostics

The decider also emits diagnostic signals — purely observational, never
affecting the decision itself:

- **Unexplained label** — every candidate carries `unexplained`, a
  human-readable label for the query bytes its evidence left on the table.
  Appears in the rationale trace; does not affect the weight (the PASS-per-byte
  pricing already accounts for it arithmetically).
- **Grounding decision data** — the `decideGrounding` step carries a structured
  payload: every candidate's provenance, exact weight, discrete grade,
  unexplained byte count, and which one was decided, plus the runner-up's grade
  margin. The same numbers the human-readable labels carry, exposed as data so a
  downstream tool need not parse free text.
- **Narrow decision** — when the winner beats the runner-up by ≤ 1 grade unit,
  the rationale records a `narrowDecision` step. A margin of 0 means the
  tie-break above decided — the answer could change with one more training fact.
- **Thin grounding** — when the winning candidate's density (fraction of query
  bytes actually accounted for by learnt structure) falls below `1/W` (the
  smallest fraction the store's perceptual window can discriminate), the
  rationale records a `thinGrounding` step. The answer stands; the label is a
  signal for downstream consumers that the grounding is sparse.

#### Why fusion is gated on a remainder, not on provenance

`accounted` is a **cost-ladder** quantity, not a coverage one: the cover
deliberately leaves its masked computed spans out of `accounted` so that
PASS-bridged bytes are still charged. A query fully explained by one computed
span plus bridged connectors can therefore report `accounted: []` while nothing
is actually left unexplained. The genuine remainder is what _neither_ the
winner's accounted spans _nor_ any mechanism's computed span ever touched — and
a remainder under one perception quantum W is bridging punctuation or
whitespace, never a second topic. (Observed: a single space between two fully
computed arithmetic spans registered as unaccounted, pulled in an unrelated
corpus fact, and corrupted "4 6" into "4 63".) The same distinction is read a
second time for _position_: fusion places the primary answer by its accounted
spans when it has any, and by its computed spans when the grounding is a pure
computation with no anchor of its own.

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
                        │ pivotInto · meaningOf             │
                        ├───────────────────────────────────┤
                        │ recall's refusal-path tiers      │
                        │ (§21.5): substitutionBridge ·     │
                        │ prefixCompletion · frameFiller    │
                        └──┬──────────────┬────────────────┘
                           │              │
 L2  DECOMPOSITION      ┌──▼──────────┐ ┌─▼────────────────────────────┐
     & TRAVERSAL        │ recognition │ │ traverse: edgeAncestors ·    │
                        │ (§15):      │ │ nextOf/prevOf · contains ·   │
                        │ sites/      │ │ chooseNext / chooseAmong     │
                        │ leaves/     │ │ (§25) · hubCap (§8.8) ·      │
                        │ splits/     │ │ atomReach · reachOf ·        │
                        │ starts      │ │ leadsSomewhere               │
                        │ + canonical │ │                              │
                        │   contract  │ │                              │
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
| recall tiers 0–1 (§21)  | identity / whole-query gist       | both                     | scale-aware identity bar      |
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
  non-ordering bookkeeping and must not decide a cross-mechanism choice) go to
  the candidate that carries fewer unrecognised query bytes into its answer, and
  only then to the mechanism list's own order (cover, cast, confluence, extract,
  recall) — cover runs first not because it is prioritised over the others by
  fiat, but because a computed span (§16) masks in at near-zero cost, which then
  prunes the rest through the SAME admissible-floor mechanism every mechanism is
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
**leaves**, the **splits** where a form boundary falls inside a leaf, and the
**starts** (the offsets the query's own fold cut at) — is the raw material of
every downstream mechanism.

Everything here is a bounded number of O(1) content-addressed probes per byte —
never a scan of the corpus. Two complementary readings run over the query, and a
third pass cleans up what both leave behind.

### 15.1 The structural reading

Perceive the query (the same fold as ingestion) and walk its own tree, asking
the store, bottom-up, to name each subtree: leaves by their bytes, branches by
their children's ids. Because perception is deterministic, any part of the query
that was ever deposited _as it appears here_ folds into the identical subtree
and is named exactly. A subtree that misses the exact lookup is retried through
canonical equivalence (§3.4), so a form differing only in surface reaches its
stored node.

Within each segment, contiguous sub-runs of leaves are probed too, and the
segment's own **edges are trimmed** at several offsets — a content cut lands
inside a unit, so the form the cut split sits against the segment's edge, and
probing the segment minus its first or last k bytes recovers it. Duplicate
(span, node) sites from different probes are collapsed: the same span must count
once, or the cover search's cost model gives that span double weight.

### 15.2 The canonical reading

The query's own fold may cut the stream differently from how training cut it.
The canonical reading re-derives the _store's_ segmentation directly on the
query's bytes: at each position, chain the known single-byte leaves forward and
probe each growing sequence as a flat branch, up to the canonical chain reach
(W² positions — the deepest two-level composite the write side's windows can
spell). This recovers forms _as training stored them_, regardless of how the
query happens to segment. Where such a form's boundary falls strictly inside one
of the query's leaves, that position is recorded as a **split**: the search may
later cut the leaf there (§19.3).

A third pass then probes the query's own **edges** beyond the canonical chain's
reach, because the first and last forms of a query are the ones a chain bounded
at W² is most likely to truncate.

### 15.3 What counts as a site

Three admission rules, each of which exists because its absence produced a
specific fabrication:

1. **It must lead somewhere.** A recognised span is admitted only if its node
   bears a continuation edge or a halo. A form that leads nowhere contributes
   nothing to any derivation, so recognition filters it out at the source.

2. **It must span at least one perception window.** Below W, byte overlap is
   chance rather than evidence — the same principle the identity bar states and
   the substitution bridge's attestation applies. This _replaces_ a false
   premise it once shared with the cover's fusion rule: both used to ask "does
   this offset sit on a fold boundary?", which under a fixed-arity fold meant
   the offset was a multiple of W and carried **zero** content information. The
   exemption therefore fired at a quarter of all offsets by arithmetic alone.

3. **Byte atoms are admitted only while atoms can still discriminate.** On a
   small store a single-letter fact is genuine learnt content and its site is
   essential; past the atom-hub bound (§8.8) every letter of every query would
   otherwise become a "recognised form" — the bridge then finds connectors
   between bare letters, the cover follows edges hanging off them, and pure
   noise grounds to an arbitrary learnt sentence instead of silence. Atoms stay
   available as leaves (PASS-carried literals) and through exact tier-0
   resolution regardless.

```
recognise(query):
    sites, leaves, splits, starts ← ∅
    atomsAreHubs ← atomIsHub(N)                                   # §8.8
    emit(start, end, id):
        reject if id is an atom and atomsAreHubs
        reject if end − start < W
        reject unless leadsSomewhere(id)      # edge or halo, via probes
        add once (span, id)

    # structural
    tree ← perceive(query)
    for each subtree s of tree (bottom-up, with byte offsets):
        id ← store lookup of s, else canonResolve(s.bytes)        # §3.4
        emit(span(s), id)
        within a segment: probe contiguous sub-runs, and the segment
        with k bytes trimmed from either edge

    # canonical
    for each position p:
        chain known leaves from p, up to W² positions; emit every chained
        prefix that is a known flat branch
    # query edges, beyond the chain's reach
    probe the query's own leading and trailing spans directly

    splits ← form boundaries falling inside a perceived leaf
    starts ← the offsets the query's own fold cut at
    return (sites, leaves, splits, starts)
```

### 15.4 Why the recognition memo is not an optimisation

Recognition is memoised by query content, and that memo is **always** consulted
— including while a rationale trace is attached, which is the one place the
system otherwise deliberately bypasses its memos (§14.2).

The reason is a genuine non-idempotence. The structural walk resolves subtrees
through a cache keyed on tree-node identity, and a conversation's incremental
fold deliberately shares node _objects_ across turns (§10.4). By the second call
on the same bytes, large parts of the tree are already cached, the walk stops
short of recursing into them — and therefore stops **emitting their sites**.
Observed live: 31 sites on the first call, 5 on an immediate repeat. Skipping
the memo while tracing meant every traced turn re-ran recognition from scratch
at each of the many call sites that recognise the same query, each call silently
more incomplete than the last — measurably changing which mechanism grounded the
answer, not merely costing time. The trace step still fires on every call, so a
cache hit is never silent.

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
four neutral capabilities it already has — resonant **meaning** matching (which
of some labelled forms does this span mean?), grounded **continuation** lookup
(where does this form lead?), geometric **segmentation** (coherent runs by the
perception tree's own structure, so an extension's notion of "separator" is the
learnt geometry's), and the perception window W as its **reach** — through the
`ExtensionHost` port. It learns nothing about what the extension computes, and
nothing in the port names any particular extension.

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

### 17.2 Regions: the three sources of query evidence

A **region** is a span of the query offered as a voter. They come from three
sources, each answering a different reading of "what parts does this query
have?"

1. **Fold nodes.** Every branch of the query's own perceived tree, walked
   post-order and resolved against the store as it goes (so each region knows
   whether its bytes name a stored node). A region that _dominates_ the query
   (§8.7) is admitted only when it is the sole structure — a broad wrapper
   cannot discriminate between topics. Segments themselves are exempt from that
   filter: a segment is the smallest grouped unit, wrapping nothing, so it can
   never be the wrapper the rule excludes. (Subdividing a long segment into
   W-scale tiles was measured and refuted: it reintroduces a fixed stride inside
   the segment, and the extra votes reorder the climb. A region must come from
   the fold, not from a stride over it.)

2. **Recognised sites.** Content-addressed nodes the query literally contains
   (§15). A site _is_ an exact structural anchor where a fold region is
   approximate, and it fills the gap the fold creates: a word the cut splits is
   two partial gists that may not resonate distinctively, while the site names
   the whole word by identity. Sites carry their **node id** with them — a site
   that claimed exactness while dropping its identity forced the climb to
   re-derive the anchor through the ANN, so which stored node an exact site
   voted with turned on approximate rank. Sites are never marked as chunks: they
   overlap each other and the fold's segments, and the saturated-interval
   builder (§17.5) requires disjoint regions in byte order.

3. **Forms the query's own cut split** (_corroborating_ regions). The fold walk
   enumerates fold nodes only, so a stored form the content cut happens to split
   is not addressable at all — however discriminative it is. Measured:
   `request_id=1042` against a 200-record log, cut as `...uest_id=|10|42 and r`,
   where "1042" reaches exactly one context of 205 (maximal IDF) and cast no
   vote, while the scaffolding "=10" — matching every record 1000–1099 — did.
   The write side already made these reachable (§11.3 interns each form at both
   canonical window lengths precisely so one straddling a cut resolves from
   either side); the read side simply never used the guarantee. So every
   W-window that resolves, is not already inside a fold region, and climbs
   somewhere non-saturated is admitted — and **overlapping admissions are
   coalesced into maximal spans**, because admitting every resolvable window is
   a redundancy problem, not a threshold problem (on a 5-context corpus, 26
   bytes yielded 17 "unique" windows that were all fragments of one word;
   coalesced, they yield the one span that word belongs to). These regions are
   marked **corroborating**: they are evidence for someone else's anchor, never
   points of attention of their own — the query never wove them as independent
   structures, the fold did.

### 17.3 Voting: the per-region evidence ladder

```
voteRegions(query, regions, k, N):
  for each region r:

    # ── how exact is this region? ────────────────────────────────────
    # `known` used to mean "these bytes resolve to ONE stored node", which
    # conflates two things: whether the store has seen the content, and
    # whether THIS query's cut grouped it the way the deposit did.  Under
    # content-defined cuts those routinely differ.
    cov ← 1                       if the whole region resolves
        ← fraction of r's W-windows that resolve   otherwise
        ← 0                       if r is shorter than one window W
                                  (below one window, byte identity is chance)
    known ← cov ≥ 1

    # ── choose the anchor: EXACT FIRST, ANN only if needed ───────────
    anchor ← r.id                       # a site: exact, carries its identity
           ?? canonicalChunkId(r.bytes) # a segment's canonical identity
           ?? contentIndex.nearest(r.gist, k)[0]
    # The ANN query is DEFERRED behind the exact path and paid only when
    # actually consulted (the fallbacks and the margin below) — on
    # segment-heavy queries this removes the resonate() call for most
    # regions, the single largest remaining inference sink.
    score ← 1 for an exact anchor (identity, not an estimate); else the hit's

    # ── a diluted segment votes with the span that carries its evidence ──
    # A content segment folds FLAT, so its gist superposes every one of its
    # bytes: an entity inside a longer segment is averaged with whatever
    # scaffolding shares it.  Measured: `ike stee` resonates to the WRONG
    # deposit at 0.297 while the sub-span `stee` resonates to the right one
    # at 0.627.  Entered only after the exact path failed; candidates are the
    # segment's two EDGE W-spans (a cut lands INSIDE a unit, so the remnant
    # sits against the cut); selection by score²·idf — the same quantity the
    # vote is weighted by, never score alone.  The region's SPAN narrows with
    # its gist, so breadth, clusters and cross-region pairing all see where
    # the evidence really sits.

    reach ← expandUntilDecided(anchor)                        # §17.5
    if reach has no roots and is not saturated:
        ORPHAN FALLBACK — walk the remaining hits nearest-first; the
        top-ranked anchor climbing nowhere is an accident of approximate
        ranking, not evidence the region relates to nothing.
    else if reach is saturated and the anchor was approximate:
        SATURATED-TIE FALLBACK — a hub may only claim its abstention when it
        is DISTINGUISHABLY nearest.  Two scores against one query differ by
        √2× the estimator's error ≈ 1/√D, so any hit within that band is the
        same rank at measurement resolution; the first tied hit that climbs
        somewhere non-saturated votes instead.  Beyond the band the hub is
        genuinely nearest and its abstention stands.  An exact anchor never
        enters: its identity is not an estimate.
    if reach is saturated: the region ABSTAINS                # §17.5

    idf ← ln(N / contextsReached);  df ← ln(1 + contextsReached)
    wf  ← idf | df | idf + df       # the DF MODE — see §17.4
    if wf ≤ 0: ABSTAIN

    # ── contrastive-margin gate (approximate evidence only) ──────────
    margin ← score − (score of the best hit reaching a DIFFERENT conclusion)
    if margin ≤ estimatorNoise(D) · (1 − cov): ABSTAIN

    mutual ← min(1, score·ratio) · min(1, score/ratio)        # §17.4
    vote (mutual · wf)/|roots| for each root reached, and
         (mutual · idf)/|roots| as the FOCUS weight
```

Three details of that ladder carry their own arguments:

- **Coverage scales the bar; it does not switch it.** Measured over 42 voting
  regions, `known` as a boolean loses a wide band: 43% of "unknown" regions are
  _partially_ content-addressed and 5% are _fully_ addressed while failing the
  whole-region test — grouping churn taxed as uncertainty. Promoting the partial
  band wholesale is over-crediting (it grants a region attested one window in
  five the same exemption a fully attested one gets). So a region pays the
  estimator's noise floor _in proportion to how much of it is not
  content-addressed_: cov = 1 pays nothing, cov = 0 pays the full floor. No new
  constant — the floor is unchanged and the coverage is read off the store by
  the same content addressing.

- **The margin gates; it does not scale the weight.** A surviving region votes
  at its genuine strength. Using the margin as a multiplier conflates
  "discriminative" with "strong": a genuinely discriminative span whose rival
  happened to score close got a tiny vote, systematically compressing correct
  scaffolding-dominated groundings below the consensus floor so they grounded
  nothing.

- **Sub-window regions vote, but not as exact.** Below one window a three-byte
  string is interned by triviality rather than by evidence. Such a region is not
  dropped (dropping them cost 35 tests — short regions do carry real evidence);
  what it must not carry is the exact tier's full mutual weight and its
  exemption from the margin. Measured: a three-byte segment voting exact at
  mutual 1.00 with idf 4.22 pushed an unrelated exemplar past the consensus
  floor and licensed CAST to compare content the query never named.

### 17.4 The weighting: document frequency, and mutual explanation

A region that climbs to few contexts is _specific_ — strong evidence about what
the query concerns. A region that climbs to half the corpus says almost nothing.
Weighting by ln(N/c) — the classical inverse-document-frequency form (Spärck
Jones 1972) — expresses exactly this, with N the store's count of learned
contexts, and dividing by the number of roots reached splits a region's voice
among the candidates it cannot distinguish. Two further readings of the same
reach are available and selectable (`inverse`, `direct` = ln(1+c), `combined` =
their sum); inverse is the default every mechanism uses, the others exist for
corpora where commonality itself is the signal.

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
cosine approximated implicitly, made explicit and safe at every scale. The
magnitude read is itself capped at len·D — beyond that the mutual weight is
already ~0, so no full walk of a huge hit is ever paid for.

The margin gate that precedes this weighting (§17.3) stays in raw cosine units
deliberately: it tests the RaBitQ estimator's own noise floor, which lives in
cosine space, not in byte-magnitude space.

### 17.5 Saturation: expand-until-decided

The climb's work is bounded by **expand-until-decided**: the walk stops as soon
as it knows whether the reach is saturated (the material is too common to
discriminate) or a concrete vote (exact roots and contextsReached). Five
decisions can end it, each recorded by name in the trace, and each reached
through LIMITed store reads only:

- **Predecessor fan-in.** `prevCount` — an indexed O(1) count — decides "≥ √N
  distinct contexts" without materialising the predecessor list.
- **Distinct-context limit.** The set of learned contexts visited crossing √N
  decides saturation by a set-size check.
- **Parent fan-out.** `parentsFirst(id, √N+1)` — reading √N+1 parents proves
  "more than √N" exactly. Below √N the read _is_ the full parent list, so the
  walk is exact.
- **Lateral-cone limit.** The accumulated cross-structure entries of the whole
  climb crossing √N (§8.8).
- **Byte-atom commonality.** An atom whose uniform-expectation floor N·W/256
  exceeds √N (§8.8).

Two more disciplines bound the work without bounding the evidence: **containment
paging** (a window's containers are paged in chunks of √N, so a distinctive
window's containers are walked in full while a common window's corpus-sized list
is abandoned at the first saturated page) and the **transparent-chain hop**
(§8.8). The whole climb is memoised per start node in a **shared reach memo**
that lives as long as the store is unwritten — ordinary and conversational asks
share it, every ingest invalidates it, and a traced response always gets a cold
one.

A region whose climb triggers any "decided: saturated" condition abstains rather
than vote noise. Saturation is also _recorded_: a leading saturated stretch of
the query (a boilerplate preamble) is treated as scaffolding, and further points
of attention are only admitted beyond it. The dual use — abstain from voting,
and mark scaffolding — is what keeps long templated queries from diluting their
own payload.

### 17.6 Pooling and commitment

Votes accumulate through the **arithmetic semiring** (§5.3), run through the
very same `lightestDerivation` engine the cover search uses: each surviving
region is an axiom, each (region → anchor) contribution is a summing rule, and a
vote for a _terminal_ answer node redistributes to the ≤ √N contexts that lead
to it. Independent corroboration ADDS — a pooled-evidence decision is one
weighted rule of the same deduction system, not a hand-rolled tally alongside
it.

Each ranked anchor then carries four read-outs, and they answer different
questions:

| Field         | Meaning                                                                                             |
| :------------ | :-------------------------------------------------------------------------------------------------- |
| **vote**      | the pooled sum — grows with how many places corroborated                                            |
| **peak**      | what the strongest single contributing region said on its own                                       |
| **start–end** | that same strongest region's query span — the minimal honest statement of what a grounding rests on |
| **breadth**   | the fraction of the query's own (non-corroborating) regions whose evidence this anchor accounts for |
| **clusters**  | how many distinct PLACES in the query corroborate it, merging contributors closer than W            |

The distinctions are load-bearing. A consumer holding a point to the consensus
floor — a bar priced for _one_ region's maximally discriminative evidence — must
read **peak**, not vote: six scaffolding regions summing past the floor is not
the same claim as one region clearing it. And `start–end` is the argmax region,
not a hull over every contributor: widening it to everything that voted made
recall out-bid mechanisms that had genuinely explained more.

**Breadth** is the scale-invariant confidence the raw IDF vote cannot give (an
absolute, ln N-scaled quantity means "strong" on a small store and "weak" on a
large one for the same degree of genuine consensus). **Clusters** answers a
different question again — not how _much_ evidence, but how many separate places
carry it. Both breadth and raw region count were tried as the further-topic gate
and falsified: breadth starves a genuine, evenly split multi-topic query (no
root in a real N-way split can exceed half the vote), and raw count does not
separate a short structurally simple echo from a real topic. A coincidental
match is structurally confined to _one_ cluster however strong its vote; a
genuine further topic is named in its own distinctive wording somewhere the
scaffolding does not reach, always a separate cluster.

Commitment then proceeds down the ranked list:

- The first non-overlapping anchor is **dominant** and always grounds; only the
  leading-saturation gate applies to it.
- Any **further** anchor must clear both the **natural break** (the steepest
  ratio drop in the sorted votes — a scale-free "where does signal end" test)
  and the **consensus floor** ln N + ½ (§8.6), and must lie past any leading
  saturated stretch. The floor matters because the natural break is scale-free
  but not floor-free: on a large, topic-diverse corpus the steepest ratio in a
  long noise tail can sit far below any real signal.
- An anchor overlapping one already placed is absorbed, never re-elected.

The natural break is read over the anchors the **query itself pointed at** —
votes standing only on corroborating evidence (§17.2, source 3) are excluded
from the distribution. They are exact, hence high-IDF, hence they land at the
top and shift the cut; a two-topic query then elects three roots.

### 17.7 What consumes the climb

The climb is computed once per response (memoised by query content, k and DF
mode) and consumed by five mechanisms: recall's scaffolding tier (§21), CAST's
identification of woven structures (§18), confluence's constraint-stream
detection (§18.5), extraction's search for a skill exemplar (§20), and fusion's
grounding of further topics (§23). The cross-region pass (§17.8) runs inside the
climb, consuming its region votes and the shared junction ascent.

### 17.8 Cross-region attention: the binding problem

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

**The graded ladder — five tiers, exact before approximate.** The pairing walks
one ladder and stops at the first tier that finds anything, all tiers sharing a
single walk budget and the per-response walk cache:

1. **Exact** — containers of the two forms themselves, by content-addressed DAG
   ascent, order-free.
2. **Single synonym** — the same ascent with one side replaced by a halo
   sibling.
3. **Double synonym** — both sides replaced.
4. **Structural resonance** — the only tier with no byte containment behind it,
   reached only when every DAG tier found nothing _and_ no already-corroborated
   region sits between the endpoints (a between-region with its own vote means
   the gap already means something specific; an ANN guess must not override it).
   Each side's own gist — and the literal middle bytes, when there are any — are
   composed positionally into a **synthetic gist** (§2.3's algebra applied to
   existing vectors, never to a concatenated byte string, and never interned),
   which is resonated into the content index. Because nothing byte-level backs
   it, this tier is gated much harder than the DAG ones: **both** sides must be
   content-addressed _and_ individually discriminative (a shared,
   non-discriminative preamble can be exact without being evidence of anything,
   and composing its gist manufactures a plausible-looking but spurious
   neighbour); the pair must satisfy the same phrase-scale contract the DAG
   tiers hold their glue to; a candidate whose reach is exactly one side's _own_
   already-voted conclusion is rejected as self-evidence (that is the side's
   resonance rediscovering itself through a gist still dominated by its own
   direction); and the selected proposal must beat the best differently-
   concluding rival by more than the estimator's noise floor. Proposals are
   ranked by ANN score × the semantic confidence of the sibling substitution
   that produced them, so an exact-sided variant outranks a double-synonym one
   at equal ANN score.

Two asymmetries follow from where each tier's evidence comes from, and both are
deliberate:

- **Only exact evidence may explain votes away.** Single-synonym, double-synonym
  and structural-resonance junctions may _add_ supporting evidence but never
  remove it: their own evidence is a substitution or a guess, and letting their
  byte containment behave like exact containment would let an approximation
  override a genuine, independently voted region.
- **Only container-backed evidence consumes its endpoints.** Consuming a
  candidate asserts "its evidence is already composed at full joint strength" —
  a claim only a real container can make. A structural-resonance pick has none,
  so consuming its endpoints would lock up candidates on the strength of a
  guess. Measured: a resonated pair consumed "red", after which "red" ▸ "circle"
  was never probed and the exact junction `red circle` — a stored whole, sitting
  right there — went unfound. Both votes now stand and pooling decides between
  them, which is what the mechanism market is for.

**Voting.** A joint container found by a DAG tier is **exact** evidence — it
literally holds the composed forms — so it votes at full strength (score = 1, no
estimator); a synonym or structural pick votes at its own confidence instead.
Weighting is otherwise the same mutual-explanation and IDF discipline as
single-region votes, with the combined byte length of all composed candidates as
the region size. A junction whose every composed part is a _corroborating_
region (§17.2) inherits that flag: composing two forms the query's own cut split
does not weave a point of attention, and without the inheritance such evidence
re-entered the root election as a first-class anchor (measured over the suite:
130 accepted junctions, 44 standing on at least one corroborating region, and 12
standing on nothing else — precisely the leak). One genuine fold region among
the parts means the query did point here, and the junction anchors on it.

The combined pool (independent votes, minus any superseded by exact cross-region
evidence, plus the cross-region votes) means a joint context with no
single-region support can still become a point of attention when its combined
evidence clears the consensus floor (§8.6).

---

## 18. Grounding I — counterfactual transfer (CAST)

### 18.1 When it applies

Some queries do not ask about one learned thing; they _weave together several_ —
"what if X had Y's property?", "compare X and Y", a sentence that grafts one
learned frame onto another's subject. CAST (Counterfactual trAnSfer) detects the
weave by **graded alignment** — the same evidence ladder as `locate()`: literal
W-gram runs first, then distributional role, then the climb's own conclusion. It
transfers structure between the woven parts. CAST is the byte-level, formalized
descendant of case-based reasoning's _adaptation_ step (Kolodner 1992).

Its preconditions are all structural (per invariant §14.2), and each one is a
separate refusal with its own trace note:

1. the query is at least two perception windows long, and something has been
   learnt;
2. the climb (§17) ranks at least two anchors;
3. the weave (§18.2) leaves at least two aligned points that are genuinely **two
   topics** (§18.3);
4. at least one aligned point is a **committed root** of the climb — CAST
   refuses to transfer through content the climb itself never settled on;
5. something is actually **woven**: some aligned run falls outside every
   recognised site, _or_ two points in the current turn restate two _different_
   sites (which is exactly what a comparison naming both entities looks like).

The last one carries a conversation-specific clause. A multi-turn query is the
whole transcript, so an earlier turn's own question is an aligned point too —
traced: the weave for "And what is the capital of Spain?" holds "What is the
capital of France?" beside the new question. Two points, two named sites, and
nothing woven at all: one of them is conversation history. So the "two different
sites" reading requires both points to have evidence in the **current turn** —
the bytes past the last answered span. Single-turn queries have no answered
spans, so the current turn is the whole query and nothing changes.

If any of this fails, CAST returns nothing and the grounding decider considers
the remaining candidates.

### 18.2 The weave: graded alignment over the asker's own stream

The weave is a shared, lazily computed analysis (§14.1), not CAST's private
machinery. For each of the first k ranked anchors:

1. **Literal** — `alignRuns`: W-gram seed-and-extend. Every W-gram of the query
   is indexed; each W-gram of the context that matches seeds a run, extended
   greedily in both directions; overlaps resolved longest-first. Weight = 1.0
   (exact match is full evidence).

2. **Halo** — where the query has no literal coverage from this anchor,
   recognised sites with halos are matched to the exemplar context's own sites
   (gate: the concept threshold). The run's weight is the cosine itself —
   measured evidence, not an invented constant.

3. **The climb's own proposal** — a second pass, after every literal run is
   placed. `alignRuns` seeds on W-grams, so two forms differing by a single byte
   share no run at all: on "How is ice like steel?" against a store holding "Ice
   is cold", the query's "ice" and the stored "Ice" agree on only three bytes
   and are never seeded, so that structure entered the weave carrying nothing
   but the scaffolding every exemplar shares. The climb had _already_ identified
   it — electing "Ice is cold" from one span and "Steel is hard" from another,
   through gates the aligner has no equivalent of. So the climb **proposes** the
   pairing (which structure, which query span) and **bytes decide** its terms,
   under three gates, each one measured: the span must take only query bytes no
   literal run claimed (run inline with pass 1, a higher-ranked candidate's
   proposal trimmed a lower-ranked candidate's byte-for-byte match out of
   existence); the literal agreement must **dominate** the span (a climb vote is
   not by itself an alignment — where the proposal is real, agreement is
   overwhelming); and the span must not be **frame** (literal dominance alone is
   too weak at this scale — a four-byte span agrees three-of-four with half the
   corpus by accident).

Three structural disciplines shape what the weave admits:

- **Weave-scale anchors only.** CAST transfers between things the _query_ weaves
  — query-scale structures. A context an order of magnitude beyond the query is
  not woven by it (the query can at most quote a fragment, which recognition and
  the cover already handle), so an anchor is read through a prefix-capped read
  of W × the asker's own byte count and dropped if it exceeds it. Profiled on a
  17.7M-node store, uncapped weaves spent 5–8 s per query recognising
  conversation-length anchors that could never form a weave point.
- **The asker's stream only.** Completed replies remain available to recognition
  and the climb as conversation context, but the alignment cuts the answered
  spans out, aligns the remaining segments as one compacted stream, and splits
  every run back across the original offsets so no evidence crosses an omitted
  boundary (§24.5). Otherwise weave work grows with answer length and the engine
  analogises against its own previous output.
- **One place, one structure.** A stored sentence and the entity it names are
  not two independent structures when the query's evidence for them is the same
  bytes — they are one place read at two grains, and admitting both lets a nest
  of containing sentences outvote the entity the query actually named (measured:
  comparison seated on a 49-byte sentence instead of the 17-byte entity). A
  point earns its place the same way a second point earns CAST's entry: at least
  one perception quantum of query bytes no better-voted point already explains.
  Points arrive in the climb's vote order — which structures belong in the weave
  is the climb's call, not a local run measure.

**Runs are never trimmed against each other.** A point keeps every byte it
aligned; exclusivity is a property of _structures_, not of individual query
bytes. This is worth recording because the trimming that used to happen was
invisible and load-bearing in the wrong way: a point's first run — which three
CAST branches read as "the filler", "the seat", "the name" — was whichever run
survived the cut, so those schemas were reading an elimination order as though
it were evidence, and the query's own bytes were truncated on the way
("Shakespeare" surviving as "Shakes"). Each consumer now derives its own reading
from the runs.

Finally, the per-byte **depth** counts _structures_, not weight: the frame test
below compares `depth[i]` against a count of aligned points, so accumulating
graded weight there would compare weight-mass against a cardinality. Measured
with only that toggled: 9 candidates collapsing to 2 points made 29 of 42 bytes
read as frame; counting distinct covering candidates leaves 6 of 42, which
decouples the frame gate from however many points happen to survive.

### 18.3 Two gates: two topics, and frame

**Two topics.** `points.length ≥ 2` reads as "two structures to transfer
between", but measured, it functions as "the query is about more than one
thing", and it only discriminates because the weave eliminates hard enough that
a single-topic query cannot reach two points — the condition carried by the
elimination, not by anything CAST measures. What actually separates a genuine
comparison from a single-topic query is _content_: a real comparison's points
are evidenced by **different query spans**, while a single-topic query's extra
points align to the same shared frame the first one already explains. So two
points count as two topics when either:

- a second point contributes at least one perception quantum of query bytes the
  best-covered point does not; **or**
- the climb found the query **dispersed** (two committed roots, or one whose
  cluster count reaches two — §17.6) _and_ the points were elected from places
  at least a quantum apart, _and_ at least a quantum of query bytes remains
  unexplained by the widest point.

Each clause is there because the others were measured insufficient: dispersion
alone let CAST into a near-tie and a list skill whose points the climb elects
from the same place; and without the unexplained-bytes clause, a query that is a
_prefix of one stored fact_ disperses into two clusters purely because the fact
repeats a phrase, while that one point's runs cover every query byte — the same
topic corroborated twice, not two topics.

**Frame.** Both components of the frame gate are derived from the weave itself,
not tuned:

1. **MIN_WEAVE** — the minimum number of aligned structures to form a weave: the
   same `2` that gates CAST entry. Frame requires evidence _beyond_ the minimum
   pair — a third structure agreeing — so the depth gate is
   `depth[i] > MIN_WEAVE`. One definition, two uses.

2. **Half-dominance** — `dominates(part, whole)` (§8.7), the same test region
   collection, `liftAnswer`, and confluence's filler gate all use. A byte is
   frame when the structures covering it are a majority of all aligned
   structures; a run is usable when its framed bytes are _not_ a majority.

```
frame(i)      ⇔  depth[i] > MIN_WEAVE  ∧  dominates(depth[i], aligned)
usable(qs,qe) ⇔  ¬dominates(framedCount(qs, qe), qe − qs)
```

The frame gate is the canonical example of **weave-local commonality** (§8.10):
`aligned` counts the structures aligned with _this query_, not the corpus.
Replacing the weave-local majority with corpus-global IDF misfires on reordered
single-fact queries. See §8.10 for the general theory and the full table of
which mechanism uses which measure.

One more derived reading sits beside the gates: the weave's **dominant** is its
principal _structure_ — the aligned point explaining the most query bytes — not
the climb's top-ranked _topic_. The two used to coincide, but the contrastive
margin (§17.3) ranks the query's own exact site first, while CAST's schemas all
orient around the frame-bearing structure: the substitution seat is displaced
_in_ the dominant, and comparison seats the analogs by the contexts that
establish their roles.

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

Comparison carries one further guard, because its weakest licence — frame-tier
evidence under a root the consensus floor does not trust — is the easiest to
satisfy by accident. Under that licence the two analogs' aligned runs must
account for **every stored window of the query**: the ignored-known principle
(§19.5). This is the byte-structural separator that no local threshold could
find. A legitimate small-corpus comparison ("How is ice like steel?") leaves
only _unattested_ spans ("How ", " like ") unexplained, while a scrap-matched
junk pair leaves the query's own trained content dismissed as gaps. Halo-tier
analogs are exempt — distributional company is independent evidence in its own
right. A **trusted root is not** exempt: the root's trust says the climb settled
on something, which is a different question about a different quantity from
whether _this comparison's_ evidence covers what the store knows. Measured, the
two disagreed exactly where it mattered, and comparison fired on a junk analog.

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
            where n ──▶ n′ is a learned continuation edge.  EVERY hop
            costs STEP, first or fifth, so a chain's total cost is
            proportional to its length and the lightest derivation is the
            SHORTEST successful one.  (Charging later hops nothing made
            every stopping point at any depth tie, leaving the choice to
            whichever arrived first.)  With several continuations the
            disambiguator (§25) is offered first; the engine keeps the
            first arrival at a given cost, so an evidence-backed edge wins
            ties deterministically rather than by exploration order.
            A form born by RECOMPOSITION continues at MICRO instead —
            once parts are consolidated into a learned whole, following it
            to its answer is the recomposition completing.

STOP-HERE   Form(i, j, n) reached via edges   → Out(i, j, bytes(n))
                                                cost CONCEPT
            Give up mid-chain and emit the node as it stands.  Priced by
            the same ordering that makes a synonym dearer than a direct
            edge: a premature stop at depth D costs D·STEP + CONCEPT, so a
            shorter premature stop beats a longer one and a genuine
            fixpoint (below, +0) beats any premature stop at equal depth.
            The search settles here only when continuing dead-ends or
            grows costlier than giving up.  These bytes are the node's OWN
            — never the recursive re-cover, which is reserved for the one
            place it is load-bearing.

GROUND      Form(i, j, n), a genuine FIXPOINT → Out(i, j, bytes)  cost 0
            The chain reached a node with no whole-node continuation
            anywhere.  RECOMPLETION (§19.6) runs HERE and only here —
            once, at the chain's actual end — so its cost tracks the
            answer's own structure rather than how densely the corpus
            interconnects the nodes passed through on the way.

CONCEPT-HOP Form(i, j, n), n edge-less       → Form(i, j, s′)   cost CONCEPT
            where s is a halo sibling of n above the concept threshold and
            s ──▶ s′ — answering through a synonym, one order dearer than
            a literal edge. (Siblings are pre-resolved before the search,
            since index queries are asynchronous.)

SPLIT       Out literal, containing a split position k (§15.2)
                                             → the two halves     cost 0
            The query's own chunking is not sacred; a form boundary the
            store knows can cut a leaf.  Demand-driven: emitted only when
            a split point actually falls inside this out.

FUSE        Out(i, j) ∧ Out(j, k) adjacent    → Out(i, k)          cost 0
            The concatenation may name a known node (as a short leaf; as
            the branch of the two sides' nodes; or by canonical
            re-perception when a side is a completed rewrite).  Kept alive
            only while it could still grow into a form.  Subject to the
            ATOM-CHAIN GATE below.

RECOMPOSE   the fused pair                    → Form(i, k, node)   cost 0
            Two already-rewritten parts fusing into a node that itself
            continues is a RECOMPOSITION: its onward FOLLOW-EDGE costs
            MICRO, so the consolidated whole strictly beats leaving the
            parts split.  A guard requires the fused node to be
            halo-bearing — learned as a meaningful unit, not an accidental
            interior chunk of some one-shot phrase.

SPLICE      Out(recognised L) ∧ Out(recognised R), a learned connector
            exists between L's and R's answers  → Out(L+connector+R)  cost 0
            (§19.5. Fires only when the gap between them is empty or
            wholly recognised — never across the asker's own literal
            separator, which BRIDGE carries instead.)
```

The A\* heuristic is ε per uncovered byte beyond an item's right edge —
admissible because ε is the minimum per-position cost, and what keeps the search
output-sensitive (§5.2, §8.9).

**The atom-chain gate on FUSE.** A pure leaf-leaf fuse — neither side already a
recognised completion — is opportunistic cross-leaf recovery: the probe has no
idea _why_ two leaves are adjacent, only that their concatenation happens to
spell a trained form. At hub scale, where atoms themselves no longer
discriminate (§8.8), that coincidence is noise. This gate used to exempt any
fuse starting at a position the query's own fold cut at, documented as "real
structural evidence" — and under a fixed-arity fold those positions were exactly
{0, W, 2W, …}, carrying no content information whatsoever. What it cost, on a
17.9M-node store: "In which country is the Eiffel Tower?" fused two byte atoms
at offset 4 — trusted only because 4 ≡ 0 (mod W) — into the trained form "hi",
followed its edge, and grounded a greeting as a fact, explaining 2 of 37 bytes.
The exemption was removed rather than replaced: there was no cheap signal that
meant what it claimed, and inventing one would be worse than admitting the
absence. Genuine cross-leaf forms are not lost — recognition's canonical pass
already probes every byte offset and emits them as sites, which arrive here as
recognised outs and stay exempt. Below hub scale nothing changes: on a small
store, coincidence is rare and every chain is real evidence.

### 19.4 What the cost ladder buys, concretely

- Coverage dominates: the search _must_ account for every byte, and prefers
  recognising to carrying.
- A literal continuation beats a synonym's (STEP < CONCEPT); either beats
  leaving a span unrewritten (≪ PASS).
- Free fusion/recomposition means the search always finds the _deepest
  consolidated reading_: if "D E" recomposes into a learned "DE" that continues
  to F, the answer is F, not "D′ E′".
- A chain's cost is proportional to its LENGTH, so among successful chains the
  shortest wins; and a genuine fixpoint always beats giving up early at the same
  depth, while a shorter premature stop beats a longer one.
- Ties resolve by the fixed conventions of §25 — deterministically.

### 19.5 Connectors: learned joins (the bridge)

When an answer has several parts, what belongs _between_ them? Sema asks the
store through a **graded junction ladder** — exact evidence before approximate,
the same discipline as `locate` (§14.4). The junction search is extracted into
one shared procedure so that both the bridge (a connector between answer pieces)
and cross-region attention (§17.8, the joint context of query regions) ascend by
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
lowest node id (deterministic — a property of the corpus, not the seed). An
_empty_ interior found by evidence is a confirmed adjacency, returned as such
and never confused with a miss. No learned evidence at any tier ⇒ no connector
invented.

Bridge results are memoised per response, keyed on the **bytes** of the pair
(one code unit per byte — an injective encoding). The cover's connector
pre-resolution asks for the same pair through several site/answer combinations,
and fusion and CAST re-ask pairs the cover already resolved, so each unique pair
is walked once. The key must be injective on raw bytes: a lossy text decoding
gave `[65,0,66]` and `[65,66,0]` the same key and therefore the same connector.

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

It runs at **one** place only: the chain's genuine fixpoint (§19.3's GROUND).
Offering it at every premature stop instead makes a query's total cost scale
with how densely the corpus happens to interconnect the nodes passed through —
corpus density — rather than with the answer's own hop count, which is exactly
the output-sensitivity the rest of the search is built to preserve.

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
    ranked ← the climb's FULL ranked list (§17) — not just the committed
             roots: extraction needs ONE anchor that IS a span-shaped
             exemplar, and it may sit below the further-topic floor
    for each cand in the first k of ranked:        # bounded — see below
        exemplar ← spanShapedOf(cand.anchor):
            context ← the anchor's bytes (or, for a terminal answer node,
                      the longest span-shaped context among ≤ √N of its
                      predecessors; query-gist resonance breaks length ties)
            answer  ← its continuation
            span-shaped ⇔ answer is a contiguous span of context, a
                          recognised subtree of it, or an ordered sparse
                          subsequence (a multi-piece answer)
        if not exemplar: continue
        built ← buildFromExemplar(query, exemplar)         # below
        if built = ∅ or |built.bytes| < W: continue        # sub-quantum
        if built.accounted = ∅: continue                   # UNANCHORED
        return built
    return ∅                          # no skill applies; decider moves on

buildFromExemplar(query, exemplar):
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

**Why the loop retries, and why it is bounded.** The span-shape test is
deliberately permissive (a sparse subsequence), so it accepts exemplars whose
relation to the query is coincidental gap-matching. Stopping at the _first_ such
exemplar let a coincidental match early in the ranked list win outright and read
out a sub-quantum fragment — observed: a 3-byte "Hel" pulled from an unrelated
exemplar, while a later ranked anchor would have read the query's own "Hello…"
correctly. So an exemplar that produces nothing usable is treated like a
structural non-match and the loop continues.

The retry is bounded at the same evidence-breadth constant k every other
consumer of a ranked list self-limits to. The frame matcher's exact-byte tier
has no significance correction of its own — short W-byte frames are cheap to
match by pure chance — so trying every ranked anchor turns that per-anchor
chance into a near-certainty over enough attempts: on a pure-gibberish query,
170 anchors deep found an unrelated exemplar whose short frame happened to
byte-match, producing an answer. That is the same failure mode recall's own
chance correction exists to prevent (§21.4). Bounding at k keeps the "genuinely
relevant but not root-significant" exemplars the loop was built for, without the
tail's chance collisions.

**An unanchored read is not an extraction.** If _no_ frame of the exemplar was
located in the query at all, nothing ties the bytes just read to this question —
the skill applied its exemplar's geometry to a query it never matched. Observed:
"Which city is France's seat of government?" answered "Which ci" — a fragment of
the query itself — from an unrelated exemplar. Requiring at least one located
frame is the structural evidence that permissiveness leaves out. This test is
scoped to extraction on purpose: the same veto at the pipeline's density check
was tried and reverted, because `accounted` is empty _by convention_ on recall's
own tiers, so a veto there refused six legitimate reverse-recall groundings.
Here the field is this mechanism's own output and carries its documented
meaning.

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
fallback-like mechanism — most of its tiers carry the full PASS·|query|, so they
can only win as the sole grounding (the honest price of an ungrounded answer) —
but it participates in the same decider as every other mechanism, and its floor
is free to state (one STEP-grade projection).

What it is _not_ is a single ladder of resonance scores. Recall is where the
system's honest-failure path lives, and over time it has accumulated a graded
sequence of **structural** claims, each strictly weaker than the last, each with
its own guards, and each running only where the alternative was silence. Nothing
below the clean-resonance tier costs anything on an answering path.

#### The asymmetry of forward and reverse

The deduction system (§5, §19) is a **forward** engine: its rules all move from
premises toward conclusions in the direction of the learned edges. There is no
backward rule — no inference step that consumes a conclusion to produce a
premise. This is not an omission; it is the formalism: a derivation is a
directed hyperpath from axioms to a goal, and the cost ladder prices each
forward step. A reading against the edge direction — `reverseContext`, which
asks "what establishes this?" rather than "what does this lead to?" — produces
bytes but no derivation.

The grounding decider expresses this exactly: reverse readings get
`accounted = []`, so their weight is the full PASS·|query| plus a STEP — the
most expensive grounding, available when nothing composes forward, impossible to
prefer when anything does. The decider _derives_ this from the evidence the
formalism itself declares.

Every tier grounds through the shared projections of §14.4 — recall owns no
grounding machinery of its own.

#### Two guards every tier shares

Because every tier below is a claim about the query, two failure modes recur,
and both are checked at every exit:

- **Restatement.** A candidate whose bytes _are_ the query's own — exactly, or
  under the response's canonical equivalence — may only conclude through
  disciplined reverse recall. Voicing its bytes echoes the question back at
  itself; projecting it forward is "whatever followed these bytes in some
  document".
- **Restated fragments.** A projection that is a proper byte-subspan of the
  query restates part of the question and is never an answer. This matters most
  in conversations, where each earlier turn is itself a trained form and would
  otherwise read as the next thing to say.

### 21.1 Tier 0 — exact self-match, and argument binding

**Exact self-match (content-addressed).** If the query _resolves_ — it is
literally a stored node — answer with the context that predicts it (the reverse
projection; among several predecessors, the query gist picks by resonance). This
tier never consults the ANN index: identity is exactly decidable, and an
estimated score must never stand in for it (§6.2). `accounted = []`,
`moves = STEP`.

**Argument binding.** The query is not itself a stored form, but it _contains_ a
recognised constituent that is an edge **source** — a learnt pair's left side
carried inside a wrapper ("How do you say 'thank you' in French?"). The wrapper
is scaffolding; the argument is the span that leads somewhere, so its
continuation, guided by the whole query's gist, is the answer. Matching the
wrapper while ignoring the argument is worse than silence, so anything short of
**one unambiguous binding** falls through: constituents must clear two
perception windows (the same 2W bar confluence binds under), nested recognitions
collapse to their maximal span, two distinct maximal arguments mean the query
asks about neither alone, and another substantial recognised form _outside_ the
chosen argument means this is not one argument in a wrapper but several
independently meaningful pieces — which is exactly the shape of an accumulated
conversation. Accounts for the argument's span; one STEP.

### 21.2 Tier 1 — clean resonance, at the scale-aware identity bar

If the top hit clears the **scale-aware identity bar** (§8.1) the query
essentially _is_ a learned form. The bar is per-hit, not per-tier: hits are
ranked nearest-first and the walk stops at the first one below it, because
grounding a lower hit under this tier's "near-identical" label would launder
byte-overlap noise (observed: "merci" projecting through the unrelated near hit
"meraih"). A hit that restates the query concludes only through reverse recall;
otherwise `project` tries forward first, then reverse. A forward grounding
accounts for the whole query (an identity-grade match); a reverse reading
accounts for nothing. One STEP either way.

### 21.3 Tier 2 — scaffolding-dominated: two independent readings of consensus

If the top score clears only the significance bar (§8.3) — real but diluted,
typically because shared boilerplate dominates the gist — ground the consensus
climb's dominant anchor. The question is when that anchor may be trusted, and
the answer is **two alternative readings, never a substitution**:

- its **pooled vote** clears the consensus floor ln N + ½ (§8.6) — the reading
  that legitimately fires on a small store, where ln N is low; **or**
- its **breadth** clears half-dominance _and_ its **peak** exceeds ln 2 — the
  scale-invariant reading (§17.6).

Both clauses are needed, and each was falsified alone. The absolute vote is an
ln N-scaled quantity: measured on a 325K-context store, a junk attractor
out-voted every correct anchor (12.69 against 8.19–10.77), so no vote threshold
admits the right anchors without admitting fabrication — while breadth > ½
admitted exactly the correct ones. Conversely, _replacing_ the vote test with
breadth broke seven tests, because breadth starves a genuine, evenly split
multi-topic query (no root in a real N-way split can exceed half the vote). Peak
is required beside breadth because breadth asks how much of the query
corroborates the anchor, never whether the anchor _says_ anything: on a
one-context store every region trivially corroborates the only anchor there is,
breadth is 1 while the anchor's IDF is 0, and "explain quantum chromodynamics"
answered a lone cat fact. Requiring the per-region contribution ln(N/c) to
exceed ln 2 is requiring c·2 < N — half-dominance again, in the IDF's own units.

One further gate asks about the **query** rather than the anchor: a query every
one of whose windows is corpus-global scaffolding gives the corpus nothing to be
held to, and this tier — which exists to serve scaffolding-dominated queries —
is exactly where that runs out. Measured: "What is the capital " answered a Sri
Lanka fact on breadth 0.667, every window it spells being a hub, while the
probes this tier serves correctly all retain at least one discriminating window.
(Dispersion was tried here and falsified: the fabrication and a legitimate
no-punctuation probe have identical cluster profiles.)

The tier accounts for exactly the query span whose evidence carried the winning
point of attention (§17.6's `start`–`end`), not the whole query — a consensus
vote for "ice" among scaffolding does not explain the word "steel". One CONCEPT.

### 21.4 Tier 3 — the nearest grounded hit, at the query-relative fraction

Walk the hits nearest-first and ground the first whose grounding explains enough
of the **query**. The gate is not the raw cosine (§2.6): root gists are unit
vectors, but under the linear fold cos = shared/√(len_q · len_g), so a query
fully contained in a much longer grounded answer scores √(len_q/len_g) — the raw
cosine punishes honest containment and lets a long answer sharing only
scaffolding pass. Converting to `cos · √(len_g / len_q)` measures what the reach
bar is supposed to mean: how much of THE QUERY the store accounts for.

That conversion carries one trap, and it is closed by an existing bar. The same
√(len_g/len_q) factor amplifies the estimator's own chance floor: a stored form
100× longer multiplies a noise-level cosine by ten and lifted pure gibberish
past the reach bar (observed). Only the **above-chance** part of a similarity is
evidence of shared content, so the significance bar (3/√D, §8.3) is subtracted
before the conversion. Derived from the existing bars; never tuned.

### 21.5 The refusal path — three structural tiers before silence

Everything geometric has now failed. Three tiers remain, each making a
**structural** claim about the query that resonance cannot state, and all three
read the _same_ candidate list — memoised, so the expensive branch runs at most
once per response. That list is the ranked hits, widened to an exhaustive index
scan only when the top hit clears the concept threshold: when the query gist has
no concept-level match to anything stored, an exhaustive scan would only score
more vectors below the bar (profiled at 38–40K vectors scored per refusing query
on a 325K-context store, costing 44% of think). Whether the gist ranks
_anything_ at concept level is the discriminator — corpus size never was.

#### The substitution bridge

**The gap.** A query phrased through a near-synonym of a trained word ("Name the
biggest planet" against a corpus that only ever says "largest planet") reaches
nothing, even though the fact is trained and the pairing is corroborated across
the corpus. Words are never independently addressable nodes — deposition interns
whole streams plus W−1/W leaf windows, and a word mid-sentence falls between
those scales — so no halo ever links "biggest" to "largest".

**The mechanism.** The query's own content-addressed windows are probed against
the store; the rarest anchor a bounded climb (the same `edgeAncestors` the
consensus vote uses) to the trained contexts containing them, alongside the
already-ranked resonance proposals. Each candidate context is aligned to the
query byte-for-byte around the anchor, leaving mismatched spans. A mismatch
grounds as a **substitution** only under three derived gates:

- **Corroboration** — the query-side span is itself corpus-attested: every
  W-window inside it resolves as a stored form, at least one reused across ≥ 2
  containers (the same bar suffix propagation gates inheritance with, §12.1). An
  untrained word can never substitute.
- **Graded identity** — lexical geometry first, at the concept threshold;
  differently spelled forms fall through to VSA company, whose bundled halos
  must clear the significance bar (the same distributional bar analogy strength
  uses).
- **Raw balance** — the mismatch, _before_ expansion absorbs any matched
  flanking bytes, must be roughly length-balanced on both sides
  (`dominates(min, max)`, half-dominance again). This is the guard that closed a
  real wrong-answer gap: "France" → "Spain si(nce)" had a 3-byte query span
  standing for 8 candidate bytes, an asymmetry a genuine morphological synonym
  never has and an arbitrary sentence divergence always does. Three more
  plausible fixes were implemented and refuted first — requiring non-vacuous
  frame consensus, excluding self-witness, and demanding candidate-side
  attestation — each of which broke the legitimate synonym case or failed to
  discriminate at all.

A candidate is accepted when its aligned-plus-substituted spans **dominate** the
query and every unexplained gap stays within one perception window. Beyond that,
the **ignored-known principle** applies: a span may be dismissed only when the
store has never seen it, so an unaccounted range that contains a stored window
is grounds for refusal. Genuinely novel spans remain tolerable. (This same test
guards CAST's frame-tier comparison, §18.4.)

Two guards sit at the exit. A projection contained in a substituted span is the
substitution **restated as knowledge** — the observed failure where a bridge
through " England." → " Germany." would have voiced "Germany". And a **strict
byte prefix** with zero substitutions is refused here and deferred to the next
tier, which owns that shape: the claim "a trained context IS this query up to
filler" is false in exactly the way that matters when the candidate's extra tail
is the discriminating part (measured on a 4,300-fact fixture, "what is the value
of" bridged to one arbitrary pick among 4,300 equally matching contexts).

Both bridge readings account for their aligned spans — matched **and**
substituted. A corroborated substitution is not a gap in the explanation; it is
an explanation the mechanism paid a CONCEPT for, and leaving its span
unaccounted charges the same act twice, the second charge being far the larger
(measured: a bridge matching 28 of 29 bytes declared the whole query unexplained
and lost to a comparison voicing the wrong country). The **identity** reading —
zero substitutions — is additionally marked `complete` (§14.1): the query _is_
that trained context, so its continuation is the whole read-out.

#### Prefix completion

The query is not _similar_ to a trained form; it is a **proper prefix** of one —
every byte a literal match, in order, from offset zero. That is the strongest
grounding relation in the store, stronger than a corroborated substitution and
stronger than resonance, which only claims an angle. Nothing is invented: the
answer IS a trained form, voiced whole.

The earlier tiers cannot reach it, for two independently measured reasons.
`resolve(prefix)` is null — a proper prefix of a deposited stream has no branch
of its own. And the form is frequently absent from the ranked list _at any k_:
measured, cos(query, form) = 0.5752 while the form is missing from `resonate` at
k = 24, 256 and 2048, with lower-scoring forms returned instead, because k only
reorders within the IVF clusters already probed. This is a **retrievability**
gap, not a semantic one. When the candidate list supplies nothing, a second
supply proposes from the write side's own leaf-id window index: leaf ids are
position-invariant (content-addressed on single bytes) where a fold is not, so a
prefix shares the deposit's window nodes exactly and reaches it by climbing
containment then parents, under the same √N budget everything else obeys.

Three guards, each falsified into existence, none droppable:

1. **An unreadable continuation vetoes.** Reads are bounded, so a candidate
   opening with the query but _saturating_ the read continues in a way nobody
   can see. It must not be quietly skipped — the skip is what manufactures a
   fragment. Measured: a query matched both a whole 138-byte form (saturating)
   and a 34-byte interior node; skipping the saturated candidate removed the
   only evidence that disagreed, uniqueness then passed, and a mid-form slice
   was voiced as an answer.
2. **The continuation must reach one grouping window.** Below W it is
   sub-quantum — the fold groups nothing from it.
3. **Uniqueness.** Several trained forms may open with the query and continue
   differently; then the corpus does not say which the asker means. Distinct
   continuations ⇒ refuse. Uniqueness is judged on the continuation _bytes_, not
   the candidate id: one continuation reached through two forms is one answer.

This is the documented **prefix trap**, and it is real — just not for every
prefix. Measured over 15 battery probes, exactly one yields a unique
continuation, and all three honest-silence probes yield none. The tier accounts
for the whole query and costs one STEP; it is _not_ marked complete, since the
form may carry more past the remainder voiced.

#### Frame-filler substitution

The remaining shape is compositional: "What is the capital of the country where
the Eiffel Tower is?" sits one edge away from the trained "What is the capital
of France?", differing by a single contiguous span where a **definite
description** stands in a **proper noun's** place. Every earlier tier correctly
declines — the constituent is not an edge source, the gist tiers are blind (cos
= 0.0076, with "capital of Spain" scoring _higher_), and the bridge refuses on
raw balance, as it must: a short span standing for a long one is exactly how a
wrong fact once got voiced.

The reframing is the point. The bridge asks whether two spans are _similar_; a
description and the noun it denotes are not similar, they are
**co-referential**, so no similarity threshold can separate this case from that
fabrication. So this tier does not try:

> **It invents a lookup key, never an answer.**

Build the query with a candidate filler in the description's place, and require
the **store itself** to already hold that key, byte-exactly, by content address.
The answer is then the trained continuation of a form the store verifiably has —
the same grounding tier 0 performs. A key the store does not hold is discarded.

Four guards, each falsified into existence on a 15.7M-node store:

1. The evidence hit must literally contain the description's **rarest** unit.
   Pooling fillers from every ranked hit gave one query nine resolving keys
   dominated by the wrong one; qualifying on any _shared_ unit earned a
   confident wrong answer off the scaffolding unit "write".
2. The frame must be **non-empty** — the description is a proper sub-span.
   Otherwise a "substitution" replaces the whole query.
3. The key must **resolve** byte-exactly and lead somewhere.
4. Exactly **one** stored form may survive. "What is the capital of Zamunda?"
   produces 24 resolving keys in weaker variants (Chile, India, Japan, Italy…) —
   fabrication, refused by ambiguity. The same discipline argument binding
   applies.

Resolution alone is not the safety argument: holding the frame fixed and varying
only the filler makes byte-exact resolution look like a perfect filter, but when
the description is searched too, 95,836 candidate keys were tried and 9
resolved. Resolution is necessary, never sufficient; the guards are what make it
sound.

**Where constituency comes from.** This tier substitutes one _constituent_ for
another, so it must know where a constituent begins — and there is no character
class here, no separator, no "word", because Sema has none. A byte value cannot
say whether it delimits; asserting a class over the alphabet overrides what the
corpus is able to state itself. The reading used is the store's own, already
spelled out in the weave and CAST's frame gate: **a byte is frame when more than
half the aligned structures share it, and a span is frame when more than half
its bytes are.** Scaffolding is what many exemplars have in common; content is
what tells them apart. So the spans come from literal alignment and the
judgement is half-dominance — both modality-free by construction; in a grid the
padding value would fall out as frame on exactly this test, with nothing
rewritten. Asking "what are the units of this byte string?" has no answer here,
and every attempt to derive one failed: the fold's own cuts land
mid-constituent, interning is uninformative because every W-window is interned,
and recognition returns only whole learnt forms — all three read _one_ string
alone. Constituency is **relational**, a property of what the corpus agrees on
across exemplars, and only a comparison can expose it.

The tier accounts for the whole query at CONCEPT + STEP, under the same
restatement and manufactured-answer guards: a projection contained in the filler
is the substitution restated as knowledge.

### 21.6 Echo, or silence

If everything above declines, one decision remains: echo the nearest stored
form, or say nothing.

An echo returns a stored form's bytes _as_ the answer — a near-identity claim
about the query — and identity-grade decisions are never made on an estimated
score (§6.2): a RaBitQ estimate overshooting the reach bar echoed a wrong-entity
neighbour (observed). The bytes are being read anyway in order to be echoed, so
the decision uses their **exact** fold: one fold of the top hit, measured in the
same query-relative, chance-corrected units as tier 3.

- Below the reach threshold (§8.2) — **return nothing**. The store holds nothing
  related. Silence is a first-class output.
- If the nearest form _is_ the query restated — **return nothing**. Restating
  the question answers nothing.
- Otherwise return the form's bytes, explicitly flagged as an **echo**: within
  reach, but not a grounded fact. It accounts for nothing and carries no move
  cost, so it can only win as the sole grounding — the honest price of an
  ungrounded answer. The flag travels in the response's provenance
  (`recall-echo`, §26) so a confident-looking parrot is always distinguishable
  from an answer.

Every tier also carries `unexplained` — a human-readable label for the query
bytes its evidence left on the table (§14.1) — appearing in the rationale trace
alongside `accounted` and `moves`.

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

Two further disciplines bound what may be hopped through:

- **A grounding that declared itself complete is not extended at all** (§14.1).
  The answer is already a trained form's own continuation, reached through an
  identity claim about the query, so a pivot could only chain past the fact that
  produced it.
- **What a mechanism WITHHELD may not be re-opened.** CAST's comparison cites
  two analogs and deliberately refuses their own downstream facts, so pivoting
  into one undoes the mechanism's own refusal one step later (observed: a pivot
  through a stored fragment of an analog's name reached the biography CAST had
  declined). The rule reads the used anchors' **continuations** — the content
  actually withheld — not their own bytes: a comparison's seat sentence
  legitimately contains further terms with their own unrelated facts, and those
  genuine hops must still fire. Only a mechanism carrying its own `used` set
  (CAST and confluence) gets this; for every other provenance the consumed set
  is derived by re-recognising the answer — "everything in it" rather than "what
  it voiced" — and a containment rule over that would suppress every legitimate
  pivot.

---

## 23. Fusion: multi-topic answers

If the query carries several independent points of attention (§17), each further
committed point grounds its own answer, and the pieces are joined **in query
order** — the order the question posed its topics — with a learned connector
(§19.5) between each adjacent pair where one exists. A missing connector joins
the pieces bare and records the degradation in the trace. Thus "ice fire" (two
topics) becomes "cold hot" — or "cold and hot", if the corpus ever joined such
answers with "and".

Fusion fires only on a genuine **remainder**: query bytes touched by neither the
winning candidate's evidence nor any computed span, and at least one perception
quantum of them (§14.1). Three further gates decide whether there is really a
second topic to fuse:

- **An answer drawn from the query's own text is left alone.** Extraction
  already spans all the query's pieces, so fusing would only add noise from
  unrelated stored contexts. The test is **strict containment** — the answer
  resolves inside the query's tree, or is a contiguous byte run of it. The
  earlier sparse-subsequence reading was trivially satisfied by short answers
  over long queries and silently starved multi-topic queries of fusion.

- **A lone root is ordinarily the primary answer's own source**, so there is
  nothing to fuse. The exception is a primary that never touched the climb at
  all — a pure computation has no anchor of its own — where the lone root was
  admitted unconditionally by the commit rule and was never checked against
  anything. There it may be promoted, but only on **breadth** (the
  scale-invariant reading, §17.6; the raw IDF vote cannot serve, since a genuine
  root on a large store can score below its own floor while a coincidental echo
  on a small one scores comfortably above its smaller one).

- **A second point must stand on structurally separate evidence.** Breadth alone
  is not enough for a computed primary: the ALU answers "2+2 equals what?" with
  4, the store's own arithmetic table supplies a lone root whose breadth
  dominates _because it is corroborated by the computation's own bytes_, and
  fusing it voiced an unrelated sum. So the further point's query span must sit
  at least one perception quantum away from the primary's — the same separation
  the climb's cluster count uses to tell independent evidence neighbourhoods
  apart. Not a score, and not a tuned bar: the fold's own quantum.

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

## 24.5 Conversations: the accumulated context

A conversation is not a separate inference mode. It is the ordinary pipeline run
over an **accumulated context** — the full exchange so far, as one byte stream —
and everything that makes that cheap and honest falls out of the fold's own
properties (§10.4).

A conversation handle owns three things: the accumulated bytes, the byte offsets
where each turn ended, and the incremental fold state. A turn is appended by
**raw byte concatenation plus an offset**; the engine's own reply is appended
the same way, and the span it occupies is recorded. The conversation's state
(context, boundaries, answered spans) is serialisable, so a conversation can be
saved and resumed; a restored one starts with fold state its next turn can
reuse, and is otherwise indistinguishable from a live one.

**There is no separator question.** A turn boundary is an _offset_, held by the
conversation, never a character the geometry scans for. Nothing downstream finds
boundaries by looking at content at all. A separator inside a _corpus_ is
ordinary content: if a trainer joins turns with a newline, those newlines are
bytes in the stream, folded like every other byte, and a replay reproduces them
by passing them inside the turn. Differing separator bytes between a corpus and
a query is therefore an ordinary _content_ difference — measured like any other
wording difference, degrading rather than failing closed — not an
incompatibility and not a convention to agree on.

Three properties make this work:

- **Growth is O(turn), not O(context).** The context grows by append, cuts are
  stable under append, and unchanged segments are reused by object identity, so
  a turn refolds only the right edge (§10.4). That object identity is also what
  the subtree-resolution cache is keyed on, so recognition over the grown
  context costs O(suffix) too. Measured: ~92% of nodes reused by identity, ~40
  rebuilt nodes per turn, flat as the context grows sevenfold.
- **The conversation fold imposes nothing.** It is exactly the tree
  `perceive(context)` builds for the same bytes — which is exactly the tree the
  _deposit_ path folded when it learnt them. That agreement is the whole point:
  when it was absent, the alignment family went quadratic (measured: 5.2M cells
  on a 476-byte context, against 0 when the two sides agree). Turn boundaries
  remain exact API metadata; they are not a fold instruction.
- **The engine's own answers are context, but not evidence to analogise
  against.** Completed replies stay available to recognition and the climb — a
  later turn can refer to what was _answered_, not only to what was asked. But
  CAST's weave aligns only the **asker's** stream: the answered spans are cut
  out, the remaining segments aligned as one compacted stream, and every run
  split back across the original offsets so no evidence crosses an omitted
  boundary. Without this, weave work grows with answer length and the engine
  analogises against its own previous output.

Each conversation carries its own perception, recognition and climb memos, which
are swapped into the response-scoped slots for the duration of a turn — the same
lifecycle an ordinary ask uses, so a memo present in one path can never be
missing from the other. At most one turn may be in flight per Mind.

---

## 25. Disambiguation: choosing among alternatives

Learned knowledge is plural: a context may have many continuations; a
continuation may follow many contexts. Sema's choices among them follow two
fixed regimes — and which regime applies is a matter of _direction_:

- **Forward (which continuation?): structural evidence.** Candidates are often
  short spans whose gists are dominated by accidental byte correlations, so
  geometry is _not_ consulted — the guide's **presence** gates disambiguation (a
  null guide means no query is in flight, so structural walkers keep plain
  first-edge behaviour), but its value is deliberately unused. The winner is the
  candidate predicted by the most **distinct contexts** (diversity of
  independent evidence, read as one indexed count — never a materialised reverse
  fan-in), tie-broken by **halo mass** (sheer episodic repetition), then by
  insertion order (first-learned). Candidates are capped at the hub bound √N, so
  a strongly supported edge inserted beyond the cap is invisible here — the
  deliberate trade against paying O(fan-out) on every disambiguation.

  There is deliberately **no significance floor** on this choice. That floor is
  calibrated for pooled, IDF-weighted climb votes, where each corroborating
  region contributes at most ln N and the floor grows with N exactly as that
  ceiling does. A continuation's support count is a different kind of quantity —
  how often one specific fact was retold, bounded by nothing that grows with the
  corpus — so gating an N-invariant count against an N-growing threshold
  guarantees failure once N is large enough (observed: a fact corroborated
  2-to-1-1-1 refused at N ≈ 325K, falling back to a noisy concept hop). The
  comparison above already _is_ the "genuinely competing" test: a tie leaves
  first-inserted as the pick, and a strict winner is real evidence at any scale.
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

**The work meter** — the profiling counterpart of the rationale. Where the
rationale says _why_ an answer was chosen, the meter says what it _cost_: an
optional per-response accumulator that counts the work one inference call
performs at every layer (store reads by kind and by byte volume, index queries
and vectors actually scored, perceptions and recognitions with their byte
counts, climbs and ancestor visits, alignment cells, junction ascents and the
nodes they popped, mechanism floors/runs/skips, candidates considered) and times
named **phases**. Four properties make it trustworthy:

1. **Never read by inference.** A counter that reached a decision would end
   determinism. The engine's side is write-only.
2. **Counts are the product; times are the hint.** The counters are
   deterministic, so two runs are diffable and a work regression is visible
   without a stopwatch; only the millisecond totals are not.
3. **Phases nest and carry their own counter deltas**, so "which phase did those
   byte reads?" is answerable at all. Phase totals are inclusive and must never
   be summed.
4. **A logical operation is counted once, and a shared analysis is charged to
   itself** — never to whichever mechanism happened to pay for it on everyone's
   behalf.

The meter is off by default and free when off. It also observes one honest
limitation: a traced response bypasses the response memos, so it measures a
different machine — profile without a trace attached.

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
π₀ … π_{S−1}         ≔ fixed independent random permutations (the keyring),
                       S = max(8, W) seats
seat(size, k)        ≔ k               if k < ⌈size/2⌉      # two-ended frame
                     ≔ S − size + k    otherwise            # (§2.3)
fold(v₀ … vₖ)        ≔ Σᵢ π_{seat(k+1, i)}·vᵢ      # NOT normalized — only
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
contentLevels(bytes):                  # §10.2 — the ONE boundary rule
    h ≔ rolling window of the last W raw bytes (cyclic polynomial)
    for each position i:
        m ≔ avalanche(h)               # two rounds
        hit ≔ (m mod W = 0)
        if hit and neither of the previous 2 positions hit:
            lvl ≔ max L with m mod W^(L+1) = 0
            emit a cut at i+1 with level lvl
        force a cut whenever a segment would exceed S seats
    return (cuts, levels)

perceive(bytes, boundaries ≔ ∅):
    if boundaries ≠ ∅:                 # §10.4 stable prefix
        fold each span between consecutive boundaries by contentFold,
        join the span roots LEFT-NESTED, normalize the root, return
    return contentFold(bytes)

contentFold(bytes):
    (cuts, levels) ≔ contentLevels(bytes)
    segs ≔ [ flatFold(bytes[e_i .. e_{i+1})) for consecutive cut edges ]
             # each segment = ONE flat node, kids = its byte leaves,
             # gist = Σₖ π_{seat(n,k)}·alphabet[byteₖ]      (§10.3)
    tree ≔ groupByLevel(segs, levels, 1)
             # items separated by a cut of level < L share a parent; a
             # group exceeding S seats splits at its strongest interior
             # cut (ties → the items' own content hash); climb L when a
             # level splits nothing
    normalize(tree.gist)               # ONLY the finished root — every
                                       # interior gist keeps its raw,
                                       # byte-proportional magnitude (§2.6)
    return tree                        # every node has gist + kids/bytes

gistOf(bytes)   ≔ perceive(bytes).gist
resolve(bytes)  ≔ intern-lookup of perceive(bytes), bottom-up:
                  leaves by findLeaf, branches by findBranch(kidIds);
                  null the moment any part is unknown;
                  then canonResolve(bytes) as the equivalence fallback (§3.4)
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
    propagateSuffixes(ctxRoot → conRoot)   # §12.1: every ESTABLISHED
        # right-edge suffix of the context inherits the same edge.  Gated by
        # one flat-branch existence probe per offset (no fold unless it hits),
        # skipped for contexts shorter than 2W; established ⇔ ≥2 structural
        # parents, or (halo > 0 ∧ already an edge source).
    for part in changed:
        pourHalo(ctxIds[part], π₁·companySignature(conRoot));  massOf(part) += 1
        pourHalo(conRoot,      π₀·companySignature(part));    massOf(conRoot) += 1
    # link/pour lazily admit both subtrees' interiors to the content index

deposit(input, tracked):
    tree ≔ contentFold(flatten(input))     # no imposed boundaries — the
                                           # deposit tree IS what inference
                                           # perceives for the same bytes;
                                           # segments of an already-folded
                                           # byte-identical prefix are reused
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
            # k ≔ 2·recallQueryK — the response's ONE evidence-breadth
            # constant, read by the climb, the weave and every resonance probe.
            # Every EXPENSIVE analysis is a lazily-cached method; an async one
            # is cached BY PROMISE (the first caller starts it, every later
            # caller awaits the same one):
            #   pre.attention()      — the consensus climb (§17)
            #   pre.weave()          — graded alignment over ranked anchors
            #   pre.spanShapedOf(a)  — per-anchor skill classification
            #   pre.spanShapedAll()  — the same for every ranked anchor,
            #                          sharing the per-anchor cache
            #   pre.windowsOf(a) / pre.queryWindows / pre.queryResolved /
            #   pre.reachMemo        — the content-addressed identity reads
            #                          (reachMemo is the store-lifetime memo
            #                           the climb itself uses — §17.5)
            # Each shared analysis bills its OWN profiling phase, never the
            # mechanism that happened to first-touch it.
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
                       unexplained: r.unexplained, complete: r.complete,
                       scaffolding: r.scaffolding })

    # consider(c):  skip empty bytes; take c when its GRADE is lower; at EQUAL
    #   grade take it when it carries fewer scaffolding bytes; otherwise keep
    #   the incumbent (the list order).

    if best = ∅: return ∅
    # ── Diagnostics (observational, never affect the decision) ──────────
    emit decideGrounding trace with every candidate's
        (provenance, weight, grade, unexplainedBytes, decided) + runnerUpMargin
    if runnerUp exists and margin ≤ 1: emit narrowDecision trace
    density ≔ |union(best.accounted)| / query.length
    if density < 1/W: emit thinGrounding trace

    (answer, provenance) ≔ (best.bytes, best.provenance)

    # ── Post-grounding ──────────────────────────────────────────────────
    consumed ≔ per provenance: cast.used | join.used | sites of
               recognise(answer) | ∅ (recall/recall-echo consume nothing)
    # WITHHELD, NOT VOICED: for cast/join only, the used anchors' own
    # CONTINUATIONS (capped at √N) are handed to reason as content the
    # mechanism deliberately declined — a pivot may not re-open them, while
    # terms merely CONTAINED in what was voiced stay pivotable.
    voiced ≔ (provenance ∈ {cast, join})
             ? [ read(n) for id in consumed, n in nextFirst(id, hubBound) ]
             : ∅
    answer ≔ best.complete ? answer                              # §22
                           : reason(query, answer, consumed, voiced)

    # FUSE on a genuine REMAINDER, not on provenance: bytes touched by
    # neither best.accounted nor any computed span.  Under one quantum W it
    # is bridging punctuation, never a second topic.
    explained ≔ best.accounted ∪ { [u.i, u.j] for u in pre.computed }
    if unaccounted(explained) ≥ W:
        primarySpans ≔ best.accounted ≠ ∅ ? best.accounted
                                          : spans of pre.computed
        unclimbed   ≔ best.accounted ≠ ∅ ∧ every accounted span IS a
                      computed span      # a pure computation has no anchor
        answer ≔ fuseAttention(query, answer, primarySpans, unclimbed)  # §23
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
climbAttention(query, k, mode ≔ inverse):
    # ── REGIONS — three sources (§17.2) ──────────────────────────────
    regions ≔ fold nodes of perceive(query), each resolved against the
              store as the walk goes; a region DOMINATING the query is
              dropped unless it is the sole structure (segments exempt —
              a segment wraps nothing)
    regions ∪= recognise(query).sites, each CARRYING its node id
    regions ∪= coalesced maximal spans of resolvable W-windows no fold
               region contains and whose climb is neither saturated nor
               rootless      # marked CORROBORATING: evidence, not a topic

    for each region r:
        cov ≔ 1 if r resolves whole; else the fraction of r's W-windows
              that resolve; 0 when |r| < W (below one window, identity is
              chance)
        anchor ≔ r.id ?? canonicalChunkId(r.bytes) ?? nearest(r.gist, k)[0]
        score  ≔ 1 for an exact anchor, else the hit's estimate
        # a diluted segment may re-anchor on one of its two EDGE W-spans,
        # chosen by score²·idf — the same quantity its vote is weighted by
        reach  ≔ expandUntilDecided(anchor, HUB(N)):
                   # ONLY LIMITed store reads; five decisions end it:
                   #  · prevCount(id) > √N          — predecessor fan-in
                   #  · distinct contexts past √N   — context limit
                   #  · parentsFirst(id, √N+1)      — parent fan-out
                   #  · accumulated laterals > √N   — lateral cone (§8.8)
                   #  · atomReach(N) > √N           — byte atom (§8.8)
                   # containersSlice pages containment at √N; transparent
                   # chains hop in ONE read; below √N every read IS the
                   # full set → exact.  Memoised in the shared reach memo.
        if reach has no roots and not saturated: try lower hits (orphan)
        if reach saturated and anchor approximate: try hits tied within
            estimatorNoise(D) of the top (saturated-tie)
        if reach.saturated: abstain
        idf ≔ ln(N / reach.contexts);   df ≔ ln(1 + reach.contexts)
        wf  ≔ mode = direct ? df : mode = combined ? idf + df : idf
        if wf ≤ 0: abstain
        if not (cov ≥ 1):                             # contrastive margin
            margin ≔ score − score of the best hit reaching a DIFFERENT
                     conclusion
            if margin ≤ estimatorNoise(D)·(1 − cov): abstain
        mutual ≔ min(1, score · ratio) · min(1, score / ratio)   # §17.4
               where ratio ≔ √( max(1, contentLen(anchor, region.len·D))
                              / max(1, region.len) )
               # contentLen capped at region.len·D — beyond that the
               # mutual weight approaches zero and the full walk is waste
        vote (mutual·wf)/|reach.roots| for each root, carrying
             (mutual·idf)/|reach.roots| as the FOCUS weight
             (a terminal answer root redistributes over prevFirst(root,
              HUB(N)) — capped at the store level, never materialised)

    # ── CROSS-REGION (§17.8) — five tiers, exact before approximate ──
    # Candidates: regions that voted; a KNOWN non-voting region may be the
    # WEAK side of a pair whose other side voted; two non-voting regions
    # never pair.  Only MAXIMAL spans compose.  Order-free, n-ary, with a
    # self-evidence guard.  Seeds computed once per candidate; all reads
    # through the shared per-response walk cache.
    cross ≔ [];  superseded ≔ ∅;  consumed ≔ ∅
    for each eligible pair (a, b), ≤ k probes total:
        containers ≔ junctionContainersFrom(left, right, unordered)   # exact
        if ∅: containers ≔ junctionSynonyms(left, right)   # single, double
        if ∅ and both sides KNOWN and both STRONG and no voted region lies
              between them:
            pick ≔ structuralResonance(a, b)   # synthetic gist from the two
                   # sides' own vectors + the literal middle; rejects a
                   # candidate reaching exactly one side's own conclusion;
                   # requires margin > estimatorNoise(D) over the best
                   # differently-concluding rival
        best ≔ the container covering the MOST remaining candidates;
               ties → shortest interior → lowest id
        if best's joined occurrence is a query substring: continue
        reach ≔ edgeAncestors(best.id, HUB(N))
        if not saturated and idf > 0:
            confidence ≔ 1 for an exact container, else the tier's own
            w ≔ mutual(confidence) · ln(N / reach.contexts) / |reach.roots|
            cross.push(vote for best.id's roots at w, span covering all
                       composed candidates; CORROBORATING when every
                       composed part was)
            if the pick is container-backed:            # never for tier 4
                consumed += {a, b, extras}
            if the tier is EXACT:                       # explaining away
                for each individual vote rv:
                    if rv.roots shares any root with reach.roots: keep
                    else if containerBytes contains rv's query bytes:
                        superseded.add(rv)

    # ── POOL AND COMMIT (§17.6) ──────────────────────────────────────
    pooled ≔ lightestDerivation in the (+,+) semiring over the union
              of the independent votes (minus superseded) and cross  # §5.3
    ranked ≔ anchors by pooled vote, descending, each carrying
             peak, start–end (its strongest region), breadth, clusters
    cut    ≔ steepest ratio drop (natural break) over the focus votes of
             anchors the QUERY pointed at (corroborating-only excluded)
    roots  ≔ [ranked[0]]                       # dominant: always grounds
           ∪ { further non-overlapping anchors past any leading saturated
               stretch whose focus vote ≥ max(cut, FLOOR(N)) }
    return (roots, ranked)
```

### 27.6 Recall, reasoning, fusion (§21–23)

```
recallByResonance(query, pre):
    whole_ ≔ [[0, query.length]];  nothing ≔ []
    restates(b) ≔ b = query, or canon(b) = canon(query)
    fragment(g) ≔ |g| < |query| ∧ query CONTAINS g   # a restated fragment
                                                     # — never an answer
    # every tier below exits through both guards

    # ── tier 0: exact self-match ─────────────────────────────────────
    q ≔ pre.queryResolved
    if q ≠ ∅:
        g ≔ reverseContext(q, guide, prevFirst(q, hubBound))
        if g ≠ ∅: return { bytes: g, accounted: nothing, moves: STEP }

    # ── tier 0b: argument binding ────────────────────────────────────
    if q = ∅:
        args ≔ MAXIMAL recognised sites with |s| ≥ 2W, |s| < |query|,
               hasNext(s)
        if |args| = 1 and no OTHER site of ≥ 2W lies outside it:
            g ≔ follow(args[0], guide)
            if g ≠ ∅ ∧ ¬fragment(g):
                return { bytes: g, accounted: [args[0].span], moves: STEP }

    hits ≔ contentIndex.nearest(gistOf(query), k)
    if hits = ∅: return ∅

    # ── tier 1: clean resonance, at the SCALE-AWARE identity bar ─────
    idBar ≔ identityBar(D, W, |query|)                            # §8.1
    if hits[0].score ≥ idBar:
        for h in hits:
            if h.score < idBar: break        # per HIT, not per tier
            if h = q or restates(read(h)):   # only reverse recall may
                g ≔ reverseContext(h, guide) # conclude from a restating hit
                if g ≠ ∅: return { bytes: g, accounted: nothing, moves: STEP }
                continue
            g ≔ project(h, guide)
            if g ≠ ∅: return { bytes: g, accounted: whole_, moves: STEP }

    # the query-relative, CHANCE-CORRECTED fraction shared by tiers 2-4
    fracOfQuery(cos, otherLen) ≔
        min(1, max(0, cos − SIG) · √(otherLen / max(1, |query|)))

    # ── tier 2: scaffolding-dominated ────────────────────────────────
    if hits[0].score ≥ SIG:
        forest ≔ pre.attention().roots
        if forest ≠ ∅ ∧ ¬allWindowsAreScaffolding(query) ∧
           ( forest[0].vote ≥ FLOOR(N)                    # small-store read
             ∨ (DOMINATES(forest[0].breadth, 1)           # scale-invariant
                ∧ forest[0].peak > ln 2) ):
            g ≔ project(forest[0].anchor, guide)
            if g ≠ ∅ ∧ ¬fragment(g):
                return { bytes: g,
                         accounted: [[forest[0].start, forest[0].end]],
                         moves: CONCEPT }

    # ── tier 3: the nearest grounded hit ─────────────────────────────
    for h in hits:
        g ≔ project(h, guide)
        if g ≠ ∅ ∧ fracOfQuery(cos(gistOf(query), gistOf(g)), |g|) ≥ REACH:
            return { bytes: g, accounted: nothing, moves: STEP }

    # ── the REFUSAL PATH — one shared, memoised candidate list ───────
    wideIds() ≔ hits[0].score ≥ CONCEPT_BAR
                ? exhaustive resonate(gistOf(query), hubBound)   # ids only
                : hits                                # the gist ranks nothing
                                                      # at concept level

    # 3b. substitution / identity bridge
    bridged ≔ substitutionBridge(query, wideIds)
              # anchors: rarest query windows → edgeAncestors, plus wideIds
              # align byte-for-byte; a mismatch substitutes only under
              # CORROBORATION ∧ GRADED IDENTITY ∧ RAW BALANCE
              # accept when matched+substituted DOMINATES the query, every
              # gap ≤ W, and ¬dismissedKnownContent(query, accounted)
    if bridged ≠ ∅:
        g ≔ project(bridged.id, guide)
        manufactured ≔ g lies inside one of bridged's substituted spans
        strictPrefix ≔ bridged.subs = ∅ ∧ query is a strict byte prefix
                       of read(bridged.id)          # deferred to 3b′
        if g ≠ ∅ ∧ ¬restates(g) ∧ ¬manufactured ∧ ¬strictPrefix ∧ ¬fragment(g):
            return { bytes: g, accounted: bridged.accounted,
                     moves: CONCEPT·|bridged.subs| + STEP,
                     complete: bridged.subs = ∅ }    # the IDENTITY bridge

    # 3b′. prefix completion — the candidate list first, then the write
    #      side's own leaf-id window index as the supply of last resort
    completed ≔ prefixCompletion(query, wideIds())
             ?? prefixCompletion(query, prefixCandidates(query))
             # guards: an UNREADABLE continuation VETOES; the continuation
             # must reach W; distinct continuation BYTES ⇒ refuse
    if completed ≠ ∅:
        return { bytes: completed.form, accounted: whole_, moves: STEP }

    # 3c. frame-filler substitution — invent a KEY, never an answer
    filled ≔ frameFillerSubstitution(query, wideIds())
             # the evidence hit must hold the description's RAREST unit;
             # the frame must be non-empty; the constructed key must
             # RESOLVE and lead somewhere; exactly ONE may survive
    if filled ≠ ∅:
        g ≔ project(filled.id, guide)
        if g ≠ ∅ ∧ ¬restates(g) ∧ g ⊄ filled.filler ∧ ¬fragment(g):
            return { bytes: g, accounted: whole_, moves: CONCEPT + STEP }

    # ── echo or silence — decided on the EXACT fold, never an estimate ─
    topBytes ≔ read(hits[0])
    if fracOfQuery(cos(gistOf(query), gistOf(topBytes)), |topBytes|) < REACH:
        return ∅                                                  # silence
    if restates(topBytes): return ∅          # restating the question
    return { bytes: topBytes, accounted: [], moves: 0, echoed: true }

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

fuseAttention(query, primary, primarySpans, unclimbed):          # §23
    # (think already gated this on a REMAINDER of ≥ W bytes — §14.1)
    if containsSpan(query, primary): return primary   # STRICT containment:
                                    # resolved inside the query's tree, or a
                                    # contiguous byte run of it
    roots ≔ pre.attention().roots
    lonePromotes ≔ unclimbed ∧ |roots| = 1 ∧ roots[0].breadth > ½
                   ∧ every primarySpan is ≥ W bytes away from roots[0]
    if |roots| = 0 or (|roots| ≤ 1 ∧ ¬lonePromotes): return primary
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

    # ── the weave (§18.2), computed once and shared ──────────────────
    MIN_WEAVE ≔ 2;  (points, depth) ≔ pre.weave()
    #   · anchors read prefix-capped at W · |asker bytes|; oversized dropped
    #   · aligned over the ASKER's compacted stream (answered spans cut out,
    #     runs split back across the original offsets)
    #   · pass 1: literal W-gram runs (weight 1) → halo-mated sites (weight
    #     = the cosine); depth[i] counts distinct covering STRUCTURES
    #   · pass 2: the climb's own (anchor, span) proposals, admitted only on
    #     unclaimed bytes, with literal agreement DOMINATING the span, and
    #     not framed
    #   · "one place, one structure": a point needs ≥ W bytes no better-voted
    #     point already covers; runs are never trimmed against each other

    # ── two-topic gate (§18.3) ───────────────────────────────────────
    aligned ≔ |points| when some point owns ≥ W bytes the widest does not,
                       OR (climb dispersed ∧ points elected ≥ W apart ∧
                           ≥ W query bytes unexplained by the widest)
              else 1
    if aligned < 2: return []

    # frame gate (weave-local): frame(i) ⇔ depth[i] > MIN_WEAVE ∧ dominates(depth[i], aligned)
    dominant ≔ the point covering the MOST query bytes   # structure, not topic
    require some point ∈ roots                           # a committed root
    require some run outside every recognised site
            OR (two points in the CURRENT turn restating two DIFFERENT sites)

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

Query: `"The Weeping Woman was painted by Pablo Picasso."` (47 bytes)

The trace below is the one the engine actually emits, with its real weights.

1. **Recognise (§15).** Two learnt forms that lead somewhere — " Pablo Picasso"
   material and the painting-frame span — plus 47 perceived leaves. "The Weeping
   Woman" resolves to nothing: never seen.
2. **Compute (§16).** No extension claims any span; the ALU abstains on its
   structural precondition.
3. **Consensus climb (§17).** Fourteen regions (twelve perceived, two
   recognised); every one votes. The pooled ranking is led by the Picasso
   context (vote 3.28, peak 1.56, breadth 0.46, clusters 2, elected from the
   query span 33–46), then the three painting exemplars at 1.18, 1.10 and 0.94.
   With `corpusN = 5` the consensus floor is 2.11 and the natural break sits at
   3.28, so exactly **one** point of attention commits — the rest are rejected
   below both bars or absorbed as overlaps. Cross-region attention probes ten
   pairs and binds none: one pair's exact containers are all rejected by the
   **self-evidence guard** (§17.8), and the rest are ineligible for structural
   resonance because at least one side is not content-addressed.
4. **Grounding decider (§14.1).** Four mechanisms produce candidates, weighed in
   the one ladder:

   | Mechanism        |    Weight | Unexplained bytes | Moves                       |
   | :--------------- | --------: | ----------------: | :-------------------------- |
   | cover (§19)      | 34001.001 |                34 | one edge + ε bridging       |
   | **CAST** (§18)   | **14001** |            **14** | one STEP (redirection)      |
   | extraction (§20) |     29013 |                29 | CONCEPT + 3 located frames  |
   | recall (§21)     |     34001 |                34 | one STEP (argument binding) |

   Every one of them found the same answer bytes by a different route — the
   strategies are redundant by design. What separates them is **how much of the
   query each explains with learnt structure**. CAST's redirection schema
   accounts for 33 of the 47 bytes: the query names a substitute ("Pablo
   Picasso") wholly and freshly for the thing the dominant structure is about,
   and none of that structure's own continuations appears in the query, so the
   substitute's own grounded fact replaces the displaced one. Extraction reads
   the analogous span out correctly — the same painter — but its three located
   frames explain only 18 bytes, and recall's argument binding explains 13.
   Confluence abstains (one constraint stream); the ALU is skipped.

   **Decider:** CAST wins by a 15,012-grade margin — comfortably wide, so no
   `narrowDecision` is recorded.

5. **Reason (§22).** The answer already _is_ the Picasso context's continuation,
   so the forward chain finds no unconsumed pivot and fixes immediately.
6. **Fuse (§23).** One committed point of attention, and the remainder is under
   one quantum — nothing to fuse.
7. **Articulate (§24).** No answer form is a halo sibling of an asker concept;
   the answer stands.

Answer: **"Pablo Picasso co-founded the Cubist movement"** — containing no word
of the question. Provenance: `cast`. Every step above is present, with spans,
node ids, costs, and data-flow edges, in the rationale when one is requested.

_(This is a four-fact store; on a larger corpus the same query can ground
through extraction or cover instead. That the answer is stable while the route
is not is the market working as designed — which is why provenance is part of
every response.)_

The second demo query, `"a museum charges 12*4 for a family ticket"`: the ALU
claims the span `12*4` with result bytes `48`; recognition's sites overlapping
that span are masked; the cover search bridges the literal framing (PASS) and
the computed span (recognised, STEP + ε), and lifting drops the framing:
**"48"**, provenance `cover`.

### 27.10 Determinism, stated as an invariant

Every function above is deterministic given (seed, store contents): the alphabet
and keyring are seeded; perception is a pure function of the bytes; interning is
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
  consensus climb (Spärck Jones 1972). §17.4.
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

| Operation                  | Cost                                                                                                                                                                                                                                                                          | Where     |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------- |
| Perceive                   | O(n) rolling-hash pass + O(n·D) vector work; O(n) nodes. A stream EXTENDING an already-folded one costs O(new bytes) — cuts are stable under append and unchanged segments are reused (§10.4)                                                                                 | §10       |
| Deposit (intern + windows) | O(n) content-addressed probes; the intern walk itself is O(new nodes) when a prefix was already interned                                                                                                                                                                      | §11       |
| Learn a pair               | O(1) edge + O(changed) halo pours + one flat-branch probe per suffix offset (suffix propagation, §12.1)                                                                                                                                                                       | §12       |
| Recognise                  | O(n·W) bounded probes                                                                                                                                                                                                                                                         | §15       |
| Canonical resolution       | one canonicalization + one hash probe + one verify read per candidate; only on an exact-lookup miss                                                                                                                                                                           | §3.4      |
| Consensus climb            | O(regions · k) index queries + expand-until-decided: work bounded by √N per region regardless of corpus size (LIMITed store reads, indexed existence probes)                                                                                                                  | §17       |
| Cover search               | output-sensitive A\*LD: proportional to the lightest derivation, not the corpus (§5.2); the dominant per-query index cost is connector pre-resolution, O(sites) queries                                                                                                       | §19       |
| Recall (answering tiers)   | O(k) index probes + graded structural checks                                                                                                                                                                                                                                  | §21       |
| Recall (refusal path)      | Nothing on an answering path. One shared candidate list (exhaustive only when the top hit clears the concept bar), then O(\|query\|) content-hash probes, ≤ W anchor climbs, and one O(\|query\|·\|candidate\|)-bounded alignment each; the frame filler's probe budget is √N | §21.5     |
| Reasoning                  | ≤ K hops, each bounded by the answer's subtree                                                                                                                                                                                                                                | §22       |
| Storage                    | O(distinct subtrees); vector index over resonance targets only, 1-bit codes (32× compression)                                                                                                                                                                                 | §3, §12.3 |
| Profiling                  | free when off; when on, one counter bump per logical operation and one timer per named phase — never read by inference                                                                                                                                                        | §26       |

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
