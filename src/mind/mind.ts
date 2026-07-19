// mind/mind.ts — perceive, deposit, recall, think, express.
//
// Memory is a content-addressed node graph (see store.ts). Learning is
// DEPOSITION: perceive a stream into a tree and intern every node, so equal —
// and, by resonance, similar — subtrees collapse to one shared node. A fact is
// an EDGE between node ids; recall traverses edges; thinking completes the
// query's OWN tree, node by node, to a fixed point. No whole, no weights.
//
// Architecture: 4 primitives × 2 patterns = all inference.
// Implementation split across src/mind/*.ts — this file assembles the Mind class.

import { cosine, makeKeyring, rng, setVecConfig, Vec } from "../vec.js";
import { bindSeat, fold, Sema, Space } from "../sema.js";
import { Alphabet } from "../alphabet.js";
import {
  bytesToTree,
  Grid,
  gridToTree,
  hilbertBytes,
  reachThreshold,
  stackGrids,
} from "../geometry.js";
import { BoundedMap, type Store } from "../store.js";
import { SQliteStore } from "../store-sqlite.js";
import { type MindConfig, resolveConfig } from "../config.js";
import { type Canon, canonHash, textCanon } from "../canon.js";
import {
  type CandidateSpan,
  coverSequence,
  lightestDerivation,
} from "../derive/src/index.js";
import { bytesEqual, concat2, concatBytes, indexOf } from "../bytes.js";
import {
  type ComputedResult,
  type DerivationItem,
  type DerivationStep,
  GraphSearch,
  type Leaf,
  type Seg,
  type Site,
} from "./graph-search.js";
import { Alu } from "../alu/src/index.js";
import type { ComputedSpan, ExtensionHost } from "../extension.js";

export type { ComputedSpan, ExtensionHost };
import {
  decodeText,
  type InspectRationale,
  Rationale,
  type RationaleItem,
} from "./rationale.js";

export type {
  InspectRationale,
  RationaleItem,
  RationaleStep,
} from "./rationale.js";

// Public types re-exported
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
}

/** An active conversation handle.  Opaque — interact through the Mind's
 *  conversation methods ({@link Mind.beginConversation},
 *  {@link Mind.respondTurn}, {@link Mind.endConversation}). */
export interface Conversation {
  readonly id: number;
}

/** Internal per-conversation state.
 *
 *  The {@link pyramid} IS the conversation — the accumulated internal
 *  processing state.  {@link bytes} is the raw accumulated input, kept
 *  in sync with the pyramid for O(1) concatenation.
 *
 *  Memos persist across turns so the inference pipeline does not
 *  re-process the prefix.  Content-keyed (latin1) — each turn's fresh
 *  {@code Uint8Array} would never hit an object-identity key.
 *
 *  {@link resolvedSubtrees} caches foldTree resolutions at the Sema-node
 *  level.  When the pyramid reuses prefix subtrees (identical objects),
 *  foldTree returns their ids immediately — O(suffix) instead of
 *  O(context) for every tree walk. */
interface ConversationData {
  tree: Sema;
  bytes: Uint8Array;
  boundaries: number[];
  perceiveMemo: Map<string, Sema>;
  recogniseMemo: Map<string, Recognition>;
  climbMemo: Map<string, Map<string, AttentionRead>>;
  resolvedSubtrees: WeakMap<Sema, { id: number; len: number }>;
}

// Mind module imports
import type { AttentionRead, MindContext, Recognition } from "./types.js";
import { changedNodes, liftAnswer, spliceAll } from "./types.js";
import {
  foldTree,
  gistOf,
  inputBytes,
  latin1Key,
  perceive as perceiveImpl,
  read,
  resolve as resolveImpl,
} from "./primitives.js";
import { chooseNext, edgeAncestors as edgeAncestorsFn } from "./traverse.js";
import { follow } from "./match.js";
import { recognise, segment } from "./recognition.js";
import { meaningOf } from "./resonance.js";
import {
  climbAttention as climbAttentionFn,
  naturalBreak as naturalBreakFn,
} from "./attention.js";
import { aluToMechanism, defaultMechanisms, think } from "./pipeline.js";
import { articulate } from "./articulation.js";
import { ingest } from "./learning.js";
import { rItem } from "./trace.js";

