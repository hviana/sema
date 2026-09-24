// 143 — cycles, in the engine: three topologies, and what must hold for each.
//
// The law holds no `visited`, no `depth`, no `hop`, no `once` and no `cap` — cycle
// prevention belongs to the layer that controls states and consumption, and a cycle is not
// closure.  So the engine must terminate on each topology anyway, and the answer must be a
// fact of the corpus rather than a composition typed around the loop.
//
// A→B→A · A→B→C→A · A→B, B→C, C→B (a loop with a tail, where the refusal is not trivial).
// Each fact is filed under both of its ends, the way the store files one, so the walk has
// every edge the loop needs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const TOPOLOGIES = {
  "A→B→A": [
    ["Alice knows Bob", "Alice knows Bob"],
    ["Bob knows Alice", "Bob knows Alice"],
  ],
  "A→B→C→A": [
    ["Alice knows Bob", "Alice knows Bob"],
    ["Bob knows Carol", "Bob knows Carol"],
    ["Carol knows Alice", "Carol knows Alice"],
  ],
  "A→B, B→C, C→B": [
    ["Alice knows Bob", "Alice knows Bob"],
    ["Bob knows Carol", "Bob knows Carol"],
    ["Carol knows Bob", "Carol knows Bob"],
  ],
};

async function ask(corpus, query) {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(corpus);
  const out = await mind.respond(query);
  const text = new TextDecoder().decode(out.bytes).replace(/\0+/g, "").trim();
  await store.close();
  return text;
}

for (const [name, corpus] of Object.entries(TOPOLOGIES)) {
  test(`143 ${name} terminates and answers from the corpus`, async () => {
    const first = await ask(corpus, "Alice knows");
    const second = await ask(corpus, "Alice knows");
    assert.equal(
      second,
      first,
      "two runs agree: no order-dependent wander around the loop",
    );
    if (first.length > 0) {
      assert.ok(
        corpus.some(([, fact]) => first.includes(fact) || fact.includes(first)),
        `the answer is one of the corpus's own facts, not a composition typed around the loop: ${
          JSON.stringify(first)
        }`,
      );
    }
  });
}
