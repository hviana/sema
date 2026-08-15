// 89-completion-recursion.test.mjs — the completion recursion must be
// OUTPUT-SENSITIVE.
//
// AGENTS §2.8: "No per-query read may grow with the corpus."  §2.8 enforces
// that per READ (nextFirst, bytesPrefix, …), and every one of those caps holds.
// What no guard covered is the NUMBER of reads: `recompleteNode`
// (src/mind/graph-search.ts) re-covers a produced node by calling `solve`
// recursively, and each nested solve builds its own agenda and chart.  Its own
// doc states the intent —
//
//     "its cost tracks the ANSWER's own structure, not how densely the corpus
//      interconnects the nodes passed through"
//
// — but argues termination from "Distinct node ids are finite and each finished
// completion is memoised".  Finite-in-the-corpus is exactly the bound §2.8
// forbids, and the recursion is emitted at `cost: 0` while the nested cover's
// own `cost` is computed and discarded, so A* has no gradient against depth.
//
// MEASURED on a trained store (18,938,834 nodes, edgeSourceCount 796,528):
// `respond("Hi")` reached recursion depth 331 and 9.1 GB RSS in 56 s without
// terminating.  Every level was a "Hi…" opener — a 2-byte hub re-entering
// itself — and the descent visited whole utterances unrelated to the answer
// ("Who's their goalkeeper?", "Glad I could assist, have a great day.").  That
// is what killed a 5 h training run at a checkpoint recall: the 15 s
// withTimeout around it is a setTimeout, and a synchronous search never yields
// to the timer phase, so it cannot fire.
//
// WHY THE EXISTING GUARD MISSES IT.  14-scaling.test.mjs asserts this same law
// ("inference: cost is sublinear in corpus size"), but builds each size point
// from a DISJOINT salted corpus and queries it with `unknownInput()`, whose
// "tokens are substrings of no learned form".  A query that recognises nothing
// never enters the graph, so it never reaches the fixpoint that gates the
// recursion.  Both assumptions are load-bearing; this file drops them.
//
// THE CORPUS.  Real English fragments taken from the repo's own *.md prose and
// recombined, plus the query deposited as a standalone context with several
// continuations (what makes a greeting a hub in real dialogue).  Eight
// hand-written generators failed to reproduce this — chains stop after two
// rungs, dense graphs never reach a fixpoint, and a query the pipeline declines
// never reaches `cover` at all.  Real prose plus a deposited hub does it.
// Nothing is added to the tree: the corpus is the documentation already here.
//
// MEASURED HERE, on the deterministic public counters (mind.lastCost), answer
// byte-identical at every size:
//
//        pairs   searches      pops     maxDepth
//         1508        126    55,208           71
//         2008        196    88,241          127
//         3008        309   146,282          207
//         4008        416   201,174          270      (22 s for a 3-byte query)
//
//   growth exponent k ≈ 1.25 (searches), 1.32 (pops) — SUPER-linear.
//
// With the recursion bounded, the same corpus gives searches 10→13 and pops
// 3,946→5,826 (k ≈ 0.27 / 0.40) in 0.31 s→0.76 s, and the answer does not
// change.  So this file's thresholds are achievable, and the fix costs nothing
// in output on this corpus.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── corpus ────────────────────────────────────────────────────────────────
// Deterministic scrambler: the suite forbids Math.random in fixtures, and the
// whole point of the counters is that two runs are diffable.
const mix = (x) => {
  x = (x ^ 61) ^ (x >>> 16);
  x = x + (x << 3);
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d);
  return (x ^ (x >>> 15)) >>> 0;
};

/** Four-word windows of the repo's own English prose.  Code fences, inline
 *  code and link targets are stripped so what is left is language, which is
 *  where the fragment overlap lives. */
function fragments() {
  const out = [];
  for (const f of readdirSync(REPO).filter((f) => f.endsWith(".md")).sort()) {
    let t = readFileSync(join(REPO, f), "utf8");
    t = t.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
    t = t.replace(/\[[^\]]*\]\([^)]*\)/g, " ");
    t = t.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ");
    const w = t.split(" ").filter(Boolean);
    for (let i = 0; i + 4 < w.length; i += 2) {
      out.push(w.slice(i, i + 4).join(" "));
    }
  }
  return out;
}

const FRAG = fragments();
const QUERY = "hi.";

const utter = (i) =>
  [
    FRAG[mix(i * 3 + 1) % FRAG.length],
    FRAG[mix(i * 5 + 2) % FRAG.length],
    FRAG[mix(i * 7 + 3) % FRAG.length],
  ].join(" ");

/** n recombined utterance pairs, plus the query as a standalone context with
 *  eight distinct continuations — the hub.  Every pair's answer is itself a
 *  context (multi-turn), so a completed form has somewhere to continue. */
