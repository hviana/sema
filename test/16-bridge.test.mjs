import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// =========================================================================
// THE BRIDGE — synthesising the connector between rewritten parts
// =========================================================================
//
// When `think` rewrites several parts of a query at once, it must decide how to
// JOIN the results. The connector between two rewrites is NOT simply the bytes
// the query had between the originals: after a rewrite, the asker's connector
// may no longer make sense, may be missing entirely, or may need to become
// something the asker never wrote.
//
// The bridge is the heart of the algorithm, not a special case. Whenever parts
// are rewritten, the graph is consulted for how the RESULTS cohere. Three
// outcomes, all decided by the graph, never assumed:
//
//   • nothing      — the results stand adjacent with no connector;
//   • the input's  — the query's own connector still coheres, so it is kept;
//   • a synthesised one — the graph learned a connector between the results
//                    (a space, a ".", or a whole phrase), so it is inserted
//                    even though the asker never wrote it.
//
// The synthesised case is what these tests pin down. A previous refactor, with
// no test guarding it, silently dropped synthesis — "icefire" answered
// "coldhot" with the two rewrites run together, even when the store had learned
// how "cold" and "hot" connect. That is the regression these tests forbid.
//
// The graph signal: resonate the bare concatenation of the two result spans;
// if a learned form both BEGINS WITH the left result and ENDS WITH the right,
// the bytes in between are the learned connector. No learned form ⇒ no
// connector invented (strangers do not get a spurious phrase).

const mk = () => new Mind({ seed: 7 });

// ── 1. Synthesise a word connector the asker never wrote ─────────────────
// "ice"→"cold", "fire"→"hot" are independent facts; the store SEPARATELY
// learned the experience "cold or hot". Asking the two together — with no
// usable connector between them ("icefire") — must reconstruct the learned
// join, answering "cold or hot", not "coldhot".
test("bridge synthesises a learned word connector between rewrites", async () => {
  const m = mk();
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  await m.ingest("cold or hot"); // the graph learns how the answers connect
  const r = await m.respondText("icefire");
  assert.equal(r, "cold or hot");
  await m.store.close();
});

// ── 2. Synthesise a whole-phrase connector ───────────────────────────────
// The connector can be anything the graph learned, not just punctuation.
test("bridge synthesises a learned phrase connector", async () => {
  const m = mk();
  await m.ingest([["sky", "blue"], ["grass", "green"]]);
  await m.ingest("blue is the opposite of green");
  const r = await m.respondText("skygrass");
  assert.equal(r, "blue is the opposite of green");
  await m.store.close();
});

// ── 3. No learned connection ⇒ no connector invented ─────────────────────
// Synthesis is graph-evidenced, never guessed. Without a learned join the two
// rewrites simply abut — the bridge must not hallucinate a phrase.
test("bridge invents nothing when the graph learned no connection", async () => {
  const m = mk();
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  const r = await m.respondText("icefire");
  // Both answers present, adjacent, with no fabricated linking text.
  assert.ok(r.includes("cold") && r.includes("hot"));
  assert.ok(
    !r.includes(" or ") && !r.includes(" is "),
    `no connector should be invented, got ${JSON.stringify(r)}`,
  );
  await m.store.close();
});

// ── 4. The asker's own connector is kept when it still coheres ───────────
// Synthesis must not override a perfectly good input connector. "ice, fire"
// with the comma intact stays "cold, hot".
test("bridge keeps the asker's connector when it coheres", async () => {
  const m = mk();
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  const r = await m.respondText("ice, fire");
  assert.ok(
    r.includes("cold") && r.includes("hot") && r.includes(","),
    `the asker's comma should survive, got ${JSON.stringify(r)}`,
  );
  await m.store.close();
});

// ── 4b. Learning a connector phrase must NOT corrupt the parts ───────────
// THE PREREQUISITE THE BRIDGE STANDS ON. Multi-part rewriting works on its own
// ("ice fire" → "cold hot"). The moment the store ALSO learns a phrase that
// happens to contain those answers ("cold or hot"), the cover search must still
// rewrite each part cleanly — it must not let the phrase's chunks bleed into a
// part and turn "cold" into "or hot". (Before the fix, this regressed "ice fire"
// from "cold hot" to "or hothot": the fuse/resolve rules absorbed a completed
// rewrite into an unrelated learned phrase chunk.)
test("learning a connector phrase does not corrupt the rewrites", async () => {
  const base = mk();
  await base.ingest([["ice", "cold"], ["fire", "hot"]]);
  const before = await base.respondText("ice fire");
  await base.store.close();
  assert.equal(before, "cold hot");

  const m = mk();
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  await m.ingest("cold or hot"); // a phrase containing both answers
  const after = await m.respondText("ice fire");
  // The two parts still rewrite cleanly; no chunk of the phrase bleeds in.
  assert.equal(
    after.replace(/[^a-z ]/g, "").replace(/ +/g, " ").trim(),
    "cold hot",
    `parts must stay clean, got ${JSON.stringify(after)}`,
  );
  await m.store.close();
});

// =========================================================================
// THE BRIDGE IS IN THE SEARCH, NOT A POST-PASS
// =========================================================================
//
// The connector must be chosen DURING the cover search — a weighted rule in the
// same deduction system as the rewrites — not stitched on afterwards. A post-hoc
// pass that joins finished parts pairwise, left to right, has two fatal faults
// these tests forbid:
//
//   • it cannot see a connector that spans MORE THAN TWO parts (a learned
//     "X then Y then Z" is invisible to pairwise bridge(X,Y), bridge(Y,Z));
//   • joining already-rewritten parts one pair at a time lets small mismatches
//     ACCUMULATE into near-dedup gaps (a dropped or doubled fragment), because no
//     single decision ever sees the whole join.
//
// Pricing the connector inside the search makes the cover globally optimal: the
// derivation that yields the most coherent whole wins, connectors included.

