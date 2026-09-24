// 137-the-law-lives-once-and-below.test.mjs — the adversarial checks that are
// STRUCTURAL: the law's layer, the single definition of each reading, and the
// determinism that makes it a function rather than a procedure.
//
// These are the quality points the goal names that no behavioural test can
// reach: a green suite would say nothing about where the law sits, whether a
// reading was re-spelled somewhere else, or whether a verdict depends on the
// corpus.  So this file reads the SOURCE, and asserts:
//
//   137.1 THE LAYER, transitively.  The law's entire import closure is itself
//         plus `bytes.ts` — proved by walking the relative imports, not by
//         reading its import line.  That single fact carries three properties at
//         once: it sits below every tier that asks it, no cycle passes through
//         it, and it CANNOT reach the store, the corpus or a mechanism, so
//         nothing it decides can grow with the corpus.
//
//   137.2 ONE DEFINITION EACH.  Every reading the extraction unified has exactly
//         one definition in `src/`, and the coverage scan exists once — the
//         check that the five restatement spellings have not crept back, and
//         that the label has one home and one call site.
//
//   137.3 IT IS A FUNCTION.  The same state and continuation give the same
//         verdict, every time; and the same response run twice gives byte-equal
//         meter counters, so the extraction is deterministic end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");
const law = await import("../dist/src/mind/derivation.js");
const { Mind, SQliteStore } = await import("../dist/src/index.js");

/** The source with its comments removed, so a count of CALLS cannot be satisfied
 *  or broken by a mention in prose — the discipline this file is about. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/[^\n"']*$/gm, "");
}

/** Every `.ts` under src/, with its relative import targets resolved. */
async function graph() {
  const files = [];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".ts")) files.push(p);
    }
  };
  await walk(srcRoot);
  const g = new Map();
  const text = new Map();
  for (const f of files) {
    const s = await readFile(f, "utf8");
    // COUNTING uses the comment-free text; the import graph uses the raw text,
    // where a path in prose cannot invent an edge but a path in code must not be
    // missed.
    text.set(relative(join(here, ".."), f), stripComments(s));
    const targets = [];
    for (const m of s.matchAll(/from\s+"(\.[^"]+)"/g)) {
      targets.push(relative(join(here, ".."), join(dirname(f), m[1])).replace(/\.js$/, ".ts"));
    }
    g.set(relative(join(here, ".."), f), targets);
  }
  return { g, text };
}

