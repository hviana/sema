import { Mind } from "./mind/index.js";
import { type Sema } from "./sema.js";
import type { Input } from "./mind/index.js";
/**
 * An ingest cache layered over a Mind.
 *
 * Usage (drop-in for mind.ingest in training loops):
 *   const ci = new CachedIngest(mind);
 *   await ci.ingest(ctx, cont);       // caches both sides
 *   await ci.ingest("some text");     // caches the single text
 *   await ci.ingest([[ctx, cont]]);   // array form
 *
 * All other Mind methods (respond, save, …) are accessed on `ci.mind`.
 */
export declare class CachedIngest {
    readonly mind: Mind;
    /** One unified, content-addressed memo of interned inputs.  Each value holds
     *  Float32 root vector (D·4 bytes) plus a small id array, so the byte budget
     *  is spent on the inputs most worth remembering (LRU). */
    private _memo;
    hits: number;
    misses: number;
    constructor(mind: Mind);
    private newMemo;
    private keyOf;
    ingest(input: Input | (Input | [Input, Input])[], second?: Input): Promise<(Sema & {
        id: number;
    }) | undefined>;
    /** Resolve an input to its interned nodes, from the memo when its content has
     *  been seen before, else by the Mind's OWN untracked {@link deposit}
     *  (perceive + intern + sub-span/containment indexing — identical to the
     *  direct path; those writes are durable and idempotent, so a later memo hit
     *  legitimately skips them).  This is the single expensive operation both
     *  ingest paths share; caching it here is what makes every repeated input —
     *  in any role — cheap. */
    private resolveInput;
    private ingestPair;
    private ingestOne;
    clear(): void;
    get size(): number;
}
