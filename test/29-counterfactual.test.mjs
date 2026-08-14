// 29-counterfactual.test.mjs — COUNTERFACTUAL ANALYSIS AND STRUCTURAL ANALOGY.
//
// Counterfactual reasoning asks "what if X were different?" — substitute one
// element of a known structure for an analog and trace what changes.  It composes
// three capabilities the reasoner does not yet have:
//
//   1. STRUCTURAL ANALOGY — given a form F in context C, find an analog F' that
//      plays the SAME role in a structurally-similar context C'.  Halos already
//      capture distributional roles; the missing piece is validating that the
//      CONTEXTS (not just the forms) are structurally alike.
//
//   2. COUNTERFACTUAL PROJECTION — given an analog F' and a property P
//      associated with F, project what would follow if F' carried P instead of
//      its own property.
//
//   3. ANALOGICAL COMPARISON — given two forms from different domains whose
//      structural roles align, articulate HOW they are alike.
//
// Analysis via Structural Transfer) is implemented in mind.ts.
//
// The tests use only the existing API: respond / respondText.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const mk = (seed = 7) =>
  new Mind({ seed, store: new SQliteStore({ path: ":memory:" }) });
const ask = async (m, q) =>
  (await m.respondText(q)).replace(/\s+/g, " ").trim();

// ═══════════════════════════════════════════════════════════════════════════
// Section A — structural analogy: same role, different filler
// ═══════════════════════════════════════════════════════════════════════════

// A1 — "Steel" and "Ice" both play the role "material with a property" in the
// frame "X is Y".  When asked "What if steel were cold?", the system must:
//   1. Find that "steel" is structurally analogous to "ice" (both appear in
//      "X is Y" frames)
//   2. Substitute "cold" (ice's property) for "hard" (steel's property)
//   3. Answer with what steel would be like if it were cold
//
// Today: the system cannot find structural analogs.  It returns "" (nothing
// resonates cleanly) or "hard" (steel's own property, ignoring the
// counterfactual).  Neither is correct.
test("A1 — find structural analog and substitute property", async () => {
  const m = mk();
  await m.ingest([
    ["Ice is cold", "cold"],
    ["Fire is hot", "hot"],
    ["Steel is hard", "hard"],
    ["Water is wet", "wet"],
  ]);

  const got = await ask(m, "What if steel were cold?");
  // When CAST lands: the answer must reference steel AND a cold-like property
  // (e.g. "steel would be brittle", "steel would feel cold", or similar).
  // Today: returns "" or "hard" — the counterfactual substitution is absent.
  assert.ok(
    /steel/i.test(got) && /cold|brittle|chill/i.test(got),
    `CAST not yet implemented — expected steel+cold, got "${got}"`,
  );
  await m.store.close();
});

