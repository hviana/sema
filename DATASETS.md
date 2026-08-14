# Training corpora — provenance, licensing, and attribution

This file is the attribution notice for every corpus Sema is trained on, and the
licensing statement for the **trained memory files** that training produces.

It is a required companion to any distributed Sema store. If you publish or ship
`*.sqlite` / `*.content.vec` / `*.halo.vec`, ship this file with them.

---

## 1. Why a trained store is not a weight file

Sema is non-parametric. Training is deposition, not gradient descent: source
text is segmented and content-addressed, and the **bytes are retained**. Reading
a node returns the original text:

```
#15709469 → "Kohei Uchimura from Japan holds the record for the most World
             Championship medals won by a male gymnast, with a total of 21 medals."
```

A trained store is therefore a database that contains its training corpora in
recoverable form. Distributing one **is** distributing those corpora, and every
upstream licence applies in full. The "it's only model weights, the text isn't
really in there" argument is not available to Sema, by design.

Two consequences follow, and both are load-bearing:

1. **A corpus whose licence forbids commercial use cannot enter the store**,
   because Sema is offered under a paid commercial licence as well as
   [PolyForm Noncommercial](LICENSE.md).
2. **A corpus under a ShareAlike licence cannot enter the store**, because its
   copyleft would attach to the distributed artifact.

Both rules are stated in [AGENTS.md](AGENTS.md) §6 and must be checked before
any corpus is added to a trainer.

---

## 2. How a distributed store is licensed

A trained Sema store has two layers, licensed separately. Conflating them is a
licence violation in one direction or the other.

| Layer                           | What it covers                                                                                          | Licence                                                                                                 |
| :------------------------------ | :------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------ |
| **Sema itself**                 | The algorithms, geometry, deduction engine, indexes, file formats, and all code that produced the store | [PolyForm Noncommercial 1.0.0](LICENSE.md), with a separate [commercial licence](COMMERCIAL-LICENSE.md) |
| **Corpus content in the store** | The retained training text and anything derived from it                                                 | Each corpus's own upstream licence, listed in §3                                                        |

**Sema's source licence is not extended over the corpus content, and cannot
be.** CC BY 4.0 §2(a)(5)(B) forbids applying legal terms that restrict a
recipient from doing what the licence permits — so the noncommercial term cannot
be applied to CC BY text sitting inside the store. What the noncommercial term
protects is the engine, which is the part that is actually ours.

**Modification statement** (required by CC BY 4.0 §3(a)(1)(B)): all corpus text
in a Sema store has been modified. It is segmented at content-defined
boundaries, re-encoded, deduplicated by content address, and interleaved with
text from other sources. It is not presented as a faithful reproduction of any
upstream dataset, and no endorsement by any upstream author is implied.

**Apache-2.0 obligations**: corpora marked Apache-2.0 below require the licence
text and any upstream `NOTICE` to travel with the distribution, and require
changes to be stated. The modification statement above satisfies the latter.

---

## 3. Corpora

### 3.1 In use

