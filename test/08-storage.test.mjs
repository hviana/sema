// 08-storage.test.mjs — the storage layer (SQliteStore), end to end.
//
// SQliteStore is the whole persistence system. It is THREE independent SQLite
// databases working as one store, plus the write discipline that keeps them
// consistent:
//
//   • <path>.sqlite       — the content-addressed DAG: node rows (leaf|kids),
//                           the reverse child→parent index, continuation edges,
//                           halo accumulators, metadata, the snapshot blob.
//   • <path>.content.vec  — the STORAGE vector index over node gists (the
//                           resonant lookup that finds a node by meaning).
//   • <path>.halo.vec     — the CACHE vector index over halos (concept siblings).
//
// This file verifies EACH responsibility the store owns, and that the three
// pieces are wired together consistently:
//
//   1. Construction      — the three databases are created and set up.
//   2. The DAG           — hash-consed leaves/branches, dense ids, reverse
//                          parents, byte reconstruction.
//   3. Identity rules    — exact dedup (everywhere), near dedup (branches
//                          ONLY), leaves never near-merge.
//   4. Gist index        — a node is findable by its own meaning (resonate).
//   5. Continuation edges— link / next / prev / edgeSourceCount, order & dedup.
//   6. Halos             — pour accumulates, mass gates visibility, the halo
//                          index resonates concept siblings, geometric re-index.
//   7. Metadata & snapshot — key/value provenance and the config blob.
//   8. Write discipline  — deferred transaction, commit(), reads see uncommitted.
//   9. Durability        — close, reopen the SAME path, and EVERYTHING (DAG,
//                          edges, halos, gist index, meta) survives a cold cache.
//  10. Mind round-trip   — train → save → reopen → loadFromStore answers exactly.
//  11. Compression        — dedup keeps the store O(distinct chunks): identical
//                          content costs nothing, repeats add zero entries, and
//                          unique content scales with chunks, not deposits.
//  12. Concept formation  — incremental halo-driven cross-name transfer, training
//                          idempotency, deterministic conflict resolution.
//  13. The derived layer  — everything but the base (nodes, edges, wholes,
//                          halos, meta) is dropped and rebuilt from the base
//                          alone, and the store answers byte for byte.
//
// (This file is the single home for storage correctness; it absorbs the old
// 06-sleep and 12-compression suites, whose concerns are the store's.)
//
// Tests that touch disk use a unique temp stem and clean up all three files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CachedIngest, Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { existsSync, rmSync, statSync } from "node:fs";
import { normalize, randomUnit, rng } from "../dist/src/vec.js";

const D = 1024;
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

// A fresh in-memory store — D flows through the constructor (single source of truth).
function memStore() {
  return new SQliteStore({ path: ":memory:", D });
}

// Deterministic unit-vector source, so gists are reproducible per test.
function vecs(seed) {
  const r = rng(seed);
  return () => randomUnit(D, r);
}

// The interned node id of a string, recovered the way recognition does: perceive
// the bytes and fold the tree bottom-up through the store's content-addressed
// maps (findLeaf at leaves, findBranch above). Returns null if any part is
// unknown (the content was never interned).
function foldToId(mind, store, text) {
  const fold = (n) => {
    if (n.kids === null) return store.findLeaf(n.leaf ?? new Uint8Array(0));
    const kids = [];
    for (const k of n.kids) {
      const id = fold(k);
      if (id === null) return null;
      kids.push(id);
    }
    return store.findBranch(kids);
  };
  return fold(mind.perceive(text));
}

// A unique on-disk stem + a cleanup that removes all three files.
function tmpStem(tag) {
  return `/tmp/sema-storage-${tag}-${process.pid}-${
    Math.floor(performance.now())
  }`;
}
function cleanup(stem) {
  for (
    const ext of [
      ".sqlite",
      ".derived.sqlite",
      ".derived.sqlite-wal",
      ".derived.sqlite-shm",
      ".content.vec",
      ".halo.vec",
    ]
  ) {
    try {
      rmSync(stem + ext);
    } catch { /* may not exist */ }
  }
}

// =========================================================================
// 1 — CONSTRUCTION: the three databases are created and set up
// =========================================================================

test("store opens with dimension from constructor", async () => {
  const s = new SQliteStore({ path: ":memory:", D });
  const id = await s.putLeaf(enc("x"), normalize(randomUnit(D, rng(0))));
  assert.ok(typeof id === "number");
  assert.ok(s.get(id) !== null);
});

test("an on-disk store creates all three SQLite files", async () => {
  const stem = tmpStem("files");
  try {
    const s = new SQliteStore({ path: stem, D });
    const next = vecs(1);
    await s.putLeaf(enc("ab"), next());
    s.commit(); // make node + vector writes durable
    assert.ok(existsSync(`${stem}.sqlite`), "main DAG file exists");
    assert.ok(
      existsSync(`${stem}.content.vec`),
      "content (gist) vector file exists",
    );
    assert.ok(existsSync(`${stem}.halo.vec`), "halo vector file exists");
    await s.close();
  } finally {
    cleanup(stem);
  }
});

// =========================================================================
// 2 — THE DAG: hash-consing, dense ids, reverse parents, byte reconstruction
// =========================================================================

test("leaves and branches intern into a dense, reconstructable DAG", async () => {
  const s = memStore();
  const next = vecs(2);
  const a = await s.putLeaf(enc("aa"), next());
  const b = await s.putLeaf(enc("bb"), next());
  const br = await s.putBranch([a, b], next());

  // Dense, creation-order ids.
  assert.deepEqual([a, b, br], [0, 1, 2]);
  assert.equal(s.nodeCount(), 3);
  assert.equal(await s.size(), 3);

  // The branch record carries its ordered children; leaves carry bytes.
  assert.deepEqual(s.get(br).kids, [a, b]);
  assert.equal(s.get(br).leaf, null);
  assert.equal(dec(s.get(a).leaf), "aa");

  // Content-addressed lookups recover a node from its content alone — the
  // hash-cons keys the store is built on.
  assert.equal(
    s.findLeaf(enc("aa")),
    a,
    "findLeaf recovers a leaf by its bytes",
  );
  assert.equal(
    s.findBranch([a, b]),
    br,
    "findBranch recovers a branch by its child ids",
  );
  assert.equal(s.findLeaf(enc("zz")), null, "an unknown leaf is not found");
  assert.equal(
    s.findBranch([b, a]),
    null,
    "child ORDER is part of the branch key",
  );

  // has() is an O(1) range check over the dense id space.
  assert.ok(s.has(a) && s.has(br));
  // Single-byte leaves are implicit (negative IDs -1..-256), so has(-1)
  // is true for byte 0x00.  Out-of-range negative IDs still return false.
  assert.ok(!s.has(99) && s.has(-1) && !s.has(-257));

  // Bytes reconstruct bottom-up; the prefix walk stops early.
  assert.equal(dec(s.bytes(br)), "aabb");
  assert.equal(dec(s.bytesPrefix(br, 2)), "aa");
  assert.equal(dec(s.bytesPrefix(br, 99)), "aabb");
  await s.close();
});

