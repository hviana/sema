// 35-ivf.test.mjs — the partitioned (IVF) vector index, at its own layer.
//
// VectorDatabase is an adaptive IVF index over 1-bit RaBitQ codes in SQLite
// (src/rabitq-ivf).  These tests verify the index's OWN contract, below the
// Sema store:
//
//   1. CRUD          — insert/has/get/update/delete, id checking.
//   2. Recall        — clustered data resonates to its own cluster; a stored
//                      vector finds itself.
//   3. Splits        — the index partitions past SPLIT_MAX and stays correct.
//   4. Persistence   — close/reopen preserves entries, config, and results.
//   5. Determinism   — same insert sequence ⇒ identical results (no RNG).
//   6. Compaction    — tombstones are reclaimed; internal ids (the keysSince
//                      watermark) survive.
//   7. Scaling       — per-query STORAGE READS are bounded once the
//                      collection is past its first splits: 2x the corpus
//                      must not move the reads (the honest witness the old
//                      graph index also swore to).

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { VectorDatabase } from "../dist/src/rabitq-ivf/src/index.js";

// Deterministic PRNG for test vectors.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** A unit vector near `center` with per-coordinate jitter. */
function near(center, jitter, r) {
  const v = new Float32Array(center.length);
  for (let i = 0; i < v.length; i++) {
    v[i] = center[i] + (r() * 2 - 1) * jitter;
  }
  return v;
}

function randVec(dim, r) {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = r() * 2 - 1;
  return v;
}

test("1: CRUD — insert, has, get, update, delete", () => {
  const db = new VectorDatabase({ dbPath: ":memory:", dim: 64 });
  const r = rng(1);
  const v1 = randVec(64, r);
  const v2 = randVec(64, r);

  db.insert(10, v1);
  assert.equal(db.size, 1);
  assert.ok(db.has(10));
  assert.ok(!db.has(11));
  assert.throws(() => db.insert(10, v2), /already exists/);
  assert.throws(() => db.insert(1.5, v2), /integer/);

  const code = db.get(10);
  assert.ok(code instanceof Uint32Array);

  // update to a genuinely different vector: same ext still resolves
  db.update(10, v2);
  assert.equal(db.size, 1);
  assert.ok(db.has(10));

  // byte-identical update is a no-op (no new tombstone)
  const phys = db.physicalSize;
  db.update(10, v2);
  assert.equal(db.physicalSize, phys);

  assert.ok(db.delete(10));
  assert.ok(!db.has(10));
  assert.equal(db.size, 0);
  assert.ok(!db.delete(10));
  db.close();
});

test("2: recall — clustered data finds its own cluster; self-recall", () => {
  const dim = 128;
  const db = new VectorDatabase({ dbPath: ":memory:", dim });
  const r = rng(2);
  // 8 well-separated centers, 100 members each.
  const centers = [];
  for (let c = 0; c < 8; c++) centers.push(randVec(dim, r));
  const vecs = new Map();
  let id = 0;
  const batch = [];
  for (let c = 0; c < 8; c++) {
    for (let m = 0; m < 100; m++) {
      const v = near(centers[c], 0.15, r);
      vecs.set(id, { v, c });
      batch.push({ id, vector: v });
      id++;
    }
  }
  db.upsertMany(batch);
  assert.equal(db.size, 800);

  // Query each center: top-10 should come from that center's members.
  for (let c = 0; c < 8; c++) {
    const hits = db.query(centers[c], 10);
    assert.equal(hits.length, 10);
    let own = 0;
    for (const h of hits) if (vecs.get(h.id).c === c) own++;
    assert.ok(own >= 8, `center ${c}: only ${own}/10 hits from own cluster`);
  }

  // Self-recall: a stored vector should find its own ext in the top 5.
  let self = 0;
  for (let probe = 0; probe < 100; probe += 7) {
    const hits = db.query(vecs.get(probe).v, 5);
    if (hits.some((h) => h.id === probe)) self++;
  }
  assert.ok(self >= 12, `self-recall ${self}/15 too low`);
  db.close();
});

test("3: splits — collections past SPLIT_MAX partition and stay correct", () => {
  const dim = 32;
  const db = new VectorDatabase({ dbPath: ":memory:", dim });
  const r = rng(3);
  const N = 10_000; // > 2 × SPLIT_MAX (4096) — forces several splits
  const batch = [];
  for (let i = 0; i < N; i++) batch.push({ id: i, vector: randVec(dim, r) });
  db.upsertMany(batch);
  assert.equal(db.size, N);
  assert.ok(
    db.clusterCount >= 3,
    `expected several clusters after ${N} inserts, got ${db.clusterCount}`,
  );
  // Every ext still resolves and queries still return k results.
  assert.ok(db.has(0) && db.has(N - 1) && db.has(N >> 1));
  const hits = db.query(randVec(dim, r), 20);
  assert.equal(hits.length, 20);
  db.close();
});

