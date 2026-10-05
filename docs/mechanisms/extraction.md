# Extraction — Read a Span Between Located Frames

Extraction transfers a learnt skill of the form "the answer is a span of the
context" to a question it has never seen. A **skill exemplar** is a stored fact
whose answer appears inside its own context. Extraction finds the exemplar's
framing bytes in the question and reads what sits between them
(`src/mind/mechanisms/extraction.ts`).

## Matcher — span-shaped exemplars

The candidates are the climb's ranked anchors, tried up to `pre.k`
(`Precomputed.spanShapedOf`, `skillExemplar`). An exemplar qualifies when its
answer embeds in its context in order:

- **`isSpanShaped`** is the open reading, a sparse subsequence. Extraction
  accepts on it.
- **`answerRunsInContext`** decomposes the answer into its pieces within the
  context, taking the longest runs greedily. Fusion gates on the strict reading,
  `containsSpan`, instead.

## Projection — locate the frames, read between them

For each piece, the bytes just before it (and just after it, or before the next
piece), bounded at `W`, are located in the question (`locate`). The located
frames fix the read's start and end. Multi-piece skills concatenate their reads
in order. Results shorter than one quantum are skipped.

## Gate and accounting — both borders, or nothing

- **No frame located** (`accounted = []`): the read is discarded. That is
  silence, not extraction.
- **A located frame is always evidence.**
- **The span read between frames is accounted only when both of its borders were
  located.** An open-ended read stays priced at `PASS` per byte, so a bounded
  extraction outweighs an echo that merely sets things side by side.

## Cost

`moves = CONCEPT + STEP · accounted.length`, with a floor of `CONCEPT + STEP`.
The floor checks `worthRunning` before touching the climb.

## Provenance

`extract`.

## Pins

- `test/00` — skill transfer across values and relations.
- `test/68` — an unanchored read is silence.
