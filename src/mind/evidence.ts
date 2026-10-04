// evidence.ts — what of a stored form the material at hand WITNESSES.
//
// A stored form is WITNESSED by some material when every one of its bytes lies
// inside a W-window that occurs literally in that material — in any order, at
// any place.  It is the order-free reading of correspondence (`alignRuns` is
// its run-producing sibling, `junctionContainersFrom(…, unordered)` its
// container-finding one): a learnt form is evidenced by bytes that hold all of
// its windows, whichever way the asker happened to arrange them.
//
// The material is a LIST of sources because what a derivation has at hand is
// more than the question: the node it stands on is material too.  A trained
// question `Edmond T. Gréville place of death` is in neither the asker's
// `Where was the place of death of the director of film Beat Girl?` nor the
// fact `The director of Beat Girl is Edmond T. Gréville.` the first hop reached
// — and both together hold every byte of it.  The witness records which source
// held each window, so a consumer can tell the question's share (what the asker
// SAID about the form) from what the derivation itself brought.
//
// Exact, deterministic and linear: one window index per source, one probe per
// window of the form.  Below one window a byte agreement is chance (the floor
// identityBar, attestedQ and the site test all draw), so a form shorter than W
// is never witnessed.
//
// Layering: bytes only — importable from traverse.ts and everything above it.

import { latin1 } from "../bytes.js";

/** Where each W-window of one source first occurs.  Built once per source and
 *  reused across every form asked against it. */
export type WindowIndex = Map<string, number>;

export function windowIndex(bytes: Uint8Array, W: number): WindowIndex {
  const index: WindowIndex = new Map();
  for (let o = 0; o + W <= bytes.length; o++) {
    const key = latin1(bytes.subarray(o, o + W));
    if (!index.has(key)) index.set(key, o);
  }
  return index;
}

/** The windows of `index` (over `bytes`) that `spoken` does not hold — what
 *  of the question no product of the derivation has restated yet.  The keys
 *  keep their positions in `bytes`, so a witnessing span still names the
 *  asker's bytes. */
export function unspoken(
  index: WindowIndex,
  spoken: ReadonlyArray<WindowIndex>,
): WindowIndex {
  const out: WindowIndex = new Map();
  for (const [key, at] of index) {
    if (!spoken.some((s) => s.has(key))) out.set(key, at);
  }
  return out;
}

/** How a form is witnessed by a list of sources. */
export interface Witnessing {
  /** Every byte of the form lies in a window some source holds. */
  complete: boolean;
  /** The windows SOURCE 0 alone supplied — windows no later source holds — as
   *  merged spans of source 0.  With the question as source 0, this is what the
   *  asker said about the form that the derivation did not already have. */
  spans: Array<[number, number]>;
  /** Bytes of source 0 inside `spans`. */
  bytes: number;
  /** The form's own bytes no source witnesses, as merged spans of the FORM —
   *  empty exactly when `complete`.  ONE residue span is the shape of a
   *  co-instance: the same frame around a different filler (`When was Peter
   *  Jackson born?` read against `When was the director of film Jinpa
   *  born?` leaves `Peter Jackson`). */
  residue: Array<[number, number]>;
}

/** Witness `form` against `sources` (their window indexes, same order).  A
 *  window is credited to the LAST source holding it — so source 0 is credited
 *  only with what nothing else at hand supplies. */
export function witness(
  form: Uint8Array,
  indexes: ReadonlyArray<WindowIndex>,
  W: number,
): Witnessing {
  if (form.length < W || indexes.length === 0) {
    return {
      complete: false,
      spans: [],
      bytes: 0,
      residue: form.length > 0 ? [[0, form.length]] : [],
    };
  }
  const covered = new Uint8Array(form.length);
  const own: Array<[number, number]> = [];
  for (let o = 0; o + W <= form.length; o++) {
    const key = latin1(form.subarray(o, o + W));
    let at = -1;
    let from = -1;
    for (let s = indexes.length - 1; s >= 0; s--) {
      const p = indexes[s].get(key);
      if (p !== undefined) {
        at = p;
        from = s;
        break;
      }
    }
    if (from < 0) continue;
    covered.fill(1, o, o + W);
    if (from === 0) own.push([at, at + W]);
  }
  const residue: Array<[number, number]> = [];
  for (let i = 0; i < form.length; i++) {
    if (covered[i]) continue;
    const last = residue[residue.length - 1];
    if (last !== undefined && last[1] === i) last[1] = i + 1;
    else residue.push([i, i + 1]);
  }
  own.sort((a, b) => a[0] - b[0]);
  const spans: Array<[number, number]> = [];
  for (const [s, e] of own) {
    const last = spans[spans.length - 1];
    if (last !== undefined && s <= last[1]) last[1] = Math.max(last[1], e);
    else spans.push([s, e]);
  }
  let bytes = 0;
  for (const [s, e] of spans) bytes += e - s;
  return { complete: residue.length === 0, spans, bytes, residue };
}