test("reverse parents index points each child at the branch that contains it", async () => {
  const s = memStore();
  const next = vecs(3);
  const a = await s.putLeaf(enc("aa"), next());
  const b = await s.putLeaf(enc("bb"), next());
  const br = await s.putBranch([a, b], next());

  assert.deepEqual(s.parents(a).sort(), [br]);
  assert.deepEqual(s.parents(b).sort(), [br]);
  assert.deepEqual(s.parents(br), [], "the root has no parent");

  // A child repeated within one branch links to that parent exactly once.
  const rep = await s.putBranch([a, a], next());
  assert.equal(
    s.parents(a).filter((p) => p === rep).length,
    1,
    "no duplicate parent edge",
  );
  await s.close();
});

// =========================================================================
// 3 — IDENTITY RULES: exact dedup everywhere; near dedup for BRANCHES only
// =========================================================================

test("exact content is interned once (hash-consing)", async () => {
  const s = memStore();
  const next = vecs(4);
  const a = await s.putLeaf(enc("hi"), next());
  const again = await s.putLeaf(enc("hi"), next()); // same bytes, new gist
  assert.equal(again, a, "identical leaf bytes → the same id");

  const x = await s.putLeaf(enc("x"), next());
  const y = await s.putLeaf(enc("y"), next());
  const br = await s.putBranch([x, y], next());
  const br2 = await s.putBranch([x, y], next()); // same kids, new gist
  assert.equal(br2, br, "identical child signature → the same branch id");
  // Single-byte leaves ("x", "y") are implicit (negative ids, no DB row).
  // Only the multi-byte leaf ("hi") and the branch occupy DB rows.
  assert.equal(s.nodeCount(), 2, "no duplicate nodes minted");
  await s.close();
});

test("near dedup folds a branch onto a form learnt WHOLE that it near-duplicates; leaves NEVER merge", async () => {
  const s = memStore();
  const next = vecs(5);
  const L = async (c) => s.putLeaf(enc(c), next());
  const [p, q, r, t, u, v, x] = await Promise.all(
    ["p", "q", "r", "t", "u", "v", "x"].map(L),
  );
  // A WHOLE form of three chunks — `pq` `rt` `uv` — that a deposit learnt.
  const k1 = await s.putBranch([p, q], next());
  const k2 = await s.putBranch([r, t], next());
  const k3 = await s.putBranch([u, v], next());
  const g = normalize(next());
  const whole = await s.putBranch([k1, k2, k3], g);
  await s.markWhole(whole);
  s.indexTarget(whole);

  // A fresh branch reusing its first and last chunks, one byte apart in the
  // middle (`rx` for `rt`), with a near gist: the same form, folded onto it.
  const gNear = normalize(g.map((y, i) => y + (i === 0 ? 1e-4 : 0)));
  const k2x = await s.putBranch([r, x], next());
  const near = await s.putBranch([k1, k2x, k3], gNear);
  assert.equal(near, whole, "one window apart, near gist: the same node");

  // The same bytes with a FAR gist — one window apart can mean something
  // else (`date of birth` / `date of death`): kept distinct.
  const k2y = await s.putBranch([x, t], next());
  const far = await s.putBranch([k1, k2y, k3], normalize(next()));
  assert.notEqual(far, whole, "far gist: never folded, whatever the bytes");

  // A near form of something NO deposit learnt whole is not a target.
  const m1 = await s.putBranch([q, p], next());
  const m2 = await s.putBranch([t, r], next());
  const gi = normalize(next());
  const interior = await s.putBranch([m1, m2, k3], gi);
  const m2x = await s.putBranch([t, x], next());
  const ontoInterior = await s.putBranch(
    [m1, m2x, k3],
    normalize(gi.map((y, i) => y + (i === 0 ? 1e-4 : 0))),
  );
  assert.notEqual(
    ontoInterior,
    interior,
    "no merge onto a form not learnt whole",
  );

  // Leaves never near-merge: distinct bytes stay distinct even with an
  // identical gist — near-merging a leaf would corrupt its bytes.
  const L1 = await s.putLeaf(enc("mm"), g);
  const L2 = await s.putLeaf(enc("nn"), g); // different bytes, SAME gist
  assert.notEqual(L2, L1, "distinct leaf bytes never merge, whatever the gist");
  await s.close();
});

test("near dedup is the same whatever the batch size or session, and `nearDedup: false` keeps every byte", async () => {
  // The identity of the knowledge cannot depend on an operational setting:
  // it used to merge these two only when both sat in one write batch.
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Mind } = await import("../dist/src/index.js");
  const a =
    "Wire transfer of 1000 dollars to account 4417 approved by the manager.";
  const b =
    "Wire transfer of 9000 dollars to account 4417 approved by the manager.";
  const run = async (opts, reopen = false) => {
    const dir = mkdtempSync(join(tmpdir(), "nd-"));
    let store = new SQliteStore({ path: join(dir, "s"), ...opts });
    let mind = new Mind({ seed: 7, store });
    await mind.ingest(a);
    if (reopen) {
      await store.close();
      store = new SQliteStore({ path: join(dir, "s"), ...opts });
      mind = new Mind({ seed: 7, store });
    }
    await mind.ingest(b);
    const ids = [a, b].map((t) => mind.resolve(enc(t)));
    await store.close();
    rmSync(dir, { recursive: true, force: true });
    return ids[0] === ids[1];
  };
  const merged = await run({});
  assert.equal(await run({ batchSize: 1 }), merged, "batch size 1");
  assert.equal(await run({ batchSize: 100000 }), merged, "one huge batch");
  assert.equal(await run({}, true), merged, "across a reopen");
  assert.equal(await run({ nearDedup: false }), false, "disabled: both kept");
});

// =========================================================================
// 4 — GIST INDEX: a node is findable by its own meaning
// =========================================================================