// A2 — CROSS-DOMAIN ANALOG BY SHARED STRUCTURAL ROLE.
//
// Michelangelo (sculpture) and Homer (literature) share no distributional
// company at all — nothing in this corpus mentions them together, and halos
// measure company by IDENTITY (see sema.ts's signatures).  What they DO share
// is a learnt FRAME: each is established by a context of the form
// "<work> was <verbed> by <person>."  That frame is the whole structural
// content of "plays the same role", and analogyStrength's frame tier is the
// gate that reads it.
//
// A ROLE IS A PROPERTY OF THE CONTEXT THAT ESTABLISHES A NAME, NEVER OF THE
// NAME'S OWN BYTES — so the tier is read on each analog's establishing
// context, the same reverse context seatOfNode uses to VOICE it.  Measured on
// this corpus: "Michelangelo" against "Homer" reads 0.000, while "The David
// was sculpted by Michelangelo." against "The Iliad was written by Homer."
// reads 0.452.
//
// WHAT THIS TEST DELIBERATELY DOES NOT ASSERT.  It used to ask
// "Michelangelo is to sculpture as who is to literature?" and accept any
// answer matching /Shakespeare|Homer|writer|literature/.  That passed, but
// never through this mechanism: the trace read `analogy strength 0.0000`
// and `no candidate passed the similarity gates — using the best-supported
// structural hub`, and Homer entered the ranked set last of seven, at 0.237,
// through a graded 0.50 near-match on the region "omer" — which shares no
// byte with that query.  The assertion was satisfied by a blind fallback
// landing on a writer.  Selecting an analog in a domain the query NAMES is
// a capability nothing here implements; asserting it while the hub fallback
// happened to satisfy the regex measured luck.  So this test asserts what
// the mechanism actually decides, and reads the decision from the rationale
// rather than from a string the pipeline may reach by other means.
test("A2 — cross-domain analog via shared structural role", async () => {
  // The analogy decision itself: its strength, and whether it was reached on
  // evidence or by the structural-hub fallback (which carries none).
  const analogy = async (m, query) => {
    let strength = -1;
    let fellBack = false;
    await m.respond(new TextEncoder().encode(query), (step) => {
      if (!step.mechanism?.join("/").endsWith("tryAnalog")) return;
      if (/structural hub/.test(step.note ?? "")) fellBack = true;
      const best = /best analog with strength ([0-9.]+)/.exec(step.note ?? "");
      if (best) strength = Number(best[1]);
      if (/no analog candidate passed/.test(step.note ?? "")) strength = 0;
    });
    return { strength, fellBack };
  };

  for (const seed of [7, 1, 42, 99]) {
    const m = mk(seed);
    await m.ingest([
      // painting exemplars
      ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
      ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
      [
        "The Night Watch was painted by Rembrandt van Rijn.",
        "Rembrandt van Rijn",
      ],
      // sculpture exemplars
      ["The David was sculpted by Michelangelo.", "Michelangelo"],
      ["The Thinker was sculpted by Auguste Rodin.", "Auguste Rodin"],
      // writing exemplars
      ["Hamlet was written by William Shakespeare.", "William Shakespeare"],
      ["The Odyssey was written by Homer.", "Homer"],
      ["Macbeth was written by William Shakespeare.", "William Shakespeare"],
      ["The Iliad was written by Homer.", "Homer"],
      // domain facts — each artist grounded in their field
      ["Leonardo da Vinci", "Leonardo was a Renaissance painter"],
      ["Michelangelo", "Michelangelo was a sculptor and painter"],
      ["William Shakespeare", "Shakespeare was an English playwright"],
      ["Homer", "Homer was an ancient Greek poet"],
      // CONTROL DOMAIN — established by a genuinely different frame
      // ("<substance> melts at <temperature>."), so it shares no role with
      // the artists.  Without it, "strength > 0" would be unfalsifiable.
      [
        "Mercury melts at minus thirty nine degrees.",
        "minus thirty nine degrees",
      ],
      ["Tungsten melts at three thousand degrees.", "three thousand degrees"],
      ["Mercury", "Mercury is a liquid metal"],
    ]);

    // Different domains, same role: the gate must fire, ON EVIDENCE.
    const role = await analogy(m, "How is Michelangelo like Homer?");
    assert.ok(
      !role.fellBack,
      `seed ${seed}: the analogy fell back to the structural hub, which ` +
        `carries no similarity evidence at all — this test would then be ` +
        `measuring the fallback's arbitrary pick, not the shared-role gate.`,
    );
    assert.ok(
      role.strength > 0,
      `seed ${seed}: expected shared-frame evidence between the contexts ` +
        `establishing Michelangelo and Homer ("...was sculpted by..." and ` +
        `"...was written by..."), got strength ${role.strength}.`,
    );

    // Different domains, DIFFERENT role: the same gate must stay silent.
    // This is what makes the assertion above falsifiable — a gate that fired
    // on everything would pass it while measuring nothing.
    const none = await analogy(m, "How is Michelangelo like Mercury?");
    assert.equal(
      none.strength,
      0,
      `seed ${seed}: "Mercury" is established by a different frame entirely ` +
        `("...melts at..."), so it shares no structural role with a sculptor` +
        ` — the gate must read 0, got ${none.strength}.`,
    );

    await m.store.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Section B — counterfactual projection: what changes under substitution?
// ═══════════════════════════════════════════════════════════════════════════

// B1 — The graph knows:
//   • Ice → cold, Fire → hot, Steel → hard  (properties)
//   • "If ice were hot, it would melt"       (a counterfactual relation)
// Query: "What if steel were hot?"
// Correct: steel is analog to ice (both materials), hot substitutes for hard,
//   the counterfactual relation projects: steel would melt.
//
// Today: the system cannot do this.  It returns "" or "hard" or "melt" (the
//   last by accident — whole-query resonance on "were hot" → the ice fact,
//   ignoring steel).
test("B1 — project counterfactual outcome through analog substitution", async () => {
  const m = mk();
  await m.ingest([
    ["Ice is cold", "cold"],
    ["Fire is hot", "hot"],
    ["Steel is hard", "hard"],
    ["If ice were hot, it would melt", "melt"],
  ]);

  const got = await ask(m, "What if steel were hot?");
  // When CAST lands: the answer must mention steel AND the projected outcome
  // (melt, soften, etc.).
  assert.ok(
    /steel/i.test(got) && /melt|soften|liquid/i.test(got),
    `CAST not yet implemented — expected steel+melt, got "${got}"`,
  );
  await m.store.close();
});

// B2 — Counterfactual in a multi-hop chain.  The graph knows:
//   • Extraction skill: "X was painted by Y → Y" (3 exemplars)
//   • Picasso → co-founded Cubism (downstream fact)
//   • Michelangelo → painted Sistine Chapel (downstream fact for the
//     counterfactual substitute)
// Baseline (works today): "The Weeping Woman was painted by Pablo Picasso."
//   → "Pablo Picasso co-founded the Cubist movement"
// Counterfactual: "What if The Weeping Woman had been painted by
//   Michelangelo?" — must substitute Michelangelo for Picasso and return
//   Michelangelo's fact, not Picasso's.
//
// Today: the counterfactual query either returns Picasso's fact (no
//   substitution), or a jumble of exemplar names + Michelangelo's fact
//   (the climb finds the exemplars but cannot redirect the hop).
test("B2 — counterfactual substitution redirects the downstream hop", async () => {
  const m = mk();
  await m.ingest([
    ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
    ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
    [
      "The Night Watch was painted by Rembrandt van Rijn.",
      "Rembrandt van Rijn",
    ],
    ["Pablo Picasso", "Pablo Picasso co-founded the Cubist movement"],
    ["Michelangelo", "Michelangelo painted the Sistine Chapel ceiling"],
  ]);

  // Baseline must work first (extraction + hop, same as the demo).
  const baseline = await ask(
    m,
    "The Weeping Woman was painted by Pablo Picasso.",
  );
  assert.ok(
    baseline.includes("Cubist"),
    `baseline extraction+hop failed — got "${baseline}"`,
  );

  // Counterfactual: substitute Michelangelo for Picasso.
  const got = await ask(
    m,
    "What if The Weeping Woman had been painted by Michelangelo?",
  );
  // When CAST lands: must carry Michelangelo's fact AND NOT Picasso's fact
  // AND NOT the exemplar painters' names.  Clean substitution.
  assert.ok(
    /Sistine/i.test(got) &&
      !/Cubist/i.test(got) &&
      !/Leonardo|van Gogh|Rembrandt/i.test(got),
    `CAST not yet implemented — expected clean Michelangelo substitution, got "${got}"`,
  );
  await m.store.close();
});

// B3 — The system must DISTINGUISH "What is X?" from "What if X were Y?".
// The counterfactual framing changes the answer.  When the graph knows facts
// about both the original and the substitute, the counterfactual must follow
// the substitute, not the original.
//
// Today: "What if the capital of France were Lyon?" returns the Paris fact
//   (or both Paris and Rome facts jumbled together).  The word "if" is just
//   bytes; no mechanism interprets it as a substitution directive.
test("B3 — counterfactual framing is distinguished from factual recall", async () => {
  const m = mk();
  await m.ingest([
    ["what is the capital of France?", "Paris is the capital of France"],
    ["what is the capital of Italy?", "Rome is the capital of Italy"],
    ["Lyon is a city in France", "Lyon is known for its cuisine"],
  ]);

  // Factual baseline.
  assert.ok(
    (await ask(m, "what is the capital of France?")).includes("Paris"),
  );

  // Counterfactual: substitute Lyon for Paris.
  const got = await ask(m, "what if the capital of France were Lyon?");
  // When CAST lands: must talk about LYON (the substitute), not Paris.
  assert.ok(
    /Lyon/i.test(got) && !/Paris/i.test(got),
    `CAST not yet implemented — expected Lyon (not Paris), got "${got}"`,
  );
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Section C — analogical comparison: "how is X like Y?"
// ═══════════════════════════════════════════════════════════════════════════

// C1 — Comparing two forms across domains by their shared structural role.
// "How is ice like steel?" — both are materials that appear in "X is Y"
// frames.  The answer must identify the shared structure, not just list
// individual properties and not just echo the query words.
//
// Today: returns "ice like steel?" (an echo) or "" or "cold"/"hard"
//   individually.  No comparison.
test("C1 — analogical comparison identifies shared structure", async () => {
  const m = mk();
  await m.ingest([
    ["Ice is cold", "cold"],
    ["Steel is hard", "hard"],
    ["Fire is hot", "hot"],
  ]);

  const got = await ask(m, "How is ice like steel?");
  // When CAST lands: must say something about WHY they are alike — both ARE
  // something (share the "X is Y" structure).  Must not be empty, must not
  // just echo the query, must not be just a single property.
  assert.ok(
    got.length > 0 &&
      got !== "ice like steel" &&
      got !== "ice like steel?" &&
      !/^(cold|hard|hot)$/i.test(got),
    `CAST not yet implemented — expected a comparison, got "${got}"`,
  );
  await m.store.close();
});

// C2 — Cross-domain comparison.  "How is Shakespeare like Leonardo da Vinci?"
// Both are creators in their domains (writer, painter).  The answer must
// identify the shared ROLE without confusing the domains or listing
// individual biographies.
//
// Enough exemplars on both sides give the halos mass to detect the shared
// creator role across painting, sculpture, and writing.
test("C2 — cross-domain comparison identifies shared role", async () => {
  const m = mk();
  await m.ingest([
    // painting exemplars
    ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
    ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
    [
      "The Night Watch was painted by Rembrandt van Rijn.",
      "Rembrandt van Rijn",
    ],
    ["The Last Supper was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
    ["The Scream was painted by Edvard Munch.", "Edvard Munch"],
    [
      "The Girl with a Pearl Earring was painted by Johannes Vermeer.",
      "Johannes Vermeer",
    ],
    // sculpture exemplars
    ["The David was sculpted by Michelangelo.", "Michelangelo"],
    ["The Thinker was sculpted by Auguste Rodin.", "Auguste Rodin"],
    ["The Pietà was sculpted by Michelangelo.", "Michelangelo"],
    ["The Gates of Hell were sculpted by Auguste Rodin.", "Auguste Rodin"],
    // writing exemplars
    ["Hamlet was written by William Shakespeare.", "William Shakespeare"],
    ["The Odyssey was written by Homer.", "Homer"],
    ["Macbeth was written by William Shakespeare.", "William Shakespeare"],
    ["The Iliad was written by Homer.", "Homer"],
    ["King Lear was written by William Shakespeare.", "William Shakespeare"],
    [
      "The Hymn to Demeter was written by Homer.",
      "Homer",
    ],
    // domain facts
    ["Leonardo da Vinci", "Leonardo was a Renaissance polymath"],
    ["William Shakespeare", "Shakespeare wrote 39 plays"],
    ["Michelangelo", "Michelangelo was a sculptor and painter"],
    ["Homer", "Homer was an ancient Greek poet"],
  ]);

  const got = await ask(m, "How is Shakespeare like Leonardo da Vinci?");
  // When CAST lands: must articulate the shared role (both created works in
  // their domains), not just dump one person's biography.
  assert.ok(
    got.length > 0 &&
      !/39 plays/i.test(got) &&
      !/Renaissance polymath/i.test(got),
    `CAST not yet implemented — expected shared-role comparison, got "${got}"`,
  );
  await m.store.close();
});

// C3 — CAST's terminal treatment must not be a blanket rule.  A comparison's
// seat sentence can itself contain a further pivotable term with its OWN
// downstream fact ("Mona Lisa" inside "The Mona Lisa was painted by Leonardo
// da Vinci" leads on to "Mona Lisa hangs in the Louvre") — a genuine further
// hop distinct from Leonardo/Shakespeare's own biographies, which C2 pins
// must NEVER surface.  Proven end-to-end through respond/ask, the real
// public surface: the composed comparison must carry BOTH the shared-role
// comparison AND the Louvre fact, and still never leak either analog's own
// biography.
test("C3 — a further hop inside a comparison's seat still fires", async () => {
  const m = mk();
  await m.ingest([
    ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
    ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
    [
      "The Night Watch was painted by Rembrandt van Rijn.",
      "Rembrandt van Rijn",
    ],
    ["The David was sculpted by Michelangelo.", "Michelangelo"],
    ["The Thinker was sculpted by Auguste Rodin.", "Auguste Rodin"],
    ["Hamlet was written by William Shakespeare.", "William Shakespeare"],
    ["The Odyssey was written by Homer.", "Homer"],
    ["Macbeth was written by William Shakespeare.", "William Shakespeare"],
    ["The Iliad was written by Homer.", "Homer"],
    ["Leonardo da Vinci", "Leonardo was a Renaissance polymath"],
    ["William Shakespeare", "Shakespeare wrote 39 plays"],
    // the further hop: a term INSIDE the seat sentence, not the analog itself
    ["Mona Lisa", "Mona Lisa hangs in the Louvre"],
  ]);

  const got = await ask(m, "How is Shakespeare like Leonardo da Vinci?");
  assert.ok(
    /Louvre/i.test(got),
    `a genuine further hop inside the comparison's seat did not fire — got "${got}"`,
  );
  assert.ok(
    !/39 plays/i.test(got) && !/Renaissance polymath/i.test(got),
    `the analogs' own biographies must stay untouched — got "${got}"`,
  );
  await m.store.close();
});

// C4 — A CAST analog can be referenced INDIRECTLY, by a synonym/concept
// (halo) link, not just by its own literal node id.  "Il Divino" is
// concept-merged with "Michelangelo" (three shared contexts give the halos
// mass); Michelangelo's own fact happens to mention the nickname by name.
// Redirecting to Michelangelo must stay terminal on the SYNONYM too — never
// hopping from "Il Divino" (inside the substitute's own fact) into "Il
// Divino"'s unrelated nickname trivia, the same class of leak C2 pins for
// the literal analog name.
test("C4 — a synonym of a CAST analog is protected the same as the analog itself", async () => {
  const m = mk();
  await m.ingest([
    ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
    ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
    [
      "The Night Watch was painted by Rembrandt van Rijn.",
      "Rembrandt van Rijn",
    ],
    ["Pablo Picasso", "Pablo Picasso co-founded the Cubist movement"],
    ["Michelangelo", "Il Divino painted the Sistine Chapel ceiling"],
    // concept-merge "Michelangelo" with "Il Divino" via three shared contexts
    ["a nickname meaning the divine one", "Michelangelo"],
    ["a nickname meaning the divine one", "Il Divino"],
    ["also called", "Michelangelo"],
    ["also called", "Il Divino"],
    ["known as", "Michelangelo"],
    ["known as", "Il Divino"],
    // "Il Divino"'s own further fact — must NOT leak via the synonym link
    ["Il Divino", "Il Divino was a nickname coined by his contemporaries"],
  ]);

  const baseline = await ask(
    m,
    "The Weeping Woman was painted by Pablo Picasso.",
  );
  assert.ok(
    baseline.includes("Cubist"),
    `baseline extraction+hop failed — got "${baseline}"`,
  );

  const got = await ask(
    m,
    "What if The Weeping Woman had been painted by Michelangelo?",
  );
  assert.ok(
    /Sistine/i.test(got),
    `the substitution itself must still fire — got "${got}"`,
  );
  assert.ok(
    !/nickname coined by his contemporaries/i.test(got),
    `the analog's SYNONYM must stay unconsumed-but-untouched too — got "${got}"`,
  );
  await m.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Section D — graded alignment and site-aware consensus climb
// ═══════════════════════════════════════════════════════════════════════════
//
// D1 verifies the SITE-REGIONS fix: the consensus climb now uses recognised
// sites as additional voting regions, so words crossing W-boundaries (which
// perceived sub-regions split into non-resonant chunks) can still vote for
// their containing contexts.  Without this fix, the climb sees only W-byte
// fragments; with it, the full word "frigid" votes for contexts that contain
// it, enabling CAST to find a weave across diverse anchors.
//
// Three template facts share the same structure ("X is Y so X is Z") but
// differ in the Y-property word.  The query uses a Y-word ("frigid") that IS
// literally in one anchor but NOT in another — the weave forms because the
// climb now sees anchors from BOTH the subject and predicate domains via the
// recognised site, and CAST's graded alignment bridges the gap where literal
// coverage is absent for a given anchor.

test("D1 — site-aware climb finds diverse anchors for CAST weave", async () => {
  const m = mk(7);
  await m.ingest([
    ["ice is cold so ice is brittle", "brittle"],
    ["steel is hard so steel is strong", "strong"],
    ["water is frigid so water is freezing", "freezing"],
  ]);

  // "steel is frigid" — "frigid" literally aligns with water/frigid
  // context but NOT with ice/cold.  The site-regions fix lets the climb
  // vote with the full word "frigid" (which perception splits at W=4).
  // CAST substitution fires: the deepest displaced seat wins.
  const r = await m.respond("steel is frigid");
  assert.equal(r.provenance, "cast", `CAST must fire — got ${r.provenance}`);
  const got = await ask(m, "steel is frigid");
  // The substitution transfers "steel" into the displaced property
  // seat.  The deepest seat is "frigid" in the water context, whose
  // continuation is "freezing".
  assert.ok(
    /freezing/i.test(got),
    `expected property transfer containing "freezing", got "${got}"`,
  );
  await m.store.close();
});

// D2 asserted `provenance === "cast"` — a PROXY, and it hid the very thing this
// test is named for.  The climb here elects between two anchors whose votes sit
// 0.54σ–1.04σ apart, i.e. inside the estimator's own resolution: `steel is hard
// so steel is strong` scores 0.897–1.013 depending on the seed while `water is
// frigid so water is freezing` holds ~0.983, so the TOP FLIPS on 6 of 24 seeds
// (measured; the SD tracks 1/√D and the flip rate collapses 19/60 → 12/60 →
// 2/60 as D goes 256 → 1024 → 4096).  CAST voiced the runner-up regardless of
// which anchor the climb had committed, so the proxy stayed green while the
// climb was demonstrably seed-dependent.  See `test/87-codominant-commitment`.
//
// The strong form asserts the property in the title: every seed must produce
// the SAME OUTCOME — same provenance and same bytes.  Uniformity alone is not
// enough (all seeds could agree on a wrong answer), so correctness is asserted
// too: the property transfer must still land on "freezing" via CAST.
//
// The seed set deliberately includes 1, 8, 18, 20, 22 and 23 — the seeds whose
// noise puts the OTHER anchor on top.  A seed set that never flips would not
// exercise the defect at all.
test("D2 — site-aware climb is seed-independent", async () => {
  const outcomes = new Map();
  for (const seed of [1, 7, 8, 18, 20, 22, 23, 42, 99]) {
    const m = mk(seed);
    await m.ingest([
      ["ice is cold so ice is brittle", "brittle"],
      ["steel is hard so steel is strong", "strong"],
      ["water is frigid so water is freezing", "freezing"],
    ]);
    const r = await m.respond("steel is frigid");
    const text = new TextDecoder().decode(r.bytes ?? new Uint8Array());
    outcomes.set(seed, `${r.provenance}|${text}`);
    await m.store.close();
  }
  const distinct = new Set(outcomes.values());
  assert.equal(
    distinct.size,
    1,
    `the outcome depends on the seed — ${
      [...outcomes].map(([s, o]) => `seed ${s}: ${JSON.stringify(o)}`).join(
        "; ",
      )
    }`,
  );
  const [only] = distinct;
  assert.ok(
    only.startsWith("cast|"),
    `seed-independent, but not through CAST: ${JSON.stringify(only)}`,
  );
  assert.ok(
    /freezing/i.test(only),
    `seed-independent, but the property transfer was lost: ${
      JSON.stringify(only)
    }`,
  );
});
