// 103-alignment-gap-budget.test.mjs — a learned frame's slot is bounded by the
// PAIR, not by the write side's arity; the WORK is bounded by a declared budget.
//
// THE GAP THIS CLOSES.  `alignAround` bounded each side's gap by
// `chainReach(W)` = W².  A learnt frame whose slot is longer than that could not
// be aligned, so the frame binding produced no candidate and a cheaper
// mechanism answered instead — measured on a
// `Book a table at <filler> tonight.` → `Your table at <filler> is booked.`
// frame: at 18, 24, 30 and 36 bytes `bindReference` reported the cap and the
// answer came back carrying ANOTHER instance's filler ("bravo1").
//
// Bounding the work instead is the fix, and the two questions are genuinely
// different: the gap's LENGTH is how far the two byte strings actually diverge
// (a fact about the pair), while the WORK is how many (queryGap, contextGap)
// pairs the sweep examines, which is what a cost bound must limit — reaching a
// gap of size G costs about G²/2 pairs, so a length bound is a work bound only
// by accident, and at the wrong scale.
//
// WHAT IS PINNED: the asker's OWN filler comes back.  The old defect used to be
// reproduced by injecting a tiny budget; that knob is gone because there is no
// budget any more — the sweep indexes the context's windows and walks the
// query's, so its work is proportional to the bytes a run spans and its reach is
// the bytes' own.  There is nothing to make artificially small, and nothing that
// silently drops a far continuation:
//
//     filler 18/20/24 B   → the asker's own filler   (the pair's own extent spans it)
//
// Beyond what the frame's own instances can span (measured: from ~30 bytes) a
// DIFFERENT cause takes over — the frame inventory drops to a single instance,
// and the licence correctly refuses to voice from one exemplar.  That is the
// reference mechanism's own gate, not this bound, and it is not asserted here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mind } from "../dist/src/index.js";
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

/** A frame whose continuation quotes its filler, plus the Mind options. */
async function frame(opts = {}, n = 60) {
  const store = new SQliteStore({ path: ":memory:", D: 1024 });
  const mind = new Mind({ seed: 7, store, ...opts });
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const f = i % 3 === 0 ? long(i) : short(i);
    pairs.push([
      `Book a table at ${f} tonight.`,
      `Your table at ${f} is booked.`,
    ]);
  }
  await mind.ingest(pairs);
  return { store, mind };
}

/** A novel filler of exactly `len` bytes, never ingested. */
const novel = (len) => "zephyr quartz lantern ".repeat(4).slice(0, len).trim();

const answer = async (mind, filler) =>
  (await mind.respondText(`Book a table at ${filler} tonight.`))
    .replace(/\0+/g, "").trim();

test("the default budget spans it, and the answer quotes the ASKER's filler", async () => {
  const filler = novel(24);
  const { mind } = await frame();
  const got = await answer(mind, filler);
  assert.ok(
    got.includes(filler),
    "the pair's own extent must be reachable: the asker's bytes, not the corpus's",
  );
});

test("an 18-byte slot is spanned too — the boundary moved off W²", async () => {
  const { mind } = await frame();
  for (const len of [18, 20, 24]) {
    const filler = novel(len);
    const got = await answer(mind, filler);
    assert.ok(got.includes(filler), `${len} B must be spanned`);
  }
});
