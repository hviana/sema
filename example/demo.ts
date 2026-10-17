// demo.ts — one short session that drives the WHOLE pipeline from one memory.
//
// We give Sema a handful of plain notes, then ask things that no single note
// answers. The headline query is the third one: from three worked examples Sema
// learns the shape of "X was painted by Y", lifts the painter out of a sentence
// it has NEVER seen, and then — in the same pass — reasons forward to a separate
// fact about that painter. The reply contains no word from the question. That is
// retrieval, generalization, and reasoning composing as a single act, with every
// step traceable back to the notes behind it.

import { Mind } from "../src/index.js";
import { SQliteStore } from "../src/store-sqlite.js";

async function main(): Promise<void> {
  const mind = new Mind({ store: new SQliteStore({ path: ":memory:" }) });
  const ask = async (q: string) => (await mind.respondText(q)).trim();

  // ── Jot down what we know. Each line is just (context → what follows). ──
  await mind.ingest([
    // One relation, shown three times — a pattern taught purely by example:
    ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
    ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
    [
      "The Night Watch was painted by Rembrandt van Rijn.",
      "Rembrandt van Rijn",
    ],
    // One stray fact, keyed on a name none of the examples mention:
    ["Pablo Picasso", "Pablo Picasso co-founded the Cubist movement"],
  ]);

  // 1) GENERALIZE — apply the learned pattern to an unseen sentence and read out
  //    the painter. "Pablo Picasso" was never given as an answer; Sema locates it
  //    by analogy to the three examples.
  console.log(await ask("The Weeping Woman was painted by Pablo Picasso."));
  // → "Pablo Picasso co-founded the Cubist movement"
  //   …and, having found the painter, it KEEPS GOING: the name bridges into the
  //   one fact it holds about him. The answer appears in no word of the question.

  // 2) COMPUTE — exact arithmetic, grounded right where the notes go silent.
  console.log(await ask("a museum charges 12*4 for a family ticket"));
  // → "48"

  await mind.store.close();
}

main();
