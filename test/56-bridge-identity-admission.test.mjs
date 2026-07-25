// 56-bridge-identity-admission.test.mjs — the bridge's ZERO-SUBSTITUTION
// admission: a candidate the alignment explains END TO END on BOTH sides,
// separated from the query only by material that does not change what the
// text SAYS, is the SAME learnt form and grounds through its own edge.
//
// "Material that does not change what it says" has ONE definition here, and
// it is read from the corpus, never tuned (AGENTS §2.7, corpus-global
// population): a span is EXPLAINED when it is sub-quantum (< W — typographic
// glue) or every W-window in it is COMMON by the store's own climb (the
// ascent saturates, or it reaches a majority of contexts).  A window that
// reaches NOTHING is novel content and is never explained — the reading that
// separates a droppable "the process of " from a load-bearing "heavy ".
//
// THE GAP THIS CLOSES (measured on the 17.9M-node trained store).  The query
// `Who wrote Romeo and Juliet?` against the trained `Who wrote "Romeo and
// Juliet"?` — two inserted quote characters — returned honest silence.  The
// gist is a STRUCTURAL signature, so a mid-string insertion shifts every fold
// boundary after it: the pair scored cos 0.377, BELOW unrelated neighbours
// like "Who wrote the opera Carmen??" (0.603).  Recall's identity tier gates
// on identityBar (0.969 at that length) and its reach tiers on 0.875, so no
// gist-based tier could ever see it.  Only byte-exact alignment can — and the
// bridge, which does exactly that, refused it for producing NO substitution.
//
// WHAT MUST NOT REGRESS (the documented prefix trap, bridge.ts): when the
// query is a strict byte-PREFIX of several candidates that continue
// differently, the bridge must still refuse — nothing corroborates picking
// one continuation over another, and the surplus IS the invented answer.
// The two shapes are separated by the candidate-side test: an identity
// candidate has ≤ W bytes beyond the alignment, a prefix candidate has its
// whole completion beyond it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = () =>
  new Mind({ seed: 1, store: new SQliteStore({ path: ":memory:" }) });

/** Corroboration for the query's own windows: the bridge only aligns against
 *  content whose W-windows are corpus-attested, so the fixture trains the
 *  phrasing family, not one isolated sentence. */
const TRAIN = [
  ['Who wrote "Romeo and Juliet"?', " William Shakespeare wrote it."],
  ['Who wrote "Hamlet"?', " William Shakespeare wrote it."],
  ['Who wrote "Macbeth"?', " William Shakespeare wrote it."],
  ["Who wrote the opera Carmen?", " Georges Bizet wrote it."],
  ["Who wrote about Romeo and Juliet in an essay?", " A critic did."],
];

async function trained() {
  const mind = mk();
  await mind.ingest(TRAIN);
  return mind;
}

test("1. a query differing only by typographic glue reaches the trained form", async () => {
  const mind = await trained();
  // Same form as the trained question, minus the two quote characters.
  const a = await mind.respondText("Who wrote Romeo and Juliet?");
  assert.match(
    a,
    /Shakespeare/,
    `expected the trained continuation, got ${JSON.stringify(a)}`,
  );
  await mind.store.close();
});

test("2. the exact trained form still answers (no path was displaced)", async () => {
  const mind = await trained();
  const a = await mind.respondText('Who wrote "Romeo and Juliet"?');
  assert.match(a, /Shakespeare/);
  await mind.store.close();
});

test("3. a DIFFERENT trained question is not answered by its neighbour", async () => {
  const mind = await trained();
  const a = await mind.respondText("Who wrote the opera Carmen?");
  assert.match(
    a,
    /Bizet/,
    "the identity admission must not let a near neighbour stand in",
  );
  await mind.store.close();
});

