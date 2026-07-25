// 58-subquantum-sites.test.mjs — at hub scale, a recognised form shorter
// than one river window (W) is CHANCE, not evidence.
//
// recognition.emit is the single choke point every pass emits sites through
// (structural subtree, chunk sub-runs, canonical leaf-id chains, edge trims).
// Below W, byte overlap carries no identity information — the SAME quantum
// floor identityBar prices ("below one river window, byte overlap is chance")
// and the bridge's attestedQ applies ("spans shorter than W carry no window of
// their own and can never substitute"). No new constant.
//
// Scoped to hub scale by the same `atomsAreHubs` switch that already guards
// byte atoms, and for the same reason: on a SMALL store a two-byte fact is
// genuine learnt content and its site is essential; on a large one every short
// letter-run of every query becomes a "recognised form" that cover can hang an
// edge off. A span covering the WHOLE query is exempt — then it is not a
// coincidental fragment of something longer, it is the question.
//
// THE LIVE SHAPE (17.9M-node trained store): "In which country is the Eiffel
// Tower?" recognised the form "hi" — the i=0 sub-run of the fold chunk "hich"
// in "In w[hi]ch" — alongside "the" and "Eiffel Tower". The canonical pass's
// own comment already names this coincidence ('"hi" resolving out of
// "W[hi]ch"'). After this rule only "Eiffel Tower" survives.
//
// NOT claimed here: that removing those sites fixes that query. It does not —
// see bench/README.md. Cover still grounds a greeting there through a 2-byte
// span that does NOT come from `sites`. This test pins the site rule only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = () =>
  new Mind({ seed: 1, store: new SQliteStore({ path: ":memory:" }) });

const enc = new TextEncoder();

test("1. a sub-quantum coincidental substring is not a recognised site", async () => {
  const mind = mk();
  await mind.ingest([
    ["hi", " Hello there, how can I help?"],
    ["What is the capital of France?", " The capital of France is Paris."],
    ["What is the capital of Spain?", " The capital of Spain is Madrid."],
    ["What is the capital of Italy?", " The capital of Italy is Rome."],
  ]);
  const { recognise } = await import("../dist/src/mind/recognition.js");
  const { atomIsHub, corpusN } = await import("../dist/src/mind/traverse.js");
  const N = corpusN(mind);
  const W = mind.space.maxGroup;
  if (!atomIsHub(mind, N)) {
    // Below hub scale the rule is deliberately inert — nothing to assert.
    await mind.store.close();
    return;
  }
  // "which" contains "hi" at an interior offset.
  const q = enc.encode("In which country is the capital of France?");
  const sites = recognise(mind, q).sites;
  for (const s of sites) {
    assert.ok(
      s.end - s.start >= W || (s.start === 0 && s.end === q.length),
      `sub-quantum site ${
        JSON.stringify(
          new TextDecoder().decode(q.subarray(s.start, s.end)),
        )
      } survived at hub scale`,
    );
  }
  await mind.store.close();
});

test("2. a whole-query short form is EXEMPT — it is the question", async () => {
  const mind = mk();
  await mind.ingest([
    ["hi", " Hello there, how can I help?"],
    ["What is the capital of France?", " The capital of France is Paris."],
    ["What is the capital of Spain?", " The capital of Spain is Madrid."],
  ]);
  const a = await mind.respondText("hi");
  assert.match(
    a,
    /Hello there/,
    "a short form that IS the whole query must still be answerable",
  );
  await mind.store.close();
});

test("3. long forms are untouched", async () => {
  const mind = mk();
  await mind.ingest([
    ["What is the capital of France?", " The capital of France is Paris."],
    ["What is the capital of Spain?", " The capital of Spain is Madrid."],
  ]);
  assert.match(
    await mind.respondText("What is the capital of France?"),
    /Paris/,
  );
  await mind.store.close();
});

test("4. determinism", async () => {
  const run = async () => {
    const m = mk();
    await m.ingest([
      ["hi", " Hello there, how can I help?"],
      ["What is the capital of France?", " The capital of France is Paris."],
    ]);
    const a = await m.respondText("In which country is Paris?");
    await m.store.close();
    return a;
  };
  assert.equal(await run(), await run());
});
