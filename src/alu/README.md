# alu

A small, dependency-free **ALU**: a tiny irreducible kernel from which
arithmetic, logic and numerical computation are all _derived_. The operations a
mind should not have to learn one number at a time are declared here once: how
to add 2 and 2, how to negate a truth value. It imports nothing from the rest of
the codebase except the pure byte helpers in `../bytes.ts`, and its tests run
with no Sema dependency.

## One tiny kernel; everything else is a rewrite

Each layer declares only its irreducible primitives and derives everything else
from them.

| Layer                               | Primitives                                                                              | Derived                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Logic** (`kernel-logic.ts`)       | `nand`, which is functionally complete on its own                                       | `not`, `and`, `or`, `nor`, `xor`, `xnor`, `implies`, `iff`, and `mux(s, a, b)`, the bridge to control flow                                    |
| **Arithmetic** (`kernel-arith.ts`)  | `0`, `1`, `add`, `negate`, `multiply`, `reciprocal`, `sign` (+ optional `floor`, `mod`) | `subtract`, `divide`, every comparison (`sign ∘ subtract`), `abs`, `min`, `max`, `power`, `gcd`, `polyEval`, `dot`, `matMul`, `linsolve`      |
| **Numerical** (`kernel-numeric.ts`) | `converge(step, tol)`: iterate until successive results agree within ε                  | `diff`, `integrate`, `solve`, `exp`, `log`, `sin`, `cos`, `sqrt`, `optimize`, `odeSolve`, `regress`, `interpolate`, `powerEig`, `topSingular` |
| **N-dimensional** (`kernel-nd.ts`)  | `nd(a, b, …)`, `length(xs)`, `at(xs, i)`                                                | `map`, `filter`, `reduce`, `find`, `concat`, `reverse`, `flatten`, `zip`, `range`, `rank`, `shape`                                            |

- **`converge` is what makes the engine numerical** rather than a classical,
  exact and finite ALU.
- **The bit-vector bootstrap is exact and exercised.** `kernel-bits.ts` builds
  `full_adder` from the logic layer. From it come ripple `add`, two's-complement
  `negate`, shift-add `multiply`, `sign` and `compare`, all on `bigint`, and
  they are cross-checked against native `bigint`. It lives under a `bits.`
  namespace, as a separately tested exhibit, never as the silent substrate of a
  real-number computation.
- **Arithmetic is polymorphic over domains.** Exact operands (`bit`, `int`) run
  on `bigint`. Once a `real` appears, the expression lifts to IEEE doubles.
- **The higher-order list operations take an operation as an argument.** It is
  resolved by the same machinery as any operator: a surface form, or else its
  resonant meaning (`OpContext.resolveOp`). For example, `reduce(xs, +)` is a
  sum, and `reduce(rows, +)` is a column sum.

## Values — byte-native, any modality, n-dimensional (`value.ts`)

```ts
type Value =
  | { domain: "bit"; b: 0 | 1 }
  | { domain: "int"; n: bigint }
  | { domain: "real"; x: number }
  | { domain: "symbol"; bytes: Uint8Array } // an opaque byte span of any modality
  | { domain: "nd"; items: Value[] }; // recursive: a list of any-domain values
```

**A symbol carries the polymorphic inverse.** The inverse of a number is its
negation. The inverse of a symbol is its resonant opposite, found in the
resonance space rather than by arithmetic. One `inverse` operation dispatches on
the operand's domain.

**An `nd` is the only container.** A matrix is an `nd` of `nd`s, and a ragged or
heterogeneous table needs no new type. Its literal is `[e0,e1,…]`, which
round-trips through `parseValue`.

**Broadcast is defined once** (`OperationRegistry.context`). A scalar operation
applied to a list lifts element-wise and recurses into nesting:
`add([1,2,3], 10) = [11,12,13]`, and
`inverse([large,3,tall]) =
[small,-3,short]`. Structural operations, marked with
the trailing `structural = true` flag, are exempt, because they consume a list
whole.

## How it joins a host

The ALU is a plain class (`alu.ts`) that exposes
`parse(query) →
ComputedSpan[]`. A `ComputedSpan` is `{ i, j, bytes }`: a
half-open byte range and the authoritative result computed for it. In Sema,
`aluToMechanism` wraps it as an ordinary pipeline mechanism. Computed spans mask
the recognised sites they overlap, which is how computation always wins
(`docs/mechanisms/alu.md`).

**The host port.** At construction the ALU receives an `ExtensionHost`, four
neutral capabilities that know nothing about the ALU:
`meaningOf(bytes, anchors)`, `continuation(bytes)`, `segment(bytes)` and
`reach`. The ALU adapts them into its own `AluResonance` (`resonance.ts`):

- `meaningOf` becomes `recogniseOp`: which operation does this span mean?
- `continuation` becomes `opposite`: a symbol's inverse.

Without a host (`STRUCTURAL_HOST`), the parser still reads literal notation, and
only the paths that depend on meaning stay silent.

**The parser** (`parser.ts`, with its grammar in `expr.ts` and byte classes in
`text.ts`) finds two kinds of computation:

- **Infix arithmetic** (`2+3*4`), read with precedence climbing and independent
  of any chunking, so a multi-digit number is always read whole.
- **Operations named by meaning,** where a term's gist lands on a learnt anchor
  registered as an operation's meaning.

**Asynchronous reads are resolved before the synchronous kernel runs.**
`prefetchResonance` resolves operations by meaning. Opposites are resolved on
demand (`withOppositesOnDemand`): the kernel runs against the opposites resolved
so far, and is re-run only when it asked for a missing one. Before this, every
symbol operand of every operation paid one halo query, 30–200 ms of a plain
dialogue turn that computed nothing.

## Adding an operation

Add one declarative call:

```ts
registry.derive("hypot", 2, ["hypot"], (args, ctx) =>
  ctx.apply("sqrt", [
    ctx.apply("add", [
      ctx.apply("multiply", [args[0], args[0]]),
      ctx.apply("multiply", [args[1], args[1]]),
    ]),
  ]));
```

Give it a name, its surface forms, and a body made of existing operations. No
kernel, search or resonance edit is needed. A scalar operation broadcasts over
`nd` automatically.

## Layout

```
src/value.ts           the Value union and the byte ⇄ value codec
src/operation.ts       Operation records and the registry; derivations compose by name
src/parser.ts          QueryParser: infix arithmetic and operations by meaning
src/expr.ts, text.ts   the expression grammar and the byte classes
src/resonance.ts       AluResonance and the async → sync pre-resolution
src/kernel-*.ts        logic, bits, arith, numeric, nd
src/alu.ts             the assembled Alu
src/index.ts           public surface
test/alu.test.ts       self-contained tests
```
