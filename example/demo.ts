// demo.ts — a corpus goes in, and the memory is read back out.
//
// Sema is given a small corpus of plain notes, each one the shape every deposit
// has: a context, and what follows it. Then the memory is read two ways — what
// it HOLDS (`sampleCorpus`), and which of its notes a question REACHES
// (`searchCorpusText`). Both run through the same content-addressed machinery an
// answer uses (src/mind/corpus.ts); nothing is indexed and nothing is written.
//
// The search addresses content EXACTLY, not by keyword: a question reaches a
// note when it shares chunk-aligned content with it, so a question with no such
// overlap is reported as exactly that — a STATE, rendered by the text layer
// (`CorpusTextResult.note`), never as prose the engine invented.
//
// The last act is two ordinary answers, each with its derivation streamed as it
// unfolds, the PROVENANCE that names the route it grounded on, and the work it
// cost read off the meter: the rationale and the meter ARE the explanation
// surface (AGENTS.md §6).

import { decodeText, formatReport, Mind, SQliteStore } from "../src/index.js";

// One relation shown three times — a pattern taught purely by example — plus a
// stray fact keyed on a name none of the examples mention.
const CORPUS: Array<[string, string]> = [
  ["The Mona Lisa was painted by Leonardo da Vinci.", "Leonardo da Vinci"],
  ["The Starry Night was painted by Vincent van Gogh.", "Vincent van Gogh"],
  [
    "The Night Watch was painted by Rembrandt van Rijn.",
    "Rembrandt van Rijn",
  ],
  ["Pablo Picasso", "Pablo Picasso co-founded the Cubist movement"],
  ["The Weeping Woman was painted by Pablo Picasso.", "Pablo Picasso"],
];

// Questions the corpus can address, and one it cannot — the honest miss.
const QUERIES = [
  "The Mona Lisa was painted by Leonardo da Vinci.",
  "Pablo Picasso",
  "xylophone",
];

// One question answered by composing across the notes, and one answered by
// computing: the two routes the corpus search does not take.
const ASKS = [
  "The Weeping Woman was painted by Pablo Picasso.",
  "a museum charges 12*4 for a family ticket",
];

async function main(): Promise<void> {
  const mind = new Mind({
    store: new SQliteStore({ path: ":memory:" }),
    profile: true,
  });
  await mind.ingest(CORPUS);

  // 1) WHAT THE MEMORY HOLDS — real pairs, browsed, no query and no random draw.
  console.log("— the corpus, as the memory holds it —");
  for (const p of mind.sampleCorpus(4).pairs) {
    console.log(`  ${decodeText(p.context)}  →  ${decodeText(p.continuation)}`);
  }

  // 2) SEARCH — which stored notes does a question reach? A question that
  //    addresses the corpus answers with pairs; one that shares nothing with it
  //    answers with a note saying so.
  for (const q of QUERIES) {
    const r = mind.searchCorpusText(q, 3);
    console.log(`\n— "${q}" —  ${r.resolved} resolved / ${r.reached} reached`);
    if (r.note !== undefined) console.log(`  ${r.note}`);
    for (const p of r.pairs) {
      console.log(
        `  ${p.context}  →  ${p.continuation}  (${p.matchedBytes} matched)`,
      );
    }
  }

  // 3) ANSWERS, WITH THEIR DERIVATION — the same pipeline, read as data. Steps
  //    repeat (recognise re-enters under every mechanism that needs it), so each
  //    distinct mechanism-and-note is printed once, in the order it first ran.
  for (const q of ASKS) {
    const seen = new Set<string>();
    const trace: string[] = [];
    const r = await mind.respond(q, (s) => {
      const line = `${s.mechanism.join(" › ")}${s.note ? ` — ${s.note}` : ""}`;
      if (seen.has(line)) return;
      seen.add(line);
      trace.push(`${"  ".repeat(Math.max(0, s.mechanism.length - 1))}${line}`);
    });
    console.log(`\n— "${q}" —  ${r.provenance ?? "no answer"}`);
    console.log(`  ${decodeText(r.bytes).trim()}`);
    console.log("— how —");
    for (const s of trace) console.log(s);
    if (mind.lastCost !== null) {
      console.log(`— what it cost —\n${formatReport(mind.lastCost)}`);
    }
  }

  await mind.store.close();
}

main();