// ── MindOptions ───────────────────────────────────────────────────────────

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
  mechanismFactories?: ((
    host: import("../extension.js").ExtensionHost,
  ) => import("./pipeline-mechanism.js").PipelineMechanism)[];
  /** Content canonicalizer applied to EVERY response (any modality) for
   *  equivalence-class resolution — see src/canon.ts.  Text entry points
   *  ({@link Mind.respondText}, {@link Mind.respondTurnText}) inject the
   *  Unicode text canonicalizer automatically when this is unset; pass
   *  `false` to disable canonical resolution everywhere. */
  canon?: Canon | false;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MIND
// ═══════════════════════════════════════════════════════════════════════════

export class Mind implements MindContext {
  readonly space: Space;
  readonly alphabet: Alphabet;
  readonly store: Store;
  readonly cfg: MindConfig;

  /** The lightest-derivation engine over the Sema graph. */
  readonly search: GraphSearch;

  /** The grounding mechanisms iterated by {@link think}. */
  readonly mechanisms: import("./pipeline-mechanism.js").PipelineMechanism[] =
    [];

  /** The live rationale tracer for the inference currently in flight, or null. */
  trace: Rationale | null = null;

  /** The content canonicalizer for the response in flight — see
   *  {@link MindContext.canon}.  Injected per response by the modality entry
   *  point; null when the response carries no equivalence. */
  canon: Canon | null = null;

  /** Per-response canonical-resolution memo — see {@link MindContext.canonMemo}. */
  canonMemo: Map<string, number | null> | null = null;

  /** The Mind-level canon option: a canonicalizer to use for EVERY response,
   *  `false` to disable canonical resolution, or null to let each entry
   *  point decide (text entry points inject {@link textCanon}). */
  private _canonOpt: Canon | false | null = null;

  /** Memo of the consensus climb — content-keyed.  See {@link MindContext.climbMemo}. */
  climbMemo: Map<string, Map<string, AttentionRead>> | null = null;

  /** Memo of recognise() — content-keyed.  See {@link MindContext.recogniseMemo}. */
  recogniseMemo: Map<string, Recognition> | null = null;

  /** Memo of perceive() — content-keyed.  See {@link MindContext.perceiveMemo}. */
  perceiveMemo: Map<string, import("../sema.js").Sema> | null = null;

  /** Subtree-resolution cache.  See {@link MindContext._resolvedSubtrees}. */
  _resolvedSubtrees:
    | WeakMap<
      import("../sema.js").Sema,
      { id: number; len: number }
    >
    | null = null;

  /** The perceived gist of the query currently being answered.  Set by `think`
   *  before the graph search runs; `chooseNext` consults it as a gate (a null
   *  guide means no query is in flight, so structural walkers keep plain
   *  first-edge behaviour) and the reverse projection uses it for
   *  reverse-recall disambiguation via `chooseAmong`. */
  _edgeGuide: Vec | null = null;
  /** Per-response memo of {@link chooseNext} picks — ensures every mechanism
   *  of a single response follows the SAME continuation for each ambiguous
   *  context node. */
  _edgeChoice = new Map<number, number>();

  /** Previous deposit's seen node ids for incremental change detection. */
  _prevSeen: Set<number> | null = null;

  /** Session cache of node-id → perceived gist for candidate scoring — see
   *  {@link MindContext._gistCache}.  32 MB ≈ 8K gists at D=1024; hub
   *  candidate sets (√N at most) fit comfortably and recur across queries. */
  _gistCache = new BoundedMap<number, Vec>(
    32_000_000,
    (v) => v.byteLength,
  );
  // Deposit-path fold-pyramid cache (see MindContext) — ENTRY-count
  // bounded: a pyramid costs ~KB per content byte (one D-float gist per
  // interior node), and only the few live conversation chains need to stay
  // warm, so 8 entries is the honest budget.
  _depositTrees = new BoundedMap<
    string,
    import("./types.js").DepositCacheEntry
  >(8);
  _depositLens = new Set<number>();
  _internIds = new WeakMap<import("../sema.js").Sema, number>();

  // ── Conversation state ──────────────────────────────────────────────────

  private _nextConvId = 1;
  private _conversations = new Map<number, ConversationData>();

