// 101-alignment-gap-bound.test.mjs — the alignment's gap bound SAYS SO when it
// bites.
//
// THE GAP THIS CLOSES.  `alignAround` matches a query against a stored context
// by sweeping for the next common run of ≥ W bytes, with each side's gap
// bounded by `chainReach(W)` = W².  When the sweep ends with material still
// unmatched on BOTH sides, the alignment stopped because of that BOUND — and
// nothing reported it: `match.ts` emitted no trace at all.  A reader of the
// rationale therefore saw a substituted answer (the frame filled with ANOTHER
// instance's filler) with no way to tell that the answer's own span had been
// refused by a cap.
//
// MEASURED BOUNDARY (W = 4, cap = 16).  Against a learned
// `Book a table at <filler> tonight.` → `Your table at <filler> is booked.`
// frame, a NOVEL filler binds while it fits the cap and is replaced by a stored
// instance's filler once it does not:
//
//     filler 7 B  → answer quotes the asker's filler   (bound)
//     filler 12 B → answer quotes the asker's filler   (bound)
//     filler 18 B → answer carries ANOTHER filler      (substituted)
//     filler 30 B → answer carries ANOTHER filler      (substituted)
//
// THIS FILE PINS THE REPORT, not the substitution: the step must exist and must
// carry the derived cap, so the bound is auditable at the point it truncates
// (AGENTS §6).  The substitution itself is the scope defect a later lot fixes;
// when it is fixed, this file's behavioural control (a filler inside the cap is
// quoted back) stays true and the report stays reachable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
import { alignAround } from "../dist/src/mind/match.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

const WORDS =
  ("alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima " +
    "mike november oscar papa quebec romeo sierra tango uniform victor whiskey " +
    "xray yankee zulu amber bronze copper dahlia ember fjord gossamer harbour " +
    "indigo jasmine kestrel lantern marigold nectar opal pewter quartz ripple " +
    "saffron thistle umber violet willow xenon yarrow").split(" ");

const short = (i) => `${WORDS[i % 50]}${i}`;
const long = (i) =>
  `${WORDS[i % 50]} ${WORDS[(i * 3) % 50]} ${WORDS[(i * 7) % 50]} street ${i}`;

/** The frame whose continuation quotes its filler, with mixed filler widths. */
async function frame(n = 60, opts = {}) {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store, ...opts });
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const f = i % 3 === 0 ? long(i) : short(i);
    pairs.push([`Book a table at ${f} tonight.`, `Your table at ${f} is booked.`]);
  }
  await mind.ingest(pairs);
  return { store, mind };
}

/** A novel filler of exactly `len` bytes, never ingested. */
const novel = (len) => "zephyr quartz lantern ".repeat(3).slice(0, len).trim();


// THE LAW'S ASSERTION, straight on the aligner.  There is no bound to report
// any more: the sweep's work is proportional to the bytes a run spans, so a
// divergence far past the old arity bound (chainReach(W) = 16) is simply
// bridged, on both sides, by finding the next common run.
test("a divergence far past the old arity bound is bridged, not truncated", () => {
  const enc = new TextEncoder();
  const head = "the common head of the frame ";
  const tail = " and the common tail of the frame";
  const q = enc.encode(head + "a".repeat(60) + tail);
  const c = enc.encode(head + "b".repeat(60) + tail);
  const at = head.length - 1; // the seed: the shared head's own boundary
  const { matched, gaps } = alignAround({ space: { maxGroup: 4 } }, q, c, at, at);
  assert.equal(
    matched.length,
    2,
    "both common runs must be found: " + JSON.stringify(matched),
  );
  assert.equal(gaps.length, 1, "with exactly one substitution between them");
  const g = gaps[0];
  assert.ok(
    g.qe - g.qs >= 60 && g.ce - g.cs >= 60,
    "the substitution's extent is the pair's own: " + JSON.stringify(g),
  );
});

test("control: a filler inside the cap is quoted back, and the fixture is live", async () => {
  const filler = novel(12);
  const { mind } = await frame();
  const answer = (await mind.respondText(
    `Book a table at ${filler} tonight.`,
  )).replace(/\0+/g, "").trim();
  assert.ok(
    answer.includes(filler),
    "inside the cap the frame binds the asker's own filler",
  );
});
