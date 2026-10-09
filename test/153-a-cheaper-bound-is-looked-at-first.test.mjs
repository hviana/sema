// 153-a-cheaper-bound-is-looked-at-first.test.mjs — the market and the span
// probe do the same work for less.
//
// THE MARKET.  Mechanisms run in declared order and are pruned by the
// incumbent — but a mechanism floored LOWER than one about to invest, declared
// after it, could not prune it.  Measured on the 31.7M-node store: a query that
// opens a trained form (#114 of the battery) was won by prefix-completion at
// grade 1 after CAST (floor grade 2) had paid the consensus climb and the weave,
// and confluence, extraction and reference their reads.  The grounding loop now
// runs such a mechanism AHEAD (pipeline.ts, "a cheaper bound is looked at before
// a dearer one is paid for") and skips what cannot beat the grade it reaches.
//
// THE SPAN PROBE.  Recognition's interior pass probes every span of up to
// `reach` bytes past each endpoint, and each probe hashed its span from the
// start — O(n·reach²) bytes (251,660,406 for one response on that store).
// `Store.flatSpans` extends the hash a start was last probed at instead.
//
// Pinned:
//   153.1 a mechanism floored below CAST's, run ahead, skips CAST and the rest
//         of the composition market — and the weave is never paid for;
//   153.2 the decision is the declared order's: the same answer, from the same
//         mechanism, as a market whose bounds are hidden from the run-ahead;
//   153.3 a bound that does not undercut the dearer floor runs nothing ahead:
//         a query the cover grounds whole runs the cover alone;
//   153.4 the span prober answers exactly `findFlatBranch` over the same span,
//         in every order a scanner can ask in;
//   153.5 a mechanism run ahead of the consensus climb is run again at its
//         declared turn when the climb shows other instances that name its
//         pick: its reading ahead of the climb is priced as if the question
//         had not named it, and the declared order would not have priced it so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const FORM =
  "What time does the movie start? We would need to start between 7-7:30pm";
const QUERY = "What time does the movie start?";

async function fixture() {
  const mind = new Mind({
    seed: 7,
    profile: true,
    store: new SQliteStore({ path: ":memory:" }),
  });
  await mind.ingest([
    [FORM, "Sure, let me check the showtimes."],
    ["Do you like thrillers?", "Yes, I love them."],
    ["The movie was great.", "I agree."],
  ]);
  return mind;
}

/** The decision a market reaches when no mechanism can be run ahead: every
 *  floor answers the run-ahead's refusing probe with 0, which no later floor
 *  undercuts — so the loop is the plain declared-order loop.  (A real
 *  `worthRunning` accepts a floor of −∞; only the refusing probe declines it.) */
function declaredOrder(mind) {
  for (let i = 0; i < mind.mechanisms.length; i++) {
    const m = mind.mechanisms[i];
    mind.mechanisms[i] = {
      ...m,
      floor: (ctx, q, pre, worth) =>
        worth(-Infinity) ? m.floor(ctx, q, pre, worth) : Promise.resolve(0),
      run: m.run.bind(m),
    };
  }
}

/** The winning candidate's provenance, read off the rationale. */
async function decide(mind, q) {
  let winner = null;
  const answer = await mind.respondText(q, (s) => {
    if (s.mechanism.at(-1) === "decideGrounding") {
      winner = s.data.candidates.find((c) => c.decided);
    }
  });
  return { answer, winner };
}

test("153.1 a cheaper bound run ahead skips the composition market", async () => {
  const mind = await fixture();
  const answer = await mind.respondText(QUERY);
  const c = mind.lastCost.counters;
  const phases = mind.lastCost.phases;
  assert.equal(answer, "Sure, let me check the showtimes.");
  assert.ok(
    c.mechanismsBounded >= 4,
    `cast, confluence, extraction and reference are bounded out: ${c.mechanismsBounded}`,
  );
  assert.equal(phases["cast.run"], undefined, "CAST never runs");
  assert.equal(phases["weave"], undefined, "the weave is never paid for");
  await mind.store.close();
});

test("153.2 the decision is the declared order's", async () => {
  const ahead = await fixture();
  const plain = await fixture();
  declaredOrder(plain);
  const a = await decide(ahead, QUERY);
  const p = await decide(plain, QUERY);
  assert.equal(a.answer, p.answer);
  assert.equal(a.winner.provenance, p.winner.provenance);
  assert.equal(a.winner.weight, p.winner.weight);
  // …and the oracle really is the dearer market: there, CAST paid for the
  // weave, and confluence ran.
  assert.ok(plain.lastCost.phases["weave"] !== undefined);
  assert.ok(plain.lastCost.phases["confluence.run"] !== undefined);
  assert.equal(ahead.lastCost.phases["confluence.run"], undefined);
  await ahead.store.close();
  await plain.store.close();
});

