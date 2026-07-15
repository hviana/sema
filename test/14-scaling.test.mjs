// 14-scaling.test.mjs — TRAINING and INFERENCE must scale.
//
// This file is the single home for sema's scaling contracts (it absorbs the old
// 10-scale.test.mjs). It measures the two lifecycle halves separately and states,
// for each, the law it must obey:
//
//   TRAINING (ingestion)
//     • Constant rate: depositing data runs at a steady KB/s that does NOT
//       collapse as the store grows. We measure the STEADY-STATE incremental
//       rate (fresh batches into an already-warm, already-growing store), because
//       a cold first batch pays one-time setup amortised over few bytes and would
//       otherwise flatter small corpora.
//     • Correctness at scale: exact recall is preserved as N grows.
//
//   INFERENCE (answering)
//     • Sublinear in CORPUS size: the cost of one query barely moves as the store
//       grows by orders of magnitude — work is proportional to the query, not to
//       how much was learned. (exponent in corpus size ≪ 1.)
//     • Constant rate in INPUT length: a query of n bytes costs ~c·n, i.e. a
//       steady KB/s of input processed, regardless of how long the input is.
//       (Linear time ⟺ constant throughput; the guard is that it is not
//       SUPER-linear — no quadratic blow-up.)
//
// INDEPENDENT CORPORA: every size point is built from its OWN disjoint corpus
// (a distinct salt → distinct tokens, no shared forms across points). So a growth
// curve reflects genuine scaling, never reuse of a warm cache or shared nodes —
// the growth exponent is the proof.
//
// Method: medians of repeated runs; a power law t ≈ c·n^k fit by log–log least
// squares; throughput as KB processed per second.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// ── measurement helpers ──────────────────────────────────────────────────
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const fastest = (xs) => Math.min(...xs); // least-noisy lower bound on cost

/** Power-law exponent k in t ≈ c·n^k, by log–log least squares.
 *  k≈0 flat · k≈1 linear · k≈2 quadratic. */
function logLogSlope(sizes, times) {
  const n = sizes.length;
  const xs = sizes.map(Math.log), ys = times.map(Math.log);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return num / den;
}

const bytesOf = (pairs) => {
  let b = 0;
  for (const [q, a] of pairs) {
    b += new TextEncoder().encode(q).length +
      new TextEncoder().encode(a).length;
  }
  return b;
};

// ── INDEPENDENT corpora ────────────────────────────────────────────────────
// `salt` makes every corpus disjoint from every other: distinct ids, distinct
// answers, no shared learned forms. A "fact" is a question→answer pair built
// from the salt and index alone.
function corpus(n, salt) {
  const pairs = [];
  for (let i = 0; i < n; i++) {
    // The index appears in BOTH question and answer, so every pair is unique and
    // distinguishable — no two questions fold toward a colliding answer (which
    // would make exact recall ambiguous through no fault of the store).
    const id = `${salt}n${i}`;
    pairs.push([`query ${id} please?`, `answer for ${id} is value ${i}`]);
  }
  return pairs;
}

// All-unknown filler whose tokens are substrings of no learned form — isolates
// the segmentation/scan cost of inference from any recall work.
function unknownInput(targetBytes) {
  const out = [];
  let len = 0, i = 0;
  while (len < targetBytes) {
    const tok = `zq${i}wx`;
    out.push(tok);
    len += tok.length + 1;
    i++;
  }
  return out.join(" ");
}

// =========================================================================
// TRAINING — constant-rate ingestion + exact recall at scale
// =========================================================================

