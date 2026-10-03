// 152-the-read-side-names-as-the-write-side.test.mjs — a stored deposit asked
// verbatim resolves to itself, however the store named its branches.
//
// THE DEFECT.  `intern` (store.ts) names a branch by its children; when they
// name none, it looks up the FLAT node over the same bytes and reuses it (step
// 1b, "same bytes, same node").  Every deposit interns flat nodes — its whole
// input and each canonical window — so a later deposit whose fold grouped
// `ver` + `!` was stored with an earlier deposit's window `ver!` as that
// child.  The read side (`exactNode`, `foldTree`) named branches by their
// children alone, so it could never name such a deposit again: measured on the
// 31.7M-node store, 7 of 80 dialogue turns asked verbatim resolved to nothing
// and fell to the composition path (seconds instead of milliseconds).
//
// Pinned:
//   152.1 the deposit resolves to its own context node, which leads to its
//         continuation — through a branch named by its bytes;
//   152.2 the identity fold and the vector fold name the same node;
//   152.3 it is answered on the exact path — the cover alone, no consensus
//         climb — not after the whole market (which reached the same reply
//         through recall, 6 mechanism runs and a climb, before the fix).
//   152.4 a name found ONLY through the bytes (a flat index entry, no learnt
//         structure) is where the exact lookup used to miss, so `resolve`
//         still asks the canonical class there — which holds the learnt
//         member that continues;
//   152.5 recognition does the same, so a query named only by such an entry
//         is answered through the equivalent form that continues.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import {
  exactNaming,
  exactNode,
  foldTree,
  perceive,
  resolve,
} from "../dist/src/mind/primitives.js";
import { textCanon } from "../dist/src/canon.js";

const QUERY = "Hey, Sarah. Come check out my new river!";
const REPLY = "Wow, you dug a trench.";
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

async function fixture() {
  const mind = new Mind({
    seed: 7,
    profile: true,
    store: new SQliteStore({ path: ":memory:" }),
  });
  // `Clever!` interns the canonical window `ver!` FIRST, so the pair's own
  // fold — which groups `ver` + `!` — is stored with that window as the child.
  await mind.ingest([["Clever!", "a word"], [QUERY, REPLY]]);
  return mind;
}

test("152.1 a deposit stored through a flat window resolves to its own context", async () => {
  const mind = await fixture();
  mind.beginResponse();
  try {
    const id = resolve(mind, enc(QUERY));
    assert.notEqual(id, null, "the stored deposit must resolve");
    const next = mind.store.nextFirst(id, 1);
    assert.equal(dec(mind.store.bytes(next[0])), REPLY);
    assert.ok(
      mind.meter.flatBranchNames > 0,
      "the fixture must exercise a branch the store named by its bytes",
    );
  } finally {
    mind.endResponse();
  }
  await mind.store.close();
});

test("152.2 the identity fold and the vector fold name the same node", async () => {
  const mind = await fixture();
  mind.beginResponse();
  try {
    const bytes = enc(QUERY);
    const viaIdentity = exactNode(mind, bytes);
    const viaVectors = foldTree(mind, perceive(mind, bytes), 0).node;
    assert.notEqual(viaIdentity, null);
    assert.equal(viaIdentity, viaVectors);
  } finally {
    mind.endResponse();
  }
  await mind.store.close();
});

test("152.3 the deposit asked verbatim is answered on the exact path", async () => {
  const mind = await fixture();
  assert.equal(await mind.respondText(QUERY), REPLY);
  const c = mind.lastCost.counters;
  assert.equal(c.mechanismRuns, 1, "the cover alone must ground it");
  assert.equal(c.climbs ?? 0, 0, "no consensus climb may run");
  await mind.store.close();
});

/** A flat index entry for `tonight` with NO learnt structure over those bytes —
 *  the state the 31.7M-node store holds for it (written by an earlier deposit
 *  path; today's deposits always intern the structure beside the flat copy, so
 *  the state is built through the store's own write API) — and the case-folded
 *  `Tonight`, learnt with a continuation. */
async function byteOnly() {
  const mind = new Mind({
    seed: 7,
    profile: true,
    store: new SQliteStore({ path: ":memory:", D: 1024, maxGroup: 4 }),
  });
  await mind.ingest([[
    "Tonight",
    "The composer of Tonight is Leonard Bernstein.",
  ]]);
  await mind.store.putBranch(
    Array.from(enc("tonight"), (b) => -(b + 1)),
    new Float32Array(1024).fill(1 / 32),
  );
  await mind.buildCanonIndex();
  return mind;
}

test("152.4 a name found only through the bytes still asks the canonical class", async () => {
  const mind = await byteOnly();
  mind.beginResponse(undefined, textCanon);
  try {
    const named = exactNaming(mind, enc("tonight"));
    assert.notEqual(named.id, null, "the flat entry names the bytes");
    assert.equal(named.byBytes, true, "…and nothing but the bytes names them");
    const id = resolve(mind, enc("tonight"));
    assert.equal(dec(mind.store.bytes(id)), "Tonight");
    assert.ok(mind.store.hasNext(id), "the class member that continues");
  } finally {
    mind.endResponse();
  }
  await mind.store.close();
});

test("152.5 a query named only by bytes is answered through the form that continues", async () => {
  const mind = await byteOnly();
  assert.equal(
    await mind.respondText("tonight"),
    "The composer of Tonight is Leonard Bernstein.",
  );
  await mind.store.close();
});
