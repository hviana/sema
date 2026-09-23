// 130 — comment prose in `src/` is English.  THE MECHANICAL GUARD.
//
// The project is written in English, comments included, and this rule was
// broken by hand-written Portuguese prose — a whole-file-at-a-time sweep cannot
// stop it coming back, and nobody notices a stray paragraph.  So the rule is
// checked MECHANICALLY, here, and a violation fails the suite.
//
// WHAT COUNTS AS A VIOLATION: a Portuguese accented character appearing in a
// COMMENT (`//`, `*`, `/*`) OUTSIDE any quoted span.  Accents INSIDE quotes are
// data — a comment may quote corpus text ("Qual é a capital de França?",
// "buenos días") — so quoted spans are removed before the check, which is what
// makes the rule mechanical without an exception list.
//
// Also checked, because accents cannot see them: Portuguese IDENTIFIERS, from a
// short list of words that are Portuguese and not English.
//
// SCOPE: `src/**/*.ts` today.  `test/` and `example/` join once their own
// sweeps finish — a guard that fails on day one teaches nothing, and a guard
// narrowed to hide known violations teaches less.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ACCENT = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/;
const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const PT_WORDS =
  /\b(passos|ficheiro|ficheiros|linha|linhas|nome|nomes|valor|valores|prova|provas|resultado|resultados|conteudo|janela|janelas|busca|buscas|camada|camadas|entrada|saida|chave|chaves)\b/;

function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

test("130. comment prose in src/ is English (accents outside quotes)", () => {
  const violations = [];
  for (const file of tsFiles("src")) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!isComment(lines[i])) continue;
      const bare = lines[i].replace(QUOTED, "");
      if (ACCENT.test(bare)) {
        violations.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 100)}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Portuguese prose in src/ comments (accents outside quotes):\n  ${
      violations.join("\n  ")
    }`,
  );
});

test("130. src/ identifiers are not Portuguese", () => {
  const violations = [];
  for (const file of tsFiles("src")) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const bare = lines[i].replace(QUOTED, "");
      if (PT_WORDS.test(bare)) {
        violations.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 100)}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Portuguese identifiers in src/:\\n  ${violations.join("\n  ")}`,
  );
});