// ── why the OLD constant-rate test missed the real regression ───────────────
// The earlier guard poured several `corpus()` batches into one growing store and
// compared early-vs-late wall-clock KB/s. It missed the real regression for two
// reasons this rewrite removes:
//
//   1. It timed BATCHES of scaffolding-sharing pairs. `corpus()` pairs share a fixed
//      frame ("query … please?"), so most of each later batch DEDUPS — the costly
//      path (intern + INDEX a new node) is rarely hit, and per-batch KB/s stays
//      flat regardless of store size.
//   2. WALL-CLOCK at test scale is too noisy to assert on: GC and scheduling
//      jitter swamp the signal over a few thousand deposits, so any strict
//      degradation bound is either flaky or so loose it catches nothing.
//
// The real degradation lived in the vector index (rabitq-hnsw) and is now guarded
// DETERMINISTICALLY at its own layer (testScalabilityWithoutCache, on the
// cache-independent storage-read count). HERE we assert the same contract end to
// end through the Mind, also by STORAGE READS rather than time: the work one
// recall touch does in the content index must be set by the query, not by how
// many vectors the store holds. Reads are exact and jitter-free, so the bound can
// be strict and the test fast.

// A genuinely-novel experience of distinctive words — every call interns fresh
// leaves/branches and indexes new gists (the expensive path), so the store grows
// with real, non-dedup content.
function novelExperience(i, salt) {
  const w = [];
  for (let k = 0; k < 8; k++) w.push(`${salt}w${i}x${k}q${(i * 7 + k * 3)}`);
  return w.join(" ");
}

// DEGRADATION GUARD (the headline), measured by STORAGE READS, not time. Build a
// SMALL store and a ~10x LARGER one from disjoint novel content, then resonate
// the SAME fixed query against each and compare how many content-index rows the
// lookup read. A recall touch visits ~log N nodes, so reads may rise a little
// with N — but a store that degraded (re-reading a working set that grows with
// the corpus) would show reads climbing roughly with N. The bound is strict
// because the count is exact and cache-independent.
test("training: recall work does NOT grow with the store (storage reads, not time)", async () => {
  const probe = "fixed distinctive probe alpha beta gamma delta epsilon";
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });

  // Reads the SAME fixed query touches in the content index at the current store
  // size. The page cache does not matter — reads are counted below it — so we
  // run with the default cache for a fast build and still measure the honest,
  // cache-independent cost.
  const readsNow = async () => {
    await mind.respond(probe); // warm the scan automaton
    await mind.respond(probe); // the measured resonate
    return store.lastResonateReads();
  };

  // Grow ONE store from a small N to a ~6x larger N (disjoint novel content each
  // step), measuring the fixed query's reads at each size. One store keeps the
  // build cheap; the only variable across the two measurements is corpus size.
  const grow = async (from, to) => {
    for (let i = from; i < to; i++) await mind.ingest(novelExperience(i, "g"));
  };

  await grow(0, 300);
  const small = await readsNow();
  await grow(300, 1800); // 6x the corpus
  const large = await readsNow();
  await store.close();

  console.log(
    `    content-index reads for one recall: N=300 → ${small}, N=1800 → ${large}`,
  );

  // 6x the corpus must not cost anywhere near 6x the reads. A genuinely
  // sublinear (~log N) lookup barely moves; a per-recall cost that tracked the
  // corpus would roughly 6x. Allow a generous 3x band for HNSW's log-N growth
  // and graph-shape variation, far below the ~6x a true O(N) regression shows.
  assert.ok(
    large < small * 3 + 50,
    `one recall read ${small} content-index rows at N=300 but ${large} at ` +
      `N=1800 (6x corpus) — recall work is growing with the store; training/` +
      `inference must stay sublinear in corpus size`,
  );
});

