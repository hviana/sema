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
  // Roots are identified by the ANCHOR they climbed to, never by the query
  // offset of the region that got there: which region wins the climb is a
  // property of the evidence, and the fold's cuts are content-defined, so an
  // offset test would be asserting where a cut happened to fall.  (It did:
  // this once read `r.start === 0`, and passed only while the region reaching
  // `greet` began at byte 0 — it now begins at 6, on the same anchor.)
  const anchorOf = (r) => dec(m.store.bytesPrefix(r.anchor, 1e9));
  const greet = roots.find((r) => anchorOf(r) === "greet");
  const redCircle = roots.find((r) => anchorOf(r) === "red circle");
  assert.ok(greet, "expected a root anchored on 'greet'");
  assert.ok(redCircle, "expected the 'red circle' binding root");

  const guide = gistOf(m, q);
  const primary = enc("PRIMARYANCHORTEXT");
  // Primary stands on `-greet` [11,17): a further topic is the run around its
  // point that primary did not price, answered by the market — `greet reply`
  // would be answered `reply-greet` were the gate not to refuse it, and
  // ` then red then circle` is answered `answer alpha`.
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
  // fusion consumes and returns the derivation STATE; these cases exercise the
  // mechanism's own gates, so the state is the minimum one for them.
  const out = dec(
    (await fuseAttention(
      m,
      q,
      {
        product: primary,
        accounted: [[11, 17]],
        remainder: [],
        cost: 0,
      },
      pre,
      [[11, 17]],
    )).product,
  );
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
  // Primary stands on `so on` [19,25), leaving the binding its own run.
  const q = enc("red then circle and so on");
  const roots = await m.climbAttention(q, 24);
  assert.ok(roots.length >= 1, "expected the joint binding root");
  // Force a second, independent inclusion path by
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
  // fusion consumes and returns the derivation STATE; these cases exercise the
  // mechanism's own gates, so the state is the minimum one for them.
  const out = dec(
    (await fuseAttention(
      m,
      q,
      {
        product: primary,
        accounted: [[19, 25]],
        remainder: [],
        cost: 0,
      },
      pre,
      [[19, 25]],
    )).product,
  );
  assert.ok(
    out.includes("answer alpha"),
    `an ordinary further topic must still fuse in, got "${out}"`,
  );
  await m.store.close();
});

test("fuseAttention: a confined point whose strongest evidence is below one window is no further topic", async () => {
  // Measured on the 2Wiki fixture with inference questions: the region `)?`
  // closing `… film Kathputli (1971 Film)?` voted, rarely and so heavily, for a
  // stored `Who is the uncle of Auberon Herbert (Landowner)?`, and the fusion
  // appended that question's answer.  Below one window byte identity is not
  // evidence (attention.ts); the point also shares `the ` and ` of ` with the
  // question in several places, so counting shared places alone admitted it.
  const m = mk(1);
  await m.ingest([
    ["Kathputli", "The director of Kathputli is Brij."],
    [
      "Who is the uncle of Auberon Herbert (Landowner)?",
      "The sibling of Aubrey Herbert is George Herbert.",
    ],
    // What the market answers for the point's run: both points below stand
    // in that one run, so the window is the only thing that differs.
    ["(1971 Film)?", "A film of 1971."],
  ]);
  const q = enc(
    "Where was the place of death of the director of film Kathputli (1971 Film)?",
  );
  // Primary priced the question up to `Kathputli`; the point's run is the
  // close, ` (1971 Film)?`.
  const KATHPUTLI = new TextDecoder().decode(q).indexOf(" (1971");
  const uncle = m.resolve(
    enc("Who is the uncle of Auberon Herbert (Landowner)?"),
  );
  assert.ok(uncle !== null, "the stored question resolves");
  const guide = gistOf(m, q);
  const point = (start, end) => ({
    anchor: uncle,
    vote: 7.8,
    peak: 7.8,
    idfVote: 7.8,
    start,
    end,
    breadth: 0.04,
    clusters: 1,
  });
  const fuse = async (root) => {
    const placeholder = { ...root, start: q.length, end: q.length };
    const pre = {
      attention: async () => ({
        roots: [placeholder, root],
        ranked: [placeholder, root],
      }),
      guide,
    };
    return dec(
      (await fuseAttention(
        m,
        q,
        {
          product: enc("The director of Kathputli is Brij."),
          accounted: [[0, KATHPUTLI]],
          remainder: [],
          cost: 0,
        },
        pre,
        [[0, KATHPUTLI]],
      )).product,
    );
  };
  const below = await fuse(point(q.length - 2, q.length));
  assert.ok(
    !below.includes("1971."),
    `a point whose strongest evidence is \`)?\` must not fuse in, got "${below}"`,
  );
  // The same point with a window of evidence is judged by the other measures.
  const window = await fuse(point(q.length - 6, q.length));
  assert.ok(
    window.includes("1971."),
    `the control fuses, so the window is what decided, got "${window}"`,
  );
  await m.store.close();
});
