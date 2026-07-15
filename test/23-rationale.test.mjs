// 23-rationale.test.mjs — INFERENCE TRANSPARENCY (invariant I10).
//
// One of sema's defining advantages over a weight matrix is that every answer
// is a DERIVATION over explicit facts — and `inspectRationale` reads that
// derivation out, as it happens, for debugging the engine and for a human to
// follow the reasoning. This file pins the STRUCTURAL CONTRACT of that trace so
// a refactor of the inference path cannot silently break it:
//
//   • a step's ordering is incremental and unique (the `index`);
//   • the dependency graph is sound — every `parent` and every `dependsOn`
//     references an EARLIER, real step (a DAG, no dangling/forward edges);
//   • the nesting is rooted at `respond`, which spans the whole inference and
//     ends with the produced answer;
//   • inputs and outputs are VECTORS, and the fan-out / fan-in is real
//     (recognise decomposes 1 query → N forms; the cover combines N → 1);
//   • the cover's adapted A*LD proof tree surfaces at the finest grain (its reasoning
//     MOVES are emitted), across representative queries — recall, multi-hop,
//     ALU, concept-revoicing;
//   • it is OFF BY DEFAULT — no callback ⇒ not even built, zero observable cost.
//
// The contract is asserted GENERICALLY (shape invariants that must hold for any
// query), so it keeps guarding as the engine evolves — not a brittle snapshot of
// one query's exact steps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// A small test image, mirroring 05-concepts — used to bind a cross-name concept
// halo so the answer gets revoiced in the asker's word (exercises `voice`).
const img = (seed) => {
  const d = new Uint8Array(16);
  for (let i = 0; i < 16; i++) d[i] = (i * 13 + seed * 41) & 0xff;
  return { width: 4, height: 4, channels: 1, data: d };
};

// Collect the full step stream for one query.
async function trace(mind, q) {
  const steps = [];
  const ans = await mind.respondText(q, (s) => steps.push(s));
  return { steps, ans };
}

