// 126 — a pipeline NÃO conhece mecanismos pelo nome.
//
// `pipeline-mechanism.ts` promete, no cabeçalho: "it never imports a
// mechanism-specific type and never has a special-case branch for any
// mechanism".  A pós-grounding violava-o: decidia por NOME de proveniência
// (cast/join/recall/recall-echo) em vez de pelo que o mecanismo DECLARA no seu
// resultado.  O contrato já tem o molde certo — `MechanismResult.complete`, cujo
// doc diz "the decider honours the property and never asks which mechanism set
// it".  Este teste pina a propriedade, não a implementação: nenhuma comparação
// contra um nome de mecanismo no código compilado da pipeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const NOMES =
  /[=!]==?\s*"(cast|join|recall|recall-echo|cover|extract|prefix|reference|alu)"/;

test("126. the pipeline branches on what a mechanism DECLARES, not on its name", () => {
  const src = readFileSync(
    new URL("../dist/src/mind/pipeline.js", import.meta.url),
    "utf8",
  );
  // ANTI-VACUITY: o ficheiro tem de ser o certo e tem de falar de proveniência —
  // senão o teste passaria por o ficheiro estar vazio.
  assert.ok(src.length > 2000, `pipeline.js looks wrong (${src.length} bytes)`);
  assert.ok(
    src.includes("provenance"),
    "pipeline.js must mention provenance at all",
  );
  const nomes = src.split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => NOMES.test(l))
    .map(([i, l]) => `${i}: ${l.trim().slice(0, 90)}`);
  assert.deepEqual(
    nomes,
    [],
    `the pipeline compares provenance against a mechanism NAME, which the market ` +
      `contract forbids (it must read a declaration instead):\n  ${
        nomes.join("\n  ")
      }`,
  );
});
