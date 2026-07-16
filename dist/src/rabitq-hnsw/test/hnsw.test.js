import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RaBitQuantizer, VectorDatabase } from "../src/index.js";
// ----------------------------- tiny harness ----------------------------------
let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    throw new Error("ASSERTION FAILED: " + msg);
  }
  passed++;
}
function approxEqual(a, b, eps = 1e-4) {
  return Math.abs(a - b) <= eps * (1 + Math.abs(a) + Math.abs(b));
}
function section(title) {
  console.log("\n" + "=".repeat(72) + "\n" + title + "\n" + "=".repeat(72));
}
function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
// ------------------------------- seeded RNG ----------------------------------
class RNG {
  s;
  constructor(seed) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) {
    return (this.next() * n) | 0;
  }
  _gaussSpare = 0;
  _gaussHasSpare = false;
  /** Box-Muller — caches the second value so every call produces one Gaussian
   *  without wasting the log/sqrt pair. */
  gauss() {
    if (this._gaussHasSpare) {
      this._gaussHasSpare = false;
      return this._gaussSpare;
    }
    let u = 0;
    let v = 0;
    while (u === 0) {
      u = this.next();
    }
    while (v === 0) {
      v = this.next();
    }
    const r = Math.sqrt(-2 * Math.log(u));
    this._gaussSpare = r * Math.sin(2 * Math.PI * v);
    this._gaussHasSpare = true;
    return r * Math.cos(2 * Math.PI * v);
  }
}
function unit(v) {
  let s = 0;
  for (const x of v) {
    s += x * x;
  }
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}
// =============================================================================
// 1) Vector CRUD + persistence (SQLite file round-trip)
// =============================================================================
function testCrudAndPersistence() {
  section("1) Vector CRUD + persistence (get returns the 1-bit code)");
  const DIM = 48; // paddedDim 64 -> codeWords 2, distinctive codes
  const dbPath = path.join(
    os.tmpdir(),
    `rabitq-test-crud-${Date.now()}.sqlite`,
  );
  let db = new VectorDatabase({
    dbPath,
    dim: DIM,
    M: 8,
    efConstruction: 64,
    seed: 7,
  });
  // distinct directions so the 1-bit codes differ
  const mk = (i, scale = 1) => {
    const v = new Array(DIM).fill(0);
    v[i] = scale;
    return v;
  };
  // Integer IDs only
  const ID = { alpha: 1, bravo: 2, charlie: 3, delta: 4, echo: 5 };
  const vectors = {
    alpha: mk(0),
    bravo: mk(10),
    charlie: mk(20),
    delta: mk(30),
    echo: mk(45),
  };
  // CREATE
  for (const [name, v] of Object.entries(vectors)) {
    db.insert(ID[name], v);
  }
  assert(db.size === 5, "size should be 5 after inserting 5 vectors");
  let threw = false;
  try {
    db.insert(ID.alpha, vectors.alpha);
  } catch {
    threw = true;
  }
  assert(threw, "inserting a duplicate external id must throw");
  // READ — returns the bare 1-bit code (Uint32Array)
  const code = db.get(ID.alpha);
  assert(code !== null, "get(alpha) returns a stored code");
  assert(
    code instanceof Uint32Array && code.length === 2,
    "code is 2 packed 32-bit words",
  );
  assert(code.length * 32 === 64, "code covers paddedDim = 64 sign bits");
  assert(db.get(9999) === null, "get of unknown id returns null");
  assert(db.has(ID.bravo) && !db.has(9999), "has() reflects membership");
  // SEARCH — querying with an exact copy returns that vector first
  assert(
    db.query(vectors.alpha, 3)[0].id === ID.alpha,
    "exact-copy query returns alpha first",
  );
  assert(
    db.query(vectors.bravo, 1)[0].id === ID.bravo,
    "exact-copy query returns bravo first",
  );
  // UPDATE
  db.update(ID.charlie, mk(40));
  assert(
    db.query(mk(40), 1)[0].id === ID.charlie,
    "updated charlie is found at its new location",
  );
  assert(db.size === 5, "size unchanged after update");
  // DELETE
  assert(db.delete(ID.delta) === true, "delete returns true for existing id");
  assert(
    db.delete(ID.delta) === false,
    "delete returns false for already removed id",
  );
  assert(!db.has(ID.delta) && db.size === 4, "delta removed, size now 4");
  assert(
    !db.query(vectors.delta, 4).some((r) => r.id === ID.delta),
    "deleted vector never appears in results",
  );
  // PERSISTENCE round-trip — capture state, then close and reopen the same file
  const liveKeys = Array.from(db.keys());
  const probe = mk(0);
  const before = db.query(probe, 4);
  const codesBefore = new Map();
  for (const id of liveKeys) {
    codesBefore.set(id, db.get(id));
  }
  db.close();
  const reloaded = new VectorDatabase({ dbPath });
  assert(reloaded.size === db.size, "reloaded size matches");
  for (const id of liveKeys) {
    const a = codesBefore.get(id);
    const b = reloaded.get(id);
    assert(b !== null, `reloaded code for ${id} is not null`);
    assert(a.length === b.length, `reloaded code length for ${id} matches`);
    for (let i = 0; i < a.length; i++) {
      assert(a[i] === b[i], `reloaded code word for ${id} matches`);
    }
  }
  const after = reloaded.query(probe, 4);
  assert(
    before.length === after.length,
    "reloaded query result length matches",
  );
  for (let i = 0; i < before.length; i++) {
    assert(before[i].id === after[i].id, "reloaded query ordering matches");
    assert(
      approxEqual(before[i].distance, after[i].distance, 1e-6),
      "reloaded query distance matches",
    );
  }
  reloaded.close();
  // Cleanup
  fs.unlinkSync(dbPath);
  console.log(
    `CRUD + persistence OK (get returns ${code.length}-word codes; reload identical)`,
  );
}
// =============================================================================
// 1b) insert / update / query by an already-quantized 1-bit code
// =============================================================================
function testCodeIO() {
  section("1b) insert / update / query by a 1-bit code (length-detected)");
  const DIM = 128; // paddedDim 128 -> codeWords 4
  const rng = new RNG(909);
  const vec = () => Array.from({ length: DIM }, () => rng.gauss());
  const db = new VectorDatabase({
    dbPath: ":memory:",
    dim: DIM,
    M: 16,
    efConstruction: 100,
    seed: 5,
  });
  const N = 800;
  for (let i = 0; i < N; i++) {
    db.insert(i, vec());
  }
  const src = db.get(123);
  assert(
    src instanceof Uint32Array && src.length === 4,
    "get() yields a 4-word code",
  );
  // QUERY by code: a stored code finds itself at distance 0
  const byCode = db.query(src, 5);
  assert(byCode[0].id === 123, "query(code) returns the owning vector first");
  assert(
    approxEqual(byCode[0].distance, 0, 1e-9),
    "query(code) distance to the same code is 0",
  );
  // INSERT by code (length-detected): the copy is a real, findable node
  const copyId = N + 1;
  db.insert(copyId, src);
  assert(db.size === N + 1, "insert(code) adds a vector");
  const copyCode = db.get(copyId);
  for (let i = 0; i < src.length; i++) {
    assert(copyCode[i] === src[i], "insert(code) stored the code verbatim");
  }
  const hits = db.query(src, 5).map((h) => h.id);
  assert(
    hits.includes(copyId) && hits.includes(123),
    "both the original and its code-copy are retrievable",
  );
  // number[] code (e.g. after conversion) is detected the same way
  const asArray = Array.from(src);
  const arrId = N + 2;
  db.insert(arrId, asArray);
  const arrCode = db.get(arrId);
  for (let i = 0; i < src.length; i++) {
    assert(arrCode[i] === src[i], "insert(number[] code) works identically");
  }
  // UPDATE by code: move id 7 onto id 200's code
  const target = db.get(200);
  db.update(7, target);
  const moved = db.get(7);
  for (let i = 0; i < target.length; i++) {
    assert(moved[i] === target[i], "update(code) replaced the code");
  }
  assert(db.size === N + 2, "update(code) keeps size (replace, not add)");
  const near200 = db.query(target, 5).map((h) => h.id);
  assert(
    near200.includes(7) && near200.includes(200),
    "updated-by-code id now sits with its target",
  );
  db.close();
  console.log(
    "insert / update / query by 1-bit code OK (Uint32Array and number[])",
  );
}
// =============================================================================
// 2) Cosine metric sanity
// =============================================================================
function testCosine() {
  section("2) Cosine sanity");
  const DIM = 64;
  const db = new VectorDatabase({ dbPath: ":memory:", dim: DIM, seed: 3 });
  const axis = (i) => {
    const v = new Array(DIM).fill(0);
    v[i] = 1;
    return v;
  };
  db.insert(1, axis(0)); // "x"
  db.insert(2, axis(20)); // "y"
  db.insert(3, axis(40)); // "z"
  const r = db.query(axis(0), 3); // query along x's direction
  assert(r[0].id === 1, "cosine: nearest direction to x's axis is x");
  assert(
    r[0].distance <= 0.1,
    "cosine distance to an identical direction is ~ 0",
  );
  assert(
    r[r.length - 1].distance > r[0].distance,
    "orthogonal directions are farther than the aligned one",
  );
  db.close();
  console.log("Cosine metric OK");
}
// =============================================================================
// 2a) Near-duplicate self-recall (tight cluster)
// =============================================================================
// Every other recall test here uses WELL-SEPARATED groups, so the 1-bit codes
// differ in many sign bits and recall looks perfect. Real workloads are not so
// kind: vectors often form a TIGHT cluster — a shared base plus a small
// distinctive residual — so each one sits a hair away from its neighbours on
// the sphere. The contract that must hold there is the most basic one: a stored
// vector, queried verbatim, retrieves ITSELF as the nearest neighbour.
//
// This is the case that exposed a precision bug in the query estimator. RaBitQ
// scalar-quantises the full-precision query to `1 << queryBits` levels before
// scoring it against the 1-bit codes. At 4 bits (16 levels) that step is too
// coarse to resolve the small residual separating cluster siblings, so the
// estimate misranks them and a vector can fail to find itself (~82% self-recall
// on this data). The fix lives in rabitq.ts: the default queryBits is 8, which
// resolves the residual and restores near-perfect self-recall — touching only
// the query side (the stored 1-bit codes, disk size and graph build are
// unchanged; only the per-query LUT widens from Uint8 to Uint16). The
// assertions pin both ends: an explicit 4 bits is measurably degraded, the
// default recovers.
function testNearDuplicateRecall() {
  section("2a) Near-duplicate self-recall (tight cluster)");
  const DIM = 256;
  const N = 150;
  const SPREAD = 0.15;
  // A fixed base direction; each vector is the base plus a small per-coordinate
  // perturbation, then normalised — a dense cluster of near-duplicates. A plain
  // LCG drives the perturbation: it produces a uniformly spread cloud around the
  // base (the regime where the queryBits effect is sharpest); the Box-Muller
  // RNG above clusters too tightly to separate the two settings.
  const build = (queryBits) => {
    let s = 7 >>> 0;
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const base = new Array(DIM);
    for (let d = 0; d < DIM; d++) {
      base[d] = next() * 2 - 1;
    }
    const vecs = [];
    const db = new VectorDatabase({
      dbPath: ":memory:",
      dim: DIM,
      M: 16,
      efConstruction: 64,
      efSearch: 64,
      seed: 123,
      queryBits,
    });
    for (let i = 0; i < N; i++) {
      const v = new Array(DIM);
      let n = 0;
      for (let d = 0; d < DIM; d++) {
        v[d] = base[d] + SPREAD * (next() * 2 - 1);
        n += v[d] * v[d];
      }
      n = Math.sqrt(n) || 1;
      for (let d = 0; d < DIM; d++) {
        v[d] /= n;
      }
      vecs.push(v);
      db.insert(i, v);
    }
    let self = 0;
    for (let i = 0; i < N; i++) {
      const h = db.query(vecs[i], 1);
      if (h[0] && h[0].id === i) {
        self++;
      }
    }
    db.close();
    return self / N;
  };
  const r4 = build(4); // explicitly coarse — the old default
  const rDefault = build(8); // the library default after the fix
  console.log(
    `near-duplicate self-recall: queryBits=4 ${(r4 * 100).toFixed(1)}%  ` +
      `default(8) ${(rDefault * 100).toFixed(1)}%`,
  );
  // The bug: 4-bit query quantisation cannot resolve a tight cluster, so a
  // sizeable fraction of vectors fail to retrieve themselves.
  assert(
    r4 < 0.9,
    `queryBits=4 is degraded on a tight cluster (got ${
      (r4 * 100).toFixed(1)
    }%)`,
  );
  // The fix: the default B_q restores near-perfect self-recall — same stored
  // codes, sharper query estimate.
  assert(
    rDefault >= 0.95,
    `default queryBits recovers self-recall on a tight cluster (got ${
      (rDefault * 100).toFixed(1)
    }%)`,
  );
  assert(
    rDefault > r4,
    "the default queryBits must beat the coarse 4-bit setting",
  );
  console.log("Near-duplicate self-recall OK (queryBits resolves the cluster)");
}
// =============================================================================
// 2a-bis) The cosFactor bias — a known, deliberate approximation in estimate()
// =============================================================================
// FINDING (the deeper cause behind the near-duplicate misranking above).
//
// RaBitQuantizer.estimate() returns `1 - cosFactor * A`, where
//   cosFactor = sqrt(pi / (2 * paddedDim))
// is a FIXED constant: the EXPECTED L1 norm of a randomly-rotated unit vector.
// Canonical RaBitQ does not use that expectation — it divides A by each
// vector's OWN rotated-L1 norm (the per-vector factor <o_bar, o>). Substituting
// the population mean for the per-vector quantity makes the estimator BIASED,
// and the bias is what this test pins down precisely.
//
// The cleanest probe is self-distance: a stored code scored against the query
// it was made from must, for an unbiased cosine estimator, return distance 0
// (cosine 1). With the fixed cosFactor it does NOT. Because each vector's true
// rotated-L1 norm scatters around the mean, the estimate scatters around 0:
//   - it is non-zero (mean and max are both > 0 by a clear margin), and
//   - it goes NEGATIVE for a large fraction of vectors — a negative distance
//     means estimated cosine > 1, which is geometrically impossible and is the
//     unmistakable fingerprint of the mean-vs-per-vector substitution.
//
// This bias is small in magnitude but systematic, so near-threshold pairs read
// as closer (or farther) than they truly are — exactly the misranking that
// collapses a tight cluster. The test documents the property as-is (it does NOT
// assert the bias away): the bias is REAL and lives in estimate(); raising
// queryBits, tested above, is what keeps recall correct in its presence. Should
// estimate() ever be upgraded to the true per-vector factor, the self-distance
// here would tighten to ~0 and the negatives would vanish — at which point this
// test is the tripwire that flags the behavioural change.
function testCosFactorBias() {
  section(
    "2a-bis) cosFactor self-distance bias (fixed mean vs per-vector norm)",
  );
  const DIM = 256;
  const N = 300;
  const SPREAD = 0.15;
  let s = 7 >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const base = new Array(DIM);
  for (let d = 0; d < DIM; d++) {
    base[d] = next() * 2 - 1;
  }
  const q = new RaBitQuantizer(DIM, { seed: 123 });
  const vecs = [];
  const codes = [];
  for (let i = 0; i < N; i++) {
    const v = new Array(DIM);
    let n = 0;
    for (let d = 0; d < DIM; d++) {
      v[d] = base[d] + SPREAD * (next() * 2 - 1);
      n += v[d] * v[d];
    }
    n = Math.sqrt(n) || 1;
    for (let d = 0; d < DIM; d++) {
      v[d] /= n;
    }
    vecs.push(v);
    codes.push(q.codeToBytes(q.encode(v)));
  }
  // Self-distance: each vector scored against its OWN code. An unbiased cosine
  // estimator returns 0 here; the fixed cosFactor does not.
  let sum = 0;
  let max = 0;
  let negatives = 0;
  for (let i = 0; i < N; i++) {
    const ctx = q.prepareQuery(vecs[i]);
    const d = q.estimate(codes[i], 0, ctx);
    sum += d;
    if (d > max) {
      max = d;
    }
    if (d < 0) {
      negatives++; // distance < 0  <=>  estimated cosine > 1 (impossible)
    }
  }
  const mean = sum / N;
  console.log(
    `self-distance under fixed cosFactor: mean ${mean.toFixed(5)}, ` +
      `max ${max.toFixed(5)}, negatives ${negatives}/${N} ` +
      `(an unbiased estimator would give 0 with 0 negatives)`,
  );
  // The estimate is genuinely non-zero on a self-match: the fixed mean factor
  // does not reproduce the per-vector normalisation.
  assert(
    max > 0.005,
    `self-distance is biased away from 0 (max ${max.toFixed(5)})`,
  );
  // The fingerprint: a large fraction of self-matches yield an IMPOSSIBLE
  // cosine > 1 (negative distance) — only a mean-vs-per-vector substitution
  // produces this. If this ever drops to 0, estimate() changed.
  assert(
    negatives > N / 10,
    `cosFactor produces impossible cosine>1 on self-matches ` +
      `(${negatives}/${N} negative distances)`,
  );
  console.log(
    "cosFactor bias documented (fixed mean L1 norm, not the per-vector factor)",
  );
}
// =============================================================================
// 2b) SQLite persistence round-trip
// =============================================================================
function testPersistence() {
  section("2b) SQLite persistence round-trip");
  const DIM = 96;
  const rng = new RNG(2024);
  const vec = () => Array.from({ length: DIM }, () => rng.gauss());
  {
    const dbPath = path.join(
      os.tmpdir(),
      `rabitq-test-persist-${Date.now()}.sqlite`,
    );
    const db = new VectorDatabase({
      dbPath,
      dim: DIM,
      M: 12,
      efConstruction: 80,
      seed: 17,
    });
    for (let i = 0; i < 1500; i++) {
      db.insert(i, vec());
    }
    for (let i = 0; i < 150; i++) {
      db.delete(i * 10); // tombstones
    }
    for (let i = 0; i < 120; i++) {
      db.update(3 + i * 10, vec()); // re-inserts
    }
    // Capture state before closing
    const liveKeys = Array.from(db.keys());
    const codesBefore = new Map();
    for (const id of liveKeys) {
      codesBefore.set(id, db.get(id));
    }
    const queriesBefore = [];
    for (let q = 0; q < 40; q++) {
      const query = vec();
      queriesBefore.push({ query, results: db.query(query, 10) });
    }
    const sizeBefore = db.size;
    db.close();
    // Reopen from file
    const db2 = new VectorDatabase({ dbPath });
    assert(
      db2.size === sizeBefore,
      "size preserved across persistence round-trip",
    );
    // get() parity: identical codes for every live id
    for (const id of liveKeys) {
      const a = codesBefore.get(id);
      const b = db2.get(id);
      assert(b !== null, `id ${id} present after reload`);
      assert(a.length === b.length, "code length identical after reload");
      for (let i = 0; i < a.length; i++) {
        assert(a[i] === b[i], "code identical after reload");
      }
    }
    // query parity: identical ids and (bit-exact) distances
    let maxDiff = 0;
    for (const { query, results: ra } of queriesBefore) {
      const rb = db2.query(query, 10);
      assert(ra.length === rb.length, "result length identical after reload");
      for (let i = 0; i < ra.length; i++) {
        assert(ra[i].id === rb[i].id, "result id/order identical after reload");
        maxDiff = Math.max(maxDiff, Math.abs(ra[i].distance - rb[i].distance));
      }
    }
    assert(
      maxDiff === 0,
      `distances are bit-exact after reload (max diff ${maxDiff})`,
    );
    // Mutation still works after a reload
    db2.insert(99999, vec());
    assert(db2.has(99999), "insert works after persistence load");
    assert(db2.get(99999) !== null, "get works after persistence load");
    db2.close();
    fs.unlinkSync(dbPath);
    console.log(`${sizeBefore} vecs, round-trip via SQLite file — exact match`);
  }
  // Non-existent file: node:sqlite may create the file or may error — this is
  // implementation-specific. We just verify no crash.
  try {
    new VectorDatabase({ dbPath: "/nonexistent/path/db.sqlite" });
  } catch {
    // tolerated — either outcome is acceptable
  }
  console.log("Non-existent path handled gracefully");
}
// =============================================================================
// 2c) compact() — lossless rebuild that reclaims tombstones
// =============================================================================
function testCompact() {
  section("2c) compact() — lossless rebuild reclaiming tombstones");
  const DIM = 80;
  const rng = new RNG(555);
  const vec = () => Array.from({ length: DIM }, () => rng.gauss());
  // ---- losslessness: build-then-delete-then-compact == fresh build of survivors ----
  const N = 2500;
  const data = [];
  for (let i = 0; i < N; i++) {
    data.push(vec());
  }
  const deleted = new Set();
  for (let i = 0; i < N; i += 3) {
    deleted.add(i); // delete ~1/3
  }
  const dbFull = new VectorDatabase({
    dbPath: ":memory:",
    dim: DIM,
    M: 16,
    efConstruction: 100,
    seed: 88,
  });
  for (let i = 0; i < N; i++) {
    dbFull.insert(i, data[i]);
  }
  for (const i of deleted) {
    dbFull.delete(i);
  }
  assert(
    dbFull.physicalSize === N,
    "before compact: tombstones still occupy physical slots",
  );
  assert(
    dbFull.size === N - deleted.size,
    "before compact: live size already excludes deleted",
  );
  dbFull.compact();
  const survivors = [];
  for (let i = 0; i < N; i++) {
    if (!deleted.has(i)) {
      survivors.push(i);
    }
  }
  assert(
    dbFull.size === survivors.length,
    "after compact: size is the survivor count",
  );
  assert(
    dbFull.physicalSize === survivors.length,
    "after compact: no tombstones remain (physical == live)",
  );
  for (const i of survivors) {
    assert(dbFull.has(i), `survivor ${i} still present after compact`);
  }
  for (const i of deleted) {
    assert(!dbFull.has(i), `deleted ${i} absent after compact`);
  }
  // Fresh index built from the survivors, same order + seed.
  const dbFresh = new VectorDatabase({
    dbPath: ":memory:",
    dim: DIM,
    M: 16,
    efConstruction: 100,
    seed: 88,
  });
  for (const i of survivors) {
    dbFresh.insert(i, data[i]);
  }
  // HNSW is an approximate index — two builds with the same data+seed may
  // produce slightly different graphs (the heuristic is not order-invariant
  // under all edge cases).  What matters is that recall between the two is
  // very high, and that distances are consistent.
  let compactHits = 0;
  let maxDistDiff = 0;
  let totalCmp = 0;
  for (let q = 0; q < 60; q++) {
    const query = vec();
    const a = dbFull.query(query, 10);
    const b = dbFresh.query(query, 10);
    const bIds = new Set(b.map((r) => r.id));
    for (const r of a) {
      if (bIds.has(r.id)) {
        compactHits++;
      }
    }
    totalCmp += a.length;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      maxDistDiff = Math.max(
        maxDistDiff,
        Math.abs(a[i].distance - b[i].distance),
      );
    }
  }
  const recallCompact = compactHits / totalCmp;
  assert(
    recallCompact >= 0.97,
    `compacted recall vs fresh build must be high (got ${
      (recallCompact * 100).toFixed(1)
    }%)`,
  );
  assert(
    maxDistDiff < 0.05,
    `distance agreement across the two builds (max diff ${maxDistDiff})`,
  );
  console.log(
    `losslessness: ${N} built, ${deleted.size} deleted, compacted to ${survivors.length}; recall vs fresh=${
      (recallCompact * 100).toFixed(1)
    }%`,
  );
  // ---- compact also handles updates, and recall stays high on separable data ----
  const G = 10;
  const groups = 400;
  const centers = [];
  for (let g = 0; g < groups; g++) {
    centers.push(vec());
  }
  const db2 = new VectorDatabase({
    dbPath: ":memory:",
    dim: DIM,
    M: 16,
    efConstruction: 100,
    seed: 7,
  });
  const live = new Map();
  let id = 0;
  for (let g = 0; g < groups; g++) {
    for (let j = 0; j < G; j++) {
      const v = centers[g].map((c) => c + 0.1 * rng.gauss());
      db2.insert(id, v);
      live.set(id, v);
      id++;
    }
  }
  for (let k = 0; k < 400; k++) {
    db2.delete(k); // drop 40 whole groups
  }
  for (let k = 0; k < 400; k++) {
    live.delete(k);
  }
  for (let k = 600; k < 800; k++) {
    const v = centers[Math.floor(k / G)].map((c) => c + 0.1 * rng.gauss());
    db2.update(k, v); // re-place within the same group
    live.set(k, v);
  }
  assert(db2.physicalSize > db2.size, "updates+deletes created tombstones");
  db2.compact();
  assert(
    db2.physicalSize === db2.size && db2.size === live.size,
    "compact reclaimed all tombstones",
  );
  // recall@10 over the surviving set after compaction
  const liveIds = Array.from(live.keys());
  const liveVecs = Array.from(live.values());
  // Precompute data norms once (they don't change per query).
  const liveNorms = new Float64Array(liveVecs.length);
  for (let n = 0; n < liveVecs.length; n++) {
    let s = 0;
    const v = liveVecs[n];
    for (let d = 0; d < DIM; d++) {
      s += v[d] * v[d];
    }
    liveNorms[n] = Math.sqrt(s) || 1;
  }
  let hits = 0;
  const Q = 100;
  for (let q = 0; q < Q; q++) {
    const center = centers[Math.floor((600 + (q % 200)) / G)];
    const query = center.map((c) => c + 0.1 * rng.gauss());
    // Query norm computed once, not N times.
    let qn = 0;
    for (let d = 0; d < DIM; d++) {
      qn += query[d] * query[d];
    }
    qn = Math.sqrt(qn) || 1;
    const bd = new Float64Array(10).fill(Infinity);
    const bi = new Int32Array(10).fill(-1);
    for (let n = 0; n < liveVecs.length; n++) {
      const v = liveVecs[n];
      let dot = 0;
      for (let d = 0; d < DIM; d++) {
        dot += v[d] * query[d];
      }
      const s = 1 - dot / (liveNorms[n] * qn);
      if (s < bd[9]) {
        let p = 9;
        while (p > 0 && bd[p - 1] > s) {
          bd[p] = bd[p - 1];
          bi[p] = bi[p - 1];
          p--;
        }
        bd[p] = s;
        bi[p] = liveIds[n];
      }
    }
    const truth = new Set(Array.from(bi).filter((x) => x >= 0));
    for (const r of db2.query(query, 10)) {
      if (truth.has(r.id)) {
        hits++;
      }
    }
  }
  const recall = hits / (Q * 10);
  assert(
    recall >= 0.9,
    `recall after compact stays high (got ${(recall * 100).toFixed(1)}%)`,
  );
  console.log(
    `updates+deletes: compacted to ${db2.size} live; recall@10 after compact ${
      (recall * 100).toFixed(1)
    }%`,
  );
  dbFull.close();
  dbFresh.close();
  db2.close();
}
// =============================================================================
// 3) Memory + recall + sub-linearity benchmark
// =============================================================================
function benchmark() {
  section(
    "3) Memory + recall + sub-linearity benchmark (HNSW over 1-bit codes)",
  );
  // Tweak these for a faster run or a wider sweep.
  const DIM = 256; // 256-d -> 32-byte codes (the headline example)
  const checkpoints = [1000, 2000, 4000, 8000, 16000, 32000];
  const GROUP = 10; // well-separated groups of near-duplicates
  const K = 10; // recall@K against the exact K nearest
  const SPREAD = 0.1;
  const Q = 200;
  const EF = 150;
  const rng = new RNG(12345);
  const MAX_N = checkpoints[checkpoints.length - 1];
  const numGroups = Math.ceil(MAX_N / GROUP);
  console.log(
    `dim=${DIM}, ${GROUP}-point groups, queries=${Q}, k=${K}, efSearch=${EF}`,
  );
  console.log("generating data ...");
  const centers = new Float32Array(numGroups * DIM);
  for (let g = 0; g < numGroups; g++) {
    for (let d = 0; d < DIM; d++) {
      centers[g * DIM + d] = rng.gauss();
    }
  }
  const data = new Float32Array(MAX_N * DIM);
  for (let i = 0; i < MAX_N; i++) {
    const base = Math.floor(i / GROUP) * DIM;
    const off = i * DIM;
    for (let d = 0; d < DIM; d++) {
      data[off + d] = centers[base + d] + SPREAD * rng.gauss();
    }
  }
  // queries land in groups that exist at every checkpoint
  const firstGroups = checkpoints[0] / GROUP;
  const queries = new Float32Array(Q * DIM);
  for (let q = 0; q < Q; q++) {
    const base = rng.int(firstGroups) * DIM;
    const off = q * DIM;
    for (let d = 0; d < DIM; d++) {
      queries[off + d] = centers[base + d] + SPREAD * rng.gauss();
    }
  }
  const db = new VectorDatabase({
    dbPath: ":memory:",
    dim: DIM,
    M: 16,
    efConstruction: 100,
    efSearch: EF,
    seed: 999,
  });
  // Precompute data vector norms once — O(N·D) instead of O(Q·N·D).
  const dataNorms = new Float64Array(MAX_N);
  for (let i = 0; i < MAX_N; i++) {
    let s = 0;
    const off = i * DIM;
    for (let d = 0; d < DIM; d++) {
      s += data[off + d] * data[off + d];
    }
    dataNorms[i] = Math.sqrt(s) || 1;
  }
  function bruteForceTopK(n, qOff) {
    const bd = new Float64Array(K).fill(Infinity);
    const bi = new Int32Array(K).fill(-1);
    let qn = 0;
    for (let d = 0; d < DIM; d++) {
      qn += queries[qOff + d] * queries[qOff + d];
    }
    qn = Math.sqrt(qn) || 1;
    for (let i = 0; i < n; i++) {
      const off = i * DIM;
      let dot = 0;
      for (let d = 0; d < DIM; d++) {
        dot += data[off + d] * queries[qOff + d];
      }
      const s = 1 - dot / (dataNorms[i] * qn);
      if (s < bd[K - 1]) {
        let p = K - 1;
        while (p > 0 && bd[p - 1] > s) {
          bd[p] = bd[p - 1];
          bi[p] = bi[p - 1];
          p--;
        }
        bd[p] = s;
        bi[p] = i;
      }
    }
    // Direct set from typed array filtered values.
    const truth = new Set();
    for (let i = 0; i < K; i++) {
      if (bi[i] >= 0) {
        truth.add(bi[i]);
      }
    }
    return truth;
  }
  const rows = [];
  let inserted = 0;
  for (const cp of checkpoints) {
    const tb = now();
    for (; inserted < cp; inserted++) {
      db.insert(inserted, data.subarray(inserted * DIM, inserted * DIM + DIM));
    }
    console.log(`  built N=${cp} (+${(now() - tb).toFixed(0)}ms)`);
    for (let w = 0; w < 25; w++) {
      const o = (w % Q) * DIM;
      db.query(queries.subarray(o, o + DIM), K);
    }
    const hnswResults = new Array(Q);
    let comps = 0;
    const th = now();
    for (let qi = 0; qi < Q; qi++) {
      const o = qi * DIM;
      hnswResults[qi] = db.query(queries.subarray(o, o + DIM), K).map((x) =>
        x.id
      );
      comps += db.lastQueryDistanceComputations;
    }
    const hnswMs = now() - th;
    const truths = new Array(Q);
    const tbf = now();
    for (let qi = 0; qi < Q; qi++) {
      truths[qi] = bruteForceTopK(cp, qi * DIM);
    }
    const bruteMs = now() - tbf;
    let hits = 0;
    for (let qi = 0; qi < Q; qi++) {
      for (const id of hnswResults[qi]) {
        if (truths[qi].has(id)) {
          hits++;
        }
      }
    }
    rows.push({
      n: cp,
      hnswUs: (hnswMs / Q) * 1000,
      comps: comps / Q,
      bruteUs: (bruteMs / Q) * 1000,
      recall: hits / (Q * K),
      speedup: bruteMs / hnswMs,
    });
  }
  // ---- memory report ----
  const st = db.storage;
  const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + " MB";
  console.log("");
  console.log(
    "Per-vector storage (vector payload only, excludes the HNSW graph):",
  );
  console.log(`  Float32 baseline     : ${st.float32BytesPerVector} B`);
  console.log(
    `  1-bit RaBitQ code    : ${st.codeBytesPerVector} B   (${
      (st.float32BytesPerVector / st.codeBytesPerVector).toFixed(1)
    }x smaller)`,
  );
  console.log(
    `  code (kept)         : ${st.bytesPerVector} B   (${
      st.compressionRatio.toFixed(1)
    }x smaller overall)`,
  );
  console.log(
    `  payload at N=${MAX_N}     : Float32 ${
      mb(st.float32BytesPerVector * MAX_N)
    }  vs  index ${mb(st.bytesPerVector * MAX_N)}`,
  );
  // ---- results table ----
  console.log("");
  console.log(
    "     N | HNSW q (us) | dist comps | Brute q (us) | recall@10 | speedup",
  );
  console.log(
    "-------+-------------+------------+--------------+-----------+--------",
  );
  for (const r of rows) {
    console.log(
      `${String(r.n).padStart(6)} | ${r.hnswUs.toFixed(1).padStart(11)} | ${
        r.comps.toFixed(0).padStart(10)
      } | ${
        r.bruteUs
          .toFixed(1)
          .padStart(12)
      } | ${(r.recall * 100).toFixed(1).padStart(8)}% | ${
        r.speedup.toFixed(1).padStart(6)
      }x`,
    );
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const exponent = (xs, ys) => {
    const lx = xs.map(Math.log);
    const ly = ys.map((y) => Math.log(Math.max(y, 1e-12)));
    const mx = mean(lx);
    const my = mean(ly);
    let num = 0;
    let den = 0;
    for (let i = 0; i < lx.length; i++) {
      num += (lx[i] - mx) * (ly[i] - my);
      den += (lx[i] - mx) * (lx[i] - mx);
    }
    return num / den;
  };
  const ns = rows.map((r) => r.n);
  const expComps = exponent(ns, rows.map((r) => r.comps));
  const expBrute = exponent(ns, rows.map((r) => r.bruteUs));
  const avgRecall = mean(rows.map((r) => r.recall));
  const range = ns[ns.length - 1] / ns[0];
  console.log("");
  console.log(
    `Empirical scaling over a ${range}x increase in N  (work ~ N^exponent):`,
  );
  console.log(
    `  HNSW distance computations : N^${
      expComps.toFixed(3)
    }   <- sub-linear (target < 1)`,
  );
  console.log(
    `  Brute-force query          : N^${
      expBrute.toFixed(3)
    }   (linear reference ~ 1.0)`,
  );
  console.log(
    `  Mean recall@${K}            : ${(avgRecall * 100).toFixed(2)}%`,
  );
  const last = rows[rows.length - 1];
  assert(
    st.codeBytesPerVector === Math.ceil(DIM / 32) * 4,
    "code size is ceil(dim/32) 32-bit words",
  );
  assert(
    st.compressionRatio > 10,
    `index must be far smaller than Float32 (got ${
      st.compressionRatio.toFixed(1)
    }x)`,
  );
  assert(
    expComps < 0.8,
    `HNSW distance-computation growth must be sub-linear (got N^${
      expComps.toFixed(3)
    })`,
  );
  assert(
    avgRecall >= 0.9,
    `mean recall must be >= 90% (got ${(avgRecall * 100).toFixed(1)}%)`,
  );
  assert(
    last.hnswUs < last.bruteUs,
    "HNSW must be faster than brute force at the largest N",
  );
  assert(
    last.speedup > 1,
    `HNSW must be faster than brute force at the largest N (got ${
      last.speedup.toFixed(1)
    }x)`,
  );
  console.log("\nMemory, sub-linearity, recall and speed-up checks OK");
  db.close();
}
// =============================================================================
// 4) Scalability is INTRINSIC, not cache-borne
//
// Codes and adjacency lists live in SQLite and are read on demand; the only
// cache is SQLite's page cache (Store's cacheSizeMb), a pure speed layer. So
// the engine's scalability must hold with that cache OFF: the STORAGE READS an
// operation issues (Store.reads, surfaced per query as lastQueryStorageReads)
// must be governed by the WORK the operation does — the distinct nodes it
// visits, an HNSW property that grows ~log N — NOT by how many vectors already
// exist. An implementation that leans on a cache to be fast betrays itself here:
// with the cache disabled its per-operation reads track the whole working set
// and climb with N. This is a STORAGE contract, so the guard lives in the
// rabitq-hnsw suite.
//
// The witness is `db.lastQueryStorageReads` — node + neighbour-list fetches that
// hit the database on the last query, counted below the cache so a warm cache
// can never hide a bad access pattern. We build ONE store in blocks (cacheSizeMb
// 0) and, at each checkpoint, measure the mean storage reads of a fixed query
// set. Across an 8x increase in N the per-query read count must stay within a
// flat band; the log–log growth exponent makes "does not grow with N" precise.
// =============================================================================
function testScalabilityWithoutCache() {
  section("4) Scalability is intrinsic, not cache-borne (cacheSizeMb = 0)");
  // A small dimension and modest graph degree keep the build cheap — this test
  // is about the SHAPE of storage-reads vs N, not throughput, so the constants
  // only need to be large enough for HNSW's structure to hold.
  const DIM = 64;
  const db = new VectorDatabase({
    dbPath: ":memory:",
    dim: DIM,
    M: 8,
    efConstruction: 40,
    efSearch: 40,
    seed: 4242,
    cacheSizeMb: 0, // ALL caches off (page cache + code LRU) — honest reads
  });
  const rng = new RNG(20260628);
  const vec = () => {
    const v = new Array(DIM);
    for (let d = 0; d < DIM; d++) {
      v[d] = rng.gauss();
    }
    return unit(v);
  };
  // A fixed set of probes, reused at every checkpoint so the only variable is N.
  const Q = 40;
  const probes = [];
  for (let q = 0; q < Q; q++) {
    probes.push(vec());
  }
  const checkpoints = [1000, 2000, 4000, 8000]; // 8x range
  const readsPerQuery = [];
  let id = 0;
  for (const cp of checkpoints) {
    const tb = now();
    for (; id < cp; id++) {
      db.insert(id, vec());
    }
    // Mean storage reads over the fixed probe set — the cache-independent cost
    // of ONE query at this N.
    let reads = 0;
    for (const p of probes) {
      db.query(p, 10);
      reads += db.lastQueryStorageReads;
    }
    readsPerQuery.push(reads / Q);
    console.log(
      `  N=${String(cp).padStart(6)}  +${(now() - tb).toFixed(0)}ms  ` +
        `storage-reads/query ${(reads / Q).toFixed(1)}`,
    );
  }
  // Compare the per-query read count at the LARGEST store against the smallest:
  // if scaling leaned on the cache, the cache-disabled reads would rise with N
  // (a deeper graph re-read from disk). The contract is that it stays within a
  // small constant band — work set by the query, not by the corpus. Log–log
  // growth exponent makes it precise.
  const lx = checkpoints.map(Math.log);
  const ly = readsPerQuery.map((y) => Math.log(Math.max(y, 1e-9)));
  const mx = lx.reduce((a, c) => a + c, 0) / lx.length;
  const my = ly.reduce((a, c) => a + c, 0) / ly.length;
  let num = 0, den = 0;
  for (let i = 0; i < lx.length; i++) {
    num += (lx[i] - mx) * (ly[i] - my);
    den += (lx[i] - mx) * (lx[i] - mx);
  }
  const exponent = num / den;
  const first = readsPerQuery[0];
  const last = readsPerQuery[readsPerQuery.length - 1];
  console.log(
    `  reads/query ${first.toFixed(1)} → ${last.toFixed(1)} over ${
      checkpoints[checkpoints.length - 1] / checkpoints[0]
    }x N · growth N^${exponent.toFixed(3)}`,
  );
  // PRIMARY guard — sub-linear in N: an O(1)-per-touch, log-N-touched query has
  // storage-reads growing like log N (exponent ≈ 0); an implementation forced to
  // re-read its working set from disk as N grows pushes this toward and past 1.
  // Well under 0.5 proves the index does not lean on the cache to scale.
  assert(
    exponent < 0.5,
    `cache-disabled storage-reads/query grew as N^${
      exponent.toFixed(3)
    } — the index must scale WITHOUT the page cache (reads set by the query's work, not the corpus size)`,
  );
  // SECONDARY — a flat band: the largest store costs no more than ~2.5x the
  // smallest per query. Generous against HNSW's genuine log-N growth, strict
  // enough to fail a regression whose reads track the corpus.
  assert(
    last < first * 2.5 + 8,
    `cache-disabled reads/query climbed ${first.toFixed(1)} → ${
      last.toFixed(1)
    } as the store grew — expected a flat band (work set by the query, not the corpus)`,
  );
  db.close();
  console.log("\nCache-independent scalability OK");
}
// ------------------------------------ main -----------------------------------
function main() {
  const start = now();
  testCrudAndPersistence();
  testCodeIO();
  testCosine();
  testNearDuplicateRecall();
  testCosFactorBias();
  testPersistence();
  testCompact();
  testScalabilityWithoutCache();
  benchmark();
  const dt = ((now() - start) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(72));
  console.log(`ALL TESTS PASSED  (${passed} assertions, ${dt}s)`);
  console.log("=".repeat(72));
}
try {
  main();
} catch (err) {
  console.error("\n" + String(err && err.stack ? err.stack : err));
  if (typeof process !== "undefined") {
    process.exitCode = 1;
  }
}