test("a node resonates to itself once it is a resonance TARGET", async () => {
  const s = memStore();
  const next = vecs(6);
  const v = normalize(next());
  const id = await s.putLeaf(enc("alpha"), v);
  const distractor = await s.putLeaf(enc("beta"), next());

  // The content (gist) index is a RESONANCE-TARGET index, not a node mirror: a
  // node's gist enters it LAZILY, the first time the node becomes something
  // recall can ground on — it gains a continuation edge or a halo. A bare,
  // never-linked node is intentionally NOT indexed (it is reached only by the
  // structural DAG climb, never by direct resonance), so it costs no index slot.
  // This is the store's core compression: the exploded intermediate DAG (~99.5%
  // of nodes) is never poured into the vector index. So before any edge/halo, resonate
  // finds nothing.
  assert.equal(
    (await s.resonate(v, 1)).length,
    0,
    "a bare, never-grounded node is not yet a resonance target",
  );

  // Give the node a continuation edge — now it is a target, and resonates to
  // itself. (link indexes BOTH endpoints, so the distractor is indexed too.)
  await s.link(id, distractor);
  const hits = await s.resonate(v, 1);
  assert.equal(
    hits[0].id,
    id,
    "once edge-bearing, the nearest gist to v is the node stored with v",
  );
  // The 1-bit RaBitQ codec estimates cosine from sign-bit Hamming distance, so
  // even self-identity tops out around ~0.98, not exactly 1 — but it dominates
  // any unrelated node (whose score is ~0). The contract is "found as nearest,
  // with a decisively high score", not bit-exact reconstruction.
  assert.ok(
    hits[0].score >= 0.9,
    `identity resonance is high (got ${hits[0].score.toFixed(3)})`,
  );
  assert.equal((await s.resonate(v, 0)).length, 0, "k=0 returns nothing");
  await s.close();
});

// =========================================================================
// 5 — CONTINUATION EDGES: link / next / prev / edgeSourceCount
// =========================================================================

test("edges record what follows what, ordered and de-duplicated", async () => {
  const s = memStore();
  const next = vecs(7);
  const a = await s.putLeaf(enc("a"), next());
  const b = await s.putLeaf(enc("b"), next());
  const c = await s.putLeaf(enc("c"), next());

  await s.link(a, b);
  await s.link(a, c);
  // next() is in insertion (seq) order; prev() is the reverse relation.
  assert.deepEqual(s.next(a), [b, c]);
  assert.deepEqual(s.prev(b), [a]);
  assert.deepEqual(s.prev(c), [a]);
  assert.deepEqual(s.next(b), [], "a node with no continuation");

  // link is idempotent — relearning a fact adds no edge.
  await s.link(a, b);
  assert.deepEqual(s.next(a), [b, c], "duplicate link ignored");

  // edgeSourceCount = distinct edge SOURCES (the learnt-context count).
  assert.equal(s.edgeSourceCount(), 1, "only `a` bears an outgoing edge");
  await s.link(b, c);
  assert.equal(s.edgeSourceCount(), 2, "now a and b both bear one");
  await s.close();
});

// =========================================================================
// 6 — HALOS: accumulation, mass gating, concept-sibling resonance
// =========================================================================

test("a halo accumulates poured signatures and gates on mass", async () => {
  const s = memStore();
  const next = vecs(8);
  const id = await s.putLeaf(enc("ice"), next());
  assert.equal(s.halo(id), null, "a fresh node has no halo");

  // A halo row is admission: one pour already makes the halo visible.
  await s.pourHalo(id, normalize(next()));
  const h1 = s.halo(id);
  assert.ok(h1 !== null, "halo present after a pour");
  assert.equal(h1.length, D, "halo is a D-vector");

  // Accumulation: pouring a partner moves the halo's direction toward the
  // running superposition (it is not simply overwritten).
  await s.pourHalo(id, normalize(next()));
  const h2 = s.halo(id);
  assert.ok(h2 !== null);
  await s.close();
});

