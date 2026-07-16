import { Vec } from "../vec.js";
import { Sema, Space } from "../sema.js";
import { Alphabet } from "../alphabet.js";
import { Grid } from "../geometry.js";
import { BoundedMap, type Store } from "../store.js";
import { type MindConfig } from "../config.js";
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
import type { AttentionRead, MindContext, Recognition } from "./types.js";
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
    /** Per-response memo of the consensus climb.  NOTE: this memo and
     *  {@link recogniseMemo} are BYPASSED while a rationale trace is attached
     *  (every mechanism must emit its own steps), so a traced respond re-pays
     *  up to four consensus climbs plus repeat recognitions — that is where the
     *  traced-vs-untraced latency multiple comes from, by design. */
    climbMemo: WeakMap<Uint8Array, Map<string, AttentionRead>> | null;
    /** Per-response memo of recognise() — see {@link MindContext.recogniseMemo}. */
    recogniseMemo: WeakMap<Uint8Array, Recognition> | null;
    /** Per-response memo of perceive() — see {@link MindContext.perceiveMemo}. */
    perceiveMemo: Map<string, import("../sema.js").Sema> | null;
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
    _depositTrees: BoundedMap<string, import("../geometry.js").FoldPyramid>;
    _depositLens: Set<number>;
    _internIds: WeakMap<Sema, number>;
    /** Canonical node id of a byte span.  Required by GraphSearchHost & MindContext. */
    resolve(bytes: Uint8Array): number | null;
    recogniseSpan(bytes: Uint8Array): {
        sites: ReadonlyArray<Site>;
        leaves: ReadonlyArray<Leaf>;
        splits: ReadonlySet<number>;
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
    /** Open one response's transient state — the tracer and the per-response
     *  memos.  Paired with {@link endResponse}; the ONE place this state is
     *  created, so adding a memo cannot forget its reset. */
    private beginResponse;
    /** Close one response's transient state — every per-response field, incl.
     *  the edge guide/choices `think` sets mid-flight. */
    private endResponse;
    respond(input: Input, inspectRationale?: InspectRationale): Promise<Response>;
    /** Text view of {@link respond}.  NUL bytes (0x00) are stripped before
     *  decoding — they are structural padding in text answers.  LOSSY for a
     *  binary answer that legitimately contains NULs: use {@link respond} and
     *  read `bytes` directly for binary/grid modalities. */
    respondText(input: string, inspectRationale?: InspectRationale): Promise<string>;
    embedding(input: Input): Promise<Vec | null>;
    /** Kinship note: the vector arm below is a miniature of recall's tier 3
     *  (resonate → reach gate → read out the nearest form's bytes) — the
     *  read-out direction of the same operation, without recall's grounding
     *  ladder.  If either side's acceptance rule changes, revisit the other. */
    express(idOrV: number | Vec): Promise<Uint8Array>;
    ingest(input: Input | (Input | [Input, Input])[], second?: Input): Promise<(Sema & {
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
    save(): Promise<Uint8Array>;
    static load(snapshot: Uint8Array, store: Store): Promise<Mind>;
    static loadFromStore(store: Store): Promise<Mind>;
}
