// mechanisms/cover.ts — Cover (Grounding II): the query's own decomposition
// composes an answer through ONE lightest-derivation search.
//
// Cover is the composition (composition.ts) over recognition alone: its axioms
// are the query's own decomposition, and it reads nothing another mechanism
// produced.

import { twoQuanta } from "../../geometry.js";
import {
  asksAbsentRelation,
  canonHeldPoints,
  subjectOfSeveral,
} from "../traverse.js";
import { canonSites, compose, coverSites } from "../composition.js";
import type { PipelineMechanism } from "../pipeline-mechanism.js";

export const coverMechanism: PipelineMechanism = {
  name: "cover",
  provenance: "cover",
  async floor(_ctx, _query, _pre, _worthRunning) {
    return 0;
  },
  // What the climb's points add to a cover read before them, beyond the
  // instances' relations every pick reads: a site the question holds under
  // its equivalence (`canonSites`), on the sites the run itself stands on.
  readsPoints(ctx, query, pre) {
    // A site refused before the points — a subject of several questions, or
    // one asked a relation it lacks — may be named by its use once they are
    // shown (traverse.ts, `subjectOfSeveral`, `asksAbsentRelation`).
    if (
      pre.rec.sites.some((s) =>
        subjectOfSeveral(ctx, s.payload) || asksAbsentRelation(ctx, s.payload)
      )
    ) {
      return true;
    }
    if (canonHeldPoints(ctx, twoQuanta(ctx.space.maxGroup)).length === 0) {
      return false;
    }
    return canonSites(ctx, query, coverSites(ctx, query, pre, false)).length >
      0;
  },
  run: (ctx, query, pre) => compose(ctx, query, pre),
};
