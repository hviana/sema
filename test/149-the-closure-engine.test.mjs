// 149-the-closure-engine.test.mjs — one closure, over layers.
//
// `closeOver` (derivation.ts) closes a derivation under the law, layer by layer:
// each layer OFFERS, the law admits, and the state a layer reaches is the state
// the next one is offered against.  The pipeline's post-grounding stage is that
// engine with two layers (the walk, the fusion), so the gates it used to spell
// by hand are now the law's or the layer's.  Pinned:
//
//   149.1 ¬FIXED is the engine's, applied before any layer pays: a fixed state
//         enters no layer — no offer is asked, nothing is wrapped.
//   149.2 layers are PHASES, in order, never revisited: the second layer is
//         offered the first one's final state, and the first is not asked again.
//   149.3 a layer that does not ENGAGE is not entered at all.
//   149.4 the law's refusal ends THAT layer's walk, not the closure.
//   149.5 the pipeline asks the engine, and sequences no layer by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeOver } from "../dist/src/mind/derivation.js";

const here = dirname(fileURLToPath(import.meta.url));
const enc = new TextEncoder();
const QUERY = enc.encode("ABCDEFGHIJKL");
const W = 4;
const state = (extra = {}) => ({
  product: new Uint8Array(0),
  accounted: [],
  remainder: [[0, 12]],
  cost: 0,
  ...extra,
});
/** A layer that offers the given products, one per ask, then nothing. */
const layer = (name, products, log, extra = {}) => {
  let i = 0;
  return {
    name,
    offer: async (d) => {
      log.push(`${name}:ask:${new TextDecoder().decode(d.product)}`);
      if (i >= products.length) return null;
      return {
        product: enc.encode(products[i++]),
        contains: true,
        reaches: true,
        cost: 1,
      };
    },
    ...extra,
  };
};

test("149.1 a fixed state enters no layer", async () => {
  const log = [];
  const entered = [];
  const out = await closeOver(
    state({ fixed: true }),
    QUERY,
    W,
    [layer("a", ["x"], log)],
    async (name, walk) => {
      entered.push(name);
      return walk();
    },
  );
  assert.deepEqual(log, [], "no offer may be asked of a fixed state");
  assert.deepEqual(entered, [], "no layer may be entered for a fixed state");
  assert.equal(out.fixed, true);
});

test("149.2 layers are phases, in order, never revisited", async () => {
  const log = [];
  const out = await closeOver(state(), QUERY, W, [
    layer("a", ["a1", "a2"], log),
    layer("b", ["b1"], log),
  ]);
  assert.deepEqual(log, [
    "a:ask:",
    "a:ask:a1",
    "a:ask:a2",
    "b:ask:a2",
    "b:ask:b1",
  ]);
  assert.equal(new TextDecoder().decode(out.product), "b1");
  assert.equal(out.cost, 3, "every admitted step is priced");
});

test("149.3 a layer that does not engage is not entered", async () => {
  const log = [];
  const entered = [];
  await closeOver(
    state(),
    QUERY,
    W,
    [layer("a", ["a1"], log, { engages: () => false }), layer("b", [], log)],
    async (name, walk) => {
      entered.push(name);
      return walk();
    },
  );
  assert.deepEqual(entered, ["b"]);
  assert.deepEqual(log, ["b:ask:"]);
});

test("149.4 the law's refusal ends that layer, not the closure", async () => {
  const log = [];
  const refused = [];
  const ends = [];
  // `a` offers a step that neither carries nor reaches: the law refuses it.
  const a = {
    name: "a",
    offer: async () => ({ product: enc.encode("zz"), contains: true, cost: 1 }),
    onRefused: () => refused.push("a"),
    onEnd: (from, to) => ends.push(["a", from === to]),
  };
  const out = await closeOver(state(), QUERY, W, [a, layer("b", ["b1"], log)]);
  assert.deepEqual(refused, ["a"]);
  assert.deepEqual(ends, [["a", true]], "a refused layer ends where it began");
  assert.equal(new TextDecoder().decode(out.product), "b1");
});

test("149.5 the pipeline asks the engine and sequences no layer by hand", async () => {
  const src = await readFile(
    join(here, "..", "src", "mind", "pipeline.ts"),
    "utf8",
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(code, /closeOver\(/, "the post-grounding stage is the engine");
  assert.ok(
    !/\breason\(|\bfuseAttention\(/.test(code),
    "the pipeline calls a layer's walk directly again — offer it to the engine",
  );
  assert.ok(
    !/decided\.complete\s*\?/.test(code),
    "a complete grounding is the law's FIXED clause, applied by the engine",
  );
});
