// 76 — TYPE-LEVEL COMPANY (the halo pour's constituent profile).
//
// What is under test is ONE claim: two forms become distributional siblings
// when their partners are MADE OF a shared content unit, even though the
// partners share no node at the top of the fold.  That is the difference
// between a halo keyed on a TOKEN ("occurred next to node #4711992") and one
// keyed on a TYPE ("occurred next to something containing 'Paris'").
//
// WHY THESE TESTS CANNOT PASS BY ACCIDENT.  Every positive assertion is paired
// with a NEGATIVE CONTROL drawn from the same fixture, trained in the same
// store, of the same shape and comparable length — so a change that merely
// made all halos correlate (the null model collapsing) fails the control
// instead of passing the positive.  Every bar is DERIVED from D, never tuned:
// `significanceBar` (3/√D) for "this is not chance" and `conceptThreshold` for
// "these are the same concept".  And T1 computes, in-test, the fact that makes
// the whole file a test of the constituent descent rather than of halos in
// general: the two partners' depth-1 constituent sets are DISJOINT, so a
// profile reading only `rec.kids` has literally nothing in common to find.
//
// WHAT EACH TEST IS, STATED HONESTLY.  T1 and T2 are the CAPABILITY tests:
// run against the previous depth-1 profile they fail, on the capability
// assertion itself and not on a precondition — measured -0.0086 against the
// 0.0938 bar, while the fixture's own preconditions still passed, so the
// failure is the missing capability and nothing else.  T3, T4 and T5 pass
// under BOTH implementations by construction: they are not evidence for the
// capability, they are the invariants it must not buy itself with, and each
// one pins a regression this work actually hit — the null model collapsing
// when the descent superposed scaffolding, mass tracking constituents instead
// of episodes, and the profile being read from the deposit's id map instead
// of the store.  Claiming all five as proof of the capability would be false;
// dropping the three would leave the two unfalsifiable.
//
// WHAT IS DELIBERATELY NOT TESTED HERE, AND WHY.  A sixth test asserting that
// company GRADES with shared content (more shared units => more company) was
// written and removed: it is false as stated.  Cosine normalizes by profile
// size, so a pair sharing 3 constituents out of a larger profile scores BELOW
// a pair sharing 1 out of a smaller one — measured at 0.085 against 0.111,
// consistently across all four seeds.  The design's own `shared / (1 + k)`
// reading is size-RELATIVE, and asserting the absolute form encodes a law the
// system does not obey.  Testing the relative form from outside would require
// re-deriving the profile's term-selection rules inside the test, which makes
// the test a mirror of the implementation and worthless as a check on it.
//
// Also untested, and a real limitation rather than an oversight: on a store
// this small the hub bound √N is large enough that frame scaffolding is not
// excluded, so short partners sharing only a frame do keep some company.  That
// is the documented honest floor — a corpus that cannot yet say what
// discriminates — but it means these fixtures must share genuine CONTENT
// units, which T1 now asserts rather than assumes.
//
// Each test pins a DIFFERENT rule.  Deleting any one of them lets a specific,
// named regression back in; none of them subsumes another.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conceptThreshold,
  cosine,
  Mind,
  significanceBar,
} from "../dist/src/index.js";

const D = 1024;
const BAR = significanceBar(D); // 3/√D — above chance
const enc = new TextEncoder();

// Company signatures key on NODE ID, not on the alphabet, so a seeded
// keyring cannot be what makes these comparisons come out — but that is an
// argument, and the capability tests below check it instead, across seeds.
const SEEDS = [7, 1, 42, 99];
const newMind = (seed = 7) => new Mind({ seed, D });
const idOf = (m, s) => m.resolve(enc.encode(s));
const haloOf = (m, s) => {
  const id = idOf(m, s);
  return id === null || id === undefined ? null : m.store.halo(id);
};

/** The halo read must work at all before any comparison means anything.  A
 *  missing halo silently makes every cosine below unreachable, and a broken
 *  one makes them meaningless — this is the control whose absence has voided
 *  whole investigations on this codebase. */
const assertHaloControl = (m, cues) => {
  for (const c of cues) {
    const h = haloOf(m, c);
    assert.ok(h, `CONTROL: no halo poured for ${JSON.stringify(c)}`);
    assert.ok(
      Math.abs(cosine(h, h) - 1) < 1e-9,
      `CONTROL: halo of ${JSON.stringify(c)} is not self-identical`,
    );
  }
};

/** The continuation a cue was trained with, as a node id. */
const partnerOf = (m, cue) => m.store.next(idOf(m, cue))[0];

/** Depth-1 constituents — what a profile reading only `rec.kids` would see. */
const depth1 = (m, node) => new Set(m.store.get(node)?.kids ?? []);

/** Every constituent reachable below `node`, to a depth the fold cannot
 *  exceed for these fixtures — what the descent can see. */
const deepConstituents = (m, node, depth = 6, out = new Set()) => {
  if (depth === 0) return out;
  for (const k of m.store.get(node)?.kids ?? []) {
    if (k < 0) continue;
    out.add(k);
    deepConstituents(m, k, depth - 1, out);
  }
  return out;
};

