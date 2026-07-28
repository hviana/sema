// 63-fold-invariants.test.mjs — the fold's complete contract, in one place.
//
// Three jobs:
//   1. VALIDATE every structural invariant the fold must hold, exactly.
//   2. MEASURE the shift-invariance the fold currently achieves.
//   3. PIN those measurements as a baseline, so a future change that trades a
//      contract for a number — or quietly loses ground — fails here.
//
// BYTE-AGNOSTIC BY CONSTRUCTION.  Text is one case, not the case.  Every
// measurement runs over six corpora, five of which are not text: uniform
// random, sparse (mostly-zero, like headers and bitmaps), two-symbol
// low-entropy, periodic fixed-size records, and smooth gradients (audio and
// image ramps).  This is not decoration — conclusions drawn from an English
// corpus have inverted twice when finally tested on bytes, and a degenerate
// case on a gradient was invisible until a ramp corpus existed.
//
// Every generator must VARY PER STREAM.  A deterministic ramp once made all
// twelve "unrelated" samples byte-identical and reported an unrelated max of
// 1.000, which reads as a catastrophic result and was a bug in the harness.
//
// The pinned numbers are FLOORS AND CEILINGS with slack, never equalities:
// they exist to catch regressions and silent trades, not to freeze the
// geometry. Raising a floor after a genuine improvement is expected.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bytesToTree,
  contentBoundaries,
  estimatorNoise,
  identityBar,
  mergeThreshold,
  reachThreshold,
  significanceBar,
} from "../dist/src/geometry.js";
import { Alphabet } from "../dist/src/alphabet.js";
import { fold, sema } from "../dist/src/sema.js";
import { cosine, makeKeyring, normalize, rng } from "../dist/src/vec.js";

const D = 1024;
const W = 4;
const SEATS = 8;
const mkSpace = () => ({
  D,
  seats: makeKeyring(D, SEATS, rng(1)),
  rand: rng(2),
  maxGroup: W,
});
const space = mkSpace();
const alphabet = new Alphabet(7, D, { roughness: 0.65, seedMask: 0xa1fa17 });

const E = (s) => new TextEncoder().encode(s);
const tree = (b) =>
  bytesToTree(space, alphabet, b instanceof Uint8Array ? b : E(b));
const gist = (b) => tree(b).v;
const mag = (v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
const span = (n) =>
  n.kids
    ? n.kids.reduce((a, k) => a + span(k), 0)
    : (n.leaf ? n.leaf.length : 0);
const med = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
};
const cat = (...xs) => {
  const n = xs.reduce((a, x) => a + x.length, 0), o = new Uint8Array(n);
  let k = 0;
  for (const x of xs) {
    o.set(x, k);
    k += x.length;
  }
  return o;
};

// ── corpora ──────────────────────────────────────────────────────────────
function gen(kind, R, n) {
  const b = new Uint8Array(n);
  if (kind === "uniform") {
    for (let i = 0; i < n; i++) b[i] = Math.floor(R() * 256);
  } else if (kind === "sparse") {
    for (let i = 0; i < n; i++) {
      b[i] = R() < 0.15 ? Math.floor(R() * 256) : 0;
    }
  } else if (kind === "lowent") {
    for (let i = 0; i < n; i++) {
      b[i] = R() < 0.5 ? 0x41 : 0x42;
    }
  } else if (kind === "records") {
    const tag = Math.floor(R() * 256);
    for (let i = 0; i < n; i++) {
      b[i] = (i % 8 === 0) ? tag : (i % 4) * 17 + Math.floor(R() * 4);
    }
  } else if (kind === "ramp") {
    const step = 1 + Math.floor(R() * 13), phase = Math.floor(R() * 256);
    for (let i = 0; i < n; i++) b[i] = (phase + i * step) & 0xff;
  }
  return b;
}
const SENTENCES = [
  "The owl is named Sage and lives in the old barn",
  "Michelangelo sculpted the David from a single block of marble",
  "Photosynthesis converts light energy into chemical energy in plants",
  "The treaty was signed after three years of difficult negotiation",
  "Quicksort partitions an array around a chosen pivot element",
  "Volcanic ash drifted across the island for several weeks",
  "She repaired the bicycle chain with a small steel link",
  "Neutron stars rotate hundreds of times every single second",
  "The bakery on Fifth Street closes early on Sundays",
  "Chess engines evaluate millions of positions before moving",
  "Antarctic ice cores preserve a record of ancient climate",
  "He translated the poem without losing its original meter",
];
const PREFIX = ["Well, ", "Actually, ", "I think ", "Listen, "];
const SUFFIX = [" indeed.", " you know.", " of course.", " really."];
const CORPORA = ["text", "uniform", "sparse", "lowent", "records", "ramp"];

