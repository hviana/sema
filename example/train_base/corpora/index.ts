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

import type { Corpus } from "../stage.js";
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

/** The corpora this run will actually train, for the panel header and the
 *  `train.dataset` meta — derived, so it can never go stale the way the
 *  hand-written string it replaces had. */
export const enabledLabels = (): string =>
  CURRICULUM.filter((c) => c.enabled).map((c) => c.label).join("+");

export { aya, genknow, massive, oasst2, smolsent, soda, taskmaster, wiki2 };
export * from "./smolsent.js";
export * from "./aya.js";
export * from "./oasst2.js";
export * from "./taskmaster.js";
export * from "./wiki2.js";
export * from "./soda.js";
export * from "./massive.js";
export * from "./genknow.js";
