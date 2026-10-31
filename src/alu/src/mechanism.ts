// mechanism.ts — the ALU as a grounding mechanism, the way any code outside a
// host joins it.
//
// A host that weighs answers by the query bytes they explain lends the ALU its
// port (resonance, geometry, and the price of one move) and asks two things: a
// bound no answer of the ALU's can undercut (`floor`), and the answers
// (`run`).  Each answer is a computed span: the result bytes, the query span
// they explain, and one move.  The shape is spelled here, structurally — the
// ALU imports nothing from its host, and its answers compete with every other
// mechanism's on the host's own terms: no precedence, no reading of what
// another mechanism found.

import { Alu, type AluOptions } from "./alu.js";
import type { AluHost, ComputedSpan } from "./parser.js";

/** The port a mechanism host lends: the ALU's own {@link AluHost} plus the
 *  price of one move on the host's cost scale. */
export interface MechanismHost extends AluHost {
  readonly step: number;
}

/** One answer: the result bytes, the query spans they explain, the work, and
 *  that it is a piece — a function of its span's bytes alone. */
export interface MechanismAnswer {
  bytes: Uint8Array;
  accounted: Array<[number, number]>;
  moves: number;
  piece: true;
}

/** A factory for the ALU's mechanism under a host.  The mechanism keeps its
 *  {@link Alu} on `alu`, for a caller that computes through it directly. */
export function aluMechanism(opts: AluOptions = {}) {
  return (host: MechanismHost) => {
    const alu = new Alu(opts, host);
    // The floor and the run read one parse of one question: kept with the
    // host's per-response analyses (`pre`), never across responses — a parse
    // reads the host's resonance, which a deposit between two questions moves.
    const parses = new WeakMap<object, Promise<ComputedSpan[]>>();
    const spansOf = (
      pre: unknown,
      query: Uint8Array,
    ): Promise<ComputedSpan[]> => {
      if (typeof pre !== "object" || pre === null) return alu.parse(query);
      let spans = parses.get(pre);
      if (spans === undefined) parses.set(pre, spans = alu.parse(query));
      return spans;
    };
    return {
      name: "alu",
      provenance: "alu",
      alu,
      /** One move is the least any computed answer costs.  When the
       *  incumbent already stands at that grade, the parse — a resonance
       *  probe per term — could not change the decision: the bound is
       *  returned unparsed (the host's investment discipline). */
      async floor(
        _ctx: unknown,
        query: Uint8Array,
        pre: unknown,
        worthRunning: (floor: number) => boolean,
      ): Promise<number | null> {
        if (!worthRunning(host.step)) return host.step;
        return (await spansOf(pre, query)).length > 0 ? host.step : null;
      },
      async run(
        _ctx: unknown,
        query: Uint8Array,
        pre?: unknown,
      ): Promise<MechanismAnswer[]> {
        return (await spansOf(pre, query)).map((u) => ({
          bytes: u.bytes,
          accounted: [[u.i, u.j]],
          moves: host.step,
          piece: true as const,
        }));
      },
    };
  };
}
