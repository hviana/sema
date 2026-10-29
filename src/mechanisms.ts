// mechanisms.ts — the mechanisms a Mind registers when it is given none.
//
// Every mechanism joins the same way: a factory handed the mind's port
// (`ExtensionHost`) returns a `PipelineMechanism`, and the decider weighs every
// candidate by the query bytes it explains and the moves it took, never by who
// produced it (mechanism-market.md).  This list is that registration, written
// once so a Mind need not repeat it: Sema's own mechanisms, then the ALU, whose
// code lives apart (`src/alu/`) to show that a mechanism can.  A caller adds
// its own the same way: `new Mind({ mechanisms: [...defaultMechanisms, mine] })`.
//
// ORDER is the decider's last tie-break, and the investment discipline's
// incumbent: cover, cast, confluence, extraction, reference, recall, prefix,
// then the ALU.  REFERENCE sits after extraction and before recall because that
// is what its claim is worth: extraction READS a span out of the query,
// reference voices one through a learnt slot, and recall's tiers degrade
// toward echo and silence.  It does not prune recall (its floor is two
// projections, recall's one STEP): both run, share one resonance read, and the
// ladder decides.

import type { MechanismFactory } from "./mind/pipeline-mechanism.js";
import { coverMechanism } from "./mind/mechanisms/cover.js";
import { castMechanism } from "./mind/mechanisms/cast.js";
import { confluenceMechanism } from "./mind/mechanisms/confluence.js";
import { extractionMechanism } from "./mind/mechanisms/extraction.js";
import { referenceMechanism } from "./mind/mechanisms/reference.js";
import { recallMechanism } from "./mind/mechanisms/recall.js";
import { prefixMechanism } from "./mind/mechanisms/prefix-completion.js";
import { aluMechanism } from "./alu/src/index.js";

export const defaultMechanisms: readonly MechanismFactory[] = [
  () => coverMechanism,
  () => castMechanism,
  () => confluenceMechanism,
  () => extractionMechanism,
  () => referenceMechanism,
  () => recallMechanism,
  () => prefixMechanism,
  aluMechanism(),
];
