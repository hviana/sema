// 127 — o privilégio de dominância lê UMA grandeza, em todos os modos.
//
// `commitVotes` escolhe o dominante pela ORDEM de `ranked` — e `ranked` mantém
// a ordem de inserção do mapa `votes`, que depende da ponderação do MODO.  A
// comparação logo abaixo (`tiedWithDominant`) lê `votesIdf`.  Medido
// (goal-df37b980, achado 2): em `direct`/`combined` o primeiro por ordem tinha
// IDF 1.52 enquanto outra âncora tinha 2.01 — ou seja, quem "always grounds"
// (o dominante passa os dois gates de voto) era escolhido por uma grandeza
// diferente da que decide o runner-up.  Este teste pina a propriedade: em
// TODOS os modos, o primeiro anchor do climb é o de maior IDF.
import { test } from "node:test";
import assert from "node:assert/strict";

const MODES = ["inverse", "direct", "combined"];

test("127. the dominance privilege reads the IDF quantity, in every mode", async () => {
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    [
      "The tallest tower in Paris",
      "The tallest tower in Paris is the Eiffel Tower",
    ],
    ["Gustaf Molander", "Gustaf Molander was a Swedish film director"],
    ["Stockholm", "Stockholm is the capital of Sweden"],
    ["What is the capital of Sweden", "The capital of Sweden is Stockholm"],
    // Two INDEPENDENT, rare subjects.  The fixture must still produce a
    // multi-anchor climb AFTER the fix: before it, ordering by `vote` put a
    // deflated second anchor in the list, which is what the pin compared.  With
    // the ordering reading IDF, only genuinely independent subjects survive —
    // so the fixture has to carry two of them, not one.
    ["Zamunda is a country", "The capital of Zamunda is Zamundaburg"],
    ["Kakania is a country", "The capital of Kakania is Kakanien"],
  ]);
  const QS = [
    "capital of France and Sweden",
    "capital of Zamunda and capital of Kakania",
    "who was Gustaf Molander and what is the capital of Zamunda",
    "the tallest tower in Paris and Gustaf Molander",
    "2+2 and the capital of France",
  ];
  const enc = new TextEncoder();
  const offenders = [];
  let multi = 0;
  for (const q of QS) {
    for (const m of MODES) {
      const roots = await mind.climbAttention(enc.encode(q), 8, m);
      const as = (roots ?? []).map((r) => ({
        id: r.anchor,
        idf: r.idfVote ?? 0,
      }));
      if (as.length < 2) continue;
      multi++;
      const maxIdf = Math.max(...as.map((a) => a.idf));
      if (as[0].idf < maxIdf - 1e-12) {
        offenders.push(
          `${m}: "${q}" picked #${as[0].id} (idf ${
            as[0].idf.toFixed(2)
          }) over idf ${maxIdf.toFixed(2)}`,
        );
      }
    }
  }
  await store.close();
  // ANTI-VACUITY: sem um caso com duas âncoras, o teste não compara nada.
  assert.ok(
    multi >= 1,
    `the fixture must produce at least one multi-anchor climb (found ${multi})`,
  );
  assert.deepEqual(
    offenders,
    [],
    `the dominance privilege is allocated by a mode-dependent order:\n  ${
      offenders.join("\n  ")
    }`,
  );
});
