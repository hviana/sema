// 36-already-answered-fusion.test.mjs — a point of attention whose own
// learnt continuation is ALREADY present later in the query must not be
// fused in again.
//
// This is Category A of a two-part defect found while investigating a
// multi-turn dialogue's garbled fusion ("Thank you very much!" fused with
// unrelated points of attention).  One of those points (root "Hello",
// anchor of the greeting) traced back to substantial, genuine regions —
// not noise — and its learnt continuation ("Hello! How can I assist you
// today?") was found to be VERBATIM present earlier in the query, because
// it was Sema's own prior reply, appended by addTurn the same way any turn
// is appended.  Re-surfacing it is redundant: the query has already spoken
// its own answer.
//
// Deliberately turn-agnostic and Mind-bookkeeping-free: Mind's multi-turn
// API is strictly a computational optimization (incremental fold reuse) —
// it must never be the thing inference depends on for correctness.  This
// check uses only what already exists for ANY accumulated byte stream,
// single-shot or multi-turn: `follow()` (the same content-addressed
// continuation walk `reason()`'s own echo guard already uses,
// `ctx.store.prevCount(qId) > 0`, just applied per-candidate-root instead
// of to the whole query) and plain byte containment.  A query that embeds
// its own prior exchange — via real respondTurn(), or a caller manually
// pasting a transcript into one respond() call — is caught identically.
//
// (Category B — coincidental echo of a short, generic CURRENT-turn phrase
// against unrelated corpus content, unrelated to staleness — is a SEPARATE
// defect, not addressed here; see the investigation notes for why breadth
// and regionSupport both fail to discriminate it from genuine fusion.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { fuseAttention } from "../dist/src/mind/reasoning.js";
import { gistOf } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) =>
  new TextDecoder().decode(b.filter((x) => x !== 0)).replace(/\s+/g, " ")
    .trim();

// "greet" leads to "reply-greet" — a learnt exchange the query embeds BOTH
// halves of, exactly the shape addTurn produces (ask, then the system's own
// reply, concatenated raw).  "red circle" is a genuine, unrelated second
// topic (test/34's own binding corpus) whose own continuation is nowhere
// in the query — the ordinary multi-topic case, which must still fuse.
const CORPUS = [
  ["greet", "reply-greet"],
  ["red", "is a color"],
  ["blue", "is a color"],
  ["circle", "is a shape"],
  ["square", "is a shape"],
  ["red circle", "answer alpha"],
  ["red square", "answer beta"],
  ["blue circle", "answer gamma"],
  ["blue square", "answer delta"],
];

const mk = (seed) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });

test("fuseAttention: a root whose continuation is already answered in the query is excluded", async () => {
  const m = mk(1);
  await m.ingest(CORPUS);
  // "greet"'s own continuation, "reply-greet", is embedded right in the
  // query — the ask and its answer both present, exactly like a
  // conversation's own turn + reply.  "red circle" is a genuine further
  // topic with no such embedded answer.
  const q = enc("greet reply-greet then red then circle");
  const roots = await m.climbAttention(q, 24);
  const greet = roots.find((r) => r.start === 0);
  const redCircle = roots.find((r) => r.start !== 0);
  assert.ok(greet, "expected the 'greet' root at query offset 0");
  assert.ok(redCircle, "expected the 'red circle' binding root");

  const guide = gistOf(m, q);
  const primary = enc("PRIMARYANCHORTEXT");
  // forest[0] is never independently projected (see reasoning.ts: it is
  // treated as already primary's own source) — a placeholder keeps BOTH
  // real roots in `rest`, where this filter actually applies.
  const placeholder = { ...greet, start: q.length, end: q.length };
  const pre = {
    attention: async () => ({
      roots: [placeholder, greet, redCircle],
      ranked: [placeholder, greet, redCircle],
    }),
    guide,
  };
  const out = dec(await fuseAttention(m, q, primary, pre));
  assert.ok(
    !out.includes("reply-greet"),
    `a root whose continuation is already answered in the query must not fuse in, got "${out}"`,
  );
  assert.ok(
    out.includes("answer alpha"),
    `a genuine further topic with no embedded answer must still fuse in, got "${out}"`,
  );
  await m.store.close();
});

test("fuseAttention: ordinary multi-topic fusion (no embedded answers) is completely unaffected", async () => {
  const m = mk(1);
  await m.ingest(CORPUS);
  const q = enc("red then circle");
  const roots = await m.climbAttention(q, 24);
  assert.equal(roots.length, 1, "expected the single joint binding root");
  // Force a second, independent (unclimbed-style) inclusion path by
  // reusing the SAME root twice at different synthetic positions, neither
  // of which has an embedded answer — a pure regression check that the
  // new filter doesn't fire when there is nothing to catch.
  const guide = gistOf(m, q);
  const primary = enc("PRIMARYANCHORTEXT");
  const placeholder = { ...roots[0], start: q.length, end: q.length };
  const pre = {
    attention: async () => ({
      roots: [placeholder, roots[0]],
      ranked: [placeholder, roots[0]],
    }),
    guide,
  };
  const out = dec(await fuseAttention(m, q, primary, pre));
  assert.ok(
    out.includes("answer alpha"),
    `an ordinary further topic must still fuse in, got "${out}"`,
  );
  await m.store.close();
});
