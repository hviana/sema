// 91-branch-bytes-cache.test.mjs — reconstructing a node twice must not
// re-walk it.
//
// `bytesPrefix` rebuilds a node's bytes by descending the DAG, one `store.get`
// per node visited.  `_prefix` consults `_bytesCache` for EVERY id but used to
// populate it only for leaves, so a BRANCH re-walked its entire subtree on every
// request — and because the DAG is hash-consed, the same children recur under
// many different parents.
//
// MEASURED on the trained store (18,938,834 nodes), ONE 1,314-byte query:
//   _prefix calls (all levels) : 20,021,474
//   distinct ids               :    469,083   → 42.7x reuse
//   avoidable by a cache       : 19,552,391   → 97.7%
//   top-level calls            :     87,789 over 76,849 distinct (1.1x)
//   hottest id                 : a single-byte leaf, 2,599,984 reconstructions
//
// The 1.1x at the top level is why this hid for so long: measured there, reuse
// looks absent and a cache looks worthless.  All of the reuse is one level down.
//
// `_bytesCache` was already the right home — a byte-accounted BoundedMap with
// "smallest"/"clock" eviction, the configuration this codebase reserves for a
// TRANSPARENT cache (evicting costs a re-read and nothing else).  Reconstruction
// is a pure function of the store, so it qualifies; only the population was
// missing.
//
// WHAT THIS FILE ACTUALLY GUARDS — read this before trusting it.
//
// The re-walk assertion routes through `_prefix` (a CAPPED read), because that
// is where the fix lives.  `bytesPrefix(id, ALL)` short-circuits to `bytes()`
// (store.ts `bytesPrefix`: `maxLen >= 0x7fffffff → this.bytes(id)`), and
// `bytes()` has its OWN, pre-existing branch cache — so a re-walk assertion
// built on the ALL sentinel stays green when the `_prefix` fix is reverted and
// guards nothing (this file once did exactly that, and its header claimed the
// cause was "the node carries `flat` bytes", which is false: `flat` is
// STRUCTURAL — a branch stores its bytes flat iff every kid is an implicit
// single-byte leaf (store.ts `flatKidsBytes`) — and the fixture's node is
// non-flat, kids of real chunk nodes.  There is no size threshold that drops
// `flat`).
//
// With the fix, a capped read that completes the node caches the BRANCH
// (`got < maxLen` guard), so a second capped read is a full-cache hit and costs
// 0 node reads; with the fix reverted it re-reads the root (1 node read) because
// only the LEAVES are cached.  The signal is small at fixture scale precisely
// because the fixture's tree is shallow (root → flat chunks → leaves); the real
// 5.4–7.7× nodeRecords reduction is verified on the trained store instead.
//
// The TRUNCATION assertion at the end IS a real guard, verified red: with the
// `got < maxLen` condition removed, it fails with "a capped read poisoned the
// cache: the full read came back 29 bytes instead of 59".  That is the
// dangerous half of this fix — a truncated prefix served as a node's whole
// content would silently corrupt every later reader — so that is the half worth
// having a test for.
//
// The fix's real effect is verified on the trained store instead: identical
// answers and identical `bytesRead`/`byteReads`/`junctionPops`, with
// `nodeRecords` falling 1,182,651 → 218,449 · 2,462,577 → 321,794 ·
// 2,492,035 → 381,020 (5.4–7.7×), and the 1,314-byte query 14.0 s → 9.4 s.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { Meter } from "../dist/src/meter.js";

const ALL = 0x7fffffff;

