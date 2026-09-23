// 55-cost-meter.test.mjs — the cross-stack computational-usage meter
// (src/meter.ts).
//
// The meter's four contracts, one test each:
//   1. OFF BY DEFAULT — an unprofiled Mind never attaches one, and the store
//      is left with no meter after a response either way.
//   2. NEVER READ BY INFERENCE — profiled and unprofiled answers are
//      byte-identical, and so is the provenance.
//   3. COUNTS ARE DETERMINISTIC — the same query on the same store meters
//      identically (only the millisecond fields may differ).
//   4. THE WHOLE STACK REPORTS — store reads, perception, recognition,
//      the mechanism market and the graph search all appear.
//
// Plus the two aggregation helpers (sumReports, formatReport) and the
// multi-turn lifecycle (respondTurn meters through the SAME beginResponse /
// endResponse pair respond() uses).

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReport, Mind, sumReports } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = (opts = {}) =>
  new Mind({ seed: 1, store: new SQliteStore({ path: ":memory:" }), ...opts });

/** A small store with enough structure that every layer does some work. */
async function trained(opts) {
  const mind = mk(opts);
  await mind.ingest([
    ["the capital of France is", " Paris"],
    ["the capital of Japan is", " Tokyo"],
    ["the capital of Italy is", " Rome"],
    ["Paris is in", " Europe"],
    ["Tokyo is in", " Asia"],
  ]);
  return mind;
}

const QUERY = "the capital of France is";

test("1. profiling is off by default and leaves no meter on the store", async () => {
  const mind = await trained();
  assert.equal(mind.lastCost, null);
  await mind.respondText(QUERY);
  assert.equal(mind.lastCost, null, "no report without { profile: true }");
  assert.equal(mind.store.meter, null, "store meter never attached");
  assert.equal(mind.meter, null);
  await mind.store.close();
});

test("2. profiling never changes the answer", async () => {
  const plain = await trained();
  const profiled = await trained({ profile: true });

  for (const q of [QUERY, "Paris is in", "the capital of Japan is", "zzz"]) {
    const a = await plain.respond(q);
    const b = await profiled.respond(q);
    assert.deepEqual(
      Array.from(b.bytes),
      Array.from(a.bytes),
      `answer changed under profiling for "${q}"`,
    );
    assert.equal(b.provenance, a.provenance);
  }
  await plain.store.close();
  await profiled.store.close();
});

test("3. the meter is detached and the report published after each response", async () => {
  const mind = await trained({ profile: true });
  await mind.respondText(QUERY);

  assert.equal(mind.meter, null, "meter torn down with the response");
  assert.equal(mind.store.meter, null, "store detached — no cross-charging");

  const r = mind.lastCost;
  assert.ok(r, "a report was published");
  assert.equal(r.version, 1);
  assert.equal(r.queryBytes, QUERY.length);
  assert.ok(r.elapsedMs >= 0);
  await mind.store.close();
});

test("4. counters are deterministic across identical calls on identical stores", async () => {
  const a = await trained({ profile: true });
  const b = await trained({ profile: true });
  await a.respondText(QUERY);
  await b.respondText(QUERY);
  assert.deepEqual(
    a.lastCost.counters,
    b.lastCost.counters,
    "same query + same store ⇒ same work; a diff here is a real regression",
  );
  // Phase CALL counts are deterministic too (their millisecond totals are not).
  const calls = (r) =>
    Object.fromEntries(
      Object.entries(r.phases).map(([k, v]) => [k, v.calls]),
    );
  assert.deepEqual(calls(a.lastCost), calls(b.lastCost));
  await a.store.close();
  await b.store.close();
});

test("5. every layer of the stack reports", async () => {
  const mind = await trained({ profile: true });
  await mind.respondText(QUERY);
  const c = mind.lastCost.counters;

  // Store layer — identity, content, structure.
  assert.ok(c.leafLookups > 0, "content-addressed leaf lookups counted");
  assert.ok(c.branchLookups > 0, "content-addressed branch lookups counted");
  assert.ok(c.byteReads > 0, "node byte reads counted");
  assert.ok(c.bytesRead > 0, "read VOLUME counted, not just call count");

  // Mind layer — perception and recognition.
  assert.ok(c.perceptions > 0, "perceptions counted");
  assert.ok(c.perceivedBytes >= c.perceptions, "perceived volume counted");
  assert.ok(c.recognitions > 0, "recognitions counted");
  assert.ok(c.resolves > 0, "identity resolutions counted");

  // The mechanism market — every mechanism was offered the query.
  assert.ok(
    c.mechanismFloors + c.mechanismSkips >= 5,
    "each built-in mechanism's floor() was accounted",
  );
  assert.ok(c.mechanismRuns > 0, "at least one mechanism ran");
  assert.ok(c.candidates > 0, "candidates weighed");

  // Phases are per-mechanism and named after the mechanism itself.
  const phases = Object.keys(mind.lastCost.phases);
  assert.ok(phases.includes("think"));
  assert.ok(phases.includes("articulate"));
  assert.ok(
    phases.some((p) => p.endsWith(".floor")),
    "per-mechanism floor phases present",
  );
  await mind.store.close();
});

test("6. zero-valued counters are omitted, and no bookkeeping leaks in", async () => {
  const mind = await trained({ profile: true });
  await mind.respondText(QUERY);
  const c = mind.lastCost.counters;
  for (const [k, v] of Object.entries(c)) {
    assert.notEqual(v, 0, `${k} is zero and should have been dropped`);
    assert.ok(!k.startsWith("_"), `${k} is meter bookkeeping, not work`);
  }
  await mind.store.close();
});

