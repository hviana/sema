// 42-recognise-trace-idempotence.test.mjs — recognise() (and, by the same
// defect, climbAttentionAll()) must return the SAME result whether or not
// inspectRationale is attached — tracing must never change what the
// system decides, only whether it explains itself.
//
// Traced live (analyze_training.ts): the same 4-turn dialogue produced a
// DIFFERENT final answer depending only on whether inspectRationale was
// attached to the last turn — a deterministic, reproducible divergence,
// not cross-process randomness (verified: 5 untraced runs, byte-identical;
// traced vs untraced, consistently different).
//
// Root cause, isolated directly: recogniseImpl walks the query's perceived
// tree via foldTree(ctx, tree, 0, visit) — and foldTree's subtree-resolution
// fast path (primitives.ts) returns immediately for any subtree already
// cached in ctx._resolvedSubtrees, WITHOUT recursing into its children, so
// `visit` never fires for anything below that point.  A multi-turn
// conversation's stable-prefix fold deliberately shares node OBJECTS
// across turns and within a turn's own walk, so by a SECOND call on the
// exact same bytes, large parts of the tree are already cached and
// recogniseImpl silently finds FEWER sites than the first call — it is not
// safe to call twice on the same input once `_resolvedSubtrees` is warm.
//
// Under ordinary (untraced) operation this never surfaces: recogniseMemo
// (keyed by exact byte content) ensures recogniseImpl only ever runs ONCE
// per distinct query string per conversation.  But the memo was previously
// SKIPPED whenever `ctx.trace` was truthy ("so every call still emits its
// rationale step") — meaning a traced turn re-ran recogniseImpl from
// scratch at every one of the many call sites that recognise the same
// query within one response (cover, reason, articulate...), each
// subsequent call more incomplete than the last, silently changing which
// mechanism grounds the answer.  Fix: consult (and populate) the memo
// unconditionally — matching perceive()'s own memo, which never had a
// trace gate — and emit the trace step from the cache-hit path directly,
// so tracing stays fully observable without ever bypassing correctness.
// climbAttentionAll() had the identical `!ctx.trace` gate over the same
// class of foldTree-based computation (collectRegions) and got the same
// fix, on the same reasoning, in the same change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { recognise } from "../dist/src/mind/recognition.js";

const enc = (s) => new TextEncoder().encode(s);

test("recognise(): a traced call returns the identical cached result, not a degraded recompute", async () => {
  const m = new Mind({ seed: 7 });
  // A long, deeply-chunked query (enough leaf-parents for foldTree's
  // subtree cache to matter) that also recurs as a learnt SOURCE, so its
  // own subtree — and many of its word-level sub-leaves — resolve and get
  // cached into ctx._resolvedSubtrees on the first walk.
  const words = [
    "hello",
    "world",
    "foo",
    "bar",
    "baz",
    "qux",
    "quux",
    "corge",
    "grault",
    "garply",
    "waldo",
    "fred",
    "plugh",
    "xyzzy",
    "thud",
  ];
  const long = words.join(" ") + " " + words.slice().reverse().join(" ");
  await m.ingest([
    [long, "some reply text here"],
    ...words.map((w, i) => [w, `word ${i}`]),
  ]);

  // _resolvedSubtrees is only ever populated during respondTurn's
  // conversation machinery (a plain respond() leaves it null, immune to
  // this defect) — reproduce that shape directly for a controlled,
  // deterministic unit test.
  m.perceiveMemo = new Map();
  m.recogniseMemo = new Map();
  m._resolvedSubtrees = new WeakMap();
  m.trace = null;

  const bytes = enc(long);
  const untraced = recognise(m, bytes);
  assert.ok(
    untraced.sites.length > 0,
    "sanity: the untraced call must find sites",
  );

  m.trace = { enter: () => undefined, step: () => undefined };
  const traced = recognise(m, bytes);

  assert.equal(
    traced,
    untraced,
    "a traced call must return the SAME cached Recognition object, not " +
      "recompute (and potentially degrade) it",
  );
  assert.equal(
    traced.sites.length,
    untraced.sites.length,
    `traced and untraced site counts must match, got ${traced.sites.length} ` +
      `vs ${untraced.sites.length}`,
  );
});