// The structural invariants every rationale stream must satisfy, asserted on the
// steps in EMISSION order (the order the callback saw them).
function assertWellFormed(steps, label) {
  assert.ok(steps.length > 0, `${label}: expected at least one step`);

  // Steps are EMITTED in completion order (a sub-mechanism finishes, and is
  // reported, before the mechanism that called it), while `index` is assigned in
  // ENTRY order (a parent reserves its index before its children run). So a
  // parent always has a LOWER index than its children, but is emitted LATER.
  // First pass: gather every index and its emission position.
  const byIndex = new Map();
  const emitPos = new Map(); // index → position in the emitted stream
  steps.forEach((s, pos) => {
    assert.ok(Number.isInteger(s.index) && s.index >= 0, `${label}: bad index`);
    assert.ok(!byIndex.has(s.index), `${label}: duplicate index ${s.index}`);
    byIndex.set(s.index, s);
    emitPos.set(s.index, pos);
  });

  for (const s of steps) {
    // — shape —
    assert.ok(
      Array.isArray(s.mechanism) && s.mechanism.length >= 1,
      `${label}: step ${s.index} has no mechanism path`,
    );
    assert.ok(Array.isArray(s.inputs), `${label}: step ${s.index} inputs`);
    assert.ok(Array.isArray(s.outputs), `${label}: step ${s.index} outputs`);
    for (const it of [...s.inputs, ...s.outputs]) {
      assert.equal(
        typeof it.text,
        "string",
        `${label}: step ${s.index} item has no text rendering`,
      );
    }

    // — nesting edge: a parent is entered BEFORE its child, so its index is
    //   strictly lower, and (by entry order) it is a real step. It is emitted
    //   AFTER the child (post-order), so we check the index relation, not order. —
    if (s.parent !== -1) {
      assert.ok(
        byIndex.has(s.parent),
        `${label}: step ${s.index} parent ${s.parent} is not a real step`,
      );
      assert.ok(
        s.parent < s.index,
        `${label}: step ${s.index} parent ${s.parent} is not earlier (by index)`,
      );
    }

    // — data-flow edges: every dependency was ENTERED before this step (lower
    //   index — no forward or self edges, so the graph is a DAG). A dependency
    //   that is NOT the enclosing parent is a genuine PRODUCER — its output
    //   became this step's input — so it also COMPLETED earlier (emitted before).
    //   The parent-as-default-dep of a first sub-step is the one backward-by-index
    //   but emitted-later edge (post-order), and is exempt from the emit check. —
    assert.ok(
      Array.isArray(s.dependsOn),
      `${label}: step ${s.index} dependsOn`,
    );
    for (const d of s.dependsOn) {
      assert.notEqual(
        d,
        s.index,
        `${label}: step ${s.index} depends on itself`,
      );
      assert.ok(
        byIndex.has(d),
        `${label}: step ${s.index} dependsOn ${d} is not a real step`,
      );
      assert.ok(
        d < s.index,
        `${label}: step ${s.index} dependsOn ${d} is not earlier (by index)`,
      );
      if (d !== s.parent) {
        assert.ok(
          emitPos.get(d) < emitPos.get(s.index),
          `${label}: step ${s.index} producer ${d} was not emitted earlier`,
        );
      }
    }
  }

  // — the root: index 0, parentless, mechanism exactly ["respond"], and it ends
  //   with the produced answer (or empty for the degenerate no-answer case). —
  const root = byIndex.get(0);
  assert.ok(root, `${label}: no step 0`);
  assert.deepEqual(
    root.mechanism,
    ["respond"],
    `${label}: root is not respond`,
  );
  assert.equal(root.parent, -1, `${label}: root has a parent`);

  // — every non-root step nests under respond: walking `parent` reaches 0. —
  for (const s of steps) {
    let cur = s;
    let guard = 0;
    while (cur.parent !== -1 && guard++ < 1000) cur = byIndex.get(cur.parent);
    assert.equal(
      cur.index,
      0,
      `${label}: step ${s.index} not rooted at respond`,
    );
  }

  return byIndex;
}

// The set of innermost mechanism names that appeared.
const leafMechanisms = (steps) =>
  new Set(steps.map((s) => s.mechanism[s.mechanism.length - 1]));

test("the rationale stream is a sound, rooted dependency DAG", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([["ice", "ice is frozen water"]]);

  const { steps, ans } = await trace(mind, "ice");
  await store.close();

  assert.equal(ans, "ice is frozen water");
  assertWellFormed(steps, "recall");
});

test("recall traces the cover and its derivation moves", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([["ice", "ice is frozen water"]]);

  const { steps } = await trace(mind, "ice");
  await store.close();

  const mechs = leafMechanisms(steps);
  // The orchestration mechanisms…
  for (const m of ["think", "recognise", "cover", "liftAnswer", "articulate"]) {
    assert.ok(mechs.has(m), `recall: missing mechanism "${m}"`);
  }
  // …and the cover's finest grain: the proof tree's reasoning moves.
  assert.ok(mechs.has("follow-edge"), `recall: no follow-edge derivation move`);
  assert.ok(mechs.has("ground"), `recall: no ground derivation move`);

  // recognise DECOMPOSES: one query in, ≥1 form out.
  const rec = steps.find((s) => s.mechanism.at(-1) === "recognise");
  assert.equal(rec.inputs.length, 1, "recognise should take one query");
  assert.ok(rec.outputs.length >= 1, "recognise should emit forms");
});

