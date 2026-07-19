// mechanisms/alu.ts — the ALU wrapped as an ordinary PipelineMechanism.
//
// The ALU is a self-contained sublibrary (src/alu) that knows nothing about
// the pipeline; this adapter is the whole coupling.  Its `parse` populates
// `pre.computed` before the grounding loop; the cover mechanism handles
// masking (see mechanisms/cover.ts).  The ALU's own trace steps
// (`evalComputation`) are emitted inside its `parse()`.  A user extension
// joins the same way — see MindOptions.mechanismFactories.

import type { Alu } from "../../alu/src/alu.js";
import { STEP } from "../graph-search.js";
import { unexplainedLabel } from "../rationale.js";
import type { PipelineMechanism } from "../pipeline-mechanism.js";

/** Wrap the ALU as a {@link PipelineMechanism}. */
export function aluToMechanism(alu: Alu): PipelineMechanism {
  return {
    name: "alu",
    // Not a cover derivation: cover.ts composes an answer by walking
    // recognised query STRUCTURE; the ALU evaluates a recognised expression
    // to its authoritative result and hands the bytes back untouched. It
    // shares cover's near-zero floor (computation always wins, masked into
    // cover's own search — see mechanisms/cover.ts), but the candidate this
    // produces is not one of cover's derivations, so it carries its own
    // honest label, the same way extract/cast/recall each carry theirs.
    provenance: "alu",
    parse: (query) => alu.parse(query),
    async floor(_ctx, _query, pre, _worthRunning) {
      return pre.computed.length > 0 ? 0 : null;
    },
    async run(_ctx, query, pre) {
      return pre.computed.map((u) => ({
        bytes: u.bytes,
        accounted: [[u.i, u.j]],
        moves: STEP,
        unexplained: unexplainedLabel(query, [[u.i, u.j]]),
      }));
    },
  };
}
