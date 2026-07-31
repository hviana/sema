// 75-multiturn-context-optimisation.test.mjs — the multi-turn context
// machinery: the incremental PLAIN fold, the perceive-memo key, and the
// agreement between what the deposit path folds and what inference reads.
//
// WHAT THIS FILE IS FOR.  test/63 pins the FOLD's contract and test/13 pins the
// conversation API's BEHAVIOUR.  Neither covers the layer between them: that a
// conversation's context is folded ONCE per turn instead of from scratch, that
// the tree it produces is the same tree a cold fold produces, and that the
// deposit path records the same turn boundaries inference reads.  Every bug
// this file guards against was live in the code and invisible to the other 480
// tests, so each one is asserted here as a property rather than left to be
// caught by an accuracy number somewhere downstream.
//
// THE FOUR BUGS THIS FILE EXISTS TO PREVENT RECURRING:
//
//   1. TRAIN/INFER FOLD DISAGREEMENT.  Inference imposed a turn-boundary set
//      on the fold while the deposit path folded plainly, so the trained and
//      inferred roots for identical bytes sat at cosine 0.02-0.21 and the
//      alignment family went quadratic (5.2M cells on a 476-byte context,
//      against 0 when the two agree).  NEITHER SIDE IMPOSES BOUNDARIES NOW:
//      both fold a stream over its own content cuts, so agreement is
//      structural rather than something a heuristic has to keep re-deriving.
//      Section D.
//
//   2. A BOUNDARY-BLIND MEMO KEY.  `perceive` memoised by content alone though
//      its tree depends on the boundary set too, so the first shape computed
//      for a byte string was served to every later caller.  Section C.
//
//   3. THE OPTIMISATION SILENTLY NOT HAPPENING.  `_growContext` rebuilt the
//      whole tree with `bytesToTree` every turn.  `_resolvedSubtrees` is a
//      WeakMap keyed by NODE IDENTITY, so a rebuilt tree meant it could not
//      hit even once — the documented O(suffix) recognition was an intention,
//      not the code.  A regression here is invisible to every accuracy test,
//      because rebuilding is SLOWER but just as CORRECT.  Section B.
//
//   4. A CACHE THAT CHANGES THE ANSWER.  The incremental fold reuses already-
//      folded segments.  If reuse ever produced a different tree from a cold
//      fold, the store would depend on cache residency and eviction order.
//      Sections A and D.
//
// ON TURN BOUNDARIES.  A conversation still TRACKS them — ConversationState,
// answeredSpans and currentTurnStart all need them — but they are API metadata
// and never reach the fold.  Incremental reuse does not come from them: it
// comes from content cuts being stable under append, which is a property of
// the rolling hash and holds with no boundary set at all (A5).
//
// NUMBERS HERE ARE CEILINGS AND FLOORS WITH SLACK, never equalities, except
// where the property IS an exact identity (fold equivalence, determinism).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bytesToTree,
  contentBoundaries,
  contentFoldIncremental,
  Mind,
  stablePrefixFoldIncremental,
} from "../dist/src/index.js";
// White-box: the memo key is internal, but its soundness is exactly what
// section C is about, so it is imported directly rather than inferred from
// downstream accuracy.
import { perceiveKey } from "../dist/src/mind/primitives.js";

const enc = (s) => new TextEncoder().encode(s);
const newMind = (opts = {}) => new Mind({ seed: 7, ...opts });

/** Structural signature: shape + leaf bytes, no vectors. */
const sig = (n) =>
  n.kids === null
    ? "L" + Array.from(n.leaf ?? []).join(",")
    : "(" + n.kids.map(sig).join("|") + ")";

const cos = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb);
};

/** Two trees are the SAME perception: same structure, same direction. */
const sameTree = (t1, t2) => sig(t1) === sig(t2) && cos(t1.v, t2.v) > 0.999999;

/** Every Sema object reachable from a root — identity, not content. */
const nodeSet = (n, s = new Set()) => {
  s.add(n);
  if (n.kids) { for (const k of n.kids) nodeSet(k, s); }
  return s;
};

/** The latin1 content key the deposit cache is keyed by. */
const l1 = (b) => {
  let o = "";
  for (const x of b) o += String.fromCharCode(x);
  return o;
};

/** Train a conversation the way ingestPair chains it: cumulative context →
 *  next turn, with the caller's own join string (default: none, as test/13). */
async function teach(mind, turns, join = "") {
  for (let i = 1; i < turns.length; i++) {
    await mind.ingest(turns.slice(0, i).join(join), turns[i]);
  }
}

/** A deterministic byte-stream generator — text is one case, not the case. */
function streams(seed = 12345) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return { rnd };
}

