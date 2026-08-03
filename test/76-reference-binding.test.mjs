// 76-reference-binding.test.mjs — REFERENCE: voicing a slot with the
// context's own bytes.
//
// THE GAP THIS CLOSES.  Sema is otherwise a fully GROUND system: every item of
// the deduction system, every matcher and every gate compares ground bytes.
// Nothing represents a POSITION whose occupant comes from the context rather
// than the corpus, so no mechanism can tell
//
//     "the corpus does not explain these bytes"        (PASS — refuse)
//
// apart from
//
//     "these bytes occupy a place the corpus keeps open"   (bind).
//
// Both arrive as unaligned residue.  Asked `How do I compile main.c?` against a
// corpus that knows hello.c / server.c / parser.c, the engine returned SILENCE
// — while the corpus attests, three times over, exactly what to do with a name
// in that slot.
//
// WHY IT IS NOT A SUBSTITUTION.  bridge.ts refuses this shape and is right to:
// `attestedQ` demands the query-side span be corpus-attested, because a
// substitution asserts EQUIVALENCE, and nothing can corroborate an equivalence
// claim about bytes the corpus has never seen.  A reference asserts no
// equivalence.  It asserts POSITION, and the bytes come from the asker, so
// voicing them cannot fabricate corpus knowledge.  The only thing that can be
// fabricated is the RELATION claimed about them — the licence's whole subject.
//
// THE LICENCE, IN ONE BYTE PREDICATE (match.ts carriesFillers).  For two
// instances i, j of one frame:
//
//     substituteAll(cont_i, fillers_i -> fillers_j) == cont_j
//
// If it holds, the corpus attests byte-exactly that the continuation is a
// function of the fillers and nothing else.  No threshold, no similarity, no
// new constant.  Three readings, all pinned below:
//
//   CARRIED    the continuation quotes the fillers  -> splice the referents
//   ABSORBED   the continuation is constant         -> the same test, vacuously
//   REFUSED    the continuation carries filler-DEPENDENT content
//
// THE MEASURED FABRICATION THIS FORBIDS.  On the trained 15.7M-node store,
// `What is the capital of Zamunda?` resonates to a PURE cohort — every one of
// the top 14 hits an instance of `What is the capital of X?` — with an
// unambiguous slot.  Every structural gate passes; only the licence refuses,
// on `replace("Tokyo", "Japan" -> "France") != "Paris"`.  That refusal is the
// only thing between this mechanism and invented capitals, so the FABRICATION
// tests here are not decoration.
//
// THE SLOT IS AN ALIGNMENT GAP, NOT "THE NOVEL PART".  Two readings of novelty
// were measured and both fail as a delimiter:
//   * "positions covered by no stored W-window" only BRACKETS the slot — it is
//     dilated by up to W-1 at each edge (measured: `main.c?` for `main.c`), so
//     splicing it carries the query's punctuation into the answer;
//   * at corpus scale it does not fire at all — at 325,615 contexts every
//     window of `Zamunda` and `flurbish` is already attested somewhere.
// The gap between the query and an instance of its frame IS the varying slot,
// contracted to its core: the mirror of the bridge, which EXPANDS a gap until
// the query side attests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { Precomputed } from "../dist/src/mind/pipeline-mechanism.js";
import { recognise } from "../dist/src/mind/recognition.js";
import { gistOf } from "../dist/src/mind/primitives.js";
import { bindReference } from "../dist/src/mind/mechanisms/reference.js";

const dec = new TextDecoder();
const clean = (b) => dec.decode((b ?? new Uint8Array()).filter((x) => x !== 0));

const mindWith = async (pairs) => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(pairs);
  return m;
};

/** The frame whose continuation QUOTES its filler. */
const CARRIED = [
  ["How do I compile hello.c?", "Run gcc hello.c"],
  ["How do I compile server.c?", "Run gcc server.c"],
  ["How do I compile parser.c?", "Run gcc parser.c"],
];

/** The frame whose continuation is CONSTANT across distinct fillers. */
const ABSORBED = [
  ["What is the type of alpha?", "It is a variable."],
  ["What is the type of beta?", "It is a variable."],
  ["What is the type of delta?", "It is a variable."],
];

/** The frame whose continuation depends on WHICH filler — no licence. */
const FABRICATION = [
  ["What is the capital of France?", "Paris"],
  ["What is the capital of Japan?", "Tokyo"],
  ["What is the capital of Peru?", "Lima"],
];

/** Two slots, both carried. */
const TWO_SLOT = [
  ["Copy alpha.txt to beta.txt please", "cp alpha.txt beta.txt"],
  ["Copy gamma.txt to delta.txt please", "cp gamma.txt delta.txt"],
  ["Copy sigma.txt to omega.txt please", "cp sigma.txt omega.txt"],
];

