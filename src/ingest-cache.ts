// ingest-cache.ts — ingest-level cache for Mind.
//
// Wraps a Mind and memoises the expensive, content-determined half of ingestion:
// turning ONE input into its interned graph nodes.  The memo serves a pair's
// CONTINUATION; a context and a bare experience always deposit through the
// Mind, which tracks what they change (`_prevSeen`) and folds a growing context
// from its cached prefix.  Perception (riverFold) and interning are a PURE function
// of the input bytes — the same bytes always cut the same way and hash-cons to
// the same node ids — so the result can be cached by content and reused wherever
// those same bytes appear again, in ANY role.
//
// This is why the cache keys on the single input, not on the (context,
// continuation) pair: real training corpora repeat content at the INPUT level far
// more than at the pair level — a shared system/tool preamble in front of every
// row, a common answer ("Yes.", a refusal) under many questions, an accumulated
// dialogue prefix, an exactly-duplicated row.  A pair-level key sees none of these
// (the pair as a whole is almost always unique); the input-level key catches the
// repeated answers.
//
// On a cache hit the learning itself still runs — the pair through the Mind's
// own `ingestPair` — while the continuation's perceive + internTree work (the dominant cost, and on a large store the dominant
// VECTOR-INDEX cost too) is skipped entirely.  The interned node ids are stable
// across eviction: a re-perceive of evicted content reproduces the same ids by
// the store's hash-cons, so correctness never depends on a hit.
//
// DEPOSITION IS THE MIND'S OWN: every miss goes through the same
// {@link deposit} the direct Mind.ingest path uses — perception, interning,
// sub-span/window indexing, durable CONTAINMENT edges, whole-stream flat
// branch, changed-node tracking against the Mind's `_prevSeen` — and every pair
// through the Mind's own `ingestPair`, so a store trained through this cache is
// IDENTICAL to one trained by calling mind.ingest() directly (this class used
// to re-implement the deposit, then the pair law, and drifted both times).
// Only the memo layer lives here.  Behaviour is identical to mind.ingest() (links
// and halos are reinforced on every call), just faster when content repeats.

import { Mind } from "./mind/index.js";
import {
  deposit,
  dispatchIngest,
  ingestOne as depositOne,
  ingestPair as learnPair,
} from "./mind/learning.js";
import type { Sema } from "./sema.js";
import type { Input } from "./mind/index.js";
import { BoundedMap } from "./store.js";
import { latin1 } from "./bytes.js";
import type { Vec } from "./vec.js";
import { invalidateStructuralCaches } from "./mind/traverse.js";

/** The interned result of perceiving + interning ONE input.
 *
 *  Only the root vector and the node ids are kept — the full Sema tree (hundreds
 *  of nodes) is GC'd.  `rootV` is needed for the halo binds (a pair seats each
 *  side's gist into the other's halo) and for the Sema returned by a single
 *  ingest; `partIds` are the root's immediate children, the chain a single
 *  experience links together (`[rootId]` when the root is itself a leaf). */
interface Interned {
  rootV: Vec;
  rootId: number;
  partIds: number[];
  /** Byte cost of the memo KEY this entry is stored under.  The key of a
   *  string input is the whole input ("S:" + text), so on long continuations
   *  it dwarfs the value — charging it to the LRU budget is what keeps the
   *  memo's real memory at ingestCacheBytes instead of a multiple of it. */
  keyBytes: number;
}

/**
 * An ingest cache layered over a Mind.
 *
 * Usage (drop-in for mind.ingest in training loops):
 *   const ci = new CachedIngest(mind);
 *   await ci.ingest(ctx, cont);       // memoises the continuation
 *   await ci.ingest("some text");     // deposits through the Mind
 *   await ci.ingest([[ctx, cont]]);   // array form
 *
 * All other Mind methods (respond, save, …) are accessed on `ci.mind`.
 */
export class CachedIngest {
  readonly mind: Mind;

