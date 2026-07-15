// 24-generalization.test.mjs — GENERALIZATION VIA THE REASONER.
//
// Sema is a RAG+reasoner mind. The RAG half is resonance search over the DAG;
// the reasoner half explores the DAG's STRUCTURE (the consensus climb, the
// alignment read, the multi-hop walk). The reasoner is the PRIMARY component,
// not a fallback: it must produce answers the retrieval half cannot reach at
// all — a value never stored, a LIST synthesized from an unseen sentence, a
// SUMMARY generated in a learnt shape, an answer that fuses SEVERAL distinct
// points of attention. This file pins three gaps the earlier suites left open
// and proves, irrefutably, that the reasoner closes them.
//
// GAP 1  — the reasoner is primary, not a fallback. A query whose answer is a
//          value NEVER stored (a generated list / summary) has no node to
//          retrieve; only structural reasoning can answer it. The produced
//          answer must therefore NOT be any stored node — proof it was derived,
//          not recalled.
//
// GAP 3.1 — the consensus climb must not resolve to a SINGLE point of attention. A
//          query naming K unrelated distinctive topics (K ≥ 2) decomposes into K
//          independent roots; the reasoner must sequence them by evidence and
//          combine all into one coherent answer — not silently drop any. (The
//          trace must also surface more than one ordered anchor.)  The forest
//          read-out is generic for any K via naturalBreak + span-disjoint
//          overlap + the saturation gate (leadingEnd).  Tests here cover
//          K = 2 (the minimum multi-root case).
//
// GAP 3.2 — extractByAlignment must extract MULTIPLE pieces, not one span. A
//          skill whose answer is several NON-CONTIGUOUS spans of its context
//          (a list, a summary) must transfer to an unseen sentence: read every
//          analogous piece and synthesize them in the learnt shape — generating
//          something entirely new.
//
// The assertions are literal / marker-based and corpus-independent. They FAIL
// on a build that resolves one point of attention and reads one span; they PASS
// only when the reasoner generalizes multi-piece and multi-root.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = () =>
  new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
const ask = async (m, q) =>
  (await m.respondText(q)).replace(/\s+/g, " ").trim();

// ─────────────────────────────────────────────────────────────────────────
// GAP 3.2 — MULTI-PIECE EXTRACTION: generate a LIST from an unseen sentence.
//
// The skill: "The team includes X, Y, and Z." → "X, Y, Z". The answer is NOT a
// contiguous span of the context (the context has an "and" the answer drops), so
// it is THREE spans that must each be read from the query and re-joined in the
// learnt shape. Asked an unseen sentence, the mind must produce the analogous
// list — three values it was never told, assembled into a string never stored.
// ─────────────────────────────────────────────────────────────────────────
test("3.2 — a LIST skill generates an unseen list (multi-piece extraction)", async () => {
  const m = mk();
  const taught = [
    ["The team includes Alice, Bob, and Carol.", "Alice, Bob, Carol"],
    ["The team includes Dan, Eve, and Frank.", "Dan, Eve, Frank"],
    ["The team includes Gina, Hank, and Iris.", "Gina, Hank, Iris"],
    ["The team includes Jack, Kate, and Leo.", "Jack, Kate, Leo"],
  ];
  await m.ingest(taught);

  const got = await ask(m, "The team includes Mona, Nick, and Omar.");

  // Every unseen member must appear — the pieces were read from the QUESTION.
  for (const name of ["Mona", "Nick", "Omar"]) {
    assert.ok(
      got.includes(name),
      `list must contain the unseen member "${name}" — got "${got}"`,
    );
  }
  // It must be NEW: not a verbatim copy of any taught answer (proof it was
  // generated, not recalled — GAP 1).
  for (const [, ans] of taught) {
    assert.notEqual(
      got,
      ans,
      `answer "${got}" is a recalled exemplar, not generated`,
    );
  }
  // And it must NOT leak a taught member (a single-span read would return one
  // stored list wholesale).
  for (const stale of ["Alice", "Gina", "Jack", "Carol", "Iris", "Leo"]) {
    assert.ok(
      !got.includes(stale),
      `answer leaked a stored member "${stale}": "${got}"`,
    );
  }
  await m.store.close();
});

