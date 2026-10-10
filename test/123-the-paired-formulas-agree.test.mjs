// 123 — the derived formulas the house writes PER SIDE have to agree.
//
// Three derived quantities are written per side by design: `atomIsHub`/
// `atomReach`, `leadsSomewhere` and the interior's phrase scale.
// `graph-search.ts` is *host-based* on purpose (it does not know
// `MindContext`), so the formula repeats — and a repeated formula drifts (the
// hub bound once did, on its `Math.max(2, …)` floor).  The hub bound has one
// home instead, `geometry.ts`'s `boundFor`, which both sides import.
//
// A pair test cannot call both homes (one is private), but it CAN read the
// code — as `test/88-dependency-footprint` reads imports.  Each pair is
// extracted by its own pattern, and if the extraction finds no formula the
// test FAILS: finding nothing would leave the pair comparing against nothing,
// the vacuous-pass class `prefix-completion.ts` names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = (p) =>
  readFileSync(new URL(`../dist/src/${p}`, import.meta.url), "utf8");

/** Extract `pattern` and return normalised group 1 — or fail, naming the file. */
function extract(file, pattern, what) {
  const text = SRC(file);
  const m = text.match(pattern);
  assert.ok(
    m !== null,
    `could not find ${what} in ${file} — the pair test would compare nothing ` +
      `(pattern: ${pattern}). Update the pattern WITH the formula.`,
  );
  return m[1].replace(/\s+/g, "").replace(/ctx\.store|this\.store/g, "S");
}

test("123. the duplicated derived formulas agree, home by home", () => {
  // ── (1) hubBound = ⌈√max(2, N)⌉ has ONE home: geometry.ts's `boundFor`.
  // Neither side that reads it spells it again.
  const SHAPE = /Math\.ceil\(Math\.sqrt\(Math\.max\(2,\s*[^)]*\)\)\)/;
  assert.ok(
    SHAPE.test(SRC("geometry.js")),
    `could not find the hub-bound formula in geometry.js (pattern: ${SHAPE})`,
  );
  for (const file of ["mind/traverse.js", "mind/graph-search.js"]) {
    assert.ok(
      !SHAPE.test(SRC(file)),
      `${file} spells the hub bound again instead of importing \`boundFor\``,
    );
  }

  // ── (2) atomReach = max(1, ⌈N·W/256⌉), in traverse.ts and in graph-search.ts ──
  // Each home names N and W differently (a parameter and `ctx.space.maxGroup`
  // against the store's edge-source count and the local `W`), so the PAIR is the
  // arithmetic shape — the `256` and the floor.
  const reachShape = (file, what) =>
    extract(
      file,
      /Math\.max\(1,\s*Math\.ceil\(\((?:[^()]|\([^()]*\))*\*\s*[A-Za-z_.]+\)\s*\/\s*(256)\)\)/,
      what,
    );
  assert.equal(
    reachShape("mind/traverse.js", "atomReach's shape"),
    reachShape("mind/graph-search.js", "the atomsAreHubs shape"),
    "the atom-reach formula has drifted between traverse.ts and graph-search.ts",
  );

  // ── (4) the interior phrase-scale allowance, in resonance.ts and attention.ts ──
  const resonance = extract(
    "mind/resonance.js",
    /maxInterior\s*=\s*[^;]*?\(\s*([A-Za-z_.]+\.length\s*\+\s*[A-Za-z_.]+\.length)\s*\)\s*\*\s*([A-Za-z_.]+\.maxGroup)/,
    "bridgeUncached's maxInterior",
  );
  const attention = extract(
    "mind/attention.js",
    /maxSiblingBytes\s*=\s*\(([A-Za-z_.]+Len\s*\+\s*[A-Za-z_.]+Len)\)\s*\*\s*([A-Za-z_.]+\.maxGroup)/,
    "maxSiblingBytes",
  );
  assert.equal(
    resonance.replace(/[A-Za-z_.]*\.length/g, "LEN"),
    attention.replace(/[A-Za-z_.]*Len/g, "LEN"),
    "the interior phrase-scale allowance has drifted between resonance.ts and attention.ts",
  );
});
