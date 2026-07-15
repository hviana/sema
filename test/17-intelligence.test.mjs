// 17-intelligence.test.mjs — the intelligence regression bed.
//
// A corpus that mirrors the trained model's hardest pathology: every record is a
// shared instruction FRAME ("You are a helpful and harmless assistant…") plus a
// distinctive instruction → an answer. The shared scaffolding is the overwhelming majority of
// every context's bytes, so whole-query gist resonance is pulled toward the
// shared preamble and cannot, by itself, tell the records apart. Answering a
// reworded or partial query therefore demands the graph's CONNECTIVITY —
// consensus-climbing the structural parents-DAG to the context the query's
// distinctive sub-regions agree on — not mere whole-query similarity.
//
// These assertions pin down that capability so it cannot silently regress:
//   • exact and distractor-framed queries must always resolve (the floor);
//   • the aggregate score across query STYLES (exact, partial, paraphrase,
//     reorder, distractor) must stay at or above a bar that only the
//     connectivity-driven search clears — pure whole-query resonance scores far
//     below it (it answers only near-verbatim queries);
//   • a hard paraphrase that shares distinctive content resolves to its own
//     answer, not a scaffolding-neighbour's.
//
// The bar is deliberately below the current pass count so ordinary codec/ANN
// jitter never flakes it, while a real loss of the climb (e.g. reverting to
// whole-query resonance) drops well beneath it and fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const SYS =
  "You are a helpful and harmless assistant.\n\nYou are not allowed to use any tools.\n";

const FACTS = [
  [
    "Describe the importance of gender equality in the workplace to a high school student in exactly 4 sentences.",
    "Gender equality in the workplace means everyone has the same chance to be hired, paid, and promoted fairly.",
  ],
  [
    "Provide a summary of the 1992 Men's Olympic Basketball Team, the Dream Team, in 8 sentences.",
    "The 1992 Dream Team was the greatest basketball roster ever assembled, winning gold in Barcelona.",
  ],
  [
    "Write a short story in JSON format about a street-art vendor who helps a young artist.",
    '{"title":"First Mural","vendor":"Slick","artist":"Maya","scene":"a dawn alley of spray cans"}',
  ],
  [
    "Explain the importance of age discrimination laws to a high school student in 4 sentences.",
    "Age discrimination laws stop employers from treating people unfairly because of how old they are.",
  ],
  [
    "Write an essay analyzing the cinematography of a classic film with the title in double brackets.",
    "<<Light and Shadow>> Citizen Kane uses deep focus to layer meaning in every single frame.",
  ],
  [
    "Create a weekly basketball practice plan with drills for a high school team.",
    "Monday is dribbling and layup drills; Wednesday defense; Friday scrimmage and free throws.",
  ],
  [
    "Summarize the plot of a science fiction novel about time travel in three sentences.",
    "A physicist builds a machine that loops her through one fatal afternoon until she rewrites it.",
  ],
  [
    "Give tips for managing time as a returning college student with a family.",
    "Block your study hours like appointments, batch errands, and protect one evening a week to rest.",
  ],
  [
    "Explain how neighborhood watch programs improve community safety.",
    "Neighborhood watch programs deter crime by organizing residents to notice and report what is unusual.",
  ],
  [
    "Write a guided meditation script for managing anxiety before an exam.",
    "Breathe in for four counts, hold, release slowly, and let the worry drain from your shoulders.",
  ],
  [
    "Describe how social media platforms change interpersonal communication.",
    "Social media speeds contact but flattens nuance, so tone is read from emoji more than from words.",
  ],
  [
    "Summarize the rules of beach volleyball for a first-time spectator.",
    "Beach volleyball pairs two players a side who rally a ball over a net on sand, best of three sets.",
  ],
  [
    "Explain the water cycle to a curious eight-year-old in simple terms.",
    "The sun warms water into vapor, clouds gather it, and rain returns it to rivers and the sea again.",
  ],
  [
    "Write a cover letter for a junior data analyst position at a fintech startup.",
    "Dear Hiring Team, I turn messy financial data into clear decisions, and your startup excites me.",
  ],
  [
    "Describe the health benefits of a Mediterranean diet for older adults.",
    "A Mediterranean diet of olive oil, fish, and vegetables protects the heart and steadies the mind.",
  ],
  [
    "Explain how photosynthesis converts sunlight into chemical energy.",
    "Photosynthesis captures sunlight in chlorophyll to bind carbon dioxide and water into sugar.",
  ],
  [
    "Give advice for a beginner learning to play acoustic guitar.",
    "Start with clean open chords, keep your wrist loose, and practice short daily rather than long rarely.",
  ],
  [
    "Summarize the causes of the fall of the Western Roman Empire.",
    "The Western Roman Empire fell from overreach, currency decay, and waves of migrating peoples.",
  ],
  [
    "Describe best practices for securing a home wireless network.",
    "Secure a home network with WPA3, a long unique passphrase, and firmware kept promptly updated.",
  ],
  [
    "Write a haiku about the first snowfall in a quiet city.",
    "First snow on lamplight / the city holds its breath once / footprints fill with white.",
  ],
];