// GAP 3.2 (b) — SUMMARY generation: the answer is a SUBSET of the context's
// words (non-contiguous salient spans). The skill transfers to an unseen
// sentence, generating a summary of words drawn from the QUESTION itself.
test("3.2 — a SUMMARY skill generates an unseen summary from salient spans", async () => {
  const m = mk();
  await m.ingest([
    [
      "The report notes that revenue rose sharply across Europe.",
      "revenue rose Europe",
    ],
    [
      "The report notes that profit fell steeply across Asia.",
      "profit fell Asia",
    ],
    [
      "The report notes that output grew slowly across Africa.",
      "output grew Africa",
    ],
    [
      "The report notes that demand dropped quickly across America.",
      "demand dropped America",
    ],
  ]);

  const got = await ask(
    m,
    "The report notes that traffic surged massively across Oceania.",
  );

  // The generated summary must draw its salient words from the unseen sentence.
  const salient = ["traffic", "surged", "Oceania"];
  const present = salient.filter((w) => got.includes(w)).length;
  assert.ok(
    present >= 2,
    `summary must synthesize the unseen sentence's salient words ` +
      `(got ${present}/3 of ${salient.join(",")}) — "${got}"`,
  );
  // Not a recalled exemplar.
  assert.ok(
    !got.includes("revenue") && !got.includes("Europe") &&
      !got.includes("Asia"),
    `summary leaked stored words: "${got}"`,
  );
  await m.store.close();
});

// GAP 3.2 (c) — multi-piece extraction COMPOSES with a reasoning hop. Generating
// the list is one stage of a single pipeline, not an isolated branch.
test("3.2 — multi-piece extraction composes with a downstream hop", async () => {
  const m = mk();
  await m.ingest([
    ["The pair includes Alice and Bob.", "Alice and Bob"],
    ["The pair includes Dan and Eve.", "Dan and Eve"],
    ["The pair includes Gina and Hank.", "Gina and Hank"],
  ]);
  // A fact keyed on the exact string the skill will generate.
  await m.ingest(["Mona and Nick", "Mona and Nick lead the project"]);

  const got = await ask(m, "The pair includes Mona and Nick.");
  assert.ok(
    got.includes("lead the project"),
    `generated pair must hop to its downstream fact — got "${got}"`,
  );
  await m.store.close();
});

// ─────────────────────────────────────────────────────────────────────────
// GAP 3.1 — MULTIPLE ORDERED POINTS OF ATTENTION.
//
// A scaffolding-dominated corpus (17-intelligence's pathology). A query names TWO
// unrelated distinctive topics under the shared scaffolding. The consensus climb
// must not pick ONE: it must expose two independent roots, the reasoner grounds
// each and fuses both. The answer must carry a marker of BOTH records.
// ─────────────────────────────────────────────────────────────────────────
const SYS =
  "You are a helpful and harmless assistant.\n\nYou are not allowed to use any tools.\n";

async function twoTopicMind() {
  const m = mk();
  await m.ingest([
    [
      SYS + "Describe the importance of gender equality in the workplace.",
      "Gender equality means equal chances to be hired and promoted.",
    ],
    [
      SYS + "Provide a summary of the 1992 Dream Team basketball squad.",
      "The Dream Team won gold in Barcelona in 1992.",
    ],
    [
      SYS + "Explain how photosynthesis converts sunlight into energy.",
      "Photosynthesis binds carbon dioxide and water into sugar.",
    ],
    [
      SYS + "Summarize the causes of the fall of the Western Roman Empire.",
      "The Western Roman Empire fell from overreach and migration.",
    ],
  ]);
  return m;
}

test("3.1 — a two-topic query fuses BOTH points of attention", async () => {
  const m = await twoTopicMind();
  const got = await ask(
    m,
    SYS +
      "Tell me about gender equality at work, and also the 1992 Dream Team.",
  );
  await m.store.close();

  const hasEquality = /hired|promoted|equal chances/i.test(got);
  const hasDreamTeam = /Barcelona|gold|Dream Team/i.test(got);
  assert.ok(
    hasEquality && hasDreamTeam,
    `a two-topic query must answer BOTH points of attention — ` +
      `equality=${hasEquality} dreamTeam=${hasDreamTeam} — got "${got}"`,
  );
});