test("7. a bigger query costs more than a smaller one", async () => {
  const mind = await trained({ profile: true });
  await mind.respondText("Paris");
  const small = mind.lastCost.counters;
  await mind.respondText(
    "the capital of France is and the capital of Japan is and Paris is in",
  );
  const big = mind.lastCost.counters;
  assert.ok(
    big.perceivedBytes > small.perceivedBytes,
    "perception cost tracks query length",
  );
  await mind.store.close();
});

test("8. respondTurn meters through the same lifecycle", async () => {
  const mind = await trained({ profile: true });
  const conv = mind.beginConversation();
  await mind.respondTurnText(conv, "the capital of France is");
  const first = mind.lastCost;
  assert.ok(first, "a turn publishes a report");
  assert.ok(first.counters.perceptions > 0);
  assert.equal(mind.store.meter, null, "detached after the turn too");

  await mind.respondTurnText(conv, "Paris is in");
  const second = mind.lastCost;
  assert.notEqual(second, null);
  assert.ok(
    second.queryBytes > first.queryBytes,
    "a turn is metered against the ACCUMULATED context, which grows",
  );
  mind.endConversation(conv);
  await mind.store.close();
});

test("9. conversation memos survive the shared lifecycle (turn 2 re-uses turn 1)", async () => {
  const mind = await trained({ profile: true });
  const conv = mind.beginConversation();
  await mind.respondTurnText(conv, "the capital of France is");
  await mind.respondTurnText(conv, "the capital of Japan is");
  const c = mind.lastCost.counters;
  // The conversation's perceive/recognise memos are swapped in by
  // beginResponse; the second turn must therefore HIT them for the prefix it
  // shares with the first.  A zero here means respondTurn stopped carrying
  // the conversation's persistent state — the exact drift the shared
  // lifecycle exists to prevent.
  assert.ok(
    (c.perceiveHits ?? 0) > 0 || (c.recogniseHits ?? 0) > 0,
    "the prefix's earlier results were re-used across turns",
  );
  mind.endConversation(conv);
  await mind.store.close();
});

test("9b. every phase reports the work done inside it, and phases nest", async () => {
  const mind = await trained({ profile: true });
  await mind.respondText(QUERY);
  const { phases, counters } = mind.lastCost;

  // Each phase carries counter deltas, not just a duration.
  const withWork = Object.entries(phases).filter(([, p]) =>
    Object.keys(p.counters).length > 0
  );
  assert.ok(withWork.length > 0, "phases attribute work, not only time");

  // `think` is the outermost inference phase, so its counters must DOMINATE
  // every phase nested inside it — that is what "inclusive" means, and it is
  // the property that makes the deltas readable as attribution.
  const think = phases["think"];
  assert.ok(think, "think is a phase");
  for (const [name, p] of Object.entries(phases)) {
    if (name === "think" || name === "articulate") continue;
    for (const [k, v] of Object.entries(p.counters)) {
      assert.ok(
        (think.counters[k] ?? 0) >= v,
        `${name}.${k}=${v} exceeds think.${k}=${think.counters[k] ?? 0} — ` +
          `phases must nest`,
      );
    }
  }
  // And no phase may claim more of a counter than the whole response spent.
  for (const [name, p] of Object.entries(phases)) {
    for (const [k, v] of Object.entries(p.counters)) {
      assert.ok(
        (counters[k] ?? 0) >= v,
        `${name}.${k}=${v} exceeds the response total ${counters[k] ?? 0}`,
      );
    }
  }
  await mind.store.close();
});

test("9c. a recursive read is one read, not one per node descended", async () => {
  const mind = await trained({ profile: true });
  await mind.respondText(QUERY);
  const c = mind.lastCost.counters;
  // bytesRead is the byte VOLUME, byteReads the number of read REQUESTS.
  // Reconstructing a branch used to charge one read per node descended, which
  // made byteReads track tree size — it read as ~1 byte per read.  Real reads
  // return whole forms, so the volume must comfortably exceed the count.
  assert.ok(c.byteReads > 0 && c.bytesRead > 0);
  assert.ok(
    c.bytesRead > c.byteReads,
    `bytesRead ${c.bytesRead} should exceed byteReads ${c.byteReads} — ` +
      `a per-node charge would invert this`,
  );
  await mind.store.close();
});

test("10. sumReports and formatReport aggregate a battery", async () => {
  const mind = await trained({ profile: true });
  const reports = [];
  for (const q of [QUERY, "Paris is in", "the capital of Italy is"]) {
    await mind.respondText(q);
    reports.push(mind.lastCost);
  }
  const total = sumReports(reports);
  assert.equal(total.version, 1);
  assert.equal(
    total.queryBytes,
    reports.reduce((s, r) => s + r.queryBytes, 0),
  );
  for (const key of Object.keys(reports[0].counters)) {
    assert.equal(
      total.counters[key],
      reports.reduce((s, r) => s + (r.counters[key] ?? 0), 0),
      `${key} did not sum`,
    );
  }
  const text = formatReport(total);
  assert.match(text, /^cost: /);
  assert.match(text, /perceptions/);
  await mind.store.close();
});

