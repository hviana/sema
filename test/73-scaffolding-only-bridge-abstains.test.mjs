// 73-scaffolding-only-bridge-abstains.test.mjs — the substitution bridge must
// ABSTAIN when every literal span it did not substitute is corpus-global
// scaffolding.
//
// THE DEFECT THIS PINS.  A bridge grounds through the literal spans it did NOT
// substitute; those anchors are the whole of its evidence.  The anchor scan
// ranked them by containment but rejected only the ones with ZERO containers,
// so a query made entirely of scaffolding still bridged — the single
// substituted span carried the whole semantic load, and the answer was voiced
// with confidence.  Measured on the trained store (hubBound 571): "What is the
// capital of" has 19 anchors, ALL saturated ("What":572, "hat ":572, "at i":572
// …), and answered with an unrelated trained context about an integral.  That
// breaks honest silence (§2.13), which is worse than a gap: a gap is visible, a
// fabrication is not.
//
// WHY THIS IS NOT A PROBE-SHAPED PATCH.  The gate was falsified against the
// queries the bridge answers CORRECTLY before it was written, and every one of
// them has an unsaturated anchor with no near miss: "Who is the author of
// Hamlet?" → "let?":12, "How do you say 'thank you' in French?" → "y 't":3,
// "…largest planet…" → "tem?":31, "What is the capital of France?" →
// "f Fr":114.  The honest-silence probes sit on the same side as the correct
// ones ("Zamu":3), so this gate is not what makes them silent and cannot be
// credited for them.  The separation is categorical, not marginal.
//
// WHY A TEST DOUBLE AND NOT A CORPUS.  Saturation is a LARGE-CORPUS
// phenomenon and cannot be manufactured at fixture scale — this was measured,
// not assumed, across three fixture designs:
//   • one repeated template  → content addressing dedups the identical chunks,
//     so its windows have 1–5 containers, not thousands;
//   • template with varied surroundings → the leading windows saturate (67 at
//     bound 66) but interior ones stay at 1, because "is the " is always the
//     same deduped chunk whatever surrounds it;
//   • randomised small vocabulary → most windows saturate, but cross-boundary
//     windows ("fa b":13) cannot, since they touch only the two adjacent chunk
//     types.
// Every window saturating at once needs the real store's scale AND lexical
// diversity.  So the CONDITION is supplied by a store double and the BEHAVIOUR
// under it is asserted — the honest way to pin a rule whose trigger a fixture
// cannot reach.  The double inflates containment only; it invents no node, and
// the padding is a real container id, so nothing downstream reads a fiction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { substitutionBridge } from "../dist/src/mind/bridge.js";
import { gistOf } from "../dist/src/mind/primitives.js";
import {
  allWindowsAreScaffolding,
  hubBound,
} from "../dist/src/mind/traverse.js";

const enc = (s) => new TextEncoder().encode(s);

/** Report every window as corpus-global: the real containers, padded with an
 *  id that is genuinely among them, up to past the hub bound.  Only `.length`
 *  drives the gate, and padding with a real container keeps every other reader
 *  truthful. */
function saturateContainment(mind) {
  const store = mind.store;
  const real = store.containersSlice.bind(store);
  const bound = hubBound(mind);
  store.containersSlice = (child, off, limit) => {
    const got = real(child, off, limit);
    if (got.length === 0) return got;
    const out = got.slice();
    while (out.length < Math.min(limit, bound + 1)) out.push(got[0]);
    return out;
  };
  return () => {
    store.containersSlice = real;
  };
}

test("a bridge with only scaffolding anchors stays silent", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });

  const facts = [];
  for (let i = 0; i < 600; i++) {
    facts.push([
      `case ${i}: what is the qty${i} of item${i}?`,
      `it is ${i * 2}`,
    ]);
  }
  await m.ingest(facts);

  const query = enc("case 7: what is the qty7 of item7?");
  const proposed = async () =>
    (await m.store.resonate(gistOf(m, query), 256)).map((h) => h.id);

  // CONTROL — with real containment the query HAS discriminating anchors, so
  // the gate must not apply.  Establishing this first is what makes the
  // assertion below about saturation rather than about this query being
  // unbridgeable for some unrelated reason.
  const ordinary = await substitutionBridge(m, query, proposed);

  // THE CONTRACT — the identical query, with every anchor now corpus-global.
  // Nothing corroborates a substitution, so the only honest result is none.
  const restore = saturateContainment(m);
  try {
    const bridged = await substitutionBridge(m, query, proposed);
    assert.equal(
      bridged,
      null,
      "a bridge whose every anchor is corpus-global scaffolding must abstain",
    );
  } finally {
    restore();
  }

  // …and the gate is SELECTIVE: it changed the outcome only because of
  // saturation.  If the bridge declined this query anyway, the assertion above
  // would be vacuous, and this is what says it is not.
  assert.notEqual(
    ordinary,
    null,
    "fixture invalid: the bridge declines this query even with real " +
      "containment, so the saturated assertion above pins nothing",
  );

  await m.store.close();
});

// The predicate itself, and its SECOND consumer.  The scaffolding-dominated
// tier in mechanisms/recall.ts grounds the consensus-climb anchor, and it
// fabricated for the same reason the bridge did: measured on the trained
// store, "What is the capital " answered "Colombo is the commercial capital of
// Sri Lanka…" on breadth 0.667 / clusters 1, every window a hub ("What":572).
//
// DISPERSION WAS TRIED THERE FIRST AND FALSIFIED — recorded here because the
// falsification is the reason this predicate is shared rather than local: the
// fabrication and the no-punctuation robustness probe "what is the capital of
// france" have the IDENTICAL profile (breadth 0.667, clusters 1), so requiring
// clusters >= 2 silenced the good probe too and cost the battery a probe.
// Window saturation separates them cleanly where dispersion cannot
// ("f fr":248 vs all-saturated).
test("scaffolding-only is a property of the query, not of one mechanism", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });

  const facts = [];
  for (let i = 0; i < 600; i++) {
    facts.push([
      `case ${i}: what is the qty${i} of item${i}?`,
      `it is ${i * 2}`,
    ]);
  }
  await m.ingest(facts);

  const query = enc("case 7: what is the qty7 of item7?");

  // With real containment the query HAS discriminating windows.
  assert.equal(
    allWindowsAreScaffolding(m, query),
    false,
    "a query with a discriminating window must not read as scaffolding-only",
  );

  // With every window corpus-global it does not.
  const restore = saturateContainment(m);
  try {
    assert.equal(
      allWindowsAreScaffolding(m, query),
      true,
      "a query whose every stored window is a hub must read as scaffolding-only",
    );
  } finally {
    restore();
  }

  // A query the store has never seen has no evidence EITHER WAY, and must not
  // be mistaken for scaffolding — its callers refuse it on their own terms.
  assert.equal(
    allWindowsAreScaffolding(m, enc("zzqx vvwy jjkl")),
    false,
    "a query with no stored window at all is not scaffolding-only",
  );

  await m.store.close();
});
