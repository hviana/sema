import { Vec } from "../vec.js";
import { Sema, Space } from "../sema.js";
import { Alphabet } from "../alphabet.js";
import { Grid } from "../geometry.js";
import { BoundedMap, type Store } from "../store.js";
import { type MindConfig } from "../config.js";
import { type Canon } from "../canon.js";
import { GraphSearch, type Leaf, type Site } from "./graph-search.js";
import type { ComputedSpan, ExtensionHost } from "../extension.js";
export type { ComputedSpan, ExtensionHost };
import { type InspectRationale, Rationale } from "./rationale.js";
export type { InspectRationale, RationaleItem, RationaleStep, } from "./rationale.js";
export type Input = string | Uint8Array | Grid | Grid[];
export interface Response {
    v: Vec | null;
    bytes: Uint8Array;
    /** How the answer was grounded (see {@link Provenance}).  `"recall-echo"`
     *  marks the last-resort fallback that returned the nearest stored form's
     *  own bytes verbatim — an echo, NOT a grounded fact.  Absent when there is
     *  no answer. */
    provenance?: import("./pipeline.js").Provenance;
}
/** Serializable state of a conversation — can be saved and restored across
 *  sessions.  The Mind never interprets the bytes; it only tracks their
 *  cumulative lengths so the caller can reconstruct turn boundaries later
 *  without inspecting content. */
export interface ConversationState {
    /** The accumulated context bytes — raw concatenation of every turn's
     *  bytes in order.  No separator is inserted; the boundary offsets
     *  ({@link boundaries}) tell the caller where each turn ends. */
    context: Uint8Array;
    /** Cumulative byte length after each completed turn.  Sorted, strictly
     *  increasing, each {@code < context.length}.  The first turn's length
     *  is `boundaries[0]`; the second turn starts at that offset, and so
     *  on.  Empty for a single-turn or new conversation. */
    boundaries: number[];
    /** Byte spans occupied by replies produced by this Mind. Unlike boundary
     *  parity, this remains exact when a turn receives an empty reply. Optional
     *  so states saved before the field existed remain restorable. */
    answeredSpans?: Array<[number, number]>;
}
/** An active conversation handle.  Opaque — interact through the Mind's
 *  conversation methods ({@link Mind.beginConversation},
 *  {@link Mind.respondTurn}, {@link Mind.endConversation}). */
