// 44-recognise-edge-whitespace.test.mjs — recognise() must still find a
// stored form when the query's own fold chunk swallows a leading/trailing
// separator byte the trained form never had.
//
// Traced live (analyze_training.ts, dialogue D geography thread): the
// accumulated query "...And what is the capital of Spain?" recognises
// nothing near "what is the capital of Spain?" even though the exact fact
// is trained and well-formed ("What is the capital of Spain?", resolves
// cleanly in isolation).  Root-caused directly: the query's OWN fold draws
// a chunk boundary at " what is the capital of Spain?" (WITH the leading
// space folded in from the preceding "And "), and canon.ts's own
// documented contract says edge whitespace belongs between forms, never to
// one — so canonResolve correctly refuses that padded span.  The one-byte
// trimmed span DOES canon-resolve to the trained fact (verified directly:
// canonResolve on bytes[65,94) returns the same id as resolving "What is
// the capital of Spain?" standalone) — but nothing tried the trimmed span.
// Fix: when a chunk's canon fallback misses, retry the two one-byte-
// shorter edge variants via resolve() (self-verifying, like every
// content-addressed lookup here) before giving up — mind/recognition.ts
// has no notion of "whitespace" at all, it just trusts the store's own
// hash-then-verify discipline.  Two extra probes, only on the
// already-failed miss path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind, SQliteStore } from "../dist/src/index.js";
import { textCanon } from "../dist/src/canon.js";
import { recognise } from "../dist/src/mind/recognition.js";
import { resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);

test("recognise(): a chunk that swallows a leading separator still finds the trained form after trimming", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["What is the capital of France?", "The capital of France is Paris."],
    ["What is the capital of Spain?", "Madrid is the capital of Spain."],
  ]);
  await m.buildCanonIndex(textCanon);
  m.canon = m._canonFor(textCanon);
  m.canonMemo = new Map();

  const query = enc(
    "What is the capital of France?The capital of France is Paris." +
      "And what is the capital of Spain?",
  );
  const expected = resolve(m, enc("What is the capital of Spain?"));
  assert.ok(
    expected !== null,
    "sanity: the trained fact must resolve standalone",
  );

  const rec = recognise(m, query);
  const hit = rec.sites.find((s) => s.payload === expected);
  assert.ok(
    hit,
    `expected a recognised site for the trained Spain fact, got sites: ` +
      JSON.stringify(
        rec.sites.map((s) => [s.start, s.end, s.payload]),
      ),
  );
  await m.store.close();
});
