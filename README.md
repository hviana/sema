<div align="center">

```
███████╗ ███████╗ ███╗   ███╗  █████╗
██╔════╝ ██╔════╝ ████╗ ████║ ██╔══██╗
███████╗ █████╗   ██╔████╔██║ ███████║
╚════██║ ██╔══╝   ██║╚██╔╝██║ ██╔══██║
███████║ ███████╗ ██║ ╚═╝ ██║ ██║  ██║
╚══════╝ ╚══════╝ ╚═╝     ╚═╝ ╚═╝  ╚═╝
```

### The mind without weights.

**A reasoning engine grounded in a _vector-symbolic architecture_ and
_instance-based memory_ — not in billions of trained parameters.**

No weights. No gradients. No training loop. No neural network. No GPU.

`Deterministic` · `Auditable` · `CPU-only`

— ⬡ — ⬡ — ⬡ —

</div>

> [!IMPORTANT]
> **© Sema is not a large language model.** Today's LLMs compress the world into
> opaque floating-point weights and answer by sampling from them. Sema does the
> opposite: it **keeps your knowledge as knowledge** — content-addressed,
> inspectable, exact — and _reasons_ over it on demand. The store **is** the
> model. What it knows, you can read. Why it answered, you can trace.
>
> Formally, Sema is a **non-parametric, instance-based reasoning system**: a
> Vector Symbolic Architecture (Plate 1995; Kanerva 2009) over a
> content-addressable memory, with inference by weighted automated deduction
> (Knuth 1977; Felzenszwalb & McAllester 2007). Each term is grounded in
> [HOW_IT_WORKS.md](HOW_IT_WORKS.md).

---

## ✦ Retrieval and reasoning, one search

Two questions, asked of every query — and Sema answers both in a single pass:

<div align="center">

|                  | The question it asks                                 |
| :--------------- | :--------------------------------------------------- |
| 🔎 **Retrieval** | _"What do I already know that bears on this?"_       |
| 🧠 **Deduction** | _"What can I conclude or decide from what I found?"_ |

</div>

```text
               ┌──────────────────────────────────────────────┐
Your question  │"The Weeping Woman was painted by Picasso."   │
               └──────────────────────┬───────────────────────┘
                                      ▼
   🔎  Retrieve     resonate the query against the memory
                    ·  "… painted by … → the painter"  (a learned pattern)
                    ·  "Picasso → co-founded the Cubist movement"
                                      ▼
   🧠  Deduce       connect · derive · compose
                    ·  lift the painter from a sentence never seen
                    ·  follow that name onward to what it implies
                                      ▼
   ✅  Answer       "Pablo Picasso co-founded the Cubist movement"
                    (a fact that appears in no word of the question)
```

Retrieval and reasoning are not two bolted-together stages — they are **one
search** over **one memory**, which is why the answer can be something no single
stored fact contains. Watch it happen below.

---

## ✦ Why Sema

<table>
<tr>
<td width="50%" valign="top">

### 🧩 Symbolic, not statistical

Knowledge is stored as a **content-addressed graph**, not smeared across a
weight matrix. Every fact is an edge you can point at. Nothing is hallucinated
out of a probability distribution.

</td>
<td width="50%" valign="top">

### 🔀 Retrieval and reasoning, unified

Retrieval and reasoning are **one mechanism**, not a brittle pipeline of bolted-
together components. A query enters the graph where it _resonates_ and a single
lightest-derivation search composes the answer.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔍 Fully auditable

Every answer is a **derivation** over explicit facts. No black box. Trace any
output back to the exact deposits that produced it — a hard requirement for
regulated, high-stakes, and safety-critical deployments.

</td>
<td width="50%" valign="top">

### ♻️ Deterministic & reproducible

Same seed + same bytes → **identical result, every time.** No temperature, no
sampling, no drift between runs. Reproducibility is a property of the
architecture, not a flag you toggle.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### ⚡ Instant training

Training **is** depositing — one pass, no epochs, no gradient descent, no
fine-tuning jobs. Teach it a fact and it knows the fact. Now.

</td>
<td width="50%" valign="top">

### 🔒 Total data sovereignty

Runs entirely on **your** hardware. No API calls, no telemetry, no weights to
leak. Everything a trained mind knows lives in a few files on your disk.

</td>
</tr>
</table>

> [!TIP]
> **No GPU. No cluster. No cloud bill.** Sema runs on an ordinary CPU with a
> tiny memory footprint, because it never multiplies a weight matrix — it walks
> a graph. The economics of deploying intelligence change completely.