/** Twelve base streams plus a prefix/suffix generator, per corpus. */
function corpus(kind, seed = 9, len = 60) {
  const R = rng(seed);
  const base = kind === "text"
    ? SENTENCES.map(E)
    : Array.from({ length: 12 }, () => gen(kind, R, len));
  return {
    base,
    pre: () =>
      kind === "text" ? E(PREFIX[Math.floor(R() * 4)]) : gen(kind, R, 6),
    post: () =>
      kind === "text" ? E(SUFFIX[Math.floor(R() * 4)]) : gen(kind, R, 6),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — STRUCTURAL INVARIANTS.  Exact contracts; no tolerance to tune.
// ═══════════════════════════════════════════════════════════════════════════

test("determinism: identical bytes fold to an identical tree, on every byte type", () => {
  for (const kind of CORPORA) {
    for (const b of corpus(kind).base) {
      assert.deepEqual(Array.from(gist(b)), Array.from(gist(b)), kind);
      assert.deepEqual(
        contentBoundaries(space, b),
        contentBoundaries(space, b),
        kind,
      );
    }
  }
});

test("a node's gist does not depend on its ROLE — the stable-prefix contract", () => {
  // fold(prefix) standing alone must equal the node covering that prefix
  // inside a longer stream: "(s₀·s₁) IS the root the store learnt for the
  // first two segments' bytes".  A rule applied at only some join sites
  // breaks this, and with it express() and recognition of a stored form
  // appearing inside a longer query.
  const cases = [
    [E("The owl is "), E("named Sage.")],
    [E("Michelangelo "), E("sculpted David.")],
    [E("abcdefgh"), E("ijklmnop")],
  ];
  const R = rng(5);
  for (let i = 0; i < 8; i++) {
    cases.push([gen("uniform", R, 20), gen("uniform", R, 30)]);
  }
  for (let i = 0; i < 4; i++) {
    cases.push([gen("records", R, 24), gen("records", R, 24)]);
  }

  for (const [pre, rest] of cases) {
    const whole = bytesToTree(
      space,
      alphabet,
      cat(pre, rest),
      undefined,
      undefined,
      [pre.length],
    );
    let found = null;
    const walk = (n) => {
      if (span(n) === pre.length && !found) found = n;
      (n.kids ?? []).forEach(walk);
    };
    walk(whole);
    assert.ok(found, "no node covers the declared prefix");
    assert.ok(
      cosine(found.v, gist(pre)) > 0.999,
      `prefix node must BE fold(prefix): cos ${
        cosine(found.v, gist(pre)).toFixed(5)
      }`,
    );
  }
});

test("linearity: interior gists stay raw, |v| ∝ √len, and only the root is normalized", () => {
  // identityBar converts a cosine into a tolerated BYTE budget using this
  // norm, so drift here silently changes what counts as identity.  A rule
  // emitting more than one term per child (any n-gram or pair superposition)
  // breaks it.
  const R = rng(6);
  let worst = 0;
  for (const kind of ["uniform", "records", "lowent", "ramp"]) {
    const root = tree(gen(kind, R, 400));
    assert.ok(
      Math.abs(mag(root.v) - 1) < 1e-5,
      "the root, and only the root, is normalized",
    );
    const seen = new Map();
    const walk = (n) => {
      if (!n.kids) return;
      const s = span(n);
      if (!seen.has(s)) seen.set(s, mag(n.v) / Math.sqrt(s));
      n.kids.forEach(walk);
    };
    root.kids.forEach(walk);
    for (const r of seen.values()) worst = Math.max(worst, Math.abs(r - 1));
  }
  assert.ok(
    worst < 0.25,
    `interior |v|/√len drifts by ${
      worst.toFixed(4)
    } — the linear-fold norm is gone`,
  );
});

test("order-bearing: permuting children changes the gist, for bytes as well as prose", () => {
  // A plain superposition is commutative and made a stream equal its own
  // reversal.  Checked at three scales: segments, clauses, and whole halves.
  const segSwap = cosine(
    gist(Uint8Array.of(0, 64, 0, 0, 0, 0, 0, 0)),
    gist(Uint8Array.of(0, 0, 0, 0, 0, 64, 0, 0)),
  );
  const clause = cosine(
    gist("Steel is hard. Ice is cold."),
    gist("Ice is cold. Steel is hard."),
  );
  const R = rng(7);
  const x = gen("uniform", R, 24), y = gen("uniform", R, 24);
  const halves = cosine(gist(cat(x, y)), gist(cat(y, x)));
  for (
    const [name, c] of [["segment", segSwap], ["clause", clause], [
      "halves",
      halves,
    ]]
  ) {
    assert.ok(
      c < 0.99,
      `${name} permutation left the gist unchanged (cos ${c.toFixed(4)})`,
    );
  }
});

test("repetition is not erased: a repeated unit differs from the unit", () => {
  // normalize(n·v) = v̂ for every n, so a superposition cannot see repeats and
  // "ab" interned as the same node as "abab".
  const bar = mergeThreshold(D);
  const pairs = [["ab", "abab"], ["aaaa", "aaaaaaaa"], ["aaaa", "aaaaaa"], [
    "xyz",
    "xyzxyz",
  ]];
  for (const [a, b] of pairs) {
    const c = cosine(gist(a), gist(b));
    assert.ok(
      c < bar,
      `"${a}" vs "${b}": cos ${c.toFixed(5)} ≥ mergeThreshold ${
        bar.toFixed(4)
      } — interned as ONE node`,
    );
  }
  const u = Uint8Array.of(7, 200, 19, 4);
  const c = cosine(gist(u), gist(cat(u, u)));
  assert.ok(c < bar, `binary unit vs its repetition: cos ${c.toFixed(5)}`);
});

test("seats are injective: no two positions in a node alias onto one key", () => {
  // The original point of this file.  Two streams differing only by a
  // positional swap must not be geometrically identical.
  const a = Uint8Array.of(1, 1, 1, 3, 1);
  const b = Uint8Array.of(1, 1, 3, 1, 1);
  assert.notDeepEqual(Array.from(gist(a)), Array.from(gist(b)));
  assert.ok(
    cosine(gist(a), gist(b)) < mergeThreshold(D),
    "a positional swap is not geometric identity",
  );

  // Length must survive too: n copies of one byte must not collapse onto one.
  for (const [m, n] of [[4, 8], [3, 6], [5, 7]]) {
    const c = cosine(
      gist(new Uint8Array(m).fill(97)),
      gist(new Uint8Array(n).fill(97)),
    );
    assert.ok(
      c < mergeThreshold(D),
      `${m} vs ${n} equal bytes collapsed (cos ${c.toFixed(5)})`,
    );
  }
});

test("the public fold and the perceived fold share ONE positional algebra", () => {
  // A synthetic/canonical fold must agree with perception, or composed gists
  // match nothing perception produces.
  for (let n = 2; n <= SEATS; n++) {
    const bytes = new Uint8Array(n).fill(97);
    if (contentBoundaries(space, bytes).length !== 0) continue; // only flat cases
    assert.deepEqual(
      Array.from(gist(bytes)),
      Array.from(fold(space, Array.from(bytes, (b) => alphabet.vecs[b]))),
      `flat ${n}-item nodes must have one geometry`,
    );
  }
});

test("separation: unrelated streams stay inside the noise the derived bars assume", () => {
  // Every bar — mergeThreshold, identityBar, reachThreshold, estimatorNoise,
  // significanceBar, conceptThreshold — is a function of D assuming unrelated
  // ≈ 0 with σ = 1/√D.  Raising that floor invalidates all of them at once.
  for (const kind of ["uniform", "records"]) {
    const vs = corpus(kind).base.map(gist);
    const u = [];
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        u.push(Math.abs(cosine(vs[i], vs[j])));
      }
    }
    const mean = u.reduce((a, x) => a + x, 0) / u.length;
    assert.ok(
      mean < 3 * estimatorNoise(D),
      `${kind}: unrelated mean |cos| ${mean.toFixed(4)} ≥ 3σ ${
        (3 * estimatorNoise(D)).toFixed(4)
      }`,
    );
  }
});

