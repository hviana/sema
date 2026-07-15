// 20-stability.test.mjs — perception is a PURE, STABLE Merkle DAG.
//
// Two properties of perceive() that the rest of sema leans on, guarded here so a
// future change to the river cannot silently break them:
//
//   PURITY        the same bytes always perceive to the SAME tree — identical
//                 structure and identical gist vectors. Recall, recognition,
//                 resonance and articulation all re-perceive content and expect
//                 to land on the very nodes deposition interned; if perception
//                 depended on anything but its input, those lookups would miss.
//
//   PREFIX-STABLE a stream that CONTINUES another (its bytes begin with the
//                 earlier stream's) folds its shared prefix into the SAME
//                 subtrees — only the right spine regroups. This is what makes a
//                 growing context (an accumulated-conversation turn, an extended
//                 buffer, appended frames) cheap to deposit and lets the halo be
//                 reinforced on just the NEW content: the prefix's nodes recur by
//                 identity instead of being rebuilt as fresh nodes.
//
// A node is interned (hash-consed) by its CONTENT: a leaf by its bytes, a branch
// by its ordered child ids. So a node's content FINGERPRINT (its Merkle hash —
// leaf bytes, or B(child fingerprints)) is one-to-one with the id it interns to.
// Sharing a subtree BY FINGERPRINT is therefore exactly sharing it BY ID; the
// test measures fingerprints, which needs only the pure public perceive(), no
// store. (See bytesToTree / foldOnce in geometry.ts for why the property holds.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const newMind = () => new Mind({ seed: 7 });

// A node's content fingerprint — its Merkle hash, identical iff the node would
// hash-cons to the same interned id. A leaf is its raw bytes; a branch is the
// ordered tuple of its children's fingerprints.
function fingerprint(node) {
  if (node.kids === null) {
    const b = node.leaf ?? new Uint8Array(0);
    return "L:" + Buffer.from(b).toString("hex");
  }
  return "B(" + node.kids.map(fingerprint).join(",") + ")";
}

// Every subtree fingerprint in a tree (the set of ids it would intern).
function subtreeIds(node, into = new Set()) {
  into.add(fingerprint(node));
  if (node.kids) { for (const k of node.kids) subtreeIds(k, into); }
  return into;
}

// Deep structural + gist equality of two perceived trees.
function treesIdentical(a, b) {
  if ((a.kids === null) !== (b.kids === null)) return false;
  if (a.v.length !== b.v.length) return false;
  for (let i = 0; i < a.v.length; i++) if (a.v[i] !== b.v[i]) return false;
  if (a.kids === null) {
    const la = a.leaf ?? new Uint8Array(0);
    const lb = b.leaf ?? new Uint8Array(0);
    if (la.length !== lb.length) return false;
    for (let i = 0; i < la.length; i++) if (la[i] !== lb[i]) return false;
    return true;
  }
  if (a.kids.length !== b.kids.length) return false;
  for (let i = 0; i < a.kids.length; i++) {
    if (!treesIdentical(a.kids[i], b.kids[i])) return false;
  }
  return true;
}

const enc = (s) => new TextEncoder().encode(s);

// ── PURITY — same bytes, same tree (structure AND vectors) ────────────────
test("perceive is pure: identical input yields an identical tree", async () => {
  const mind = newMind();
  const inputs = [
    "the crystal river holds the ancient compass",
    "数据是雨水，记忆是河流。",
    "🌊🧠 memory is the model 🜁",
    "a".repeat(300),
  ];
  for (const s of inputs) {
    // Re-perceive the SAME bytes twice — must be byte-for-byte the same tree.
    assert.ok(
      treesIdentical(mind.perceive(s), mind.perceive(s)),
      `perceive("${s.slice(0, 16)}…") was not stable across calls`,
    );
    // And independent of the leaf cache's warmth: a fresh Mind (cold cache,
    // same seed) must perceive the identical tree.
    const cold = newMind();
    assert.equal(
      fingerprint(cold.perceive(s)),
      fingerprint(mind.perceive(s)),
      `perceive depends on cache/history for "${s.slice(0, 16)}…"`,
    );
  }
  await mind.store.close();
});

// Order-independence: perceiving B after A must give B the SAME tree it gets
// when perceived first — perception carries no state from one call to the next.
test("perceive is order-independent across different inputs", async () => {
  const a = "the silent garden remembers the frozen lantern";
  const b = "an entirely different burning harbor follows the engine";
  const m1 = newMind();
  m1.perceive(a);
  const bAfterA = fingerprint(m1.perceive(b));
  const m2 = newMind();
  const bFirst = fingerprint(m2.perceive(b));
  assert.equal(bAfterA, bFirst, "perceiving A changed how B perceives");
  await m1.store.close();
  await m2.store.close();
});