export interface Conversation {
    readonly id: number;
}
import type { AttentionRead, MindContext, Recognition } from "./types.js";
export type { AnchorRejectionReason, ClimbConsensusData, ConsensusAnchorTrace, ConsensusReachTrace, ConsensusRegionTrace, CrossRegionTier, JunctionVoteTrace, RegionOutcome, } from "./attention.js";
export type { AncestorReach, SaturationReason, SaturationStop, } from "./types.js";
import { type CostReport, Meter } from "../meter.js";
export interface MindOptions {
    seed?: number;
    recallQueryK?: number;
    haloQueryK?: number;
    normalizeEpsilon?: number;
    cosineEpsilon?: number;
    geometry?: Partial<import("../config.js").GeometryConfig>;
    alphabet?: Partial<import("../config.js").AlphabetConfig>;
    storeConfig?: Partial<import("../config.js").StoreConfig>;
    store?: Store;
    /** Additional grounding mechanisms (appended after the built-in defaults). */
    mechanisms?: import("./pipeline-mechanism.js").PipelineMechanism[];
    /** Factories that receive the {@link ExtensionHost} and return mechanisms. */
    mechanismFactories?: ((host: import("../extension.js").ExtensionHost) => import("./pipeline-mechanism.js").PipelineMechanism)[];
    /** Measure the computational usage of every inference call — see
     *  src/meter.ts.  Off by default and free when off (one null check per
     *  store read); on, each `respond`/`respondTurn` leaves a {@link
     *  Mind.lastCost} report behind.  Counters are deterministic, so two runs
     *  of the same query on the same store are diffable; the millisecond
     *  fields are not.  Profiling NEVER changes an answer — but note that
     *  attaching a RATIONALE does (traced responses bypass the ctx memos,
     *  AGENTS §2.11), so profile without a trace. */
    profile?: boolean;
    /** Content canonicalizer applied to EVERY response (any modality) for
     *  equivalence-class resolution — see src/canon.ts.  Text entry points
     *  ({@link Mind.respondText}, {@link Mind.respondTurnText}) inject the
     *  Unicode text canonicalizer automatically when this is unset; pass
     *  `false` to disable canonical resolution everywhere. */
    canon?: Canon | false;
}
export declare class Mind implements MindContext {
    readonly space: Space;
    readonly alphabet: Alphabet;
    readonly store: Store;
    readonly cfg: MindConfig;
    /** The lightest-derivation engine over the Sema graph. */
    readonly search: GraphSearch;
    /** The grounding mechanisms iterated by {@link think}. */
    readonly mechanisms: import("./pipeline-mechanism.js").PipelineMechanism[];
    /** The live rationale tracer for the inference currently in flight, or null. */
    trace: Rationale | null;
    /** The content canonicalizer for the response in flight — see
     *  {@link MindContext.canon}.  Injected per response by the modality entry
     *  point; null when the response carries no equivalence. */
    canon: Canon | null;
    /** Per-response canonical-resolution memo — see {@link MindContext.canonMemo}. */
    canonMemo: Map<string, number | null> | null;
    /** The Mind-level canon option: a canonicalizer to use for EVERY response,
     *  `false` to disable canonical resolution, or null to let each entry
     *  point decide (text entry points inject {@link textCanon}). */
    private _canonOpt;
    /** The work accumulator for the inference call in flight — see
     *  {@link MindContext.meter}.  Non-null only between beginResponse and
     *  endResponse, and only when the Mind was constructed with
     *  `{ profile: true }`. */
    meter: Meter | null;
    /** Whether {@link MindOptions.profile} was set. */
    private _profile;
    /** The computational-usage report of the LAST completed inference call, or
     *  null when profiling is off (or nothing has been asked yet).  Overwritten
     *  by every `respond`/`respondTurn`; copy it if you are aggregating.  See
     *  {@link import("../meter.js").CostReport} and `sumReports`/`formatReport`
     *  for battery-level aggregation. */
    lastCost: CostReport | null;
    /** Memo of the consensus climb — content-keyed.  See {@link MindContext.climbMemo}. */
    climbMemo: Map<string, Map<string, AttentionRead>> | null;
    _structMemoKey: object;
    /** Memo of recognise() — content-keyed.  See {@link MindContext.recogniseMemo}. */
    recogniseMemo: Map<string, Recognition> | null;
    /** Memo of perceive() — content-keyed.  See {@link MindContext.perceiveMemo}. */
    perceiveMemo: Map<string, import("../sema.js").Sema> | null;
    /** Subtree-resolution cache.  See {@link MindContext._resolvedSubtrees}. */
    _resolvedSubtrees: WeakMap<import("../sema.js").Sema, {
        id: number;
        len: number;
    }> | null;
    answeredSpans: ReadonlyArray<readonly [number, number]>;
    currentTurnStart: number;
    /** The perceived gist of the query currently being answered.  Set by `think`
     *  before the graph search runs; `chooseNext` consults it as a gate (a null
     *  guide means no query is in flight, so structural walkers keep plain
     *  first-edge behaviour) and the reverse projection uses it for
     *  reverse-recall disambiguation via `chooseAmong`. */
    _edgeGuide: Vec | null;
    /** Per-response memo of {@link chooseNext} picks — ensures every mechanism
     *  of a single response follows the SAME continuation for each ambiguous
     *  context node. */
    _edgeChoice: Map<number, number>;
    /** Previous deposit's seen node ids for incremental change detection. */
    _prevSeen: Set<number> | null;
    /** Session cache of node-id → perceived gist for candidate scoring — see
     *  {@link MindContext._gistCache}.  32 MB ≈ 8K gists at D=1024; hub
     *  candidate sets (√N at most) fit comfortably and recur across queries. */
    _gistCache: BoundedMap<number, Vec>;
    _depositTrees: BoundedMap<string, import("./types.js").DepositCacheEntry>;
    _depositLens: Set<number>;
    _internIds: WeakMap<import("../sema.js").Sema, number>;
    private _nextConvId;
    private _conversations;
    /** Canonical node id of a byte span.  Required by GraphSearchHost & MindContext. */
    resolve(bytes: Uint8Array): number | null;
    recogniseSpan(bytes: Uint8Array): {
        sites: ReadonlyArray<Site>;
        leaves: ReadonlyArray<Leaf>;
        splits: ReadonlySet<number>;
        starts: ReadonlySet<number>;
    };
    /** Disambiguate among multiple learnt continuations of the same context node.
     *  Required by {@link GraphSearchHost} — the graph search calls this through the
     *  host interface when a recognised form has more than one outgoing edge.
     *  Delegates to the standalone {@link chooseNext} which picks the candidate
     *  with the most distributional evidence (highest `prevOf` count — the
     *  structural manifestation of its halo).  When evidence is equal the
     *  first-inserted edge wins. */
    chooseNext(node: number): number | undefined;
    constructor(opts?: MindOptions);
    constructor(cfg: MindConfig, store: Store, _fromStore: true);
    /** Exposed for tests: the consensus climb over query sub-regions. */
    climbAttention(query: Uint8Array, k: number, mode?: import("./types.js").DFMode): Promise<import("./types.js").Attention[]>;
    /** Exposed for tests: climb the structural DAG from a node to its
     *  edge-bearing ancestor contexts. */
    edgeAncestors(id: number, contextCount: number): import("./types.js").AncestorReach;
    /** Exposed for tests: find the natural break point in a sorted vote list. */
    naturalBreak(votes: number[]): number;
    /** Perceive input into a content-defined tree.  Deterministic — identical
     *  bytes always produce an identical tree.  Public for ingest-cache. */
    perceive(input: Input, leafAt?: (i: number) => number | null, lookup?: (ids: number[]) => number | null): Sema;
    /** Open one response's transient state — the tracer, the per-response
     *  memos, the work meter.  The ONE place this state is created, and it
     *  serves BOTH entry points: `respond` takes fresh per-response memos,
     *  `respondTurn` passes its conversation, whose memos persist across turns
     *  (content-keyed, so the previous turn's results are found by this turn's
     *  sub-span calls) and whose `resolvedSubtrees` spares foldTree the store
     *  probes for every prefix subtree — and, for walks that pass no visitor,
     *  the descent as well.  respondTurn used to inline its own copy of this
     *  and of {@link endResponse}; the two drifted (a memo added to one was
     *  silently absent from the other), so there is exactly one pair now. */
    private beginResponse;
    /** Open (or leave closed) the response's work accumulator.  Separate from
     *  {@link beginResponse} because {@link respondTurn} keeps its own
     *  conversation-scoped lifecycle and must not create fresh per-response
     *  memos — but it DOES meter, through this same pair. */
    private _beginMeter;
    /** Close the accumulator and publish its report.  Detaching from the store
     *  matters: a Mind that shares a store with another Mind must not keep
     *  charging that store's reads to a finished response. */
    private _endMeter;
    /** The canonicalizer a response should carry: the Mind-level option when
     *  set (or none when explicitly disabled), else the entry point's own
     *  default — text entry points pass {@link textCanon}, binary ones null. */
    private _canonFor;
    /** Close one response's transient state — every per-response field, incl.
     *  the edge guide/choices `think` sets mid-flight, and the meter's report.
     *
     *  A conversation's memo MAPS were mutated in place, so `data.*` still
     *  points at them and there is nothing to save back.  Clearing the Mind's
     *  references is what matters: a concurrently-started `respond()` swaps its
     *  own fresh maps into these pointers, and copying back from them here
     *  would inject a foreign response's memos into the conversation. */
    private endResponse;
    /** Shared response core — the one path from bytes to voiced answer.
     *  `respond` calls this directly; `respondTurn` has its own path
     *  with conversation-persistent memos and incremental perception. */
    private _respondImpl;
    /** The ONE path from query bytes to a voiced answer: ground (think), then
     *  re-voice in the asker's words (articulate).  Both entry points run
     *  exactly this — they differ only in the LIFECYCLE around it (fresh
     *  per-response memos vs. a conversation's persistent ones) and in what
     *  they do with the answer afterwards.  It must be called between
     *  {@link beginResponse} and {@link endResponse}. */
    private _groundAndVoice;
    /** Answer ONE self-contained input.
     *
     *  A MULTI-TURN context is not that, and this is the wrong entry point for
     *  it.  `respond` folds the bytes it is handed with no boundary set, because
     *  nothing in a flat byte string says where one turn ended — only the caller
     *  who assembled it knows, which is the whole reason `boundaries` is a
     *  parameter of {@link perceiveImpl} and never inferred from content.  A
     *  conversation deposited through {@link ingest} folds its contexts over
     *  those turn boundaries, so a hand-concatenated transcript passed here
     *  folds differently from the way it was learnt and reaches the trained
     *  context node only by luck (measured on a 7-turn conversation: 5/7 here
     *  against 7/7 through {@link respondTurn}, same bytes).  Use
     *  {@link beginConversation} + {@link respondTurn}, or {@link addTurn} to
     *  replay turns the Mind should hear but not answer. */
    respond(input: Input, inspectRationale?: InspectRationale): Promise<Response>;
    /** Text view of {@link respond}.  NUL bytes (0x00) are stripped before
     *  decoding — they are structural padding in text answers.  LOSSY for a
     *  binary answer that legitimately contains NULs: use {@link respond} and
     *  read `bytes` directly for binary/grid modalities.
     *
     *  Injects the TEXT canonicalizer (src/canon.ts) so resolution treats
     *  every character variation of the same text — case, width, whitespace —
     *  as one form, provided the store's canon index is built
     *  ({@link buildCanonIndex}). */
    respondText(input: string, inspectRationale?: InspectRationale): Promise<string>;
    /** Begin a new conversation, optionally restoring from a previously-saved
     *  {@link ConversationState}.  The returned handle is required for
     *  {@link respondTurn} and {@link endConversation}.
     *
     *  Conversations are independent — a Mind can manage several concurrently.
     *  Each tracks the fold pyramid (accumulated internal processing) and
     *  turn-boundary offsets; the geometry never inspects content to guess
     *  where one turn ends and the next begins. */
    beginConversation(state?: ConversationState): Conversation;
    /** End a conversation, releasing its internal resources (accumulated
     *  context, boundary offsets, and the fold-pyramid cache).  Idempotent. */
    endConversation(conv: Conversation): void;
    /** The current serialisable state of an active conversation.  Save this
     *  to resume the conversation later via {@link beginConversation}. */
    conversationState(conv: Conversation): ConversationState | null;
    /** Append a turn to a conversation's accumulated context WITHOUT
     *  responding — raw byte append plus a boundary offset, never a
     *  separator; the fold pyramid advances by O(turn).
     *
     *  This is the primitive for turns the Mind should hear but not answer:
     *  replaying a transcript, feeding the OTHER speaker's line in a
     *  prediction harness, or restoring context piecewise.  {@link
     *  respondTurn} = addTurn + think + its own reply appended the same way.
     *
     *  ── ON SEPARATORS: THERE IS NO SEPARATOR QUESTION ────────────────────
     *
     *  "Never a separator" above says what this method DOES — it appends the
     *  bytes you give it and records an OFFSET — not that separator bytes are
     *  forbidden, unsupported, or something the engine must be taught about.
     *  Sema is agnostic to them, and reviewers keep mistaking that agnosticism
     *  for a constraint.  To be explicit, because the mistake is easy:
     *
     *  1. A turn boundary is an OFFSET, held here, in `boundaries`.  It is
     *     never a character the geometry scans for.  Nothing downstream asks
     *     "what byte separates two turns?" because nothing downstream finds
     *     boundaries by looking at content at all.
     *  2. A separator in a CORPUS is ordinary content.  If a trainer joins
     *     turns with "\n" (example/train_base.ts does), those newlines are
     *     simply bytes inside the stream, folded like every other byte.  They
     *     are a property of that corpus, not of this API and not of the fold.
     *  3. This API can therefore reproduce ANY corpus exactly, with no
     *     convention to agree on: replaying a "\n"-joined corpus means passing
     *     `"\n" + turnText` as the turn.  The separator rides along IN the
     *     turn bytes, where it belongs.  There is nothing to configure and no
     *     mode to select.
     *  4. Inference is not exact-match anyway.  Recognition works over
     *     sub-spans, canonical equivalence and resonance, so a query that
     *     differs from the trained bytes by punctuation or whitespace still
     *     reaches the trained forms; it degrades, it does not fail closed.
     *
     *  What follows from 1–4: differing separator bytes between a corpus and a
     *  query is an ordinary CONTENT difference — the same kind as any other
     *  wording difference — and it is measured the same way.  It is NOT an
     *  incompatibility between the trainer and this API, and it does NOT
     *  require choosing a project-wide separator convention.  A review that
     *  concludes otherwise (this one did, before being corrected) has mistaken
     *  its own harness feeding untrained bytes for an architectural defect. */
    addTurn(conv: Conversation, turn: Input): ConversationState;
    /** Grow a conversation's accumulated context by one turn's bytes — raw
     *  append plus a boundary offset, pyramid advanced by O(turn), the grown
     *  context's tree seeded into the conversation's perceive memo.  The ONE
     *  place a context grows ({@link addTurn} and {@link respondTurn} both
     *  come through here), so the append semantics cannot drift. */
    private _growContext;
    /** Process one turn of a conversation.
     *
     *  `turn` is the raw input for the latest turn — its bytes are appended
     *  to the accumulated context directly (raw concatenation).  The Mind
     *  tracks the byte offset where each turn ends; no separator is ever
     *  inserted or inspected.
     *
     *  Returns the response AND the updated {@link ConversationState} so the
     *  caller can persist it.  The conversation handle's internal state is
     *  updated in place — the returned state is a snapshot for storage.
     *
     *  SINGLE FLIGHT: at most one respondTurn may be in flight per Mind.  The
     *  conversation's memo caches are swapped into the Mind-level per-response
     *  pointers for the duration of the turn, so a concurrently-running
     *  respond()/respondTurn() on the SAME Mind would interleave state.
     *  Different Minds (or sequential awaits, as in every test) are safe. */
    respondTurn(conv: Conversation, turn: Input, inspectRationale?: InspectRationale): Promise<{
        response: Response;
        state: ConversationState;
    }>;
    /** Text view of {@link respondTurn}.  See {@link respondText} for the
     *  NUL-stripping caveat.  For binary or grid turns use {@link respondTurn}
     *  directly — this is a text-only convenience, like {@link respondText}. */
    respondTurnText(conv: Conversation, turn: string, inspectRationale?: InspectRationale): Promise<{
        response: string;
        state: ConversationState;
    }>;
    embedding(input: Input): Promise<Vec | null>;
    /** Kinship note: the vector arm below is a miniature of recall's tier 3
     *  (resonate → reach gate → read out the nearest form's bytes) — the
     *  read-out direction of the same operation, without recall's grounding
     *  ladder.  If either side's acceptance rule changes, revisit the other. */
    express(idOrV: number | Vec): Promise<Uint8Array>;
    /** See {@link import("./learning.js").ingest} — `onDeposit`, when given,
     *  reports each ingested item's deposited root node ids
     *  ({@link DepositReport}); purely observational. */
    ingest(input: Input | (Input | [Input, Input])[], second?: Input, onDeposit?: (report: import("./learning.js").DepositReport) => void, 
    /** Witness the DEPOSIT path the way {@link respond}'s callback witnesses
     *  inference — `companyProfile` reports its saturation diagnostics here.
     *  Without it the tracer is never constructed and the emit sites cost
     *  nothing (§ rationale.ts), exactly as on the inference path. */
    inspectRationale?: InspectRationale): Promise<(Sema & {
        id: number;
    }) | undefined>;
    private extensionHost;
    private groundedContinuation;
    /** Re-index structurally-important nodes whose gists were evicted from the
     *  pending cache before they reached the content index.  See {@link
     *  Store.repairContentIndex} for the contract; this method wires the
     *  Mind's perception into the store's repair walk.
     *
     *  Run this after training or at checkpoints to restore recall reach for
     *  nodes that bridge experiences but were never indexed.  A pure interior
     *  node (no edges, no halo) is deliberately skipped — it is scaffolding,
     *  not an experience root or bridge, and regenerating its gist would waste
     *  I/O and index space for no recall benefit.
     *
     *  @param minParents  only repair nodes with ≥ this many structural parents
     *                     (default 2 — structural bridges)
     *  @returns number of nodes added to the content index */
    repairContentIndex(minParents?: number): Promise<number>;
    /** Build (or incrementally refresh) the store's canonical-form index: for
     *  every content-bearing node, record the hash of its CANONICAL key so
     *  resolution can find stored forms across surface variation (case, width,
     *  whitespace — whatever `canon` equates; see src/canon.ts).
     *
     *  Incremental and idempotent: the last indexed node id is remembered in
     *  store meta (`canon.upto`), so a refresh after further training scans
     *  only the new rows.  Run once after training, and again after ingests —
     *  the same operational shape as {@link repairContentIndex}.
     *
     *  @param canon  the canonicalizer to index under — MUST be the same one
     *                queries will carry (text queries carry {@link textCanon}
     *                unless the Mind was constructed with its own)
     *  @returns number of index rows added */
    buildCanonIndex(canon?: Canon): Promise<number>;
    save(): Promise<Uint8Array>;
    static load(snapshot: Uint8Array, store: Store): Promise<Mind>;
    static loadFromStore(store: Store): Promise<Mind>;
}