// ═══════════════════════════════════════════════════════════════════════
// A. THE INCREMENTAL FOLD IS THE FOLD
//
// `stablePrefixFoldIncremental` and `bytesToTree` are documented as producing
// the same cuts and the same tree.  If that ever stops being true, a
// conversation's perception silently diverges from every other entry point —
// and, because the incremental one carries a CACHE, the divergence could
// depend on what was folded before, which is unreproducible by construction.
// ═══════════════════════════════════════════════════════════════════════

test("A1: incremental fold ≡ bytesToTree, over random byte streams", () => {
  const mind = newMind();
  const { rnd } = streams();
  for (let trial = 0; trial < 250; trial++) {
    const len = 1 + Math.floor(rnd() * 400);
    const b = new Uint8Array(len);
    // full byte range — not text; a text-only corpus has hidden this class
    // of bug before (see test/63's header).
    for (let i = 0; i < len; i++) b[i] = Math.floor(rnd() * 256);
    const nb = Math.floor(rnd() * 6);
    const bs = [
      ...new Set(Array.from({ length: nb }, () => 1 + Math.floor(rnd() * len))),
    ]
      .sort((x, y) => x - y);
    const ref = bytesToTree(
      mind.space,
      mind.alphabet,
      b,
      undefined,
      undefined,
      bs.length ? bs : undefined,
    );
    const inc =
      stablePrefixFoldIncremental(mind.space, mind.alphabet, b, bs).tree;
    assert.ok(
      sameTree(ref, inc),
      `trial ${trial}: len=${len} boundaries=[${bs}]`,
    );
  }
});

test("A2: SEGMENT REUSE IS TRANSPARENT — a warm fold equals a cold one", () => {
  // The cache exists only to skip work.  A tree that depends on cache state
  // would make the store depend on eviction order.
  const mind = newMind();
  const { rnd } = streams(777);
  for (let trial = 0; trial < 150; trial++) {
    const len = 40 + Math.floor(rnd() * 300);
    const b = new Uint8Array(len);
    for (let i = 0; i < len; i++) b[i] = Math.floor(rnd() * 256);
    const nb = 1 + Math.floor(rnd() * 4);
    const bs = [
      ...new Set(
        Array.from({ length: nb }, () => 1 + Math.floor(rnd() * (len - 1))),
      ),
    ]
      .sort((x, y) => x - y);
    const cut = bs[bs.length - 1];
    const warm = stablePrefixFoldIncremental(
      mind.space,
      mind.alphabet,
      b.subarray(0, cut),
      bs.slice(0, -1),
    );
    const grown =
      stablePrefixFoldIncremental(mind.space, mind.alphabet, b, bs, warm.fold)
        .tree;
    const cold =
      stablePrefixFoldIncremental(mind.space, mind.alphabet, b, bs).tree;
    assert.ok(sameTree(cold, grown), `trial ${trial}: boundaries=[${bs}]`);
  }
});

test("A3: degenerate boundary sets fold identically through both entry points", () => {
  // Out-of-order is the one that bit: the cut filter is sequential (`b > prev`),
  // so an unsorted entry is DROPPED rather than rejected.  bytesToTree sorted
  // on the way in and absorbed it; its twin must too, or the same set yields
  // two different trees depending on which door it came through.
  const mind = newMind();
  const b = enc("abcdefghijklmnop");
  const sets = [[], [0], [16], [0, 16], [5, 5], [3, 1], [9, 2, 14], [40], [
    -1,
    4,
  ], [4, 4, 4]];
  for (const bs of sets) {
    const ref = bytesToTree(
      mind.space,
      mind.alphabet,
      b,
      undefined,
      undefined,
      bs.length ? bs : undefined,
    );
    const inc =
      stablePrefixFoldIncremental(mind.space, mind.alphabet, b, bs).tree;
    assert.ok(sameTree(ref, inc), `boundaries=[${bs}]`);
  }
});

