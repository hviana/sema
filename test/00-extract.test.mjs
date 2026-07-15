// 00-extract.test.mjs — extract a PIECE from prose by a TAUGHT skill.
//
// The requirement: ask about a part of a sentence and get just that part — a
// value the mind was NEVER told (it appears only in the question's own sentence).
//
// This is not blind carving of an isolated sentence (that is impossible — a never-
// seen value is, by construction, unrelated to anything learned, so nothing can
// locate it). It is a learned, transferable SKILL, the way a reasoner works:
//
//   • You TEACH the skill with a handful of episodes whose answer is a span of
//     the context — "The dog is named Rex." → "Rex", etc. The episodes share a
//     shape; the answer is the part that varies.
//   • You then ask an UNSEEN sentence of the same shape. The mind matches it to
//     the skill (the consensus climb, `climbAttentionAll`, over the structural DAG), locates the invariant
//     frame bytes bordering the answer in the exemplar, finds those same bytes
//     in the query by exact match, and reads whatever sits between them out of
//     the QUESTION itself — returning a value it was never told.
//
// The result is approximate by nature — a reasoner's relational read, not a byte
// rule — but consistent: the analogous span transfers across unseen values and
// across entirely different relations (named / capital / born). These assertions
// are literal equality on the extracted value.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const taught = async (episodes) => {
  const mind = new Mind({
    seed: 7,
  });
  await mind.ingest(episodes); // (sentence → answer-span) episodes: the SKILL
  return mind;
};

const ask = async (mind, q) => (await mind.respondText(q)).trim();

test("learn to extract a NAME, then extract it from unseen sentences", async () => {
  const mind = await taught([
    ["The dog is named Rex.", "Rex"],
    ["The cat is named Whiskers.", "Whiskers"],
    ["The horse is named Comet.", "Comet"],
    ["The parrot is named Echo.", "Echo"],
    ["The fish is named Bubbles.", "Bubbles"],
  ]);
  // Unseen sentences; the names below were NEVER deposited.
  assert.equal(await ask(mind, "The rabbit is named Clover."), "Clover");
  assert.equal(await ask(mind, "The owl is named Sage."), "Sage");
  assert.equal(await ask(mind, "The bear is named Honey."), "Honey");
  await mind.store.close();
});

test("the SAME mechanism learns a different relation: the capital", async () => {
  const mind = await taught([
    ["The capital of France is Paris.", "Paris"],
    ["The capital of Japan is Tokyo.", "Tokyo"],
    ["The capital of Egypt is Cairo.", "Cairo"],
    ["The capital of Peru is Lima.", "Lima"],
  ]);
  assert.equal(
    await ask(mind, "The capital of Brazil is Brasilia."),
    "Brasilia",
  );
  assert.equal(await ask(mind, "The capital of Italy is Rome."), "Rome");
  await mind.store.close();
});

test("and another relation: where someone was born", async () => {
  const mind = await taught([
    ["Einstein was born in Germany.", "Germany"],
    ["Curie was born in Poland.", "Poland"],
    ["Newton was born in England.", "England"],
    ["Tesla was born in Serbia.", "Serbia"],
  ]);
  assert.equal(await ask(mind, "Darwin was born in England."), "England");
  assert.equal(await ask(mind, "Mozart was born in Austria."), "Austria");
  await mind.store.close();
});

// Extraction and multi-hop are COMPOSABLE, not isolated branches: extracting a
// value and then reasoning from it is one pipeline. Here the extracted value
// ("Rome") has its own downstream fact, so the answer chains through it.
test("extraction COMPOSES with multi-hop reasoning", async () => {
  const mind = await taught([
    ["The capital of France is Paris.", "Paris"],
    ["The capital of Japan is Tokyo.", "Tokyo"],
    ["The capital of Egypt is Cairo.", "Cairo"],
    ["The capital of Peru is Lima.", "Lima"],
  ]);
  // A fact keyed on a value the skill will extract.
  await mind.ingest(["Rome", "Rome was the heart of a vast empire"]);
  // "Italy" is an unseen subject → extraction yields "Rome" → reason hops to its
  // fact. One pipeline: ground-by-skill, then walk the graph forward.
  assert.equal(
    await ask(mind, "The capital of Italy is Rome."),
    "Rome was the heart of a vast empire",
  );
  await mind.store.close();
});

// A MULTI-WORD answer span, reached from EITHER seat. The discriminative slice of
// the query ("painted by") is itself part of the answer span, so the consensus
// climb can land on the CONTINUATION seat (an answer like "Leonardo da Vinci",
// which bears no forward edge) rather than the context. The skill must still
// apply — rise through the answer's `prev` edge to the context that taught it —
// and the multi-word value must come back WHOLE (not truncated to one word, and
// not collapsed to a neighbour's answer via fallback recall).
test("extracts a MULTI-WORD span, from whichever seat the climb lands on", async () => {
  const mind = await taught([
    ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
    ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
    [
      "The Night Watch was painted by Rembrandt van Rijn.",
      "Rembrandt van Rijn",
    ],
    ["The Scream was painted by Edvard Munch.", "Edvard Munch"],
  ]);
  assert.equal(
    await ask(mind, "Guernica was painted by Pablo Picasso."),
    "Pablo Picasso",
  );
  assert.equal(
    await ask(mind, "The Persistence of Memory was painted by Salvador Dali."),
    "Salvador Dali",
  );
  await mind.store.close();
});

// The multi-word extraction COMPOSES with the forward hop: lift a never-seen
// painter out of the sentence, then reason onward to a stored fact keyed on that
// name. The reply contains no word of the question — generalization and a
// reasoning hop in one query (the README's headline demo).
test("multi-word extraction COMPOSES with a forward reasoning hop", async () => {
  const mind = await taught([
    ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
    ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
    [
      "The Night Watch was painted by Rembrandt van Rijn.",
      "Rembrandt van Rijn",
    ],
  ]);
  await mind.ingest([
    ["Pablo Picasso", "Pablo Picasso co-founded the Cubist movement"],
  ]);
  assert.equal(
    await ask(mind, "The Weeping Woman was painted by Pablo Picasso."),
    "Pablo Picasso co-founded the Cubist movement",
  );
  await mind.store.close();
});
