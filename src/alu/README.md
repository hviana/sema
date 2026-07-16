# alu

A small, dependency-free **ALU**: a tiny irreducible kernel from which
arithmetic, logical, and numerical computation are all _derived_. It is the
manual-rules counterpart to `derive`'s learned rules — the operations a mind
should not have to learn one number at a time (how to add 2 and 2, how to negate
a truth value) are declared here once.

It joins the mind as a `PipelineMechanism`
([`../mind/pipeline-mechanism.ts`](../mind/pipeline-mechanism.ts)) whose only
special role is the optional `parse(query)` method every mechanism may
implement. The mind knows nothing about what the ALU computes; it only knows
that `parse` returns `ComputedSpan[]`, which enter the one lightest-derivation
search as authoritative axioms (at `STEP` cost, like a learned edge).

It has no dependency on the rest of the codebase except the pure byte helpers in
`../bytes.ts`, and is intended to be reused as a self-contained sublibrary in
the spirit of `derive/` and `rabitq-ivf/`.

## The thesis: one tiny kernel, everything else is a rewrite

Each stratum bootstraps the next, so the ALU only _declares_ the irreducible
primitive(s) of each layer; everything else is a derivation rule layered on top.

### 1. Logic — the completeness layer (`kernel-logic.ts`)

One primitive: **`nand`** (functionally complete on its own). `not`, `and`, `or`
are exposed for ergonomics but are themselves derived. Fully derived: `nor`,
`xor`, `xnor`, `implies`, `iff`, and **`mux(s, a, b)`** — the bridge to control
flow (conditional selection, and with recursion, looping).

```
not(a)       = nand(a, a)
and(a, b)    = not(nand(a, b))
or(a, b)     = nand(not a, not b)
xor(a, b)    = or(and(a, not b), and(not a, b))
mux(s, a, b) = or(and(not s, a), and(s, b))
```

### 2. Arithmetic — the field-and-order layer (`kernel-arith.ts`, `kernel-bits.ts`)

Identities `0`, `1`; primitives `add`, `negate`, `multiply`, `reciprocal`,
`sign` (plus optional `floor` / `mod` for integer number theory). Derived:
`subtract = add ∘ negate`, `divide = multiply ∘ reciprocal`, every comparison
`= sign ∘ subtract`, then `abs`, `min`, `max`, `power`, `gcd`, and the array
routines `polyEval`, `dot`, `matMul`, `linsolve` (Gaussian elimination — just
structured arithmetic, _not_ a new primitive).

**The bit-vector bootstrap is exact and exercised.** `kernel-bits.ts` builds
`full_adder` from the `xor`/`and`/`or` of layer 1, and from it derives ripple
`add` → two's-complement `negate` → shift-add `multiply` → `sign` → `compare`,
all on exact `bigint`. This is the literal proof that "add … everything derives
from nand"; the tests cross-check each against native `bigint`. It runs under a
`bits.` namespace so it is a separately-testable _exhibit_, never silently the
substrate of a real-number computation.

The arithmetic primitives are **polymorphic over the numeric domains**: when all
operands are exact (`bit`/`int`) they run on `bigint` and agree with the
bootstrap; the moment a `real` appears the expression lifts to IEEE doubles,
which is what the limit layer needs.

### 3. Numerical — the limit layer (`kernel-numeric.ts`)

One primitive: **`converge(step, tol)`** — iterate a refinement until successive
results agree within ε. This is the _only_ thing that makes the engine numerical
rather than a classical (exact, finite) ALU. Exposed: `diff`, `integrate`,
`solve`; derived: `exp`, `log`, `sin`, `cos`, `sqrt`, `optimize`
(`= solve(diff
f)`), `odeSolve`, `regress` (`= linsolve` on the normal
equations), `interpolate`, `powerEig` / `topSingular` (power iteration
`= converge`).

### 4. N-dimensional — the list layer (`kernel-nd.ts`)

A value may also be an **`nd`**: an ordered list whose elements are _themselves_
values of any domain — a scalar, or another `nd`. That one recursive case is the
whole generalisation: a matrix is an `nd` of `nd`s, a ragged table is an `nd` of
unequal-length `nd`s, a heterogeneous row mixes a number, a symbol, and a
sub-list. There is no separate vector/matrix type and no new primitive per rank.

Three structural primitives — the only ops that touch a list's elements:

```
nd(a, b, …)   pack operands into a list      (construct)
length(xs)    the top-level element count    (measure)
at(xs, i)     the i-th element, ±from end    (project)
```

Everything else derives from those three plus the scalar kernels. The
higher-order ops take an **operation as their argument**, resolved by the _same_
machinery any operator is (a surface form, else its resonant meaning — see
`OpContext.resolveOp`), so the fold/transform/predicate is **any operation the
kernel already has**, never a bespoke table:

```
map(xs, f)        = nd( f(at xs i) for i in 0…length xs )
filter(xs, p)     = the elements where p holds
reduce(xs, f[,z]) = f(… f(f(z, at xs 0), at xs 1) …)   reduce(xs,+)=sum, (xs,*)=product, (xs,max)=maximum
find(xs, p)       = the first element where p holds, else the empty nd
```

