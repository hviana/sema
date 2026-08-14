// train_base/corpora/index.ts — THE CURRICULUM.
//
// The order is the curriculum, and it is load-bearing: each stage runs only
// after the previous one finishes, and every stage records itself in the same
// completed-set, so a single store resumes the whole sequence.
//
//   1. SmolSent    sentence-level TRANSLATION pairs across 100+ low-resource
//                  languages. Each pair is "two names for one meaning" → a
//                  foreign→English translation FACT, so every language's
//                  rendering of a meaning converges on ONE English node (cf.
//                  test/05-concepts.test.mjs).
//   2. Aya         ~204k human prompt→completion pairs, 70+ languages → one
//                  (question → answer) FACT each.
//   3. oasst2      MULTI-TURN human↔assistant conversation trees → the
//                  accumulated-context walk (single-turn trees are skipped).
//   4. Taskmaster  task-oriented DIALOGUE, the best-scoring corpora on the
//                  fold-unit recurrence benchmark that predicts halo health.
//   5. 2Wiki       the `evidences` TRIPLES — the one stage aimed at
//                  COMPOSITION. Its Wikipedia passages and its composed
//                  questions are deliberately NOT read.
//   6. SODA        social/commonsense DIALOGUE, budgeted.
//   7. MASSIVE     short intent utterances → ONE bare experience each.
//                  DISABLED BY DEFAULT — edge-less content was measured to
//                  manufacture answers where the store should stay silent.
//   8. GenKnow     ~37.6k {Question, Answer} pairs → one FACT each. DISABLED
//                  BY DEFAULT on licence grounds; see DATASETS.md §3.2.

import type { Corpus } from "../corpus.js";
import { smolsent } from "./smolsent.js";
import { aya } from "./aya.js";
import { oasst2 } from "./oasst2.js";
import { taskmaster } from "./taskmaster.js";
import { wiki2 } from "./wiki2.js";
import { soda } from "./soda.js";
import { massive } from "./massive.js";
import { genknow } from "./genknow.js";

export const CURRICULUM: Corpus[] = [
  smolsent,
  aya,
  oasst2,
  taskmaster,
  wiki2,
  soda,
  massive,
  genknow,
];

/** The corpora this RUN will train, for the panel header — derived, so it can
 *  never go stale the way the hand-written string it replaces had. */
export const enabledLabels = (): string =>
  CURRICULUM.filter((c) => c.enabled).map((c) => c.label).join("+");

/** The corpora a STORE contains: everything this run will train PLUS everything
 *  an earlier run already did, in curriculum order.
 *
 *  Not the same question as `enabledLabels`, and conflating them wrote a false
 *  statement into every store that was ever resumed with a different set of
 *  stages enabled. Observed on a real store: `train.dataset` read
 *  "SmolSent+Aya+oasst2" while the tally recorded 37,623 General-Knowledge
 *  deposits sitting in it. That is not cosmetic — a Sema store retains its
 *  training text VERBATIM, so `train.dataset` is the record of whose licence
 *  terms travel with the artifact, and General-Knowledge is precisely the
 *  corpus DATASETS.md §3.2 disables on NonCommercial grounds.
 *
 *  `trainedIds` are the corpus ids an earlier run deposited under (the keys of
 *  the per-corpus tally). An id no longer in the curriculum cannot be named and
 *  is dropped — the tally still carries it, which is where that evidence lives. */
export const storedLabels = (trainedIds: Iterable<string>): string => {
  const trained = new Set(trainedIds);
  return CURRICULUM
    .filter((c) => c.enabled || trained.has(c.id))
    .map((c) => c.label)
    .join("+");
};

// One re-export per corpus, carrying the descriptor AND its adapters. The
// explicit `export { aya, genknow, … }` list that used to sit here named the
// eight descriptors a second time; the star exports below already provide them,
// and a hand-kept list of everything is exactly the thing that goes stale.
export * from "./smolsent.js";
export * from "./aya.js";
export * from "./oasst2.js";
export * from "./taskmaster.js";
export * from "./wiki2.js";
export * from "./soda.js";
export * from "./massive.js";
export * from "./genknow.js";
