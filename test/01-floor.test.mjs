import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, Mind } from "../dist/src/index.js";

test("fractal floor: ordinal geometry of the byte line", async () => {
  const m = new Mind({ seed: 7 });
  const a = m.alphabet;
  // same-mid neighbours resonate more than coarse-only, more than far
  const sameMid = cosine(a.vecs[64], a.vecs[65]);
  const sameCoarse = cosine(a.vecs[64], a.vecs[76]);
  const far = Math.abs(cosine(a.vecs[64], a.vecs[200]));
  assert.ok(
    sameMid > sameCoarse + 0.1,
    `mid ${sameMid} vs coarse ${sameCoarse}`,
  );
  assert.ok(sameCoarse > far, `coarse ${sameCoarse} vs far ${far}`);
});

// encodeChunk / decodeChunk were removed — 1-byte leaves have no chunk
// encoding.  Each byte is its own leaf with an implicit negative id.
