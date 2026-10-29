// role.ts — ROLE ⊗ FRAME: what a span IS, read from where it stands.
//
// The gist and the halo are both first-order superpositions: the gist adds
// positionally bound bytes, the halo adds the company a whole was deposited
// in.  Neither says what a span is used AS.  `Father` the film and `father`
// the relation share their bytes up to case and keep company with the same
// people, yet the corpus never stands them in the same place: the film stands
// before ` director`, the relation after `the ` and before ` of`.
//
// A ROLE PROFILE is the second-order reading of that: every stored, non-hub
// W-window around a span, bound to the seat of WHERE it stands from the span —
// left or right, by distance in windows — and superposed.  A window alone is
// a frame word; bound to its side it is a role.  Probed on the trained store
// (23 films, 25 people from the 2Wiki facts): the same windows unbound tell
// the two kinds apart at AUC 0.54–0.57 and put 3–55% of film/person pairs
// past `conceptThreshold`; bound to their side, AUC 0.77–0.83 and 0–3%.
//
// Every term is a company signature keyed on a window's IDENTITY, so spelling
// cannot leak into role, and two unrelated profiles meet at chance, 1/√D: the
// null model `significanceBar` is derived for.  The profile is read from the
// structure at question time — the deposits holding the form — so it needs
// no training, no store change and no index.

import { addInto, cosine, Vec } from "../vec.js";
import { bindSeat, companySignature } from "../sema.js";
import { phraseCap, significanceBar } from "../geometry.js";
import { indexOf } from "../bytes.js";
import { chainReach, windowIds } from "./canonical.js";
import { read } from "./primitives.js";
import { hubWindows, oldestContexts, windowRarity } from "./traverse.js";
import type { MindContext } from "./types.js";

/** A role, side by side: what frames a span on its left and on its right,
 *  each null where nothing does.  The sides are kept apart because a span is
 *  often framed on one side only — a question's entity before its `?`, a
 *  deposit's entity before its relation — and two profiles read on different
 *  sides have not disagreed: neither has been read where the other was. */
type Role = [left: Vec | null, right: Vec | null];

/** The role profile of `[from, to)` inside `bytes`: each stored, non-hub
 *  W-window of the span's neighbourhood — `seats/2` windows a side — bound to
 *  the seat of its distance from the span (the left side the lower half of
 *  the keyring, the right side the upper half) and superposed, unnormalized so
 *  several occurrences add.  A window overlapping the span is the span itself,
 *  not where it stands, and is skipped. */
function roleIn(
  ctx: MindContext,
  bytes: Uint8Array,
  from: number,
  to: number,
): Role {
  const W = ctx.space.maxGroup;
  const half = ctx.space.seats.length >> 1;
  const hub = hubWindows(ctx, bytes);
  const role: Role = [null, null];
  for (const [o, id] of windowIds(ctx, bytes)) {
    if (hub[o]) continue;
    const side = o + W <= from ? 0 : o >= to ? 1 : null;
    if (side === null) continue;
    const d = Math.floor((side === 0 ? from - o - W : o - to) / W);
    if (d >= half) continue;
    const term = bindSeat(
      ctx.space,
      companySignature(ctx.space, id),
      side * half + d,
    );
    role[side] = role[side] === null ? term : addInto(role[side]!, term);
  }
  if (ctx.meter && (role[0] !== null || role[1] !== null)) {
    ctx.meter.roleReads++;
  }
  return role;
}

/** The role a stored form plays in the corpus: {@link roleIn} over the deposits
 *  that hold its bytes — the oldest `chainReach(W)` tops above its rarest
 *  window (`oldestContexts`), so the read is constant in the corpus.  A deposit
 *  is read whether or not it leads on: a role is where a form is written, and a
 *  continuation writes it as much as a context does (`The father of Ollanta
 *  Humala is …` stands the entity before ` is `, its context `Ollanta Humala
 *  father` before ` father`).  A pure function of the read-only store, kept for
 *  the response's lifetime, as the climb is (`climbMemo`). */
function roleOf(ctx: MindContext, id: number): Role {
  const life = ctx.climbMemo;
  let memo: Map<number, Role> | undefined;
  if (life !== null) {
    memo = roleMemo.get(life);
    if (memo === undefined) roleMemo.set(life, memo = new Map());
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
  }
  const W = ctx.space.maxGroup;
  const form = read(ctx, id);
  let rarest: number | null = null;
  let fewest = Infinity;
  const cap = chainReach(W) + 1;
  for (const wid of windowIds(ctx, form).values()) {
    const r = windowRarity(ctx, wid, cap);
    if (r > 0 && r < fewest) [fewest, rarest] = [r, wid];
  }
  const role: Role = [null, null];
  // A holder is read only as far as a role can look past one occurrence near
  // its start (`phraseCap` and the neighbourhood each side): a holder that is
  // a whole document costs no more than a phrase.
  const reach = phraseCap(form.length, W) + ctx.space.seats.length * W;
  const holders = rarest === null
    ? []
    : oldestContexts(ctx, rarest, chainReach(W), false);
  for (const c of holders) {
    const bytes = read(ctx, c, reach);
    const at = indexOf(bytes, form, 0);
    if (at < 0) continue;
    const r = roleIn(ctx, bytes, at, at + form.length);
    for (const side of [0, 1] as const) {
      const v = r[side];
      if (v !== null) {
        role[side] = role[side] === null ? v : addInto(role[side]!, v);
      }
    }
  }
  memo?.set(id, role);
  return role;
}
const roleMemo = new WeakMap<object, Map<number, Role>>();

/** Whether a span of the question stands where the stored form `id` stands,
 *  read on the sides both are framed on: true when a shared side meets past
 *  chance (`significanceBar` — the profiles are identity-keyed, so unrelated
 *  ones meet at 1/√D), false when every shared side falls below it, null when
 *  they share no side.  It reads, never decides: the caller says what a
 *  disagreement refutes. */
export function rolesAgree(
  ctx: MindContext,
  query: Uint8Array,
  from: number,
  to: number,
  id: number,
): boolean | null {
  const asked = roleIn(ctx, query, from, to);
  if (asked[0] === null && asked[1] === null) return null;
  const stored = roleOf(ctx, id);
  const bar = significanceBar(ctx.store.D);
  let framed = false;
  for (const side of [0, 1] as const) {
    const a = asked[side], b = stored[side];
    if (a === null || b === null) continue;
    if (cosine(a, b) >= bar) return true;
    framed = true;
  }
  return framed ? false : null;
}
