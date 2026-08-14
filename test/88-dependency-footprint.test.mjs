// 88 — the dependency footprint is a PRODUCT PROPERTY, so it is tested.
//
// AGENTS.md §6: "do not add runtime dependencies casually — the near-zero-
// dependency footprint is a product feature." A feature stated only in prose
// erodes; this suite pins it at the two places it can actually break.
//
//   1. The BUILT LIBRARY imports nothing outside `node:`. Not the source — the
//      built output, because that is what a consumer loads.
//   2. The PACKAGE declares no runtime `dependencies`. A package can be
//      import-clean and still force installs on every consumer; that is exactly
//      how `hyparquet` — used only by example/train_base, never by src/ — came
//      to be installed by everyone who depended on Sema.
//
// The trainer example is deliberately NOT covered: it may use whatever it
// needs, as a dev dependency, loaded lazily (see example/train_base/readers.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Every built .js file of the library itself. */
function libFiles(dir = join(ROOT, "dist/src"), out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) libFiles(p, out);
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** Module specifiers of static imports/exports and dynamic import() calls. */
function specifiersOf(src) {
  const out = [];
  const patterns = [
    /(?:^|\s)(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\s)import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) out.push(m[1]);
  }
  return out;
}

test("the built library imports nothing outside node: builtins", () => {
  const files = libFiles();
  assert.ok(files.length > 0, "dist/src is empty — run `npm run build` first");

  const foreign = [];
  for (const file of files) {
    for (const spec of specifiersOf(readFileSync(file, "utf8"))) {
      const ok = spec.startsWith("./") || spec.startsWith("../") ||
        spec.startsWith("node:");
      if (!ok) foreign.push(`${file.slice(ROOT.length)} → ${spec}`);
    }
  }
  assert.deepEqual(
    foreign,
    [],
    "the library gained a third-party import; keep it in an example instead",
  );
});

test("the package forces no runtime dependencies on consumers", () => {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  );
  const deps = Object.keys(pkg.dependencies ?? {});
  assert.deepEqual(
    deps,
    [],
    "a package a consumer installs must not carry dependencies only an " +
      "example needs — declare them under devDependencies",
  );
});

test("the published entry points resolve inside dist/src", () => {
  // A `main`/`exports` that reached outside dist/src would drag the example —
  // and its dev dependencies — into a consumer's module graph.
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const entries = [
    pkg.main,
    pkg.types,
    pkg.exports?.["."]?.default,
    pkg.exports?.["."]?.types,
  ].filter(Boolean);
  assert.ok(entries.length > 0, "no entry points declared");
  for (const e of entries) {
    assert.match(
      e,
      /^(\.\/)?dist\/src\//,
      `entry point "${e}" escapes dist/src`,
    );
  }
});
