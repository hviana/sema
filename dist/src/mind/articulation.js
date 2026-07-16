// articulation.ts — re-voice an answer in the asker's wording (Section 5).
//
//   articulate — substitute answer forms with the asker's synonyms,
//                using concept (halo) resonance to match the voices.
import { spliceAll } from "./types.js";
import { recognise } from "./recognition.js";
import { contains } from "./traverse.js";
import { bestHaloMate } from "./match.js";
import { coverSequence } from "../derive/src/index.js";
import { rItem, rNode, traceDerivation } from "./trace.js";
/** Re-voice an answer in the asker's own words.  For each recognised form
 *  in the answer, find a concept-sibling in the query (by halo resonance)
 *  and substitute the asker's wording.  The search's own cover mechanism
 *  splices the substitutes into the answer exactly where the forms sit. */
export async function articulate(ctx, answer, query) {
  if (!query || query.length < 2 || answer.length < 2) {
    return answer;
  }
  const store = ctx.store;
  const t = ctx.trace?.enter("articulate", [
    rItem(answer, "answer"),
    rItem(query, "query"),
  ]);
  const keep = (note) => {
    t?.done([rItem(answer, "answer")], note);
    return answer;
  };
  const qCandidates = [];
  for (const s of recognise(ctx, query).sites) {
    // payload < 0 is a SINGLE-BYTE leaf (byte leaves occupy the implicit
    // negative id range −256…−1 — see store.ts).  A one-byte form's halo is
    // promiscuous (it keeps company with everything it ever neighboured), so
    // admitting it as a voice or a revoicing target lets e.g. the digit "4"
    // be "re-voiced" into an unrelated digit the query happens to contain.
    // Articulation therefore operates on multi-byte forms only.
    if (s.payload < 0) {
      continue;
    }
    const h = store.halo(s.payload);
    if (!h) {
      continue;
    }
    qCandidates.push({
      start: s.start,
      end: s.end,
      payload: {
        halo: h,
        bytes: query.slice(s.start, s.end),
        node: s.payload,
      },
    });
  }
  if (qCandidates.length === 0) {
    return keep("no asker concept to revoice — answer unchanged");
  }
  if (coverSequence(query.length, qCandidates).spans.length === 0) {
    return keep("no asker concept to revoice — answer unchanged");
  }
  const voices = qCandidates.map((s) => s.payload);
  const ans = recognise(ctx, answer);
  const substitutions = new Map();
  for (const s of ans.sites) {
    // Same single-byte-leaf exclusion as the query loop above.
    if (s.payload < 0) {
      continue;
    }
    const h = store.halo(s.payload);
    if (!h) {
      continue;
    }
    const found = bestHaloMate(ctx, h, voices, (v) => v.halo);
    if (!found) {
      continue;
    }
    const voice = found.item;
    if (voice.node === s.payload || contains(ctx, voice.node, s.payload)) {
      continue;
    }
    substitutions.set(s.payload, voice.bytes);
  }
  if (substitutions.size === 0) {
    return keep("no answer form is a synonym of an asker concept");
  }
  ctx.trace?.step(
    "substitute",
    [...substitutions.keys()].map((n) => rNode(ctx, n, "answer-form")),
    [...substitutions.values()].map((b) => rItem(b, "asker-voice")),
    `revoice ${substitutions.size} answer form(s) in the asker's own words (synonym splice)`,
  );
  const voicedSites = ans.sites.filter((s) => substitutions.has(s.payload));
  const tArtCover = ctx.trace?.enter("cover", [
    ...voicedSites.map((s) =>
      rItem(answer.subarray(s.start, s.end), "form", s.payload, [
        s.start,
        s.end,
      ])
    ),
  ]);
  const solved = ctx.search.cover(
    answer.length,
    voicedSites,
    new Map(),
    ans.leaves,
    ans.splits,
    substitutions,
    undefined,
    undefined,
    ctx.trace ? (steps) => traceDerivation(ctx, steps) : undefined,
  );
  const segs = solved && solved.segs;
  tArtCover?.done(
    segs === null
      ? []
      : segs.map((s) =>
        rItem(s.bytes, s.rec ? "voiced" : "kept", s.node, [s.i, s.j])
      ),
    segs === null
      ? "the revoiced cover did not compose"
      : "lightest derivation of the revoiced answer",
  );
  const result = segs && spliceAll(segs);
  if (result) {
    t?.done(
      [rItem(
        result,
        "voiced",
        ctx.store.findLeaf(result.subarray(0, 1)) ?? undefined,
      )],
      "splice the asker's wording into the answer where the same concept appears",
    );
    return result;
  }
  return keep("the revoiced cover did not compose — answer unchanged");
}