test("153.3 a cover that grounds whole runs nothing ahead", async () => {
  const mind = await fixture();
  assert.equal(
    await mind.respondText("Do you like thrillers?"),
    "Yes, I love them.",
  );
  const c = mind.lastCost.counters;
  assert.equal(c.mechanismRuns, 1, "the cover alone");
  assert.equal(c.mechanismsBounded ?? 0, 0);
  await mind.store.close();
});

test("153.4 the span prober answers exactly findFlatBranch", async () => {
  const mind = await fixture();
  const store = mind.store;
  const bytes = new TextEncoder().encode(
    `${FORM} Do you like thrillers? The movie was great. ${QUERY}`,
  );
  const n = bytes.length;
  const want = (s, e) => store.findFlatBranch(bytes.subarray(s, e));
  const probe = store.flatSpans(bytes);
  let hits = 0, asked = 0;
  const check = (s, e) => {
    const got = probe(s, e);
    assert.equal(got, want(s, e), `span [${s},${e})`);
    asked++;
    if (got !== null) hits++;
  };
  // Ends ascending per start (the extension path)…
  for (let e = 1; e <= n; e++) {
    for (let s = Math.max(0, e - 40); s < e; s++) {
      check(s, e);
    }
  }
  // …a suffix then its one-byte trim (the short path), and revisits that end
  // BEFORE the last probe of their start (the rehash path).
  for (let s = n - 1; s >= 0; s--) {
    check(s, n);
    check(s, n - 1 > s ? n - 1 : n);
    check(s, Math.min(n, s + 3));
  }
  assert.ok(asked > 5_000, `probes asked: ${asked}`);
  assert.ok(hits > 50, `the buffer must hold stored flat spans: ${hits}`);
  await store.close();
});

test("153.5 a mechanism run ahead of the climb is run again when the climb shows what names its pick", async () => {
  // Measured on the 2Wiki fixture with one-hop questions: recall's argument
  // binding read `The place of birth of John Lennon is Liverpool.` both times,
  // owing 49 bytes ahead of the climb and 28 after it, when other instances
  // (`Where was Peter Jackson born?`) name `place of birth` for `born`.  The
  // heavier reading lost to a cover that glued the first hop onto it.
  const fact = (s, r, o) => {
    const f = `The ${r} of ${s} is ${o}.`;
    return [[`${s} ${r}`, f], [s, f]];
  };
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ...fact("God", "performer", "John Lennon"),
    ...fact("John Lennon", "place of birth", "Liverpool"),
    ...fact("Peter Jackson", "place of birth", "Wellington"),
    ...fact("Taika Waititi", "place of birth", "Raukokore"),
    ...fact("Stan Rogers", "place of birth", "Hamilton"),
    [
      "Where was Peter Jackson born?",
      "The place of birth of Peter Jackson is Wellington.",
    ],
    [
      "Where was Taika Waititi born?",
      "The place of birth of Taika Waititi is Raukokore.",
    ],
    [
      "Where was Stan Rogers (Song) born?",
      "The place of birth of Stan Rogers is Hamilton.",
    ],
  ]);
  await mind.buildCanonIndex();
  const text = await mind.respondText(
    "Where was the performer of song God (John Lennon Song) born?",
  );
  assert.ok(
    (mind.lastCost.counters.mechanismReruns ?? 0) >= 1,
    "the mechanism run ahead was run again at its declared turn",
  );
  assert.equal(text, "The place of birth of John Lennon is Liverpool.");
  await store.close();

  // Without instances the climb adds nothing to what recall read, and nothing
  // is run twice: measured on the 31.7M-node store, rerunning whenever the
  // climb had run cost 26% more bytes read for no changed answer.
  const bare = new SQliteStore({ path: ":memory:" });
  const plain = new Mind({ seed: 7, store: bare, profile: true });
  await plain.ingest([
    ...fact("God", "performer", "John Lennon"),
    ...fact("John Lennon", "place of birth", "Liverpool"),
    ...fact("Peter Jackson", "place of birth", "Wellington"),
  ]);
  await plain.buildCanonIndex();
  await plain.respondText(
    "Where was the performer of song God (John Lennon Song) born?",
  );
  assert.ok(
    (plain.lastCost.counters.climbs ?? 0) >= 1,
    "the climb ran after recall was run ahead",
  );
  assert.equal(plain.lastCost.counters.mechanismReruns ?? 0, 0);
  await bare.close();
});
