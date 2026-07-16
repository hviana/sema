/** A half-open byte span of a query an extension computed, and the canonical
 *  result bytes it is authoritative for. */
export interface ComputedSpan {
    i: number;
    j: number;
    bytes: Uint8Array;
}
/** The generic capabilities the mind lends every extension — nothing here
 *  names any particular extension, and every member is machinery the mind
 *  already has:
 *
 *  MEANING (resonance and grounding — the same mechanisms recall uses):
 *   • meaningOf — which of some labelled forms does a span mean?  Pure gist
 *     nearness; the extension supplies its own vocabulary and gives the answer
 *     its own reading.
 *   • continuation — the grounded form the corpus continues a form to (the
 *     continuation fixpoint recall grounds answers with), or null when the
 *     form leads nowhere.  The mind answers only "where does this form lead?";
 *     what that continuation MEANS is the extension's business.
 *
 *  GEOMETRY (the perception tree's own structure):
 *   • segment — coherent runs by the alphabet-space merge the perception tree
 *     uses, so an extension's notion of "separator" is the learnt geometry's.
 *   • reach — the river's grouping capacity (maxGroup), bounding how far apart
 *     two spans may sit and still be read as one construction. */
export interface ExtensionHost {
    meaningOf(bytes: Uint8Array, anchors: ReadonlyArray<{
        name: string;
        form: Uint8Array;
    }>): Promise<string | null>;
    continuation(bytes: Uint8Array): Promise<Uint8Array | null>;
    segment(bytes: Uint8Array): Array<{
        i: number;
        j: number;
    }>;
    reach: number;
}
