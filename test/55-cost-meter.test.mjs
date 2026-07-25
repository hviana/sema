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
