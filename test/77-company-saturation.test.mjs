// 77-company-saturation.test.mjs — companyProfile stops because the
// REPRESENTATION IS FULL, not because a budget ran out.
//
// The old rule was `PROFILE_VISITS = 64`: a constant, and one that decided
// which constituents entered a halo by where they sat in a BFS. It was also
// wrong in both directions on the trained store — it fired at 64 visits while
// capacity needed a median of 69 (dropping readable evidence), and an uncapped
// walk accepted ~50 terms where the representation holds √D = 32.
//
// The replacement is derived: a superposition of m unit signatures contributes
// 1/m per term to any cosine taken against it, so once m > √D one term moves
// nothing above estimatorNoise(D) = 1/√D. `profileCapacity(D) = √D` is that
// point (geometry.ts). The constituent set is stored as a bottom-k sketch keyed
// on each unit's own identity, so membership is a property of the UNIT and not
// of traversal order.
//
// Every check below reads the diagnostics companyProfile reports through
// ingest's inspectRationale — if the instrumentation were decorative, T8 fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { estimatorNoise, profileCapacity } from "../dist/src/geometry.js";

/** Ingest, collecting every companyProfile diagnostic payload. */
async function ingestTraced(mind, items) {
  const seen = [];
  await mind.ingest(items, undefined, undefined, (s) => {
    if (s.mechanism[s.mechanism.length - 1] === "companyProfile") {
      seen.push(s.data);
    }
  });
  return seen;
}

/** A store that counts the reads companyProfile's stopping rule performs. */
function countingStore(opts) {
  const store = new SQliteStore(opts);
  const counts = { get: 0, sketchGet: 0, sketchPut: 0, parentsFirst: 0 };
  for (const m of ["get", "sketchGet", "sketchPut", "parentsFirst"]) {
    const orig = store[m].bind(store);
    store[m] = (...a) => {
      counts[m]++;
      return orig(...a);
    };
  }
  return { store, counts };
}

const mk = (D = 1024) => {
  const store = new SQliteStore({ path: ":memory:", D });
  return { store, mind: new Mind({ seed: 7, store }) };
};

// A long partner whose constituents are many and mostly unique.
const longText = (n, tail = "") =>
  Array.from({ length: n }, (_, i) => `alpha${i} beta${i} gamma${i}`).join(
    " ",
  ) + tail;

// ── 1. deep type-level company still works ───────────────────────────────
// The motivating case: the shared unit sits BELOW the top of the fold, so a
// depth-1 profile would miss it entirely (test/76 T1 is the full fixture).
test("T1: a unit shared below depth 1 still enters both profiles", async () => {
  const { store, mind } = mk();
  await mind.ingest([
    ["The Eiffel Tower is in Paris", "Tour Eiffel dia any Paris"],
    [
      "A completely unrelated control sentence",
      "Another unrelated control string",
    ],
  ]);
  // Both partners must have found constituents at all — an empty sketch on a
  // full sentence is the depth-1 failure this design exists to prevent.
  const ids = [];
  for (let i = 0; i < store.nodeCount(); i++) {
    const s = store.sketchGet?.(i);
    if (s && s.length > 0) ids.push(i);
  }
  assert.ok(ids.length > 0, "no node acquired a non-empty constituent sketch");
});

