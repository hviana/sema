// ingest-cache.ts — ingest-level cache for Mind.
//
// Wraps a Mind and memoises the expensive, content-determined half of ingestion:
// turning ONE input (a context, a continuation, or a bare experience) into its
// interned graph nodes.  Perception (riverFold) and interning are a PURE function
// of the input bytes — the same bytes always cut the same way and hash-cons to
// the same node ids — so the result can be cached by content and reused wherever
// those same bytes appear again, in ANY role.
//
// This is why the cache keys on the single input, not on the (context,
// continuation) pair: real training corpora repeat content at the INPUT level far
// more than at the pair level — a shared system/tool preamble in front of every
// row, a common answer ("Yes.", a refusal) under many questions, an accumulated
// dialogue prefix, an exactly-duplicated row.  A pair-level key sees none of these
// (the pair as a whole is almost always unique); the input-level key catches them
// all, and a context that recurs as a continuation (or vice versa) hits too.
//
// On a cache hit only the cheap relational writes are replayed — the edge and the
// two halo pours for a pair, or the part-chain links for a single — while the
// perceive + internTree work (the dominant cost, and on a large store the dominant
// VECTOR-INDEX cost too) is skipped entirely.  The interned node ids are stable
// across eviction: a re-perceive of evicted content reproduces the same ids by
// the store's hash-cons, so correctness never depends on a hit.
//
// DEPOSITION IS THE MIND'S OWN: every miss goes through the same
// {@link deposit} the direct Mind.ingest path uses — perception, interning,
// sub-span/window indexing, durable CONTAINMENT edges, whole-stream flat
// branch, changed-node tracking against the Mind's `_prevSeen` — so a store
// trained through this cache is structurally IDENTICAL to one trained by
// calling mind.ingest() directly (this class used to re-implement the deposit
// and drifted: no indexSubSpans/addContainer, wrong part-link stride).  Only
// the memo layer lives here.  Behaviour is identical to mind.ingest() (links
// and halos are reinforced on every call), just faster when content repeats.
import { deposit, dispatchIngest, ingestOne as depositOne, } from "./mind/learning.js";
import { bindSeat, companySignature } from "./sema.js";
import { BoundedMap } from "./store.js";
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
export class CachedIngest {
    mind;
    /** One unified, content-addressed memo of interned inputs.  Each value holds
     *  Float32 root vector (D·4 bytes) plus a small id array, so the byte budget
     *  is spent on the inputs most worth remembering (LRU). */
    _memo;
    hits = 0;
    misses = 0;
    constructor(mind) {
        this.mind = mind;
        this._memo = this.newMemo();
    }
    newMemo() {
        return new BoundedMap(this.mind.cfg.store.ingestCacheBytes, (c) => c.rootV.byteLength + c.partIds.length * 4 + 8 + c.keyBytes);
    }
    // ── cache key ───────────────────────────────────────────────────────────
    // Content key for an input, or null when the input cannot be keyed reliably
    // — in which case it BYPASSES the cache (recomputed every time) rather than
    // risk a collision returning the wrong nodes.  A string is its own key; raw
    // bytes hash by FNV-1a (+ length, so a hash collision still needs an equal
    // length to alias); a Grid / Grid[] has no cheap stable key, so it bypasses.
    keyOf(input) {
        if (typeof input === "string")
            return "S:" + input;
        if (input instanceof Uint8Array) {
            // FNV-1a — no spread onto the call stack, safe on large binary inputs.
            let h = 0x811c9dc5 >>> 0;
            for (let i = 0; i < input.length; i++) {
                h ^= input[i];
                h = Math.imul(h, 0x01000193) >>> 0;
            }
            return "B:" + (h >>> 0).toString(16) + ":" + input.length;
        }
        return null; // Grid / Grid[] — bypass the cache
    }
    // ── public API ────────────────────────────────────────────────────────
    async ingest(input, second) {
        // One shape-reading for both ingest paths — see {@link dispatchIngest}.
        return dispatchIngest(input, second, (i) => this.ingestOne(i), (a, b) => this.ingestPair(a, b));
    }
    // ── the one cached step: perceive + intern + index ONE input ──────────────
    /** Resolve an input to its interned nodes, from the memo when its content has
     *  been seen before, else by the Mind's OWN untracked {@link deposit}
     *  (perceive + intern + sub-span/containment indexing — identical to the
     *  direct path; those writes are durable and idempotent, so a later memo hit
     *  legitimately skips them).  This is the single expensive operation both
     *  ingest paths share; caching it here is what makes every repeated input —
     *  in any role — cheap. */
    async resolveInput(input) {
        const key = this.keyOf(input);
        if (key !== null) {
            const cached = this._memo.get(key);
            if (cached) {
                this.hits++;
                return cached;
            }
        }
        this.misses++;
        // The full deposit, untracked (a continuation must not break the tracked
        // deposit chain).  `partIds` are the root's immediate children, already
        // interned by the deposit — free to capture.  Only the root vector and
        // ids are retained; the tree is GC'd.
        const { tree, rootId, ids } = await deposit(this.mind, input, false);
        const partIds = tree.kids
            ? tree.kids.map((k) => ids.get(k))
            : [rootId];
        const entry = {
            rootV: tree.v,
            rootId,
            partIds,
            // ~2 bytes per UTF-16 code unit — the key is retained by the map.
            keyBytes: key !== null ? key.length * 2 : 0,
        };
        if (key !== null)
            this._memo.set(key, entry);
        return entry;
    }
    // ── pair ingest ───────────────────────────────────────────────────────
    async ingestPair(ctx, cont) {
        // The CONTEXT side is TRACKED (it continues the Mind's deposit chain and
        // is the growing, unique-per-turn side — a cache miss anyway), via the
        // same {@link deposit} the direct path uses; the continuation resolves
        // through the memo.
        const c = await deposit(this.mind, ctx, true);
        const b = await this.resolveInput(cont);
        // EDGE on the FULL context (disambiguates a shared pivot). HALO only on the
        // CHANGED NODES — the coherent new subtrees this turn adds — so a recurring
        // shared prefix never collects halo mass. (See Mind.ingestPair.)
        await this.mind.store.link(c.rootId, b.rootId);
        // Halos pour company SIGNATURES (identity), not gists (content) — see
        // companySignature in sema.ts.
        const contSeat = bindSeat(this.mind.space, companySignature(this.mind.space, b.rootId), 1);
        for (const part of c.changed) {
            const partId = c.ids.get(part);
            await this.mind.store.pourHalo(partId, contSeat);
            await this.mind.store.pourHalo(b.rootId, bindSeat(this.mind.space, companySignature(this.mind.space, partId), 0));
        }
    }
    // ── one-side ingest ───────────────────────────────────────────────────
    async ingestOne(input) {
        // A bare experience is the direct path verbatim — tracked deposit, root
        // marked a resonance target, part chain linked at the maxGroup stride.
        // (The tracked side is a memo miss by design, so there is nothing for the
        // cache to add here.)
        return depositOne(this.mind, input);
    }
    // ── helpers ───────────────────────────────────────────────────────────
    clear() {
        this._memo = this.newMemo();
    }
    get size() {
        return this._memo.size;
    }
}