test("A4: the stable-prefix property itself — a prefix folds free of what follows", () => {
  // The property the whole multi-turn design rests on. Asserted against the
  // PLAIN fold as a control, because without a control "cosine 1.0" only says
  // the fold is deterministic.
  const mind = newMind();
  const turns = [
    "the weeping woman was painted by picasso",
    "picasso co-founded the cubist movement",
    "cubism began in paris around 1907",
    "braque worked alongside him there",
  ];
  let ctx = "", bounds = [];
  const snaps = [];
  for (const t of turns) {
    if (ctx.length > 0) bounds.push(ctx.length);
    ctx += t;
    snaps.push({
      ctx,
      tree: bytesToTree(
        mind.space,
        mind.alphabet,
        enc(ctx),
        undefined,
        undefined,
        bounds.length ? [...bounds] : undefined,
      ),
    });
  }
  const spine = (root, down) => {
    let n = root;
    for (let i = 0; i < down; i++) n = n.kids[0];
    return n;
  };
  const K = snaps.length;
  for (let j = 1; j < K; j++) {
    const inside = spine(snaps[K - 1].tree, K - j);
    const alone = snaps[j - 1].tree;
    assert.ok(
      sameTree(inside, alone),
      `prefix of ${j} turn(s) must fold identically inside the grown context`,
    );
  }
  // Control: under a plain fold the previous root does not survive anywhere.
  for (let i = 1; i < K; i++) {
    const prevPlain = bytesToTree(
      mind.space,
      mind.alphabet,
      enc(snaps[i - 1].ctx),
    );
    const nowPlain = bytesToTree(mind.space, mind.alphabet, enc(snaps[i].ctx));
    let best = -1;
    const walk = (n) => {
      best = Math.max(best, cos(n.v, prevPlain.v));
      if (n.kids) n.kids.forEach(walk);
    };
    walk(nowPlain);
    assert.ok(
      best < 0.95,
      `plain fold should NOT preserve the prefix root (got ${best.toFixed(3)})`,
    );
  }
});

test("A5: contentFoldIncremental ≡ the plain fold, cold and warm", () => {
  // The fold the conversation and deposit paths now share. It must equal
  // bytesToTree with NO boundary set — that equality IS the train/infer
  // agreement — both from cold and when reusing a prefix's segments.
  const mind = newMind();
  const { rnd } = streams(31337);
  for (let trial = 0; trial < 250; trial++) {
    const len = 1 + Math.floor(rnd() * 400);
    const b = new Uint8Array(len);
    for (let i = 0; i < len; i++) b[i] = Math.floor(rnd() * 256);
    const ref = bytesToTree(mind.space, mind.alphabet, b);
    const cold = contentFoldIncremental(mind.space, mind.alphabet, b).tree;
    assert.ok(sameTree(ref, cold), `cold: trial ${trial}, len=${len}`);
    const cut = Math.max(1, Math.floor(len * 0.6));
    const pre = contentFoldIncremental(
      mind.space,
      mind.alphabet,
      b.subarray(0, cut),
    );
    const warm =
      contentFoldIncremental(mind.space, mind.alphabet, b, pre.fold).tree;
    assert.ok(
      sameTree(ref, warm),
      `warm: trial ${trial}, len=${len}, cut=${cut}`,
    );
    // a reused segment must never be mutated by the root normalize
    const again =
      contentFoldIncremental(mind.space, mind.alphabet, b, pre.fold).tree;
    assert.ok(
      sameTree(ref, again),
      `second warm fold differed: trial ${trial}`,
    );
  }
});