test("10. the recompose descent is counted, and its zero is omitted", async () => {
  // `recompleteNode` decomposes a completion by ITS OWN kids, and that descent
  // was invisible: a caller could read the chain's result but not whether the
  // recomposition ran, so "the recursion stopped" and "it never ran" looked the
  // same from the counters alone.
  //
  // Measured on this fixture: the simple queries deepen (recompletes = 1) while
  // "eva director country" is answered by the JOIN and never descends — the same
  // store, one counter, both directions.
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  const F1 = "The director of Eva is Gustaf Molander.";
  const F2 = "The country of Gustaf Molander is Sweden.";
  await mind.ingest([
    ["eva", F1],
    ["eva director", F1],
    ["gustaf molander", F2],
    ["gustaf molander country", F2],
  ]);

  await mind.respondText("eva director");
  const descended = mind.lastCost.counters.recompletes ?? 0;

  await mind.respondText("eva director country");
  const joined = mind.lastCost.counters;

  await store.close();

  assert.ok(
    descended >= 1,
    `the recompose descent must be counted (got ${descended}) — without it the ` +
      `recursion is unobservable`,
  );
  assert.ok(
    (joined.joinFired ?? 0) >= 1,
    `the control query must be the join's, not the descent's (joinFired=${joined.joinFired})`,
  );
  assert.equal(
    joined.recompletes,
    undefined,
    "a response that never descends must omit the counter (test 6's convention)",
  );
});

test("11. the pivot's probe cap is visible: what it spent, and what it withheld", async () => {
  // The cap itself is deliberate — probing every branch of a long answer made
  // the pivot sweep the dominant ANN cost at corpus scale — but what it spent
  // and what it withheld were both invisible.  Untraced on purpose (meter.ts
  // contract 1), so seeing them cannot perturb the search.
  //
  // The withheld count is a CAPACITY fact, never a verdict: the sweep is
  // breadth-first (largest regions first) and recognition still contributes
  // every exact containment candidate, so the answer below is asserted to be
  // the same either way — if a future change makes the cap actually lose
  // reach, this pair of assertions forces it to be reported as a loss.
  const LONG =
    "the capital of France is Paris and Paris is a city on the river Seine in " +
    "the north of the country and the river runs through the heart of the city " +
    "past the tower and the museums and the wide avenues of the old quarters";
  const run = async (probeK) => {
    const store = new SQliteStore({ path: ":memory:" });
    const mind = new Mind({
      seed: 7,
      store,
      profile: true,
      // The pivot's budget is ITS OWN since F4: `recallQueryK` no longer widens
      // it, which is exactly what this test now pins.
      pivotProbeK: probeK,
    });
    await mind.ingest([
      ["what is the capital of France", LONG],
      ["Paris", "Paris is famous for the Eiffel Tower"],
      ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
    ]);
    const answer = String(
      await mind.respondText("what is the capital of France famous for"),
    ).trim();
    const c = mind.lastCost.counters;
    await store.close();
    return {
      answer,
      probes: c.pivotProbes ?? 0,
      // RAW on purpose: the "withholds nothing" case must be able to observe
      // the field's ABSENCE (test 6's convention drops zeros), so coercing here
      // would make the assertion below unable to fail.
      withheld: c.pivotBranchesUnprobed,
      pivots: c.pivotSteps ?? 0,
    };
  };

  const wide = await run(64);
  const tight = await run(12); // the default pivot budget

  assert.ok(tight.probes > 0, "the sweep really ran");
  assert.ok(
    tight.withheld >= 1,
    `the capacity the cap withheld must be counted (got ${tight.withheld})`,
  );
  assert.equal(
    wide.withheld,
    undefined,
    "an allowance that probes every branch withholds nothing (zeros are dropped)",
  );
  assert.equal(tight.pivots, wide.pivots, "both runs took the same hop");
  assert.equal(
    tight.answer,
    wide.answer,
    "the cap withheld capacity, not the answer",
  );
});

test("12. the extension's cost obeys the ladder's own inequality", async () => {
  // The extension (reason()) is bounded by the material gate but was never
  // PRICED.  It now reports both facts — steps taken, and the bytes of
  // uncovered material it was justified by — so the inequality the ladder
  // would apply is checkable:
  //
  //     steps · STEP  <  PASS · carried
  //
  // The gate accepts whenever a step carries a W-window, so the two agree for
  // every extension with `steps ≤ (PASS/STEP) · carried`.  This pins that
  // inequality on a fixture where the extension really runs (the anti-vacuity
  // guard below), and derives both constants from the ladder instead of
  // spelling them out.
  const { PASS, STEP } = await import("../dist/src/mind/graph-search.js");
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
  ]);
  await mind.respondText("What is the capital of France famous for");
  const c = mind.lastCost.counters;
  await store.close();

  const steps = c.reasonSteps ?? 0;
  const carried = c.reasonCarriedBytes ?? 0;
  assert.ok(
    steps >= 1,
    `the extension must run for this to mean anything (got ${steps})`,
  );
  assert.ok(
    carried >= 1,
    `and it must be justified by real material (got ${carried})`,
  );
  assert.ok(
    steps * STEP < PASS * carried,
    `the extension spent ${steps} step(s) on ${carried} carried byte(s) — the ` +
      `ladder would refuse that (STEP·${steps} vs PASS·${carried})`,
  );
});

