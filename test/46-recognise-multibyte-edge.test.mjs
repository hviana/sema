// 46-recognise-multibyte-edge.test.mjs — recognise()'s canon-miss fallback
// must recover a trained form whose edge misalignment is MORE than one byte
// (the shipped ±1 fix only covers a single stray edge byte).
//
// bytesToTree's fold is CONTENT-DEFINED: a chunk's own boundary is a cut the
// bytes chose (see geometry.ts's contentBoundaries), so it moves with the
// content rather than with an absolute offset.  A query whose
// recognised span sits at a different local offset than the trained deposit
// did — e.g. extra leading whitespace, which canon deliberately preserves
// verbatim at the edges, only collapsing INTERIOR whitespace — shifts every
// chunk boundary inside it by that many bytes, which can exceed 1.
//
// Fix: widen the miss-fallback with bounded W-quantum edge trims, each
// gated by the SAME cheap store.findBranch(leafIds) pre-filter the
// canonical pass (tryChain) already uses — so the (rare) miss path pays for
// a real resolve() fold only when a branch could plausibly exist there —
// and capped to nodes no larger than chainReach(W) = W² (a chunk-scale
// bound, not a whole-query one): widening at ROOT scale can rediscover
// content the structural walk's own finer recursion already owns as a
// SEPARATE, duplicate site, and downstream derivation can then stitch a
// wrong answer out of the two overlapping sites (see the second test here).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind, SQliteStore } from "../dist/src/index.js";
import { recognise } from "../dist/src/mind/recognition.js";
import { resolve } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b).replace(/\0+$/, "");

test("recognise(): a >1-byte edge misalignment still finds the trained form", async () => {
  // A whole-query-scale offset (the entire query is nothing but the trained
  // fact plus a swallowed prefix) is a DIFFERENT, still-open problem — see
  // the "does not corrupt" test below for why widening this fix to root
  // scale is exactly what must NOT happen.  What this fix targets is a
  // canon-miss node bounded to chunk scale (<= W², chainReach's own bound)
  // whose trim offset is more than the shipped ±1 fallback reaches.
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([["cats meow", "yes they do"]]);

  const expected = resolve(m, enc("cats meow"));
  assert.ok(
    expected !== null,
    "sanity: the trained fact must resolve standalone",
  );

  // Two EXTRA leading spaces relative to the trained form — canon only
  // collapses interior whitespace, so this is a 2-byte edge offset, wider
  // than the shipped ±1 fallback covers.
  const query = enc("  cats meow");
  const rec = recognise(m, query);
  const hit = rec.sites.find((s) => s.payload === expected);
  assert.ok(
    hit,
    `expected a recognised site for the trained fact despite the 2-byte ` +
      `edge offset, got sites: ` +
      JSON.stringify(rec.sites.map((s) => [s.start, s.end, s.payload])),
  );
  await m.store.close();
});

test("recognise(): a wide edge trim does not corrupt an unrelated short-form answer", async () => {
  // Regression guard for the root-scale false positive: widening the
  // fallback's reach must not let it re-derive a smaller subtree's own
  // content as a SEPARATE site at the whole-query node, which previously
  // let cover's derivation stitch two overlapping sites into a wrong
  // answer ("4+15" instead of "4").
  const TABLE = [
    ["1+2", "3"],
    ["2+2", "4"],
    ["2+3", "5"],
    ["3+3", "6"],
    ["3+5", "8"],
    ["4+3", "7"],
    ["2+5", "7"],
    ["1+5", "6"],
    ["6+1", "7"],
    ["4+1", "5"],
  ];
  const m = new Mind({ seed: 42 });
  await m.ingest(TABLE);
  const r = await m.respond("2+2 は何ですか");
  assert.equal(dec(r.bytes), "4");
});

test("recognise(): an INTERIOR form at a non-cut offset is recovered, not only an edge one", async () => {
  // The edge tier used to probe only prefixes of 0 and suffixes to bytes.length,
  // and the flat-leaf chain cannot rebuild a write-side-chunked form (its
  // `findBranch(ids)` pre-check misses at every prefix, so `resolveSpan` is
  // never reached) while its interior reach is one chunk plus W.  A form that
  // neither starts on a fold cut nor ends on a node edge therefore fell in a
  // dead zone — exactly the object inside a produced fact ("…is Gustaf
  // Molander."), which is the site the pivot would need to chain on.
  // MEASURED on the pre-change tree: no site for the entity.  With the bounded
  // interior pass (spans W..chainReach(W), linear in the query), it is found at
  // its true span.
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["x", "The director of Eva is Gustaf Molander."],
    ["Gustaf Molander", "The father of Gustaf Molander is Harald Molander."],
  ]);
  const expected = resolve(m, enc("Gustaf Molander"));
  assert.ok(expected !== null, "sanity: the entity must resolve standalone");

  const rec = recognise(m, enc("The director of Eva is Gustaf Molander."));
  const hit = rec.sites.find((s) => s.payload === expected);
  assert.ok(
    hit,
    `expected an interior site for the entity, got: ` +
      JSON.stringify(rec.sites.map((s) => [s.start, s.end, s.payload])),
  );
  assert.deepEqual([hit.start, hit.end], [23, 38]);
  await m.store.close();
});

test("recognise(): a form LONGER than chainReach is recovered past a trailing separator", async () => {
  // A 17-byte object (17 > chainReach(W) = 16) at the end of a sentence is
  // outside the interior pass's span bound, and it is not a suffix of the span
  // because a sentence-final separator (".") follows it — and the text
  // canonicalizer passes punctuation through, so the full-edge probe can never
  // match.  MEASURED on the pre-change tree: no site for the object (only the
  // shorter sub-form "Timur" surfaced); without the period the object WAS a
  // suffix and was found.  The edge tier now retries the trimmed edge on the
  // MISS path only, so the hit path pays nothing.
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["xavier director", "The director of xavier is averyverylongname."],
    ["averyverylongname", "The spouse of averyverylongname is zoe."],
  ]);
  const expected = resolve(m, enc("averyverylongname"));
  assert.ok(
    expected !== null,
    "sanity: the object must resolve standalone",
  );
  assert.ok(
    "averyverylongname".length > 16,
    "sanity: the object must be longer than chainReach(W)=16",
  );

  const rec = recognise(m, enc("The director of xavier is averyverylongname."));
  assert.ok(
    rec.sites.some((s) => s.payload === expected),
    `expected a site for the >chainReach object past the trailing separator, got: ` +
      JSON.stringify(rec.sites.map((s) => [s.start, s.end])),
  );
  await m.store.close();
});