// ABSOLUTE THROUGHPUT FLOOR (catches plain slowness, independent of N). Even a
// perfectly flat curve is useless if the constant is tiny. Deposit novel
// experiences into a small, warm store and require a sane KB/s floor, so a
// regression that makes EVERY deposit slow (not just large stores) also fails.
// This is a coarse smoke floor, set well below a healthy build, so machine speed
// and jitter never make it flaky — it only trips on a genuine slowdown.
test("training: absolute deposition throughput clears a sane floor", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });

  // Warm up (JIT, index init) so this measures steady-state per-deposit cost,
  // not one-time setup.
  for (let i = 0; i < 200; i++) await mind.ingest(novelExperience(i, "warm"));

  const N = 1000;
  let bytes = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const x = novelExperience(i, "floor");
    bytes += new TextEncoder().encode(x).length;
    await mind.ingest(x);
  }
  const secs = (performance.now() - t0) / 1000;
  const kbps = bytes / 1024 / secs;
  await store.close();

  console.log(
    `    absolute deposition throughput: ${kbps.toFixed(1)} KB/s ` +
      `(${N} novel experiences, ${(bytes / 1024).toFixed(0)} KB)`,
  );

  // A generous floor: well below what a healthy build sustains, but far above a
  // regressed one. Deposition is CPU-bound perception + a bounded number of
  // index writes; it should clear several KB/s even on a slow machine.
  const FLOOR = 5;
  assert.ok(
    kbps > FLOOR,
    `deposition ran at ${
      kbps.toFixed(1)
    } KB/s — below the ${FLOOR} KB/s floor; training is too slow`,
  );
});

// Distinctive facts — every pair has its own adjective·noun·verb·number content,
// so each is genuinely separable (NOT the scaffolding-dominated near-duplicates of
// `corpus()`, whose collisions are the intelligence file's concern). This is the
// corpus on which exact recall SHOULD be perfect.
const ADJ = [
  "crystal",
  "ancient",
  "silent",
  "burning",
  "hollow",
  "gilded",
  "frozen",
  "wandering",
];
const NOUN = [
  "river",
  "archive",
  "compass",
  "lantern",
  "garden",
  "engine",
  "harbor",
  "mirror",
];
const VERB = [
  "holds",
  "guards",
  "reveals",
  "feeds",
  "remembers",
  "follows",
  "shelters",
  "names",
];
function distinctiveCorpus(n) {
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const a = ADJ[i % 8], no = NOUN[(i >> 3) % 8], v = VERB[(i >> 6) % 8];
    const id = `${a} ${no} ${i}`;
    pairs.push([
      `what does the ${id} ${v}?`,
      `the ${id} ${v} the ${ADJ[(i + 3) % 8]} ${NOUN[(i + 5) % 8]} of ${i * 7}`,
    ]);
  }
  return pairs;
}

// Training must not blur or drop a learned fact as the corpus grows: a fact that
// was deposited must recall EXACTLY. This is the deposition correctness contract.
//
// KNOWN REGRESSION (2026-06-27): on the current build this FAILS — exact recall
// is only ~50% at N=400 (and degrades with N), because the resonance/near-dedup
// merge + 1-bit codec collapses distinct-but-similar gists at scale. The bar is
// strict ON PURPOSE so the regression stays visible until the at-scale recall
// accuracy is fixed; it is NOT relaxed to hide the loss. (The old N=400 recall
// assertion existed but was SEMA_SCALE-skipped, so this went unnoticed.)
test("training: exact recall is preserved at scale", async () => {
  const N = process.env.SEMA_SCALE ? Number(process.env.SEMA_SCALE) : 120;
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  const pairs = distinctiveCorpus(N);
  await mind.ingest(pairs);

  const sample = Math.min(40, N);
  let exact = 0;
  const misses = [];
  for (let s = 0; s < sample; s++) {
    const i = Math.floor((s * N) / sample);
    const got = await mind.respondText(pairs[i][0]);
    if (got === pairs[i][1]) exact++;
    else if (misses.length < 3) {
      misses.push(`"${pairs[i][0]}" → "${got.slice(0, 40)}"`);
    }
  }
  const entries = await mind.store.size();
  await mind.store.close();
  console.log(
    `    N=${N}: ${entries} entries, exact recall ${exact}/${sample}`,
  );
  assert.equal(
    exact,
    sample,
    `only ${exact}/${sample} distinctive facts recalled exactly at N=${N} — ` +
      `every deposited fact must recall exactly. KNOWN REGRESSION: at-scale ` +
      `recall is degraded by gist over-merge + lossy codec; fix the store's ` +
      `merge/recall accuracy, do not relax this bar.\n  ` +
      misses.join("\n  "),
  );
});