test("multi-hop reasoning surfaces the pivot and reason chain", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
  ]);

  const { steps, ans } = await trace(
    mind,
    "What is the capital of France famous for",
  );
  await store.close();

  assert.ok(ans.includes("Eiffel"), `multi-hop did not chain: "${ans}"`);
  const byIndex = assertWellFormed(steps, "multihop");

  const mechs = leafMechanisms(steps);
  // The fallback grounding pipeline + the reasoner that crosses the hop.
  assert.ok(mechs.has("recallByResonance"), "multihop: no recallByResonance");
  assert.ok(mechs.has("reason"), "multihop: no reason scope");
  assert.ok(mechs.has("pivotStep"), "multihop: no pivotStep");

  // The reason scope depends (transitively) on the grounding step that fed it —
  // i.e. its dependency edge is a REAL earlier step, not the previous sibling by
  // accident. We assert the generic soundness here; assertWellFormed already
  // proved every edge is backward and real.
  const reason = steps.find((s) => s.mechanism.at(-1) === "reason");
  for (const d of reason.dependsOn) {
    assert.ok(byIndex.has(d), "multihop: reason depends on a real step");
  }
});

test("ALU computation is traced as recognise + evaluate + cover", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([["ice", "ice is frozen water"]]); // a non-empty store

  const { steps, ans } = await trace(mind, "2+3");
  await store.close();

  assert.equal(ans, "5");
  assertWellFormed(steps, "alu");

  const mechs = leafMechanisms(steps);
  assert.ok(mechs.has("computeExtensions"), "alu: no computeExtensions");
  assert.ok(mechs.has("evalComputation"), "alu: no evalComputation");

  // The cover consumes BOTH recognise and computeExtensions — an EXPLICIT producer edge,
  // not the previous-sibling default. Find the think-level cover and check its
  // deps include the computeExtensions step.
  const compute = steps.find((s) => s.mechanism.at(-1) === "computeExtensions");
  const cover = steps.find((s) =>
    s.mechanism.at(-1) === "cover" && s.mechanism.includes("think")
  );
  assert.ok(cover, "alu: no cover under think");
  assert.ok(
    cover.dependsOn.includes(compute.index),
    `alu: cover ${cover.dependsOn} should depend on computeExtensions ${compute.index}`,
  );
});

test("concept revoicing emits the voice move (the asker's own word)", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  // Two names for one concept (bound by a shared image halo), one fact.
  await mind.ingest([
    ["ice", "ice is frozen water"],
    [img(1), "ice"],
    [img(2), "ice"],
    [img(1), "hielo"],
    [img(2), "hielo"],
  ]);

  const { steps, ans } = await trace(mind, "hielo");
  await store.close();

  assert.equal(ans, "hielo is frozen water");
  assertWellFormed(steps, "voice");

  const mechs = leafMechanisms(steps);
  assert.ok(mechs.has("substitute"), "voice: no substitute step");
  assert.ok(mechs.has("voice"), "voice: no voice derivation move");

  // The substitute step COMBINES: an answer form in, the asker's voice out.
  const sub = steps.find((s) => s.mechanism.at(-1) === "substitute");
  assert.ok(
    sub.inputs.length >= 1 && sub.outputs.length >= 1,
    "voice: substitute should map answer-forms to asker-voices",
  );
});

test("off by default: no callback ⇒ no observable tracing, same answer", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([["ice", "ice is frozen water"]]);

  // No callback at all — the tracer is never built; the answer is identical.
  const plain = await mind.respondText("ice");
  // With a callback that just counts — proves the callback path is what emits.
  let n = 0;
  const traced = await mind.respondText("ice", () => n++);
  await store.close();

  assert.equal(plain, "ice is frozen water");
  assert.equal(traced, plain, "tracing must not change the answer");
  assert.ok(n > 0, "a callback should receive steps");
});

test("a degenerate empty query yields a single rooted respond step", async () => {
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store });
  await mind.ingest([["ice", "ice is frozen water"]]);

  const steps = [];
  const r = await mind.respond("", (s) => steps.push(s));
  await store.close();

  assert.equal(r.v, null, "empty query has no answer");
  // think returns before opening its scope on an empty query, so respond is the
  // sole step — still a well-formed (trivial) graph.
  assert.equal(steps.length, 1, "empty query should emit only respond");
  assert.deepEqual(steps[0].mechanism, ["respond"]);
  assert.equal(steps[0].outputs.length, 0, "no answer ⇒ no output item");
});
