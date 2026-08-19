// 90-connector-read-cap.test.mjs — the "already answered" probe must read by
// the QUERY, not by the corpus.
//
// `resolveConnectors` (src/mind/mechanisms/cover.ts) drops a site whose
// continuation already appears elsewhere in the query — stale transcript
// evidence, whose bridges would only be discarded later.  The test is a
// substring search, so it needs the candidate's bytes; it used to reconstruct
// them in FULL via `read(ctx, answer)`, whose maxLen defaults to ALL.
//
// AGENTS §2.8, prefix-capped reads: "a candidate that exceeds the cap is
// rejected without reconstructing it — the weave, the junction walks and the
// bridge all read this way, and uncapped reads there cost seconds per query on
// a large store."  This probe was the exception, and it runs hubBound(ctx) = √N
// times PER SITE.
//
// The probe's corpus-scale cost was once claimed from a trained-store
// measurement — "88,581 byte reconstructions / 20.5 MB for one 1,314-byte
// prompt" — but that number was measured on a `respond()` query, where the
// probe does NOT execute (`answeredSpans` is empty there, so the enclosing
// guard returns first).  It is therefore not attributable to the probe and is
// not repeated here (§2.16: a comment asserting a measurement inherits Gate 1).
// The probe runs only on a multi-turn `respondTurn` response; its benefit there
// is still unmeasured.
//
// WHAT THIS PINS.  The cap cannot reduce the read COUNT — only a semantic change
// could (see below).  It bounds each read by the QUERY, which is what §2.8 asks
// and what rescues a SHORT query: candidates averaged 231 B reconstructed
// against a 3-byte prompt.  So the invariant here is per-read SIZE.
//
// It is measured by calling `resolveConnectors` DIRECTLY and diffing the meter
// across it.  A whole-response counter cannot express this: `bytesRead` sums
// every reader in the pipeline, and the answer itself is a long continuation
// that is legitimately read in full — an earlier draft of this file asserted on
// the response total and failed even with the fix applied, for that reason.
//
// NOT fixed here, deliberately: the READ COUNT is still O(sites × √N).  Removing
// it means replacing the byte-substring test with membership in the query's
// already-computed recognised sites — an O(1) id-set test.  That is NOT
// equivalent: recognition is a "longest-known-leaf re-segmentation"
// (src/mind/recognition.ts), so it does not enumerate every learnt form; the set
// test would filter fewer sites, change which connectors exist, and can change
// answers.  A semantic decision, not a performance one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { resolveConnectors } from "../dist/src/mind/mechanisms/cover.js";

/** Learnt CONTINUATIONS far longer than the query that will be asked — the
 *  shape the cap governs: an uncapped probe reconstructs each one in full
 *  merely to discover it cannot fit inside a short query. */
const LONG = (i) =>
  `answer ${i} this is a deliberately long learnt continuation whose bytes go ` +
  `on well past anything the short query could contain, clause after clause, ` +
  `so that reconstructing it in full is plainly more work than the query ` +
  `justifies, and it keeps going for a while yet in variant ${i}`;

// ONE context with MANY learnt continuations, so `nextFirst(site, hubBound)`
// returns a wide fan and the probe does real work on a single site.
function corpus(n) {
  const pairs = [];
  for (let i = 0; i < n; i++) {
    pairs.push([`ask topic`, LONG(i)]);
    pairs.push([LONG(i), `ask topic`]);
  }
  return pairs;
}

test("connector probe reads by the query, not by the learnt continuation", async () => {
  const store = new SQliteStore({ path: ":memory:", D: 256 });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest(corpus(300));

  const QUERY = "ask topic";
  const bytes = new TextEncoder().encode(QUERY);

  // beginResponse builds the per-response memos AND the meter this reads.
  mind.beginResponse();
  try {
    const { sites } = mind.recogniseSpan(bytes);
    // EXACT ISOLATION.  resolveConnectors also reads bytes the probe has
    // nothing to do with (the n-ary bridge reads each ordered node in full, and
    // legitimately so).  The probe itself early-returns when answeredSpans is
    // empty, so running the SAME call both ways and differencing leaves exactly
    // the probe's own reads and nothing else.
    const m = mind.meter;
    mind.answeredSpans = [];
    const a0 = m.byteReads, b0 = m.bytesRead;
    await resolveConnectors(mind, sites, bytes);
    const baseReads = m.byteReads - a0, baseBytes = m.bytesRead - b0;

    mind.answeredSpans = [[0, 1]];
    const a1 = m.byteReads, b1 = m.bytesRead;
    await resolveConnectors(mind, sites, bytes);
    const reads = (m.byteReads - a1) - baseReads;
    const read = (m.bytesRead - b1) - baseBytes;

    console.log(
      `    ${sites.length} sites, query ${QUERY.length} B → ` +
        `byteReads=${reads} bytesRead=${read} ` +
        `(${(read / Math.max(reads, 1)).toFixed(0)} B per read)`,
    );

    // NON-VACUITY: the probe must actually have read something, or the bound
    // below is trivially true and proves nothing.
    assert.ok(
      reads > 0,
      `resolveConnectors made no byte reads — the probe never ran (sites=${sites.length}), ` +
        `so this file is not testing anything`,
    );

    // THE BOUND.  Every read here tests a candidate for containment in the
    // query, so none can need more than the query's own length plus the single
    // overflow byte that makes the test exact.  Continuations here are ~230 B
    // against an 11 B query, so an uncapped read cannot satisfy this and a
    // capped one cannot violate it.
    const perRead = read / Math.max(reads, 1);
    assert.ok(
      perRead <= QUERY.length + 1,
      `the connector probe averaged ${perRead.toFixed(0)} B per read for a ` +
        `${QUERY.length} B query — a candidate longer than the query cannot ` +
        `occur inside it, so it must be rejected on an overflow probe of ` +
        `${QUERY.length + 1} B, not reconstructed in full (AGENTS §2.8)`,
    );
  } finally {
    mind.endResponse();
  }
  await mind.store.close();
});