// =========================================================================
// INFERENCE — sublinear in corpus, constant-rate in input length
// =========================================================================

// One fixed query, INDEPENDENT corpora of growing size. The cost must barely
// move: inference work is proportional to the QUERY, not to the corpus. The
// growth exponent in corpus size is the proof — it must be well below linear.
test("inference: cost is sublinear in corpus size (independent corpora)", async () => {
  const query = unknownInput(1024);
  const sizes = [50, 200, 800, 3200];
  const times = [];

  for (const n of sizes) {
    const store = new SQliteStore({ path: ":memory:" });
    const mind = new Mind({ seed: 7, store });
    await mind.ingest(corpus(n, `infcorp${n}`)); // disjoint corpus per point
    await mind.respond(query); // warm the scan automaton
    const samples = [];
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      await mind.respond(query);
      samples.push(performance.now() - t0);
    }
    times.push(fastest(samples));
    await mind.store.close();
  }

  const k = logLogSlope(sizes, times);
  console.log("    inference vs corpus size (fixed 1KB query):");
  sizes.forEach((n, i) =>
    console.log(
      `      corpus=${String(n).padStart(4)} pairs  ${times[i].toFixed(1)} ms`,
    )
  );
  console.log(
    `      growth exponent k ≈ ${k.toFixed(2)} (corpus axis; ≪ 1 = sublinear)`,
  );

  // 64× the corpus must not cost anywhere near 64× the time. Sublinear: exponent
  // well under 1 (a flat-ish ~log curve), so the per-query cost is governed by
  // the query, not the store.
  assert.ok(
    k < 0.6,
    `inference grew with exponent k=${k.toFixed(2)} in corpus size — ` +
      `expected ≪ 1 (sublinear; cost set by the query, not the corpus)`,
  );
});

// One fixed corpus, query LENGTH growing. Time must rise about LINEARLY with
// input bytes — a steady KB/s of input processed — and never super-linearly
// (no quadratic scan, no exponential fuse). Constant throughput is the headline
// number; the exponent guards against blow-up.
test("inference: input is processed at a roughly constant KB/s (linear, not quadratic)", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest(corpus(200, "inflen"));

  const kbs = [0.5, 1, 2, 4, 8];
  const queries = kbs.map((kb) => unknownInput(kb * 1024));
  const bytes = queries.map((q) => new TextEncoder().encode(q).length);

  await mind.respond(queries[queries.length - 1]); // warm up

  const times = [];
  for (const q of queries) {
    const samples = [];
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      await mind.respond(q);
      samples.push(performance.now() - t0);
    }
    times.push(fastest(samples));
  }
  await mind.store.close();

  const rates = bytes.map((b, i) => (b / 1024) / (times[i] / 1000)); // KB/s
  const k = logLogSlope(bytes, times);
  console.log("    inference vs input length (fixed corpus):");
  bytes.forEach((b, i) =>
    console.log(
      `      in=${(b / 1024).toFixed(1)}KB  ${
        times[i].toFixed(1).padStart(7)
      } ms  ${rates[i].toFixed(1)} KB/s`,
    )
  );
  // Measure the throughput band over the LARGER inputs only: the smallest query
  // is dominated by fixed per-query overhead (one climb + resonate, tens of ms
  // on a handful of bytes), so its KB/s legitimately reads low and is noise-
  // sensitive — it says nothing about how INPUT LENGTH scales. From 1KB up,
  // throughput is steady.
  const steadyRates = rates.slice(1);
  const loR = Math.min(...steadyRates), hiR = Math.max(...steadyRates);
  console.log(
    `      throughput band (≥1KB) ${loR.toFixed(1)}–${
      hiR.toFixed(1)
    } KB/s · length exponent k ≈ ${k.toFixed(2)}`,
  );

  // PRIMARY guard — not super-linear: time grows about linearly (or better),
  // never quadratically. This is the load-independent contract; an exponential
  // fuse or quadratic scan would push k well past 1.
  assert.ok(
    k < 1.3,
    `input-length exponent k=${
      k.toFixed(2)
    } — expected ≤ ~1 (linear or sublinear), never quadratic`,
  );
  // Secondary — constant rate: past the fixed-overhead floor, throughput does
  // not fall off as the input grows (a generous band absorbs scheduling jitter).
  assert.ok(
    hiR < loR * 3,
    `throughput fanned out ${
      (hiR / loR).toFixed(1)
    }× across ≥1KB inputs — expected a roughly constant KB/s`,
  );
});