---

## ✦ See it think

Give Sema four plain notes — the way you'd jot them down — then ask things **no
note answers**. From three worked examples it learns the _shape_ of "X was
painted by Y", lifts the painter out of a sentence it has **never seen**, and —
in the same pass — reasons onward to a separate fact about that painter. The
reply contains no word from the question: it is **retrieval, generalization, and
reasoning composing as a single act**.

```ts
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
```

```text
Pablo Picasso co-founded the Cubist movement
48
```

> [!NOTE]
> This is **[example/demo.ts](example/demo.ts)**, verbatim — run it yourself
> with `npm run demo`. Look closely at the first answer: the question names a
> painting Sema was never shown and asks nothing explicit, yet the reply is a
> fact about Picasso that appears **nowhere** in the question. Sema generalized
> "_painted by_" from three examples to recognize _Pablo Picasso_ as the answer
> slot, then followed that name to the one thing it knows about him — retrieval,
> an analogy, and a reasoning hop, in one query. The second answer is exact, not
> a plausible-looking guess. Every step traces back to the four notes above.

---

## ✦ Engineered from three solved problems

Sema is composed of three self-contained, independently documented engines. They
are fully decoupled — Sema reaches them only through interfaces.

| Engine            | What it solves                                                                             | Result                                                                                                                       |
| :---------------- | :----------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| **`rabitq-hnsw`** | _"Given a vector, find the nodes whose gist resonates with it — fast, at scale, on disk."_ | HNSW over 1-bit RaBitQ codes · ~32× compression · bounded RAM · sub-linear queries                                           |
| **`derive`**      | _"Explore a huge implicit space of derivations and return the single lightest one."_       | adapted A\*LD (adapted A\* Lightest Derivation) over a weighted deduction hypergraph — Sema's thinking _is_ one call to this |
| **`alu`**         | _"Compute, exactly and symbolically, the things that are rules, not facts."_               | A tiny irreducible kernel from which arithmetic, logic, and n-dimensional computation are derived                            |

---

## ✦ Learn more

| Document                                                                         | What's inside                                                                                                                                            |
| :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📘 **[HOW_IT_WORKS.md](HOW_IT_WORKS.md)**                                        | The full theory: vector symbolic architectures, the Merkle DAG, distributional halos, weighted deduction — concepts, diagrams, and extensive pseudocode. |
| 🛠️ **[AGENTS.md](AGENTS.md)**                                                    | The development manual: repo layout, build/test, internals, invariants, and recipes for extending the system.                                            |
| ⚖️ **[LICENSE.md](LICENSE.md)**                                                  | PolyForm Noncommercial License 1.0.0.                                                                                                                    |
| 💼 **[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)**                            | Commercial licensing terms and contact.                                                                                                                  |
| 🤗 **[Trained examples](https://huggingface.co/buckets/hviana/sema-trained-v1)** | Pre-trained memory files you can download and use directly.                                                                                              |

---

<div align="center">

## ⚖️ Licensing & compliance — please read

</div>

> [!WARNING]
> **Sema is the product of serious, sustained research — and it is protected.**
> It is released under the **PolyForm Noncommercial License 1.0.0**. Personal
> study, academic research, experimentation, and use by noncommercial
> organizations are welcome and explicitly permitted.

> [!CAUTION]
> **Commercial use requires a separate paid license.** This includes — but is
> not limited to — use by a company; use to provide paid services or serve
> clients; use inside a SaaS, hosted product, or any revenue-generating
> platform; and use to reduce business costs or support business operations.
>
> Operating Sema commercially (artifacts and algorithmic logic) without a
> license is a violation of its terms. See
> **[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)** to obtain one, and
> **[TRADEMARKS.md](TRADEMARKS.md)** — the **Sema** name, logos, and brand are
> _not_ covered by the source license.

<div align="center">

**Respecting these terms funds the research that makes work like this
possible.** If Sema creates value for your business, license it — and help keep
independent, weight-free AI research alive.

**© Sema Author** — Henrique Viana (creator).

## Academic purpose:

**hv5088@gmail.com**

## Commercial licensing:

**reis.marcelo@gmail.com**, **rogernact@gmail.com**

**© Sema Supporters** — Marcelo Oliveira dos Reis · Rogerio Nascimento

— ⬡ — ⬡ — ⬡ —

</div>
