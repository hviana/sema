// 71-embedded-canon-equivalence.test.mjs — an EMBEDDED trained form must be
// recognised under the response's canonical equivalence, not only byte-exactly.
//
// The contract: `recognise` decomposes a query into stored forms that lead
// somewhere.  A trained form sitting at an interior offset of a larger query is
// found by the scale-gated "exact query-edge forms" tier in recognition.ts.
// That tier admits candidates with a BYTE-EXACT `store.findBranch` probe over
// the query's leaf-id run, then calls the canon-capable `resolveSpan`.  The
// prefilter is therefore strictly narrower than its own resolver: a form whose
// deposit differs from the query only by the response canonicalizer's
// equivalence (case, width) can never reach `resolveSpan`, because a
// differently-cased deposit's branch kid-ids are not the query's leaf-id run
// under ANY canonicalization of the query.  Measured on a 15.7M-node store:
// "Hey, What is the process of photosynthesis?" recognises the trained form,
// "Hey, what is …" recognises nothing, though the lowercased form resolves
// exactly at offset 0.
//
// WHY THE 4.3k-FACT FIXTURE IS NOT OPTIONAL: the tier runs only when
// `atomIsHub(corpusN, W)` is true, i.e. N > ~4096 contexts at maxGroup=4.
// Every small-store suite exercises the OTHER branch of recognition, so a
// conventional fixture would pass while the defect is fully present.  The
// atomIsHub assertion below fails loudly if that crossover ever moves, so this
// test can never silently stop covering the branch it exists for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";
import { recognise } from "../dist/src/mind/recognition.js";
import { resolve } from "../dist/src/mind/primitives.js";
import { corpusN } from "../dist/src/mind/traverse.js";
import { atomIsHub } from "../dist/src/geometry.js";
import { textCanon } from "../dist/src/canon.js";

const enc = (s) => new TextEncoder().encode(s);

// Longer than chainReach(W)=W²=16 bytes, or the tier's own size gate skips it.
const FORM = "Madam Your Glasses Are Fogged";
const PREFIX = "Hey, ";

/** Recognise with the canonicalizer a TEXT response would carry.  `ctx.canon`
 *  is per-response state that `respond()` injects; calling `recognise`
 *  directly would otherwise run with canon disabled and test nothing. */
function recogniseAsText(mind, text) {
  mind.canon = textCanon;
  mind.canonMemo = new Map();
  try {
    return recognise(mind, enc(text));
  } finally {
    mind.canon = null;
    mind.canonMemo = null;
  }
}

const sitesFor = (rec, id) => rec.sites.filter((s) => s.payload === id);

test("an embedded trained form is recognised under canonical equivalence", async () => {
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });

  const filler = [];
  for (let i = 0; i < 4300; i++) filler.push([`filler-${i}`, `f${i}`]);
  await m.ingest(filler);
  await m.ingest([[FORM, "a stored continuation for the form"]]);
  // Canonical resolution reads a store-side index that training builds
  // explicitly (meta `canon.upto`); without it `canonResolve` has no
  // candidates and the equivalence under test does not exist at all.
  await m.buildCanonIndex();

  const N = corpusN(m);
  assert.ok(
    atomIsHub(N, m.space.maxGroup),
    `fixture must cross atomIsHub (N=${N}); the tier under test is ` +
      `scale-gated and this suite would otherwise assert nothing`,
  );

  const formId = resolve(m, enc(FORM));
  assert.ok(formId !== null, "the trained form must resolve exactly");

  // Control 1 — the form standalone, in its deposited case.
  assert.ok(
    sitesFor(recogniseAsText(m, FORM), formId).length > 0,
    "standalone deposited-case form must be recognised",
  );

  // Control 2 — the form standalone, lowercased.  This is what proves the
  // canonical equivalence is REAL and reachable, so the embedded assertion
  // below is about placement, not about the canonicalizer.
  assert.ok(
    sitesFor(recogniseAsText(m, FORM.toLowerCase()), formId).length > 0,
    "lowercased form must resolve to the same node at offset 0",
  );

  // Control 3 — embedded, deposited case.  The tier's byte-exact route.
  assert.ok(
    sitesFor(recogniseAsText(m, PREFIX + FORM), formId).length > 0,
    "embedded deposited-case form must be recognised",
  );

  // THE CONTRACT — embedded AND canonically equivalent.  Controls 2 and 3 each
  // hold, so anything that fails here is the prefilter being narrower than its
  // resolver, which is the defect this test exists to prevent.
  const rec = recogniseAsText(m, PREFIX + FORM.toLowerCase());
  const hit = sitesFor(rec, formId);
  assert.ok(
    hit.length > 0,
    `embedded lowercased form must be recognised: standalone-lowercased and ` +
      `embedded-exact both are, so the byte-exact admission gate is the only ` +
      `thing rejecting it (sites found: ${
        rec.sites.map((s) => `${s.start}-${s.end}`).join(",") || "none"
      })`,
  );
  // It must be found AT its true offset, not as some other coincidental span.
  assert.ok(
    hit.some((s) =>
      s.start === PREFIX.length && s.end === PREFIX.length + FORM.length
    ),
    `the form must be recognised at its own span [${PREFIX.length},${
      PREFIX.length + FORM.length
    }], got ${hit.map((s) => `${s.start}-${s.end}`).join(",")}`,
  );

  await m.store.close();
});

