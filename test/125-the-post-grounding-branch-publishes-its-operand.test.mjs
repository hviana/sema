// 125 — the post-grounding branch publishes WHAT IT READ.
//
// Post-grounding decides on `decided.used` and on the provenance NAME.  Those
// operands were not in the trace, so a change to the branch could not be shown
// equivalent (or not) from outside: three separate investigations failed in
// exactly that interval.  A gap in instrumentation is a defect IN the
// instrumentation (AGENTS.md §6) — closed on the spot, once, as COUNTS, never
// content.
import { test } from "node:test";
import assert from "node:assert/strict";

test("125. the post-grounding branch publishes its operand", async () => {
  const { Mind, SQliteStore } = await import("../dist/src/index.js");
  const store = new SQliteStore({ path: ":memory:" });
  const mind = new Mind({ seed: 7, store, profile: true });
  await mind.ingest([
    ["What is the capital of France", "The capital of France is Paris"],
    ["Paris", "Paris is famous for the Eiffel Tower"],
    ["2+2", "2+2 equals 4"],
    ["Gustaf Molander", "Gustaf Molander was a Swedish film director"],
  ]);
  const steps = [];
  await mind.respondText("who was Gustaf Molander", (s) => steps.push(s));
  await store.close();
  const pg = steps.filter((p) => p.data && p.data.usedDeclared !== undefined);
  assert.ok(
    pg.length >= 1,
    `the response must emit a postGrounding step carrying the operand ` +
      `(steps with data: ${
        steps.filter((p) => p.data).map((p) => String(p.note).slice(0, 24))
          .join(" | ")
      })`,
  );
  const d = pg[pg.length - 1].data;
  assert.equal(
    typeof d.usedDeclared,
    "boolean",
    "usedDeclared states whether `used` arrived",
  );
  assert.equal(
    typeof d.preConsumed,
    "number",
    "preConsumed is a COUNT, never content",
  );
  assert.equal(typeof d.voiced, "number", "voiced is a COUNT, never content");
  assert.equal(
    typeof d.provenance,
    "string",
    "the name the OLD branch read is published too",
  );
});
