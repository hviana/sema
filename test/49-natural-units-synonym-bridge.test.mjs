// 49-natural-units-synonym-bridge.test.mjs — irrefutable demonstration of
// the architectural gap investigated this session: a query using a
// near-synonym ("biggest") of a word that was only ever trained in a
// DIFFERENT phrasing ("largest") finds nothing, even though the fact
// itself is trained and the synonym relationship is corroborated many
// times over in the corpus.
//
// Root-caused directly (prior turn): "biggest"/"largest" NEVER resolve as
// independent nodes at all — deposit() only interns whole sentences (as
// one flat branch) plus tiny W-1/W leaf-id windows (canonical.ts); a
// 7-byte word floating mid-sentence falls in the gap between those two
// scales and is never independently addressable, so the EXISTING
// halo/synonym machinery (conceptHop, already used by CAST) never gets an
// entry point to it — the halo system is real and works, it is simply
// never asked about a node that was never minted.
//
// Fix (units.ts): a derived, corpus-statistics-only notion of a "natural
// unit" — a run of adjacent chunks whose pairing recurs at least as often
// as either chunk alone (the same principle behind BPE/content-defined
// chunking, computed from this store's own reuse/containment counts, no
// injected modality-specific segmenter).  Interned at deposit time,
// pairwise halo-poured as each other's company; read at query time via the
// same derived merge (existingUnits) plus a halo-corroborated substitution
// fallback in recognise().

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b).replace(/\0+$/, "");

// Parallel "X is the biggest/largest Y" constructions across several
// different nouns — real cross-sentence corroboration for the
// biggest~largest collocation pattern, not a single coincidental pairing.
const TRAIN = [
  [
    "What is the largest planet in our solar system?",
    "The largest planet is Jupiter.",
  ],
  ["What is the biggest ocean on Earth?", "The biggest ocean is the Pacific."],
  ["What is the largest country by area?", "The largest country is Russia."],
  [
    "What is the biggest mammal on Earth?",
    "The biggest mammal is the blue whale.",
  ],
  [
    "What is the largest desert in the world?",
    "The largest desert is the Sahara.",
  ],
  ["What is the biggest city in Japan?", "The biggest city is Tokyo."],
  ["What is the largest lake in Africa?", "The largest lake is Lake Victoria."],
  ["What is the biggest island on Earth?", "The biggest island is Greenland."],
];

test("baseline: 'biggest'/'largest' never resolve as independent nodes without natural units", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(TRAIN);
  // This assertion documents the ROOT CAUSE (still true even after the
  // fix — units.ts does not change what resolve() itself returns for a
  // bare word; it changes what recognise() can bridge to via halos).
  assert.equal(resolve(m, enc("biggest")), null);
  assert.equal(resolve(m, enc("largest")), null);
  await m.store.close();
});

test("irrefutable failure: a trained fact is unreachable through an untrained near-synonym", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(TRAIN);

  // Sanity: the TRAINED phrasing works.
  const trained = await m.respond(
    "What is the largest planet in our solar system?",
  );
  assert.ok(
    dec(trained.bytes).includes("Jupiter"),
    `sanity: trained phrasing must answer, got ${
      JSON.stringify(dec(trained.bytes))
    }`,
  );

  // The untrained near-synonym phrasing.  NOTE: a query that keeps the
  // trained sentence's own long, near-identical scaffolding around the one
  // swapped word ("What is the biggest planet in our solar system?")
  // already succeeds WITHOUT this fix — recallByResonance's WHOLE-QUERY
  // gist is similar enough (one word out of a long, highly-repetitive
  // sentence) to clear the reach threshold on its own, an existing
  // capability this test must not accidentally exercise instead.  Deliberately
  // SHORT and restructured ("Name the biggest planet.") so the whole-query
  // gist has no such shortcut — confirmed directly (see this session's
  // investigation) to return silence at baseline: recognise() finds 0
  // sites, and the whole-query resonance score is nowhere near the reach
  // bar.  Only a WORD-level bridge from "biggest" to its corroborated
  // synonym "largest" can recover the trained fact here.
  const untrained = await m.respond("Name the biggest planet.");
  assert.ok(
    dec(untrained.bytes).includes("Jupiter"),
    `expected the trained fact to be reachable through the corroborated ` +
      `synonym "biggest" ~ "largest", got ${
        JSON.stringify(dec(untrained.bytes))
      }`,
  );
  await m.store.close();
});

test("resonance-proposed bridge: casing/punctuation paraphrase reaches the trained fact", async () => {
  // Root-caused live on the trained store (2026-07-20): the query
  // "what is the capital of france" resonates STRAIGHT to the trained
  // "What is the capital of France?" (nearest whole-query hit) yet stayed
  // silent — the case-changed bytes fall below the reach bar, the canon
  // twin misses on the absent "?", and the bridge's own W-window climb
  // cannot single the right context out of hundreds sharing common
  // windows.  Recall now hands its resonance ranking to the bridge as
  // PROPOSED candidates (rank-only, byte-verified there), which recovers
  // the fact through two corroborated one-byte case substitutions.
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    ["What is the capital of Spain?", "The capital of Spain is Madrid."],
    ["What is the capital of Italy?", "The capital of Italy is Rome."],
    // Lowercase mid-sentence occurrences attest the case-folded windows
    // the substitution's corroboration gate requires — including the
    // frame-bearing " of france" the expansion absorbs into.
    ["He wrote of france and of spain.", "Then he flew home to italy."],
    ["She spoke of france in her diary.", "Her diary told of france."],
  ]);
  const r = await m.respond("what is the capital of france");
  assert.ok(
    dec(r.bytes).includes("Paris"),
    `expected the trained fact through the resonance-proposed bridge, got ${
      JSON.stringify(dec(r.bytes))
    }`,
  );
  await m.store.close();
});

test(
  "FIXED 2026-07-20: a proper-noun substitution must not voice a wrong " +
    "fact when the true answer has no outgoing edge to compete as a " +
    "bridge candidate (RAW BALANCE gate, see bridge.ts)",
  async () => {
    // This miniature corpus does NOT reproduce the live bug (recall's
    // whole-query resonance already answers correctly here — verified: it
    // takes the real 17.9M-node store's specific candidate ranking to
    // surface the failure mode).  Kept anyway as a standing regression
    // check on the shape of the bug (terminal fact vs. a same-shaped fact
    // WITH a continuation); the authoritative fix verification was run
    // directly against the trained store: "The capital of France is"
    // used to bridge through a substitution reading "of Fra[nce]" as
    // "of Spain si[nce]" (raw mismatch (3,8) bytes, badly imbalanced);
    // the RAW BALANCE gate (dominates(min(uLen,cLen), max(uLen,cLen)))
    // now refuses it, and recall correctly falls through to an honest
    // echo of the true trained fact instead.
    const m = new Mind({
      seed: 7,
      store: new SQliteStore({ path: ":memory:" }),
    });
    await m.ingest([
      ["What is the capital of France?", "The capital of France is Paris."],
      [
        "Madrid has been the capital of Spain since 1561.",
        "It was established as such by Philip III.",
      ],
    ]);
    const r = await m.respond("The capital of France is");
    assert.ok(
      !dec(r.bytes).includes("Spain"),
      `expected no wrong-entity substitution, got ${
        JSON.stringify(dec(r.bytes))
      }`,
    );
  },
);
