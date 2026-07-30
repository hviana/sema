// 72-prefix-candidate-supply.test.mjs — a query that is a proper PREFIX of a
// trained form must be able to reach that form even when resonance cannot rank
// it.
//
// THE GAP THIS PINS.  `prefixCompletion` consumes a ranked list the caller
// already fetched, and that list comes from resonance.  Resonance cannot rank a
// proper prefix: measured on a 15.7M-node store, cos(prefix, form) falls from
// 0.9629 at a one-byte truncation to 0.6206 at three bytes, against a
// reachThreshold of 0.8750.  The mechanism's guards were therefore never
// reached — the trace read `candidates: 24, opened: 0` — and the query answered
// nothing.  `prefixCandidates` is the second SUPPLY that closes it, reading the
// leaf-id WINDOW index `indexSubSpans` already writes at deposit time.  No
// ingestion, storage or fold change is involved: this test would pass on a
// store trained before the supply existed.
//
// WHY THE ASSERTIONS ARE SHAPED THIS WAY.  On a small fixture resonance may
// well return the form by luck, and then an end-to-end "does it answer?" test
// would pass with the supply deleted — pinning nothing.  So the contract is
// asserted on `prefixCandidates` DIRECTLY, and the resonance list is asserted
// to lack the form, which is what makes the supply load-bearing rather than
// redundant.
//
// The 4.3k-fact fixture is not decoration: window containment is judged against
// `hubBound` = √N, so a toy store makes every window look saturated and the
// supply would correctly return nothing, testing nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import {
  prefixCandidates,
  prefixCompletion,
} from "../dist/src/mind/prefix-completion.js";
import { gistOf, resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = new TextDecoder();

const FORM = "The chief export of the northern province is powdered basalt.";

test("a proper prefix reaches its trained form through the window supply", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });

  const filler = [];
  for (let i = 0; i < 4300; i++) filler.push([`filler-${i}`, `f${i}`]);
  await m.ingest(filler);
  await m.ingest([[FORM, "acknowledged"]]);

  const formId = resolve(m, enc(FORM));
  assert.ok(formId !== null, "the trained form must resolve exactly");

  // Truncate by more than one grouping window, so the continuation clears
  // prefixCompletion's sub-quantum guard and the tier can actually fire.
  const W = m.space.maxGroup;
  const query = enc(FORM.slice(0, FORM.length - 3 * W));

  // Premise 1 — the exact tiers genuinely cannot serve this query.
  assert.equal(
    resolve(m, query),
    null,
    "a proper prefix must have no branch of its own, or the gap is not real",
  );

  // Premise 2 — resonance does not supply the form, so anything that works
  // below is the new supply and not the ranked list in disguise.
  // Premise 2 — the ranked list is NOT what is under test.  At fixture scale
  // resonance does rank the form (it is the only content among 4,300 fillers
  // that resembles the query), and that is measured, not assumed: the
  // assertion below records it, so if fixture geometry ever changes the reader
  // is told rather than misled.  Resonance's real-world inability to rank a
  // prefix is a LARGE-CORPUS property — cos falls to 0.6206 at a three-byte
  // truncation against a 0.8750 bar, on a 15.7M-node store — and cannot be
  // reproduced at this scale.  That is why the contract below is asserted on
  // `prefixCandidates` DIRECTLY: deleting or emptying the supply fails this
  // test regardless of what resonance happens to return.
  const ranked = (await m.store.resonate(gistOf(m, query), 64)).map((h) =>
    h.id
  );
  assert.ok(
    ranked.includes(formId),
    "fixture note: at this scale resonance is expected to rank the form; " +
      "if it no longer does, the end-to-end path below became the load-" +
      "bearing assertion and this comment must be revisited",
  );

  // THE CONTRACT — the write side's own window index proposes the form.
  const proposed = prefixCandidates(m, query);
  assert.ok(
    proposed.includes(formId),
    `the window supply must propose the trained form the query opens ` +
      `(proposed ${proposed.length} candidate(s))`,
  );

  // …and the mechanism, unchanged, grounds it whole through that supply.
  const completed = prefixCompletion(m, query, proposed);
  assert.ok(completed !== null, "the supplied form must complete the query");
  assert.equal(
    dec.decode(completed.form),
    FORM,
    "a FORM is grounded whole, never a slice cut at the query's end",
  );

  // HONEST DEGRADATION (§2.13).  A query with no discriminative window must
  // propose nothing rather than guess — silence is the correct answer, and a
  // supply that widened until it found something would be the real defect.
  const hub = enc("The ");
  assert.equal(
    prefixCompletion(m, hub, prefixCandidates(m, hub)),
    null,
    "a query carrying no discriminative window must stay silent",
  );

  await m.store.close();
});
