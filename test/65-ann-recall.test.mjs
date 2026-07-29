// 65-ann-recall.test.mjs — the ACCURACY half of rabitq-ivf's speed/accuracy
// trade, pinned to a measured baseline.
//
// Every geometry constant in the sub-library (rotation `rounds`, `queryBits`,
// `efSearch`/nprobe, SPLIT_MAX, and the estimator's own arithmetic) buys speed
// by giving up recall. Nothing measured the recall, so nothing could be
// changed: a faster encoder that quietly lost neighbours looked exactly like a
// faster encoder. These assertions are that missing half — an optimisation is
// free only if it holds this line.
//
// Deliberately SELF-CONTAINED: vectors are real Sema gists, but folded here
// from generated text rather than read out of sema.*, so the test is
// deterministic, needs no trained store, and cannot drift when one is
// retrained.
//
// Absolute recall here (~78%) runs higher than the ~71% measured against the
// trained store (100,000 gists sampled from sema.*, 400 queries, exact-cosine
// ground truth): generated word-salad folds to an easier distribution than a
// real corpus. The FLOORS are what matter, and they are set from what this
// file itself measures, with margin for the estimator's quantisation noise —
// never from what looked good on a different distribution.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { gistOf } from "../dist/src/mind/primitives.js";
import { IvfIndex } from "../dist/src/rabitq-ivf/src/ivf.js";
import { RaBitQuantizer } from "../dist/src/rabitq-ivf/src/rabitq.js";

const SEED = 7;
const K = 10;

// A deterministic PRNG — the vectors must be identical on every run, or a
// recall floor is a coin flip.
const prng = (s) => () => {
  s ^= s << 13;
  s >>>= 0;
  s ^= s >>> 17;
  s ^= s << 5;
  s >>>= 0;
  return s / 4294967296;
};

const WORDS = [
  "the",
  "a",
  "of",
  "in",
  "system",
  "fold",
  "vector",
  "index",
  "query",
  "gist",
  "node",
  "edge",
  "store",
  "cluster",
  "recall",
  "code",
  "byte",
  "span",
  "chunk",
  "seed",
  "paris",
  "france",
  "steel",
  "ice",
  "planet",
  "sun",
  "music",
  "river",
  "light",
  "stone",
];

/** `n` distinct real Sema gists, folded from generated text. */
function gists(n) {
  const mind = new Mind({ seed: SEED });
  const rnd = prng(20260729);
  const enc = new TextEncoder();
  const out = [];
  const seen = new Set();
  while (out.length < n) {
    let s = "";
    const len = 3 + ((rnd() * 14) | 0);
    for (let i = 0; i < len; i++) {
      s += (i ? " " : "") + WORDS[(rnd() * WORDS.length) | 0];
    }
    s += ".";
    if (seen.has(s)) continue;
    seen.add(s);
    const g = gistOf(mind, enc.encode(s));
    let sq = 0;
    for (let i = 0; i < g.length; i++) sq += g[i] * g[i];
    if (sq > 0) out.push(g);
  }
  return { vecs: out, D: mind.store.D };
}

function indexOf(vecs, D, rounds = 3) {
  const idx = new IvfIndex(":memory:", {
    dim: D,
    rotationRounds: rounds,
    seed: SEED,
    cacheSizeMb: 64,
  });
  idx.begin();
  for (let i = 0; i < vecs.length; i++) {
    idx.insert(i, idx.encodeToBytes(vecs[i]));
  }
  idx.commit();
  idx.commitFlush();
  return idx;
}

const queryIds = (n, q) => {
  const out = [];
  for (let i = 0; i < q; i++) out.push(Math.floor((i + 0.5) * n / q));
  return out;
};

/** Exact cosine top-k by brute force — the only true ground truth here. */
function exactTopK(vecs, norms, qi, k) {
  const q = vecs[qi], qn = norms[qi];
  const ds = new Float64Array(vecs.length);
  for (let j = 0; j < vecs.length; j++) {
    const v = vecs[j];
    let dot = 0;
    for (let i = 0; i < q.length; i++) dot += q[i] * v[i];
    const den = qn * norms[j];
    ds[j] = den === 0 ? 1 : 1 - dot / den;
  }
  return new Set(
    Array.from(ds.keys()).sort((a, b) => ds[a] - ds[b]).slice(0, k),
  );
}

