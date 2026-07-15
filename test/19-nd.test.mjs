import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// =========================================================================
// N-DIMENSIONAL VALUES through the MIND — the ALU's value generalised
// =========================================================================
//
// The ALU's `Value` gained one recursive case: an `nd` is an ordered list whose
// elements are themselves Values of ANY domain — a scalar (bit/int/real/symbol)
// or another `nd`.  That single case is the whole generalisation: a matrix is an
// nd of nds, a ragged table is an nd of unequal-length nds, and a heterogeneous
// row mixes numbers and symbols.  There is no separate vector/matrix type and no
// new primitive per rank.
//
// Two properties make "all operations support nd" hold, and BOTH route through
// the mind's resonance — the same meaning channel concept hops and the
// polymorphic inverse already use:
//
//   • BROADCAST — every SCALAR op lifts over a list element-wise, recursing
//     through nesting.  The polymorphic inverse is the sharp case: over a
//     heterogeneous list it negates the numbers and resolves each symbol's
//     RESONANT OPPOSITE, grounded in the corpus (never fabricated).
//
//   • HIGHER-ORDER ops (map / reduce / filter / find) take an OPERATION as their
//     argument, resolved INTELLIGENTLY — a literal surface form ("+","max"), a
//     synonym, or a meaning the bytes do not spell, via resonance.  So the fold
//     of a reduce, the transform of a map, the predicate of a filter is ANY
//     operation the kernel already has: there is no bespoke callback table.
//
// `Alu.compute(op, operandBytes)` is the entry point: it pre-resolves the
// resonance every reachable symbol needs (recursing into nd) and runs the
// synchronous kernel against it.  Operands are byte spans; a bracket literal
// "[1,2,3]" decodes to an nd and the result re-encodes canonically.
//
// The programmatic API belongs to the ALU's own instance, not the Mind: the
// Mind only knows the generic MindExtension contract (parse).  A caller that
// wants direct computation registers the ALU itself through the extensions
// factory — which receives the mind's host port — and keeps the reference.

import { Alu } from "../dist/src/alu/src/index.js";
import { aluToMechanism } from "../dist/src/mind/pipeline.js";

/** A mind wired with an ALU extension whose instance the caller keeps: the
 *  mind stays generic; the computational API lives on the extension. */
const mk = () => {
  let alu;
  const m = new Mind({
    seed: 7,
    alu: { enabled: false }, // the built-in stays off; we hold our own
    mechanismFactories: [(host) => {
      alu = new Alu({}, host);
      return aluToMechanism(alu);
    }],
  });
  m.alu = alu; // test convenience: carry the handle alongside the mind
  return m;
};

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => (b === null ? null : new TextDecoder().decode(b));
/** Compute and decode in one step. */
const compute = async (m, op, ...operands) =>
  dec(await m.alu.compute(op, operands.map(enc)));

// ── 1. Broadcast: arithmetic lifts over lists with NO training ───────────

test("a scalar op broadcasts over a list, and over two lists element-wise", async () => {
  const m = mk();
  assert.equal(await compute(m, "add", "[1,2,3]", "[4,5,6]"), "[5,7,9]");
  assert.equal(await compute(m, "add", "[1,2,3]", "10"), "[11,12,13]");
  assert.equal(await compute(m, "multiply", "[1,2,3]", "[2,2,2]"), "[2,4,6]");
  await m.store.close();
});

test("broadcast recurses through nesting — a matrix op is the same operation", async () => {
  const m = mk();
  // The element-wise lift re-enters apply per element, so an nd of nds lifts
  // twice with no matrix-specific code.
  assert.equal(
    await compute(m, "add", "[[1,2],[3,4]]", "[[10,20],[30,40]]"),
    "[[11,22],[33,44]]",
  );
  assert.equal(
    await compute(m, "multiply", "[[1,2],[3,4]]", "3"),
    "[[3,6],[9,12]]",
  );
  await m.store.close();
});

test("a list with no training computes where the corpus is silent (like 2+2)", async () => {
  const m = mk();
  // Exactly the ALU-grounds-computation property of 18-alu, now over a list.
  assert.equal(await compute(m, "sqrt", "[1,4,9,16]"), "[1,2,3,4]");
  await m.store.close();
});

test("a list is recognised by ANY consistent separator, no spelling privileged", async () => {
  const m = mk();
  // The Mind recognises a list as a run of element-values joined by a consistent
  // separator — the same connective the cover bridges between recognised spans.
  // Bracket+comma, bare spaces, commas, or the word "and" all name the SAME list;
  // the bracket form is just the canonical OUTPUT spelling.
  for (const xs of ["[1,2,3]", "1 2 3", "1, 2, 3", "1 and 2 and 3"]) {
    assert.equal(await compute(m, "reverse", xs), "[3,2,1]", xs);
    assert.equal(await compute(m, "reduce", xs, "+"), "6", xs);
  }
  // Two separator-free lists broadcast element-wise just the same.
  assert.equal(await compute(m, "add", "1 2 3", "4 5 6"), "[5,7,9]");
  await m.store.close();
});

test("an inconsistent separator is NOT one list (it stays an opaque scalar)", async () => {
  const m = mk();
  // "1 2,3" mixes a space and a comma between operands — not one consistent
  // connective, so it is not recognised as a sequence; length over a non-list
  // declines, exactly the "this rule does not fire" contract.
  assert.equal(await compute(m, "length", "1 2,3"), null);
  await m.store.close();
});

// ── 2. The polymorphic inverse broadcasts, resolving each symbol's opposite ─