  // ── GraphSearchHost implementation ─────────────────────────────────────

  /** Canonical node id of a byte span.  Required by GraphSearchHost & MindContext. */
  resolve(bytes: Uint8Array): number | null {
    return resolveImpl(this, bytes);
  }

  // recogniseSpan wraps recognise
  recogniseSpan(bytes: Uint8Array): {
    sites: ReadonlyArray<Site>;
    leaves: ReadonlyArray<Leaf>;
    splits: ReadonlySet<number>;
    starts: ReadonlySet<number>;
  } {
    const r = recognise(this, bytes);
    return {
      sites: r.sites,
      leaves: r.leaves,
      splits: r.splits,
      starts: r.starts,
    };
  }

  /** Disambiguate among multiple learnt continuations of the same context node.
   *  Required by {@link GraphSearchHost} — the graph search calls this through the
   *  host interface when a recognised form has more than one outgoing edge.
   *  Delegates to the standalone {@link chooseNext} which picks the candidate
   *  with the most distributional evidence (highest `prevOf` count — the
   *  structural manifestation of its halo).  When evidence is equal the
   *  first-inserted edge wins. */
  chooseNext(node: number): number | undefined {
    return chooseNext(this, node, this._edgeGuide);
  }

  // ── construction ─────────────────────────────────────────────────────────

