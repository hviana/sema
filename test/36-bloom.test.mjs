// 36-bloom.test.mjs — the negative dedup filter (store-sqlite's Bloom layer).
//
// The filter answers "this content hash is definitely not in the node table"
// in RAM, sparing the training hot path its dominant SQLite probe (profiled:
// 38.7% of ingest wall at 2.9M nodes).  Its ONE hazard is a false negative,
// which would mint a duplicate node and silently break hash-consing.  These
// tests pin the invariant on the three lifecycle paths:
//
//   1. live session   — content minted then re-probed dedups (filter sees
//                       every insert synchronously);
//   2. clean close    — reopen loads the persisted filter (or rebuilds) and
//                       dedup still holds;
//   3. CRASH          — a process that exits without close() leaves no
//                       persisted filter (or a stale one); reopen must
//                       rebuild/top-up from the table and STILL dedup all
//                       previously-minted content, with zero duplicates.
//
// The CANON index's filter (canon_bloom) has the same hazard — a false
// negative there is a canonical form `canonFind` silently fails to propose —
// and is pinned the same way: across reopen, across rows added after a
// persisted filter exists, and against a writer that adds rows without
// touching the filter (its stamp disagrees with the meta, so it is rebuilt).
//
// Its cost is the false positive: the positions read the whole hash, so a
// stored hash sharing only the bits below the mask does not answer for another.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const cleanup = (path) => {
  for (
    const s of [
      ".sqlite",
      ".sqlite-wal",
      ".sqlite-shm",
      ".derived.sqlite",
      ".derived.sqlite-wal",
      ".derived.sqlite-shm",
      ".content.vec",
      ".content.vec-wal",
      ".content.vec-shm",
      ".halo.vec",
      ".halo.vec-wal",
      ".halo.vec-shm",
    ]
  ) {
    try {
      rmSync(path + s);
    } catch {}
  }
};

test("live session: re-probing minted content dedups (no false negatives)", async () => {
  const s = new SQliteStore({ path: ":memory:", D: 64 });
  const enc = new TextEncoder();
  const g = new Float32Array(64).fill(0.1);
  const ids = [];
  for (let i = 0; i < 300; i++) {
    ids.push(await s.putLeaf(enc.encode("bloom-live-" + i), g));
  }
  for (let i = 0; i < 300; i++) {
    assert.equal(await s.putLeaf(enc.encode("bloom-live-" + i), g), ids[i]);
  }
  // Novel probes are answered by the filter without SQLite (the point).
  const skipsBefore = s.bloomSkips;
  s.findLeaf(enc.encode("definitely-not-present-xyzzy"));
  assert.ok(s.bloomSkips >= skipsBefore, "bloomSkips must be observable");
  await s.close();
});

test("clean close: reopen dedups against the persisted/rebuilt filter", async (t) => {
  const path = `/tmp/bloom-clean-${process.pid}`;
  t.after(() => cleanup(path));
  const enc = new TextEncoder();
  const g = new Float32Array(64).fill(0.1);

  let s = new SQliteStore({ path, D: 64 });
  const ids = [];
  for (let i = 0; i < 300; i++) {
    ids.push(await s.putLeaf(enc.encode("bloom-clean-" + i), g));
  }
  await s.close();

  s = new SQliteStore({ path, D: 64 });
  const before = s.nodeCount();
  for (let i = 0; i < 300; i++) {
    const id = await s.putLeaf(enc.encode("bloom-clean-" + i), g);
    assert.equal(id, ids[i], `content ${i} re-minted after clean reopen`);
  }
  assert.equal(s.nodeCount(), before, "no duplicate mints after clean reopen");
  await s.close();
});