test("4: persistence — close/reopen preserves entries and results", (t) => {
  const path = `/tmp/ivf-test-${process.pid}.vec`;
  t.after(() => {
    for (const s of ["", "-wal", "-shm"]) {
      try {
        rmSync(path + s);
      } catch {}
    }
  });
  const dim = 64;
  const r = rng(4);
  const vecs = [];
  for (let i = 0; i < 500; i++) vecs.push(randVec(dim, r));

  let db = new VectorDatabase({ dbPath: path, dim });
  db.upsertMany(vecs.map((v, i) => ({ id: i, vector: v })));
  const probe = vecs[123];
  const before = db.query(probe, 10);
  db.close();

  db = new VectorDatabase({ dbPath: path });
  assert.equal(db.dim, dim);
  assert.equal(db.size, 500);
  const after = db.query(probe, 10);
  assert.deepEqual(after, before);
  db.close();
});

test("5: determinism — same insert sequence, identical results", () => {
  const dim = 64;
  const r1 = rng(5), r2 = rng(5);
  const a = new VectorDatabase({ dbPath: ":memory:", dim });
  const b = new VectorDatabase({ dbPath: ":memory:", dim });
  const N = 6000; // crosses a split
  const batchA = [], batchB = [];
  for (let i = 0; i < N; i++) {
    batchA.push({ id: i, vector: randVec(dim, r1) });
    batchB.push({ id: i, vector: randVec(dim, r2) });
  }
  a.upsertMany(batchA);
  b.upsertMany(batchB);
  assert.equal(a.clusterCount, b.clusterCount);
  const probe = randVec(dim, r1);
  assert.deepEqual(a.query(probe, 20), b.query(probe, 20));
  a.close();
  b.close();
});

test("6: compaction — tombstones reclaimed, watermark ids preserved", () => {
  const dim = 32;
  const db = new VectorDatabase({ dbPath: ":memory:", dim });
  const r = rng(6);
  const N = 2000;
  db.upsertMany(
    Array.from({ length: N }, (_, i) => ({ id: i, vector: randVec(dim, r) })),
  );

  // Watermark before deletion.
  let maxInternal = 0;
  for (const { internal } of db.keysSince(0)) {
    maxInternal = Math.max(maxInternal, internal);
  }

  // Delete every third entry.
  const dead = [];
  for (let i = 0; i < N; i += 3) dead.push(i);
  assert.equal(db.deleteMany(dead), dead.length);
  assert.equal(db.size, N - dead.length);
  assert.ok(db.physicalSize > db.size);

  db.compact();
  assert.equal(db.physicalSize, db.size);
  for (const i of dead) assert.ok(!db.has(i));
  assert.ok(db.has(1) && db.has(2));

  // Internal ids survive compaction: entries added AFTER the old watermark
  // are exactly the new inserts.
  db.upsertMany([{ id: 99999, vector: randVec(dim, r) }]);
  const fresh = [...db.keysSince(maxInternal)];
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].ext, 99999);
  db.close();
});

test("7: scaling — per-query storage reads are bounded past the first splits", () => {
  const dim = 32;
  // cacheSizeMb 0: no page cache to hide behind; `reads` counts blob rows.
  const db = new VectorDatabase({ dbPath: ":memory:", dim, cacheSizeMb: 0 });
  const r = rng(7);
  const probe = randVec(dim, r);
  const readsNow = () => {
    db.query(probe, 10);
    return db.lastQueryStorageReads;
  };

  const grow = (n) => {
    const batch = [];
    for (let i = 0; i < n; i++) {
      batch.push({ id: db.size + i, vector: randVec(dim, r) });
    }
    db.upsertMany(batch);
  };

  // Past ~nprobe × SPLIT_MAX entries the probed set is a fixed number of
  // bounded clusters — reads must plateau.
  grow(80_000);
  const small = readsNow();
  grow(80_000); // 2x the corpus
  const large = readsNow();
  console.log(
    `    ivf reads for one query: N=80k → ${small}, N=160k → ${large}`,
  );
  assert.ok(
    large <= small * 1.5 + 8,
    `reads grew ${small} → ${large} when the corpus doubled — probes are ` +
      `not bounded`,
  );
  db.close();
});
