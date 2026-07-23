// mind/index.ts — public surface of the mind module.
//
// Re-exports the Mind class and all public types that were previously
// exported from mind/mind.ts directly.

export { Mind } from "./mind.js";
export type { Input, Response } from "./mind.js";
export type { ComputedSpan, ExtensionHost } from "./mind.js";
export type {
  MechanismResult,
  PipelineMechanism,
  Precomputed,
} from "./pipeline-mechanism.js";
export type {
  InspectRationale,
  RationaleItem,
  RationaleStep,
} from "./rationale.js";
export type {
  AnchorRejectionReason,
  ClimbConsensusData,
  ConsensusAnchorTrace,
  ConsensusReachTrace,
  ConsensusRegionTrace,
  CrossRegionTier,
  JunctionVoteTrace,
  RegionOutcome,
} from "./attention.js";
export type {
  AncestorReach,
  AttentionRead,
  SaturationReason,
  SaturationStop,
} from "./types.js";
