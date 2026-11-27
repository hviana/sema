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

test("a role refutes a canonical site only where the corpus writes its class otherwise", async () => {
  // `Manuel Of Castile` is written by nothing but as `Manuel of Castile`: the
  // class has one spelling, so one use.  The question frames it as no deposit
  // does (`Where did ·'s father die?` against `The father of · is`), and that
  // is only the question's wording — there is no other thing for the span to be.
  // On 130 held-out 2Wiki questions 46 of 48 role refusals were of this kind.
  const facts = [
    ["Father", "director", "The director of Father is Wang Shuo."],
    [
      "Manuel of Castile",
      "father",
      "The father of Manuel of Castile is Ferdinand III of Castile.",
    ],
    [
      "Ollanta Humala",
      "father",
      "The father of Ollanta Humala is Isaac Humala.",
    ],
    ["Hassan II", "father", "The father of Hassan II is Mohammed V."],
    [
      "Manuel of Castile",
      "place of birth",
      "The place of birth of Manuel of Castile is Carrión de los Condes.",
    ],
    [
      "Ferdinand III of Castile",
      "place of death",
      "The place of death of Ferdinand III of Castile is Seville.",
    ],
  ];
  const pairs = facts.flatMap(([x, r, f]) => [[x, f], [`${x} ${r}`, f]]);
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(pairs);
  await m.buildCanonIndex();
  const steps = [];
  const asked = await m.respondText(
    "Where did Manuel Of Castile's father die?",
    (s) => steps.push(s),
  );
  const of = (name, member) =>
    steps.some((s) =>
      s.mechanism.at(-1) === name && s.outputs.some((o) => o.text === member)
    );
  assert.ok(
    of("roleKept", "Manuel of Castile"),
    "the role disagreed, and the class is written in no other spelling",
  );
  assert.ok(!of("roleRefused", "Manuel of Castile"));
  assert.equal(
    asked,
    "The father of Manuel of Castile is Ferdinand III of Castile.",
  );
  // The relation `father` IS written otherwise than the film `Father`: its
  // refusal stands (the test above), here too.
  assert.ok(of("roleRefused", "Father"));
  await m.store.close();
});

test("a role agrees only where every side it is read on agrees", async () => {
  // `Mother` the film is also written inside `the Motherland`, so the bytes
  // stand after `the ` exactly where the relation does; only the right side
  // (` of ` against ` director`, `land`) tells them apart.  One generic side
  // agreeing is no agreement, and the frame words that say what a span is are
  // never dropped as common.
  const facts = [
    ["Mother", "director", "The director of Mother is Gleb Panfilov."],
    [
      "She Defends the Motherland",
      "director",
      "The director of She Defends the Motherland is Fridrikh Ermler.",
    ],
    [
      "Calling the Motherland",
      "director",
      "The director of Calling the Motherland is Ivan Pyryev.",
    ],
    [
      "Rothesay Castle",
      "director",
      "The director of Rothesay Castle is Bruce Mann.",
    ],
    ["Henry I", "mother", "The mother of Henry I is Matilda of Flanders."],
    ["Bertha", "mother", "The mother of Bertha is Waldrada."],
    [
      "Robert Jocelyn",
      "mother",
      "The mother of Robert Jocelyn is Charlotte Bligh.",
    ],
  ];
  const pairs = facts.flatMap(([x, r, f]) => [[x, f], [`${x} ${r}`, f]]);
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  await m.ingest(pairs);
  await m.buildCanonIndex();
  const steps = [];
  const asked = await m.respondText(
    "Who is the mother of robert jocelyn?",
    (s) => steps.push(s),
  );
  assert.equal(asked, "The mother of Robert Jocelyn is Charlotte Bligh.");
  const film = m.resolve(new TextEncoder().encode("Mother"));
  assert.ok(film !== null);
  assert.ok(
    !steps.some((s) =>
      s.mechanism.at(-1) === "recognise" &&
      s.outputs.some((o) => o.text === "mother" && o.node === film)
    ),
    "the film is no site of the relation",
  );
  await m.store.close();
});

test("the asker's wording that holds a form under the equivalence is no re-voicing of it", async () => {
  // Articulation splices the asker's wording over an answer form it is a
  // synonym of — never where that wording already HOLDS the form.  The bytes
  // decide that, and they were read raw: `ashoka country of citizenship`
  // does not hold `Ashoka`, so the whole question was spliced over the name
  // (`The country of citizenship of ashoka country of citizenship is …`, one
  // lowercased key of the trained store's gate).  The wording is read as the
  // response reads it, under its equivalence.
  const m = new Mind({ seed: 7, store: new SQliteStore({ path: ":memory:" }) });
  for (
    const [entity, value] of [
      ["Ashoka", "Maurya dynasty"],
      ["Kanishka", "Kushan Empire"],
      ["Harsha", "Pushyabhuti dynasty"],
    ]
  ) {
    const fact = `The country of citizenship of ${entity} is ${value}.`;
    await m.ingest(entity, fact);
    await m.ingest(`${entity} country of citizenship`, fact);
  }
  await m.buildCanonIndex();
  const exact = await m.respondText("Ashoka country of citizenship");
  assert.equal(
    exact,
    "The country of citizenship of Ashoka is Maurya dynasty.",
  );
  assert.equal(await m.respondText("ashoka country of citizenship"), exact);
  await m.store.close();
});
