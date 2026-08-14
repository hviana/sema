// 84-composed-answer-honesty.test.mjs — a two-hop query must COMPOSE or stay
// SILENT. It must never fabricate: never return an answer built from content
// belonging to an unrelated deposit.
//
// WHAT THIS PINS, AND WHAT IT DOES NOT.
//
// Measured against a store fed REAL corpus text (Taskmaster dialogue + SmolSent)
// as distractors, with the chain below held constant:
//
//   deposits  N      pivot  result
//   ---------------------------------------------------------------------
//     1,000   1,091   yes   "The capital of France is Paris."      composed
//     3,000   3,065   yes   "The capital of France is Paris."      composed
//     6,000   6,013   no    "Does your order look correct?The country of Eiffel Tower …"
//     9,000   8,922   no    (the same fabrication)
//
// Controls held at EVERY scale — "Eiffel Tower country" and "France capital"
// each answered correctly throughout. So the substrate stays intact and only
// composition degrades, and when it degrades the store does not fall silent: it
// GLUES an unrelated dialogue turn onto hop 1 and returns that.
//
// This file CANNOT reproduce that. The failure needs real corpus text: a
// generated dialogue-shaped corpus of the same size composes cleanly at
// N = 6,003, and lexically-varied word-salad filler composes at N = 9,394. That
// matches the older observation that synthetic filler is far more forgiving than
// real text. Shipping the real corpus as a fixture is not an option — size, and
// the licence rules in DATASETS.md.
//
// So what runs here is the CONTRACT, at a scale where the engine currently
// honours it. It is a regression guard: if a future change makes the store
// fabricate at low N, this goes red. It does NOT cover the real-text ceiling.
//
// TO REPRODUCE THE REAL FAILURE: build the same chain, then ingest ~6,000
// deposits produced by the Taskmaster adapter (example/train_base.ts §6e′) from
// TM-2/TM-3/TM-4, and ask the two-hop question. See FINDINGS.md §A1/§A4.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const CHAIN = [
  ["Eiffel Tower country", "The country of Eiffel Tower is France."],
  ["France capital", "The capital of France is Paris."],
  // The pivot fact: a bare entity that also opens hop 2.
  ["France", "The capital of France is Paris."],
];
const TWO_HOP = "What is the capital of the country of Eiffel Tower?";

// Dialogue-shaped distractors — natural sentences rather than word salad, so
// the corpus looks like the one the trainer actually deposits.
const NOUN =
  "coffee latte pizza cinema hotel taxi museum concert train dentist library market garden harbour"
    .split(" ");
const ADJ =
  "small large iced hot early late extra plain double single quick quiet"
    .split(" ");
const SUBJ = "order booking ticket table room flight delivery payment account"
  .split(" ");
const pick = (a, i, n) => a[(i * n) % a.length];
const filler = (i) => [
  `Can I book ${pick(ADJ, i, 7)} ${pick(NOUN, i, 13)} for ${i}?`,
  `Does your ${pick(SUBJ, i, 11)} look correct? I have ${pick(ADJ, i, 3)} ${
    pick(NOUN, i, 17)
  } number ${i}.`,
];
const DEPOSITS = 1500;

async function storeWithDistractors() {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest(CHAIN);
  await mind.ingest(Array.from({ length: DEPOSITS }, (_, i) => filler(i)));
  return mind;
}

test("each hop still answers on its own — the substrate is intact", async () => {
  // The control that made the real-text measurement conclusive: when
  // composition fails it is NOT because a hop was lost.
  const mind = await storeWithDistractors();
  const hop1 = await mind.respondText("Eiffel Tower country");
  const hop2 = await mind.respondText("France capital");
  assert.ok(
    hop1.includes("France"),
    `hop 1 lost: ${JSON.stringify(hop1)}`,
  );
  assert.ok(
    hop2.includes("Paris"),
    `hop 2 lost: ${JSON.stringify(hop2)}`,
  );
});

test("a two-hop query composes or stays silent — it never fabricates", async () => {
  // THE CONTRACT. Three outcomes are conceivable and only two are acceptable:
  //   compose  -> the answer contains Paris
  //   silence  -> the empty answer, which is honest (AGENTS §2.13)
  //   fabricate-> an assembly carrying content from an unrelated deposit
  // The third is what a store past the real-text ceiling actually does.
  const mind = await storeWithDistractors();
  const answer = await mind.respondText(TWO_HOP);

  if (answer === "") return; // honest silence is acceptable

  assert.ok(
    answer.includes("Paris"),
    `neither composed nor silent — fabricated: ${JSON.stringify(answer)}`,
  );

  // Composing is not enough: the answer must not have dragged an unrelated
  // deposit along with it. Every distractor continuation contains "look
  // correct" or "Can I book", and no legitimate answer to this question does.
  for (const foreign of ["look correct", "Can I book", "number "]) {
    assert.ok(
      !answer.includes(foreign),
      `answer glued unrelated deposit content (${JSON.stringify(foreign)}): ${
        JSON.stringify(answer)
      }`,
    );
  }
});

test("an unanswerable two-hop query stays silent, not inventive", async () => {
  // The same contract where NO chain exists: there is no second hop to find,
  // so the only honest outcomes are silence or an answer about the first hop —
  // never a distractor's sentence.
  const mind = await storeWithDistractors();
  const answer = await mind.respondText(
    "What is the capital of the country of the Statue of Zamunda?",
  );
  for (const foreign of ["look correct", "Can I book"]) {
    assert.ok(
      !answer.includes(foreign),
      `invented an answer from an unrelated deposit: ${JSON.stringify(answer)}`,
    );
  }
});
