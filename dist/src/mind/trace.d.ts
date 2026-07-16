import type { MindContext } from "./types.js";
import type { DerivationStep } from "./graph-search.js";
import type { RationaleItem } from "./rationale.js";
export declare function rItem(bytes: Uint8Array, role?: string, node?: number, span?: [number, number]): RationaleItem;
export declare function rNode(ctx: MindContext, id: number, role?: string, score?: number): RationaleItem;
export declare function rDeriv(ctx: MindContext, it: DerivationStep["conclusion"], role?: string): RationaleItem;
/** The standard FALL-THROUGH closer every self-gating mechanism ends with:
 *  close the open scope with no outputs and the reason, and return null so
 *  the caller can `return fail("…")` in one expression.  `t` is the scope an
 *  enclosing `ctx.trace?.enter(...)` returned (undefined when not tracing). */
export declare function traceFail(t: {
    done(outputs: RationaleItem[], note?: string): void;
} | undefined): (note: string) => null;
export declare const MOVE_NOTE: Record<string, string>;
export declare function traceDerivation(ctx: MindContext, steps: ReadonlyArray<DerivationStep>): void;
