export interface Episode {
    context: string;
    continuation: string;
}
export type TrainingItem = string | Episode;
/** Dedup + trim a concept's items: drop empty/degenerate pairs and exact
 *  repeats so a concept never deposits the same form twice. */
export declare function refineItems(items: TrainingItem[]): TrainingItem[];
/** One normalized SmolSent row. */
export interface SmolSentRow {
    src: string;
    trg: string;
    sl: string;
    tl: string;
}
/** Normalize a raw datasets-server row into a SmolSentRow, or null when it lacks
 *  both sides or a side is implausibly large (a dump, not a sentence). */
export declare function toSmolSentRow(row: unknown): SmolSentRow | null;
/** Translate ONE SmolSent pair into SEMA facts: the two sentences are one
 *  meaning in two languages, so bind them BOTH ways. refineItems drops the
 *  degenerate case where src === trg. */
export declare function smolSentRowToItems(row: SmolSentRow): TrainingItem[];
/** One normalized Aya row. */
export interface AyaRow {
    inputs: string;
    targets: string;
    language: string;
}
/** Normalize a raw datasets-server row object into an AyaRow, or null when it
 *  lacks a usable prompt/answer or a field is implausibly large (a dump, not a
 *  cognitive example). Trims surrounding whitespace; keeps inner text verbatim
 *  (human prose, possibly multi-paragraph). */
export declare function toAyaRow(row: unknown): AyaRow | null;
/** Translate ONE Aya row into SEMA training items. A row is a single human
 *  (question → answer) exchange — exactly one FACT, the (inputs → targets) edge.
 *  No standalone-answer experience and no one-exchange "cumulative" walk: a lone
 *  Q→A is not multi-turn, and both would only replicate the same edge. */
export declare function ayaRowToItems(row: AyaRow): TrainingItem[];
/** A single oasst2 message node (the fields we use; the tree nests via replies). */
interface OasstNode {
    role?: string;
    text?: string;
    rank?: number | null;
    deleted?: boolean;
    replies?: OasstNode[];
}
/** One conversational turn extracted from a tree. */
export interface OasstTurn {
    role: string;
    text: string;
}
/** Collapse a conversation tree to ONE linear path: at each node, descend into
 *  its best-ranked, non-deleted reply (rank 0 preferred; unranked sorts last).
 *  Returns the ordered turns (already strictly alternating in this corpus). */
export declare function bestOasstPath(root: OasstNode): OasstTurn[];
/** Translate ONE multi-turn oasst2 conversation into SEMA training items.
 *
 *  This is the ONE stage where cumulative continuous context is truly necessary:
 *  the data is a real multi-turn dialogue, and what must be learned is how each
 *  turn follows from the WHOLE conversation so far — not from the previous turn
 *  alone. The conversation is emitted ONLY as the accumulated walk; standalone
 *  turn experiences and local adjacent-pair facts are NOT emitted (they are
 *  subsumed by it and would merely replicate the content).
 *
 *  The walk is byte-for-byte the pattern proven in test/13-conversation.test.mjs
 *  ("teachConversation"): each turn is the continuation of all prior turns joined
 *  by "\n", with BARE turn text — NO "User:/Assistant:" labels. Roles already
 *  alternate by position in an oasst2 best-path (the root is a prompter), so a
 *  label adds nothing the position does not, while a clean continuation matches
 *  the test's recall (predictNext queries bare prior turns) and lets a turn share
 *  its gist with the same text elsewhere (e.g. an Aya question stored bare).
 *
 *  Returns [] for a conversation below the multi-turn threshold, so callers can
 *  simply skip empties. */
export declare function oasstConversationToItems(turns: OasstTurn[]): TrainingItem[];
/** One normalized General-Knowledge row. */
export interface GenKnowRow {
    question: string;
    answer: string;
}
/** Normalize a raw datasets-server row into a GenKnowRow, or null when it lacks
 *  a usable question/answer or a side is implausibly large (corruption). */
export declare function toGenKnowRow(row: unknown): GenKnowRow | null;
/** Translate ONE General-Knowledge row into SEMA items: exactly one
 *  (question → answer) FACT. refineItems drops a degenerate question === answer. */
export declare function genKnowRowToItems(row: GenKnowRow): TrainingItem[];
export {};
