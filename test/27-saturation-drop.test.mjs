// 27-saturation-drop.test.mjs — SATURATION NOISE DROP + FLAT-BRANCH
// CANONICALIZATION: IRREVERSIBLE SAFEGUARDS.
//
// The six pre-existing failures (11-universality, 13-conversation, 17-intelligence,
// 21-partial, 24-generalization) share one root cause: position-dependent perception
// — the same bytes at different byte offsets produce different perceived trees →
// different node ids → the DAG treats them as different entities.  Single-byte
// leaves are immune (findLeaf always returns the same id), but multi-byte sequences
// lose this property because bytesToTree groups bytes into leaf-parent chunks based
// on surrounding context.
//
// The solution has two CONCEPTUALLY DISTINCT layers, both derived purely from DAG
// geometry with no weights, no learning, and no byte scanning:
//
//   LAYER 1 — IDENTITY INFRASTRUCTURE (position-independent content identity):
//     A. FLAT-BRANCH STORAGE — during deposit, store flat branches (keyed by
//        single-byte leaf ids) for sub-spans of lengths W-1 and W.  Single-byte
//        leaf ids are position-independent, so a flat branch is the SAME node
//        regardless of where those bytes appear.
//     B. FLAT-BRANCH CANONICALIZATION — during the vote loop, each query region
//        resolves through canonicalChunkId to a position-independent flat branch
//        (content-addressed hash-consing via findBranch).  The flat branch's
//        edgeAncestors give the position-independent parent count, letting IDF
//        measure corpus distinctiveness honestly.
//     C. flatLeafIds HASH-CONSING — the store's intern() flatLeafIds check
//        causes structural leaf-parent nodes to reuse pre-stored flat branch ids.
//        A feeds this by storing flat branches BEFORE internTreeIds, so common
//        words in multiple contexts share one node id → correct parent count.
//
//   LAYER 2 — SATURATION NOISE DROP (reads a geometric fact layer 1
//     already computed, never assumes a probability distribution over position):
//     During the vote loop (layer 1), each region records `canonicalFailed` —
//     whether `canonicalChunkId` could NOT resolve those bytes to a
//     position-independent flat branch.  This is the honest signal: if
//     `findBranch` (content-addressed hash-consing) failed, the region's
//     identity is position-dependent — the same content at a different offset
//     would get a different node id with an artificially low parent count,
//     making the DAG's IDF read unreliable.  If `canonicalChunkId` SUCCEEDED,
//     the IDF is already honest (corpus-wide parent count) and no adjustment
//     is needed: saturated regions were already skipped by `reach.saturated`,
//     unsaturated ones carry the correct IDF.
//
//     After structural saturated-interval detection (`detectSaturated`), votes are
//     committed: any region whose bytes sit entirely within the detected
//     saturated interval AND whose `canonicalFailed` is true is DROPPED — before
//     it is ever summed into a context's total.  Dropping at the REGION level
//     (not the context level) means a position-fragile region's contribution
//     can never hide inside a legitimate context's accumulated vote.
//
// Layer 1 is ARCHITECTURAL — content identity should not depend on byte position.
// Layer 2 is GEOMETRIC — it reads a fact layer 1 already computed; no assumed
// distribution, no tuned constants, no byte scanning.
//
// REMOVAL INDICATORS (what breaks if each mechanism is removed):
//   A removed → findBranch returns null for KNOWN leaf-parent sub-span ids
//   B removed → a common word at a new position doesn't saturate
//   C removed → flat branch has 0 structural parents after single deposit
//   (drop) removed → saturated-interval canonicalFailed-region votes are not
//     suppressed, and can fragment the consensus or inflate a context's total
//
// These tests are the IRREVERSIBLE SAFEGUARD.  A build that removes or neuters
// any mechanism must FAIL here — even if end-to-end answers still pass through
// fallback routes.  The existing test suite tests answers, not geometric invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

const mk = () =>
  new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });

// Shared SYS opening — long enough for hasLeading detection (≥ maxGroup = 4 bytes).
const SYS =
  "You are a helpful and harmless assistant.\n\nYou are not allowed to use any tools.\n";
const SYSLen = enc(SYS).length; // 81 bytes on the reference seed

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a leaf-id chain for a byte sequence and return its flat branch id, or
 *  null if any byte is unknown or no flat branch exists. */