test("a branch's bytes are reconstructed once, not re-walked", async () => {
  const store = new SQliteStore({ path: ":memory:", D: 256 });
  const mind = new Mind({ seed: 7, store });
  // Long deposits, so the nodes have real interior structure to re-walk.
  await mind.ingest([
    ["alpha", "the quick brown fox jumps over the lazy dog again and again"],
    // Shares the root's chunks but differs in length by more than a window,
    // so near dedup rejects it on LENGTH alone (`contentLen`, which never warms
    // `_bytesCache`) and the reconstruction below still starts cold.
    [
      "beta",
      "the quick brown fox jumps over the lazy cat again and again and again",
    ],
    ["gamma", "a quick brown fox once jumped over a lazy dog and then rested"],
  ]);

  // A branch node with interior structure — the deposit's own root.
  const tree = mind.perceive(
    "the quick brown fox jumps over the lazy dog again and again",
  );
  const id = mind.resolve(new TextEncoder().encode(
    "the quick brown fox jumps over the lazy dog again and again",
  ));
  assert.ok(id !== null, "the deposited form resolves to a stored node");
  assert.ok(tree.kids && tree.kids.length > 1, "and it has interior structure");

  // Route through `_prefix`, not `bytes()`: the ALL sentinel short-circuits to
  // `bytes()`, whose branch cache is pre-existing and would keep the assertion
  // green even with the `_prefix` fix reverted.  A capped read past the node's
  // full length completes the walk (so the branch gets cached, `got < maxLen`)
  // while staying off the ALL fast path.  `contentLen` warms `_recCache`/`_lenCache`
  // only, never `_bytesCache`, so the first read below starts cold.
  const fullLen = store.contentLen(id);
  store.meter = new Meter();
  const capped = fullLen + 1;

  // FIRST reconstruction — this one legitimately walks the subtree.
  const first = store.bytesPrefix(id, capped);
  const walked = store.meter.nodeRecords;
  assert.ok(
    first.length > 0,
    "the node reconstructs to bytes",
  );
  // NON-VACUITY: if the first read did no node reads either, the store answered
  // from some other cache and this test proves nothing about re-walking.
  assert.ok(
    walked > 0,
    `the first reconstruction did no node reads at all (nodeRecords=${walked}), ` +
      `so there is no re-walk for this test to detect`,
  );

  // SECOND reconstruction of the SAME node — must be free.
  const before = store.meter.nodeRecords;
  const second = store.bytesPrefix(id, capped);
  const again = store.meter.nodeRecords - before;

  console.log(
    `    first reconstruction: ${walked} node reads; second: ${again}`,
  );
  assert.deepEqual(second, first, "the cached bytes are the same bytes");
  assert.equal(
    again,
    0,
    `re-reading the same node cost ${again} node reads (the first cost ` +
      `${walked}) — reconstruction is a pure function of the store, so the ` +
      `second request must be served from _bytesCache, not re-walked`,
  );

  // AND a truncated read must never be cached AS the whole node: serving a
  // prefix as the full content would silently corrupt every later reader.
  const cut = Math.max(1, first.length >> 1);
  const store2 = new SQliteStore({ path: ":memory:", D: 256 });
  const mind2 = new Mind({ seed: 7, store: store2 });
  await mind2.ingest([[
    "alpha",
    "the quick brown fox jumps over the lazy dog again and again",
  ]]);
  const id2 = mind2.resolve(new TextEncoder().encode(
    "the quick brown fox jumps over the lazy dog again and again",
  ));
  store2.bytesPrefix(id2, cut); // truncated FIRST, so a bad cache would poison
  const whole = store2.bytesPrefix(id2, ALL);
  assert.equal(
    whole.length,
    first.length,
    `a capped read poisoned the cache: the full read came back ${whole.length} ` +
      `bytes instead of ${first.length}`,
  );

  await store.close();
  await store2.close();
});

