[![npm version](https://img.shields.io/npm/v/@hviana/sema.svg)](https://www.npmjs.com/package/@hviana/sema)

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
> The difference is not a matter of degree. A trained model's meanings are real,
> but nothing in it records where they came from — provenance is diffused across
> an entire training run rather than kept. Sema's meanings are assembled from
> **enumerable events**, and the record is the mechanism: for any concept it
> holds, you can list what taught it, and in what role.
>
> Formally, Sema is a **non-parametric, instance-based reasoning system**: a
> Vector Symbolic Architecture (Plate 1995; Kanerva 2009) over a
> content-addressable memory, with inference by weighted automated deduction
> (Knuth 1977; Felzenszwalb & McAllester 2007). Each term is grounded in
> [HOW_IT_WORKS.md](HOW_IT_WORKS.md).

---

## ✦ It chooses how to think

A question can be answered in more than one way, and the ways are not
interchangeable. Sema holds several, lets them compete, and takes the one that
leaves the least of your question unaccounted for.

<div align="center">

| What Sema claims about your question                                               |
| :--------------------------------------------------------------------------------- |
| _"I can build this answer out of pieces I already know."_                          |
| _"You've woven two things I know — let me carry structure between them."_          |
| _"You gave me two conditions; the answer is where they meet."_                     |
| _"I've seen this shape of question before — let me read yours the same way."_      |
| _"You've begun something I know the whole of."_                                    |
| _"Part of this answer is **your** words, in a place my memory keeps open."_        |
| _"The nearest thing I hold is this — and I'm telling you it's near, not derived."_ |
| **_"Nothing I hold bears on this."_**                                              |

</div>

```text
                 ┌──────────────────────────────────────┐
 your question   │  every route prices its own answer   │
       │         └──────────────────┬───────────────────┘
       ▼                            ▼
┌─────────────┐        one price, one question:
│  route  ·   │        "how much of what you asked
│  route  ·   │  ───▶   did this route fail to
│  route  ·   │         account for?"
│  route  ·   │                     │
└─────────────┘                     ▼
                         ┌─────────────────────────┐
                         │  the lightest answer    │
                         │  wins — and arrives     │
                         │  tagged with the route  │
                         │  that produced it       │
                         └─────────────────────────┘
```

Because the price is _unexplained question_ — not speed, not confidence — the
winner is the route that accounts for most of what you actually asked, rather
than the one most eager to answer. It is also why the last line of that table is
a legitimate outcome and not a failure: when no route can account for what you
asked, **silence is a first-class answer.** A system that must always produce
something will always, eventually, produce fiction.

---

## ✦ Why Sema

<table>
<tr>
<td width="50%" valign="top">

### 🧩 Symbolic, not statistical

Everything stored carries a vector for what it is _made of_; anything that takes
part in a fact carries a second for the **company it keeps**. The first makes
_colour_ close to _colours_; the second makes _colour_ close to _hue_, two words
whose spellings have nothing to do with each other. Meaning here is assembled
and readable, not smeared across a weight matrix.

</td>
<td width="50%" valign="top">

### 🔍 Fully auditable

Every answer is a **derivation** over explicit facts. No black box. Trace any
output back to the exact deposits that produced it — a hard requirement for
regulated, high-stakes, and safety-critical deployments.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### ♻️ Deterministic & reproducible

Same seed + same bytes → **identical result, every time.** No temperature, no
sampling, no drift between runs. Reproducibility is a property of the
architecture, not a flag you toggle.

</td>
<td width="50%" valign="top">

### 📐 Nothing tuned

**No threshold is a chosen number.** Every bar the system decides on is derived
from the representation's own geometry — its dimension, its perception window,
how much it has learned. Nothing was fitted to a benchmark, so there is no dev
set to overfit and no calibration that silently expires when your data stops
resembling someone else's.

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
> **No GPU. No cluster. No cloud bill.** Sema runs on an ordinary CPU, because
> it never multiplies a weight matrix — it walks a graph. Its resident memory is
> capped by configuration rather than by how much it has learned, so a large
> store does not become a large machine. The economics of deploying intelligence
> change completely.

---

## ✦ See it think

Give Sema four plain notes — the way you'd jot them down — then ask things **no
note answers**. From three worked examples it learns the _shape_ of "X was
painted by Y", lifts the painter out of a sentence it has **never seen**, and —
in the same pass — reasons onward to a separate fact about that painter. Nothing
in the reply but the painter's own name comes from the question.

```ts
// demo.ts — one short session that drives the WHOLE pipeline from one memory.

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
  //    the painter, then keep going into what is known about him.
  console.log(await ask("The Weeping Woman was painted by Pablo Picasso."));

  // 2) COMPUTE — exact arithmetic, grounded right where the notes go silent.
  console.log(await ask("a museum charges 12*4 for a family ticket"));

  await mind.store.close();
}

main();
```

```text
Pablo Picasso co-founded the Cubist movement
48
```

Ask for the receipt instead of the text, and each answer says how it was reached
— `mind.respond(q)` returns the same bytes plus a **`provenance` tag** naming
the route, and, on request, the complete replayable trace behind it:

```text
"The Weeping Woman was painted by Pablo Picasso."  →  provenance: cast
    ( structure carried across the three worked examples )

"a museum charges 12*4 for a family ticket"        →  provenance: cover
    ( composed from the question's own parts — one of them computed exactly )
```

> [!NOTE]
> This is **[example/demo.ts](example/demo.ts)** — run it with `npm run demo`.
> The first question names a painting Sema was never shown, and asks nothing
> explicit; what comes back is a fact about Cubism that appears **nowhere** in
> it. The second is exact, not a plausible-looking guess. Every step traces back
> to the four notes above.

---

## ✦ Learn it in one pass

There is no training phase distinct from using it. **Depositing _is_ learning**,
and a fact is available the instant it lands.

<div align="center">

|                      |                                                                                                     |
| :------------------- | :-------------------------------------------------------------------------------------------------- |
| 📥 **To teach it**   | Hand it the fact. One pass. No epochs, no GPU, no fine-tuning window.                               |
| ✏️ **To correct it** | Deposit the correction — a write, not a retraining run. Nothing is erased; the evidence is weighed. |
| 🔁 **To repeat it**  | Teaching the same thing twice creates nothing new — identity is content.                            |
| 📦 **To scale it**   | Storage grows with _distinct_ content, never with volume.                                           |

</div>

> [!TIP]
> It does not learn by repetition and does not need an enormous corpus. What it
> needs is **coverage of fundamental patterns** — conversation, logic,
> relationships, quantities — not the same pattern ten thousand times. A small,
> well-chosen curriculum teaches it more than a scraped ocean.

---

## ✦ Where it matters

Not "faster than an LLM" — **possible where an LLM is not.** Each of these
sectors is blocked by a requirement no sampled model can meet.

| Sector                        | The blocker                                                       | What Sema puts on the table                                                     |
| :---------------------------- | :---------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| 🏥 **Healthcare**             | Patient data cannot leave; a recommendation must be explicable    | Runs in the building, cites the record behind every answer                      |
| 🏦 **Finance & credit**       | An adverse decision must be justified, and reproduced on demand   | The same inputs give the same decision, with the reasoning attached             |
| ⚖️ **Legal & compliance**     | A cited authority that does not exist is a career-ending event    | Nothing is invented: every answer is a derivation over what was deposited       |
| 🛡️ **Defense & intelligence** | Air-gapped, no external inference, no telemetry                   | One binary, no network, no API key, no weights to exfiltrate                    |
| 🏭 **Industrial & safety**    | Certification requires deterministic, auditable behaviour         | Determinism is architectural, and every answer is a replayable derivation       |
| 🏛️ **Public sector**          | Decisions about citizens must be contestable                      | A citizen can be shown exactly which rules and records produced the outcome     |
| 🛰️ **Edge & robotics**        | No datacenter, tight power budget, knowledge changes in the field | CPU-only, memory capped by configuration; new knowledge is a write, not a build |

> [!NOTE]
> The common thread: these are settings where **"I don't know" is worth more
> than a confident guess** — and where a wrong answer is not an inconvenience
> but a liability. Sema is built to say it.

---

## ✦ Try it — one file, zero setup

A **self-contained app** that opens a **web chat with Sema**. Download, run,
start talking — no install, no runtime, no API key.

<div align="center">

| Your machine             | Download                                                                                                                       |
| :----------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| 🪟 **Windows**           | [Download · 85 MB](https://huggingface.co/buckets/hviana/sema-binary-examples/resolve/sema-demo-windows-x64.exe?download=true) |
| 🍎 **Mac** — M1–M4       | [Download · 73 MB](https://huggingface.co/buckets/hviana/sema-binary-examples/resolve/sema-demo-macos-arm64?download=true)     |
| 🍎 **Mac** — Intel       | [Download · 85 MB](https://huggingface.co/buckets/hviana/sema-binary-examples/resolve/sema-demo-macos-x64?download=true)       |
| 🐧 **Linux** — Intel/AMD | [Download · 113 MB](https://huggingface.co/buckets/hviana/sema-binary-examples/resolve/sema-demo-linux-x64?download=true)      |
| 🐧 **Linux** — ARM       | [Download · 114 MB](https://huggingface.co/buckets/hviana/sema-binary-examples/resolve/sema-demo-linux-arm64?download=true)    |

</div>

> [!TIP]
> Not sure which Mac you have? Anything sold from 2020 onward is almost
> certainly **M1–M4**. On Linux, if you're on a regular desktop or server, pick
> **Intel/AMD**; **ARM** is for boards like the Raspberry Pi and ARM cloud
> instances. All builds are browsable at
> [🤗 sema-binary-examples](https://huggingface.co/buckets/hviana/sema-binary-examples).

---

## ✦ Learn more

| Document                                                                             | What's inside                                                                                                                                            |
| :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📘 **[HOW_IT_WORKS.md](HOW_IT_WORKS.md)**                                            | The full theory: vector symbolic architectures, the Merkle DAG, distributional halos, weighted deduction — concepts, diagrams, and extensive pseudocode. |
| 🛠️ **[AGENTS.md](AGENTS.md)**                                                        | The development manual: repo layout, build/test, internals, invariants, and recipes for extending the system.                                            |
| 🎓 **[CITATION.cff](CITATION.cff)**                                                  | How to cite Sema in academic work.                                                                                                                       |
| ⚖️ **[LICENSE.md](LICENSE.md)**                                                      | PolyForm Noncommercial License 1.0.0.                                                                                                                    |
| 💼 **[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)**                                | Commercial licensing terms and contact.                                                                                                                  |
| 🤗 **[Trained examples](https://huggingface.co/buckets/hviana/sema-trained-v1)**     | Pre-trained memory files you can download and use directly.                                                                                              |
| 💿 **[Binary examples](https://huggingface.co/buckets/hviana/sema-binary-examples)** | Ready-to-run web chat apps for Windows, Mac, and Linux — one file, no install.                                                                           |

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

**reis.marcelo@gmail.com**

**© Sema Supporters** — Marcelo Oliveira dos Reis

— ⬡ — ⬡ — ⬡ —

</div>
