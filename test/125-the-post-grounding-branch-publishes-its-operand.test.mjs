// 125 — a ramificação da pós-grounding publica O QUE LEU.
//
// A pós-grounding decide por `decided.used` e pelo NOME da proveniência.  Os
// operandos não estavam no traço, e por isso uma mudança na ramificação não
// podia ser mostrada equivalente (ou não) de fora: três investigações
// separadas falharam exactamente nesse intervalo.  Um intervalo na
// instrumentação é um defeito NA instrumentação (AGENTS.md §6) — fechado no
// sítio, uma vez, como CONTAGENS, nunca conteúdo.
import { test } from "node:test";
import assert from "node:assert/strict";

test("125. the post-grounding branch publishes its operand", async () => {
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    ["Gustaf Molander", "Gustaf Molander was a Swedish film director"],
  ]);
  const passos = [];
  await mind.respondText("who was Gustaf Molander", (s) => passos.push(s));
  await store.close();
  const pg = passos.filter((p) => p.data && p.data.usedDeclared !== undefined);
  assert.ok(
    pg.length >= 1,
    `the response must emit a postGrounding step carrying the operand ` +
      `(steps with data: ${
        passos.filter((p) => p.data).map((p) => String(p.note).slice(0, 24))
          .join(" | ")
      })`,
  );
  const d = pg[pg.length - 1].data;
  assert.equal(
    typeof d.usedDeclared,
    "boolean",
    "usedDeclared states whether `used` arrived",
  );
  assert.equal(
    typeof d.preConsumed,
    "number",
    "preConsumed is a COUNT, never content",
  );
  assert.equal(typeof d.voiced, "number", "voiced is a COUNT, never content");
  assert.equal(
    typeof d.provenance,
    "string",
    "the name the OLD branch read is published too",
  );
});
