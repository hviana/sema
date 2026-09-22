// 98-completion-chaining.test.mjs — the completion recursion NESTS, and the
// two properties that make that reachable are pinned here.
//
// `graph-search.ts`'s `recompleteNode` used to refuse any re-cover inside a
// re-cover (`recompleteOpen.size > 0`), so a chain through a PRODUCED composite
// stopped after a single recomposition: the depth the A*LD substrate licenses
// was unreachable.  The recursion now nests, but only through ACCEPTED
// completions and only along the produced form's own parts — and with per-query
// work that stays the answer's (test/89 pins the cost).
//
// WHY THESE AND NOT test/15's §9–§12: those exercise chains whose parts all live
// INSIDE the query's own span ("a e", "x y", "p q r"); they pass even with
// `recompleteNode` disabled outright.  §6 reaches a produced composite, but only
// one recomposition deep.  The cases here fail on the pre-change tree:
//   1. the chain stops at the intermediate composite ("m n", not "z"), and
//   2. the nested derivation never reaches the rationale.
//
// MEASURED on the pre-change tree (this file's fixtures):
//   respondText("seed") === "m n"   (one recomposition)
//   rationale moves      = no `fuse`, no `recompose`
// After the change: "z", and both moves present.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";

/** seed → "p q" → (p→r, q→s) → "r s" → "m n" → (m→x, n→y) → "x y" → z
 *
 *  The query names only `seed`.  Every form after the first hop is PRODUCED by
 *  an edge, so reaching `z` requires TWO nested completions: "p q" recomposes to
 *  "m n", and "m n" recomposes again to "x y" → z.  A single-level completion
 *  stops one composite short, at "m n". */
async function deepChain() {
  const m = new Mind({ seed: 7 });
  await m.ingest([
    ["seed", "p q"],
    ["p", "r"],
    ["q", "s"],
    ["r s", "m n"],
    ["m", "x"],
    ["n", "y"],
    ["x y", "z"],
  ]);
  return m;
}

test("a produced composite completes through two nested recompositions", async () => {
  const m = await deepChain();
  assert.equal(
    (await m.respondText("seed")).replace(/\0+/g, ""),
    "z",
  );
  await m.store.close();
});

test("nested completions reach the rationale", async () => {
  const m = await deepChain();
  const steps = [];
  await m.respondText("seed", (s) => steps.push(s));
  const moves = new Set(steps.map((s) => s.mechanism.at(-1)));
  // The top cover cannot fabricate these on its own: recomposition happens
  // inside the nested solves, and they were invisible before the sink was
  // threaded through.
  assert.ok(
    moves.has("recompose"),
    `expected a recompose move in the rationale, got: ${[...moves].join(", ")}`,
  );
  assert.ok(
    moves.has("fuse"),
    `expected a fuse move in the rationale, got: ${[...moves].join(", ")}`,
  );
  await m.store.close();
});

test("a produced composite is completed by its own parts, not by a learned form inside it", async () => {
  // The produced bytes are "hi there"; `hi` is a learned context that is NOT one
  // of their parts.  Re-recognising arbitrary forms inside the bytes is what
  // let a hub-heavy utterance explode on the trained store (`respond("hi.")`:
  // 37 bytes, seven hub openers, 2.5 GB, OOM) — the produced form is decomposed
  // instead by the machinery that owns its shape (leaves/splits), with the
  // recognised SITES filtered to the node's own kids.
  //
  // MEASURED on the pre-change tree: no `recompose` move here at all — the
  // unrelated `hi` site was taken instead of decomposing the form.
  const m = new Mind({ seed: 7 });
  await m.ingest([
    ["seed", "hi there"],
    ["hi", "KLX"],
  ]);
  const steps = [];
  const answer = (await m.respondText("seed", (s) => steps.push(s)))
    .replace(/\0+/g, "")
    .trim();
  assert.equal(answer, "hi there");
  const moves = new Set(steps.map((s) => s.mechanism.at(-1)));
  assert.ok(
    moves.has("recompose"),
    `expected the completion to decompose the form by its parts, got: ${
      [...moves].join(", ")
    }`,
  );
  await m.store.close();
});

test("the chain runs as deep as the graph licenses (four nested completions)", async () => {
  const m = new Mind({ seed: 7 });
  await m.ingest([
    ["seed", "p1 q1"],
    ["p1", "a1"],
    ["q1", "b1"],
    ["a1 b1", "p2 q2"],
    ["p2", "a2"],
    ["q2", "b2"],
    ["a2 b2", "p3 q3"],
    ["p3", "a3"],
    ["q3", "b3"],
    ["a3 b3", "FIM"],
  ]);
  assert.equal((await m.respondText("seed")).replace(/\0+/g, ""), "FIM");
  await m.store.close();
});

test("a completion cycle terminates deterministically (the stack is the guard)", async () => {
  // The recomposition of "x y" leads back to "x y" itself.  Membership in
  // `recompleteOpen` refuses the re-entry, so the recursion terminates on the
  // form it already holds instead of re-covering it forever — and it answers
  // the same bytes twice.
  const m = new Mind({ seed: 7 });
  await m.ingest([
    ["seed", "x y"],
    ["x", "A"],
    ["y", "B"],
    ["A B", "x y"],
  ]);
  const first = (await m.respondText("seed")).replace(/\0+/g, "").trim();
  const second = (await m.respondText("seed")).replace(/\0+/g, "").trim();
  assert.equal(first, second);
  assert.equal(first, "x y");
  await m.store.close();
});