// ── THE SHARED REPRESENTATION ──────────────────────────────────────────────
//
// The slot notion is machinery, not one mechanism's private reading.  It lives
// on Precomputed, reachable by ANY mechanism, and it reports an INVENTORY
// rather than electing a frame — a slot is a property of a PAIRING, not of the
// query, and committing to one reading in the shared container would push
// whichever consumer asked first onto every other.

test("the frame inventory is shared, and elects nothing", async () => {
  const m = await mindWith(CARRIED);
  const q = new TextEncoder().encode("How do I compile main.c?");
  m.beginResponse(undefined, null);
  try {
    m._edgeGuide = gistOf(m, q);
    const pre = new Precomputed(m, q, recognise(m, q), [], m._edgeGuide);
    const inventory = await pre.frames();

    // It found the frame's instances and reported the SAME slot for each,
    // without picking one — every instance is present, none is marked chosen.
    assert.ok(inventory.length >= 2, "no instances reported");
    for (const inst of inventory) {
      assert.equal(inst.slots.length, 1);
      assert.equal(
        clean(q.subarray(...inst.slots[0])),
        "main",
        "the slot is the varying core, not the bracketed novel run",
      );
      assert.ok(inst.fillers[0].length > 0);
      assert.ok(!("chosen" in inst), "the inventory must not elect");
    }
    // Distinct instances, so a consumer can group them for its own question.
    assert.ok(new Set(inventory.map((i) => i.id)).size === inventory.length);

    // Computed once and shared, not per-consumer.
    assert.equal(await pre.frames(), inventory);
  } finally {
    m.endResponse(q.length);
  }
  await m.store.close();
});

// ── THE NEED ───────────────────────────────────────────────────────────────

test("CARRIED: the asker's name is voiced through the frame's own answer", async () => {
  const m = await mindWith(CARRIED);
  const r = await m.respond("How do I compile main.c?");
  assert.equal(clean(r.bytes).trim(), "Run gcc main.c");
  assert.equal(r.provenance, "reference");
  await m.store.close();
});

test("CARRIED: the answer voices the ASKER's bytes, never the corpus's", async () => {
  // The regression that matters most.  The engine's nearest behaviour on this
  // shape is to voice the CORPUS's filler — a confident misreference, worse
  // than silence.  Measured live on the trained store: `How do you say
  // 'flurbish' in French?` answers "the way to say hello is \"Bonjour\"".
  const m = await mindWith(CARRIED);
  const out = clean((await m.respond("How do I compile main.c?")).bytes);
  assert.match(out, /main\.c/);
  for (const foreign of ["hello", "server", "parser"]) {
    assert.ok(
      !out.includes(foreign),
      `answer named the corpus's filler ${foreign}: ${JSON.stringify(out)}`,
    );
  }
  await m.store.close();
});

test("ABSORBED: a filler-independent answer is licensed by the same test", async () => {
  const m = await mindWith(ABSORBED);
  const r = await m.respond("What is the type of gamma?");
  assert.equal(clean(r.bytes).trim(), "It is a variable.");
  assert.equal(r.provenance, "reference");
  await m.store.close();
});

test("the carriage may be structural, not just a copy", async () => {
  // With the slot contracted to its varying core the filler is the BASENAME,
  // carried to two places in the answer.  Refusing this would refuse evidence
  // the corpus actually holds.
  const m = await mindWith([
    ["How do I compile hello.c?", "Run gcc hello.c -o hello"],
    ["How do I compile server.c?", "Run gcc server.c -o server"],
    ["How do I compile parser.c?", "Run gcc parser.c -o parser"],
  ]);
  const r = await m.respond("How do I compile main.c?");
  assert.equal(clean(r.bytes).trim(), "Run gcc main.c -o main");
  await m.store.close();
});

// ── SEVERAL REFERENTS AT ONCE ──────────────────────────────────────────────
//
// A query may name more than one new thing, and a frame with two slots is not
// two frames.  The licence generalises without weakening because it tests the
// WHOLE substitution at once.

test("TWO referents are bound together", async () => {
  const m = await mindWith(TWO_SLOT);
  const r = await m.respond("Copy input.txt to output.txt please");
  assert.equal(clean(r.bytes).trim(), "cp input.txt output.txt");
  assert.equal(r.provenance, "reference");
  await m.store.close();
});