// ── PREFIX-STABILITY — a continuation shares its prefix's subtrees ────────
test("a continuation re-uses almost all of its prefix's subtrees (by id)", async () => {
  const mind = newMind();

  // A growing context, exactly the shape multi-turn conversation builds: each
  // step appends a turn to the accumulated prefix (the "\n" join is incidental —
  // the property is about bytes, any continuation qualifies).
  const turns = [
    "the harbor master logged the tide at dawn",
    "the crystal river rose two feet by noon",
    "the ancient compass pointed steadily north",
    "the silent garden flooded near the gilded gate",
    "the wandering engine hauled the last barge home",
  ];

  let prevTree = null;
  let prevLen = 0;
  for (let i = 0; i < turns.length; i++) {
    const ctx = turns.slice(0, i + 1).join("\n");
    const tree = mind.perceive(ctx);
    if (prevTree) {
      const prevIds = subtreeIds(prevTree);
      const nowIds = subtreeIds(tree);
      let kept = 0;
      for (const id of prevIds) if (nowIds.has(id)) kept++;
      const frac = kept / prevIds.size;
      console.log(
        `    prefix ${prevLen}B → ${enc(ctx).length}B: ` +
          `${kept}/${prevIds.size} prefix subtrees re-used (${
            (frac * 100).toFixed(1)
          }%)`,
      );
      // The shared prefix re-folds into the SAME subtrees; only the right spine
      // (the junction where the new turn attaches, plus the few nodes above it on
      // the path to the root) regroups. The overwhelming majority of the prefix's
      // interned nodes recur by identity — that is the stable-DAG guarantee, and
      // a regression to a position-defined cut would send this toward ~0.
      assert.ok(
        frac >= 0.85,
        `only ${
          (frac * 100).toFixed(1)
        }% of the prefix's subtrees survived the ` +
          `continuation — perception is not prefix-stable (the river is ` +
          `regrouping shared content, not just the right spine)`,
      );
    }
    prevTree = tree;
    prevLen = enc(ctx).length;
  }
  await mind.store.close();
});