// =========================================================================
// INFERENCE — correctness preserved while scaling
// =========================================================================

// Completion must still fire correctly when the learned form is buried in a long
// unknown input — scaling the input must not lose the recall.
test("inference: completion still fires inside long inputs", async () => {
  const mind = new Mind({
    seed: 7,
  });
  await mind.ingest([["ice", "cold"], ["fire", "hot"], ["2+2", "4"]]);

  for (const pad of [16, 64, 256, 1024]) {
    const filler = unknownInput(pad);
    const mid = filler.slice(0, filler.length >> 1);
    const end = filler.slice(filler.length >> 1);
    assert.equal(await mind.respondText(`${mid} ice ${end}`), "cold");
    assert.equal(await mind.respondText(`${mid} 2+2 ${end}`), "4");
  }
  await mind.store.close();
});

// Worst case for the cover: MANY distinct learned forms abutted with no
// separators ("w0w1w2…"). A node-less fused span is kept alive only while
// it can still grow INTO a learned form — bytes ≤ W (findLeaf), or the pair
// ACTUALLY forms a branch (findBranch).  It is NOT kept merely because both
// sides carry a node — that "potential" gate generated O(N²) chart items for
// N abutted forms where only O(N) pairs actually form branches.  The GROWTH
// RATIO is the load-independent proof.
test("inference: many abutted learned forms stay polynomial, not exponential", async () => {
  const mind = new Mind({
    seed: 7,
  });
  const pairs = [];
  for (let i = 0; i < 16; i++) pairs.push([`w${i}`, `a${i}`]);
  await mind.ingest(pairs);

  const timeParts = async (np) => {
    const q = Array.from({ length: np }, (_, i) => `w${i}`).join("");
    const t0 = performance.now();
    await mind.respondText(q);
    return performance.now() - t0;
  };

  await timeParts(4); // warm up
  const small = median(await Promise.all([4, 4, 4].map(timeParts)));
  const big = median(await Promise.all([12, 12, 12].map(timeParts)));
  const ratio = big / Math.max(small, 0.5);
  console.log(
    `    abutted forms: 4 parts ${small.toFixed(1)}ms → 12 parts ${
      big.toFixed(1)
    }ms (${ratio.toFixed(1)}×)`,
  );

  // The old O(N²)-potential gate let 3× the parts blow up the chart; with the
  // actual-branch-evidence gate growth stays near-linear (roughly proportional
  // to parts).  The ratio is the precise, load-independent guard.
  assert.ok(
    ratio < 25,
    `cost grew ${
      ratio.toFixed(1)
    }× for 3× the parts — expected polynomial (≪ 25×), not exponential`,
  );
  assert.ok(
    big < 1500,
    `12 abutted forms took ${
      big.toFixed(0)
    }ms — expected < 1500ms (no 2ⁿ fuse)`,
  );
  await mind.store.close();
});