  constructor(opts?: MindOptions);
  constructor(cfg: MindConfig, store: Store, _fromStore: true);
  constructor(
    optsOrCfg?: MindOptions | MindConfig,
    storeArg?: Store,
    _fromStore?: true,
  ) {
    let userMechanisms: import("./pipeline-mechanism.js").PipelineMechanism[] =
      [];
    let userFactories: ((
      host: import("../extension.js").ExtensionHost,
    ) => import("./pipeline-mechanism.js").PipelineMechanism)[] = [];
    if (_fromStore !== undefined) {
      this.cfg = resolveConfig(optsOrCfg as Partial<MindConfig>);
      this.store = storeArg!;
    } else {
      const {
        store: optsStore,
        mechanisms: userMechs,
        mechanismFactories: userFacts,
        canon: optsCanon,
        ...rest
      } = (optsOrCfg ?? {}) as MindOptions;
      this._canonOpt = optsCanon ?? null;
      this.cfg = resolveConfig(rest as Partial<MindConfig>);
      this.store = optsStore ?? new SQliteStore({
        maxGroup: this.cfg.geometry.maxGroup,
      });
      userMechanisms = userMechs ?? [];
      userFactories = userFacts ?? [];
    }
    setVecConfig({
      normalizeEpsilon: this.cfg.normalizeEpsilon,
      cosineEpsilon: this.cfg.cosineEpsilon,
    });

    const seedRand = rng((this.cfg.seed ^ 0x9e3779) >>> 0);
    const seats = makeKeyring(
      this.store.D,
      Math.max(8, this.cfg.geometry.maxGroup),
      seedRand,
    );
    this.space = {
      D: this.store.D,
      seats,
      rand: rng((this.cfg.seed ^ 0x51f15e) >>> 0),
      maxGroup: this.cfg.geometry.maxGroup,
    };
    this.alphabet = new Alphabet(
      this.cfg.seed,
      this.store.D,
      this.cfg.alphabet,
    );
    this.search = new GraphSearch(
      this.store,
      this.space.maxGroup,
      this, // MindContext extends GraphSearchHost
    );
    // Build the mechanism list: default grounding + ALU + user mechanisms.
    for (const m of defaultMechanisms) this.mechanisms.push(m);

    const host = this.extensionHost();
    if (this.cfg.alu.enabled) {
      const alu = new Alu({
        tol: this.cfg.alu.tol,
        maxIter: this.cfg.alu.maxIter,
        precision: this.cfg.alu.precision,
      }, host);
      this.mechanisms.push(aluToMechanism(alu));
    }

    for (const m of userMechanisms) this.mechanisms.push(m);
    for (const f of userFactories) this.mechanisms.push(f(host));
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Exposed for tests: the consensus climb over query sub-regions. */
  climbAttention(
    query: Uint8Array,
    k: number,
    mode: import("./types.js").DFMode = "inverse",
  ): Promise<import("./types.js").Attention[]> {
    return climbAttentionFn(this, query, k, mode);
  }

  /** Exposed for tests: climb the structural DAG from a node to its
   *  edge-bearing ancestor contexts. */
  edgeAncestors(
    id: number,
    contextCount: number,
  ): import("./types.js").AncestorReach {
    return edgeAncestorsFn(this, id, contextCount);
  }

  /** Exposed for tests: find the natural break point in a sorted vote list. */
  naturalBreak(votes: number[]): number {
    return naturalBreakFn(votes);
  }

  // ── respond ───────────────────────────────────────────────────────────

  /** Perceive input into a content-defined tree.  Deterministic — identical
   *  bytes always produce an identical tree.  Public for ingest-cache. */
  perceive(
    input: Input,
    leafAt?: (i: number) => number | null,
    lookup?: (ids: number[]) => number | null,
  ): Sema {
    return perceiveImpl(this, input, leafAt, lookup);
  }

  /** Open one response's transient state — the tracer and the per-response
   *  memos.  Paired with {@link endResponse}; the ONE place this state is
   *  created, so adding a memo cannot forget its reset. */
  private beginResponse(
    inspectRationale?: InspectRationale,
    canon?: Canon | null,
  ): void {
    this.trace = inspectRationale ? new Rationale(inspectRationale) : null;
    this.climbMemo = new Map();
    this.recogniseMemo = new Map();
    this.perceiveMemo = new Map();
    this.canon = canon ?? null;
    this.canonMemo = canon ? new Map() : null;
  }

  /** The canonicalizer a response should carry: the Mind-level option when
   *  set (or none when explicitly disabled), else the entry point's own
   *  default — text entry points pass {@link textCanon}, binary ones null. */
  private _canonFor(entryDefault: Canon | null): Canon | null {
    if (this._canonOpt === false) return null;
    return this._canonOpt ?? entryDefault;
  }

  /** Close one response's transient state — every per-response field, incl.
   *  the edge guide/choices `think` sets mid-flight. */
  private endResponse(): void {
    this.trace = null;
    this.climbMemo = null;
    this.recogniseMemo = null;
    this.perceiveMemo = null;
    this.canon = null;
    this.canonMemo = null;
    this._edgeGuide = null;
    this._edgeChoice.clear();
  }

  /** Shared response core — the one path from bytes to voiced answer.
   *  `respond` calls this directly; `respondTurn` has its own path
   *  with conversation-persistent memos and incremental perception. */
  private async _respondImpl(
    queryBytes: Uint8Array,
    inspectRationale?: InspectRationale,
    traceLabel = "respond",
    canon: Canon | null = null,
  ): Promise<Response> {
    this.beginResponse(inspectRationale, canon);
    try {
      const top = this.trace?.enter(traceLabel, [
        rItem(queryBytes, "query"),
      ]);
      const thought = await think(this, queryBytes, this.mechanisms);
      if (thought === null) {
        top?.done([], "nothing to perceive or an empty store — no answer");
        return { v: null, bytes: new Uint8Array(0) };
      }

      const voiced = await articulate(this, thought.bytes, queryBytes);
      top?.done(
        [rItem(voiced, "answer", resolveImpl(this, voiced) ?? undefined)],
        "the answer, re-voiced in the asker's words",
      );
      return {
        v: gistOf(this, voiced),
        bytes: voiced,
        provenance: thought.provenance,
      };
    } finally {
      this.endResponse();
    }
  }

  async respond(
    input: Input,
    inspectRationale?: InspectRationale,
  ): Promise<Response> {
    // A STRING input is text by nature: it carries the text equivalence even
    // through the generic entry point.  Raw bytes / grids carry only the
    // Mind-level canon option, if any.
    const canon = this._canonFor(typeof input === "string" ? textCanon : null);
    return this._respondImpl(
      inputBytes(this, input),
      inspectRationale,
      "respond",
      canon,
    );
  }

  /** Text view of {@link respond}.  NUL bytes (0x00) are stripped before
   *  decoding — they are structural padding in text answers.  LOSSY for a
   *  binary answer that legitimately contains NULs: use {@link respond} and
   *  read `bytes` directly for binary/grid modalities.
   *
   *  Injects the TEXT canonicalizer (src/canon.ts) so resolution treats
   *  every character variation of the same text — case, width, whitespace —
   *  as one form, provided the store's canon index is built
   *  ({@link buildCanonIndex}). */
  async respondText(
    input: string,
    inspectRationale?: InspectRationale,
  ): Promise<string> {
    const r = await this.respond(input, inspectRationale);
    return decodeText(r.bytes);
  }

  // ── Conversation API ────────────────────────────────────────────────────

  /** Begin a new conversation, optionally restoring from a previously-saved
   *  {@link ConversationState}.  The returned handle is required for
   *  {@link respondTurn} and {@link endConversation}.
   *
   *  Conversations are independent — a Mind can manage several concurrently.
   *  Each tracks the fold pyramid (accumulated internal processing) and
   *  turn-boundary offsets; the geometry never inspects content to guess
   *  where one turn ends and the next begins. */
  beginConversation(state?: ConversationState): Conversation {
    const id = this._nextConvId++;
    const initBytes = state?.context ?? new Uint8Array(0);
    const initBoundaries = state?.boundaries ? [...state.boundaries] : [];
    const tree = bytesToTree(
      this.space,
      this.alphabet,
      initBytes,
      undefined,
      undefined,
      initBoundaries.length > 0 ? initBoundaries : undefined,
    );
    this._conversations.set(id, {
      tree,
      bytes: initBytes,
      boundaries: initBoundaries,
      perceiveMemo: new Map(),
      recogniseMemo: new Map(),
      climbMemo: new Map(),
      resolvedSubtrees: new WeakMap(),
    });
    return { id };
  }

  /** End a conversation, releasing its internal resources (accumulated
   *  context, boundary offsets, and the fold-pyramid cache).  Idempotent. */
  endConversation(conv: Conversation): void {
    this._conversations.delete(conv.id);
  }

  /** The current serialisable state of an active conversation.  Save this
   *  to resume the conversation later via {@link beginConversation}. */
  conversationState(conv: Conversation): ConversationState | null {
    const data = this._conversations.get(conv.id);
    if (!data) return null;
    return {
      context: data.bytes,
      boundaries: [...data.boundaries],
    };
  }

  /** Append a turn to a conversation's accumulated context WITHOUT
   *  responding — raw byte append plus a boundary offset, never a
   *  separator; the fold pyramid advances by O(turn).
   *
   *  This is the primitive for turns the Mind should hear but not answer:
   *  replaying a transcript, feeding the OTHER speaker's line in a
   *  prediction harness, or restoring context piecewise.  {@link
   *  respondTurn} = addTurn + think + its own reply appended the same way. */
  addTurn(conv: Conversation, turn: Input): ConversationState {
    const data = this._conversations.get(conv.id);
    if (!data) throw new Error(`Conversation ${conv.id} not found`);
    const turnBytes = inputBytes(this, turn);
    this._growContext(data, turnBytes);
    return this.conversationState(conv)!;
  }

  /** Grow a conversation's accumulated context by one turn's bytes — raw
   *  append plus a boundary offset, pyramid advanced by O(turn), the grown
   *  context's tree seeded into the conversation's perceive memo.  The ONE
   *  place a context grows ({@link addTurn} and {@link respondTurn} both
   *  come through here), so the append semantics cannot drift. */
  private _growContext(data: ConversationData, turnBytes: Uint8Array): Sema {
    const prevLen = data.bytes.length;
    // An empty turn neither grows the context nor marks a boundary —
    // boundaries are documented strictly increasing, and a zero-length
    // "turn" is no turn.  Nothing changed, so the existing tree stands.
    const grow = turnBytes.length > 0;
    if (!grow) return data.tree;
    const grown = prevLen > 0 ? concat2(data.bytes, turnBytes) : turnBytes;
    if (prevLen > 0) data.boundaries.push(prevLen);
    const tree = bytesToTree(
      this.space,
      this.alphabet,
      grown,
      undefined,
      undefined,
      data.boundaries.length > 0 ? data.boundaries : undefined,
    );
    data.tree = tree;
    data.bytes = grown;
    data.perceiveMemo.set(latin1Key(grown), tree);
    return tree;
  }

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
  async respondTurn(
    conv: Conversation,
    turn: Input,
    inspectRationale?: InspectRationale,
  ): Promise<{ response: Response; state: ConversationState }> {
    const data = this._conversations.get(conv.id);
    if (!data) throw new Error(`Conversation ${conv.id} not found`);

    const turnBytes = inputBytes(this, turn);
    // Incremental perception — O(turn) instead of O(context).
    const tree = this._growContext(data, turnBytes);
    const newContext = data.bytes;

    // Swap in the conversation's persistent state so the inference
    // pipeline does not re-process the prefix from scratch.
    //   perceiveMemo / recogniseMemo / climbMemo — content-keyed;
    //     the prefix's results from the previous turn are found by
    //     the current turn's sub-span calls.
    //   _resolvedSubtrees — Sema-node-keyed; when the pyramid reuses
    //     prefix subtrees (identical objects), foldTree returns their
    //     ids immediately — O(suffix) instead of O(context).
    this.perceiveMemo = data.perceiveMemo;
    this.recogniseMemo = data.recogniseMemo;
    this.climbMemo = data.climbMemo;
    this._resolvedSubtrees = data.resolvedSubtrees;
    this.trace = inspectRationale ? new Rationale(inspectRationale) : null;
    // A string turn is text by nature — carry the text equivalence, same as
    // respond() (see _canonFor).
    this.canon = this._canonFor(typeof turn === "string" ? textCanon : null);
    this.canonMemo = this.canon ? new Map() : null;

    try {
      // No recognise-memo pre-seeding here: that used to be necessary
      // because the flat/positional fold lost visibility into an earlier
      // turn's own structure once later bytes shifted its position
      // (foldTree no longer visited the turn's root node).  The
      // STABLE-PREFIX fold (see {@link ConversationData}) makes every
      // turn's subtree independent of what follows it by construction, so
      // recognise() finds it correctly on its own, first-touch, exactly
      // once per turn — no workaround needed, and none pre-empting
      // recognise()'s own memo with a partial result.
      const top = this.trace?.enter("respondTurn", [
        rItem(newContext, "query"),
      ]);

      const thought = await think(this, newContext, this.mechanisms);
      if (thought === null) {
        top?.done([], "nothing to perceive or an empty store — no answer");
        return {
          response: { v: null, bytes: new Uint8Array(0) },
          state: this.conversationState(conv)!,
        };
      }

      const voiced = await articulate(this, thought.bytes, newContext);
      top?.done(
        [rItem(voiced, "answer", resolveImpl(this, voiced) ?? undefined)],
        "the answer, re-voiced in the asker's words",
      );

      // The REPLY joins the accumulated context the same way a turn does
      // ({@link addTurn}): raw byte append plus a boundary offset — never a
      // separator.  A conversation's context is the full exchange, exactly
      // the cumulative continuous shape multi-turn training deposits, so a
      // later turn can refer to what was ANSWERED ("which of those two…"),
      // not only to what was asked.
      if (voiced.length > 0) this.addTurn(conv, voiced);

      return {
        response: {
          v: gistOf(this, voiced),
          bytes: voiced,
          provenance: thought.provenance,
        },
        state: this.conversationState(conv)!,
      };
    } finally {
      // No save-back: the conversation's memo MAPS were mutated in place —
      // `data.*` still points at them.  Re-assigning from the Mind-level
      // pointers here was a no-op in the single-flight case and, under a
      // concurrently-started respond() (which swaps its own fresh maps into
      // those pointers), would inject a FOREIGN response's memos into this
      // conversation.  Clear Mind references — non-conversation respond()
      // calls get fresh per-response memos.
      this.trace = null;
      this.perceiveMemo = null;
      this.recogniseMemo = null;
      this.climbMemo = null;
      this.canon = null;
      this.canonMemo = null;
      this._resolvedSubtrees = null;
      this._edgeGuide = null;
      this._edgeChoice.clear();
    }
  }

  /** Text view of {@link respondTurn}.  See {@link respondText} for the
   *  NUL-stripping caveat.  For binary or grid turns use {@link respondTurn}
   *  directly — this is a text-only convenience, like {@link respondText}. */
  async respondTurnText(
    conv: Conversation,
    turn: string,
    inspectRationale?: InspectRationale,
  ): Promise<{ response: string; state: ConversationState }> {
    const { response, state } = await this.respondTurn(
      conv,
      turn,
      inspectRationale,
    );
    return { response: decodeText(response.bytes), state };
  }

  async embedding(input: Input): Promise<Vec | null> {
    return (await this.respond(input)).v;
  }

  /** Kinship note: the vector arm below is a miniature of recall's tier 3
   *  (resonate → reach gate → read out the nearest form's bytes) — the
   *  read-out direction of the same operation, without recall's grounding
   *  ladder.  If either side's acceptance rule changes, revisit the other. */
  async express(idOrV: number | Vec): Promise<Uint8Array> {
    if (typeof idOrV === "number") return this.store.bytes(idOrV);
    const [hit] = await this.store.resonate(idOrV, 1);
    // The same confidence floor recall uses: a vector whose nearest stored
    // form sits below the reach threshold relates to NOTHING in the store —
    // returning that form's bytes anyway would fabricate an answer from an
    // unrelated neighbour.  Silence is the honest read-out.
    if (hit && hit.score >= reachThreshold(this.space.maxGroup)) {
      return this.store.bytes(hit.id);
    }
    return new Uint8Array(0);
  }

  // ── Learning ─────────────────────────────────────────────────────────────

  async ingest(
    input: Input | (Input | [Input, Input])[],
    second?: Input,
  ): Promise<(Sema & { id: number }) | undefined> {
    return ingest(this, input, second);
  }

  // ── Extension Surface ────────────────────────────────────────────────────

  private extensionHost(): ExtensionHost {
    const mind = this;
    return {
      meaningOf: (bytes, anchors) => meaningOf(this, bytes, anchors),
      continuation: (bytes) => this.groundedContinuation(bytes),
      segment: (bytes) =>
        segment(this, bytes).map((s) => ({ i: s.start, j: s.end })),
      get reach() {
        return mind.space.maxGroup;
      },
    };
  }

  private async groundedContinuation(
    bytes: Uint8Array,
  ): Promise<Uint8Array | null> {
    const id = resolveImpl(this, bytes);
    if (id === null) return null;
    const grounded = await follow(this, id);
    if (grounded !== null && !bytesEqual(grounded, bytes)) return grounded;
    return null;
  }

  // ── Content-index repair ───────────────────────────────────────────────

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
  async repairContentIndex(minParents = 2): Promise<number> {
    return this.store.repairContentIndex(
      async (id) => {
        const bytes = this.store.bytes(id);
        if (bytes.length === 0) return null;
        return gistOf(this, bytes);
      },
      minParents,
    );
  }

  // ── Canonical-form index ───────────────────────────────────────────────

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
  async buildCanonIndex(canon?: Canon): Promise<number> {
    const c = canon ?? this._canonFor(textCanon);
    const store = this.store;
    if (c === null || !store.canonAdd || !store.eachContent) return 0;
    const from = Number(await store.getMeta("canon.upto") ?? 0);
    let added = 0;
    let maxId = from - 1;
    store.eachContent((id, bytes) => {
      if (id > maxId) maxId = id;
      const key = c(bytes);
      if (key.length === 0) return;
      // Only index content whose canonical key DIFFERS from its raw bytes —
      // an already-canonical span is found by the exact lookup (and by the
      // fallback's own exact probe of the canonical bytes), so indexing it
      // would only add rows.
      if (bytesEqual(key, bytes)) return;
      store.canonAdd!(canonHash(key), id);
      added++;
    }, from);
    await store.setMeta("canon.upto", String(maxId + 1));
    store.commit();
    return added;
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  async save(): Promise<Uint8Array> {
    const meta = new TextEncoder().encode(JSON.stringify(this.cfg));
    await this.store.saveSnapshot(meta);
    return meta;
  }
  static async load(snapshot: Uint8Array, store: Store): Promise<Mind> {
    const cfg = JSON.parse(new TextDecoder().decode(snapshot)) as MindConfig;
    return new Mind(cfg, store, true);
  }

  static async loadFromStore(store: Store): Promise<Mind> {
    const meta = await store.loadSnapshot();
    if (!meta) throw new Error("no snapshot in store");
    return Mind.load(meta, store);
  }
}