test("3.1 — the trace surfaces MORE THAN ONE ordered anchor for a two-topic query", async () => {
  const m = await twoTopicMind();
  const steps = [];
  await m.respondText(
    SYS +
      "Tell me about gender equality at work, and also the 1992 Dream Team.",
    (s) => steps.push(s),
  );
  await m.store.close();

  // The consensus climb must expose the attention forest — more than one ordered
  // anchor — not a single winner. (Emitted as the outputs of the climb step.)
  const climbs = steps.filter((s) => s.mechanism.at(-1) === "climbConsensus");
  assert.ok(climbs.length > 0, "no climbConsensus step was traced");
  const maxAnchors = Math.max(...climbs.map((s) => s.outputs.length));
  assert.ok(
    maxAnchors >= 2,
    `climbConsensus resolved a single point of attention ` +
      `(max anchors ${maxAnchors}); the reasoner must order MULTIPLE`,
  );

  // The fusion of the further point must itself be traced (traceability, I10).
  assert.ok(
    steps.some((s) => s.mechanism.at(-1) === "fuseAttention"),
    "the multi-root fusion was not surfaced in the rationale",
  );

  // …and the multi-root path must keep the rationale a SOUND, rooted DAG (no
  // dangling / forward / self edges introduced by the new mechanisms).
  const byIndex = new Map();
  const emitPos = new Map();
  steps.forEach((s, pos) => {
    byIndex.set(s.index, s);
    emitPos.set(s.index, pos);
  });
  for (const s of steps) {
    if (s.parent !== -1) {
      assert.ok(
        byIndex.has(s.parent) && s.parent < s.index,
        `bad parent @${s.index}`,
      );
    }
    for (const d of s.dependsOn) {
      assert.ok(
        d !== s.index && byIndex.has(d) && d < s.index,
        `bad dep @${s.index}`,
      );
      if (d !== s.parent) {
        assert.ok(
          emitPos.get(d) < emitPos.get(s.index),
          `bad emit order @${s.index}`,
        );
      }
    }
  }
  const root = byIndex.get(0);
  assert.deepEqual(root.mechanism, ["respond"], "root is not respond");
  assert.equal(root.parent, -1, "root has a parent");
});

// GAP 3.1 — a SINGLE-topic query must still resolve to ONE answer (no spurious
// second root injected). The multi-root machinery must be dominance-gated so it
// never degrades the scaffolding-dominated single-topic case that 17-intelligence pins.
test("3.1 — a single-topic query is not fragmented", async () => {
  const m = await twoTopicMind();
  // A single distinctive topic (resolves cleanly at baseline). The multi-root
  // machinery must NOT drag in an unrelated second record.
  const got = await ask(
    m,
    SYS + "the importance of gender equality in the workplace",
  );
  await m.store.close();
  assert.ok(
    /hired|promoted|equal chances/i.test(got),
    `single topic lost: "${got}"`,
  );
  // Must not have dragged in an unrelated record.
  assert.ok(
    !/Barcelona|photosynthesis|Roman/i.test(got),
    `single topic fragmented: "${got}"`,
  );
});

// GAP 3.1 — DOCUMENT FREQUENCY, three ways. The consensus climb weights each
// part's reach by document frequency; requirement 3.1 says it must leverage the
// INVERSE form (discrimination — what sets a part apart), the DIRECT form (theme
// — what a part shares with many contexts), AND a COMBINED read applying both to
// each part on the same input. All three must produce coherent, distinct
// orderings over the same query — the capability, not one hard-wired weighting.
test("3.1 — the consensus climb (climbAttention) leverages inverse, direct, AND combined document frequency", async () => {
  const m = await twoTopicMind();
  const q = new TextEncoder().encode(
    SYS +
      "Tell me about gender equality at work, and also the 1992 Dream Team.",
  );

  // climbAttention is the multi-hierarchical core; each mode is a real read.
  const inv = await m.climbAttention(q, 16, "inverse");
  const dir = await m.climbAttention(q, 16, "direct");
  const cmb = await m.climbAttention(q, 16, "combined");
  await m.store.close();

  // Each mode resolves the same two-topic forest (independent of the weighting).
  for (
    const [name, forest] of [["inverse", inv], ["direct", dir], [
      "combined",
      cmb,
    ]]
  ) {
    assert.ok(
      forest.length >= 2,
      `${name} did not order multiple points of attention`,
    );
  }
  // COMBINED is inverse+direct applied to each part: strictly the larger vote
  // (both operations contribute), the defining property of the combined read.
  assert.ok(
    cmb[0].vote > inv[0].vote && cmb[0].vote > dir[0].vote,
    `combined (${cmb[0].vote.toFixed(2)}) must exceed both inverse ` +
      `(${inv[0].vote.toFixed(2)}) and direct (${dir[0].vote.toFixed(2)})`,
  );
});