// ── QUANTIZATION: what 1-bit coding costs, with routing removed ─────────────

test("quantization recall holds its measured floor (routing removed)", () => {
  const { vecs, D } = gists(2000);
  const norms = vecs.map((v) => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return Math.sqrt(s);
  });
  const qs = queryIds(vecs.length, 100);
  const truth = qs.map((qi) => exactTopK(vecs, norms, qi, K));

  const idx = indexOf(vecs, D);
  // nprobe = K clusters: every cluster is scanned, so the ONLY thing between
  // the query and exact cosine is the 1-bit code.
  const full = 4 * idx.clusterCount;
  let hit = 0, want = 0;
  for (let t = 0; t < qs.length; t++) {
    for (const h of idx.searchKnn(vecs[qs[t]], K, full)) {
      if (truth[t].has(h.id)) hit++;
    }
    want += truth[t].size;
  }
  idx.close();
  const recall = hit / want;

  // Measured 79.3% here (2,000 gists, 100 queries, k=10). The floor sits a
  // clear margin below so that ordinary quantisation jitter cannot trip it,
  // while a real loss — dropping a rotation round that mattered, widening the
  // code, changing the estimator's arithmetic — moves recall by far more.
  assert.ok(
    recall >= 0.74,
    `quantization recall@${K} fell to ${(recall * 100).toFixed(1)}% ` +
      `(floor 74.0%, measured baseline 79.3%). The 1-bit code lost ` +
      `neighbours it used to keep — this is the accuracy half of a ` +
      `speed/accuracy trade, so a change that speeds up the encoder or the ` +
      `estimator must NOT land here.`,
  );
});

// ── ROUTING: what probing a subset of clusters costs ───────────────────────

test("routing recall degrades monotonically as nprobe shrinks", () => {
  // 12,000 vectors splits into several clusters (SPLIT_MAX = 4096). Routing is
  // then exercised by LOWERING ef — nprobe = ceil(ef/4) — rather than by
  // growing the collection into the tens of thousands, which would cost the
  // suite seconds to say the same thing.
  const { vecs, D } = gists(12000);
  const idx = indexOf(vecs, D);
  const clusters = idx.clusterCount;
  assert.ok(clusters >= 4, `expected several clusters, got ${clusters}`);

  const qs = queryIds(vecs.length, 100);
  const full = 4 * clusters; // nprobe >= clusters: nothing skipped
  const ref = qs.map((qi) =>
    new Set(idx.searchKnn(vecs[qi], K, full).map((h) => h.id))
  );

  const at = (ef) => {
    let hit = 0, want = 0;
    for (let t = 0; t < qs.length; t++) {
      for (const h of idx.searchKnn(vecs[qs[t]], K, ef)) {
        if (ref[t].has(h.id)) hit++;
      }
      want += ref[t].size;
    }
    return hit / want;
  };

  const one = at(4); //  nprobe 1
  const two = at(8); //  nprobe 2
  const all = at(16 * clusters);
  idx.close();

  // Probing every cluster must reproduce the reference exactly — this is the
  // same scan, so anything below 1.0 means the probe ORDER dropped a cluster
  // it ranked in, not that the quantizer was imprecise.
  assert.equal(
    all,
    1,
    "probing every cluster must match the full scan exactly",
  );
  // More clusters probed is never worse.
  assert.ok(
    two >= one,
    `routing recall fell when nprobe grew: nprobe=1 ${
      (one * 100).toFixed(1)
    }% ` +
      `-> nprobe=2 ${(two * 100).toFixed(1)}%`,
  );
  // Measured 52.9% at nprobe=1 and 76.4% at nprobe=2 of 4 clusters. The floors
  // guard the PIVOT quality: routing is only worth anything if the nearest
  // cluster usually holds the nearest vectors, and a pivot chosen badly (a
  // broken split, a majority-code regression) shows up here first.
  assert.ok(
    one >= 0.4,
    `single-cluster routing recall ${(one * 100).toFixed(1)}% is below the ` +
      `0.4 floor (measured 52.9%) — cluster pivots no longer predict where ` +
      `a query's neighbours live.`,
  );
});

