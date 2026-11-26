// memo.ts — the one structure of every memo kept for a LIFETIME (caches.md).
//
// A memo of this kind belongs to an object and dies with it: a response
// (`ctx.climbMemo`), a store state (`ctx._structMemoKey`, renewed by every
// write), a question (`ctx._edgeAsked`, its points), a space.  What is kept
// is each memo's own; how it is kept, budgeted and dropped is said here, once.

/** A memo kept per life: made on the first ask, renewed whole once `spent`
 *  says its budget is gone, collected with the life it was kept for.  A miss
 *  only computes again — never another answer. */
export class LifeMemo<T> {
  private readonly at = new WeakMap<object, T>();
  constructor(
    private readonly make?: () => T,
    private readonly spent?: (kept: T) => boolean,
  ) {}
  /** What is kept for `life`, made now (by `make`, else the memo's own) on
   *  the first ask or past the budget. */
  of(life: object, make: () => T = this.make!): T {
    const kept = this.at.get(life);
    if (kept !== undefined && this.spent?.(kept) !== true) return kept;
    return this.put(life, make());
  }
  /** What is kept for `life`, or undefined: for a memo that holds one value
   *  per life and decides itself when to read it again. */
  peek(life: object): T | undefined {
    return this.at.get(life);
  }
  /** Keep `value` for `life`, in place of whatever was kept. */
  put(life: object, value: T): T {
    this.at.set(life, value);
    return value;
  }
}

/** A map whose entries vary in size, charged in BYTES to a shared account
 *  when set — so a hit costs what a plain Map's does, and the memo holding it
 *  is dropped whole at its budget ({@link LifeMemo}'s `spent`). */
export class MemoMap<K, V> extends Map<K, V> {
  constructor(
    readonly spent: { bytes: number },
    private readonly sizeOf: (v: V) => number,
  ) {
    super();
  }
  override set(k: K, v: V): this {
    if (!super.has(k)) this.spent.bytes += this.sizeOf(v);
    return super.set(k, v);
  }
}
