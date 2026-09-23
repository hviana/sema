// 120-composition-is-consequence.test.mjs — the composition matrix.
//
// THE LAW.  A derivation is closed when the structure it built accounts for the
// query's remainder; every transition is then an item that produced BYTES and a
// NODE, priced on the one ladder, and the next mechanism consumes it like any
// other premise.  This file records, for the roadmap's fourteen pairs, which
// law permits the composition and which one forbids it — from the CODE, never
// from "this mechanism does not call that one" (which the roadmap refuses to
// accept as a reason).
//
// THE CLASSIFICATION, each with the code fact that decides it:
//
//   VALID — the second transition consumes the first's conclusion:
//     fact → join           the join resolves its own key (resolve ?? canonResolve)
//     fact → completion     a produced form's continuation is charged MICRO (rcmp)
//     completion → join     VALID for a completion that IS a stored node
//     join → completion     the join concludes a `form` carrying its own node
//     completion → recompletion   the recursion itself (recompleteOpen, memo)
//     recomposition → completion  rcmp: following the fused whole completes it
//     recompose → join      `fuse` names the FUSED whole's node (concat of both)
//     entity → join         deriveThrough's premise IS the entity's node
//
//   INVALID_BY_IDENTITY — the identity of the premise cannot carry the step:
//     join → recompose      the composite's `node` is a PART's, so decomposing it
//                           would return another object's structure
//     completion → join     for a node-less `out`: a computed value is not a
//                           corpus subject, so no stored relation exists through it
//
//   NOT ON THE FRONTIER — semantically fine, structurally out of the chart
//   (no taxonomy label exists for this; stated rather than forced):
//     pivot → join          reason() runs after grounding (pipeline.ts:579) and
//                           its result is the ANSWER, not a GItem on a frontier
//     alignment → join      a connector leaves the cover as a mechanism PAYLOAD
//                           (cover.ts:163 `return links`), not as an item
//
//   UNKNOWN — the code does not decide, so no claim is made:
//     join → alignment      the two live in different layers (the cover's chart
//                           vs recall's candidate list); whether a legitimate
//                           composition exists there is not settled by the code
//
// THE INVARIANT THIS FILE PINS, and the reason it is not a duplicate of
// test/118: composition means the NEXT step's premise is the PREVIOUS step's
// conclusion.  The join attempts name their candidate entity, and on a five-fact
// chain those candidates ADVANCE through the chain's subjects — measured:
// "gustaf molander" → "gustaf molander" → "sweden" → "stockholm", never the
// query's own subject.  test/118 pins that the chain completes and counts the
// joins; this pins that each hop stands on the previous one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const FACTS = [
  "The director of Eva is Gustaf Molander.",
  "The country of Gustaf Molander is Sweden.",
  "The capital of Sweden is Stockholm.",
  "The mayor of Stockholm is Karin Wanngard.",
  "The party of Karin Wanngard is the Social Democrats.",
];
const KEYS = [
  ["eva director", 0],
  ["gustaf molander country", 1],
  ["sweden capital", 2],
  ["stockholm mayor", 3],
  ["karin wanngard party", 4],
];
const QUERY = "eva director country capital mayor party";

test("each hop of a join chain stands on the previous hop's conclusion", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  const pairs = [];
  for (const [key, i] of KEYS) {
    pairs.push([key.split(" ").slice(0, -1).join(" "), FACTS[i]], [
      key,
      FACTS[i],
    ]);
  }
  await mind.ingest(pairs);

  const steps = [];
  const answer = String(await mind.respondText(QUERY, (s) => steps.push(s)))
    .trim();

  // The candidate each join attempt stood on.  The FIRST input of a
  // derive-through step is the entity; taking it from the item's own bytes
  // keeps this structural — no parsing of note text, which would be a magic
  // string (the adversarial checklist names it).
  const candidates = steps
    .filter((s) => (s.mechanism ?? []).join("/").includes("deriveThrough"))
    .map((s) => String((s.inputs ?? [])[0]?.text ?? ""));

  assert.ok(
    candidates.length >= 3,
    `the chain must attempt several hops, got ${candidates.length}`,
  );
  const distinct = new Set(candidates);
  assert.ok(
    distinct.size >= 3,
    `the premise must ADVANCE, not repeat the query's subject — candidates ` +
      `${JSON.stringify([...distinct])}`,
  );
  // The chain's own subjects, and NOT the query's (composition means leaving
  // the question's own subject behind and standing on what the last step found).
  assert.ok(
    !distinct.has("eva"),
    `no hop may stand on the query's own subject; got ${
      JSON.stringify([...distinct])
    }`,
  );
  assert.ok(
    distinct.has("sweden") && distinct.has("stockholm"),
    `later hops must stand on the chain's subjects; got ${
      JSON.stringify([...distinct])
    }`,
  );
  assert.ok(
    answer.includes("Social Democrats"),
    `and the chain must reach the last fact, got ${JSON.stringify(answer)}`,
  );
  await store.close();
});