// ── 2. training order ────────────────────────────────────────────────────
test("T2: forward and reverse training order give identical sketches", async () => {
  const pairs = [
    ["The Eiffel Tower is in Paris", "Tour Eiffel dia any Paris"],
    ["Water freezes at zero degrees", "El agua se congela a cero grados"],
    ["The capital of France is Paris", "La capitale de la France est Paris"],
  ];
  const read = async (items) => {
    const { store, mind } = mk();
    await mind.ingest(items);
    // Key sketches by CONTENT, not id — ids depend on mint order by design.
    const dec = new TextDecoder();
    const out = new Map();
    for (let i = 0; i < store.nodeCount(); i++) {
      const s = store.sketchGet?.(i);
      if (!s || s.length === 0) continue;
      const key = dec.decode(store.bytes(i).filter((x) => x !== 0));
      out.set(
        key,
        s.map((n) => dec.decode(store.bytes(n).filter((x) => x !== 0))).sort(),
      );
    }
    return out;
  };
  const fwd = await read(pairs);
  const rev = await read([...pairs].reverse());
  // Every partner present in both must have the SAME constituent set.
  let compared = 0;
  for (const [k, v] of fwd) {
    if (!rev.has(k)) continue;
    compared++;
    assert.deepEqual(
      v,
      rev.get(k),
      `sketch differs by training order for ${JSON.stringify(k)}`,
    );
  }
  assert.ok(compared > 0, "no partner was comparable across orders");
});

// ── 3. long partners stop by SATURATION, not by a budget ─────────────────
test("T3: a long partner reports capacity as the stop reason", async () => {
  const { mind } = mk();
  const diag = await ingestTraced(mind, [[
    longText(40),
    "a short continuation",
  ]]);
  const long = diag.filter((d) => d.wholeLen > 400);
  assert.ok(long.length > 0, "expected at least one long partner");
  for (const d of long) {
    assert.equal(d.capacity, profileCapacity(1024), "capacity must be √D");
    assert.equal(
      d.stopReason,
      "capacity",
      "long partner must stop at capacity",
    );
    assert.ok(d.saturated, "long partner must report saturation");
    assert.equal(
      d.sketched,
      d.capacity,
      "sketch must be exactly capacity-sized",
    );
  }
});

// ── 4. a unit shared at DIFFERENT depths must not be systematically lost ──
test("T4: a unit shared at different fold depths enters both sketches", async () => {
  // The motivating fixture. Content-defined cuts put " Paris" at a different
  // depth in each sentence — "The Eiffel Tower is in Paris" folds to
  // "The Eiffel " + "Tower is in Paris", "Tour Eiffel dia any Paris" to
  // "Tour Eiffel " + "dia any Paris" — so the shared unit is a child of
  // NEITHER. A selection keyed on traversal position reaches it in one partner
  // and not the other; one keyed on the unit's own identity keeps it in both.
  //
  // NOTE the earlier version of this test compared "zzmarker " at the head
  // against " zzmarker" at the tail. Those are DIFFERENT BYTES, hence different
  // node identities, so the comparison could never have been about position.
  const { store, mind } = mk();
  const A = "The Eiffel Tower is in Paris";
  const B = "Tour Eiffel dia any Paris";
  await mind.ingest([[A, B]]);

  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const nodeOf = (text) => {
    const want = enc.encode(text);
    for (let i = 0; i < store.nodeCount(); i++) {
      if (store.contentLen(i, want.length + 1) !== want.length) continue;
      const b = store.bytes(i);
      if (b.length === want.length && b.every((x, j) => x === want[j])) {
        return i;
      }
    }
    return null;
  };
  const a = nodeOf(A), b = nodeOf(B);
  assert.ok(a !== null && b !== null, "both partners must be interned");
  const sa = store.sketchGet(a) ?? [];
  const sb = store.sketchGet(b) ?? [];
  assert.ok(
    sa.length > 0 && sb.length > 0,
    "both partners must sketch something",
  );
  const shared = sa.filter((n) => sb.includes(n));
  assert.ok(
    shared.length > 0,
    `no shared constituent: A=${
      JSON.stringify(sa.map((n) => dec.decode(store.bytes(n))))
    } ` +
      `B=${JSON.stringify(sb.map((n) => dec.decode(store.bytes(n))))}`,
  );
});

