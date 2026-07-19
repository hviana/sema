// 40-choosenext-scale-guard.test.mjs — chooseNext's disambiguation must not
// be gated by consensusFloor(N) at corpus scale.
//
// Traced live (analyze_training.ts, robustness probe "typo in query"):
// "What is the capitol of France?" (typo: capitol→capital) correctly
// resonates onto the learnt node "What is the capital of France?", whose
// forward edges are UNAMBIGUOUSLY dominated by "The capital of France is
// Paris." (prevCount 2, vs 1/1/1 for three other edges) — a genuine,
// structural winner by chooseNext's own loop (traverse.ts:517-529), which
// already requires strict dominance; a tie leaves first-inserted as the
// pick, exactly the "no real winner" case a floor would matter for.
//
// But chooseNext ALSO gated this pick on `bestSupport < consensusFloor(N)`
// once the corpus scale crosses atomIsHub's threshold (traverse.ts:541-546)
// — reusing the SAME ln(N)+0.5 floor recallByResonance and commitVotes use
// for POOLED, IDF-weighted CLIMB VOTES (each region worth up to ln N, so a
// sum exceeding ln N + 0.5 is more than any one region could say alone —
// HOW_IT_WORKS.md §8.6).  `prevCount(candidate)` is a different kind of
// quantity: a raw count of how many training contexts independently
// predicted ONE destination, bounded by how many times that specific fact
// was retold — NOT by corpus size N.  Gating an N-invariant count against
// an N-growing threshold guarantees failure once N is large enough
// (verified live: N≈325K gives a floor of ≈13.19, so a genuinely dominant
// but only-doubly-attested fact like "capital of France → Paris" was
// refused, falling back to a noisy concept-hop that produced the wrong
// answer).  HOW_IT_WORKS.md's own canonical chooseNext pseudocode (§25)
// has NO such floor — it's undocumented implementation drift, not a
// deliberate design surface.  Fix: remove the gate; chooseNext's existing
// strict-dominance loop already IS the "genuinely competing" test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { chooseNext } from "../dist/src/mind/traverse.js";
import { gistOf, resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);

test("chooseNext: a genuinely-dominant edge is trusted at large corpus scale", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });

  // Push edgeSourceCount() well past atomIsHub's crossover (N > ~4096 at
  // the default maxGroup=4) with cheap, unrelated filler facts — this is
  // the ONLY way to exercise the scale-gated branch at all; every existing
  // chooseNext test (test/30) stays at small N, where the gate was already
  // inert (consensusFloor(N) < 2 for N < 4.5), so none of them cover this.
  const filler = [];
  for (let i = 0; i < 4300; i++) filler.push([`filler-${i}`, `f${i}`]);
  await m.ingest(filler);

  // "trigger" has three continuations: "winner" is corroborated by TWO
  // distinct contexts ("trigger" itself and "also trigger"); the other two
  // by one each — an unambiguous, strictly-dominant winner.
  await m.ingest([
    ["trigger", "winner"],
    ["trigger", "loserA"],
    ["trigger", "loserB"],
    ["also trigger", "winner"],
  ]);

  const triggerId = resolve(m, enc("trigger"));
  const winnerId = resolve(m, enc("winner"));
  assert.ok(triggerId !== null && winnerId !== null, "corpus must resolve");

  const guide = gistOf(m, enc("trigger"));
  const picked = chooseNext(m, triggerId, guide);
  assert.equal(
    picked,
    winnerId,
    `expected chooseNext to trust the strictly-dominant edge (prevCount 2 ` +
      `vs 1/1/1) even at large corpus scale, got ${picked}`,
  );
  await m.store.close();
});
