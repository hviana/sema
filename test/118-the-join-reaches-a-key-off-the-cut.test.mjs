// 118-the-join-reaches-a-key-off-the-cut.test.mjs — a deposited, CONTINUING key
// must be reachable even when its boundary is not a fold cut of the tail.
//
// WHY THIS EXISTS.  The join builds `key = fact.bytes ‖ tail[0..len]` and used to
// try only the tail's own fold boundaries (plus its end).  A boundary is not a
// proxy for a stored key's end: a deposited member's end is the end of ITS OWN
// stream, and the fold never emits a cut at a stream's end (geometry's `emit`
// guards `at >= n`) — so the boundary that names a real stored key can sit
// between cuts, or beyond every one of them.  Measured on the five-fact chain
// below: the fourth hop's key "stockholm mayor" exists (resolve() finds it), its
// continuation is the mayor fact, and its boundary (p = 6) is NOT among the
// tail's cuts ([4,7]) — so the join could not try it and the answer stopped at
// the third fact.
//
// The candidate ends are now the prefixes that ARE stored nodes, ascending, from
// the host's `contentKeyEnds` — so the shortest name still wins, and every
// deposited key is reachable.
//
// WHAT IS PINNED.  The chain reaches the FIFTH fact, and the join fires at least
// four times.  The counters are the untraced view (AGENTS §6: profile without a
// trace attached).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const F1 = "The director of Eva is Gustaf Molander.";
const F2 = "The country of Gustaf Molander is Sweden.";
const F3 = "The capital of Sweden is Stockholm.";
const F4 = "The mayor of Stockholm is Karin Wanngard.";
const F5 = "The party of Karin Wanngard is the Social Democrats.";

async function chain() {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["eva", F1],
    ["eva director", F1],
    ["gustaf molander", F2],
    ["gustaf molander country", F2],
    ["sweden", F3],
    ["sweden capital", F3],
    ["stockholm", F4],
    ["stockholm mayor", F4],
    ["karin wanngard", F5],
    ["karin wanngard party", F5],
  ]);
  return { mind, store };
}

const text = (resp) => new TextDecoder().decode(resp.bytes).replace(/\0+/g, "");

test("a five-fact chain reaches the fifth fact, through four joins", async () => {
  const { mind, store } = await chain();
  const out = text(
    await mind.respond("eva director country capital mayor party"),
  ).trim();
  const fired = mind.lastCost?.counters.joinFired ?? 0;
  await store.close();

  assert.equal(
    out,
    F5,
    `the chain must reach the fifth fact. A key that EXISTS and LEADS ON ` +
      `("stockholm mayor" → the mayor fact) was not tried because its boundary ` +
      `is not a cut of the tail alone — the join was asked to extend from the ` +
      `third fact and stopped (joinFired=${fired})`,
  );
  assert.ok(
    fired >= 4,
    `the join must fire once per licensed hop (measured ${fired}); four hops ` +
      `were available: eva→gustaf molander→sweden→stockholm→karin wanngard`,
  );
});