test("the derived bars stay derived — no tuned constants creep in", () => {
  assert.equal(mergeThreshold(D), 1 - 1 / Math.sqrt(D));
  assert.equal(reachThreshold(W), 1 - 1 / (2 * W));
  assert.equal(estimatorNoise(D), 1 / Math.sqrt(D));
  assert.equal(significanceBar(D), 3 / Math.sqrt(D));
  assert.equal(identityBar(D, W, 64), Math.max(mergeThreshold(D), 1 - W / 64));
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — MEASURED BASELINE.  Floors and ceilings with slack.
// ═══════════════════════════════════════════════════════════════════════════

/** Measured 2026-07-28.  `lead` is the cosine between a stream and a PREFIXED
 *  copy of itself — the shift-invariance this fold exists to provide; `trail`
 *  the same for an APPENDED copy; `unrelMax` the most similar unrelated
 *  stream in the corpus.  Floors sit ~0.08 under the measurement, ceilings
 *  ~0.08 over, which is well outside run-to-run spread (these are medians of
 *  48 pairs) and well inside the margin that separates the current geometry
 *  from its predecessors — HEAD's worst-case lead was 0.020 against 0.537. */
const BASELINE = {
  //          lead≥   trail≥  unrelMax≤
  text: [0.68, 0.77, 0.28],
  uniform: [0.70, 0.79, 0.17],
  sparse: [0.68, 0.84, 0.64],
  lowent: [0.64, 0.81, 0.71],
  records: [0.68, 0.79, 0.26],
  ramp: [0.44, 0.80, 0.17],
};

function shiftProfile(kind) {
  const { base, pre, post } = corpus(kind);
  const vs = base.map(gist);
  const L = [], T = [], U = [];
  base.forEach((b, i) => {
    for (let k = 0; k < 4; k++) L.push(cosine(vs[i], gist(cat(pre(), b))));
    for (let k = 0; k < 4; k++) T.push(cosine(vs[i], gist(cat(b, post()))));
    for (let j = i + 1; j < base.length; j++) U.push(cosine(vs[i], vs[j]));
  });
  return { lead: med(L), trail: med(T), unrelMax: Math.max(...U) };
}

test("shift invariance holds its measured baseline on every byte type", () => {
  const worst = { lead: 1, trail: 1 };
  for (const kind of CORPORA) {
    const { lead, trail, unrelMax } = shiftProfile(kind);
    const [leadFloor, trailFloor, unrelCeil] = BASELINE[kind];
    assert.ok(
      lead >= leadFloor,
      `${kind}: lead ${lead.toFixed(3)} fell below the pinned ${leadFloor}`,
    );
    assert.ok(
      trail >= trailFloor,
      `${kind}: trail ${trail.toFixed(3)} fell below the pinned ${trailFloor}`,
    );
    assert.ok(
      unrelMax <= unrelCeil,
      `${kind}: unrelated max ${
        unrelMax.toFixed(3)
      } rose above the pinned ${unrelCeil}`,
    );
    worst.lead = Math.min(worst.lead, lead);
    worst.trail = Math.min(worst.trail, trail);
  }
  // The headline pair.  A change may trade between corpora; it may not lower
  // the worst case, which is what "works on all byte types" means.
  assert.ok(
    worst.lead >= 0.44,
    `worst-case lead across byte types: ${worst.lead.toFixed(3)}`,
  );
  assert.ok(
    worst.trail >= 0.77,
    `worst-case trail across byte types: ${worst.trail.toFixed(3)}`,
  );
});

test("a shifted copy is more similar than any unrelated stream — the usable bar", () => {
  // The defect this whole line of work removed: under the previous geometry a
  // prefixed copy of a sentence (0.199) was LESS similar than the nearest
  // unrelated sentence (0.265) — not separable at all.  Every corpus must now
  // clear its own unrelated maximum.
  for (const kind of CORPORA) {
    const { lead, unrelMax } = shiftProfile(kind);
    assert.ok(
      lead > unrelMax,
      `${kind}: lead ${lead.toFixed(3)} ≤ unrelated max ${
        unrelMax.toFixed(3)
      } — a shifted copy is unrecognisable`,
    );
  }
});

test("content cuts re-synchronise after an insertion, on every byte type", () => {
  // The cut rule reads a bounded window, so a prepend can only disturb
  // boundaries until the window clears.  Long-memory or last-gated rules
  // phase-lock instead and never recover: the predecessor scored 0.441 on a
  // gradient and 0.492 on sparse data.
  const FLOOR = {
    text: 0.90,
    uniform: 0.88,
    sparse: 0.78,
    lowent: 0.84,
    records: 0.87,
    ramp: 0.88,
  };
  for (const kind of CORPORA) {
    const { base, pre } = corpus(kind);
    let sum = 0;
    for (const b of base) {
      const p = pre();
      const A = contentBoundaries(space, b);
      const B = contentBoundaries(space, cat(p, b)).map((c) => c - p.length)
        .filter((c) => c > 0);
      let k = 0;
      while (
        k < Math.min(A.length, B.length) &&
        A[A.length - 1 - k] === B[B.length - 1 - k]
      ) k++;
      sum += A.length ? k / A.length : 1;
    }
    const frac = sum / base.length;
    assert.ok(
      frac >= FLOOR[kind],
      `${kind}: only ${frac.toFixed(3)} of cuts re-aligned (pinned ${
        FLOOR[kind]
      })`,
    );
  }
});

test("segments keep their scale, and never exceed the keyring", () => {
  // Segment SCALE is load-bearing: the mechanisms downstream are fitted to
  // this distribution, and a rule that halves it costs more than the
  // structural purity it buys.  The keyring bound is what makes a segment
  // foldable at all — flatFold seats one child per seat.
  for (const kind of CORPORA) {
    const lens = [];
    for (const b of corpus(kind, 9, 120).base) {
      let prev = 0;
      for (const c of contentBoundaries(space, b)) {
        lens.push(c - prev);
        prev = c;
      }
      lens.push(b.length - prev);
    }
    const mean = lens.reduce((a, x) => a + x, 0) / lens.length;
    assert.ok(
      Math.max(...lens) <= SEATS,
      `${kind}: a ${
        Math.max(...lens)
      }-byte segment exceeds the ${SEATS}-seat keyring`,
    );
    assert.ok(
      mean >= 3.5 && mean <= 7.5,
      `${kind}: mean segment ${mean.toFixed(2)} left the 3.5–7.5 band`,
    );
  }
});
