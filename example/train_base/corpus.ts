// train_base/corpus.ts — WHAT A CORPUS IS: the contract every corpus file
// declares, and the resume identity derived from it.
//
// Separated from the loop that consumes it (stage.ts) so a corpus file never
// imports the loop. A corpus declares three things the loop does not know —
// where its work-list comes from, what container its bytes are in, and how a row
// becomes deposits — and everything here exists to state those three.
//
// THE RESUME IDS ARE A COMPATIBILITY SURFACE. A store records the units it has
// finished as strings, and a store trained by an earlier version must keep
// resuming, so `unitIdOf` below has to reproduce the ids that store already
// holds. It does, by one rule with no exceptions: `${corpus.id}::${unit.key}`.
//
// That single rule is a recent simplification, and the evidence for it is worth
// keeping. There used to be a second mechanism — a `Corpus.unitId` field
// carrying a FIXED id for the three single-unit corpora, which were believed
// irregular — and with it a trap: those corpora emitted `key: ""` on the
// assumption that the fixed id would always override, so a new single-unit
// corpus that forgot the field silently got the id "foo::". Reading the ids out
// of a real 2.5 GB store settled it: the three are `aya::dataset`,
// `oasst2::trees` and `genknow::qa`, which decompose EXACTLY into corpus id and
// key. They were never irregular, so the escape hatch and its trap are gone and
// one rule covers all 239 recorded ids.

import { LOCAL_PATH } from "./config.js";
import { localFind } from "./discovery.js";
import type { Reader, RowAdapter } from "./readers.js";
import type { TrainCtx } from "./runtime.js";
import { DIM, R } from "./ui.js";
import { join } from "node:path";

/** One file to train: a shard, a per-language file, or a whole single-file
 *  corpus. Exactly one of `url` / `local` is set. */
export interface Unit {
  /** Resume-id suffix — the corpus id and this form `${id}::${key}`. Part of
   *  the store's compatibility surface; see the file header. */
  key: string;
  /** How the run log names this unit once it is read. */
  name: string;
  /** How the live panel names it, and (unless `acquireLabel` overrides) how the
   *  download is labelled. Conventionally `${corpus.label} ${name}`. */
  display: string;
  url?: string;
  local?: string;
  /** Size in bytes when the listing said, else 0/absent. Summed BEFORE the
   *  stage reads anything, so the corpus progress bar has a denominator that
   *  does not grow underneath it. */
  bytes?: number;
  /** Cache filename. Defaults to the resume id with unsafe characters folded. */
  dest?: string;
  /** Download label, when it differs from `display`. */
  acquireLabel?: string;
}

/** How one unit's outcome reads in the run log. All optional: the defaults are
 *  what every fact-shaped corpus prints. */
export interface LogStyle {
  /** What one deposit is called. Default "facts". */
  deposits?: string;
  /** When set, the line reports "from N <rows>" — the count of rows that
   *  actually produced deposits. */
  rows?: string;
  /** What an unusable record is called. Default "unusable row(s)". */
  bad?: string;
  /** Report only the reader's `skipped` (malformed records), not the rows the
   *  adapter declined. For a corpus that DECLINES records by design — oasst2
   *  drops every single-turn tree — counting those as damage would be a lie. */
  malformedOnly?: boolean;
}

export interface Corpus {
  /** Tally key AND resume-id prefix. Compatibility surface — see the header. */
  id: string;
  /** Human name: the panel, the skip notices, the listing-failure message. */
  label: string;
  /** The dim tag in the log line, e.g. "translation", "social dialogue". */
  kind: string;
  enabled: boolean;
  /** The work-list. Return [] for "nothing found" (the runner says so), or
   *  null when the corpus has already logged a more specific reason. */
  discover(ctx: TrainCtx): Promise<Unit[] | null>;
  read: Reader;
  toItems: RowAdapter;
  /** Stage-wide row budget; 0/absent = unbounded. See the budget notes in
   *  stage.ts. */
  maxRows?: number;
  /** Noun for the "N/M ___ to train" announcement. Absent ⇒ no announcement,
   *  which is what a single-unit corpus has always done. */
  unitNoun?: string;
  /** Keep a file that came from the CACHE after a complete read. Only oasst2
   *  does this: every other corpus deletes whatever acquire() handed it. */
  keepCached?: boolean;
  log?: LogStyle;
}

/** The string a store records once this unit is finished. ONE rule, no
 *  exceptions — see the file header for why there used to be two. */
export const unitIdOf = (corpus: Corpus, unit: Unit): string =>
  `${corpus.id}::${unit.key}`;

/** Local files live under `LOCAL_PATH/<sub>`, or directly in LOCAL_PATH when
 *  `sub` is empty. Kept here because the layout is a user-facing convention:
 *  the corpora that share an extension (.json, .parquet) are kept apart by a
 *  subdirectory so a local run cannot feed one corpus's files to another. */
export const localDir = (sub: string): string =>
  sub ? join(LOCAL_PATH, sub) : LOCAL_PATH;

/** A single-unit corpus: one fixed URL, or one local file matched by pattern.
 *  Factored out because the three corpora that are ONE file resolve it the same
 *  way. `key` is what the store records this corpus under — `aya::dataset` is
 *  `key: "dataset"` — so it is required rather than defaulted: a resume id is
 *  the one thing here that must never be guessed. */
export function singleUnit(opts: {
  key: string;
  label: string;
  display: string;
  url: string;
  dest: string;
  acquireLabel?: string;
  /** Patterns tried, in order, against LOCAL_PATH. */
  localMatch: RegExp[];
  /** How the "no local copy" notice describes what it looked for. */
  localWhat: string;
}): (ctx: TrainCtx) => Promise<Unit[] | null> {
  return async (ctx: TrainCtx) => {
    if (LOCAL_PATH) {
      const hit = localFind(LOCAL_PATH, ...opts.localMatch);
      if (!hit) {
        ctx.progress.log(
          `  ${DIM}· no ${opts.localWhat} in ${LOCAL_PATH} — skipping${R}`,
        );
        return null;
      }
      return [{
        key: opts.key,
        name: opts.label,
        display: opts.display,
        local: join(LOCAL_PATH, hit),
      }];
    }
    return [{
      key: opts.key,
      name: opts.label,
      display: opts.display,
      url: opts.url,
      dest: opts.dest,
      acquireLabel: opts.acquireLabel,
    }];
  };
}