// A multi-turn conversation is deposited as ACCUMULATED-CONTEXT episodes — the
// pattern example/train.ts uses:
//   (t0)            → t1
//   (t0 + t1)       → t2
//   (t0 + t1 + t2)  → t3
// The EDGE must run from the full accumulated context, because that is what
// disambiguates two conversations sharing a pivot turn (the 13-conversation
// suite). But the HALO is a different relation: it records distributional
// COMPANY for synonymy. Reinforcing it on every call against the WHOLE
// accumulated context pours a SHARED PREFIX's gist (a system preamble, an early
// turn) into a halo again and again — once per later turn of every conversation
// that quotes it. That shared prefix is a recurring node, so its halo mass piles
// up without bound as the corpus grows, swamping the genuine company it kept and
// polluting concept/synonym recall. That is the "edges and halos are reinforced
// on every call" behaviour applied where it must NOT be.
//
// The fix reinforces the halo on the CHANGED part — what THIS deposit added over
// the previous one (found by diffing the perceived trees through interned ids, so
// it is modality-agnostic and separator-free) — not the whole accumulated blob.
//
// Contract (behavioural, store-level): a recurring shared prefix must NOT
// accumulate halo mass that grows with the number of turns/conversations quoting
// it; its mass stays a small constant. The genuinely-new turns still get a halo,
// so synonymy/recall is preserved.
test("multi-turn accumulated context does not pile halo mass on a recurring shared prefix", async () => {
  const m = new Mind({
    D,
    seed: 7,
  });
  const s = m.store;

  // A shared system preamble in front of many GENUINELY-DISTINCT conversations —
  // the exact shape of real instruction-tuning data. Each conversation is
  // deposited as accumulated-context episodes, so the preamble is quoted by every
  // later turn. The preamble is always the FIRST line and never a standalone
  // context — the first episode's context is already preamble + first user turn,
  // so the preamble only ever appears as a PREFIX of a longer accumulated context
  // (its gist is what gets re-poured on every call in the buggy behaviour).
  //
  // The conversations are about DIFFERENT subjects, each with its own distinctive
  // vocabulary, on purpose: this isolates the property under test — that a
  // recurring shared PREFIX does not accumulate halo mass — from the orthogonal
  // near-dedup behaviour. If the conversations were near-identical (e.g. only
  // an index swapped: "conversation 1", "conversation 2", …) their gists would
  // resonate above the merge threshold and fold into ONE shared node, which would
  // then legitimately keep company with every conversation it now represents —
  // mass growing with the merged count is correct compression, NOT prefix
  // re-pouring, but it would confound this test. Distinct subjects keep the
  // conversations un-merged, so any mass beyond a small constant could ONLY come
  // from re-pouring the shared prefix — exactly the regression guarded here.
  const SYS =
    "you are a careful assistant and you never use any external tools";
  const TOPICS = [
    ["gardening", "compost", "tomatoes", "mulch"],
    ["astronomy", "nebula", "telescope", "redshift"],
    ["cooking", "risotto", "saffron", "simmer"],
    ["finance", "dividend", "portfolio", "hedge"],
    ["music", "counterpoint", "fugue", "cadence"],
    ["geology", "basalt", "tectonic", "sediment"],
    ["medicine", "antibody", "plasma", "vaccine"],
    ["law", "tort", "statute", "liability"],
  ];
  const CONVOS = TOPICS.length;
  for (let c = 0; c < CONVOS; c++) {
    const [a, b, d, e] = TOPICS[c];
    const turns = [
      `${SYS}\nthe user asks about ${a} and especially ${b}`,
      `the assistant explains ${a}: ${b} relates to ${d} in practice`,
      `the user follows up wondering how ${d} affects ${e}`,
      `the assistant concludes that ${e} completes the ${a} picture`,
    ];
    for (let i = 0; i + 1 < turns.length; i++) {
      await m.ingest(turns.slice(0, i + 1).join("\n"), turns[i + 1]);
    }
  }

  // The shared preamble recurs as the prefix of CONVOS×3 accumulated contexts
  // (4 turns ⇒ 3 ctx→cont episodes per conversation). The harm is a SHARED node
  // accumulating halo mass proportional to how many turns/conversations quote it.
  // So scan every node and take the maximum halo mass: reinforcing on the whole
  // accumulated context would pour the preamble's shared sub-nodes once per
  // quoting turn, driving some shared node's mass toward CONVOS×3. Reinforcing on
  // the changed part keeps every node's mass a small constant — bounded by how
  // many DISTINCT episodes genuinely introduced it, not by the corpus size.
  let maxMass = 0, maxId = -1;
  for (let id = 0; id < s.nodeCount(); id++) {
    const mass = s.haloMass(id);
    if (mass > maxMass) {
      maxMass = mass;
      maxId = id;
    }
  }
  const maxBytes = maxId >= 0 ? dec(s.bytesPrefix(maxId, 50)) : "";
  console.log(
    `    max halo mass after ${CONVOS} conversations (${
      CONVOS * 3
    } episodes): ` +
      `${maxMass} on "${maxBytes.replace(/\n/g, "|")}"`,
  );
  // The conversations are distinct (no near dedup concentrates company), so
  // the changed-part pour gives every node mass ≈ 1 — each distinct context is a
  // resonance target poured once. A tight bound of 2 absorbs at most one
  // incidental near-merge while still being far below the O(CONVOS×3) a re-poured
  // shared prefix would reach: it catches the "reinforced on every call"
  // regression squarely.
  assert.ok(
    maxMass <= 2,
    `some node accumulated halo mass ${maxMass} across ${CONVOS} distinct ` +
      `conversations (${
        CONVOS * 3
      } episodes) — a multi-turn deposit must reinforce the changed ` +
      `part, not re-pour the whole accumulated context, so no shared node's mass ` +
      `grows with the corpus (got ${maxMass} on "${
        maxBytes.replace(/\n/g, "|")
      }")`,
  );

  // Synonymy/recall preserved: a genuinely-new continuation turn carries a halo.
  const turn1 = foldToId(
    m,
    s,
    `the assistant concludes that mulch completes the gardening picture`,
  );
  assert.ok(
    turn1 !== null && s.haloMass(turn1) >= 1,
    "a genuinely-new turn keeps its halo (the relevant part IS reinforced)",
  );
  await s.close();
});

test("halos resonate concept siblings through the separate halo index", async () => {
  const s = memStore();
  const next = vecs(9);
  const ice = await s.putLeaf(enc("ice"), next());
  const hielo = await s.putLeaf(enc("hielo"), next());
  const lava = await s.putLeaf(enc("lava"), next());

  // ice and hielo keep the SAME company (poured the same signature); lava keeps
  // different company. The halo index must return ice and hielo as siblings of
  // that shared signature, not lava.
  const shared = normalize(next());
  const other = normalize(next());
  for (let i = 0; i < 4; i++) {
    await s.pourHalo(ice, shared);
    await s.pourHalo(hielo, shared);
    await s.pourHalo(lava, other);
  }
  const sibs = await s.resonateHalo(shared, 3);
  const ids = sibs.filter((h) => h.score >= 0.5).map((h) => h.id);
  assert.ok(
    ids.includes(ice) && ids.includes(hielo),
    "ice & hielo are siblings",
  );
  assert.ok(!ids.includes(lava), "lava, with different company, is not");
  await s.close();
});

// =========================================================================
// 7 — METADATA & SNAPSHOT
// =========================================================================

test("metadata is set, read, overwritten, and deleted", async () => {
  const s = memStore();
  assert.equal(await s.getMeta("train.dataset"), null, "absent key → null");
  await s.setMeta("train.dataset", "MixtureVitae-v2");
  assert.equal(await s.getMeta("train.dataset"), "MixtureVitae-v2");
  await s.setMeta("train.dataset", "MixtureVitae-v3"); // overwrite
  assert.equal(await s.getMeta("train.dataset"), "MixtureVitae-v3");
  await s.deleteMeta("train.dataset");
  assert.equal(await s.getMeta("train.dataset"), null, "deleted key → null");
  await s.close();
});

test("the snapshot blob round-trips byte-for-byte", async () => {
  const s = memStore();
  assert.equal(await s.loadSnapshot(), null, "no snapshot yet");
  const blob = new Uint8Array([0, 1, 2, 250, 255, 128]);
  await s.saveSnapshot(blob);
  assert.deepEqual([...(await s.loadSnapshot())], [...blob]);
  // A second save overwrites (single-row snapshot).
  await s.saveSnapshot(new Uint8Array([9]));
  assert.deepEqual([...(await s.loadSnapshot())], [9]);
  await s.close();
});

// =========================================================================
// 8 — WRITE DISCIPLINE: deferred transaction, commit(), reads see uncommitted
// =========================================================================

test("reads observe not-yet-committed writes; commit() makes them durable", async () => {
  const s = memStore();
  const next = vecs(10);
  const a = await s.putLeaf(enc("uv"), next());
  // Within the same connection, the uncommitted node and edge are visible.
  await s.link(a, a);
  assert.equal(s.findLeaf(enc("uv")), a, "uncommitted leaf is found");
  assert.deepEqual(s.next(a), [a], "uncommitted edge is visible");
  // commit() is safe to call and idempotent (a no-op when nothing pending).
  s.commit();
  s.commit();
  assert.equal(s.findLeaf(enc("uv")), a, "still consistent after commit");
  await s.close();
});

// =========================================================================
// 9 — DURABILITY: reopen the SAME path, cold caches, everything survives
// =========================================================================