// The stable part is the PREFIX: appending bytes must never disturb a subtree
// that lies wholly within the earlier stream. We check the deepest shared
// content — the leaves of the prefix region — survive verbatim, so only the
// junction leaf at the very end can differ.
test("appending bytes leaves the prefix's leaves untouched", async () => {
  const mind = newMind();
  const prefix = "the gilded archive guards the burning mirror and the ";
  const leavesOf = (s) => {
    const out = [];
    const walk = (n) => {
      if (n.kids === null) out.push(fingerprint(n));
      else for (const k of n.kids) walk(k);
    };
    walk(mind.perceive(s));
    return out;
  };

  const base = leavesOf(prefix);
  for (
    const suffix of ["frozen river", "hollow lantern of the deep north sea"]
  ) {
    const ext = leavesOf(prefix + suffix);
    // Every prefix leaf except possibly the LAST (the junction leaf, which the
    // continuation re-cuts) must appear, in order, at the front of the extended
    // stream's leaves.
    const stable = base.slice(0, base.length - 1);
    for (let i = 0; i < stable.length; i++) {
      assert.equal(
        ext[i],
        stable[i],
        `leaf ${i} of the prefix changed when "${suffix}" was appended — ` +
          `a content cut moved, so the DAG is not prefix-stable`,
      );
    }
  }
  await mind.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// STORE-LEVEL STRUCTURAL STABILITY — the DAG itself, not just perception.
//
// The tests above prove perceive() is a pure, prefix-stable function; the ones
// below pin the properties the STORE adds on top, which the whole system leans
// on and which the perception tests cannot see:
//
//   ROUND-TRIP    a deposited input re-perceives and content-addresses back to
//                 the very id deposition interned, and that id reconstructs the
//                 exact bytes — the address ↔ content bijection.
//   DURABILITY    every structural relation (ids, kids, reverse kid rows,
//                 continuation edges, containment, the document count) survives
//                 a close + reopen unchanged — the graph is the FILE, not the
//                 session; caches must be pure accelerators.
//   DETERMINISM   two stores fed the same corpus with the same seed are
//                 row-for-row identical across every structural table — no
//                 hidden clock, randomness, or iteration-order dependence in
//                 the whole ingestion pipeline.
//   CLIMB         the reverse structural index (kid) exactly mirrors the
//                 forward kids lists, and branch ids are dense — edgeAncestors'
//                 upward climb can never dead-end on a missing reverse edge.
// ═══════════════════════════════════════════════════════════════════════════

import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

function tmpStem(tag) {
  return `/tmp/sema-stability-${tag}-${process.pid}-${
    Math.floor(performance.now())
  }`;
}
function cleanup(stem) {
  for (
    const ext of [
      ".sqlite",
      ".sqlite-shm",
      ".sqlite-wal",
      ".content.vec",
      ".content.vec-shm",
      ".content.vec-wal",
      ".halo.vec",
      ".halo.vec-shm",
      ".halo.vec-wal",
    ]
  ) {
    try {
      rmSync(stem + ext);
    } catch { /* may not exist */ }
  }
}

const CORPUS = [
  [
    "the harbor master logged the tide at dawn",
    "the ledger shows a spring tide",
  ],
  ["what turns the lighthouse lamp at dusk", "a clockwork of brass gears"],
  ["the crystal river rose two feet by noon", "the flood gate held firm"],
];
const EXPERIENCE = "the wandering engine hauled the last barge home";

async function trainCorpus(mind) {
  for (const [c, a] of CORPUS) await mind.ingest(c, a);
  const exp = await mind.ingest(EXPERIENCE);
  mind.store.commit();
  return exp.id;
}

// ── ROUND-TRIP — deposit → resolve → bytes is the identity ────────────────
test("store round-trip: deposited inputs resolve to their interned ids and back to their bytes", async () => {
  const mind = newMind();
  const expId = await trainCorpus(mind);
  const dec = new TextDecoder();

  // The experience root: ingest's id, resolve's id, and the bytes all agree.
  assert.equal(
    mind.resolve(enc(EXPERIENCE)),
    expId,
    "re-perceiving a deposited experience did not land on its interned root",
  );
  assert.equal(dec.decode(mind.store.bytes(expId)), EXPERIENCE);

  // Every trained context and answer is content-addressable, and its id
  // reconstructs its exact bytes.
  for (const [c, a] of CORPUS) {
    for (const s of [c, a]) {
      const id = mind.resolve(enc(s));
      assert.ok(id !== null, `"${s}" did not resolve after deposition`);
      assert.equal(
        dec.decode(mind.store.bytes(id)),
        s,
        `bytes(${id}) did not reconstruct "${s}"`,
      );
    }
  }

  // The learnt edge is on those very ids: context id → answer id.
  const [c0, a0] = CORPUS[0];
  const nx = mind.store.next(mind.resolve(enc(c0)));
  assert.ok(
    nx.includes(mind.resolve(enc(a0))),
    "the continuation edge does not connect the resolved context/answer ids",
  );
  await mind.store.close();
});

// ── DURABILITY — close + reopen preserves every structural relation ───────
test("the whole graph survives a store reopen: ids, edges, containment, document count, recall", async () => {
  const stem = tmpStem("reopen");
  try {
    // Session 1: train, snapshot every observable structural fact.
    const before = {};
    {
      const store = new SQliteStore({ path: stem, D: 256 });
      const mind = new Mind({ seed: 7, store });
      await trainCorpus(mind);
      await mind.save();
      before.ids = CORPUS.flat().map((s) => mind.resolve(enc(s)));
      before.n = store.edgeSourceCount();
      before.next = before.ids.map((id) => mind.store.next(id));
      before.parents = before.ids.map((id) => mind.store.parents(id));
      before.answer = await mind.respondText(CORPUS[1][0]);
      before.nodeCount = store.nodeCount();
      await store.close();
    }
    // Session 2: cold caches, same files — everything must read back equal.
    {
      const store = new SQliteStore({ path: stem, D: 256 });
      const mind = new Mind({ seed: 7, store });
      const ids = CORPUS.flat().map((s) => mind.resolve(enc(s)));
      assert.deepEqual(
        ids,
        before.ids,
        "content-addressed ids changed across reopen",
      );
      assert.equal(store.nodeCount(), before.nodeCount, "node count changed");
      assert.equal(
        store.edgeSourceCount(),
        before.n,
        "document count (edgeSourceCount) changed across reopen",
      );
      ids.forEach((id, i) => {
        assert.deepEqual(mind.store.next(id), before.next[i], "edges changed");
        assert.deepEqual(
          mind.store.parents(id),
          before.parents[i],
          "structural parents changed",
        );
      });
      assert.equal(
        await mind.respondText(CORPUS[1][0]),
        before.answer,
        "recall changed across reopen",
      );
      // Containment was persisted (not a session-local map).
      const db = new DatabaseSync(`${stem}.sqlite`);
      const contain = db.prepare("SELECT COUNT(*) n FROM contain").get().n;
      db.close();
      assert.ok(contain > 0, "containment rows were not durable");
      await store.close();
    }
  } finally {
    cleanup(stem);
  }
});

// ── DETERMINISM — identical corpus + seed ⇒ row-identical stores ──────────
test("two identically-fed stores are row-for-row identical in every structural table", async () => {
  const stems = [tmpStem("det-a"), tmpStem("det-b")];
  try {
    for (const stem of stems) {
      const store = new SQliteStore({ path: stem, D: 256 });
      const mind = new Mind({ seed: 7, store });
      await trainCorpus(mind);
      await store.close();
    }
    const dump = (stem, sql) => {
      const db = new DatabaseSync(`${stem}.sqlite`);
      const rows = JSON.stringify(
        db.prepare(sql).all(),
        (_, v) => v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v,
      );
      db.close();
      return rows;
    };
    for (
      const [table, sql] of [
        ["node", "SELECT id,leaf,kids,h FROM node ORDER BY id"],
        ["edge", "SELECT src,dst,seq FROM edge ORDER BY seq"],
        ["kid", "SELECT child,parent FROM kid ORDER BY child,parent"],
        ["contain", "SELECT id,parents FROM contain ORDER BY id"],
        ["halo ids", "SELECT id,mass FROM halo ORDER BY id"],
      ]
    ) {
      assert.equal(
        dump(stems[0], sql),
        dump(stems[1], sql),
        `${table} rows differ between identically-fed stores — ` +
          `ingestion is not deterministic`,
      );
    }
  } finally {
    for (const stem of stems) cleanup(stem);
  }
});

// ── CLIMB INTEGRITY — the reverse index exactly mirrors the kids lists ────
test("kid rows mirror every branch's kids exactly, and branch ids are dense", async () => {
  const stem = tmpStem("climb");
  try {
    {
      const store = new SQliteStore({ path: stem, D: 256 });
      const mind = new Mind({ seed: 7, store });
      await trainCorpus(mind);
      await store.close();
    }
    const db = new DatabaseSync(`${stem}.sqlite`);
    // Dense ids: rows 0..count-1 with no gaps.
    const { n, mx } = db.prepare(
      "SELECT COUNT(*) n, MAX(id) mx FROM node",
    ).get();
    assert.equal(
      mx,
      n - 1,
      "branch ids are not dense (gaps break has()/nextId)",
    );

    // Forward → reverse: every real (non-byte-leaf) kid of every MIXED branch
    // has its (child, parent) row.  Flat branches (zero-length kids blob) have
    // only implicit byte leaves, which by design get no kid rows.
    const kidSet = new Set(
      db.prepare("SELECT child, parent FROM kid").all()
        .map((r) => `${r.child}:${r.parent}`),
    );
    let checked = 0;
    for (
      const row of db.prepare(
        "SELECT id, kids FROM node WHERE kids IS NOT NULL AND length(kids) > 0",
      ).all()
    ) {
      const ids = new Int32Array(
        row.kids.buffer.slice(
          row.kids.byteOffset,
          row.kids.byteOffset + row.kids.byteLength,
        ),
      );
      for (const child of ids) {
        if (child < 0) continue; // implicit byte leaf — no reverse edge
        checked++;
        assert.ok(
          kidSet.has(`${child}:${row.id}`),
          `kid row (${child} → ${row.id}) missing — the upward climb dead-ends`,
        );
      }
    }
    assert.ok(checked > 0, "no mixed branches checked — corpus too trivial");

    // Reverse → forward: no kid row points at a parent that does not list it.
    const kidsOf = new Map(
      db.prepare(
        "SELECT id, kids FROM node WHERE kids IS NOT NULL AND length(kids) > 0",
      ).all().map((r) => [
        r.id,
        new Set(
          new Int32Array(
            r.kids.buffer.slice(
              r.kids.byteOffset,
              r.kids.byteOffset + r.kids.byteLength,
            ),
          ),
        ),
      ]),
    );
    for (const r of db.prepare("SELECT child, parent FROM kid").all()) {
      const set = kidsOf.get(r.parent);
      assert.ok(
        set !== undefined && set.has(r.child),
        `stale kid row (${r.child} → ${r.parent}): parent does not list child`,
      );
    }
    db.close();
  } finally {
    cleanup(stem);
  }
});