test("A6: content cuts are stable under append — the reuse this rests on", () => {
  // Why a PLAIN fold is incrementally reusable at all: cuts are decided by a
  // rolling hash over a local window, so bytes appended at the right edge
  // cannot move a cut to their left. If this ever stops holding, the
  // incremental fold silently degrades to a full refold every turn.
  const mind = newMind();
  const { rnd } = streams(9001);
  for (let trial = 0; trial < 40; trial++) {
    const base = new Uint8Array(50 + Math.floor(rnd() * 300));
    for (let i = 0; i < base.length; i++) base[i] = Math.floor(rnd() * 256);
    const before = contentBoundaries(mind.space, base);
    const addLen = 1 + Math.floor(rnd() * 60);
    const grown = new Uint8Array(base.length + addLen);
    grown.set(base, 0);
    for (let i = 0; i < addLen; i++) {
      grown[base.length + i] = Math.floor(rnd() * 256);
    }
    const after = contentBoundaries(mind.space, grown);
    for (let i = 0; i < before.length; i++) {
      assert.equal(
        after[i],
        before[i],
        `trial ${trial}: cut ${i} moved on append`,
      );
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════
// B. THE OPTIMISATION ACTUALLY HAPPENS
//
// This is the section that catches a silent performance regression.  Rebuilding
// the context tree every turn is just as CORRECT as reusing it, so no accuracy
// test can see the difference — only node identity can.
// ═══════════════════════════════════════════════════════════════════════

const convTree = (mind, conv) => mind._conversations.get(conv.id).tree;

test("B1: a grown context REUSES the previous turn's subtree objects", () => {
  const mind = newMind();
  const conv = mind.beginConversation();
  const turns = [
    "alpha turn one here",
    "beta turn two here",
    "gamma turn three",
    "delta turn four now",
  ];
  let prev = null;
  const rows = [];
  for (const t of turns) {
    mind.addTurn(conv, t);
    const set = nodeSet(convTree(mind, conv));
    const shared = prev ? [...set].filter((n) => prev.has(n)).length : 0;
    rows.push({ total: set.size, shared, fresh: set.size - shared });
    prev = set;
  }
  // Turn 1 has nothing to share. Every later turn must reuse the bulk of the
  // tree — with a full rebuild this is exactly 0, so any floor above 0 is a
  // real guard; 40% leaves generous slack for fold-shape changes.
  for (let i = 1; i < rows.length; i++) {
    const frac = rows[i].shared / rows[i].total;
    assert.ok(
      frac > 0.4,
      `turn ${i + 1}: only ${rows[i].shared}/${rows[i].total} nodes reused (${
        (frac * 100).toFixed(0)
      }%) — ` +
        `the context is being re-folded from scratch, not extended`,
    );
  }
  // And the fresh work must track the TURN, not the context: the last turn is
  // no larger than the first, so its fresh-node count must not have grown with
  // the accumulated context.
  assert.ok(
    rows[rows.length - 1].fresh <= rows[1].fresh * 2,
    `fresh nodes per turn grew with context: ${
      rows.map((r) => r.fresh).join(", ")
    }`,
  );
});

test("B2: per-turn perception cost does not grow with the accumulated context", async () => {
  const pairs = [
    [
      "who painted the weeping woman",
      "pablo picasso painted the weeping woman",
    ],
    ["what movement did he found", "he co-founded the cubist movement"],
    ["when did that movement begin", "cubism began around nineteen oh seven"],
    ["where did it begin", "it began in paris"],
    ["who worked with him there", "georges braque worked with him"],
    ["what did they fragment", "they fragmented objects into geometric planes"],
    [
      "what came in nineteen thirty seven",
      "guernica came in nineteen thirty seven",
    ],
    ["what did it protest", "it protested the bombing of guernica"],
  ];
  const mind = newMind({ profile: true });
  let ctx = "";
  for (const [u, a] of pairs) {
    ctx += u;
    await mind.ingest(ctx, a);
    ctx += a;
  }

  const conv = mind.beginConversation();
  const perTurn = [];
  for (const [u] of pairs) {
    await mind.respondTurnText(conv, u);
    perTurn.push({
      bytes: mind.lastCost.counters.perceivedBytes ?? 0,
      align: mind.lastCost.counters.alignCells ?? 0,
      ctx: mind.conversationState(conv).context.length,
    });
  }
  const finalCtx = perTurn[perTurn.length - 1].ctx;

  // ALIGNMENT IS THE LOUD ONE.  When the cumulative context resolves exactly,
  // the quadratic alignment family never has to run.  Before the boundary
  // agreement was fixed this reached 3.1e7 cells on a 579-byte context, so a
  // ceiling here is the single most sensitive regression signal in the file.
  const worstAlign = Math.max(...perTurn.map((p) => p.align));
  assert.ok(
    worstAlign < finalCtx * finalCtx,
    `alignment went quadratic in the context (${worstAlign} cells over ${finalCtx} bytes) — ` +
      `the trained context root is no longer resolving`,
  );

  // PERCEPTION IS THE STEADY ONE.  Later turns must not fold more than early
  // turns merely because the context is longer.
  const early = perTurn.slice(1, 4).reduce((s, p) => s + p.bytes, 0) / 3;
  const late = perTurn.slice(-3).reduce((s, p) => s + p.bytes, 0) / 3;
  assert.ok(
    late <= Math.max(early * 3, 4000),
    `perceived bytes per turn grew with context (early ≈ ${early | 0}, late ≈ ${
      late | 0
    }): ` +
      perTurn.map((p) => p.bytes).join(", "),
  );
});

test("B3: a restored conversation reuses subtrees too", () => {
  // A resumed conversation is otherwise identical to a live one; if restore
  // dropped the segment state it would pay a full re-fold for the rest of its
  // life, and nothing downstream would notice.
  const mind = newMind();
  const a = mind.beginConversation();
  for (
    const t of [
      "first turn text here",
      "second turn text here",
      "third turn text",
    ]
  ) mind.addTurn(a, t);
  const state = mind.conversationState(a);

  const b = mind.beginConversation(state);
  const before = nodeSet(convTree(mind, b));
  mind.addTurn(b, "fourth turn text");
  const after = nodeSet(convTree(mind, b));
  const shared = [...after].filter((n) => before.has(n)).length;
  assert.ok(
    shared / after.size > 0.4,
    `a restored conversation re-folded from scratch (${shared}/${after.size} reused)`,
  );
});

// ═══════════════════════════════════════════════════════════════════════
// C. THE MEMO KEY CARRIES THE BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════

test("C1: the same bytes under different boundary sets are different memo keys", () => {
  const b = enc("one two three four five six");
  assert.notEqual(
    perceiveKey(b, [7]),
    perceiveKey(b),
    "boundaries must change the key",
  );
  assert.notEqual(
    perceiveKey(b, [7]),
    perceiveKey(b, [11]),
    "different cuts, different keys",
  );
  assert.equal(
    perceiveKey(b, []),
    perceiveKey(b),
    "an empty set is the plain fold",
  );
  assert.equal(
    perceiveKey(b, undefined),
    perceiveKey(b),
    "undefined is the plain fold",
  );
  assert.equal(
    perceiveKey(b, [7]),
    perceiveKey(b, [7]),
    "the key is a function of its inputs",
  );
});

test("C2: no content can forge the key's boundary separator", () => {
  // The key is content + separator + rendered boundaries.  Two DIFFERENT
  // (bytes, boundaries) pairs must never collide, including when the content
  // itself contains digits, commas, or the separator byte.
  const seen = new Map();
  const cases = [
    [enc("abc"), [1, 2]],
    [enc("abc"), [12]],
    [enc("abc1,2"), undefined],
    [enc("abc1"), [2]],
    [enc("a b"), [1]],
    [enc("a b"), undefined],
    [enc("a"), [1, 2]],
    [enc("a"), [12]],
    [enc("1,2"), [3]],
    [enc(""), [1]],
    [enc(""), undefined],
  ];
  for (const [b, bs] of cases) {
    const k = perceiveKey(b, bs);
    const label = `${JSON.stringify(new TextDecoder().decode(b))}/${
      bs ?? "none"
    }`;
    if (seen.has(k)) {
      const other = seen.get(k);
      // A collision is only legal when the two really are the same perception.
      const sameInput = other.b === l1(b) &&
        JSON.stringify(other.bs ?? []) === JSON.stringify(bs ?? []);
      assert.ok(sameInput, `key collision between ${other.label} and ${label}`);
    }
    seen.set(k, { b: l1(b), bs, label });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// D. THE DEPOSIT PATH RECORDS THE BOUNDARIES INFERENCE READS
//
// The guard must be PRECISE (never chain unrelated deposits — most of a real
// corpus is single-turn facts) and have RECALL (always chain a genuine turn).
// ═══════════════════════════════════════════════════════════════════════

test("D1: TRAIN/INFER AGREEMENT — deposit and inference fold identically", () => {
  // THE headline invariant, and the one the whole review turned on. Neither
  // side imposes a boundary set: the deposit path and the conversation path
  // both fold a stream over its OWN content cuts, so the trained context node
  // and the node inference resolves are the same node by construction.
  //
  // When they disagreed, the trained and inferred roots for identical bytes
  // sat at cosine 0.02-0.21, multi-turn recall collapsed, and the alignment
  // family went quadratic (5.2M cells on a 476-byte context, against 0 when
  // they agree).
  const mind = newMind();
  const conv = mind.beginConversation();
  const turns = [
    "user turn one asks a thing",
    "assistant replies to one",
    "user turn two asks more",
    "assistant replies to two",
    "user turn three asks again",
    "assistant replies to three",
  ];
  for (const t of turns) {
    mind.addTurn(conv, t);
    const data = mind._conversations.get(conv.id);
    const plain = bytesToTree(mind.space, mind.alphabet, data.bytes);
    assert.ok(
      sameTree(plain, data.tree),
      `the conversation folded ${data.bytes.length}B differently from perceive() on the same bytes`,
    );
  }
});

test("D2: no fold imposes a boundary set — reuse is transparent, not structural", async () => {
  // A deposit's tree must be a pure function of its BYTES. Depositing a chain
  // with a hot segment cache must store exactly what depositing it with a cold
  // one stores, or the store would depend on cache residency and eviction
  // order. Compared by what is STORED (node count + read-back bytes), never by
  // raw node ids: ids are mint order, so two stores that saw different numbers
  // of deposits number the same content differently.
  const turns = [
    "one asks a question here",
    "one answers it plainly",
    "two asks a question here",
    "two answers it plainly",
    "three asks a question",
    "three answers it plainly",
  ];
  const cumulative = [];
  {
    let c = "";
    for (const t of turns) {
      c += t;
      cumulative.push(c);
    }
  }

  const deposit = async (cold) => {
    const mind = newMind();
    for (let i = 0; i + 1 < turns.length; i++) {
      if (cold) {
        mind._depositTrees.clear();
        mind._depositLens.clear();
      }
      await mind.ingest(cumulative[i], turns[i + 1]);
    }
    const readback = [];
    for (let i = 0; i + 1 < turns.length; i++) {
      const id = mind.resolve(enc(cumulative[i]));
      readback.push(
        id === null
          ? null
          : new TextDecoder().decode(await mind.store.bytes(id)),
      );
    }
    return { nodes: mind.store.nodeCount(), readback };
  };

  const warm = await deposit(false);
  const cold = await deposit(true);
  assert.ok(
    warm.readback.every((x) => x !== null),
    "a deposited context did not resolve",
  );
  assert.deepEqual(
    warm.readback,
    cumulative.slice(0, -1),
    "a resolved context node does not hold that context's bytes",
  );
  assert.deepEqual(
    warm.readback,
    cold.readback,
    "segment reuse changed what was stored",
  );
  assert.equal(
    warm.nodes,
    cold.nodes,
    "segment reuse changed how many nodes were minted",
  );
});

test("D3: a deposited context resolves through the plain path", async () => {
  // The consequence of agreement, stated as the property callers depend on:
  // whatever was deposited can be found again by content addressing, with no
  // boundary set and no conversation handle.
  const mind = newMind();
  const turns = [
    "ask about the painting",
    "it was painted by picasso",
    "ask about the movement",
    "he founded cubism",
  ];
  let ctx = "";
  const ctxs = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    ctx += turns[i];
    ctxs.push(ctx);
    await mind.ingest(ctx, turns[i + 1]);
  }
  for (const c of ctxs) {
    assert.notEqual(
      mind.resolve(enc(c)),
      null,
      `deposited context did not resolve: ${JSON.stringify(c.slice(0, 40))}`,
    );
  }
});

test("D4: an unrelated deposit sharing a byte prefix is harmless", async () => {
  // This used to need a continuation-bytes proof, because a wrong guess
  // changed the TREE. Nothing is imposed now, so a coincidental prefix simply
  // reuses identical segments and both deposits keep their own correct trees.
  const mind = newMind();
  await mind.ingest("what is two plus two", "four");
  await mind.ingest("what is two plus two hundred", "two hundred and two");
  const a = mind.resolve(enc("what is two plus two"));
  const b = mind.resolve(enc("what is two plus two hundred"));
  assert.notEqual(a, null);
  assert.notEqual(b, null);
  assert.notEqual(a, b, "two different facts collapsed to one node");
  assert.equal((await mind.respondText("what is two plus two")).trim(), "four");
  assert.equal(
    (await mind.respondText("what is two plus two hundred")).trim(),
    "two hundred and two",
  );
});

test("D5: re-deposition is idempotent — no new nodes, same answers", async () => {
  const turns = [
    "alpha asks one",
    "beta says one",
    "alpha asks two",
    "beta says two",
  ];
  const mind = newMind();
  const rounds = [];
  for (let r = 0; r < 2; r++) {
    await teach(mind, turns);
    const conv = mind.beginConversation();
    const outs = [];
    for (let i = 0; i + 1 < turns.length; i += 2) {
      outs.push((await mind.respondTurnText(conv, turns[i])).response);
    }
    mind.endConversation(conv);
    rounds.push({ nodes: mind.store.nodeCount(), outs });
  }
  assert.equal(
    rounds[0].nodes,
    rounds[1].nodes,
    "re-depositing the same chain minted new nodes",
  );
  assert.deepEqual(
    rounds[0].outs,
    rounds[1].outs,
    "re-deposition changed the answers",
  );
});

test("D6: a long chain and the 8-entry cache — correctness never depends on it", async () => {
  // The cache is a work cache with a hard bound, so a long conversation WILL
  // evict its early links. Every context must still resolve: an evicted entry
  // costs a refold, never a different tree.
  const mind = newMind();
  const N = 25;
  let ctx = "";
  const ctxs = [];
  for (let i = 0; i < N; i++) {
    ctx += `u${i} question text here`;
    ctxs.push(ctx);
    await mind.ingest(ctx, `a${i} answer text here`);
    ctx += `a${i} answer text here`;
  }
  for (let i = 0; i < ctxs.length; i++) {
    assert.notEqual(
      mind.resolve(enc(ctxs[i])),
      null,
      `context ${i} did not resolve after eviction`,
    );
  }
});

test("D7: interleaved conversations stay independent", async () => {
  // Six conversations against an 8-entry cache: entries evict constantly.
  // Every context of every conversation must still resolve to its own node.
  const mind = newMind();
  const C = 6, T = 4;
  const ctxs = Array.from({ length: C }, () => "");
  const all = [];
  for (let t = 0; t < T; t++) {
    for (let c = 0; c < C; c++) {
      ctxs[c] += `c${c}u${t} the question `;
      all.push(ctxs[c]);
      await mind.ingest(ctxs[c], `c${c}a${t} the answer `);
      ctxs[c] += `c${c}a${t} the answer `;
    }
  }
  const ids = all.map((c) => mind.resolve(enc(c)));
  assert.ok(
    ids.every((x) => x !== null),
    "an interleaved deposit did not resolve",
  );
  assert.equal(
    new Set(ids).size,
    ids.length,
    "two distinct contexts collapsed to one node",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// E. CONVERSATION STATE IS SOUND ACROSS SAVE AND RESTORE
// ═══════════════════════════════════════════════════════════════════════

test("E1: boundaries are always strictly increasing and inside the context", () => {
  const mind = newMind();
  const conv = mind.beginConversation();
  for (const t of ["one", "", "two turns", "three turns now", "", "four"]) {
    mind.addTurn(conv, t);
  }
  const st = mind.conversationState(conv);
  for (let i = 1; i < st.boundaries.length; i++) {
    assert.ok(
      st.boundaries[i] > st.boundaries[i - 1],
      `boundaries not strictly increasing: ${st.boundaries}`,
    );
  }
  for (const b of st.boundaries) {
    assert.ok(
      b > 0 && b < st.context.length,
      `boundary ${b} outside a ${st.context.length}-byte context`,
    );
  }
});

test("E2: restoring between every turn equals an uninterrupted conversation", async () => {
  const turns = [
    "who painted it",
    "picasso painted it",
    "what movement",
    "cubism was the movement",
    "when did it start",
    "it started in nineteen oh seven",
  ];
  const build = async () => {
    const m = newMind();
    await teach(m, turns);
    return m;
  };

  const m1 = await build();
  const c1 = m1.beginConversation();
  const live = [];
  for (let i = 0; i < turns.length; i += 2) {
    live.push((await m1.respondTurnText(c1, turns[i])).response);
  }

  const m2 = await build();
  let st;
  const restored = [];
  for (let i = 0; i < turns.length; i += 2) {
    const c = m2.beginConversation(st);
    const r = await m2.respondTurnText(c, turns[i]);
    restored.push(r.response);
    st = r.state;
    m2.endConversation(c);
  }
  assert.deepEqual(
    restored,
    live,
    "save/restore between turns changed the conversation",
  );
});

test("E3: out-of-order restored boundaries are normalised, not silently dropped", () => {
  // A ConversationState can arrive from outside — hand-built, migrated, or
  // round-tripped. The folds filter cuts sequentially, so an unsorted entry
  // would be dropped and the conversation would fold over a different set
  // than the caller believes it restored.
  const mind = newMind();
  const conv = mind.beginConversation();
  for (
    const t of [
      "turn one here",
      "turn two here",
      "turn three here",
      "turn four",
    ]
  ) mind.addTurn(conv, t);
  const good = mind.conversationState(conv);

  const shuffled = { ...good, boundaries: [...good.boundaries].reverse() };
  const dupes = {
    ...good,
    boundaries: [...good.boundaries, ...good.boundaries],
  };
  const oob = {
    ...good,
    boundaries: [
      0,
      ...good.boundaries,
      good.context.length,
      good.context.length + 99,
    ],
  };

  const ref = mind.conversationState(mind.beginConversation(good)).boundaries;
  for (
    const [label, st] of [["reversed", shuffled], ["duplicated", dupes], [
      "out-of-range",
      oob,
    ]]
  ) {
    const got = mind.conversationState(mind.beginConversation(st)).boundaries;
    assert.deepEqual(
      got,
      ref,
      `${label} boundaries were not normalised to the same set`,
    );
  }
});

test("E4: answeredSpans track the assistant's own replies", async () => {
  const turns = [
    "ask one thing",
    "reply to one",
    "ask two things",
    "reply to two",
  ];
  const mind = newMind();
  await teach(mind, turns);
  const conv = mind.beginConversation();
  const st1 = (await mind.respondTurnText(conv, turns[0])).state;
  const ctx = new TextDecoder().decode(st1.context);
  for (const [s, e] of st1.answeredSpans) {
    assert.ok(
      e > s && e <= st1.context.length,
      `answered span [${s},${e}) outside the context`,
    );
    // the span must name bytes the mind produced, not bytes the user supplied
    assert.ok(
      !ctx.slice(0, s).endsWith(ctx.slice(s, e)),
      "an answered span duplicates user text",
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// F. END TO END — the behaviour all of the above exists to protect
// ═══════════════════════════════════════════════════════════════════════

test("F1: every turn of a trained conversation is answered exactly", async () => {
  const pairs = [
    [
      "who painted the weeping woman",
      "pablo picasso painted the weeping woman",
    ],
    ["what movement did he found", "he co-founded the cubist movement"],
    ["when did that movement begin", "cubism began around nineteen oh seven"],
    ["where did it begin", "it began in paris"],
    ["who worked with him there", "georges braque worked with him"],
    ["what did they fragment", "they fragmented objects into geometric planes"],
    [
      "what came in nineteen thirty seven",
      "guernica came in nineteen thirty seven",
    ],
    ["what did it protest", "it protested the bombing of guernica"],
    ["where does it hang now", "it hangs in madrid"],
    ["thank you for the summary", "you are welcome"],
  ];
  const mind = newMind();
  let ctx = "";
  for (const [u, a] of pairs) {
    ctx += u;
    await mind.ingest(ctx, a);
    ctx += a;
  }

  const conv = mind.beginConversation();
  const wrong = [];
  for (const [u, want] of pairs) {
    const got = (await mind.respondTurnText(conv, u)).response.trim();
    if (got !== want) wrong.push({ u, want, got });
  }
  // Before the boundary agreement was fixed this scored 3/10, and the failures
  // were not silence but CONFIDENT WRONG ANSWERS from later turns — so a floor
  // here guards meaning, not just recall.
  assert.deepEqual(
    wrong,
    [],
    `${wrong.length}/${pairs.length} turns answered wrongly`,
  );
});

test("F1b: attaching a trace changes no answer — the audit layer is inert", async () => {
  // The mind's ONLY text-shaped code lives in the rationale/trace payloads:
  // attention.ts's `dec` helper decodes bytes and collapses whitespace so an
  // audit line is readable, and frame-filler builds diagnostic strings the
  // same way. Neither may ever reach a decision — nothing in the core knows
  // what "whitespace" is (see canon.ts's header, and AGENTS §2.11: profile
  // and trace must not move an answer). Asserted here rather than assumed,
  // because the formatting sits inside the same functions that decide.
  const pairs = [
    [
      "who painted the weeping woman",
      "pablo picasso painted the weeping woman",
    ],
    ["what movement did he found", "he co-founded the cubist movement"],
    ["when did that movement begin", "cubism began around nineteen oh seven"],
    ["where did it begin", "it began in paris"],
    ["who worked with him there", "georges braque worked with him"],
  ];
  const run = async (traced) => {
    const mind = newMind();
    let ctx = "";
    const ctxs = [];
    for (const [u, a] of pairs) {
      ctx += u;
      ctxs.push(ctx);
      await mind.ingest(ctx, a);
      ctx += a;
    }
    const outs = [];
    const sink = traced ? () => {} : undefined;
    for (const c of ctxs) outs.push(await mind.respondText(c, sink));
    const conv = mind.beginConversation();
    for (const [u] of pairs) {
      outs.push((await mind.respondTurnText(conv, u, sink)).response);
    }
    return outs;
  };
  assert.deepEqual(
    await run(true),
    await run(false),
    "a trace changed an answer",
  );
});

test("F2: a conversation is deterministic — identical bytes, identical replies and ids", async () => {
  const pairs = [["q one here", "a one here"], ["q two here", "a two here"], [
    "q three here",
    "a three here",
  ]];
  const run = async () => {
    const mind = newMind();
    let ctx = "";
    for (const [u, a] of pairs) {
      ctx += u;
      await mind.ingest(ctx, a);
      ctx += a;
    }
    const conv = mind.beginConversation();
    const outs = [];
    for (const [u] of pairs) {
      outs.push((await mind.respondTurnText(conv, u)).response);
    }
    const st = mind.conversationState(conv);
    return { outs, boundaries: st.boundaries, nodes: mind.store.nodeCount() };
  };
  const a = await run(), b = await run();
  assert.deepEqual(a, b, "the conversation path is not reproducible");
});

test("F3: the conversation API is never WORSE than respond() on the same bytes", async () => {
  // The original defect, stated as a property: respondTurn diverged from
  // respond on byte-identical input and lost. The Conversation API knows
  // strictly more (the turn boundaries), so it must never do worse.
  const pairs = [
    [
      "who painted the weeping woman",
      "pablo picasso painted the weeping woman",
    ],
    ["what movement did he found", "he co-founded the cubist movement"],
    ["when did that movement begin", "cubism began around nineteen oh seven"],
    ["where did it begin", "it began in paris"],
    ["who worked with him there", "georges braque worked with him"],
  ];
  const build = async () => {
    const m = newMind();
    let ctx = "";
    const trained = [];
    for (const [u, a] of pairs) {
      ctx += u;
      trained.push(ctx);
      await m.ingest(ctx, a);
      ctx += a;
    }
    return { m, trained };
  };
  const A = await build();
  let plain = 0;
  for (let i = 0; i < pairs.length; i++) {
    if ((await A.m.respondText(A.trained[i])).trim() === pairs[i][1]) plain++;
  }
  const B = await build();
  const conv = B.m.beginConversation();
  let turnwise = 0;
  for (let i = 0; i < pairs.length; i++) {
    if (
      (await B.m.respondTurnText(conv, pairs[i][0])).response.trim() ===
        pairs[i][1]
    ) turnwise++;
  }
  assert.ok(
    turnwise >= plain,
    `respondTurn scored ${turnwise}/${pairs.length} against respond()'s ${plain}/${pairs.length} — ` +
      `the path that KNOWS the turn boundaries must not lose to the one that does not`,
  );
  assert.equal(
    turnwise,
    pairs.length,
    `respondTurn should answer every trained turn`,
  );
});