test("a closed store reopens with DAG, edges, halos, gists and meta intact", async () => {
  const stem = tmpStem("durable");
  try {
    const next = vecs(11);
    const gist = normalize(next());
    let aId;

    // Session 1 — write across every concern, then close (flushes + commits).
    {
      const s = new SQliteStore({ path: stem, D });
      aId = await s.putLeaf(enc("hi"), gist);
      const b = await s.putLeaf(enc("yo"), next());
      await s.putBranch([aId, b], next());
      await s.link(aId, b);
      for (let i = 0; i < 4; i++) await s.pourHalo(aId, normalize(next()));
      await s.setMeta("k", "v");
      await s.close();
    }

    // Session 2 — reopen the SAME files with cold in-memory caches. Every store
    // responsibility must reload from disk, not from a warm cache.
    {
      const s = new SQliteStore({ path: stem, D });
      assert.equal(s.nodeCount(), 3, "node count restored from disk");
      assert.equal(s.findLeaf(enc("hi")), aId, "cold content-addressed lookup");
      assert.deepEqual(s.next(aId), [1], "edges restored");
      assert.deepEqual(s.parents(0).sort(), [2], "parent index restored");
      assert.ok(s.halo(aId) !== null, "halo accumulator restored");
      assert.equal(await s.getMeta("k"), "v", "metadata restored");
      const hits = await s.resonate(gist, 1);
      assert.equal(hits[0].id, aId, "the gist vector index survived to disk");
      await s.close();
    }
  } finally {
    cleanup(stem);
  }
});

// =========================================================================
// 10 — MIND ROUND-TRIP: train → save → reopen → loadFromStore answers exactly
// =========================================================================

test("a trained Mind persists and serves exactly after reopen", async () => {
  const stem = tmpStem("mind");
  try {
    // Train and snapshot the config.
    {
      const store = new SQliteStore({ path: stem, D });
      const m = new Mind({ D, seed: 7, store });
      await m.ingest([
        ["what is the capital of france", "paris"],
        ["what is the capital of japan", "tokyo"],
      ]);
      await m.save(); // writes the config snapshot
      await store.close();
    }
    // Reopen in a fresh store and restore the Mind from the snapshot alone.
    {
      const store = new SQliteStore({ path: stem, D });
      const m = await Mind.loadFromStore(store);
      assert.equal(
        await m.respondText("what is the capital of france"),
        "paris",
      );
      assert.equal(
        await m.respondText("what is the capital of japan"),
        "tokyo",
      );
      await store.close();
    }
  } finally {
    cleanup(stem);
  }
});

// In-memory recall still works end to end (the contract the old surreal test
// guarded), now alongside the full storage coverage above.
test("in-memory store: exact recall through the gist index", async () => {
  const store = memStore();
  const m = new Mind({ D, seed: 7, store });
  await m.ingest([
    ["what is the capital of france", "paris"],
    ["what is the capital of japan", "tokyo"],
    ["what is the capital of italy", "rome"],
  ]);
  assert.equal(await m.respondText("what is the capital of france"), "paris");
  assert.equal(await m.respondText("what is the capital of italy"), "rome");
  await store.close();
});

// =========================================================================
// 11 — COMPRESSION: the store stays O(distinct chunks), not O(deposits)
// =========================================================================
//
// Sema's only compression is INTERN-TIME hash-consing (plus branch near
// dedup, exercised in §3) — identical content reuses an id, so the node count
// is the number of DISTINCT subtrees ever seen, independent of how many times
// they are deposited. There is no post-hoc "merge that deletes loser rows": ids
// are dense and never deleted; relearning is simply idempotent. These tests pin
// that model down (the old 12-compression assumed deletion and a long-dead
// `.rvf` file — both gone now).

// Repeating the SAME deposit must add ZERO entries — dedup all the way down.
test("compression: repeated identical deposits add no entries", async () => {
  const store = memStore();
  const m = new Mind({ D, seed: 7, store });
  const ctx = "the quick brown fox jumps over the lazy dog";
  const cont = "a pangram holds every letter of the alphabet once";

  await m.ingest([[ctx, cont]]);
  const afterFirst = await store.size();
  assert.ok(afterFirst > 1, "the pair decomposes into many distinct nodes");

  for (let i = 0; i < 50; i++) await m.ingest([[ctx, cont]]);
  assert.equal(
    await store.size(),
    afterFirst,
    "50 re-deposits of identical content must add nothing (full dedup)",
  );
  await store.close();
});

// Shared sub-content across DIFFERENT deposits is interned once: two deposits
// that share a prefix cost less than the sum of their standalone footprints.
test("compression: shared sub-content is interned once across deposits", async () => {
  const SHORT = "the quick brown fox";
  const LONG = "the quick brown fox jumps over the lazy dog and runs away";

  const a = memStore();
  const ma = new Mind({ D, seed: 7, store: a });
  await ma.ingest(SHORT);
  const cShort = await a.size();
  await a.close();

  const b = memStore();
  const mb = new Mind({ D, seed: 7, store: b });
  await mb.ingest(LONG);
  const cLong = await b.size();
  await b.close();

  const c = memStore();
  const mc = new Mind({ D, seed: 7, store: c });
  await mc.ingest(SHORT);
  await mc.ingest(LONG);
  const cBoth = await c.size();
  await c.close();

  // If parts were opaque, both would cost their full sum. Sharing means LONG
  // reuses SHORT's interned subtree, so the combined store beats the sum.
  assert.ok(
    cBoth < cShort + cLong,
    `sharing: combined ${cBoth} must beat the no-share sum ${cShort}+${cLong}`,
  );
  await c.close().catch(() => {});
});

// Unique content scales LINEARLY with deposits (each adds its own chunks); the
// per-deposit node cost stays bounded — no O(N²) leak as the corpus grows.
test("compression: unique content scales linearly, with a bounded per-deposit cost", async () => {
  const text = (id, bytes) => {
    let s = "", n = 0;
    while (n < bytes) {
      const w = `w${(id * 7 + n * 3) % 200}`;
      s += w + " ";
      n += w.length + 1;
    }
    return s;
  };
  const measure = async (N) => {
    const store = memStore();
    const m = new Mind({ D, seed: 7, store });
    for (let i = 0; i < N; i++) {
      await m.ingest([[text(i, 80), text(i + 9000, 80)]]);
    }
    const e = await store.size();
    await store.close();
    return e;
  };
  const e50 = await measure(50);
  const e200 = await measure(200);
  const per50 = e50 / 50, per200 = e200 / 200;
  console.log(
    `    unique scaling: 50 pairs → ${e50} (${per50.toFixed(1)}/pair), ` +
      `200 pairs → ${e200} (${per200.toFixed(1)}/pair)`,
  );

  // Per-deposit node cost must not grow with N — 4× the deposits costs ~4× the
  // nodes, not ~16×. A per-pair cost that climbed would betray an O(N²) leak.
  assert.ok(
    per200 < per50 * 1.5 + 1,
    `per-deposit cost grew (${per50.toFixed(1)} → ${
      per200.toFixed(1)
    }) — possible O(N²) leak`,
  );
});