// [style, query (shared opening prepended at ask time), index of the expected FACT]
const PROBES = [
  ["exact", FACTS[0][0], 0],
  ["exact", FACTS[17][0], 17],
  [
    "partial",
    "Describe the importance of gender equality in the workplace.",
    0,
  ],
  ["partial", "Write a short story in JSON about a street-art vendor.", 2],
  [
    "partial",
    "Provide a summary of the 1992 Men's Olympic Basketball Team.",
    1,
  ],
  ["partial", "Create a weekly basketball practice plan with drills.", 5],
  ["partial", "Explain how photosynthesis works.", 15],
  [
    "paraphrase",
    "Tell a high schooler why gender equality at work matters.",
    0,
  ],
  [
    "paraphrase",
    "Give me an overview of the 1992 Dream Team basketball squad.",
    1,
  ],
  ["paraphrase", "Why do age discrimination laws matter, explained simply?", 3],
  ["paraphrase", "What does the Mediterranean diet do for the elderly?", 14],
  ["paraphrase", "What happened to the Western Roman Empire and why?", 17],
  [
    "reorder",
    "In the workplace, the importance of gender equality, describe it.",
    0,
  ],
  [
    "distractor",
    "I was chatting with a friend and wondered, how does photosynthesis convert sunlight into energy?",
    15,
  ],
  [
    "distractor",
    "Quick question before lunch — the health benefits of a Mediterranean diet for older adults?",
    14,
  ],
];

// A distinctive interior slice of the expected answer (lossy-first-byte tolerant).
const marker = (a) => a.replace(/\s+/g, " ").slice(1, 16);
const hits = (got, want) => got.replace(/\s+/g, " ").includes(marker(want));

async function build() {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest(FACTS.map(([q, a]) => [SYS + q, a]));
  return { store, mind };
}

test("scaffolding-dominated corpus: connectivity answers across query styles", async () => {
  const { store, mind } = await build();
  const got = [];
  for (const [style, q, idx] of PROBES) {
    const ans = (await mind.respondText(SYS + q)).replace(/\s+/g, " ").trim();
    got.push({ style, ok: hits(ans, FACTS[idx][1]), ans });
  }
  await store.close();

  const by = (s) => got.filter((g) => g.style === s);
  const rate = (s) => by(s).filter((g) => g.ok).length;

  // Floor: exact reproduction and distractor-framed (distinctive content intact)
  // must ALWAYS resolve — these need no rewording intelligence, only that the
  // search finds present content.
  assert.equal(
    rate("exact"),
    by("exact").length,
    "every exact query must resolve",
  );
  assert.equal(
    rate("distractor"),
    by("distractor").length,
    "distinctive content buried in framing must still resolve",
  );

  // Aggregate: the climb must clear a bar that whole-query resonance cannot.
  // The bar of 15 absorbs codec/ANN jitter while a reversion to plain whole-
  // query resonance (which answers only near-verbatim queries) scores far
  // lower and fails.
  const total = got.filter((g) => g.ok).length;
  assert.ok(
    total >= 15,
    `intelligence score ${total}/${PROBES.length} — expected ≥ 15 ` +
      `(connectivity-driven climb; pure whole-query resonance scores far less)\n` +
      got.filter((g) => !g.ok).map((g) =>
        `  ✗ [${g.style}] ${g.ans.slice(0, 40)}`
      ).join("\n"),
  );

  // At least one genuine paraphrase must resolve to its OWN answer — the
  // signature of the consensus climb, impossible for scaffolding-pulled whole-query
  // resonance.
  assert.ok(
    rate("paraphrase") >= 2,
    `only ${rate("paraphrase")}/${
      by("paraphrase").length
    } paraphrases resolved — ` +
      `expected ≥ 2 (the climb's distinctive-region consensus)`,
  );
});

// A reworded query whose distinctive content clearly names one record must not
// be captured by a scaffolding-sharing neighbour — the precise win consensus-climbing
// delivers over whole-query gist.
test("a distinctive paraphrase resolves to its own record, not a frame neighbour", async () => {
  const { store, mind } = await build();
  const ans = (await mind.respondText(
    SYS + "Tell a high schooler why gender equality at work matters.",
  )).replace(/\s+/g, " ").trim();
  await store.close();
  assert.ok(
    hits(ans, FACTS[0][1]),
    `gender-equality paraphrase resolved to "${ans.slice(0, 48)}" — ` +
      `expected the gender-equality record`,
  );
});
