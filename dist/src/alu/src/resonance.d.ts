import type { ResonanceSync } from "./operation.js";
/** A labelled concept form: the canonical operation name and one of its
 *  surface forms, as bytes.  The host resonates opaque spans against these to
 *  answer "which operation does this span MEAN?" (see parser.ts AluHost). */
export interface ConceptAnchor {
    name: string;
    form: Uint8Array;
}
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
export declare const NO_ALU_RESONANCE: AluResonance;
/** Pre-resolve the resonant opposite of each symbol in `symbols`, awaiting the
 *  host's async resonance once per distinct span, and return a SYNCHRONOUS
 *  snapshot the op callbacks read during the search.  Keyed by the latin1 view
 *  of the bytes (a lossless, stable string key — the same device the search's
 *  chart uses).  This is the async→sync bridge for the polymorphic inverse,
 *  mirroring how a concept hop's target is pre-resolved and read synchronously. */
export declare function prefetchOpposites(resonance: AluResonance, symbols: Iterable<Uint8Array>): Promise<ResonanceSync>;
/** Pre-resolve BOTH capabilities a computation may need synchronously — the
 *  resonant opposite of a symbol (for the polymorphic inverse) AND the operation
 *  a symbol's MEANING names (for a higher-order nd op's function argument) — over
 *  one set of candidate spans, and return a single {@link ResonanceSync}.  Each
 *  distinct span is awaited once per capability.  This is the unified async→sync
 *  bridge the host uses for an nd computation, where the same spans may serve as
 *  inverse operands and as a reduce/map/filter operator.  Either lookup yields
 *  null for a span that resonates with nothing, so callbacks decline rather than
 *  guess. */
export declare function prefetchResonance(resonance: AluResonance, spans: Iterable<Uint8Array>): Promise<ResonanceSync>;
/** Pre-resolve, for each candidate span, the operation its MEANING names —
 *  awaiting the host's async gist resonance once per distinct span — and return
 *  a synchronous map keyed by the span's latin1 bytes → canonical op name.  This
 *  is the async→sync bridge for the GENERIC operation-recognition path: a span
 *  the literal scan could not classify (no operator symbol) but whose gist
 *  resonates with an operation's concept.  Spans that resonate with nothing are
 *  omitted, so the caller treats a miss as "not an operation". */
export declare function prefetchRecognisedOps(resonance: AluResonance, spans: Iterable<Uint8Array>): Promise<Map<string, string>>;