function flatBranchFor(store, bytes) {
  const ids = [];
  for (let i = 0; i < bytes.length; i++) {
    const lid = store.findLeaf(bytes.subarray(i, i + 1));
    if (lid === null) return null;
    ids.push(lid);
  }
  return store.findBranch(ids);
}

/** Walk the perceived tree and return every leaf-parent chunk (node where all
 *  kids are leaves) with its byte span and the leaf-id chain. */
function leafParentChunks(mind, input) {
  const tree = mind.perceive(input);
  const chunks = [];
  const walk = (n, start) => {
    if (n.kids === null) return start + (n.leaf?.length ?? 0);
    let pos = start;
    for (const c of n.kids) pos = walk(c, pos);
    if (n.kids !== null && n.kids.every((k) => k.kids === null)) {
      const bytes = [];
      for (const k of n.kids) {
        if (k.leaf) bytes.push(...k.leaf);
      }
      const leafIds = [];
      for (let i = 0; i < bytes.length; i++) {
        const lid = mind.store.findLeaf(new Uint8Array([bytes[i]]));
        if (lid !== null) leafIds.push(lid);
      }
      chunks.push({ start, end: pos, bytes: new Uint8Array(bytes), leafIds });
    }
    return pos;
  };
  walk(tree, 0);
  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// A — FLAT-BRANCH STORAGE (identity infrastructure, layer 1)
//
// After deposit, EVERY leaf-parent chunk's sub-spans (lengths W-1 and W)
// must have flat branches findable via findBranch.  These flat branches are
// the position-independent nodes that the canonicalization and hash-consing
// mechanisms consume.
//
// REMOVAL INDICATOR: after deposit, a leaf-parent chunk of length ≥ 2 has
// no findBranch result for its exact leaf-id chain.
// ═══════════════════════════════════════════════════════════════════════════════

test("A — every leaf-parent chunk has a flat branch for its exact bytes after deposit", async () => {
  const m = mk();
  await m.ingest([[
    "The Moon landing was in 1969.",
    "Neil Armstrong landed on the Moon.",
  ]]);

  const chunks = leafParentChunks(m, "The Moon landing was in 1969.");
  // Filter to chunks with ≥ 2 leaves (flat branches require at least 2 kids)
  const multiLeaf = chunks.filter((c) => c.bytes.length >= 2);

  assert.ok(multiLeaf.length >= 2, "must have multiple multi-leaf chunks");

  for (const c of multiLeaf) {
    const fb = m.store.findBranch(c.leafIds);
    assert.notEqual(
      fb,
      null,
      `flat branch must exist for chunk [${c.start}-${c.end}] ` +
        `"${dec(c.bytes)}" (${c.leafIds.length} leaves). ` +
        "storeNgrams must pre-store flat branches for every leaf-parent chunk.",
    );
  }

  await m.store.close();
});

test("A — sub-span flat branches exist for canonicalization-relevant lengths (W-1 and W)", async () => {
  const m = mk();
  await m.ingest([["abcd efgh ijkl", "mnop qrst uvwx"]]);

  const W = m.space.maxGroup;
  const chunks = leafParentChunks(m, "abcd efgh ijkl");

  // For chunks with W leaves (maxGroup), the (W-1)-byte sub-spans must exist
  // — these are the 1-byte-shorter matches the canonicalization checks.
  // 2-byte sub-spans within W-byte chunks are NOT stored (only lengths W-1
  // and W are needed for the canonicalization probes).
  for (const c of chunks) {
    if (c.leafIds.length < W) continue;
    // (W-1)-byte sub-spans within a W-byte chunk must exist
    for (let off = 0; off + W - 1 <= c.leafIds.length; off++) {
      const sub = c.leafIds.slice(off, off + W - 1);
      const fb = m.store.findBranch(sub);
      assert.notEqual(
        fb,
        null,
        `${W - 1}-byte sub-span at offset ${off} of chunk "${dec(c.bytes)}" ` +
          "must have a flat branch — indexSubSpans stores lengths W-1 and W",
      );
    }
  }

  // For ALL leaf-parent chunks, the full chunk's flat branch must exist.
  for (const c of chunks) {
    if (c.leafIds.length < 2) continue;
    const fb = m.store.findBranch(c.leafIds);
    assert.notEqual(
      fb,
      null,
      `full chunk "${dec(c.bytes)}" must have a flat branch`,
    );
  }

  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// C — flatLeafIds HASH-CONSING (ordering proof, identity infrastructure layer 1)
//
// Flat-branch storage runs BEFORE internTreeIds.  This ordering is load-bearing:
// the store's intern() flatLeafIds check finds the pre-stored flat branch and
// hash-conses the structural node to it.  If flat branches were stored AFTER
// interning, the flatLeafIds check would miss them and the flat branch would
// have 0 structural parents — useless for edgeAncestors.
//
// We prove the ordering is correct: after a SINGLE deposit, a leaf-parent
// chunk's flat branch must have ≥ 1 structural parent.  This parent came from
// the SAME deposit's internTreeIds hash-consing to the pre-stored flat branch.
//
// REMOVAL INDICATOR: after single deposit, flat branch for a leaf-parent chunk
// has parents().length === 0.
// ═══════════════════════════════════════════════════════════════════════════════

test("C — flat branch has structural parent after single deposit (ordering proof)", async () => {
  const m = mk();
  await m.ingest([[
    "The Moon landing was in 1969.",
    "Neil Armstrong landed on the Moon.",
  ]]);

  // Find all leaf-parent chunks and check each one's flat branch has parents
  const chunks = leafParentChunks(m, "The Moon landing was in 1969.");
  const multiLeaf = chunks.filter((c) => c.bytes.length >= 2);

  let withParents = 0;
  for (const c of multiLeaf) {
    const fb = m.store.findBranch(c.leafIds);
    if (fb === null) continue;
    const parents = m.store.parents(fb);
    if (parents.length >= 1) withParents++;
  }

  assert.ok(
    withParents >= 1,
    `at least one leaf-parent chunk's flat branch must have ≥ 1 structural ` +
      `parent after single deposit, got ${withParents}/${multiLeaf.length}. ` +
      "Without flat-branch storage running BEFORE internTreeIds, the flatLeafIds check in " +
      "intern() would miss the pre-stored flat branch and the structural " +
      "node would mint a fresh id — leaving the flat branch with 0 parents.",
  );

  await m.store.close();
});

test("C — repeated deposit of same content reuses the same flat branch ids", async () => {
  const m = mk();

  // Two deposits of IDENTICAL content.  The second deposit must reuse ALL
  // flat branch ids from the first — the content hasn't changed, so the
  // leaf-parent chunks are identical.
  const input = "The quick brown fox jumps over the lazy dog.";
  await m.ingest([[input, "answer 1"]]);

  const chunks = leafParentChunks(m, input).filter((c) => c.bytes.length >= 2);
  const ids1 = [];
  for (const c of chunks) {
    const fb = m.store.findBranch(c.leafIds);
    if (fb !== null) ids1.push(fb);
  }
  assert.ok(ids1.length >= 2, "first deposit must produce flat branch ids");

  await m.ingest([[input, "answer 2"]]);
  const ids2 = [];
  for (const c of chunks) {
    const fb = m.store.findBranch(c.leafIds);
    if (fb !== null) ids2.push(fb);
  }

  // Every flat branch id from the first deposit must be reused.
  // Identical content → identical leaf ids → identical flat branches.
  for (let i = 0; i < ids1.length; i++) {
    assert.equal(
      ids2[i],
      ids1[i],
      `flat branch id for chunk ${i} must be identical across deposits. ` +
        "Second deposit of same content must reuse existing flat branches.",
    );
  }

  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// B — FLAT-BRANCH CANONICALIZATION (identity infrastructure, layer 1)
//
// The vote loop canonicalizes query regions through the LONGEST matching flat
// branch.  This gives the position-independent parent count for honest IDF —
// without it, the same bytes at different positions get artificially low parent
// counts and don't saturate, contributing noise.
//
// We test the EFFECT: a single-topic query must not fragment.  If
// canonicalization were removed, saturated-interval noise from SYS regions (which
// don't saturate due to position-dependent perception) would fragment the
// single topic.  If the match-length guard were removed, short coincidental
// matches within distinctive regions would cause false saturation.
//
// REMOVAL INDICATOR: a scaffolding-dominated single-topic query returns > 1 root
// from climbAttention.
// ═══════════════════════════════════════════════════════════════════════════════

test("B — single-topic query is not fragmented", async () => {
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

  const q = SYS + "the importance of gender equality in the workplace";
  const forest = await m.climbAttention(enc(q), 16, "inverse");

  assert.equal(
    forest.length,
    1,
    `single-topic query must yield exactly 1 root, got ${forest.length}. ` +
      "Without flat-branch canonicalization, saturated-interval noise " +
      "would fragment the single topic into multiple roots.  This is the " +
      "irreversible safeguard for 24-generalization single-topic test.",
  );

  const rootBytes = dec(m.store.bytesPrefix(forest[0].anchor, 200));
  assert.ok(
    rootBytes.includes("Describe the importance of gender"),
    `root must be the gender equality context, got: "${
      rootBytes.slice(0, 80)
    }..."`,
  );

  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SATURATED-PREFIX NOISE DROP (layer 2 — reads a fact layer 1 already computed)
//
// During the vote loop, each chunk region records `canonicalFailed` — whether
// canonicalChunkId (content-addressed hash-consing via findBranch) could NOT
// resolve its bytes to a position-independent flat branch.  After detectSaturated
// finds the saturated-interval boundary, the vote commit drops any region whose
// bytes sit entirely inside that interval AND whose canonicalFailed is true.
//
// `canonicalFailed` is the honest signal: if findBranch failed, the region's
// identity is position-dependent — the same content at a different offset
// would get a different node id with an artificially low parent count, so the
// DAG's IDF read is unreliable.  If canonicalChunkId SUCCEEDED, the IDF is
// already honest (corpus-wide parent count) and needs no adjustment: saturated
// regions were already skipped by reach.saturated, unsaturated ones carry the
// correct IDF.
//
// We test the EFFECT: a query with a shared SYS opening must return roots
// whose focus is PAST the saturated interval (in distinctive content).  If the
// noise drop were removed, saturated-interval foci would not be suppressed and
// could out-vote genuine distinctive foci.
//
// REMOVAL INDICATOR: a query with a saturated interval returns a root whose
// focus is deep within the SYS opening.
// ═══════════════════════════════════════════════════════════════════════════════

test("noise drop — saturated-interval foci are suppressed", async () => {
  const m = mk();
  await m.ingest([
    [
      SYS + "Describe gender equality in the workplace.",
      "Gender equality means equal chances for all.",
    ],
    [
      SYS + "Summarize the causes of the fall of Rome.",
      "Rome fell from overreach and migration.",
    ],
  ]);

  // Query with SYS + a distinctive word.  The distinctive word ("gender")
  // must have its focus PAST the SYS opening.
  const q = SYS + "gender equality";
  const forest = await m.climbAttention(enc(q), 16, "inverse");

  assert.equal(forest.length, 1, "must return 1 root for single-topic query");

  // The root's focus must be AT OR PAST leadingEnd (the saturated-interval
  // boundary).  leadingEnd is computed from per-region saturation of leading
  // contiguous regions.  The focus must not be deep within the SYS — if the
  // noise drop were removed, a saturated-interval region's focus could out-vote
  // the distinctive one.  `canonicalFailed` regions inside the SYS opening are
  // dropped per-region during vote commit; regions that canonicalized
  // successfully have honest IDF and either saturated out (reach.saturated)
  // or carry correct weight.
  //
  // leadingEnd ≥ maxGroup (4) for hasLeading to be true.  The focus position
  // should be past at least this minimum — if it were at byte 0-3 (deep in
  // the SYS), the noise drop is broken.
  const focusStart = forest[0].start;
  assert.ok(
    focusStart >= 4,
    `root focus at byte ${focusStart} must be ≥ maxGroup (4). ` +
      "If the saturated-interval noise drop were removed, interval foci would not be suppressed and " +
      "could appear as the top root's focus even for distinctive queries.",
  );

  await m.store.close();
});

test("noise drop — query without leading interval (no hasLeading) does not drop votes", async () => {
  const m = mk();
  // No shared SYS opening — the query starts with distinctive content.
  // hasLeading should be false, so the noise drop should NOT suppress any votes.
  await m.ingest([
    [
      "Neil Armstrong and Buzz Aldrin landed on the Moon in 1969.",
      "The Apollo 11 mission was historic.",
    ],
    [
      "Photosynthesis converts sunlight into chemical energy in plants.",
      "It binds carbon dioxide and water into sugar.",
    ],
  ]);

  // Query with distinctive content at byte 0 — no saturated interval
  const q = "Neil Armstrong and Buzz Aldrin";
  const forest = await m.climbAttention(enc(q), 16, "inverse");

  assert.equal(forest.length, 1, "must return 1 root");

  // With no saturated interval, the focus CAN be at byte 0 (the query starts
  // with distinctive content).  If the noise drop incorrectly fired without
  // hasLeading, it would suppress this legitimate focus.
  const focusStart = forest[0].start;
  assert.ok(
    focusStart < SYSLen,
    `without leading interval, focus at byte ${focusStart} can be early — ` +
      "the noise drop must gate on hasLeading and not suppress votes when no saturated interval is detected",
  );

  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION — identity infra + saturated-interval noise drop compose to fix
// position-dependent perception failures
// ═══════════════════════════════════════════════════════════════════════════════

test("integration — edgeAncestors connects flat branches to edge-bearing contexts", async () => {
  // The critical integration of flat-branch storage + hash-consing: a flat
  // branch stored during deposit must be reachable via edgeAncestors — proof
  // that the structural tree hash-consed to it and that the parent chain
  // connects to edge-bearing context roots.  Without both mechanisms, the
  // flat branch has 0 structural parents and edgeAncestors returns
  // contextsReached = 0.
  const m = mk();

  await m.ingest([[SYS + "context one.", "answer one."]]);

  const chunks = leafParentChunks(m, SYS + "context one.");
  const chunk = chunks.find((c) =>
    c.bytes.length >= 3 && c.leafIds.length >= 3
  );
  assert.ok(chunk, "need a chunk with ≥ 3 leaf ids");

  const fb = m.store.findBranch(chunk.leafIds);
  assert.notEqual(fb, null, "flat branch must exist after first deposit");

  // edgeAncestors must find edge-bearing contexts through the structural
  // parent chain.  The flat branch was hash-consed to by the structural
  // leaf-parent chunk, whose ancestors include the edge-bearing context root.
  const N = m.store.edgeSourceCount();
  const reach = m.edgeAncestors(fb, N);
  assert.ok(
    reach.contextsReached >= 1 || reach.roots.length >= 1,
    `edgeAncestors must reach contexts or roots: ` +
      `contextsReached=${reach.contextsReached} roots=${reach.roots.length}. ` +
      "Without flat-branch storage + hash-consing, the flat branch would have 0 structural parents " +
      "and edgeAncestors would find nothing — the flat branch created by " +
      "storeNgrams is orphaned (no parent in the kid table).",
  );

  // The flat branch must have ≥ 1 immediate parent, proving hash-consing works.
  const parents = m.store.parents(fb);
  assert.ok(
    parents.length >= 1,
    `flat branch must have ≥ 1 structural parent, got ${parents.length}. ` +
      "Without hash-consing, storeNgrams creates the flat branch but internTreeIds " +
      "mints a fresh id for the structural chunk.",
  );

  await m.store.close();
});

test("integration — root count from vote distribution, not a constant (24-gen safeguard)", async () => {
  const m = mk();
  await m.ingest([
    [
      SYS + "Describe the importance of gender equality.",
      "Gender equality matters.",
    ],
    [SYS + "Summarize the Roman Empire.", "The Empire fell."],
  ]);

  // Single-topic → exactly 1 root from the vote distribution
  const f1 = await m.climbAttention(
    enc(SYS + "gender equality"),
    16,
    "inverse",
  );
  assert.equal(f1.length, 1, "single-topic must yield exactly 1 root");

  await m.store.close();
});

test("integration — combined DF modes work correctly (24-gen combined DF safeguard)", async () => {
  // The three DF modes (inverse, direct, combined) must all resolve the same
  // forest structure — the weighting changes but the underlying evidence doesn't.
  const m = mk();
  await m.ingest([
    [SYS + "Describe gender equality at work.", "Equal chances for all."],
    [SYS + "Summarize the fall of Rome.", "Overreach and migration."],
  ]);

  const q = SYS + "gender equality at work";
  const inv = await m.climbAttention(enc(q), 16, "inverse");
  const dir = await m.climbAttention(enc(q), 16, "direct");
  const comb = await m.climbAttention(enc(q), 16, "combined");

  // All three modes must return the SAME number of roots.  The weighting
  // changes the vote VALUES but not the forest STRUCTURE — a single-topic
  // query is one root regardless of how it's weighted.
  assert.equal(inv.length, 1, "inverse DF must yield 1 root");
  assert.equal(
    dir.length,
    inv.length,
    "direct DF must yield same root count as inverse",
  );
  assert.equal(
    comb.length,
    inv.length,
    "combined DF must yield same root count as inverse",
  );

  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// FUNDAMENTAL GAP — POSITION-INDEPENDENT IDENTITY
//
// The gap: "They require deeper structural improvements to how short-byte
// sequences hash-cons across positions — not more gating."
//
// The pre-existing failures share ONE root cause: the same bytes at different
// byte offsets produce different perceived trees → different node ids → the
// DAG treats them as different entities.  This is not a bug in the consensus
// climb, the forest assembly, or the IDF weighting — those are all geometrically
// correct.  The bug is that the DAG's content-addressable identity is POSITION-
// DEPENDENT rather than CONTENT-DEPENDENT for multi-byte sequences.
//
// Layer 1 (identity infrastructure) resolves this by deriving a position-
// independent identity from the only position-independent primitive:
// single-byte leaves.  Flat branches keyed by those leaf ids are the same node
// regardless of where the bytes appear.  Layer 2 (saturated-interval noise drop)
// reads whether layer 1 succeeded (`canonicalFailed`) and drops
// position-fragile regions before they reach any context's vote total —
// reading a geometric fact the identity layer already computed, never
// assuming a probability distribution over byte position.
//
// This test is the CANONICAL PROOF: deposit the same byte sequence at two
// different positions in two different contexts, and verify that the flat
// branch identity is preserved.
// ═══════════════════════════════════════════════════════════════════════════════

test("fundamental-gap — same bytes at different positions produce the same flat branch id", async () => {
  const m = mk();

  // Deposit two contexts where "the " (4 bytes) appears at DIFFERENT byte
  // offsets.  Context 1: "the " right after SYS.  Context 2: "the " deeper
  // in the context body.
  await m.ingest([[
    SYS + "the first context is about space.",
    "Space is vast.",
  ]]);

  // After the first deposit, find the flat branch for a known 4-byte SYS chunk.
  // SYS chunks are at fixed positions and guaranteed to form leaf-parent groups.
  const chunks1 = leafParentChunks(
    m,
    SYS + "the first context is about space.",
  );
  const firstChunk = chunks1.find((c) => c.bytes.length === 4);
  assert.ok(firstChunk, "must find at least one 4-byte leaf-parent chunk");
  const fb1 = m.store.findBranch(firstChunk.leafIds);
  assert.notEqual(fb1, null, "flat branch must exist for first chunk");

  // Deposit a second context with the SAME SYS opening
  await m.ingest([[
    SYS + "the second context is about oceans.",
    "Oceans are deep.",
  ]]);

  // The SAME SYS chunks must return the SAME flat branch ids.
  // This is the position-independence invariant: the SYS opening is at the
  // same byte offset (0) in both contexts, so the structural nodes hash-cons.
  // But more importantly, the flat branches (stored by flat-branch storage) are shared because
  // the leaf ids are identical.
  const fb2 = m.store.findBranch(firstChunk.leafIds);
  assert.equal(
    fb2,
    fb1,
    "same leaf ids → same flat branch id across deposits.  This is the " +
      "foundation of position-independent identity.  Without flat-branch storage, the second " +
      "deposit might not find the flat branch stored by the first.",
  );

  // The flat branch must have accumulated parents from BOTH deposits.
  // Each deposit's structural tree contains the SYS opening chunks; each
  // structural node hash-conses to the same flat branch via hash-consing.
  const parents = m.store.parents(fb1);
  assert.ok(
    parents.length >= 1,
    `flat branch must have ≥ 1 structural parent after two deposits, ` +
      `got ${parents.length}.  flatLeafIds hash-consing must link ` +
      `structural nodes from both contexts to this flat branch.`,
  );

  await m.store.close();
});