test("THREE referents, one of them carried to two places", async () => {
  const m = await mindWith([
    [
      "Move alpha.txt from aaaa to bbbb now",
      "mv aaaa/alpha.txt bbbb/alpha.txt",
    ],
    [
      "Move gamma.txt from cccc to dddd now",
      "mv cccc/gamma.txt dddd/gamma.txt",
    ],
    [
      "Move sigma.txt from eeee to ffff now",
      "mv eeee/sigma.txt ffff/sigma.txt",
    ],
  ]);
  const r = await m.respond("Move input.txt from gggg to hhhh now");
  assert.equal(clean(r.bytes).trim(), "mv gggg/input.txt hhhh/input.txt");
  await m.store.close();
});

test("MULTI-SLOT licence: inventing around one slot refuses the whole binding", async () => {
  // The command tracks both fillers, but the warning COUNT tracks neither — it
  // is knowledge about the specific pair, which the store cannot have for a new
  // one.  One slot behaving is not a licence.
  const m = await mindWith([
    ["Compile hello.c with clang please", "clang hello.c gives 3 warnings"],
    ["Compile server.c with rustc please", "rustc server.c gives 7 warnings"],
    ["Compile parser.c with swiftc please", "swiftc parser.c gives 1 warnings"],
  ]);
  const r = await m.respond("Compile main.c with zigcc please");
  assert.notEqual(r.provenance, "reference");
  assert.ok(
    !/\d+ warnings/.test(clean(r.bytes)),
    `invented a warning count: ${JSON.stringify(clean(r.bytes))}`,
  );
  await m.store.close();
});

// ── THE LICENCE: what must NEVER be voiced ─────────────────────────────────

test("FABRICATION: a filler-DEPENDENT answer is refused", async () => {
  const m = await mindWith(FABRICATION);
  const r = await m.respond("What is the capital of Zamunda?");
  const out = clean(r.bytes).trim();
  assert.notEqual(r.provenance, "reference");
  for (const city of ["Paris", "Tokyo", "Lima"]) {
    assert.ok(
      !out.includes(city),
      `invented a capital for a place the corpus never saw: ${
        JSON.stringify(out)
      }`,
    );
  }
  await m.store.close();
});

test("INCONSISTENT CARRIAGE: one instance breaking the pattern refuses all", async () => {
  const m = await mindWith([
    ["How do I compile hello.c?", "Run gcc hello.c -o out"],
    ["How do I compile server.c?", "Run gcc server.c -o server"],
    ["How do I compile parser.c?", "Run gcc parser.c -o parser"],
  ]);
  const r = await m.respond("How do I compile main.c?");
  assert.notEqual(r.provenance, "reference");
  assert.ok(
    !/main\.c -o (main|out|server|parser)/.test(clean(r.bytes)),
    `voiced an unattested carriage: ${JSON.stringify(clean(r.bytes))}`,
  );
  await m.store.close();
});

test("ONE INSTANCE: agreement needs two — a lone exemplar licenses nothing", async () => {
  const m = await mindWith([
    ["How do I compile hello.c?", "Run gcc hello.c"],
    ["What is the capital of France?", "Paris"],
  ]);
  const r = await m.respond("How do I compile main.c?");
  assert.notEqual(r.provenance, "reference");
  await m.store.close();
});

test("the window floor applies PER SLOT, not to the query", async () => {
  // `gcc` / `zig` are three bytes — under one river window, where byte overlap
  // is chance.  The first slot is a good referent; the second is not, and one
  // bad slot refuses the binding rather than being dropped.
  const m = await mindWith([
    ["How do I compile hello.c with gcc?", "Run gcc hello.c"],
    ["How do I compile server.c with tcc?", "Run tcc server.c"],
    ["How do I compile parser.c with zcc?", "Run zcc parser.c"],
  ]);
  const r = await m.respond("How do I compile main.c with zig?");
  assert.notEqual(r.provenance, "reference");
  await m.store.close();
});

test("two slots naming the SAME bytes are ambiguous, not a binding", async () => {
  // Which occurrence in the answer stands for which slot?  Nothing says.
  const m = await mindWith(TWO_SLOT);
  const r = await m.respond("Copy input.txt to input.txt please");
  assert.notEqual(r.provenance, "reference");
  await m.store.close();
});

// ── THE FLOW ───────────────────────────────────────────────────────────────

test("post-grounding does not pivot PAST a binding", async () => {
  // A bound answer is a byte string this mechanism CONSTRUCTED; the corpus
  // never said it, so pivoting through it treats the engine's own construction
  // as a trained fact — and here it also throws the answer away.
  //
  // Measured before `complete`: this answered "then execute ./a.out" — the
  // referent gone AND the question unanswered.
  const m = await mindWith([
    ...CARRIED,
    ["Run gcc main.c", "then execute ./a.out"],
  ]);
  const r = await m.respond("How do I compile main.c?");
  assert.equal(clean(r.bytes).trim(), "Run gcc main.c");
  assert.equal(r.provenance, "reference");
  await m.store.close();
});

