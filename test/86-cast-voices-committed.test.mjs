// 86-cast-voices-committed.test.mjs — CAST may only SPEAK through a structure
// the climb committed to, or one the query itself named.
//
// THE INVARIANT. cast.ts already states it, in the refusal note its own weave
// gate emits: "CAST refuses to transfer through content the climb itself never
// settled on". That gate asks only that the weave TOUCH a committed point
// (`points.some(isRoot)`) — the right question for MEMBERSHIP, since a weave
// needs uncommitted structure to compare against; that is what an analogy IS.
// It is the wrong question for VOICING: satisfied by any committed bystander,
// it licensed every OTHER aligned point to put its own learnt content into the
// answer while a committed root that contributed nothing held the door open.
//
// WHAT THAT COST, measured on the fixture below (N ~ 103, consensusFloor 5.13):
//
//   climbConsensus committed ONE root:  "Eiffel Tower country"  #5   vote 8.13
//   projectCounterfactual voiced:
//     filler              "What is th"      #535  vote 0.15   <- a FILLER deposit
//     displaced-structure "France capital"  #90   vote 0.57
//   answer "What is the capitalThe capital of France is Paris."   [cast]
//
// Neither voiced structure was committed and both scored 9-34x BELOW the floor,
// while the root that licensed the weave supplied no bytes at all.
//
// WHY THE TEST READS THE TRACE AND NOT THE ANSWER. The answer text is the wrong
// probe: both the pre-fix and post-fix answers on this fixture are malformed
// concatenations, and which one happens to contain the right substring is
// cosmetic. That remaining garbling is a SEPARATE defect — CAST bidding at all
// on a plain factual question — and this file deliberately asserts nothing
// about it. The invariant is structural, so it is asserted structurally: the
// node CAST voices must be a node the climb committed.
//
// THE OTHER HALF OF THE CONTRACT is tests 2 and 3. Commitment is not the only
// warrant — a structure the asker QUOTED is content the query did ask about —
// and an analogy must still transfer from a structure the query never names,
// provided the climb settled on it. A gate that bought the invariant by killing
// either would be no fix at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const CHAIN = [
  ["Eiffel Tower country", "The country of Eiffel Tower is France."],
  ["France capital", "The capital of France is Paris."],
  ["France", "The capital of France is Paris."],
];
const TWO_HOP = "What is the capital of the country of Eiffel Tower?";
// The SHAPE matters: this filler family reproduces the defect at every N from
// 50 up, across seeds 7/42/99 and D 512/1024, and survives a full entity
// rename — so it is a structural fixture, not a byte-pattern one.
const filler = (i) => [
  `What is the status of my request ${i}?`,
  `I have token number ${i} waiting.`,
];

/** Run one query; collect the committed anchors and the structures CAST voiced. */
async function voicedVsCommitted(query, train) {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest(train);
  const committed = new Set();
  const voiced = [];
  await mind.respondText(query, (s) => {
    const name = s.mechanism[s.mechanism.length - 1];
    if (name === "climbConsensus") {
      for (const o of s.outputs ?? []) {
        if (o.role === "anchor" && o.node !== undefined) committed.add(o.node);
      }
    }
    // What each schema transfers THROUGH: substitution voices the displaced
    // structure's tail plus its own continuation; redirection voices the named
    // substitute's own fact.
    if (name === "projectCounterfactual") {
      for (const i of s.inputs ?? []) {
        if (
          (i.role === "displaced-structure" || i.role === "substitute") &&
          i.node !== undefined
        ) voiced.push({ node: i.node, text: String(i.text ?? "") });
      }
    }
  });
  await store.close();
  return { committed, voiced };
}

test("CAST voices only a structure the climb committed to", async () => {
  // THE REGRESSION. Without the gate the displaced structure is #90
  // ("France capital", uncommitted, vote 0.57) while the climb's only
  // committed root is #5 — so `voiced` is not a subset of `committed`.
  const { committed, voiced } = await voicedVsCommitted(TWO_HOP, [
    ...CHAIN,
    ...Array.from({ length: 50 }, (_, i) => filler(i)),
  ]);
  assert.ok(
    committed.size > 0,
    "fixture no longer reaches the consensus climb",
  );
  assert.ok(
    voiced.length > 0,
    "fixture no longer fires a CAST projection — it no longer covers the defect",
  );
  for (const v of voiced) {
    assert.ok(
      committed.has(v.node),
      `CAST voiced #${v.node} ${
        JSON.stringify(v.text.slice(0, 48))
      }, which the climb never committed (committed: ${
        [...committed].join(", ")
      })`,
    );
  }
});

test("a substitute the query NAMES may still be voiced", async () => {
  // OVER-CORRECTION GUARD, and the reason `voiceable` is a disjunction.
  // "what if the capital of France were Lyon?" names Lyon outright; the climb
  // need not have committed it for the asker to have asked about it. Gating on
  // commitment alone refuses this — it is test/29 B3, reproduced here so the
  // dependency is visible from the file that introduces the gate.
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([
    ["what is the capital of France?", "Paris is the capital of France"],
    ["what is the capital of Italy?", "Rome is the capital of Italy"],
    ["Lyon is a city in France", "Lyon is known for its cuisine"],
  ]);
  const got = await mind.respondText(
    "what if the capital of France were Lyon?",
  );
  await store.close();
  assert.ok(
    /Lyon/i.test(got) && !/Paris/i.test(got),
    `the named substitute was refused — expected Lyon, not Paris: ${
      JSON.stringify(got)
    }`,
  );
});

test("an analogy still transfers from a structure the query never names", async () => {
  // THE CAPABILITY THE GATE MUST NOT COST. "steel is frigid" names neither the
  // water context nor its property; transferring from it is exactly what CAST
  // exists to do, and it is licensed here because the climb COMMITTED that
  // structure (test/29 D1 is the same assertion from the other direction).
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([
    ["ice is cold so ice is brittle", "brittle"],
    ["steel is hard so steel is strong", "strong"],
    ["water is frigid so water is freezing", "freezing"],
  ]);
  const r = await mind.respond("steel is frigid");
  const got = new TextDecoder().decode(r.bytes ?? new Uint8Array());
  await store.close();
  assert.equal(
    r.provenance,
    "cast",
    `CAST must still fire — got ${r.provenance}`,
  );
  assert.ok(
    /freezing/i.test(got),
    `property transfer lost — expected "freezing", got ${JSON.stringify(got)}`,
  );
});