test("crash: reopen after an unclean exit still dedups everything", (t) => {
  const path = `/tmp/bloom-crash-${process.pid}`;
  t.after(() => cleanup(path));

  // Phase 1 in a SUBPROCESS that exits WITHOUT close() — a real crash as far
  // as the store is concerned (WAL holds the rows; no filter was persisted).
  const phase1 = `
    import("${process.cwd()}/dist/src/store-sqlite.js").then(async ({ SQliteStore }) => {
      const s = new SQliteStore({ path: "${path}", D: 64 });
      const enc = new TextEncoder();
      const g = new Float32Array(64).fill(0.1);
      for (let i = 0; i < 400; i++) {
        await s.putLeaf(enc.encode("bloom-crash-" + i), g);
      }
      s.commit();
      process.exit(0); // no close()
    });`;
  execFileSync(process.execPath, ["-e", phase1], { stdio: "pipe" });

  // Phase 2 in a second subprocess: every previously-minted content must
  // resolve to an existing id — zero duplicates.
  const phase2 = `
    import("${process.cwd()}/dist/src/store-sqlite.js").then(async ({ SQliteStore }) => {
      const s = new SQliteStore({ path: "${path}", D: 64 });
      await s.size();
      const enc = new TextEncoder();
      const g = new Float32Array(64).fill(0.1);
      const before = s.nodeCount();
      for (let i = 0; i < 400; i++) {
        const id = await s.putLeaf(enc.encode("bloom-crash-" + i), g);
        if (id >= before) { console.error("DUP " + i); process.exit(1); }
      }
      if (s.nodeCount() !== before) { console.error("GREW"); process.exit(1); }
      await s.close();
      process.exit(0);
    });`;
  execFileSync(process.execPath, ["-e", phase2], { stdio: "pipe" });
  assert.ok(true);
});

test("canon filter: persisted with its rows, rebuilt when its stamp is stale", async (t) => {
  const path = `/tmp/bloom-canon-${process.pid}`;
  t.after(() => cleanup(path));
  const H = (i) => (i * 2654435761) >>> 0;
  const findsAll = (s, from, to) => {
    for (let i = from; i < to; i++) {
      assert.deepEqual(s.canonFind(H(i)), [i], `canon row ${i} not proposed`);
    }
  };

  // Session 1: rows written by the store itself, then committed and closed.
  let s = new SQliteStore({ path, D: 64 });
  await s.size();
  for (let i = 0; i < 200; i++) s.canonAdd(H(i), i);
  await s.setMeta("canon.upto", "200");
  s.commit();
  findsAll(s, 0, 200);
  await s.close();

  // Session 2: the persisted filter is loaded, and rows added on top of it
  // are seen in this session and after the next reopen.
  s = new SQliteStore({ path, D: 64 });
  await s.size();
  findsAll(s, 0, 200);
  for (let i = 200; i < 300; i++) s.canonAdd(H(i), i);
  await s.setMeta("canon.upto", "300");
  s.commit();
  findsAll(s, 0, 300);
  await s.close();

  // A writer that knows nothing of the filter (an older build) adds rows and
  // advances the cursor, as every canon build does — in the derived layer's
  // file, where the canonical index and its cursor live.
  const db = new DatabaseSync(path + ".derived.sqlite");
  for (let i = 300; i < 350; i++) {
    db.prepare("INSERT INTO canon (h, id) VALUES (?, ?)").run(H(i), i);
  }
  db.prepare("UPDATE meta SET val = '350' WHERE key = 'canon.upto'").run();
  db.close();

  s = new SQliteStore({ path, D: 64 });
  await s.size();
  findsAll(s, 0, 350);
  assert.deepEqual(s.canonFind(H(9999)), [], "an absent key is not proposed");
  await s.close();
});

test("the filter reads every bit of the hash, not only those below its mask", async () => {
  // A stored hash sharing a probe's bits below the mask must not answer for
  // it: positions read off those bits alone made one probe in 16 a false
  // positive on the 31.7M-node store, whatever the bits per key.
  const s = new SQliteStore({ path: ":memory:", D: 64 });
  await s.size();
  const b = new s._bloom.constructor(17);
  let h = 2166136261;
  const keys = [];
  for (let i = 0; i < 2000; i++) {
    h = Math.imul(h ^ i, 16777619) >>> 0;
    keys.push(h);
    b.add(h);
  }
  for (const k of keys) assert.ok(b.mightContain(k), "no false negative");
  const twins = keys.filter((k) => b.mightContain((k ^ 0x80000000) >>> 0));
  assert.ok(
    twins.length < keys.length / 20,
    `${twins.length} of ${keys.length} high-bit twins pass the filter`,
  );
  await s.close();
});
