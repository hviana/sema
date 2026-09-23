// 128-the-leads-somewhere-pair-agrees.test.mjs — THE PAIR, PINNED
//
// "Does this node lead somewhere?" is answered in TWO homes, and they cannot
// share a name: `traverse.ts`'s `leadsSomewhere` is `cachedHasNext || hasHalo`,
// and `primitives.ts` spells out `hasNext || hasHalo` because `traverse.ts`
// imports that file (a cycle) — the comment there says so.  Two spellings of
// one predicate is a drift risk, so this pins the AGREEMENT, node by node,
// through the observable surface only: `mind.leadsSomewhere(id)` against
// `store.hasNext(id) || store.hasHalo(id)`.
//
// It is NOT a claim that the two are the same function: one reads a memo, the
// other reads the store.  The claim is that the memoised reading and the store
// reading agree — what makes the spelled-out copy correct, and what would break
// first if `cachedHasNext` ever outlived a store write.
//
// THE REACH OF THIS PIN, said as it is: halos are poured on the WRITE side, so
// a synthetic corpus of this shape carries NONE (measured: 0 nodes with a halo
// on a 6-fact and on a 10-fact corpus).  The halo clause of the pair therefore
// cannot be exercised here at all — the pin's last guard asserts that measured
// zero, so that a future corpus which DOES carry halos turns this into a
// signal to extend the pin.  What IS exercised: the agreement itself, node by
// node, over every node the corpus mints, with guards so an all-false walk
// cannot pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const CORPUS = [
  "birds fly in the sky",
  "planes fly in the sky",
  "kites fly in the sky",
  "arrows fly in the sky",
  "the sky is blue",
  "the sea is blue",
  "ice is cold",
  "steel is cold",
  "water boils at one hundred degrees",
  "iron melts at one thousand degrees",
];

test("the two homes of 'leads somewhere' agree, node by node", async () => {
  const m = new Mind({ seed: 1, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(CORPUS);

  const total = m.store.nodeCount();
  let withEdge = 0;
  let withHalo = 0;
  for (let id = 0; id < total; id++) {
    const named = m.leadsSomewhere(id);
    const spelled = m.store.hasNext(id) || m.store.hasHalo(id);
    const hasEdge = m.store.hasNext(id);
    const hasHalo = m.store.hasHalo(id);
    if (hasEdge) withEdge++;
    if (hasHalo) withHalo++;
    assert.equal(
      named,
      spelled,
      `node ${id}: traverse.leadsSomewhere says ${named}, ` +
        `primitives' spelling says ${spelled} (hasNext=${hasEdge}, hasHalo=${hasHalo})`,
    );
  }

  assert.ok(total > 10, `corpus should mint more than 10 nodes, got ${total}`);
  assert.ok(
    withEdge > 0,
    "no node in this corpus has a continuation: the edge side of the pair is untested",
  );
  // The halo side, measured: `withHalo` is 0 on these corpora (a 6-fact and a
  // 10-fact one), so the halo clause of the pair cannot be exercised by a
  // synthetic corpus of this shape — halos are poured on the WRITE side.  This
  // is the pin's declared edge, not a hidden one: the agreement is pinned over
  // every node the corpus mints, and the halo clause needs a store that
  // carries halos to be pinned at all.
  assert.equal(
    withHalo,
    0,
    "these corpora now carry halos: extend this pin to exercise the halo clause",
  );

  await m.store.close();
});