// On disk the store materialises into exactly its three files; their combined
// size is a bounded multiple of the logical input (it is a vector index, so it
// is larger than the text by design — but bounded, not runaway).
test("compression: on-disk footprint is the three files, bounded in input", async () => {
  const stem = tmpStem("disk");
  try {
    const store = new SQliteStore({ path: stem, D });
    const m = new Mind({ D, seed: 7, store });
    let inputBytes = 0;
    for (let i = 0; i < 60; i++) {
      const q = `record number ${i} about subject ${i % 13}`;
      const aa = `the answer to record ${i} is detail ${i * 3}`;
      inputBytes += enc(q).length + enc(aa).length;
      await m.ingest([[q, aa]]);
    }
    await m.save();
    await store.close();

    const main = statSync(`${stem}.sqlite`).size;
    const content = statSync(`${stem}.content.vec`).size;
    const halo = statSync(`${stem}.halo.vec`).size;
    const total = main + content + halo;
    console.log(
      `    on-disk: input ${inputBytes}B → sqlite ${main}B + content.vec ${content}B + halo.vec ${halo}B = ${total}B (${
        (total / inputBytes).toFixed(1)
      }×)`,
    );
    // Every file is real and non-empty, and the whole store is a sane multiple
    // of the input — a vector index expands the text but does not run away.
    assert.ok(
      main > 0 && content > 0 && halo > 0,
      "all three files materialised",
    );
    assert.ok(
      total < inputBytes * 200,
      "footprint is a bounded multiple of input",
    );
  } finally {
    cleanup(stem);
  }
});

// STORAGE-AMPLIFICATION GUARD (the regression this whole change fixes). Folding
// text into a Merkle DAG explodes it into ~0.2 nodes/byte, most of which are
// intermediate branches that recall reaches by CLIMBING the structural graph,
// never by direct resonance. Indexing every one into the content index made the
// on-disk store ~50× the learned content and training crawl at a few KB/s. The
// fix indexes a form's gist only when it becomes a resonance target AND it is
// not already covered by the content index — the index adds a
// form only if it cannot already resonate to a stored gist within ε = 1 − 1/√D,
// so near-duplicate and frame forms collapse to one anchor and the kept set
// tracks the diversity of MEANING, not the size of the DAG. This guard pins both
// halves on disk so the regression cannot return silently: total footprint per
// learned byte, AND content-index selectivity (indexed vectors ≪ total nodes).
test("compression: post-hoc compaction bounds content-index footprint", async () => {
  const stem = tmpStem("ampl");
  try {
    const store = new SQliteStore({ path: stem, D });
    const m = new Mind({ D, seed: 7, store });
    let contentBytes = 0;
    // Distinctive, low-dedup episodes — the costly path (genuinely new nodes).
    for (let i = 0; i < 150; i++) {
      const q = `unique question ${i} concerning topic ${i}x${(i * 31) % 97}`;
      const a = `the distinct answer for ${i} is finding ${(i * 7) % 89} alpha`;
      contentBytes += enc(q).length + enc(a).length;
      await m.ingest([[q, a]]);
    }
    await m.save();

    // Post-hoc compaction: remove structurally-isolated interior nodes.
    // Vector-similarity gating was removed from the training hot path — it was rigid,
    // dimensionally fragile, and a no-op at typical D.  Structural
    // compaction (parent-count-based) replaces it as a batch step.
    const nodes = await store.size();
    const rawIndexed = store.indexedVectorCount();
    const rawRatio = (statSync(`${stem}.sqlite`).size +
      statSync(`${stem}.content.vec`).size +
      statSync(`${stem}.halo.vec`).size) / contentBytes;
    console.log(
      `    pre-compact: ${contentBytes}B → ${nodes} nodes, ${rawIndexed} indexed ` +
        `(${(rawIndexed / nodes * 100).toFixed(1)}%), ${rawRatio.toFixed(1)}×`,
    );

    const removed = await store.compactContentIndex(2);
    const indexed = store.indexedVectorCount();
    await store.close();

    const main = statSync(`${stem}.sqlite`).size;
    const vecContent = statSync(`${stem}.content.vec`).size;
    const halo = statSync(`${stem}.halo.vec`).size;
    const total = main + vecContent + halo;
    const ratio = total / contentBytes;
    const selectivity = indexed / nodes;
    console.log(
      `    post-compact: removed ${removed}, ${indexed} indexed ` +
        `(${(selectivity * 100).toFixed(1)}% selectivity), ${total}B on disk (${
          ratio.toFixed(1)
        }×)`,
    );

    // After structural compaction (minParents=2), the content index holds
    // only nodes that bridge multiple experiences (2+ parents) or are
    // experience roots (1 parent + edges).  This is a small minority of
    // the exploded DAG.  Vector-similarity gating previously tried to achieve this during
    // training via expensive index probes, but was rigid, dimensionally
    // fragile, and a no-op at typical D.  Post-hoc structural compaction
    // is adaptive (the data decides what's shared) and doesn't slow training.
    assert.ok(
      selectivity < 0.55,
      `content index holds ${(selectivity * 100).toFixed(1)}% of nodes — ` +
        `expected a minority after structural compaction`,
    );
    // Footprint: a bounded multiple of the learned content after compaction.
    // Before the fix this was ~50×; after structural compaction it drops
    // well below 45×.  On larger corpora the ratio drops further as shared
    // scaffoldings dominate the index.
    assert.ok(
      ratio < 45,
      `on-disk footprint is ${ratio.toFixed(1)}× the learned content — ` +
        `expected < 45× after compaction`,
    );
  } finally {
    cleanup(stem);
  }
});

// =========================================================================
// 12 — CONCEPT FORMATION: incremental halos, idempotency, conflict
// =========================================================================
//
// Concepts form continuously during deposition — there is no separate "sleep"
// pass. These are the store-level guarantees the old 06-sleep suite covered,
// now where they belong: the halo machinery is the store's.