test("inverse over a heterogeneous list: numbers negate, symbols resonate", async () => {
  const m = mk();
  // The corpus grounds the oppositions; the inverse recalls them, never invents.
  await m.ingest([["large", "small"], ["tall", "short"]]);
  // One op over [symbol, number, symbol] — each element dispatched on its domain.
  assert.equal(
    await compute(m, "inverse", "[large,3,tall]"),
    "[small,-3,short]",
  );
  await m.store.close();
});

test("a symbol with no grounded opposite is left unchanged inside the list", async () => {
  const m = mk();
  await m.ingest([["hot", "cold"]]);
  // "hot" resolves; the ungrounded "zorp" is faithfully left as-is (not faked).
  assert.equal(await compute(m, "inverse", "[hot,zorp]"), "[cold,zorp]");
  await m.store.close();
});

// ── 3. reduce: the fold is ANY existing binary operation ─────────────────

test("reduce folds by the operation named — +, *, max, min are sum/product/extremes", async () => {
  const m = mk();
  assert.equal(await compute(m, "reduce", "[1,2,3,4]", "+"), "10");
  assert.equal(await compute(m, "reduce", "[1,2,3,4]", "*"), "24");
  assert.equal(await compute(m, "reduce", "[3,1,4,1,5,9]", "max"), "9");
  assert.equal(await compute(m, "reduce", "[3,1,4,1,5,9]", "min"), "1");
  await m.store.close();
});

test("reduce by a binary op broadcasts — reduce(rows, +) is the column sum", async () => {
  const m = mk();
  // The fold's "+" itself broadcasts over the row-lists, so summing the rows of a
  // matrix yields the per-column totals — composition, not a special routine.
  assert.equal(
    await compute(m, "reduce", "[[1,2,3],[4,5,6],[7,8,9]]", "+"),
    "[12,15,18]",
  );
  await m.store.close();
});

// ── 4. map / filter / find with operation arguments ──────────────────────

test("map applies the named unary op to each element", async () => {
  const m = mk();
  assert.equal(await compute(m, "map", "[1,2,3]", "negate"), "[-1,-2,-3]");
  assert.equal(await compute(m, "map", "[1,4,9]", "sqrt"), "[1,2,3]");
  await m.store.close();
});

test("filter keeps elements the predicate accepts; find returns the first (else empty)", async () => {
  const m = mk();
  // "sign" is 0 for zero, 1 for positive — a truthiness predicate over the list.
  assert.equal(await compute(m, "filter", "[0,5,0,3,0,8]", "sign"), "[5,3,8]");
  assert.equal(await compute(m, "find", "[0,0,7,0]", "sign"), "7");
  // nothing matches → the empty list (a grounded "nothing", not a fabricated hit)
  assert.equal(await compute(m, "find", "[0,0,0]", "sign"), "[]");
  await m.store.close();
});

// ── 5. The operation argument is resolved through the mind's recognition ──
//     machinery — ANY operation named however the kernel knows it (a synonym is
//     a surface form; an unspelled MEANING resonates by gist — that gist path is
//     exercised in the ALU unit suite with a stub, since the live gist index has
//     a high acceptance threshold).

test("the same fold is named by ANY of an operation's synonyms, not a fixed token", async () => {
  const m = mk();
  // add answers to "+", "plus", "sum", "total"; multiply to "*", "times",
  // "product".  reduce reuses whichever the asker names — there is no bespoke
  // reduce-operator table; it is the kernel's own operation vocabulary.
  for (const word of ["+", "plus", "sum", "total"]) {
    assert.equal(await compute(m, "reduce", "[10,20,30]", word), "60", word);
  }
  for (const word of ["*", "times", "product"]) {
    assert.equal(await compute(m, "reduce", "[2,3,4]", word), "24", word);
  }
  await m.store.close();
});

// ── 6. Structural plumbing end-to-end ────────────────────────────────────

test("length / at / reverse / concat / zip / range / rank / shape over the mind", async () => {
  const m = mk();
  assert.equal(await compute(m, "length", "[5,6,7,8]"), "4");
  assert.equal(await compute(m, "at", "[5,6,7,8]", "-1"), "8"); // negative = from end
  assert.equal(await compute(m, "reverse", "[1,2,3]"), "[3,2,1]");
  assert.equal(await compute(m, "concat", "[1,2]", "[3,4]"), "[1,2,3,4]");
  assert.equal(
    await compute(m, "zip", "[1,2,3]", "[4,5,6]"),
    "[[1,4],[2,5],[3,6]]",
  );
  assert.equal(await compute(m, "range", "5"), "[0,1,2,3,4]");
  assert.equal(await compute(m, "rank", "[[1,2],[3,4]]"), "2");
  assert.equal(await compute(m, "shape", "[[1,2,3],[4,5,6]]"), "[2,3]");
  await m.store.close();
});

// ── 7. Composition and determinism ───────────────────────────────────────

test("a computed nd is itself an operand (composition for free)", async () => {
  const m = mk();
  // map to a new list, then reduce it — the result of one op feeds the next.
  const mapped = await compute(m, "map", "[1,2,3,4]", "negate"); // "[-1,-2,-3,-4]"
  assert.equal(mapped, "[-1,-2,-3,-4]");
  const summed = await compute(m, "reduce", mapped, "+"); // "-10"
  assert.equal(summed, "-10");
  await m.store.close();
});

test("nd computation is deterministic and disabling the ALU makes it inert", async () => {
  const run = async () => {
    const m = mk();
    const r = await compute(m, "add", "[1,2,3]", "[4,5,6]");
    await m.store.close();
    return r;
  };
  assert.equal(await run(), await run());

  // A mind with no ALU extension at all: the operation vocabulary simply does
  // not exist anywhere on the mind — computation is inert by absence, not by a
  // flag check in the machinery.
  const off = new Mind({
    seed: 7,
    alu: { enabled: false },
  });
  assert.equal(typeof off.compute, "undefined");
  await off.store.close();
});
