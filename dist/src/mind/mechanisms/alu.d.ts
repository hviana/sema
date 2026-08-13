import type { Alu } from "../../alu/src/alu.js";
import type { PipelineMechanism } from "../pipeline-mechanism.js";
/** Wrap the ALU as a {@link PipelineMechanism}. */
export declare function aluToMechanism(alu: Alu): PipelineMechanism;