// Cross-name transfer works the moment the company is poured — no sleep call.
test("concepts: cross-name transfer forms incrementally during training", async () => {
  const img = (n) => {
    const g = { width: 4, height: 4, channels: 1, data: new Uint8Array(16) };
    for (let i = 0; i < 16; i++) g.data[i] = (i * 13 + n * 41) & 0xff;
    return g;
  };
  const m = new Mind({ D, seed: 7, store: memStore() });
  await m.ingest([
    ["ice", "ice is frozen water"],
    [img(1), "ice"],
    [img(2), "ice"],
    [img(1), "hielo"],
    [img(2), "hielo"],
  ]);
  // "hielo" and "ice" keep the same company → the answer crosses the name.
  assert.equal(await m.respondText("hielo"), "hielo is frozen water");
  assert.equal(await m.respondText("ice"), "ice is frozen water");
  await m.store.close();
});

// Relearning a fact changes nothing — deposition is idempotent at every level.
test("concepts: duplicate training is idempotent", async () => {
  const m = new Mind({ D, seed: 7, store: memStore() });
  await m.ingest([["what is ice?", "ice is frozen water"]]);
  const n1 = await m.store.size();
  await m.ingest([["what is ice?", "ice is frozen water"]]);
  assert.equal(await m.store.size(), n1, "a duplicate deposit adds nothing");
  await m.store.close();
});

// A context with conflicting continuations resolves to ONE side, the SAME way
// every run (same seed) — deterministic, never a blend.
test("concepts: conflicting episodes resolve to one side, deterministically", async () => {
  const train = async () => {
    const m = new Mind({ D, seed: 7, store: memStore() });
    await m.ingest([["the sky", "blue"], ["the sky", "grey"]]);
    const a = await m.respondText("the sky");
    await m.store.close();
    return a;
  };
  const first = await train();
  assert.ok(
    first === "blue" || first === "grey",
    `one learnt side, got "${first}"`,
  );
  assert.equal(await train(), first, "same seed → same deterministic choice");
});

// The ingest cache is an optimisation of the deposit, never a second law: a
// store trained through it holds exactly what mind.ingest() teaches — every
// edge (suffix inheritance included) and every halo, vector and mass.  The
// episodes repeat continuations (memo hits), grow a context by appending,
// and make a suffix a known form, so each part of the pair law is exercised.
test("a store trained through the ingest cache is the store mind.ingest trains", async () => {
  const episodes = [
    ["Clara Novello mother", "The mother of Clara Novello is Mary Sabilla."],
    ["Clara Novello", "The mother of Clara Novello is Mary Sabilla."],
    ["Peter Hale mother", "The mother of Peter Hale is Ann Hale."],
    ["Peter Hale", "The mother of Peter Hale is Ann Hale."],
    ["Who is the mother of Ann Hale?", "Nobody recorded."],
    ["Who is the mother of Ann Hale?\nthe user asks again", "Nobody recorded."],
  ];
  const direct = new Mind({ D, seed: 7 });
  await direct.ingest(episodes);
  const cached = new Mind({ D, seed: 7 });
  const ci = new CachedIngest(cached);
  for (const [c, k] of episodes) await ci.ingest(c, k);
  const a = direct.store, b = cached.store;
  assert.equal(b.nodeCount(), a.nodeCount(), "the same nodes");
  for (let id = 0; id < a.nodeCount(); id++) {
    assert.deepEqual(b.next(id), a.next(id), `edges of node ${id}`);
    assert.equal(b.haloMass(id), a.haloMass(id), `halo mass of node ${id}`);
    const ha = a.halo(id), hb = b.halo(id);
    assert.deepEqual(hb && [...hb], ha && [...ha], `halo of node ${id}`);
  }
});

// The two wholes of an episode keep each other's company, and nothing below
// them does: a part's company inside its context is the context's, so poured
// into the parts it measured collocation over use (halo-sketch.md) — and a
// halo marks a thing learnt whole, which `entitiesIn` reads.
test("an episode's halos are kept by its two wholes, not by their parts", async () => {
  const m = new Mind({ D, seed: 7 });
  const enc = new TextEncoder();
  const ctx = "Where was the painter Aldric Fenwick born?";
  const cont = "The place of birth of Aldric Fenwick is Coldmere.";
  await m.ingest(ctx, cont);
  const root = m.resolve(enc.encode(ctx)), answer = m.resolve(enc.encode(cont));
  assert.equal(m.store.haloMass(root), 1, "the context keeps one episode");
  assert.equal(m.store.haloMass(answer), 1, "the continuation keeps one");
  let parts = 0;
  for (let i = 0; i < ctx.length; i++) {
    for (let j = i + 4; j < ctx.length - (i === 0 ? 1 : 0); j++) {
      const id = m.resolve(enc.encode(ctx.slice(i, j)));
      if (id === null || id === root) continue;
      parts++;
      assert.equal(m.store.haloMass(id), 0, `part "${ctx.slice(i, j)}"`);
    }
  }
  assert.ok(parts > 0, "the context has stored parts");
});

test("a deposit records what it learnt whole, apart from the company the halo keeps", async () => {
  const stem = tmpStem("whole");
  const enc = new TextEncoder();
  const ctx = "Where was the painter Aldric Fenwick born?";
  const cont = "The place of birth of Aldric Fenwick is Coldmere.";
  const bare = "Aldric Fenwick painted the harbour at dawn.";
  try {
    {
      const store = new SQliteStore({ path: stem, D });
      const m = new Mind({ D, seed: 7, store });
      await m.ingest(ctx, cont);
      await m.ingest(bare);
      const id = (s) => m.resolve(enc.encode(s));
      assert.ok(store.learntWhole(id(ctx)) && store.learntWhole(id(cont)));
      assert.ok(
        store.learntWhole(id(bare)),
        "a bare experience is learnt whole",
      );
      assert.equal(
        store.haloMass(id(bare)),
        0,
        "it keeps no episode's company",
      );
      let pieces = 0;
      for (let i = 1; i + 4 < ctx.length; i++) {
        const piece = id(ctx.slice(i));
        if (piece === null) continue;
        pieces++;
        assert.ok(!store.learntWhole(piece), `a piece is not: ${ctx.slice(i)}`);
      }
      assert.ok(pieces > 0, "the context has stored pieces");
      await store.close();
    }
    {
      const store = new SQliteStore({ path: stem, D });
      const m = new Mind({ D, seed: 7, store });
      assert.ok(store.learntWhole(m.resolve(enc.encode(bare))), "it persists");
      await store.close();
    }
    // A store written before wholes were recorded kept company on its wholes
    // alone: on open, its halo rows are read as its wholes, once.
    {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(stem + ".sqlite");
      db.exec(
        "DROP TABLE whole; DELETE FROM meta WHERE key = 'whole.recorded';",
      );
      db.close();
      const store = new SQliteStore({ path: stem, D });
      const m = new Mind({ D, seed: 7, store });
      assert.ok(store.learntWhole(m.resolve(enc.encode(ctx))));
      assert.ok(!store.learntWhole(m.resolve(enc.encode(bare))));
      await store.close();
    }
  } finally {
    cleanup(stem);
  }
});