test("13. the fusion is counted when it FUSES, and claimed only then", async () => {
  // `fuseAttention` is ENTERED whenever the query has a remainder ≥ W and
  // returns `primary` untouched when there is nothing to bridge (`pieces.length
  // === 1`).  Entering and fusing are different facts — the rationale's own
  // `enter` step fires on every call, so before `fuseRuns` the untraced view
  // could not tell them apart — and the pipeline's outer note claimed the fusion
  // REGARDLESS, measured false on 4 of the 5 queries below.
  const CORPUS = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    [
      "The tallest tower in Paris",
      "The tallest tower in Paris is the Eiffel Tower",
    ],
  ];
  const run = async (q) => {
    const store = new SQliteStore({ path: ":memory:" });
    const mind = new Mind({ seed: 7, store, profile: true });
    await mind.ingest(CORPUS);
    const steps = [];
    await mind.respondText(q, (s) => steps.push(s));
    const c = mind.lastCost.counters;
    await store.close();
    const pipelineSteps = steps.filter((s) =>
      String(s.note ?? "").includes("reasoned forward")
    );
    return {
      fused: c.fuseRuns,
      claims:
        pipelineSteps.filter((s) =>
          String(s.note ?? "").includes("fused across")
        ).length,
    };
  };

  // The one query that really fuses (measured: four entries, one fusion).
  const fusing = await run("2+2 and the Eiffel Tower");
  assert.ok(
    (fusing.fused ?? 0) >= 1,
    `a query that fuses must be counted (fuseRuns=${fusing.fused})`,
  );

  // The one that enters and bails — the anti-vacuity pair.
  const bailing = await run("What is the capital of France famous for");
  assert.equal(
    bailing.fused,
    undefined,
    "a call that fused nothing must not be counted (zeros are dropped)",
  );
  assert.equal(
    bailing.claims,
    0,
    "and no step may CLAIM a fusion that did not happen",
  );
});

