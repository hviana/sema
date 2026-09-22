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
    // The computation is GROUNDED BY COVER: this adapter's `parse` puts the
    // authoritative span into `pre.computed`, cover masks it, and cover's
    // derivation is what carries the answer out — measured, every computed
    // probe reports provenance `cover`. So the adapter declares the core
    // provenance the answer actually has. The ALU's own act is named where it
    // belongs, in the TRACE (`evalComputation`, emitted by its `parse`), not in
    // the provenance: a mechanism may not invent a label outside the pipeline's
    // `Provenance` vocabulary, because post-grounding gates on that vocabulary
    // (see the `provenance` contract in pipeline-mechanism.ts).
    provenance: "cover",
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
