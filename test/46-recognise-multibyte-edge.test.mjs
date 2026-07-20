// 46-recognise-multibyte-edge.test.mjs — recognise()'s canon-miss fallback
// must recover a trained form whose edge misalignment is MORE than one byte
// (the shipped ±1 fix only covers a single stray edge byte).
//
// bytesToTree's plain fold is RADIX-ALIGNED: a chunk's own boundary is a
// multiple of the geometry's group width W from the LOCAL start of whatever
// it was folded from (see geometry.ts's FoldPyramid comment).  A query whose
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