// GAP 3.1 — the root COUNT is the data's own answer, not a tuned threshold. How
// many points of attention a query has must come from the NATURAL BREAK in the
// vote distribution: a single-topic query yields exactly ONE root, a K-topic
// query exactly K — with no magic constant deciding the cut.  naturalBreak is
// scale-free (a ratio, not an absolute bar), so it holds across corpora without
// tuning.  The mechanism is generic for any K; this test covers K = 1 and K = 2.
test("3.1 — the number of roots is read from the vote distribution, not a constant", async () => {
  const m = await twoTopicMind();
  const climb = async (q) =>
    (await m.climbAttention(new TextEncoder().encode(SYS + q), 16)).length;

  // One distinctive topic → ONE root (natural break is right after the top vote).
  assert.equal(
    await climb("the importance of gender equality in the workplace"),
    1,
    "a single-topic query must yield exactly one root (no fragmentation)",
  );
  // Two distinctive topics on disjoint spans → TWO roots.
  assert.equal(
    await climb(
      "Tell me about gender equality at work, and also the 1992 Dream Team.",
    ),
    2,
    "a K-topic query must yield exactly K roots (K = 2 here)",
  );
  await m.store.close();
});

// GAP 3.1 — the natural break is SCALE-FREE: multiplying every vote by a constant
// (which a different corpus size / resonance regime would do) must not change the
// root count. This is the property a fixed absolute threshold could never have.
test("3.1 — the root decision is scale-invariant (relative, not absolute)", async () => {
  // naturalBreak is a pure function of the sorted votes; prove the count it
  // implies is invariant under uniform scaling on representative distributions.
  const m = await twoTopicMind();
  // A single-dominant distribution → 1 above the break; a plateau-of-two → 2.
  const single = [3.66, 1.69, 1.21, 0.59];
  const two = [2.99, 2.59, 0.82, 0.71];
  const countAbove = (votes) => {
    const cut = m.naturalBreak(votes);
    return votes.filter((v) => v >= cut).length;
  };
  await m.store.close();
  for (const scale of [1, 10, 0.01]) {
    assert.equal(
      countAbove(single.map((v) => v * scale)),
      1,
      `single @${scale}`,
    );
    assert.equal(countAbove(two.map((v) => v * scale)), 2, `two @${scale}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GAP 1 — the reasoner is PRIMARY: the produced answer is DERIVED, not recalled.
// The generated list is not any stored node — retrieval literally cannot return
// it, so the answer proves the reasoner is doing the work.
// ─────────────────────────────────────────────────────────────────────────
test("1 — the generated answer is not a stored node (derived, not retrieved)", async () => {
  const m = mk();
  await m.ingest([
    ["The team includes Alice, Bob, and Carol.", "Alice, Bob, Carol"],
    ["The team includes Dan, Eve, and Frank.", "Dan, Eve, Frank"],
    ["The team includes Gina, Hank, and Iris.", "Gina, Hank, Iris"],
  ]);
  const got = await ask(m, "The team includes Mona, Nick, and Omar.");

  // If this exact string were retrievable, it would resolve to a node; it must
  // not — it was assembled by the reasoner from the query's own bytes.
  const node = m.store.findLeaf?.(new TextEncoder().encode(got)) ?? null;
  assert.equal(
    node,
    null,
    `the generated answer "${got}" is a stored leaf — not derived`,
  );
  assert.ok(
    got.includes("Mona") && got.includes("Omar"),
    `not generated: "${got}"`,
  );
  await m.store.close();
});