test("a walk's cached parents never change what a later walk reaches", async () => {
  // The holders engine caches each node's parents and containers for the
  // session.  Cached by id alone, a list read under one walk's small fan was
  // handed, truncated, to a later walk with a larger one — so what a question
  // reached depended on what had been asked before it.  A cache may cost speed,
  // never reach (caches.md).
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const { holdersFrom } = await import("../dist/src/mind/junction.js");
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  const pairs = [];
  for (
    const p of [
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
      "foxtrot",
      "golf",
      "hotel",
    ]
  ) {
    pairs.push([`${p} squad holds the zorblax relay`, `${p} out`]);
  }
  await m.ingest(pairs);
  let seed = 0, most = 0;
  for (let id = 0; id < m.store.nodeCount(); id++) {
    const n = m.store.parentsFirst(id, 99).length;
    if (n > most) [most, seed] = [n, id];
  }
  const walk = (fan) =>
    holdersFrom(m, [seed], (_b, x) => x, {
      containers: true,
      order: "bfs",
      maxDepth: Infinity,
      maxBytes: Infinity,
      fan,
      hub: false,
      budget: { n: 1000 },
      limit: Infinity,
    }).found.length;
  const cold = { small: walk(2), large: walk(16) }; // no response: no cache
  assert.ok(cold.large > cold.small, "the fixture must tell the fans apart");
  m.beginResponse(undefined, null);
  const warm = { small: walk(2), large: walk(16) };
  m.endResponse(0);
  m.beginResponse(undefined, null);
  const later = { large: walk(16), small: walk(2) };
  m.endResponse(0);
  assert.deepEqual(warm, cold);
  assert.deepEqual(later, cold);
  await m.store.close();
});

test("a conversation's memos never outlive a write to the store", async () => {
  // The conversation keeps recognition and attention between turns, keyed by
  // bytes.  A deposit between two turns changes what those bytes recognise;
  // a memo that survived it answered the next turn from the store as it was.
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const { recognise } = await import("../dist/src/mind/recognition.js");
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([["what is ice?", "ice is frozen water"]]);
  const conv = m.beginConversation();
  await m.respondTurn(conv, "zorblax quantum?");
  await m.ingest([["zorblax quantum?", "a unit of nothing"]]);
  const bytes = new TextEncoder().encode("zorblax quantum?");
  const data = m._conversations.get(conv.id);
  m.beginResponse(undefined, null, data);
  const inConversation = recognise(m, bytes).sites.length;
  m.endResponse(0);
  m.beginResponse(undefined, null);
  const fresh = recognise(m, bytes).sites.length;
  m.endResponse(0);
  assert.ok(fresh > 0, "the deposit is recognised by a fresh response");
  assert.equal(inConversation, fresh);
  await m.store.close();
});

test("the hub-window memo is a cache of the store as it is", async () => {
  // Keyed by the bytes object alone, the hub reading of a buffer read before a
  // deposit was returned after it: what was rare stayed rare.
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const { hubWindows } = await import("../dist/src/mind/traverse.js");
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([["the zorb", "one"]]);
  const bytes = new TextEncoder().encode("the zorb");
  const before = [...hubWindows(m, bytes)];
  const pairs = [];
  for (let i = 0; i < 400; i++) pairs.push([`x${i} the zorb y${i}`, `r${i}`]);
  await m.ingest(pairs);
  const again = [...hubWindows(m, bytes)];
  const fresh = [...hubWindows(m, bytes.slice())];
  assert.notDeepEqual(fresh, before, "the deposit must change the reading");
  assert.deepEqual(again, fresh);
  await m.store.close();
});