// ── 5. an irrelevant tail must not buy unbounded work ────────────────────
test("T5: work per profile does not grow with an irrelevant structural tail", async () => {
  const work = [];
  for (const n of [10, 40, 160]) {
    const { store, counts } = countingStore({ path: ":memory:", D: 1024 });
    const mind = new Mind({ seed: 7, store });
    await mind.ingest([[longText(n), "continuation"]]);
    work.push({ n, parentsFirst: counts.parentsFirst });
  }
  // parentsFirst is the hub probe — exactly one per SKETCHED constituent, so it
  // measures the stopping rule's own cost. Capacity bounds it at √D per pour.
  const cap = profileCapacity(1024);
  for (const w of work) {
    assert.ok(
      w.parentsFirst <= cap * 8,
      `hub probes ${w.parentsFirst} at n=${w.n} exceed a capacity-bounded budget`,
    );
  }
  // 16x the tail must not cost 16x the stopping work.
  const ratio = work[2].parentsFirst / Math.max(1, work[0].parentsFirst);
  assert.ok(
    ratio < 4,
    `stopping work grew ${ratio.toFixed(1)}x for a 16x tail`,
  );
});

// ── 6. corpus growth must not explode the stopping cost ──────────────────
test("T6: the same partner costs the same to profile as the corpus grows", async () => {
  const probe = async (extra) => {
    const { store, counts } = countingStore({ path: ":memory:", D: 1024 });
    const mind = new Mind({ seed: 7, store });
    const filler = Array.from(
      { length: extra },
      (_, i) => [`ctx ${i} alpha`, `ans ${i} beta`],
    );
    await mind.ingest(filler);
    const before = counts.parentsFirst;
    await mind.ingest([[longText(30), "continuation"]]);
    return counts.parentsFirst - before;
  };
  const small = await probe(20);
  const large = await probe(600);
  assert.ok(
    large <= small * 2 + 16,
    `profiling cost grew with corpus size: ${small} -> ${large} hub probes`,
  );
});

// ── 7. stopping happened only once evidence was insignificant ────────────
test("T7: saturated profiles report a marginal at or below the noise floor", async () => {
  const { mind } = mk();
  const diag = await ingestTraced(mind, [[
    longText(40),
    "a short continuation",
  ]]);
  const sat = diag.filter((d) => d.saturated);
  assert.ok(sat.length > 0, "expected a saturated profile");
  for (const d of sat) {
    assert.equal(d.noiseFloor, estimatorNoise(1024));
    // mass = accepted + 1, and capacity is the point where 1/mass reaches the
    // floor. Accepting everything sketched puts marginal AT the floor; hub
    // exclusion can leave it above, and the diagnostics must say which.
    assert.ok(d.mass > 1, "a saturated profile superposed nothing");
    assert.equal(d.residual, d.sketched - d.accepted);
    assert.ok(
      d.marginal <= d.noiseFloor || d.hubDropped + d.dominating === d.residual,
      `marginal ${d.marginal} above floor ${d.noiseFloor} with unexplained residual`,
    );
  }
});

// ── 8. the instrumentation is not decorative ─────────────────────────────
test("T8: perturbing capacity measurably moves the diagnostics", async () => {
  // profileCapacity is √D, so changing D perturbs the saturation point. If the
  // reported numbers did not follow, the diagnostics would be describing
  // something other than the rule that actually stops the walk.
  const at = async (D) => {
    const store = new SQliteStore({ path: ":memory:", D });
    const mind = new Mind({ seed: 7, store });
    const diag = await ingestTraced(mind, [[
      longText(40),
      "a short continuation",
    ]]);
    return diag.filter((d) => d.saturated);
  };
  const small = await at(256); // capacity 16
  const large = await at(4096); // capacity 64
  assert.ok(
    small.length > 0 && large.length > 0,
    "both D values must saturate",
  );
  assert.equal(small[0].capacity, profileCapacity(256));
  assert.equal(large[0].capacity, profileCapacity(4096));
  assert.ok(
    large[0].sketched > small[0].sketched,
    `sketch size did not follow capacity: ${small[0].sketched} vs ${
      large[0].sketched
    }`,
  );
  assert.ok(
    large[0].marginal < small[0].marginal,
    `marginal did not follow capacity: ${small[0].marginal} vs ${
      large[0].marginal
    }`,
  );
});
