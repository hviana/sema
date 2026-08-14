// train_base/progress.ts — resume state, and the index passes that keep a
// checkpointed store queryable.
//
// The store IS the model: memories, training metadata and the config snapshot
// all live in {DB_PATH}.sqlite, so a run resumes from the store alone. The keys
// below are that resume record, and they are a COMPATIBILITY SURFACE — a store
// trained by an earlier version must keep resuming, so neither the key names
// nor the shape of `completedFiles` may drift.

import type { Mind, Store } from "../../src/index.js";
import { INDEX_MAINTENANCE } from "./config.js";
import { DIM, GRN, int, R, YEL } from "./ui.js";

const META_COMPLETED = "train.completedFiles";
const META_DEPOSITS = "train.depositCount";
const META_TRAINED_BYTES = "train.trainedContentBytes";
const META_BYTES = "train.totalBytesProcessed";
const META_CORPUS_BYTES = "train.totalCorpusBytes";

export interface SavedProgress {
  completedFiles: string[];
  depositCount: number;
  trainedContentBytes: number;
  totalBytesProcessed: number;
  totalCorpusBytes: number;
}

export async function loadProgress(store: Store): Promise<SavedProgress> {
  try {
    const raw = await store.getMeta(META_COMPLETED);
    const deps = await store.getMeta(META_DEPOSITS);
    const b = await store.getMeta(META_BYTES);
    if (raw !== null && deps !== null && b !== null) {
      const completedFiles = JSON.parse(raw);
      if (Array.isArray(completedFiles)) {
        const trained = await store.getMeta(META_TRAINED_BYTES);
        const corpus = await store.getMeta(META_CORPUS_BYTES);
        return {
          completedFiles,
          depositCount: Number(deps) || 0,
          trainedContentBytes: Number(trained) || 0,
          totalBytesProcessed: Number(b) || 0,
          totalCorpusBytes: Number(corpus) || 0,
        };
      }
    }
  } catch { /* corrupt/missing — start fresh */ }
  return {
    completedFiles: [],
    depositCount: 0,
    trainedContentBytes: 0,
    totalBytesProcessed: 0,
    totalCorpusBytes: 0,
  };
}

export async function saveProgress(
  store: Store,
  p: SavedProgress,
): Promise<void> {
  await store.setMeta(META_COMPLETED, JSON.stringify(p.completedFiles));
  await store.setMeta(META_DEPOSITS, String(p.depositCount));
  await store.setMeta(META_TRAINED_BYTES, String(p.trainedContentBytes));
  await store.setMeta(META_BYTES, String(p.totalBytesProcessed));
  await store.setMeta(META_CORPUS_BYTES, String(p.totalCorpusBytes));
  await store.setMeta("train.updatedAt", new Date().toISOString());
  store.commit();
}

/** Run index maintenance: compact (remove garbage), repair (fill gaps),
 *  then refresh the canonical-form index (see below).  All three are
 *  idempotent — running twice produces the same result as once.
 *  Compaction frees index space first; repair then adds back every
 *  edge/halo-bearing node whose gist was evicted from the pending cache
 *  before it reached the content index, completing the coverage that
 *  incremental promotion alone cannot guarantee.
 *
 *  repair runs with minParents = 0, NOT the library default of 2.  The
 *  default repairs only structural BRIDGES (≥2 parents), but this
 *  trainer's fact deposits also leave answer-side DEPOSIT ROOTS with 0
 *  structural parents ("The capital of France is Paris." as the dst of a
 *  Q→A edge is a root of its own tree, contained in nothing).  Those are
 *  resonance targets recall depends on — a trained store shipped without
 *  them cannot ground statement-shaped queries against its own answers
 *  (observed: 33 such roots missing after a full curriculum, including
 *  high-traffic conversation replies).  minParents = 0 admits every
 *  edge/halo bearer; the candidate set is still corpus-of-experiences-
 *  sized, so the pass stays cheap.
 *
 *  Logs the number of entries removed/added so a run that silently degrades
 *  (growing compaction count, or repair never recovering anything) is
 *  visible in the training log. */
export async function runIndexMaintenance(
  mind: Mind,
  log: (msg: string) => void,
): Promise<void> {
  if (!INDEX_MAINTENANCE) return;
  try {
    const removed = await mind.store.compactContentIndex();
    if (removed > 0) {
      log(
        `  ${DIM}index compact: removed ${int(removed)} isolated entries${R}`,
      );
    }
  } catch (err) {
    log(
      `  ${YEL}⚠ index compact failed${R}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  try {
    const added = await mind.repairContentIndex(0);
    if (added > 0) {
      log(
        `  ${GRN}index repair: added ${
          int(added)
        } missing resonance targets${R}`,
      );
    }
  } catch (err) {
    log(
      `  ${YEL}⚠ index repair failed${R}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  // Canonical-form index (src/canon.ts): lets resolution find stored forms
  // across surface variation (case, width, whitespace).  Incremental and
  // idempotent by construction — the `canon.upto` meta cursor scans only
  // nodes newer than the last pass, and the (h, id) primary key ignores
  // re-inserted rows — so it composes with the resume model exactly like
  // compact/repair: every checkpoint (and finish) leaves the index
  // covering all content trained so far.
  try {
    const added = await mind.buildCanonIndex();
    if (added > 0) {
      log(
        `  ${GRN}canon index: added ${int(added)} canonical-form entries${R}`,
      );
    }
  } catch (err) {
    log(
      `  ${YEL}⚠ canon index build failed${R}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