test("14. the climb publishes the peak that recall's gate reads", async () => {
  // `Attention.peak` (types.ts) is the LARGEST single-region contribution behind
  // an anchor, and mechanisms/recall.ts gates on it (`forest[0].peak > LN2`).
  // The climb computed it, carried it into `ranked`, and the rationale showed
  // everything EXCEPT it — the one decision-making quantity that was invisible.
  //
  // FAIL BEFORE: `anchor.peak` did not exist.  The assertions below are a real
  // relation, not a magic number: one contribution cannot exceed the sum of
  // contributions, so `peak <= pooledVote`, and at least one anchor must have
  // peak > 0 or the fixture never reached the quantity at all.
  const CORPUS = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    [
      "The tallest tower in Paris",
      "The tallest tower in Paris is the Eiffel Tower",
    ],
  ];
  const findAnchors = (o, depth = 0) => {
    if (o === null || typeof o !== "object" || depth > 5) return null;
    if (Array.isArray(o.anchors) && o.anchors.length) return o;
    for (const v of Object.values(o)) {
      const r = findAnchors(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(CORPUS);
  const steps = [];
  await mind.respondText(
    "capital of France and the tallest tower in Paris",
    (s) => steps.push(s),
  );
  await store.close();
  const step = steps.find((s) => findAnchors(s.data ?? s) !== null);
  const td = step ? findAnchors(step.data ?? step) : null;
  assert.ok(td, "the climb must report its anchors");
  assert.ok(
    td.anchors.every((a) => typeof a.peak === "number"),
    "every anchor must publish its peak",
  );
  assert.ok(
    td.anchors.some((a) => a.peak > 0),
    `at least one anchor must have a real peak (got ${
      JSON.stringify(td.anchors.map((a) => a.peak))
    })`,
  );
  assert.ok(
    td.anchors.every((a) => a.peak <= a.pooledVote),
    "one contribution cannot exceed the sum of contributions",
  );
});

test("15. the live record tells the two refusal gates apart", async () => {
  // Item 2 of the open list: `below-natural-break` and `below-consensus-floor`
  // always travelled TOGETHER in the fixtures measured before, so the margin
  // proved the bar was tight but not that it was the cause.  Measured over 53
  // anchors on 12 queries, they DO separate: 9 anchors have the bar refusing
  // what the natural break would accept, and none the other way round — but in
  // every case both `passes*` flags were false, so the reasons alone could not
  // show WHICH gate refused.
  //
  // This pins the one gate that refused, from the live commit record
  // (`recordAnchor`, spec §8: decisions recorded as the gates apply them, never
  // reconstructed).  It asserts a PROPERTY, not an anchor id: at least one
  // anchor must be rejected with the floor failing and the break PASSING —
  // otherwise the fixture never reached the divergence it is here to pin.
  const CORPUS = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    [
      "The tallest tower in Paris",
      "The tallest tower in Paris is the Eiffel Tower",
    ],
    ["Gustaf Molander", "Gustaf Molander was a Swedish film director"],
    ["Stockholm", "Stockholm is the capital of Sweden"],
  ];
  const findAnchors = (o, depth = 0) => {
    if (o === null || typeof o !== "object" || depth > 5) return null;
    if (Array.isArray(o.anchors) && o.anchors.length) return o;
    for (const v of Object.values(o)) {
      const r = findAnchors(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(CORPUS);
  const steps = [];
  await mind.respondText(
    "Gustaf Molander and the tallest tower in Paris and 2+2",
    (s) => steps.push(s),
  );
  await store.close();
  const step = steps.find((s) => findAnchors(s.data ?? s) !== null);
  const td = step ? findAnchors(step.data ?? step) : null;
  assert.ok(td, "the climb must report its anchors");

  const barRefusedOnly = td.anchors.filter((a) =>
    (a.commit ?? {}).passesConsensusFloor === false &&
    (a.commit ?? {}).passesNaturalBreak === true
  );
  assert.ok(
    barRefusedOnly.length >= 1,
    `the fixture must contain a floor-only refusal (got ${
      JSON.stringify(
        td.anchors.map((
          a,
        ) => [
          a.anchor,
          a.commit?.passesNaturalBreak,
          a.commit?.passesConsensusFloor,
        ]),
      )
    })`,
  );
  for (const a of barRefusedOnly) {
    assert.equal((a.commit ?? {}).status, "rejected");
    assert.ok(
      (a.commit ?? {}).rejectionReasons.includes("below-consensus-floor"),
      "the reason must name the floor",
    );
    assert.ok(
      !(a.commit ?? {}).rejectionReasons.includes("below-natural-break"),
      "and must NOT name a gate that passed",
    );
  }
});

test("16. the climb's own search is timed", async () => {
  // Item 3 of the open list: the climb's phases were timed
  // (`climb.voteRegions`, `climb.structuralResonance`, `climb.crossRegion`) but
  // the pooled derivation itself was NOT — `lightestDerivation(system)` ran
  // outside any phase, so any cost or gain inside it was invisible.  It is now
  // wrapped in `meter.timeSync` (the synchronous seam: the graph search is
  // synchronous, and wrapping it in a promise just to measure it would make the
  // profiled path await where the unprofiled one does not).
  //
  // MEASURED: climb.derivation = 0.1-0.2 ms, i.e. ~0.2% of a ~85 ms response —
  // the climb's cost is in voteRegions (5.8 ms), not in the search.  The
  // wall-clock min over 5 runs moved 43.1 → 43.0, 84.8 → 84.6, 27.7 → 27.8 ms:
  // the two-snapshot overhead is not measurable.
  //
  // FAIL BEFORE: `climb.derivation` did not exist.  The sibling assertion is the
  // anti-vacuity guard — without it this would pass on a fixture that never
  // climbed at all.
  const CORPUS = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    [
      "The tallest tower in Paris",
      "The tallest tower in Paris is the Eiffel Tower",
    ],
  ];
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(CORPUS);
  await mind.respondText("capital of France and the tallest tower in Paris");
  const phases = mind.lastCost.phases;
  await store.close();

  const sibling = phases["climb.voteRegions"];
  assert.ok(
    sibling && sibling.calls >= 1,
    `the fixture must reach the climb (phases: ${
      Object.keys(phases).join(", ")
    })`,
  );
  const search = phases["climb.derivation"];
  assert.ok(search, "the climb's own search must be a timed phase");
  assert.equal(search.calls, 1);
  assert.ok(
    typeof search.ms === "number" && search.ms >= 0,
    `and it must carry a real duration (got ${search.ms})`,
  );
});

test("17. the bar and the climb's vote are in one dimension", async () => {
  // `consensusFloor(N) = ln(N) + 1/2` is the POOLED-vote significance floor
  // (thresholds.md §2: "each region contributes at most ln(N/c) <= ln(N)"), and
  // attention.ts builds the vote on the same scale.  The comparison in recall and
  // in cast holds because the climb WEIGHTS BY IDF: `wf` is `direct ? df :
  // combined ? idf + df : idf`, and the engine only runs the last one (DFMode's
  // default "inverse", the mode every non-test caller uses).  There, `wf === idf`,
  // so the pooled vote IS the per-place reading the bar prices.
  //
  // FAIL BEFORE: nothing pinned this.  Changing the default mode, or `wf`'s
  // formula, would silently move `vote >= consensusFloor` out of the floor's
  // dimension — and `direct`/`combined` are real reads (test/24 pins that their
  // votes differ), not dead code.
  const CORPUS = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    [
      "The tallest tower in Paris",
      "The tallest tower in Paris is the Eiffel Tower",
    ],
  ];
  const findAnchors = (o, depth = 0) => {
    if (o === null || typeof o !== "object" || depth > 5) return null;
    if (Array.isArray(o.anchors) && o.anchors.length) return o;
    for (const v of Object.values(o)) {
      const r = findAnchors(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(CORPUS);
  const steps = [];
  await mind.respondText(
    "capital of France and the tallest tower in Paris",
    (s) => steps.push(s),
  );
  await store.close();
  const step = steps.find((s) => findAnchors(s.data ?? s) !== null);
  const td = step ? findAnchors(step.data ?? step) : null;
  assert.ok(td, "the climb must report its anchors");
  assert.equal(
    td.config.mode,
    "inverse",
    "the engine's mode is the IDF-weighted one",
  );

  // Anti-vacuity: at least one anchor must actually stand on contributions.
  const real = td.anchors.filter((a) => (a.contributingVotes ?? 0) >= 1);
  assert.ok(real.length >= 1, "the fixture must reach an anchor with evidence");

  for (const a of real) {
    assert.equal(
      a.pooledVote,
      a.idfVote,
      `the pooled vote and the per-place reading must coincide under the ` +
        `engine's mode (anchor ${a.anchor}: pooled=${a.pooledVote} idf=${a.idfVote})`,
    );
  }
});

test("18. the remainder the pipeline decides on is visible", async () => {
  // The remainder that licenses an extension or a fusion was computed at the
  // decision point and never published: the reasoner's own counters say what it
  // CARRIED, not what the grounding LEFT.  Two write-only counters close that,
  // and they are the instrument the structural question about the climb needs —
  // "does an elected anchor's span fall inside what the cover left open?".
  //
  // FAIL BEFORE: the counters did not exist.
  const CORPUS = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
  ];
  const run = async (q) => {
    const store = new SQliteStore({ path: ":memory:" });
    const mind = new Mind({ seed: 7, store, profile: true });
    await mind.ingest(CORPUS);
    await mind.respondText(q);
    const c = mind.lastCost.counters;
    await store.close();
    return {
      spans: c.postGroundingRemainderSpans,
      bytes: c.postGroundingRemainderBytes,
      steps: c.reasonSteps,
    };
  };

  // The pivoting query: the reasoner runs, so the remainder is non-empty
  // (measured: reasonSteps 1, reasonCarriedBytes 11).
  const pivot = await run("What is the capital of France famous for");
  assert.ok(
    (pivot.steps ?? 0) >= 1,
    `the fixture must reach the post-grounding stage (reasonSteps=${pivot.steps})`,
  );
  assert.ok(
    (pivot.spans ?? 0) >= 1,
    `a licence to extend needs a remainder (spans=${pivot.spans})`,
  );
  assert.ok(
    (pivot.bytes ?? 0) >= 1,
    `and it is measured in bytes (bytes=${pivot.bytes})`,
  );

  // The directly-answered query: no remainder, so the zero convention drops both.
  const direct = await run("What is the capital of France");
  assert.equal(direct.spans, undefined);
  assert.equal(direct.bytes, undefined);
});

test("19. the floor is read on the pooled vote, not on one region", async () => {
  // thresholds.md §2 derives `consensusFloor` as the POOLED-vote floor (one
  // maximally-specific region contributes at most ln N, and ln(N)+1/2 demands
  // corroboration BEYOND one region).  The engine reads it that way in three
  // places (`commitVotes`, `recall`, `cast`), and this pins the practice with
  // the measurement that decided it: across 27 anchors on 6 queries, all 11
  // admissions cleared the floor by the SUM and NONE by `peak` alone.
  //
  // FAIL BEFORE: `types.ts` prescribed the opposite ("must read `peak`, not
  // `vote`"), and nothing pinned what the engine actually does.  A gate reading
  // `peak` would refuse every root the engine elects.
  const CORPUS = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    [
      "The tallest tower in Paris",
      "The tallest tower in Paris is the Eiffel Tower",
    ],
  ];
  const findAnchors = (o, depth = 0) => {
    if (o === null || typeof o !== "object" || depth > 5) return null;
    if (Array.isArray(o.anchors) && o.anchors.length) return o;
    for (const v of Object.values(o)) {
      const r = findAnchors(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(CORPUS);
  const steps = [];
  await mind.respondText(
    "capital of France and the tallest tower in Paris",
    (s) => steps.push(s),
  );
  await store.close();
  const step = steps.find((s) => findAnchors(s.data ?? s) !== null);
  const td = step ? findAnchors(step.data ?? step) : null;
  assert.ok(td, "the climb must report its anchors");
  const floor = td.config.consensusFloor;

  const roots = td.anchors.filter((a) => (a.commit ?? {}).status === "root");
  assert.ok(roots.length >= 1, "the fixture must elect at least one root");
  for (const a of roots) {
    assert.ok(
      a.pooledVote >= floor,
      `a root must clear the floor by the pooled vote (${a.pooledVote} vs ${floor})`,
    );
  }
  const bySumOnly = roots.filter((a) => a.peak < floor);
  assert.ok(
    bySumOnly.length >= 1,
    `this fixture must contain a root that only the SUM admits (peaks: ${
      JSON.stringify(roots.map((a) => a.peak))
    } vs floor ${floor})`,
  );
});

test("20. the non-IDF weighting modes never flip a gate verdict", async () => {
  // `consensusFloor` is derived for the POOLED IDF-weighted vote.  The other two
  // weighting modes deviate — and the deviation is TWO-SIDED and bounded by
  // `ln 2`: `direct` deflates a region (ln(1+c) < ln(N/c) for small c) and
  // `combined` inflates it.  MEASURED across 8 anchors in 5 queries, running the
  // same climb in all three modes: gating on the mode-dependent `vote` DID flip a
  // verdict — anchor 87 of the second query (inverse 2.682 admitted, direct 1.468
  // refused, floor 2.292).  The fix is to gate on the IDF sum, which is
  // mode-independent by construction and EQUALS `vote` in the engine's own mode,
  // so no verdict in `inverse` moves.
  //
  // The anchor that makes this test non-vacuous is #148 of the second query: its
  // `combined` reading sits ABOVE the floor and its `direct` reading BELOW, while
  // its inverse reading is above — i.e. both deviations are present in the
  // fixture, and still neither crosses the floor in the wrong place.
  const CORPUS = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    [
      "The tallest tower in Paris",
      "The tallest tower in Paris is the Eiffel Tower",
    ],
    ["Gustaf Molander", "Gustaf Molander was a Swedish film director"],
    ["Stockholm", "Stockholm is the capital of Sweden"],
  ];
  const { corpusN } = await import("../dist/src/mind/traverse.js");
  const { consensusFloor } = await import("../dist/src/geometry.js");
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(CORPUS);
  const queries = [
    "capital of France and the tallest tower in Paris",
    "2+2 and the Eiffel Tower",
    "Gustaf Molander and the tallest tower in Paris and 2+2",
  ];
  let anchors = 0;
  let straddling = 0;
  for (const q of queries) {
    const enc = new TextEncoder().encode(q);
    const floor = consensusFloor(corpusN(mind));
    const rootsOf = {};
    const votes = {};
    const idfOf = {};
    for (const mode of ["inverse", "direct", "combined"]) {
      const got = await mind.climbAttention(enc, 24, mode);
      rootsOf[mode] = got.map((a) => a.anchor).sort((x, y) => x - y);
      votes[mode] = new Map(got.map((a) => [a.anchor, a.vote]));
      // `idfVote` is on Attention; the gate reads it.
      idfOf[mode] = new Map(got.map((a) => [a.anchor, a.idfVote]));
    }
    // THE PROPERTY pinned here is the GATE's, per anchor: the IDF reading — the
    // quantity `consensusFloor` is derived for — is mode-independent, so an
    // anchor's floor verdict cannot change with the weighting.  The ELECTED SET
    // is deliberately NOT pinned: the election walks the ranked anchors in `vote`
    // order, which is mode-dependent by design (that order is a legitimate
    // ranking, used as an order by `confluence`), and overlap resolution can
    // therefore elect a different anchor in another mode.
    const first = [...votes.inverse.keys()];
    for (const id of first) {
      const iv = idfOf.inverse.get(id);
      assert.equal(
        idfOf.direct.get(id),
        iv,
        `the IDF reading must not depend on the mode (anchor ${id})`,
      );
      assert.equal(
        idfOf.combined.get(id),
        iv,
        `the IDF reading must not depend on the mode (anchor ${id})`,
      );
      assert.equal(
        (idfOf.direct.get(id) ?? 0) >= floor,
        (iv ?? 0) >= floor,
        `the floor verdict must not depend on the mode (anchor ${id})`,
      );
    }
    // Anti-vacuity: the fixture must contain an anchor whose mode-dependent
    // VOTE straddles the floor on opposite sides, so the deviations are present.
    for (const id of rootsOf.inverse) {
      anchors++;
      const c = votes.combined.get(id) ?? 0;
      const d = votes.direct.get(id) ?? 0;
      if ((c >= floor) !== (d >= floor)) straddling++;
    }
  }
  await store.close();
  assert.ok(
    anchors >= 4,
    `the fixture must reach several anchors (${anchors})`,
  );
  assert.ok(
    straddling >= 1,
    `the fixture must contain an anchor whose two deviations straddle the floor, ` +
      `else this test pins nothing (straddling=${straddling})`,
  );
});

test("21. the price's second term has one definition, and it is the complement", async () => {
  // `unaccountedBytes` collapsed four copies of the same `reduce` (audit, etapa 6).
  // Since the value did NOT change, the lot is only pinned if something would
  // fail when the helper sums the wrong thing — so this test uses an input where
  // the two candidate readings DIFFER.
  const { unexplainedSpans, unaccountedBytes } = await import(
    "../dist/src/mind/rationale.js"
  );
  // Empty accounted ⇒ the whole query is unaccounted.
  assert.equal(unaccountedBytes(unexplainedSpans(10, [])), 10);
  // Full cover ⇒ nothing is unaccounted (this is the honest-silence end).
  assert.equal(unaccountedBytes(unexplainedSpans(10, [[0, 10]])), 0);
  // THE DISCRIMINATING CASE — OVERLAPPING accounted spans:
  //   [[0,6],[4,10]] covers the union [0,10) = 10 bytes, while summing their
  //   EXTENSIONS gives 6 + 6 = 12.  The price's term is the COMPLEMENT, so it
  //   must be 0 here; a helper that summed extensions or accounted lengths
  //   would answer 12 (or 6+6) and fail.
  const overlapping = [[0, 6], [4, 10]];
  const gaps = unexplainedSpans(10, overlapping);
  assert.equal(
    gaps.length,
    0,
    `the union fully covers: gaps=${JSON.stringify(gaps)}`,
  );
  assert.equal(unaccountedBytes(gaps), 0);
  // And the complement is additive against the covered union: half-covered.
  assert.equal(unaccountedBytes(unexplainedSpans(10, [[0, 4], [2, 6]])), 4);
  // Nothing is ever negative or double-counted on a mixed input.
  assert.equal(
    unaccountedBytes(unexplainedSpans(20, [[5, 8], [5, 8], [12, 15]])),
    14,
  );
});

test("22. the trace publishes the bar the margin gate ACTUALLY applied", async () => {
  // The margin gate scales its bar by what the region does NOT address:
  // `estimatorNoise(D) * (1 - cov)`.  The REJECTION path recorded that scaled
  // bar; the "voted" path recorded the RAW `estimatorNoise(D)` — so a region
  // that PASSED was reported closer to its limit than it was.  The field lives
  // on the REGION trace (`recordRegion`), which is where the gate runs.
  //
  // ANTI-VACUITY, two guards: (1) the fixture must contain at least one region
  // that reached the margin gate at all — on a corpus where no approximate
  // region gets there, this test would pin nothing; (2) among those, at least
  // one VOTED region must have been judged with a bar BELOW the raw one
  // (cov > 0 on the passing side).  On the old code every voted floor was raw,
  // so guard (2) fails — which is what makes this test discriminating.
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const { estimatorNoise } = await import("../dist/src/geometry.js");
  const achar = (o, d = 0) => {
    if (o === null || typeof o !== "object" || d > 5) return null;
    if (Array.isArray(o.regions) && o.regions.length) return o;
    for (const v of Object.values(o)) {
      const r = achar(v, d + 1);
      if (r) return r;
    }
    return null;
  };
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  const P = [
    "France",
    "Sweden",
    "Japan",
    "Peru",
    "Kenya",
    "Nepal",
    "Chile",
    "Oman",
    "Fiji",
    "Malta",
    "Cuba",
    "Laos",
  ];
  const CORPUS = [];
  for (const p of P) {
    CORPUS.push([
      `What is the capital of ${p}`,
      `The capital of ${p} is the city of ${p}town`,
    ]);
    CORPUS.push([
      `The capital of ${p} is the city of ${p}town`,
      `The ${p}town parliament sits by the river`,
    ]);
  }
  CORPUS.push([
    "What is the tallest tower in Paris",
    "The tallest tower in Paris is the Eiffel Tower",
  ]);
  CORPUS.push(["2+2", "2+2 equals 4"]);
  await mind.ingest(CORPUS);
  const q =
    "how do you say thank you in the language of Nepal and in the language of Oman";
  const steps = [];
  await mind.respondText(q, (x) => steps.push(x));
  const st = steps.find((x) => achar(x.data ?? x) !== null);
  const td = st ? achar(st.data ?? st) : null;
  const raw = estimatorNoise(store.D);
  const regions = td?.regions ?? [];
  const withFloor = regions.filter((r) =>
    r.contrastiveNoiseFloor !== undefined
  );
  assert.ok(
    withFloor.length >= 1,
    `the fixture must reach the margin gate at all (regions=${regions.length}, ` +
      `withFloor=${withFloor.length})`,
  );
  for (const r of withFloor) {
    assert.ok(
      r.contrastiveNoiseFloor <= raw + 1e-12,
      `the applied bar never exceeds the raw one (${r.contrastiveNoiseFloor} > ${raw})`,
    );
  }
  // guard (2): the outcome field names which regions PASSED.
  const voted = withFloor.filter((r) => r.ordinaryVoteProduced === true);
  assert.ok(
    voted.length >= 1,
    `the fixture must contain a region that PASSED the gate and reached the margin ` +
      `(withFloor=${withFloor.length}); fields present: ${
        JSON.stringify(Object.keys(withFloor[0] ?? {}))
      }`,
  );
  assert.ok(
    voted.some((r) => r.contrastiveNoiseFloor < raw - 1e-12),
    `at least one VOTED region must carry a bar BELOW the raw one (cov > 0 on the ` +
      `passing side); otherwise this test pins nothing ` +
      `(voted=${voted.length}, floors=${
        voted.map((r) => r.contrastiveNoiseFloor).join(",")
      } raw=${raw})`,
  );
  await store.close();
});

test("23. the payload carries every section the draft supplies", async () => {
  // `ClimbConsensusData` is assembled by hand from `TraceDraft` (see
  // traceAttention): four sections are plain pass-throughs (`regions`,
  // `saturation`, `pooling`, `anchors`), one comes from the config
  // (`reaches`), and one is REBUILT from the summary plus two draft arrays
  // (`crossRegion`).  A section added to the draft and missed in that assembly
  // vanishes from the payload SILENTLY — which is the drift `visited?` records
  // ("Absent on payloads recorded before this field existed").  The draft
  // itself is not observable from outside, but the PAYLOAD is: this test runs a
  // climb that produces each pass-through section and asserts it arrives.
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const achar = (o, d = 0) => {
    if (o === null || typeof o !== "object" || d > 5) return null;
    if (o.config && Array.isArray(o.anchors)) return o;
    for (const v of Object.values(o)) {
      const r = achar(v, d + 1);
      if (r) return r;
    }
    return null;
  };
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    [
      "The tallest tower in Paris",
      "The tallest tower in Paris is the Eiffel Tower",
    ],
    ["2+2", "2+2 equals 4"],
    ["Gustaf Molander", "Gustaf Molander was a Swedish film director"],
    ["Stockholm", "Stockholm is the capital of Sweden"],
  ]);
  const q = "the capital of France and the tallest tower in Paris and 2+2";
  const steps = [];
  await mind.respondText(q, (x) => steps.push(x));
  const st = steps.find((x) => achar(x.data ?? x) !== null);
  const td = st ? achar(st.data ?? st) : null;
  await store.close();
  assert.ok(td !== null, "the traced climb must emit a payload at all");
  for (const k of ["config", "candidates", "result"]) {
    assert.ok(td[k] !== undefined, `the payload must always carry \`${k}\``);
  }
  // The four pass-through sections, plus the one the cfg supplies.
  const missing = [];
  for (const k of ["regions", "saturation", "pooling", "anchors", "reaches"]) {
    if (td[k] === undefined) missing.push(k);
  }
  assert.deepEqual(
    missing,
    [],
    `the payload is missing section(s) the draft/config supplied: ${
      missing.join(", ")
    } ` +
      `(present: ${Object.keys(td).join(", ")})`,
  );
  assert.ok(
    (td.regions ?? []).length >= 1 && (td.anchors ?? []).length >= 1,
    `the fixture must produce regions and anchors (regions=${
      (td.regions ?? []).length
    }, ` +
      `anchors=${(td.anchors ?? []).length})`,
  );
});