  /** One unified, content-addressed memo of interned inputs.  Each value holds
   *  Float32 root vector (D·4 bytes) plus a small id array, so the byte budget
   *  is spent on the inputs most worth remembering (LRU). */
  private _memo!: BoundedMap<string, Interned>;

  hits = 0;
  misses = 0;

  constructor(mind: Mind) {
    this.mind = mind;
    this._memo = this.newMemo();
  }

  private newMemo(): BoundedMap<string, Interned> {
    return new BoundedMap<string, Interned>(
      this.mind.cfg.store.ingestCacheBytes,
      (c) => c.rootV.byteLength + c.partIds.length * 4 + 8 + c.keyBytes,
    );
  }

  // ── cache key ───────────────────────────────────────────────────────────
  // Content key for an input, or null when the input cannot be keyed reliably
  // — in which case it BYPASSES the cache (recomputed every time) rather than
  // risk a collision returning the wrong nodes.  A string is its own key; raw
  // bytes hash by FNV-1a (+ length, so a hash collision still needs an equal
  // length to alias); a Grid / Grid[] has no cheap stable key, so it bypasses.

  private keyOf(input: Input): string | null {
    if (typeof input === "string") return "S:" + input;
    // The CONTENT is the key, as for a string: a hash is a label, and two
    // inputs sharing one would be learnt as one node.
    if (input instanceof Uint8Array) return "B:" + latin1(input);
    return null; // Grid / Grid[] — bypass the cache
  }

  // ── public API ────────────────────────────────────────────────────────

  async ingest(
    input: Input | (Input | [Input, Input])[],
    second?: Input,
  ): Promise<(Sema & { id: number }) | undefined> {
    await this.mind.repairDerived();
    invalidateStructuralCaches(this.mind);
    // One shape-reading for both ingest paths — see {@link dispatchIngest}.
    return dispatchIngest(
      input,
      second,
      (i) => this.ingestOne(i),
      (a, b) => this.ingestPair(a, b),
    );
  }

  // ── the one cached step: perceive + intern + index ONE input ──────────────

  /** Resolve an input to its interned nodes, from the memo when its content has
   *  been seen before, else by the Mind's OWN untracked {@link deposit}
   *  (perceive + intern + sub-span/containment indexing — identical to the
   *  direct path; those writes are durable and idempotent, so a later memo hit
   *  legitimately skips them).  This is the single expensive operation both
   *  ingest paths share; caching it here is what makes every repeated input —
   *  in any role — cheap. */
  private async resolveInput(input: Input): Promise<Interned> {
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
    const partIds: number[] = tree.kids
      ? tree.kids.map((k) => ids.get(k)!)
      : [rootId];

    const entry: Interned = {
      rootV: tree.v,
      rootId,
      partIds,
      // ~2 bytes per UTF-16 code unit — the key is retained by the map.
      keyBytes: key !== null ? key.length * 2 : 0,
    };
    if (key !== null) this._memo.set(key, entry);
    return entry;
  }

  // ── pair ingest ───────────────────────────────────────────────────────

  private async ingestPair(ctx: Input, cont: Input): Promise<void> {
    // The Mind's own pair law; only the continuation's deposit is memoised.
    await learnPair(
      this.mind,
      ctx,
      cont,
      async (input) => (await this.resolveInput(input)).rootId,
    );
  }

  // ── one-side ingest ───────────────────────────────────────────────────

  private async ingestOne(input: Input): Promise<Sema & { id: number }> {
    // A bare experience is the direct path verbatim — tracked deposit, root
    // marked a resonance target, part chain linked at the maxGroup stride.
    // (The tracked side is a memo miss by design, so there is nothing for the
    // cache to add here.)
    return depositOne(this.mind, input);
  }

  // ── helpers ───────────────────────────────────────────────────────────

  clear(): void {
    this._memo = this.newMemo();
  }

  get size(): number {
    return this._memo.size;
  }
}