const intersect = (a, b) => [...a].filter((x) => b.has(x));

// ═══════════════════════════════════════════════════════════════════════════
// T1 — THE CAPABILITY, with its own impossibility proof for the old rule.
//
// Two sentences in different languages that both mention Paris.  Content-
// defined cuts put the shared unit in DIFFERENT top-level chunks:
//   "The Eiffel Tower is in Paris"  ->  "The Eiffel " · "Tower is in Paris"
//   "Tour Eiffel dia any Paris"     ->  "Tour Eiffel " · "dia any Paris"
// so their depth-1 constituents are disjoint — asserted below, not assumed.
// ═══════════════════════════════════════════════════════════════════════════
test("T1: partners sharing a unit BELOW the top of the fold keep company", async () => {
  for (const seed of SEEDS) {
    const m = newMind(seed);
    await m.ingest([
      ["cue_en", "The Eiffel Tower is in Paris"],
      ["cue_mg", "Tour Eiffel dia any Paris"],
      ["cue_zz", "Bananas are grown in humid climates"],
    ]);
    assertHaloControl(m, ["cue_en", "cue_mg", "cue_zz"]);

    const pEn = partnerOf(m, "cue_en");
    const pMg = partnerOf(m, "cue_mg");

    // THE IMPOSSIBILITY PROOF.  A profile built from `rec.kids` alone sees these
    // sets and nothing else; they do not intersect, so no depth-1 rule — however
    // weighted, however filtered — can make these two partners share a term.
    // This test therefore measures the DESCENT, not halos in general.
    assert.equal(
      intersect(depth1(m, pEn), depth1(m, pMg)).length,
      0,
      "fixture no longer exercises the descent: the two partners now share a " +
        "depth-1 constituent, so a depth-1 profile could pass T1 as well",
    );
    // And the units the descent is supposed to find must actually be there —
    // AND be eligible to become profile terms.  A fixture whose only shared
    // constituents are sub-window shards or frame scaffolding measures frame
    // similarity while reading like a content test; one was written during this
    // work and passed for exactly that wrong reason.  The shared unit must be
    // at least the fold's own window wide.
    const W = m.space.maxGroup;
    const shared = intersect(
      deepConstituents(m, pEn),
      deepConstituents(m, pMg),
    );
    assert.ok(
      shared.some((n) => m.store.contentLen(n, W) >= W),
      `fixture is broken: the partners share no constituent of at least W=${W} ` +
        `bytes, so nothing they share can enter a profile`,
    );

    const related = cosine(haloOf(m, "cue_en"), haloOf(m, "cue_mg"));
    const control = cosine(haloOf(m, "cue_en"), haloOf(m, "cue_zz"));

    assert.ok(
      related >= BAR,
      `seed ${seed}: partners sharing a content unit must keep measurable ` +
        `company: got ${related.toFixed(4)}, need >= ${
          BAR.toFixed(4)
        } (3/sqrt(D))`,
    );
    // The control is what makes the line above falsifiable: without it, a
    // regression that made EVERY halo correlate would pass.
    assert.ok(
      control < BAR,
      `seed ${seed}: partners sharing nothing must stay at chance: got ` +
        `${control.toFixed(4)}, need < ${
          BAR.toFixed(4)
        } — null model collapsed`,
    );
    await m.store.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// T2 — ORDER INDEPENDENCE.
//
// The tempting stop rule ("descend while a constituent is corpus-unique, stop
// at the first one attested twice") passes T1 in exactly one training order
// and fails in the other: when the FIRST partner is poured its shared unit has
// fan-in 1, so the descent runs past it and only the second partner ever
// profiles it.  Whether two forms become siblings must not depend on which was
// taught first.
// ═══════════════════════════════════════════════════════════════════════════
test("T2: company does not depend on which partner was taught first", async () => {
  const measure = async (first, second, seed) => {
    const m = newMind(seed);
    await m.ingest([
      [first[0], first[1]],
      [second[0], second[1]],
      ["cue_zz", "Bananas are grown in humid climates"],
    ]);
    assertHaloControl(m, ["cue_en", "cue_mg", "cue_zz"]);
    return {
      related: cosine(haloOf(m, "cue_en"), haloOf(m, "cue_mg")),
      control: cosine(haloOf(m, "cue_en"), haloOf(m, "cue_zz")),
    };
  };
  const EN = ["cue_en", "The Eiffel Tower is in Paris"];
  const MG = ["cue_mg", "Tour Eiffel dia any Paris"];

  for (const seed of SEEDS) {
    const forward = await measure(EN, MG, seed);
    const reverse = await measure(MG, EN, seed);

    for (const [name, r] of [["forward", forward], ["reverse", reverse]]) {
      assert.ok(
        r.related >= BAR,
        `seed ${seed} ${name} order: shared-unit company must survive ` +
          `training order — got ${r.related.toFixed(4)}, need >= ` +
          `${BAR.toFixed(4)}`,
      );
      assert.ok(
        r.control < BAR,
        `seed ${seed} ${name} order: control must stay at chance, got ` +
          `${r.control.toFixed(4)}`,
      );
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// T3 — THE NULL MODEL SURVIVES.
//
// The failure mode opposite to T1's: a descent that superposed everything it
// walked past would put terms shared by every deposit into every profile, and
// ALL halos would correlate.  That regression passes T1 handsomely.  Here a
// population of mutually unrelated partners must stay mutually at chance —
// and, because it is the same store, T1's positive is re-checked against this
// population's own noise level rather than against a bar alone.
// ═══════════════════════════════════════════════════════════════════════════
test("T3: unrelated partners stay mutually at chance", async () => {
  const m = newMind();
  const FACTS = [
    ["c1", "Volcanoes erupt when magma reaches the surface"],
    ["c2", "The violin has four strings tuned in fifths"],
    ["c3", "Penguins are flightless birds of the southern seas"],
    ["c4", "Concrete gains strength for weeks after it is poured"],
    ["c5", "The abacus was used for arithmetic in many cultures"],
    ["c6", "Lightning heats the air it passes through"],
  ];
  await m.ingest(FACTS);
  assertHaloControl(m, FACTS.map((f) => f[0]));

  let worst = -1, worstPair = "";
  for (let i = 0; i < FACTS.length; i++) {
    for (let j = i + 1; j < FACTS.length; j++) {
      const c = cosine(haloOf(m, FACTS[i][0]), haloOf(m, FACTS[j][0]));
      if (c > worst) {
        worst = c;
        worstPair = `${FACTS[i][0]}~${FACTS[j][0]}`;
      }
    }
  }
  assert.ok(
    worst < BAR,
    `unrelated partners must not keep company: worst pair ${worstPair} at ` +
      `${worst.toFixed(4)}, need < ${BAR.toFixed(4)}.  A profile that ` +
      `superposes scaffolding makes every halo correlate.`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// T4 — ONE EPISODE POURS ONE UNIT OF MASS.
//
// The profile is normalized precisely so that enriching it cannot inflate the
// evidence it represents: `haloMass` counts EPISODES, and every mass-based
// reading in the system (recall's corroboration counts, the disambiguation
// tiers) depends on that staying true.  A profile that forgot to normalize
// would pass T1 and T3 and silently re-weight the whole distributional layer.
// ═══════════════════════════════════════════════════════════════════════════
test("T4: enriching the profile does not inflate halo mass", async () => {
  const m = newMind();
  await m.ingest([
    // A partner with MANY constituents, and one with very few — if mass
    // tracked constituent count instead of episodes, these would differ.
    ["rich", "The quick brown fox jumps over the lazy dog beside the river"],
    ["lean", "Ice melts"],
  ]);
  assertHaloControl(m, ["rich", "lean"]);

  const massRich = m.store.haloMass(idOf(m, "rich"));
  const massLean = m.store.haloMass(idOf(m, "lean"));
  assert.equal(
    massRich,
    massLean,
    `halo mass must count episodes, not constituents: a 59-byte partner ` +
      `poured ${massRich} against a 9-byte partner's ${massLean}`,
  );
  assert.equal(massRich, 1, `one episode must pour exactly one unit of mass`);
});

// ═══════════════════════════════════════════════════════════════════════════
// T5 — THE PROFILE IS A FUNCTION OF THE STORE, NOT OF THE DEPOSIT.
//
// The constituents must be read from the STORE.  Read instead from the
// depositing tree's id map — which holds only the nodes THIS deposit newly
// interned — and a partner met a SECOND time profiles differently from the
// first, because its subtrees are already stored and therefore absent from the
// map.  The exact-partner case then falls from cosine 1 to 1/sqrt(1+k) and the
// geometry stops meaning anything.  Two cues sharing the SAME partner are the
// direct probe: their halos must be identical, whatever else changed between
// the two deposits.
// ═══════════════════════════════════════════════════════════════════════════
test("T5: the same partner profiles identically on every episode", async () => {
  const m = newMind();
  const PARTNER = "Paris is the capital city of France";
  await m.ingest([
    ["first", PARTNER],
    // An unrelated deposit in between, so the second pour happens against a
    // store that has grown and a tree whose subtrees are all already interned.
    ["filler", "Sandstone forms from compressed grains"],
    ["second", PARTNER],
  ]);
  assertHaloControl(m, ["first", "second"]);

  const same = cosine(haloOf(m, "first"), haloOf(m, "second"));
  assert.ok(
    same > 1 - 1e-6,
    `two cues sharing one partner must have identical halos: got ` +
      `${same.toFixed(6)}.  The profile is being read from the deposit's id ` +
      `map rather than from the store.`,
  );
  // Falsifiability: identical halos must not be an artefact of ALL halos in
  // this store being identical.
  const different = cosine(haloOf(m, "first"), haloOf(m, "filler"));
  assert.ok(
    different < conceptThreshold(D),
    `control: a different partner must not yield the same halo, got ` +
      `${different.toFixed(4)}`,
  );
});