test("a referent may not be lifted out of the engine's OWN reply", async () => {
  // Quoting a completed answer back as a referent launders the engine's output
  // into evidence — the same rule the weave applies when it aligns only the
  // asker's stream.  Driven at the guard itself: the same query binds or
  // refuses purely on whether the SLOT falls inside an answered span, so the
  // control proves the refusal is the guard's doing and not an accident.
  const m = await mindWith(CARRIED);
  const q = new TextEncoder().encode("How do I compile main.c?");
  const bind = async (answeredSpans) => {
    m.beginResponse(undefined, null);
    try {
      m._edgeGuide = gistOf(m, q);
      m.answeredSpans = answeredSpans;
      const pre = new Precomputed(m, q, recognise(m, q), [], m._edgeGuide);
      return await bindReference(m, q, pre);
    } finally {
      m.answeredSpans = [];
      m.endResponse(q.length);
    }
  };
  // The slot is "main" at 17-21 (see the inventory test above).
  assert.equal(await bind([[16, 24]]), null, "bound out of its own reply");
  const control = await bind([[0, 4]]);
  assert.ok(control !== null, "the control did not bind");
  assert.equal(clean(control.bytes).trim(), "Run gcc main.c");
  await m.store.close();
});

// ── NO HIJACK ──────────────────────────────────────────────────────────────

test("a trained query is answered by its own edge, not by reference", async () => {
  const m = await mindWith(CARRIED);
  const r = await m.respond("How do I compile server.c?");
  assert.equal(clean(r.bytes).trim(), "Run gcc server.c");
  assert.notEqual(r.provenance, "reference");
  await m.store.close();
});

test("honest silence survives: nothing relates, nothing is bound", async () => {
  const m = await mindWith(CARRIED);
  for (const q of ["xyzzy plugh quux baz?", "qq8f3kz9 vv2m1x7w?"]) {
    const r = await m.respond(q);
    assert.equal(clean(r.bytes).trim(), "", `expected silence for ${q}`);
  }
  await m.store.close();
});

test("the binding is deterministic", async () => {
  const m = await mindWith(CARRIED);
  const a = (await m.respond("How do I compile main.c?")).bytes;
  const b = (await m.respond("How do I compile main.c?")).bytes;
  assert.deepEqual([...a], [...b]);
  await m.store.close();
});

// ── GENERIC: bytes, not text ───────────────────────────────────────────────

test("reference is a BYTE mechanism — no text, no canon, no character class", async () => {
  // The same shape in a modality with no words, no case and no punctuation: a
  // fixed byte frame with a varying region, carried into the reply.  Nothing in
  // the mechanism may consult what a byte MEANS.
  const F = (region) =>
    Uint8Array.from([0x01, 0x02, 0x03, 0x04, ...region, 0xfe, 0xff]);
  const A = (region) => Uint8Array.from([0x10, 0x11, 0x12, 0x13, ...region]);
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest([
    [F([0x41, 0x42, 0x43, 0x44, 0x45]), A([0x41, 0x42, 0x43, 0x44, 0x45])],
    [F([0x51, 0x52, 0x53, 0x54, 0x55]), A([0x51, 0x52, 0x53, 0x54, 0x55])],
    [F([0x61, 0x62, 0x63, 0x64, 0x65]), A([0x61, 0x62, 0x63, 0x64, 0x65])],
  ]);
  const novel = [0x71, 0x72, 0x73, 0x74, 0x75];
  const r = await m.respond(F(novel));
  assert.deepEqual([...r.bytes], [...A(novel)]);
  assert.equal(r.provenance, "reference");
  await m.store.close();
});

// ── OPTIMIZED ──────────────────────────────────────────────────────────────

test("the frame inventory and recall share ONE resonance call", async () => {
  // Precomputed.resonance() is the response's one top-k read.  Before it
  // existed, a query reaching both paid two identical ANN queries.
  const m = new Mind({
    seed: 7,
    store: new SQliteStore({ path: ":memory:" }),
    profile: true,
  });
  await m.ingest(FABRICATION); // refuses, so BOTH mechanisms run to the end
  await m.respond("What is the capital of Zamunda?");
  const phase = m.lastCost.phases["resonance"];
  assert.ok(phase, "the shared resonance phase never ran");
  assert.equal(phase.calls, 1, "the shared resonance ran more than once");
  await m.store.close();
});
