// 97-store-seed.test.mjs — a trained store's OWN seed governs the Mind that
// opens it.
//
// `train.seed` is persisted by the trainer (example/train_base/main.ts) and the
// trainer refuses to resume a store under a different seed, so the value is
// authoritative for the artifact.  The seed feeds `makeKeyring`, `Space.rand`
// and the `Alphabet` in the Mind constructor: folding a query under any other
// seed lands in a DIFFERENT vector space than the one the artifact's nodes were
// folded into, so recognition and resonance read the wrong space and every
// answer degrades silently.
//
// The store recovers `train.D` and `geometry.maxGroup` from its own metadata at
// open; `train.seed` must be recovered the same way, and a Mind that did not
// receive an explicit seed must adopt it.  An explicit caller seed still wins.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

/** A store that was never trained carries no seed and leaves the caller's
 *  configured default in force. */
test("an untrained store reports no trainSeed and keeps the default seed", async () => {
  const store = new SQliteStore({ path: ":memory:", D: 256 });
  const mind = new Mind({ store });
  assert.equal(store.trainSeed, null);
  assert.equal(mind.cfg.seed, DEFAULT_CONFIG.seed);
  await store.close();
});

/** The artifact's seed is recovered at open and adopted by a Mind that was not
 *  given one; an explicit seed still overrides it. */
test("a trained store's seed is recovered and adopted unless overridden", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sema-seed-"));
  const stem = join(dir, "trained");
  const TRAIN_SEED = 7;

  // Build the artifact: ingest under an explicit seed, then persist the seed
  // exactly as the trainer does.
  {
    const store = new SQliteStore({ path: stem, D: 256 });
    const mind = new Mind({ seed: TRAIN_SEED, store });
    await mind.ingest([["the sky is blue", "blue"]]);
    await store.setMeta("train.seed", String(TRAIN_SEED));
    store.commit();
    await store.close();
  }

  // Reopen WITHOUT a seed: the store's own seed must stand.
  {
    const store = new SQliteStore({ path: stem, D: 256 });
    assert.equal(store.trainSeed, TRAIN_SEED);
    const adopted = new Mind({ store });
    assert.equal(adopted.cfg.seed, TRAIN_SEED);
    await store.close();
  }

  // Reopen WITH an explicit seed: the caller wins over the artifact.
  {
    const store = new SQliteStore({ path: stem, D: 256 });
    const explicit = new Mind({ seed: 3, store });
    assert.equal(explicit.cfg.seed, 3);
    await store.close();
  }

  rmSync(dir, { recursive: true, force: true });
});

/** The adopted seed is the one the answer is computed under: a store ingested
 *  under seed 7 answers a query identically when reopened without a seed and
 *  when reopened with seed 7 passed explicitly. */
test("adopting the artifact seed reproduces the artifact's answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sema-seed-"));
  const stem = join(dir, "trained");
  const TRAIN_SEED = 7;
  const QUESTION = "the sky is blue";

  let artifactAnswer;
  {
    const store = new SQliteStore({ path: stem, D: 256 });
    const mind = new Mind({ seed: TRAIN_SEED, store });
    await mind.ingest([
      ["the sky is blue", "blue"],
      ["the grass is green", "green"],
    ]);
    artifactAnswer = (await mind.respondText(QUESTION)).trim();
    await store.setMeta("train.seed", String(TRAIN_SEED));
    store.commit();
    await store.close();
  }
  assert.equal(artifactAnswer, "blue");

  {
    const store = new SQliteStore({ path: stem, D: 256 });
    const adopted = new Mind({ store });
    assert.equal(adopted.cfg.seed, TRAIN_SEED);
    assert.equal((await adopted.respondText(QUESTION)).trim(), artifactAnswer);
    await store.close();
  }

  rmSync(dir, { recursive: true, force: true });
});