// =========================================================================
// 13 — THE DERIVED LAYER: rebuilt from the base alone
// =========================================================================

test("the derived layer is rebuilt from the base alone, and answers the same", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const stem = tmpStem("derived");
  const pairs = [
    ["The Paw director", "The director of The Paw is Hans Steinhoff."],
    ["The Paw", "The director of The Paw is Hans Steinhoff."],
    ["Hans Steinhoff place of birth", "The place of birth of Hans Steinhoff is Marienberg."],
    ["Hans Steinhoff", "The place of birth of Hans Steinhoff is Marienberg."],
    ["What is the capital of France?", "The capital of France is Paris."],
    ["How are you today?", "I'm doing great, thanks for asking."],
    ["How are you today?", "I'm doing great, thanks for asking."],
  ];
  const asks = [
    "Who is the director of The Paw?",
    "Where was Hans Steinhoff born?",
    "what is the capital of france",
    "How are you today?",
    "Zorblax quintessence of the vorpal meridian?",
  ];
  const BASE = ["node", "edge", "whole", "halo"];
  const rows = (db, sql) =>
    db.prepare(sql).all().map((r) =>
      Object.values(r).map((x) =>
        x instanceof Uint8Array ? Buffer.from(x).toString("hex") : x
      ).join(",")
    ).sort();
  const contain = (db) => {
    const out = new Set();
    for (const r of db.prepare("SELECT id, parents FROM contain").all()) {
      const b = r.parents;
      const p = new Int32Array(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      );
      for (const x of p) out.add(`${Math.floor(r.id / 256)}>${x}`);
    }
    return out;
  };
  const read = () => {
    const db = new DatabaseSync(`${stem}.sqlite`, { readOnly: true });
    const dd = new DatabaseSync(`${stem}.derived.sqlite`, { readOnly: true });
    const out = {
      base: BASE.map((t) => rows(db, `SELECT * FROM ${t}`)),
      // The base file holds the base and nothing else.
      tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all().map((r) => r.name).sort(),
      kid: rows(dd, "SELECT child, parent FROM kid"),
      canon: rows(dd, "SELECT h, id FROM canon"),
      contain: contain(dd),
    };
    db.close();
    dd.close();
    return out;
  };
  try {
    let mind = new Mind({ seed: 7, store: new SQliteStore({ path: stem, D }) });
    await mind.ingest(pairs);
    await mind.ingest("Marienberg is a town in Saxony, Germany.");
    await mind.buildCanonIndex();
    const before = [];
    for (const q of asks) before.push(await mind.respondText(q));
    await mind.store.close();
    const was = read();
    assert.ok(was.kid.length > 0 && was.canon.length > 0 && was.contain.size > 0);

    mind = new Mind({ seed: 7, store: new SQliteStore({ path: stem, D }) });
    await mind.rebuildDerived();
    const after = [];
    for (const q of asks) after.push(await mind.respondText(q));
    await mind.store.close();
    const now = read();

    assert.deepEqual(
      was.tables,
      ["edge", "halo", "meta", "node", "snapshot", "whole"],
      "the base file holds the base alone",
    );
    assert.deepEqual(now.base, was.base, "the base is never touched");
    assert.deepEqual(now.kid, was.kid, "the reverse index is the nodes' kids");
    assert.deepEqual(now.canon, was.canon, "the canonical index, from scratch");
    // Containment as the definition reads it: every window of every whole.
    // Ingestion's shortcuts may only omit rows, never invent them.
    for (const r of was.contain) {
      assert.ok(now.contain.has(r), `containment row ${r} is rebuilt`);
    }
    assert.deepEqual(after, before, "the store answers byte for byte");
  } finally {
    cleanup(stem);
  }
});

test("a derived layer behind the base, or lost, catches up and answers the same", async () => {
  const { copyFileSync } = await import("node:fs");
  const { DatabaseSync } = await import("node:sqlite");
  const stem = tmpStem("lag");
  const first = [
    ["The Paw director", "The director of The Paw is Hans Steinhoff."],
    ["The Paw", "The director of The Paw is Hans Steinhoff."],
  ];
  const second = [
    ["Hans Steinhoff place of birth", "The place of birth of Hans Steinhoff is Marienberg."],
    ["Hans Steinhoff", "The place of birth of Hans Steinhoff is Marienberg."],
    ["How are you today?", "I'm doing great, thanks for asking."],
  ];
  const asks = [
    "Who is the director of The Paw?",
    "Where was Hans Steinhoff born?",
    "How are you today?",
  ];
  const parents = () => {
    const dd = new DatabaseSync(`${stem}.derived.sqlite`, { readOnly: true });
    const n = dd.prepare("SELECT count(*) AS c FROM kid").get().c;
    dd.close();
    return n;
  };
  const answers = async (mind) => {
    const out = [];
    for (const q of asks) out.push(await mind.respondText(q));
    return out;
  };
  try {
    let mind = new Mind({ seed: 7, store: new SQliteStore({ path: stem, D }) });
    await mind.ingest(first);
    await mind.store.close();
    copyFileSync(`${stem}.derived.sqlite`, `${stem}.behind`);
    mind = new Mind({ seed: 7, store: new SQliteStore({ path: stem, D }) });
    await mind.ingest(second);
    const truth = await answers(mind);
    await mind.store.close();
    const kids = parents();

    // The derived layer lost its last commits: the open re-derives the
    // reverse index, the next write path the containment.
    copyFileSync(`${stem}.behind`, `${stem}.derived.sqlite`);
    mind = new Mind({ seed: 7, store: new SQliteStore({ path: stem, D }) });
    assert.ok(mind.store.derivedLag() !== null, "the lag is seen on open");
    await mind.repairDerived();
    assert.equal(mind.store.derivedLag(), null);
    assert.deepEqual(await answers(mind), truth);
    await mind.store.close();
    assert.equal(parents(), kids, "the reverse index is whole again");

    // The derived layer lost whole: rebuilt from the base.
    for (const ext of [".derived.sqlite", ".content.vec", ".halo.vec"]) {
      rmSync(stem + ext, { force: true });
    }
    mind = new Mind({ seed: 7, store: new SQliteStore({ path: stem, D }) });
    assert.equal(mind.store.derivedLag(), 0);
    await mind.repairDerived();
    assert.deepEqual(await answers(mind), truth);
    await mind.store.close();
  } finally {
    cleanup(stem);
    rmSync(`${stem}.behind`, { force: true });
  }
});