test("a question's answer never depends on what the session asked before", async () => {
  // Every session cache — the reach, the derivations read off instances, the
  // walks, the picks — may only save work (caches.md): asked after any other
  // questions, in either order, each question gets the answer it gets alone.
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const facts = [
    ["Anne of Kiev", "father", "Yaroslav the Wise"],
    ["Anne of Kiev", "mother", "Ingegerd Olofsdotter"],
    ["Yaroslav the Wise", "father", "Vladimir the Great"],
    ["Yaroslav the Wise", "mother", "Rogneda of Polotsk"],
    ["Ingegerd Olofsdotter", "father", "Olof Skötkonung"],
    ["Ingegerd Olofsdotter", "mother", "Estrid of the Obotrites"],
    ["Henry of Navarre", "father", "Antoine of Navarre"],
    ["Antoine of Navarre", "mother", "Françoise d'Alençon"],
    ["Otto II", "father", "Otto the Great"],
    ["Otto the Great", "mother", "Matilda of Ringelheim"],
    ["Louis IX", "mother", "Blanche of Castile"],
    ["Blanche of Castile", "father", "Alfonso VIII of Castile"],
  ];
  const items = [];
  for (const [s, r, o] of facts) {
    const fact = `The ${r} of ${s} is ${o}.`;
    items.push([`${s} ${r}`, fact], [s, fact]);
  }
  items.push(
    [
      "Who is the paternal grandmother of Henry Of Navarre?",
      "The mother of Antoine of Navarre is Françoise d'Alençon.",
    ],
    [
      "Who is the paternal grandmother of Otto II?",
      "The mother of Otto the Great is Matilda of Ringelheim.",
    ],
    [
      "Who is the maternal grandfather of Louis IX?",
      "The father of Blanche of Castile is Alfonso VIII of Castile.",
    ],
  );
  const questions = [
    "Who is the paternal grandmother of Anne of Kiev?",
    "Who is the maternal grandfather of Anne of Kiev?",
    "Who is the father of Yaroslav the Wise?",
    "Who is the mother of anne of kiev?",
    "Who is the paternal grandmother of Otto II?",
    "Where was Anne of Kiev born?",
  ];
  const fresh = async () => {
    const m = new Mind({
      seed: 7,
      store: new SQliteStore({ path: ":memory:" }),
    });
    await m.ingest(items);
    await m.buildCanonIndex();
    return m;
  };
  const alone = [];
  for (const q of questions) {
    const m = await fresh();
    alone.push(await m.respondText(q));
    await m.store.close();
  }
  for (const order of [questions, [...questions].reverse()]) {
    const m = await fresh();
    const got = new Map();
    for (const q of order) got.set(q, await m.respondText(q));
    await m.store.close();
    assert.deepEqual(questions.map((q) => got.get(q)), alone);
  }
  assert.ok(alone.filter((a) => a !== "").length >= 3, "the world must answer");
});

test("a store trained under any cache budget is the same store", async () => {
  // Every store cache is an optimisation (caches.md): with each budget at its
  // minimum the store must hold the same nodes, edges, halos and index — a
  // pending gist evicted before its node became a target, an exact halo
  // accumulator evicted between two pours, or a pruning record evicted
  // mid-training must cost time and nothing else.
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const pairs = [];
  for (let i = 0; i < 40; i++) {
    pairs.push([
      `what does unit ${i % 7} of the zorblax relay ${i} hold?`,
      `relay ${i} holds part ${i % 5}`,
    ]);
    pairs.push([`relay ${i} part ${i % 5}`, `the zorblax relay ${i}`]);
  }
  const tiny = {
    pendingGistBytes: 1,
    haloCacheBytes: 1,
    coveredIdsMax: 1,
    dedupCacheMax: 1,
    bytesCacheMax: 1,
    recCacheBytes: 1,
    chainCacheBytes: 1,
  };
  const train = async (opts) => {
    const m = new Mind({
      seed: 7,
      store: new SQliteStore({ path: ":memory:", ...opts }),
    });
    for (const p of pairs) await m.ingest([p]);
    return m;
  };
  const a = await train({}), b = await train(tiny);
  const sa = a.store, sb = b.store;
  assert.equal(sb.nodeCount(), sa.nodeCount(), "nodes");
  assert.equal(
    sb.indexedVectorCount(),
    sa.indexedVectorCount(),
    "indexed gists",
  );
  for (let id = 0; id < sa.nodeCount(); id++) {
    assert.deepEqual(sb.next(id), sa.next(id), `edges of ${id}`);
    assert.equal(sb.haloMass(id), sa.haloMass(id), `halo mass of ${id}`);
    const ha = sa.halo(id), hb = sb.halo(id);
    assert.deepEqual(hb && [...hb], ha && [...ha], `halo of ${id}`);
  }
  await sa.close();
  await sb.close();
});