plus `concat`, `reverse`, `flatten`, `zip`, `range`, `rank` (nesting depth),
`shape`. Because `reduce`'s `f(acc, elem)` re-enters `apply`, a `reduce(rows,+)`
broadcasts `+` over the row-lists — a column sum falls out, no matrix code.

## The irreducible kernel

- one gate — `nand`
- two identities + six ops — `0, 1, add, negate, multiply, reciprocal, sign` (+
  optional `floor`/`mod`)
- one limit operator — `converge`
- three structural ops — `nd, length, at`

Everything else is a rewrite rule over those.

## Values: byte-native, multimodal, and n-dimensional

SEMA computes on bytes of any modality, so ALU's value is a tagged union
(`value.ts`) — four scalar domains plus the recursive container:

```ts
type Value =
  | { domain: "bit"; b: 0 | 1 }
  | { domain: "int"; n: bigint }
  | { domain: "real"; x: number }
  | { domain: "symbol"; bytes: Uint8Array }
  | { domain: "nd"; items: Value[] }; // recursive: a list of any-domain values
```

A **`symbol`** is an opaque byte span — text, an image region, an audio
fragment, any learned form. ALU never interprets it; it is the carrier for the
**polymorphic inverse**: the inverse of a number is its negation, but the
inverse of a symbol is its _resonant opposite_, found in the resonance space,
not by arithmetic. That single `inverse` op dispatches on the operand's domain —
so "the inverse of 3 is −3" and "the opposite of ‹a learned form› is ‹its
resonant opposite›" are one operation.

An **`nd`** is the recursive container above. The default codec spells it as a
bracket literal `[e0,e1,…]` (nestable, heterogeneous) that round-trips through
`parseValue`; a symbol element keeps its raw bytes, so a list of any modality
survives.

### Every operation supports `nd`, via one mechanism: **broadcast**

A scalar op applied to a list lifts over it element-wise, and because each
element re-enters `apply`, nesting recurses with no extra code — `add`, `sin`,
`nand`, and the polymorphic `inverse` all broadcast for free:

```
add([1,2,3], [4,5,6])  = [5,7,9]          two lists zip
add([1,2,3], 10)       = [11,12,13]       a scalar is held constant
add([[1,2],[3,4]], …)  recurses           a matrix op is the same op
inverse([large,3,tall]) = [small,-3,short] numbers negate, symbols resonate
```

This is implemented in exactly one place (`OperationRegistry.context`). The list
layer's own ops are marked **structural** (broadcast-exempt) — a `reduce` must
see the whole list, not be lifted across the very elements it folds. The two
halves of "all operations support nd" — scalar ops broadcasting _down_ into
lists, structural ops consuming lists _whole_ — meet exactly there.

## How it joins the SEMA search

The ALU is completely decoupled from Sema. It joins the mind through
`aluToMechanism` ([`../mind/mechanisms/alu.ts`](../mind/mechanisms/alu.ts),
re-exported from [`../mind/pipeline.ts`](../mind/pipeline.ts)), a thin adapter
that wraps the ALU's `parse` in a `PipelineMechanism` — the same uniform
interface every grounding mechanism (CAST, confluence, cover, extraction,
recall) implements, so nothing about the ALU is special-cased in the pipeline.

### The contract

`PipelineMechanism`'s `parse` is the part the ALU actually uses:

```ts
interface PipelineMechanism {
  parse?(query: Uint8Array): Promise<ComputedSpan[]>;
  floor(ctx, query, pre): Promise<number | null>;
  run(ctx, query, pre): Promise<MechanismResult[]>;
}
```

A `ComputedSpan` is `{ i, j, bytes }` — a half-open byte range and the
authoritative result bytes computed for it.

At construction, every extension factory receives an `ExtensionHost` — four
neutral capabilities the mind already has for its own purposes:

```ts
interface ExtensionHost {
  meaningOf(
    bytes: Uint8Array,
    anchors: ReadonlyArray<{ name: string; form: Uint8Array }>,
  ): Promise<string | null>;
  continuation(bytes: Uint8Array): Promise<Uint8Array | null>;
  segment(bytes: Uint8Array): Array<{ i: number; j: number }>;
  reach: number;
}
```

The host port knows nothing about ALU. The ALU adapts it into the specialised
`AluResonance` ([`resonance.ts`](src/resonance.ts)) it needs:

- `meaningOf` → `recogniseOp` — which registered operation does a span mean?
- `continuation` → `opposite` — the polymorphic inverse of a symbol

### The parser

The `QueryParser` ([`parser.ts`](src/parser.ts)) scans the raw query bytes for
two kinds of computation:

**Infix arithmetic** — literal numbers and symbolic operators (`"2+3*4"`). The
parser uses an expression grammar with precedence climbing
([`expr.ts`](src/expr.ts)) and byte-class constants ([`text.ts`](src/text.ts))
that are independent of the river's content-defined chunking, so a multi-digit
number the river would split across groups is still read whole. Each run is
evaluated through the kernel and emitted as a `ComputedSpan`.

