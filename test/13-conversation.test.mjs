// 13-conversation.test.mjs — multi-turn conversation context.
//
// The question under test: when a conversation has many turns, does a later
// turn still have the context established earlier? Plain adjacency (each
// episode = previous turn → next turn) keeps only ONE turn of context, so it
// cannot tell apart two conversations that share a turn but differ earlier.
//
// ─────────────────────────────────────────────────────────────────────────
// Two functions drive every test:
//
//   teachConversation(mind, turns)  — accumulate prior turns into the context
//   predictNext(mind, priorTurns)   — join prior turns and recall the next
//
// The assertions describe BEHAVIOUR only — they never mention how context is
// represented — so they stay valid for any implementation.
//
// Note: Sema trains on the accumulated context string ("turn0\nturn1\nturn2")
// and queries the same accumulated string at inference. This is not a
// weakness — LLMs work the same way: a chat model receives the full
// conversation history as its prompt, and that same history must be
// provided at inference to produce the next turn. The difference is in
// how the answer is produced: Sema composes it from learned graph forms;
// an LLM samples it from a parametric distribution. Neither is "just a
// lookup."
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const newMind = () => new Mind({ seed: 7 });

// ═══════════════════════════════════════════════════════════════════════
// teachConversation — store one conversation (an ordered list of turns).
//
// Accumulate every prior turn into the context so each episode carries the
// full conversation history:  (t₀ → t₁), (t₀+t₁ → t₂), (t₀+t₁+t₂ → t₃) …
// A pivot turn ("what is its name?") that appears in two conversations now
// produces different episode vectors because the context side encodes which
// conversation it belongs to.  All SEMA operations remain sublinear — the
// river cuts any context into O(log N) chunks regardless of length.
// ═══════════════════════════════════════════════════════════════════════
async function teachConversation(mind, turns) {
  for (let i = 0; i + 1 < turns.length; i++) {
    const context = turns.slice(0, i + 1).join("\n");
    await mind.ingest(context, turns[i + 1]);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// predictNext — given the turns spoken so far, predict the next turn.
//
// Join every prior turn into one accumulated context, mirroring the storage
// pattern in teachConversation.  The resulting query string is the exact
// context side of the matching episode, so recall resolves unambiguously.
// ═══════════════════════════════════════════════════════════════════════
async function predictNext(mind, priorTurns) {
  const context = priorTurns.join("\n");
  return await mind.respondText(context);
}

// A small convenience: teach a conversation, then ask for the continuation
// after the first `k` turns.
async function continueAfter(turns, k) {
  const mind = newMind();
  await teachConversation(mind, turns);
  const out = await predictNext(mind, turns.slice(0, k));
  await mind.store.close();
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// Section A — basic completion (passes with one turn of context)
// ═══════════════════════════════════════════════════════════════════════

const CHAT = [
  "good morning",
  "hello there",
  "are you ready to start?",
  "yes, let us begin",
];

test("A1: first turn completes", async () => {
  assert.equal(await continueAfter(CHAT, 1), "hello there");
});

test("A2: middle turn completes", async () => {
  assert.equal(await continueAfter(CHAT, 2), "are you ready to start?");
});

test("A3: last step completes", async () => {
  assert.equal(await continueAfter(CHAT, 3), "yes, let us begin");
});

// ═══════════════════════════════════════════════════════════════════════
// Section B — context disambiguates a shared pivot turn  (TARGET)
//
// Both conversations contain the identical turn "what is its name?". Adjacency
// binds that turn to two different answers, so without earlier context the
// continuation is ambiguous. The earlier turn ("a cat" vs "a dog") must decide.
// ═══════════════════════════════════════════════════════════════════════

const CAT = ["I adopted a cat", "what is its name?", "her name is Whiskers"];
const DOG = ["I adopted a dog", "what is its name?", "his name is Rex"];

async function teachBoth() {
  const mind = newMind();
  await teachConversation(mind, CAT);
  await teachConversation(mind, DOG);
  return mind;
}

test("B1: earlier context selects the cat's answer", async () => {
  const mind = await teachBoth();
  assert.equal(
    await predictNext(mind, ["I adopted a cat", "what is its name?"]),
    "her name is Whiskers",
  );
  await mind.store.close();
});

test("B2: earlier context selects the dog's answer", async () => {
  const mind = await teachBoth();
  assert.equal(
    await predictNext(mind, ["I adopted a dog", "what is its name?"]),
    "his name is Rex",
  );
  await mind.store.close();
});

test("B3: the same pivot yields DIFFERENT answers per conversation", async () => {
  const mind = await teachBoth();
  const a = await predictNext(mind, ["I adopted a cat", "what is its name?"]);
  const b = await predictNext(mind, ["I adopted a dog", "what is its name?"]);
  assert.notEqual(a, b);
  await mind.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section C — context that lives SEVERAL turns back  (TARGET)
//
// The distinguishing turn ("Japan" vs "Italy") is two turns before the shared
// pivot, so it is invisible to adjacency AND to any fixed small window. Only an
// accumulated context carries it forward.
// ═══════════════════════════════════════════════════════════════════════

const TRIP_JP = [
  "we are planning a vacation",
  "I want to visit Japan",
  "what should we see first?",
  "start with Tokyo",
];
const TRIP_IT = [
  "we are planning a vacation",
  "I want to visit Italy",
  "what should we see first?",
  "start with Rome",
];

async function teachTrips() {
  const mind = newMind();
  await teachConversation(mind, TRIP_JP);
  await teachConversation(mind, TRIP_IT);
  return mind;
}

test("C1: Japan context (2 turns back) selects Tokyo", async () => {
  const mind = await teachTrips();
  assert.equal(
    await predictNext(mind, TRIP_JP.slice(0, 3)),
    "start with Tokyo",
  );
  await mind.store.close();
});

test("C2: Italy context (2 turns back) selects Rome", async () => {
  const mind = await teachTrips();
  assert.equal(
    await predictNext(mind, TRIP_IT.slice(0, 3)),
    "start with Rome",
  );
  await mind.store.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Section D — length & determinism  (TARGET for the long-range case)
//
// A longer conversation that still hinges on an early distinguishing turn:
// there must be no per-conversation turn cap, and repeating the experiment
// must give the same answer.
// ═══════════════════════════════════════════════════════════════════════

const longTrip = (place, first) => [
  "hello",
  `I am organising a long trip to ${place}`,
  "that sounds exciting",
  "we have two weeks",
  "and a generous budget",
  "we love food and history",
  "what should we see first?",
  `start with ${first}`,
];

test("D1: an early turn decides the answer many turns later", async () => {
  const mind = newMind();
  await teachConversation(mind, longTrip("Japan", "Tokyo"));
  await teachConversation(mind, longTrip("Italy", "Rome"));
  const jp = await predictNext(mind, longTrip("Japan", "Tokyo").slice(0, 7));
  const it = await predictNext(mind, longTrip("Italy", "Rome").slice(0, 7));
  assert.equal(jp, "start with Tokyo");
  assert.equal(it, "start with Rome");
  await mind.store.close();
});

test("D2: prediction is deterministic across runs", async () => {
  const run = async () => {
    const mind = newMind();
    await teachConversation(mind, CAT);
    const out = await predictNext(mind, [
      "I adopted a cat",
      "what is its name?",
    ]);
    await mind.store.close();
    return out;
  };
  assert.equal(await run(), await run());
});
