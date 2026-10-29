// role.ts — ROLE ⊗ FRAME: what a span IS, read from where it stands.
//
// The gist and the halo are both first-order superpositions: the gist adds
// positionally bound bytes, the halo adds the company a whole was deposited
// in.  Neither says what a span is used AS.  `Father` the film and `father`
// the relation share their bytes up to case and keep company with the same
// people, yet the corpus never stands them in the same place: the film stands
// before ` director`, the relation after `the ` and before ` of`.
//
// A ROLE PROFILE is the second-order reading of that: every stored W-window
// around a span, bound to the seat of WHERE it stands from the span — left or
// right, by distance in windows — and superposed.  A window alone is a frame
// word; bound to its side it is a role.  The unit is the WHOLE span: measured
// on 100K replayed deposits (80 films, 80 people from the 2Wiki facts), the
// span's role tells the two kinds apart at AUC 0.96, against 0.67–0.70 for
// roles kept per window or per fold node, which only see their own spelling.
//
// THE FRAME WORDS ARE THE ROLE, SO NO WINDOW IS DROPPED AS A HUB.  The common
// windows around a span (` of `, ` director`) are what say what it is; dropping
// them, as a halo drops its hubs, leaves the entity's own neighbours and takes
// the same measurement to AUC 0.51 — chance.  The price is the null model:
// unrelated roles share those common windows and meet ABOVE chance (film
// against person: mean 0.11, 55% past `significanceBar`), while roles of one
// kind meet at 0.52, all past it.  So a role is read one way only: two roles
// below `significanceBar` share no frame — evidence of different use — and
// anything above proves nothing (see {@link rolesAgree}).
//
// Every term is a company signature keyed on a window's IDENTITY, so spelling
// cannot leak into role.  The profile is read from the structure at question
// time — the deposits holding the form — so it needs no training, no store
// change and no index.

import { addInto, cosine, Vec } from "../vec.js";
import { bindSeat, companySignature } from "../sema.js";
import { phraseCap, significanceBar } from "../geometry.js";
import { indexOf } from "../bytes.js";
import { chainReach, windowIds } from "./canonical.js";
import { read } from "./primitives.js";
import { oldestContexts, windowRarity } from "./traverse.js";
import type { MindContext } from "./types.js";

/** A role, side by side: what frames a span on its left and on its right,
 *  each null where nothing does.  The sides are kept apart because a span is
 *  often framed on one side only — a question's entity before its `?`, a
 *  deposit's entity before its relation — and two profiles read on different
 *  sides have not disagreed: neither has been read where the other was. */
type Role = [left: Vec | null, right: Vec | null];

/** The role profile of `[from, to)` inside `bytes`: each stored W-window of
 *  the span's neighbourhood — `seats/2` windows a side — bound to the seat of
 *  its distance from the span (the left side the lower half of the keyring,
 *  the right side the upper half) and superposed, unnormalized so several
 *  occurrences add.  A window overlapping the span is the span itself, not
 *  where it stands, and is skipped. */
function roleIn(
  ctx: MindContext,
  bytes: Uint8Array,
  from: number,
  to: number,
): Role {
  const W = ctx.space.maxGroup;
  const half = ctx.space.seats.length >> 1;
  const role: Role = [null, null];
  for (const [o, id] of windowIds(ctx, bytes)) {
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

/** The role a stored form plays in the corpus: {@link roleIn} over the
 *  deposits that write its bytes, at most `chainReach(W)` of them.  The tops
 *  above the form's own node hold it by construction and are read first; the
 *  form written under other cuts is reached through its windows, the `W`
 *  rarest — a window's holders need not hold the form (`othe` is held by
 *  `Rothes` as much as by `Mother`), so those are decided by their bytes.
 *  Every top is taken, whether or not it leads on (`oldestContexts`): a
 *  continuation writes a form as much as a context does.  A holder is read
 *  only as far as a role can look past one occurrence near its start, so the
 *  reads are constant in the corpus: at most `W + 1` climbs of `chainReach(W)`.
 *  A pure function of the read-only store, kept for the response's lifetime,
 *  as the climb is (`climbMemo`). */
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
  const allowance = chainReach(W);
  const form = read(ctx, id);
  const windows = [...windowIds(ctx, form).values()]
    .map((wid) => ({ wid, rarity: windowRarity(ctx, wid, allowance + 1) }))
    .filter((w) => w.rarity > 0)
    .sort((a, b) => a.rarity - b.rarity)
    .slice(0, W)
    .map((w) => w.wid);
  const reach = phraseCap(form.length, W) + ctx.space.seats.length * W;
  const role: Role = [null, null];
  const seen = new Set<number>();
  let held = 0;
  for (const seed of [id, ...windows]) {
    for (const c of oldestContexts(ctx, seed, allowance, false)) {
      if (held >= allowance) break;
      if (seen.has(c)) continue;
      seen.add(c);
      const bytes = read(ctx, c, reach);
      const at = indexOf(bytes, form, 0);
      if (at < 0) continue;
      held++;
      const r = roleIn(ctx, bytes, at, at + form.length);
      for (const side of [0, 1] as const) {
        const v = r[side];
        if (v !== null) {
          role[side] = role[side] === null ? v : addInto(role[side]!, v);
        }
      }
    }
    if (held >= allowance) break;
  }
  memo?.set(id, role);
  return role;
}
const roleMemo = new WeakMap<object, Map<number, Role>>();

/** Whether a span of the question stands where the stored form `id` stands,
 *  read on the sides both are framed on: false when ANY shared side meets
 *  below `significanceBar` — on that side the two share no frame, so they are
 *  used differently — true when every shared side meets above it, null when
 *  they share no side.  One side is not enough to agree: a generic frame
 *  (`the ·`) is shared by a relation and a film alike, and only the other side
 *  tells them apart (measured on the 100K replay: refusing on any side refuses
 *  53% of film/person pairs and none of one kind; requiring both, 44%).  Only
 *  `false` is evidence — unrelated roles share the corpus's common frame
 *  windows and often meet above the bar (see the module note).  It reads,
 *  never decides: the caller says what a disagreement refutes. */
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
    if (cosine(a, b) < bar) return false;
    framed = true;
  }
  return framed ? true : null;
}