// ── ESTIMATOR: the arithmetic itself, pinned exactly ───────────────────────

test("the fast estimator is bit-identical to its scalar definition", () => {
  // The scan's inner loop is the hottest code in inference and invites
  // micro-optimisation (it currently folds the popcount into 32-bit SWAR
  // words). Those rewrites are only legitimate while they are EXACT: the
  // estimator's output ranks every candidate, so a last-bit difference is a
  // silent reordering, not a rounding detail. This recomputes the definition
  // straight from the QueryContext and demands equality.
  const rnd = prng(11);
  let checked = 0;
  for (const dim of [8, 64, 100, 256, 1024]) {
    const qz = new RaBitQuantizer(dim, { seed: SEED });
    const nb = qz.paddedDim >>> 3;
    const POP = new Uint8Array(256);
    for (let i = 1; i < 256; i++) POP[i] = POP[i >> 1] + (i & 1);
    for (let t = 0; t < 25; t++) {
      const v = new Float64Array(dim);
      for (let i = 0; i < dim; i++) v[i] = rnd() * 2 - 1;
      const q = qz.prepareQuery(v);
      const code = new Uint8Array(nb * 4);
      for (let i = 0; i < code.length; i++) code[i] = (rnd() * 256) | 0;
      for (let c = 0; c < 4; c++) {
        const off = c * nb;
        let dot = 0, pc = 0;
        for (let p = 0; p < q.nbytes; p++) {
          const b = code[off + p];
          dot += q.qlut[(p << 8) + b];
          pc += POP[b];
        }
        const A = q.vmin * (2 * pc - qz.paddedDim) +
          q.delta * (2 * dot - q.sumQInt);
        const want = q.zero ? 1 : 1 - qz.cosFactor * A;
        assert.ok(
          Object.is(qz.estimate(code, off, q), want),
          `estimate diverged from its definition at dim=${dim}: ` +
            `${qz.estimate(code, off, q)} vs ${want}`,
        );
        checked++;
      }
    }
  }
  assert.ok(checked >= 500, `expected a broad sweep, checked ${checked}`);
});

// ── GEOMETRY: rotation rounds are saturated at 1 ───────────────────────────

test("rotation rounds beyond the first buy no recall", () => {
  // Recorded as an executable fact, because it is the one place in this
  // sub-library with real headroom: a round is a sign-flip plus a
  // Walsh-Hadamard transform (the SRHT construction, for which ONE randomised
  // round already approximates a random rotation), and cost is linear in the
  // count — encode runs 28.0us at rounds=3 against 16.8us at rounds=1.
  //
  // Measured against the trained store — 100,000 real gists, routing removed,
  // 400 queries, recall@10: rounds=4 70.5%, rounds=3 71.1%, rounds=2 70.6%,
  // rounds=1 71.1% — indistinguishable across 4,000 ground-truth slots, and
  // reproduced at N=1,000 and N=4,000. If this assertion ever fails, the
  // rotation has stopped being saturated and the default is worth revisiting.
  const { vecs, D } = gists(2000);
  const norms = vecs.map((v) => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return Math.sqrt(s);
  });
  const qs = queryIds(vecs.length, 100);
  const truth = qs.map((qi) => exactTopK(vecs, norms, qi, K));

  const recallFor = (rounds) => {
    const idx = indexOf(vecs, D, rounds);
    const full = 4 * idx.clusterCount;
    let hit = 0, want = 0;
    for (let t = 0; t < qs.length; t++) {
      for (const h of idx.searchKnn(vecs[qs[t]], K, full)) {
        if (truth[t].has(h.id)) hit++;
      }
      want += truth[t].size;
    }
    idx.close();
    return hit / want;
  };

  const three = recallFor(3);
  const one = recallFor(1);
  assert.ok(
    Math.abs(three - one) <= 0.03,
    `one rotation round is no longer equivalent to three: ` +
      `rounds=3 ${(three * 100).toFixed(1)}% vs rounds=1 ` +
      `${(one * 100).toFixed(1)}% (tolerance 3 points)`,
  );
});