test("a mechanism's parse is kept for one response, never across a write", async () => {
  // The ALU's inverse of a symbol is the host's continuation of it — the
  // store's.  Kept for the Mind's life and keyed by the question's bytes, the
  // parse of a question asked before a deposit answered it after.
  const { aluMechanism } = await import("../dist/src/alu/src/mechanism.js");
  const { STRUCTURAL_HOST } = await import("../dist/src/alu/src/parser.js");
  let opposite = null;
  const mech = aluMechanism()({
    ...STRUCTURAL_HOST,
    continuation: async () => opposite,
    step: 1,
  });
  const q = new TextEncoder().encode("the opposite of hot");
  const dec = new TextDecoder();
  const before = await mech.run(null, q, {});
  opposite = new TextEncoder().encode("cold"); // a deposit between responses
  const after = await mech.run(null, q, {});
  assert.deepEqual(before.map((r) => dec.decode(r.bytes)), []);
  assert.deepEqual(after.map((r) => dec.decode(r.bytes)), ["cold"]);
});

test("the climb memo keys every input the climb reads", async () => {
  // A conversation keeps the climb between turns; the climb reads where the
  // current turn starts (an old pair cannot explain the new turn), so a climb
  // kept under one turn start is not another's.
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const { climbAttentionAll } = await import("../dist/src/mind/attention.js");
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["red", "is a color"],
    ["blue", "is a color"],
    ["circle", "is a shape"],
    ["square", "is a shape"],
    ["red circle", "answer alpha"],
    ["red square", "answer beta"],
    ["blue circle", "answer gamma"],
    ["blue square", "answer delta"],
  ]);
  const q = new TextEncoder().encode("tell me: red and also circle");
  const roots = (r) => r.roots.map((x) => x.anchor).join(",");
  const climb = async (start, memo) => {
    m.beginResponse(undefined, null);
    if (memo) m.climbMemo = memo;
    m.currentTurnStart = start;
    const r = roots(await climbAttentionAll(m, q, 24));
    m.endResponse(0);
    return r;
  };
  const cold = [await climb(q.length), await climb(0)];
  assert.notEqual(cold[0], cold[1], "the turn start must change the climb");
  const kept = new Map();
  assert.deepEqual([await climb(q.length, kept), await climb(0, kept)], cold);
  await m.store.close();
});

test("the bridge memo keys the question's guide it picks by", async () => {
  // Among several learnt wholes running two pieces together, the bridge picks
  // by the question's gist; a conversation's memo outlives one question, so a
  // pick kept under one guide is not another's.
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const { bridge } = await import("../dist/src/mind/resonance.js");
  const { gistOf } = await import("../dist/src/mind/primitives.js");
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    ["red big circle", "one"],
    ["red small circle", "two"],
    ["red", "c"],
    ["circle", "s"],
  ]);
  const enc = (s) => new TextEncoder().encode(s);
  const pick = async (guide, memo) => {
    m.beginResponse(undefined, null);
    if (memo) m.climbMemo = memo;
    m._edgeGuide = gistOf(m, enc(guide));
    const b = await bridge(m, enc("red"), enc("circle"));
    m.endResponse(0);
    return b === null ? null : new TextDecoder().decode(b);
  };
  const cold = [await pick("red big circle"), await pick("red small circle")];
  assert.notEqual(cold[0], cold[1], "the guide must change the pick");
  const kept = new Map();
  assert.deepEqual(
    [await pick("red big circle", kept), await pick("red small circle", kept)],
    cold,
  );
  await m.store.close();
});