test("137.1 the law's whole import closure is itself and bytes.ts", async () => {
  const { g } = await graph();
  const lawFile = "src/mind/derivation.ts";
  assert.ok(g.has(lawFile), `${lawFile} must exist`);
  const seen = new Set();
  const stack = [lawFile];
  while (stack.length > 0) {
    const f = stack.pop();
    assert.ok(g.has(f), `unresolved import target ${f}`);
    if (seen.has(f)) continue;
    seen.add(f);
    for (const t of g.get(f)) {
      assert.notEqual(
        t,
        lawFile,
        `an import cycle passes through ${lawFile}: ${f} imports it back`,
      );
      stack.push(t);
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    ["src/bytes.ts", "src/mind/derivation.ts"],
    "the law must reach NOTHING else — a store, a corpus helper or a mechanism " +
      "in its closure would let a verdict depend on the corpus, and would put the " +
      "law above a layer instead of below every one",
  );
});

test("137.2 every unified reading has exactly one definition", async () => {
  const { text } = await graph();
  const all = [...text.entries()];
  const count = (re) =>
    all.reduce((n, [, s]) => n + (s.match(re) ?? []).length, 0);

  // the law's own functions, each defined once in all of src/
  for (const fn of [
    "unaccountedBytes", "unexplainedSpans", "remainderOf", "carries", "closed",
    "admissible", "advance", "closure", "restates", "insideAnsweredTurn",
  ]) {
    assert.equal(
      count(new RegExp(`export (?:async )?function ${fn}\\(`, "g")),
      1,
      `${fn} must have exactly ONE definition in src/ — a second is a spelling ` +
        `that will drift`,
    );
  }
  // the coverage scan (the law's measure) — the one the brake used to duplicate
  assert.equal(
    count(/i \+ W <= b/g),
    1,
    "the coverage scan must exist exactly once in src/",
  );
  // the label: one definition, and exactly one call site outside its own file
  assert.equal(count(/export function unexplainedLabel\(/g), 1);
  let calls = 0;
  for (const [f, s] of all) {
    if (f.endsWith("rationale.ts")) continue;
    calls += (s.match(/unexplainedLabel\(/g) ?? []).length;
  }
  assert.equal(
    calls,
    1,
    `the label must be rendered in exactly one place outside its definition, ` +
      `found ${calls}`,
  );
  // and the old spellings are gone by name
  const stale = all.filter(([, s]) => /(?<!seg)restatesQuery/.test(s));
  assert.deepEqual(
    stale.map(([f]) => f),
    [],
    "the old restatement spelling is still in the tree",
  );
});

test("137.3 the law is a function, end to end", async () => {
  const query = new TextEncoder().encode("What is the capital of France famous for");
  const W = 4;
  const state = {
    product: query,
    accounted: [],
    remainder: law.remainderOf(query.length, [], W),
    cost: 0,
  };
  const conts = [
    { product: query.subarray(0, 3 * W), contains: true, cost: 1 },
    { product: new TextEncoder().encode("qqqqqqqqqqqq"), contains: true, cost: 1 },
    { product: new TextEncoder().encode("qqqqqqqqqqqq"), contains: false, cost: 1 },
  ];
  for (const t of conts) {
    const a = law.admissible(state, t, query, W);
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(
        law.admissible(state, t, query, W),
        a,
        "the same state and continuation must give the same verdict",
      );
    }
  }

  // AND THE SAME RESPONSE TWICE GIVES THE SAME COUNTERS.
  const CHAIN = [
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["the Eiffel Tower", "the Eiffel Tower is in Paris"],
  ];
  const run = async () => {
    const store = new SQliteStore({ path: ":memory:" });
    const mind = new Mind({ seed: 7, store, profile: true });
    await mind.ingest(CHAIN);
    const steps = [];
    const answer = String(await mind.respondText(
      "What is the capital of France famous for",
      (s) => steps.push(s),
    )).trim();
    const out = {
      answer,
      moves: steps.map((s) => s.mechanism.join("/")),
      counters: mind.lastCost?.counters ?? {},
    };
    await store.close();
    return out;
  };
  assert.deepEqual(await run(), await run(), "two identical runs must agree");
});


test("137.4 a repeated query answers identically and does no more work", async () => {
  // THE CONTRACT, and the measurement that settles what it means.  AGENTS invariant
  // #1 promises a byte-identical ANSWER for the same seed, deposit order and query —
  // and that holds here while the COUNTERS of a repeated query DROP: the per-response
  // memos (`perceiveMemo`, the node/edge caches, the ANN result cache) are warm, so
  // the second run reads less.  Measured on the prefix-refusal, hub and fuse
  // fixtures: the answer and the whole step sequence identical, and every counter
  // that appears in both runs lower or equal in the second — the largest drops being
  // edgeProbes 75 -> 1 and nodeRecords 5 -> 1.
  //
  // So determinism is about WHAT is answered, never about what it COSTS the second
  // time: asserting equal counters would assert that the caches never warm.
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const cases = [
    [[["The capital of France is", "The capital of France is Paris."], ["The capital of France is", "The capital of France is Lyon."]], "The capital of France is"],
    [[["paris", "paris is the capital of france"], ["paris", "paris is famous for the eiffel tower"]], "paris"],
    [[["What is the capital of France", "The capital of France is Paris"], ["2+2", "2+2 equals 4"]], "What is the capital of France and what is 2 + 2?"],
  ];
  for (const [pairs, q] of cases) {
    const store = new SQliteStore({ path: ":memory:" });
    const mind = new Mind({ seed: 7, store, profile: true });
    await mind.ingest(pairs);
    const s1 = [];
    const a1 = String(await mind.respondText(q, (s) => s1.push(s))).trim();
    const c1 = mind.lastCost?.counters ?? {};
    const s2 = [];
    const a2 = String(await mind.respondText(q, (s) => s2.push(s))).trim();
    const c2 = mind.lastCost?.counters ?? {};
    assert.equal(a1, a2, `q=${JSON.stringify(q)}: the repeated query answered differently`);
    assert.deepEqual(
      s2.map((s) => s.mechanism.join("/")),
      s1.map((s) => s.mechanism.join("/")),
      `q=${JSON.stringify(q)}: the repeated query took a different path`,
    );
    for (const k of Object.keys(c1)) {
      if (c2[k] === undefined) continue;
      assert.ok(
        c2[k] <= c1[k],
        `q=${JSON.stringify(q)}: the repeated query did MORE work on ${k} (${c1[k]} -> ${c2[k]}) — ` +
          `a cache or memo is not warming, which is a cost regression, not determinism`,
      );
    }
    await store.close();
  }
});