| Corpus                                                                                                   | Licence                                               | Attribution                        | Notes                                                                                                                                                                                                                                                                 |
| :------------------------------------------------------------------------------------------------------- | :---------------------------------------------------- | :--------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [google/smol](https://huggingface.co/datasets/google/smol) (SmolSent)                                    | CC BY 4.0                                             | Google LLC                         | Translation pairs                                                                                                                                                                                                                                                     |
| [CohereLabs/aya_dataset](https://huggingface.co/datasets/CohereLabs/aya_dataset)                         | Apache-2.0                                            | Cohere For AI                      | Human-written prompt/completion                                                                                                                                                                                                                                       |
| [OpenAssistant/oasst2](https://huggingface.co/datasets/OpenAssistant/oasst2)                             | Apache-2.0                                            | LAION / OpenAssistant contributors | Human-authored dialogue — see §5                                                                                                                                                                                                                                      |
| [Taskmaster-1/2/3/4](https://github.com/google-research-datasets/Taskmaster)                             | CC BY 4.0                                             | Google LLC                         | Task-oriented dialogue. Only `utterances[].text` is ingested; the `instructions` / `scenario` / `vertical` fields are never read                                                                                                                                      |
| [2WikiMultihopQA](https://huggingface.co/datasets/xanhho/2WikiMultihopQA) — **`evidences` triples only** | Apache-2.0 (repo); triples originate in Wikidata, CC0 | Ho et al.; Wikidata contributors   | Only the `evidences` column is ingested. The `context` column (Wikipedia prose, CC BY-SA) is **never read** — see §4. The `question`/`answer` columns are also never deposited, for a capability reason rather than a licence one: they memorise instead of composing |
| [allenai/soda](https://huggingface.co/datasets/allenai/soda)                                             | CC BY 4.0                                             | Allen Institute for AI             | Social dialogue. Only the `dialogue` column is ingested; `narrative` / `literal` / `head` / `relation` / `tail` are never read. Model-generated provenance — see §5                                                                                                   |
| [AmazonScience/massive](https://huggingface.co/datasets/AmazonScience/massive)                           | CC BY 4.0                                             | Amazon Science                     | Short multilingual intents. Only the `utt` column is ingested; the slot-annotated `annot_utt` is never read. **Disabled by default** on capability grounds (not licence) — see `MASSIVE` in `example/train_base.ts`                                                   |

### 3.2 Excluded, and why

| Corpus                                                            | Reason                                                                                                                                                                                                                                                                                                                                          |
| :---------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MuskumPillerum/General-Knowledge**                              | **No licence at all.** The HF repo carries no licence tag and no licence in its card; an earlier header in `example/train_base.ts` claimed MIT without support. Its own card states it "contains a subset of the alpaca dataset", and Alpaca is CC BY-NC 4.0 — **NonCommercial**, incompatible with Sema's commercial licence. See §6.          |
| **PAWS**                                                          | Google's own grant is maximally permissive ("may be freely used for any purpose"), but PAWS-Wiki sentences derive from Wikipedia (CC BY-**SA**) and PAWS-QQP from Quora question pairs under Quora's terms. Because Sema retains text verbatim, the upstream terms would attach to the distributed store. Excluded despite strong measured fit. |
| **Schema-Guided Dialogue (SGD/dstc8)**, **HotpotQA**, **MuSiQue** | CC BY-SA 4.0 — ShareAlike conflicts with dual distribution.                                                                                                                                                                                                                                                                                     |
| **2WikiMultihopQA passages**                                      | Wikipedia prose, CC BY-SA. The repo's Apache-2.0 tag does not relicense the text it was built from. Only the Wikidata-derived `evidences` triples are ingested.                                                                                                                                                                                 |
| **Alpaca** and derivatives                                        | CC BY-NC 4.0, and generated from OpenAI model outputs.                                                                                                                                                                                                                                                                                          |

---

### 3.3 What each stage actually deposits

A corpus's licence applies to what is ingested, and every stage ingests a strict
subset of its source. This is the authoritative list.

| Stage                    | Columns/fields read                       | Deposit shape                                             |
| :----------------------- | :---------------------------------------- | :-------------------------------------------------------- |
| SmolSent                 | `src`, `trg`                              | one `src → trg` (foreign → English) episode per row       |
| Aya                      | `inputs`, `targets`                       | one question → answer episode                             |
| oasst2                   | message `text` along the best-ranked path | cumulative-context walk                                   |
| Taskmaster               | `utterances[].text`                       | cumulative-context walk over speaker-merged turns         |
| 2Wiki                    | `evidences`                               | per triple: a relation fact and a bare-subject pivot fact |
| SODA                     | `dialogue`, `speakers`                    | cumulative-context walk over speaker-merged turns         |
| MASSIVE (off by default) | `utt`                                     | one bare experience                                       |

Everything else in those sources — Taskmaster's `instructions`/`scenario`,
2Wiki's `context`/`question`/`answer`, SODA's `narrative`/`literal`/`head`/
`relation`/`tail`, MASSIVE's `annot_utt` — is **not read** and therefore not
distributed in a trained store.

---

## 4. The rule that decides these cases

**A repository's licence tag does not relicense the material the repository was
built from.** A dataset assembled out of Wikipedia prose and published under
Apache-2.0 still carries Wikipedia's ShareAlike terms on that prose. Because
Sema stores text verbatim, Sema inherits the _upstream_ terms, not the
repackager's.

So the check for any candidate corpus is two questions, not one:

1. What licence does the repository carry?
2. **What was it built from, and what licence does that carry?**

Where a corpus has a clean layer and a contaminated one, take the clean layer
only — as with 2Wiki's Wikidata triples (CC0) versus its Wikipedia passages (CC
BY-SA).

---

## 5. Disclosures

**Model-generated provenance.** `allenai/soda` is licensed CC BY 4.0 but was
distilled from OpenAI GPT-3.5 outputs. The licence is clean; the provenance is
disclosed here so downstream users can make their own assessment.

**Personal data.** `OpenAssistant/oasst2` is human-authored content contributed
by identifiable volunteers, and Sema retains it verbatim in a redistributable
artifact. Erasure requests against a content-addressed store are not
straightforward. Anyone distributing a Sema store trained on human-contributed
dialogue should account for this.

---

## 6. Status of previously published stores

Stores published before this file was written — including those under
[hviana/sema-trained-v1](https://huggingface.co/buckets/hviana/sema-trained-v1)
— were trained with the `MuskumPillerum/General-Knowledge` stage enabled (37,623
rows), whose licence status is described in §3.2. Those artifacts should be
treated as **not redistributable** until retrained without that stage.

The stage is now **disabled by default** in `example/train_base.ts`
(`GENKNOW=0`). The adapter code remains so the stage can be re-enabled for local
experiments; a store trained with `GENKNOW=1` must not be distributed.