test("a conversation's memos follow the reading of the turn", async () => {
  // A text turn is read under the text equivalence, a byte turn without it;
  // recognition kept from one is not the other's.
  const { Mind, SQliteStore, textCanon } = await import("../dist/src/index.js");
  const { recognise } = await import("../dist/src/mind/recognition.js");
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([["what is ice?", "ice is frozen water"]]);
  await m.buildCanonIndex();
  const conv = m.beginConversation();
  const data = m._conversations.get(conv.id);
  const q = new TextEncoder().encode("WHAT IS ICE?");
  const sites = (canon, conv) => {
    m.beginResponse(undefined, canon, conv);
    const n = recognise(m, q).sites.length;
    m.endResponse(0);
    return n;
  };
  const fresh = [sites(textCanon), sites(null)];
  assert.notEqual(
    fresh[0],
    fresh[1],
    "the equivalence must change recognition",
  );
  assert.deepEqual([sites(textCanon, data), sites(null, data)], fresh);
  await m.store.close();
});

test("a window's places are its distinct chunks, however the flushes fell", async () => {
  // Containment pages append per flush and dedup only when a merge reaches the
  // base page.  Past the 256-byte floor a small page does not fold into a big
  // base, so a (window, chunk) pair re-added in a later flush repeats in the
  // tail.  A page read off the raw rows then counted one place twice — and
  // whether it did depended on the flush cadence, a budget.
  const { SQliteStore } = await import("../dist/src/index.js");
  const read = async (batches) => {
    const s = new SQliteStore({ path: ":memory:" });
    await s.size();
    for (const batch of batches) {
      for (const p of batch) s.addContainer(1, p);
      s.commit();
    }
    // A buffered re-add rides the seam between stored and buffered pages.
    for (const p of batches[0].slice(0, 5)) s.addContainer(1, p);
    const all = s.containersSlice(1, 0, 1000);
    const tail = s.containersSlice(1, 190, 20);
    await s.close();
    return { all, tail };
  };
  const distinct = Array.from({ length: 200 }, (_, i) => 100 + i);
  const once = await read([distinct]);
  const again = await read([distinct, distinct.slice(0, 40)]);
  assert.equal(once.all.length, 200);
  assert.deepEqual(again.all, once.all);
  assert.deepEqual(again.tail, distinct.slice(190));
});

test("a reopened store answers as the session that wrote it", async () => {
  // The halo is its stored row.  An exact accumulator kept in memory beside it
  // answered "large" in the session that poured and "big" once the same store
  // was reopened: what a store says depended on whether a cache was warm.
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "sema-reopen-"));
  const path = join(dir, "s");
  try {
    let m = new Mind({ seed: 7, store: new SQliteStore({ path }) });
    await m.ingest([["big", "large"]]);
    await m.ingest(["ctx", "big"]);
    await m.ingest(["ctx", "large"]);
    const warm = await m.respondText("large");
    await m.store.close();
    m = new Mind({ seed: 7, store: new SQliteStore({ path }) });
    const cold = await m.respondText("large");
    await m.store.close();
    assert.equal(cold, warm);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a content-length hit records its use without rewriting the memo", async () => {
  // The near dedup asks lengths by the thousand per deposit.  Under exact-LRU
  // recency every hit was a Map delete + re-insert, measured at 32.8 ms of a
  // 141.5 ms deposit on a 40,000-row store (23%).  A length is a pure function
  // of the store, so the memo is transparent: a hit sets a use bit, and the
  // memo's order — what its eviction walks — stays as it was written.
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest("one deposit with a handful of chunks to measure");
  const s = m.store;
  const order = () => [...s._lenCache.m.keys()];
  const ids = order().filter((id) => id >= 0);
  assert.ok(ids.length > 2, "the deposit memoized its lengths");
  const before = order();
  // Hit them newest-first: under reordering recency that reverses the memo.
  for (const id of ids.reverse()) s.contentLen(id);
  assert.deepEqual(order(), before, "hits leave the memo's order untouched");
  await s.close();
});
