import type { MindContext } from "./types.js";
import { type AlignGap } from "./match.js";
/** One accepted substitution: query span [qs,qe) stands in for the
 *  candidate context's span — recorded for the rationale trace.  The same
 *  shape the shared aligner reports a disagreement as ({@link AlignGap}); an
 *  accepted substitution is a gap that cleared this file's gates. */
type Substitution = AlignGap;
/** A bridged grounding proposal: the trained context to ground, the query
 *  spans its alignment accounts for, and the substitutions that closed it. */
export interface BridgeHit {
    id: number;
    accounted: Array<[number, number]>;
    subs: Substitution[];
}
/** True when some query byte-range left UNACCOUNTED by `spans` contains a
 *  STORED window — content the store has seen that the proposed reading
 *  simply ignores.  The IGNORED-KNOWN principle: a span may be dismissed
 *  only when the store itself has never seen it; known content the
 *  alignment failed to account for is grounds for refusal, while genuinely
 *  novel spans (an untrained word, stray punctuation) remain tolerable.
 *  Shared by the substitution bridge's own acceptance and CAST's
 *  frame-tier comparison gate (cast.ts).  Pure attestation — no
 *  similarity, no constants. */
export declare function dismissedKnownContent(ctx: MindContext, query: Uint8Array, spans: ReadonlyArray<readonly [number, number]>): boolean;
/** Recall's corroborated-substitution bridge — see the module comment.
 *  Returns the best bridged grounding proposal, or null. */
/** `proposed` is a THUNK, not a list: the bridge's own cheap gates (the
 *  two-quantum query floor and the O(|query|) stored-window anchor scan)
 *  decide whether ANY candidate can be aligned, and they need no proposals
 *  to do it.  Resolving the caller's proposals eagerly meant recall paid its
 *  exhaustive whole-index resonance — the most expensive single act on the
 *  refusal path — for every query, including the ones whose windows the
 *  store has never seen and which the anchor scan rejects outright.  Same
 *  investment discipline the mechanism floors follow (AGENTS §2.6): never
 *  compute a shared analysis just to discard it. */
export declare function substitutionBridge(ctx: MindContext, query: Uint8Array, proposed?: () => Promise<ReadonlyArray<number>>): Promise<BridgeHit | null>;
export {};
