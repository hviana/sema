import { AbstractStore, type NodeId, type NodeRec, type Store } from "./store.js";
import { type StoreConfig } from "./config.js";
export interface SQliteStoreOptions extends Partial<StoreConfig> {
    path?: string;
    D?: number;
    /** Fold group size used during training — tells indexSubtree how tight the
     *  reach-net epsilon should be (1 − 1/(2·maxGroup)). Defaults to the
     *  Mind's geometry.maxGroup. */
    maxGroup?: number;
    /** Query-side RaBitQ estimator precision for both vector indices. */
    queryBits?: number;
}
export declare class SQliteStore extends AbstractStore implements Store {
    private readonly opts;
    private readonly vectorCacheMb;
    private readonly vectorSeed;
    private content;
    private halos;
    private sqlite;
    private _inTx;
    private _insertNode;
    private _insertKid;
    private _selContain;
    private _selParents;
    private _selHalo;
    private _upHalo;
    private _selLeaf;
    private _selFlat;
    private _selKids;
    private _selNode;
    private _insertEdge;
    private _selNext;
    private _selPrev;
    private _setMeta;
    private _getMeta;
    private _delMeta;
    private _insSnapshot;
    private _selSnapshot;
    constructor(opts?: SQliteStoreOptions);
    private vectorDbPath;
    private openVectorDB;
    protected _dbOpen(): Promise<void>;
    protected _dbClose(): void;
    protected _dbBeginTx(): void;
    protected _dbCommitTx(): void;
    protected _dbInsertNode(id: NodeId, leaf: Uint8Array | null, kids: Uint8Array | null, h: number): void;
    protected _dbGetNode(id: NodeId): NodeRec | null;
    protected _dbFindLeaf(h: number, bytes: Uint8Array): NodeId | null;
    protected _dbFindBranchByLeaf(h: number, bytes: Uint8Array): NodeId | null;
    protected _dbFindBranchByKids(h: number, packed: Uint8Array): NodeId | null;
    protected _dbInsertKid(child: NodeId, parent: NodeId): void;
    protected _dbGetParents(id: NodeId): NodeId[];
    private _selParentsFirst;
    protected _dbGetParentsFirst(id: NodeId, limit: number): NodeId[];
    private _selChain;
    /** {@link Store.chainRun}'s walk as ONE recursive CTE: the whole
     *  transparent chain (no edge in or out, exactly one parent) is descended
     *  inside SQLite — per-node work is the same three indexed probes as the
     *  base class's loop, but without a JS↔SQLite round trip per node, which
     *  dominates on the deep single-structure scaffolding this read exists
     *  for. */
    protected _chainWalk(id: NodeId, cap: number): NodeId[];
    /** Width of the seq band inside the packed contain rowid: rowid =
     *  child·SEQ_SPAN + seq.  Page sizes are geometric, so a chain of k live
     *  pages needs a base of ≥ 2^k · 4 bytes — seq stays ≤ ~50 for any
     *  physically possible list; the append path guards the band anyway. */
    private static readonly SEQ_SPAN;
    private _selContainExists;
    protected _dbContainExists(child: NodeId): boolean;
    private _selContainPages;
    /** The child's page directory — (seq, byte length) per page, O(log fan-in)
     *  rows, each read from the cell header without loading the blob. */
    private containPages;
    private _selContainPageSub;
    private _selContainPage;
    private containPage;
    protected _dbGetContainParentsSlice(child: NodeId, offset: number, limit: number): NodeId[];
    private _selContainCount;
    protected _dbGetContainCount(child: NodeId): number;
    protected _dbGetContainParents(child: NodeId): NodeId[];
    private _upsContainPage;
    private _delContainPage;
    protected _dbAppendContain(child: NodeId, parents: NodeId[]): void;
    protected _dbInsertEdge(src: NodeId, dst: NodeId): void;
    protected _dbGetNextEdges(id: NodeId): NodeId[];
    protected _dbGetPrevEdges(id: NodeId): NodeId[];
    private _selNextFirst;
    protected _dbGetNextEdgesFirst(id: NodeId, limit: number): NodeId[];
    private _selPrevFirst;
    protected _dbGetPrevEdgesFirst(id: NodeId, limit: number): NodeId[];
    private _selPrevCount;
    /** {@link Store.prevCount} — one indexed COUNT over idx_edge_dst, never a
     *  row materialisation (a common continuation's reverse fan-in is
     *  corpus-sized). */
    prevCount(id: NodeId): number;
    private _selSrcExists;
    protected _dbEdgeSrcExists(src: NodeId): boolean;
    protected _dbEdgeDistinctSrcCount(): number;
    protected _dbGetHalo(id: NodeId): {
        vec: Uint8Array;
        mass: number;
    } | null;
    protected _dbUpsertHalo(id: NodeId, encodedVec: Uint8Array, mass: number): void;
    protected _dbGetMeta(key: string): string | null;
    protected _dbSetMeta(key: string, val: string): void;
    protected _dbDeleteMeta(key: string): void;
    protected _dbSaveSnapshot(bytes: Uint8Array): void;
    protected _dbLoadSnapshot(): Uint8Array | null;
    protected _vecContentUpsert(entries: Array<{
        id: NodeId;
        vector: Float32Array;
        ef?: number;
    }>): void;
    protected _vecContentQuery(v: Float32Array, k: number, ef: number): Array<{
        id: number;
        distance: number;
    }>;
    protected _vecContentHas(id: NodeId): boolean;
    protected _vecContentSize(): number;
    protected _vecContentLastReads(): number;
    protected _vecContentPhysicalSize(): number;
    protected _vecContentCompact(): void;
    protected _vecContentDeleteMany(ids: NodeId[]): void;
    protected _vecContentEntriesSince(after: number): IterableIterator<{
        ext: NodeId;
        internal: number;
    }>;
    /** {@link AbstractStore._dbEdgeOrHaloIds} — one C-side scan; UNION dedups
     *  and (with the ORDER BY) sorts, so the result is ready for the binary-
     *  search membership probes and the ascending-id maintenance walks. */
    protected _dbEdgeOrHaloIds(): NodeId[];
    protected _vecHaloUpsert(entries: Array<{
        id: NodeId;
        vector: Float32Array;
    }>): void;
    protected _vecHaloQuery(v: Float32Array, k: number, ef: number): Array<{
        id: number;
        distance: number;
    }>;
    protected _vecHaloSize(): number;
    protected _vecHaloPhysicalSize(): number;
    protected _vecHaloCompact(): void;
    /** Pre-fill both vector indices' RAM caches with sequential scans (up to
     *  their budget caps) — seconds of streaming instead of the minutes of
     *  random point reads a cold training/query session otherwise pays while
     *  warming.  Optional; call once after open before sustained work.
     *  Returns rows warmed. */
    warmVectorCaches(): Promise<number>;
}
