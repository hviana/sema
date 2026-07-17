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
// Sema trains on the raw concatenation of prior turns and queries the same
// accumulated bytes at inference.  The Conversation API tracks turn-boundary
// offsets explicitly so no separator character is needed — the geometry never
// inspects content to find turn boundaries.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const newMind = () => new Mind({ seed: 7 });

// ═══════════════════════════════════════════════════════════════════════
// teachConversation — store one conversation (an ordered list of turns).
//
// Accumulate prior turns by raw concatenation — no separator character.
// Each episode carries the full conversation history: (t₀ → t₁),
// (t₀+t₁ → t₂), (t₀+t₁+t₂ → t₃) … where + is byte concatenation.
// ═══════════════════════════════════════════════════════════════════════
async function teachConversation(mind, turns) {
  let context = "";
  for (let i = 0; i + 1 < turns.length; i++) {
    context += turns[i];
    await mind.ingest(context, turns[i + 1]);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// predictNext — given the turns spoken so far, predict the next turn.
//
// Uses the Conversation API: beginConversation → addTurn for each prior
// turn (BOTH speakers' lines are history being replayed, not questions to
// answer — respondTurn would answer each one AND append its own reply to
// the context) → respondTurnText for the final turn → endConversation.
// Turns are raw strings, concatenated by the Mind — no separator.
// ═══════════════════════════════════════════════════════════════════════
async function predictNext(mind, priorTurns) {
  if (priorTurns.length === 0) return "";
  const conv = mind.beginConversation();
  for (let i = 0; i < priorTurns.length - 1; i++) {
    mind.addTurn(conv, priorTurns[i]);
  }
  const { response } = await mind.respondTurnText(
    conv,
    priorTurns[priorTurns.length - 1],
  );
  mind.endConversation(conv);
  return response;
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

// ═══════════════════════════════════════════════════════════════════════
// Section E — Conversation API lifecycle & cache management
//
// Tests for the beginConversation / respondTurn / endConversation API
// itself, independent of the conversation-training pattern above.
// ═══════════════════════════════════════════════════════════════════════

test("E1: begin → respondTurn → end completes a single-turn conversation", async () => {
  const mind = newMind();
  await mind.ingest("hello", "world");

  const conv = mind.beginConversation();
  const { response, state } = await mind.respondTurnText(conv, "hello");
  assert.equal(response, "world");
  // The reply is part of the exchange: one boundary, between the turn and
  // the appended reply.
  assert.equal(state.boundaries.length, 1);
  mind.endConversation(conv);
  await mind.store.close();
});

test("E2: multi-turn conversation accumulates context and boundaries", async () => {
  const mind = newMind();
  await teachConversation(mind, CAT);

  const conv = mind.beginConversation();
  // First turn establishes the subject — scripted history, so it is FED
  // (addTurn), not asked.
  mind.addTurn(conv, "I adopted a cat");

  // Second turn is the pivot query.
  const t2 = await mind.respondTurnText(conv, "what is its name?");
  // Two boundaries: after the first turn, and after the pivot (the reply
  // is part of the exchange).
  assert.equal(t2.state.boundaries.length, 2);
  assert.equal(t2.response, "her name is Whiskers");

  mind.endConversation(conv);
  await mind.store.close();
});

test("E3: save → end → restore → continue works", async () => {
  const mind = newMind();
  await teachConversation(mind, CAT);

  // First two turns (context fed, pivot asked).
  const conv = mind.beginConversation();
  mind.addTurn(conv, "I adopted a cat");
  const { state: saved } = await mind.respondTurnText(
    conv,
    "what is its name?",
  );
  assert.equal(saved.boundaries.length, 2);

  // Save and end.
  mind.endConversation(conv);

  // Restore from the saved state into a new handle.
  const conv2 = mind.beginConversation(saved);
  // Boundaries are intact from the restore, and the conversation continues
  // from where it left off.
  const state2 = mind.addTurn(conv2, "and she likes to nap");
  assert.equal(state2.boundaries.length, saved.boundaries.length + 1);
  const { response } = await mind.respondTurnText(conv2, "what is its name?");
  assert.ok(typeof response === "string");

  mind.endConversation(conv2);
  await mind.store.close();
});

test("E4: endConversation is idempotent", async () => {
  const mind = newMind();
  const conv = mind.beginConversation();
  mind.endConversation(conv);
  // Second end on the same handle — must not throw.
  mind.endConversation(conv);
  await mind.store.close();
});

test("E5: respondTurn on an ended conversation throws", async () => {
  const mind = newMind();
  const conv = mind.beginConversation();
  mind.endConversation(conv);
  await assert.rejects(
    () => mind.respondTurn(conv, "hello"),
    /not found/,
  );
  await mind.store.close();
});

test("E6: conversationState returns null after endConversation", async () => {
  const mind = newMind();
  const conv = mind.beginConversation();
  mind.endConversation(conv);
  assert.equal(mind.conversationState(conv), null);
  await mind.store.close();
});

test("E7: multiple concurrent conversations are independent", async () => {
  const mind = newMind();
  await teachConversation(mind, CAT);
  await teachConversation(mind, DOG);

  const catConv = mind.beginConversation();
  const dogConv = mind.beginConversation();

  // Feed the distinguishing context to each.
  mind.addTurn(catConv, "I adopted a cat");
  mind.addTurn(dogConv, "I adopted a dog");

  // The same pivot turn — different answers.
  const catR = await mind.respondTurnText(catConv, "what is its name?");
  const dogR = await mind.respondTurnText(dogConv, "what is its name?");

  assert.equal(catR.response, "her name is Whiskers");
  assert.equal(dogR.response, "his name is Rex");
  assert.notEqual(catR.response, dogR.response);

  // Each conversation has its own boundaries (turn|pivot, pivot|reply).
  assert.equal(catR.state.boundaries.length, 2);
  assert.equal(dogR.state.boundaries.length, 2);

  // Ending one does not affect the other.
  mind.endConversation(catConv);
  assert.equal(mind.conversationState(catConv), null);
  assert.notEqual(mind.conversationState(dogConv), null);

  // End the second — both are now gone.
  mind.endConversation(dogConv);
  assert.equal(mind.conversationState(dogConv), null);

  // Ending again is idempotent.
  mind.endConversation(dogConv);
  await mind.store.close();
});

test("E8: respondTurn with a forged handle throws", async () => {
  const mind = newMind();
  // { id: 999 } was never returned by beginConversation.
  await assert.rejects(
    () => mind.respondTurn({ id: 999 }, "hello"),
    /not found/,
  );
  await mind.store.close();
});

test("E9: respond and respondTurn give the same answer for the same cumulative bytes", async () => {
  const mind = newMind();
  await teachConversation(mind, CAT);

  // Via respond() — raw concatenation, same as respondTurn.
  const viaRespond = await mind.respondText(
    "I adopted a catwhat is its name?",
  );

  // Via the Conversation API — the first turn is fed (addTurn keeps the
  // cumulative bytes identical to the raw concatenation above; respondTurn
  // would append its own reply between the turns).
  const conv = mind.beginConversation();
  mind.addTurn(conv, "I adopted a cat");
  const { response: viaConv } = await mind.respondTurnText(
    conv,
    "what is its name?",
  );
  mind.endConversation(conv);

  assert.equal(viaRespond, viaConv);
  await mind.store.close();
});

test("E10: an empty turn neither grows the context nor marks a boundary", async () => {
  const mind = newMind();
  await teachConversation(mind, CAT);

  const conv = mind.beginConversation();
  mind.addTurn(conv, "I adopted a cat");
  const before = mind.conversationState(conv);

  // Empty turns are no turns: addTurn and respondTurn alike must leave the
  // context bytes and the (strictly increasing) boundaries untouched.
  const viaAdd = mind.addTurn(conv, "");
  assert.equal(viaAdd.context.length, before.context.length);
  assert.deepEqual(viaAdd.boundaries, before.boundaries);

  // respondTurn("") answers the ACCUMULATED context (an empty turn adds no
  // bytes and no boundary of its own) — only its reply may grow the state,
  // through the same append+boundary path as any turn.
  const { response: r0, state: viaTurn } = await mind.respondTurnText(
    conv,
    "",
  );
  const replyLen = new TextEncoder().encode(r0).length;
  assert.equal(viaTurn.context.length, before.context.length + replyLen);
  assert.equal(
    viaTurn.boundaries.length,
    before.boundaries.length + (replyLen > 0 ? 1 : 0),
  );
  for (let i = 1; i < viaTurn.boundaries.length; i++) {
    assert.ok(viaTurn.boundaries[i] > viaTurn.boundaries[i - 1]);
  }

  // The conversation still answers afterwards — the zero-growth refold must
  // not have corrupted the pyramid's shared raw interiors.  (The empty
  // turn's own reply may have advanced the exchange, so the answer is
  // asserted by content, not byte-exactly.)
  const { response } = await mind.respondTurnText(conv, "what is its name?");
  assert.ok(
    response.includes("her name is Whiskers"),
    `expected the name to surface, got ${JSON.stringify(response)}`,
  );

  mind.endConversation(conv);
  await mind.store.close();
});
