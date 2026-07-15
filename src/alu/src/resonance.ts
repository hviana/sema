// resonance.ts — ALU's window onto meaning, and how the host pre-resolves it.
//
// ALU computes on bytes of any modality, but WHICH operation a byte span invokes
// — and what the opposite of a symbol is — are questions of MEANING, and only
// resonance can read meaning from an opaque span.  Two behaviours need it, and
// BOTH are generic (any operation, any modality), not special cases:
//
//   • operation recognition — the operation a query asks for is, in general, NOT
//     literally spelled.  "2+2" carries a "+", but "the integral of …", "the
//     limit as …", "the derivative of …", or the analogous request expressed as
//     an image / audio gesture carry NO operator symbol at all.  The operation
//     must be recognised from the span's GIST resonating with the operation's
//     CONCEPT.  This is the primary, generic recognition path; the literal
//     symbol scan (alu.ts `scan`) is merely the easy special case layered under
//     it.  Recognition is by gist, so it is modality-agnostic: a "+" drawn, a
//     "plus" spoken, and the byte "+" all resonate toward the same `add`
//     concept.
//
//   • the polymorphic inverse — the opposite of a SYMBOL (the bytes of a learnt
//     form, any modality) is its RESONANT opposite, found in the resonance
//     space, not by arithmetic.  The inverse of a number is its negation; the
//     inverse of a form is its antonym/complement.
//
// Both are ASYNC in SEMA (they hit the gist / halo index), but the
// lightest-derivation search is SYNCHRONOUS.  So — exactly as src/mind/pipeline.ts hoists
// concept hops and connectors into Maps before the search and reads them
// synchronously inside the rules — ALU splits each capability in two:
//
//   AluResonance (async)  — what the HOST implements over its resonance index.
//                           Called only during pre-resolution.
//   ResonanceSync (sync)  — the pre-resolved snapshot the op callbacks / rules
//                           read (ResonanceSync is declared in operation.ts).
//
// {@link prefetchOpposites} and {@link prefetchRecognisedOps} turn the async side
// into synchronous lookups for a known set of spans; the host calls them during
// its pre-resolution pass.  This file is the ENTIRE coupling surface to SEMA —
// ALU imports nothing from the mind or store; the host supplies a AluResonance
// built over its own perception + resonance (gist nearness to the operation
// vocabulary ALU exposes via `conceptForms`, and halo resonance for the
// opposite).

import type { ResonanceSync } from "./operation.js";

/** A labelled concept form: the canonical operation name and one of its
 *  surface forms, as bytes.  The host resonates opaque spans against these to
 *  answer "which operation does this span MEAN?" (see parser.ts AluHost). */
export interface ConceptAnchor {
  name: string;
  form: Uint8Array;
}
import { latin1 } from "../../bytes.js";

/** The async resonance capability the host provides.  Both methods may return
 *  null when resonance finds nothing above the host's own threshold — ALU then
 *  declines to guess (operation unrecognised, inverse left unchanged).  This
 *  keeps synthesis graph-evidenced: ALU never invents meaning resonance did not
 *  supply. */
export interface AluResonance {
  /** The canonical operation a span's MEANING names, found by resonance over the
   *  operation concepts — the GENERIC, modality-agnostic recognition path.  This
   *  is how an operation that is NOT literally spelled (no "∫" for an integral,
   *  no "+" for a sum drawn or spoken) is still recognised: the span's gist
   *  resonates with the operation's concept.  Returns the canonical op name, or
   *  null when nothing resonates above threshold. */
  recogniseOp(bytes: Uint8Array): Promise<string | null>;
  /** The resonant opposite of a symbol's bytes (its antonym / inverse in the
   *  resonance space, any modality), or null.  The host finds it by halo
   *  resonance over the negated concept. */
  opposite(bytes: Uint8Array): Promise<Uint8Array | null>;
}

/** A AluResonance that knows nothing — the default when the host wires none in,
 *  so the kernel runs fully decoupled (operations resolve by literal forms only,
 *  and a symbol inverse is left unchanged). */
export const NO_ALU_RESONANCE: AluResonance = {
  recogniseOp: async () => null,
  opposite: async () => null,
};

/** Pre-resolve the resonant opposite of each symbol in `symbols`, awaiting the
 *  host's async resonance once per distinct span, and return a SYNCHRONOUS
 *  snapshot the op callbacks read during the search.  Keyed by the latin1 view
 *  of the bytes (a lossless, stable string key — the same device the search's
 *  chart uses).  This is the async→sync bridge for the polymorphic inverse,
 *  mirroring how a concept hop's target is pre-resolved and read synchronously. */
export async function prefetchOpposites(
  resonance: AluResonance,
  symbols: Iterable<Uint8Array>,
): Promise<ResonanceSync> {
  const table = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  for (const bytes of symbols) {
    const key = latin1(bytes);
    if (seen.has(key)) continue;
    seen.add(key);
    const opp = await resonance.opposite(bytes);
    if (opp) table.set(key, opp);
  }
  return {
    opposite: (bytes: Uint8Array) => table.get(latin1(bytes)) ?? null,
    // Opposites-only prefetch carries no op recognition; a higher-order nd op
    // resolving through this falls back to literal forms / canonical names.
    recogniseOp: () => null,
  };
}

/** Pre-resolve BOTH capabilities a computation may need synchronously — the
 *  resonant opposite of a symbol (for the polymorphic inverse) AND the operation
 *  a symbol's MEANING names (for a higher-order nd op's function argument) — over
 *  one set of candidate spans, and return a single {@link ResonanceSync}.  Each
 *  distinct span is awaited once per capability.  This is the unified async→sync
 *  bridge the host uses for an nd computation, where the same spans may serve as
 *  inverse operands and as a reduce/map/filter operator.  Either lookup yields
 *  null for a span that resonates with nothing, so callbacks decline rather than
 *  guess. */
export async function prefetchResonance(
  resonance: AluResonance,
  spans: Iterable<Uint8Array>,
): Promise<ResonanceSync> {
  const opposites = new Map<string, Uint8Array>();
  const ops = new Map<string, string>();
  const seen = new Set<string>();
  for (const bytes of spans) {
    const key = latin1(bytes);
    if (seen.has(key)) continue;
    seen.add(key);
    const [opp, op] = await Promise.all([
      resonance.opposite(bytes),
      resonance.recogniseOp(bytes),
    ]);
    if (opp) opposites.set(key, opp);
    if (op) ops.set(key, op);
  }
  return {
    opposite: (bytes: Uint8Array) => opposites.get(latin1(bytes)) ?? null,
    recogniseOp: (bytes: Uint8Array) => ops.get(latin1(bytes)) ?? null,
  };
}

/** Pre-resolve, for each candidate span, the operation its MEANING names —
 *  awaiting the host's async gist resonance once per distinct span — and return
 *  a synchronous map keyed by the span's latin1 bytes → canonical op name.  This
 *  is the async→sync bridge for the GENERIC operation-recognition path: a span
 *  the literal scan could not classify (no operator symbol) but whose gist
 *  resonates with an operation's concept.  Spans that resonate with nothing are
 *  omitted, so the caller treats a miss as "not an operation". */
export async function prefetchRecognisedOps(
  resonance: AluResonance,
  spans: Iterable<Uint8Array>,
): Promise<Map<string, string>> {
  const table = new Map<string, string>();
  const seen = new Set<string>();
  for (const bytes of spans) {
    const key = latin1(bytes);
    if (seen.has(key)) continue;
    seen.add(key);
    const op = await resonance.recogniseOp(bytes);
    if (op) table.set(key, op);
  }
  return table;
}