function corpus(n) {
  const pairs = [];
  for (let k = 0; k < 8; k++) pairs.push([QUERY, utter(k * 101 + 7)]);
  for (let i = 0; i < n; i++) {
    pairs.push([utter(i), utter(i * 3 + 1)]);
    pairs.push([utter(i * 3 + 1), utter(i * 7 + 2)]);
  }
  return pairs;
}

/** Power-law exponent k in work ≈ c·n^k, by log–log least squares — the same
 *  statistic and the same k < 0.6 bar 14-scaling.test.mjs uses. */
function logLogSlope(sizes, ys) {
  const n = sizes.length;
  const xs = sizes.map(Math.log), ly = ys.map((v) => Math.log(Math.max(v, 1)));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ly.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ly[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return num / den;
}

// `corpus(n)` emits two pairs per turn plus the eight hub pairs, so these are
// the 1508 / 2008 / 3008-pair points of the table above.
const SIZES = [750, 1000, 1500];

test("completion recursion: per-query work does not grow with the corpus", async () => {
  assert.ok(
    FRAG.length > 4000,
    `only ${FRAG.length} prose fragments found in ${REPO}/*.md — this test ` +
      `draws its corpus from the repo's own documentation; with the prose gone ` +
      `it can no longer exercise the completion recursion at all`,
  );

  const searches = [], pops = [], answers = [], secs = [];

  for (const n of SIZES) {
    const store = new SQliteStore({ path: ":memory:", D: 1024 });
    const mind = new Mind({ seed: 7, store, profile: true });
    await mind.ingest(corpus(n));

    const t0 = performance.now();
    const answer = String(await mind.respondText(QUERY));
    secs.push((performance.now() - t0) / 1000);

    const c = mind.lastCost.counters;
    searches.push(c.searches ?? 0);
    pops.push(c.searchPops ?? 0);
    answers.push(answer);
    await store.close();
  }

  console.log("    completion recursion vs corpus size (fixed 3-byte query):");
  SIZES.forEach((n, i) =>
    console.log(
      `      pairs=${String(n * 2 + 8).padStart(5)}  searches=${
        String(searches[i]).padStart(5)
      }  pops=${String(pops[i]).padStart(8)}  ${secs[i].toFixed(2)}s`,
    )
  );

  // NON-VACUITY.  If the corpus stopped reaching the recursion, every counter
  // would be flat at zero and the growth assertions below would pass while
  // proving nothing.  A test that can go green by not exercising the code is
  // worse than no test, so this fails loudly instead.
  assert.ok(
    searches.every((s) => s > 0),
    `the graph search never ran (searches=${JSON.stringify(searches)}) — the ` +
      `corpus no longer engages cover(), so this file is not testing anything`,
  );

  // NO OUTPUT CONFOUND.  Work is allowed to grow with the ANSWER.  Pinning the
  // answer byte-for-byte across every size removes that defence entirely: any
  // growth measured below bought exactly nothing.
  assert.ok(
    answers.every((a) => a === answers[0]),
    `the answer changed across corpus sizes (${
      JSON.stringify(answers.map((a) => a.slice(0, 40)))
    }) — with the output moving, work growth is no longer attributable to the ` +
      `corpus alone`,
  );

  const kSearches = logLogSlope(SIZES, searches);
  const kPops = logLogSlope(SIZES, pops);
  console.log(
    `      growth exponent k ≈ ${kSearches.toFixed(2)} (nested searches), ${
      kPops.toFixed(2)
    } (agenda pops) — target ≪ 1 (sublinear in the corpus)`,
  );

  // THE LAW.  Same answer, more corpus, so cost must not move.  k ≈ 0 is flat,
  // k ≈ 1 is linear in the corpus — the bound §2.8 forbids outright.
  //
  // `searches` counts nested solve() calls, which is the recursion itself and
  // nothing else, so it gets 14-scaling.test.mjs's stricter 0.6 bar.  Measured
  // 1.28 unfixed, 0.38 fixed.
  assert.ok(
    kSearches < 0.6,
    `nested searches grew with exponent k=${kSearches.toFixed(2)} in corpus ` +
      `size (${searches.join(" → ")}) for a byte-identical answer — each ` +
      `nested solve() builds its own agenda and chart, so this is the ` +
      `completion recursion doing work the answer never asked for`,
  );
  // A LOOSER BAR, FOR A REASON.  `searchPops` aggregates the TOP-LEVEL cover's
  // agenda too, and that one legitimately carries some corpus sensitivity: a
  // bigger store recognises more sites inside the same query, so more items are
  // admissible.  Only outright linear growth is the forbidden case (§2.8), so
  // this asserts the law itself, k < 1, rather than the stricter 0.6 that suits
  // a counter the fix governs end to end.  Measured 1.40 unfixed, 0.54 fixed.
  assert.ok(
    kPops < 1,
    `agenda pops grew with exponent k=${kPops.toFixed(2)} in corpus size (${
      pops.join(" → ")
    }) for a byte-identical answer — k≈1 is work LINEAR in the corpus, which ` +
      `is the bound §2.8 forbids outright`,
  );
});