// ── 5. A connector spanning three parts is found as one whole ────────────
// The graph learned "X then Y then Z" linking three answers. Asking a, b, c
// together must reconstruct that whole linked form — a pairwise post-pass,
// knowing only two-part forms, would miss it and emit a bare "XYZ".
test("bridge spans three rewritten parts at once", async () => {
  const m = mk();
  await m.ingest([["a", "X"], ["b", "Y"], ["c", "Z"]]);
  await m.ingest("X then Y then Z"); // the three answers cohere as one phrase
  const r = await m.respondText("abc");
  assert.equal(r, "X then Y then Z");
  await m.store.close();
});

// ── 6. No accumulated gaps across several junctions ──────────────────────
// Joining many rewrites must never drop or double a fragment. Every recognised
// answer appears exactly once, in order, with no garbage between.
test("bridge accumulates no gaps across many parts", async () => {
  const m = mk();
  await m.ingest([["a", "X"], ["b", "Y"], ["c", "Z"]]);
  await m.ingest("X then Y then Z");
  const r = await m.respondText("a b c");
  // Each answer once, in order; no doubled or dropped letter.
  assert.equal(r.replace(/[^XYZ]/g, ""), "XYZ");
  await m.store.close();
});

// =========================================================================
// N-ARY CONNECTORS — the whole interior, not pairwise scraps
// =========================================================================
//
// A learned whole that runs three or more answers together (e.g.
// "cold, hot, and windy") carries DIFFERENT material between different pairs:
// between the first two it is ", ", but between the first and the LAST it is
// ", hot, and " — the interior answer plus both separators. Pairwise bridging,
// stitched greedily left-to-right, takes the first pairwise connector (", ") and
// then cannot place the rest, emitting "cold, hot" + "windy" → "cold, hotwindy".
//
// The N-ary connector resolves the single learned whole that runs ALL the
// recognised answers in order and records, for the first answer paired with each
// later one, the EXACT interior between them. The cover then jumps from the first
// answer straight to the last across the (recognised) interior, voicing the whole
// coherent phrase. These tests pass only with that mechanism.

// ── 7. Three answers cohere with the full interior between them ──────────
test("n-ary connector voices a three-answer whole", async () => {
  const m = mk();
  await m.ingest([["ice", "cold"], ["fire", "hot"], ["wind", "windy"]]);
  await m.ingest("cold, hot, and windy"); // the three cohere as one phrase
  const r = await m.respondText("icefirewind");
  assert.equal(r, "cold, hot, and windy");
  await m.store.close();
});

// ── 8. Four answers — the interior grows, still found as one whole ───────
test("n-ary connector voices a four-answer whole", async () => {
  const m = mk();
  await m.ingest([["a", "W"], ["b", "X"], ["c", "Y"], ["d", "Z"]]);
  await m.ingest("W, X, Y, and Z");
  const r = await m.respondText("abcd");
  assert.equal(r, "W, X, Y, and Z");
  await m.store.close();
});

// ── 9. The asker's own separator is never crossed by an N-ary jump ───────
// The N-ary jump fires only across a span that is ITSELF wholly recognised
// (interior answers). When the asker wrote their own separator between parts,
// that gap is unrecognised, so the jump must NOT fire and the separator must
// survive — "ice fire" stays "cold hot", never the learned "cold, hot, and …".
test("n-ary jump does not swallow the asker's separator", async () => {
  const m = mk();
  await m.ingest([["ice", "cold"], ["fire", "hot"], ["wind", "windy"]]);
  await m.ingest("cold, hot, and windy");
  const r = await m.respondText("ice fire wind");
  // The asker ran them apart; their own spacing is kept, parts cleanly rewritten.
  assert.equal(
    r.replace(/[^a-z ]/g, "").replace(/ +/g, " ").trim(),
    "cold hot windy",
  );
  await m.store.close();
});

// =========================================================================
// SYNONYM JUNCTIONS — bridging through a halo sibling
// =========================================================================
//
// When two answers lack a direct learnt container linking them, but a HALO
// SIBLING of one answer participates in a learnt whole with the other (e.g.
// "chilly or hot" where "chilly" is a distributional synonym of "cold"), the
// bridge must find that junction through the sibling and extract the connector.
// This is the halo-sibling tier between the exact edge junctions (tier 2)
// and the approximate resonance fallback (tier 3): the container evidence is
// exact (content-addressed DAG ascent, same as tier 1), but one side is
// relaxed from the exact answer to a distributional sibling.

// ── 10. Connector found through a halo sibling of the left answer ──────────
// "ice"→"cold", "fire"→"hot" are the base facts.  "chilly" shares
// distributional company with "cold" (both follow "freeze"), so they are halo
// siblings.  The store separately learned "chilly or hot".  The bridge must
// find "chilly or hot" through the halo-sibling relationship and extract
// " or " as the connector between "cold" and "hot".
test("bridge finds a connector via a halo-sibling synonym", async () => {
  const m = mk();
  await m.ingest([["ice", "cold"], ["fire", "hot"]]);
  // Make "chilly" a halo sibling of "cold" — both appear after "freeze".
  await m.ingest([["freeze", "cold"], ["freeze", "chilly"]]);
  // Learn the junction phrase — the connector " or " lives between
  // "chilly" and "hot", but NOT between "cold" and "hot" directly.
  await m.ingest("chilly or hot");
  const r = await m.respondText("icefire");
  assert.equal(r, "cold or hot");
  await m.store.close();
});