// A FORM THE QUESTION HOLDS ONLY UNDER ITS EQUIVALENCE IS AN ARGUMENT.  The
// climb proposes `Man at Bath` and the canonical question's bytes decide it:
// `Man At Bath` holds the stored form at that span.  Recall's argument binding
// once read it; when that binding was folded into the cover, this reading was
// dropped with it, and the question was answered by another work's fact
// (`Barbizon`, through the scaffolding tier).  The cover now takes the held
// form as a site — the same answer the exact spelling gets.
test("a form held only under the response's equivalence is the cover's site", async () => {
  const pairs = [
    ["Man at Bath", "Man at Bath is a painting by Gustave Caillebotte."],
    [
      "Man at Bath director",
      "The director of Man at Bath is Gustave Caillebotte.",
    ],
    ["The Gleaners", "The Gleaners is a painting by Jean-François Millet."],
    ["Where did the director of film The Gleaners work?", "Barbizon"],
    ["Who painted The Gleaners?", "Jean-François Millet"],
  ];
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(pairs);
  const exact = await m.respond("Who is the director of Man at Bath?");
  const steps = [];
  const held = await m.respond(
    "Who is the director of Man At Bath?",
    (s) => steps.push(s),
  );
  const dec = (b) => new TextDecoder().decode(b);
  assert.equal(held.provenance, "cover");
  assert.equal(dec(held.bytes), dec(exact.bytes));
  assert.ok(!dec(held.bytes).includes("Barbizon"));
  const cover = steps.find((s) => s.mechanism.at(-1) === "cover");
  assert.ok(
    cover.inputs.some((i) => i.role === "form" && i.span?.[0] === 23),
    "the held form enters the cover as a site at its own span",
  );
  await m.store.close();
});

test("a canonical site stands where its member stands, or it is no site", async () => {
  // `father` and the film `Father` are one canonical class (case), and keep
  // company with the same people — but the corpus never stands them in the
  // same place: the film before ` director`, the relation after `the ` and
  // before ` of`.  Read as the film, the question answers the film's fact.
  // Each fact is deposited as the trained store holds it: under the entity
  // alone and under the entity with its relation.
  const facts = [
    ["Father", "director", "The director of Father is Wang Shuo."],
    ["Mother", "director", "The director of Mother is Gleb Panfilov."],
    ["The Paw", "director", "The director of The Paw is Hans Steinhoff."],
    [
      "Ollanta Humala",
      "father",
      "The father of Ollanta Humala is Isaac Humala.",
    ],
    ["Hassan II", "father", "The father of Hassan II is Mohammed V."],
    [
      "Asma of Morocco",
      "father",
      "The father of Asma of Morocco is Hassan II.",
    ],
  ];
  const pairs = facts.flatMap(([x, r, f]) => [[x, f], [`${x} ${r}`, f]]);
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(pairs);
  await m.buildCanonIndex();
  const steps = [];
  const asked = await m.respondText(
    "Who was the father of ollanta humala?",
    (s) => steps.push(s),
  );
  assert.equal(asked, "The father of Ollanta Humala is Isaac Humala.");
  assert.ok(
    steps.some((s) =>
      s.mechanism.at(-1) === "roleRefused" &&
      s.outputs.some((o) => o.text === "Father")
    ),
    "the film is refused as the relation's canonical twin, by its role",
  );
  // The same class read where its member stands is still the member: the
  // entity asked in lower case is the stored entity's site.
  assert.ok(
    !steps.some((s) =>
      s.mechanism.at(-1) === "roleRefused" &&
      s.outputs.some((o) => o.text === "Ollanta Humala")
    ),
    "the entity is no refused twin: it stands where it is stored",
  );
  await m.store.close();
});