**Operations by meaning** — a term may name an operation not by a literal
surface form (`"sqrt"`) but by _resonance_: its gist lands on a learned concept
anchor that was registered as an operation's meaning. This is the only path that
needs the host. The ALU also carries a `STRUCTURAL_HOST` constant — a host that
knows nothing beyond structure (whitespace-only segmentation, unbounded reach,
no resonance). Without a real host, the parser still reads literal notation;
only meaning-based paths stay silent.

### Pre-resolution — async to sync

Two of the parser's needs are asynchronous in Sema (they hit the resonance
index): recognising an operation by meaning, and finding the polymorphic inverse
of a symbol. The ALU uses the same async-to-sync prefetch pattern that the mind
uses for concept hops:

```ts
const sync = await prefetchResonance(resonance, spans);
// sync.ops:  Map<bytes, OperationRecord>  — operation by meaning
// sync.syms: Map<bytes, Uint8Array>       — symbolic inverses
```

The synchronous op callbacks never await — they read from the pre-resolved
snapshots. The public `Mind.compute(name, operands)` path pre-resolves every
symbol span before the synchronous kernel runs, using the same discipline.

### The mind loop

`think()` collects every mechanism's `parse` result before the grounding loop
runs:

```ts
for (const m of mechanisms) {
  if (m.parse) out.push(...await m.parse(query));
}
```

Each result is grounded into an `Out` item with `rec = true` (authoritative,
like a learned edge) at `STEP` cost. Then — crucially — any recognised site
whose span overlaps a computed span is **masked** before the search. This is the
"computation always wins" policy: a deliberately-trained `2+2 → 5` is masked;
the computed `4` is the cover's sole completion there. The search itself stays a
neutral cost engine (a computed `Out` and a learned edge both cost `STEP`);
precedence lives entirely in the masking step, which is in
`src/mind/pipeline.ts`, not in the search and not in the ALU.

A computation and an _unrelated_ rewrite still compose in one answer
(`"ice 2+2"` → `"cold 4"`) because the masking is scoped to the colliding span
only.

### The complete decoupling

```
src/mind/mind.ts                           alu/
  └── mechanisms: PipelineMechanism[]
        └── parse(query)                   ← the part the ALU uses
              ↑ aluToMechanism(alu) wraps
        Alu                                ← plain class, no mechanism shape
              ↑ receives at construction
        ExtensionHost port                 ← 4 neutral capabilities
              ↑ mind.extensionHost()
        AluResonance adapter               ← specialised reading
              ↑ parser.ts QueryParser
```

The ALU imports nothing from the mind except `../../bytes.js`. The mind imports
nothing from the ALU beyond its `Alu` class and the `PipelineMechanism`
contract. Each remains independently testable (the ALU test suite runs with zero
Sema dependency) and replaceable. A user-supplied extension — a CAS, a type
checker, a domain-specific solver — joins through the same `mechanismFactories`
hook (`MindOptions.mechanismFactories`), receives the same host port, and its
computed spans mask recall with the same precedence.

## Adding an operation

One declarative call, in the relevant kernel file or by the host:

```ts
registry.derive("hypot", 2, ["hypot"], (args, ctx) =>
  ctx.apply("sqrt", [
    ctx.apply("add", [
      ctx.apply("multiply", [args[0], args[0]]),
      ctx.apply("multiply", [args[1], args[1]]),
    ]),
  ]));
```

No kernel edit, no graph-search edit, no resonance edit — name it, list its
surface forms, write the body in terms of existing ops. A scalar op broadcasts
over `nd` automatically; pass `structural = true` (the trailing flag on
`prim`/`derive`) only for an op that consumes a list _whole_, like the `nd`
kernel's own.

## Layout

```
alu/
├── README.md            this file
├── src/
│   ├── value.ts         the Value union, parse, the byte⇄value codec
│   ├── operation.ts     the Operation record + registry (derivations compose by name)
│   ├── parser.ts        QueryParser: lexer, infix arithmetic, operation-by-meaning
│   ├── expr.ts          expression grammar (precedence climbing), tokenizer
│   ├── text.ts          byte-class constants (digit, whitespace, bracket, etc.)
│   ├── resonance.ts     AluResonance (host-injected) + the async→sync prefetch
│   ├── kernel-logic.ts  nand → not/and/or/nor/xor/xnor/implies/iff/mux
│   ├── kernel-bits.ts   the exact full_adder→add→multiply bootstrap (bigint)
│   ├── kernel-arith.ts  identities + add/negate/multiply/reciprocal/sign + derived
│   ├── kernel-numeric.ts converge → diff/integrate/solve → exp/log/sin/cos/sqrt/…
│   ├── kernel-nd.ts     nd/length/at → map/reduce/filter/find/concat/zip/rank/shape
│   ├── alu.ts           the assembled Alu: exposes parse(), owns the parser
│   └── index.ts         public surface
└── test/
    └── alu.test.ts      self-contained tests (no Sema dependency)
```