test("4. PREFIX TRAP: a strict prefix of several candidates is still refused", async () => {
  const mind = mk();
  // Three facts sharing one prefix, each continuing differently.  A query
  // that IS that prefix has no corroboration for any single completion; the
  // candidate-side surplus is exactly the answer that would be invented.
  await mind.ingest([
    ["The capital city of France is Paris.", " It sits on the Seine."],
    ["The capital city of Spain is Madrid.", " It sits on the Manzanares."],
    ["The capital city of Italy is Rome.", " It sits on the Tiber."],
  ]);
  const a = await mind.respondText("The capital city of");
  // Whatever the pipeline does with this, the bridge must not manufacture a
  // country: an answer naming one of the three would be the invented
  // completion the trap describes.
  const named = ["Paris", "Madrid", "Rome"].filter((c) => a.includes(c));
  assert.ok(
    named.length !== 1 || a.includes("capital city of"),
    `bridge invented a single completion (${named[0]}) for a bare prefix: ` +
      JSON.stringify(a),
  );
  await mind.store.close();
});

test("5. honest silence survives — an unrelated query still grounds nothing", async () => {
  const mind = await trained();
  const a = await mind.respondText("What is the zorblatt frequency?");
  assert.equal(
    a.length,
    0,
    `expected silence, got ${JSON.stringify(a)} — the identity admission ` +
      `must not lower the bar for unrelated content`,
  );
  await mind.store.close();
});

test("6. determinism: the admission is byte-exact, not scored", async () => {
  const a = await trained();
  const b = await trained();
  const x = await a.respondText("Who wrote Romeo and Juliet?");
  const y = await b.respondText("Who wrote Romeo and Juliet?");
  assert.equal(x, y);
  await a.store.close();
  await b.store.close();
});

// ── The scaffolding reading ────────────────────────────────────────────────

test("7. an omitted CORPUS-COMMON span is explained; a RARE one is not", async () => {
  const { leafIdRun } = await import("../dist/src/mind/canonical.js");
  const { corpusN, edgeAncestors } = await import(
    "../dist/src/mind/traverse.js"
  );
  const { dominates } = await import("../dist/src/geometry.js");

  const mind = mk();
  const T = [];
  for (const x of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
    T.push([`What is the process of ${x}ation?`, ` ${x}ation is a process.`]);
    T.push([`Tell me the process of ${x}ing.`, ` ${x}ing is a process.`]);
  }
  T.push(["Is heavy water wet?", " No, heavy water is not wet."]);
  await mind.ingest(T);

  const N = corpusN(mind);
  const W = mind.space.maxGroup;
  // The predicate under test, mirrored exactly (bridge.ts explainedSpan).
  const explained = (text) => {
    const b = new TextEncoder().encode(text);
    if (b.length < W) return true;
    for (let o = 0; o + W <= b.length; o++) {
      const ids = leafIdRun(mind, b, o, o + W);
      if (ids === null) return false;
      const wid = mind.store.findBranch(ids);
      if (wid === null) return false;
      const r = edgeAncestors(mind, wid, N);
      if (r.saturated) continue;
      if (r.roots.length === 0) return false;
      if (!dominates(r.contextsReached, N)) return false;
    }
    return true;
  };

  assert.equal(
    explained("the process of "),
    true,
    "corpus-common scaffolding must be droppable",
  );
  assert.equal(
    explained("heavy "),
    false,
    "rare, discriminative content must NEVER be written off as scaffolding — " +
      "a candidate omitting it answers a different, narrower question",
  );
  // The reading, not just the population: a window reaching NOTHING is novel
  // content.  Going through reachOf (which maps both saturated and
  // empty-rooted to Infinity) called "heavy " scaffolding and answered
  // "Is water wet?" with "No, heavy water is not wet.".
  assert.equal(
    explained("zqxjwv "),
    false,
    "untrained content is never explained",
  );
  await mind.store.close();
});

test("8. EXACT query coverage — a sub-quantum query-side difference is NOT glue", async () => {
  const mind = mk();
  // A trained arithmetic fact, and a query differing from it only inside a
  // sub-quantum span — but that span is DIGITS, and digits are content.
  await mind.ingest([
    ["what is 2+2?", " 2+2 is 4."],
    ["what is 3+3?", " 3+3 is 6."],
    ["what is 5+5?", " 5+5 is 10."],
  ]);
  const a = await mind.respondText("what is 2^10?");
  assert.ok(
    !a.includes("4."),
    `answered a DIFFERENT arithmetic question: ${JSON.stringify(a)} — the ` +
      `identity admission must require covered === query.length, with no ` +
      `sub-quantum slack on the query side`,
  );
  await mind.store.close();
});
