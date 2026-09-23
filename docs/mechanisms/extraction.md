# Extraction — Skill-Framed Span Read-out

Extraction transfers a learnt span-in-context skill to an unseen query. A skill
exemplar is a stored fact whose answer is a span of its context (or of its
pieces); extraction locates the exemplar's framing bytes in the query and reads
what sits between them.

## Matcher — `skillExemplar` / `isSpanShaped` / `containsSpan` (`src/mind/match.ts`)

An exemplar is span-shaped when its answer embeds in order. `isSpanShaped` is
the open reading (sparse subsequence, any gaps) for acceptance; `containsSpan`
is the strict reading (contiguous run, or a resolved node) that fusion gates on,
extraction decomposes with `answerRunsInContext` (greedy longest runs).
Candidates are ranked anchors from `climbAttentionAll`
(`Precomputed.spanShapedOf`), tried up to `pre.k`; sub-quantum (`< W`) or
unanchored results are skipped.

## Projection — read between located frames (`src/mind/mechanisms/extraction.ts`)

`answerRunsInContext` splits the exemplar answer into pieces within its context.
For each piece, the `W`-bounded pre-frame (and post-frame or next-piece
pre-frame) is `locate`d in the query at recognition sites. Located frames define
`start`/`end`; the bytes `query[start:end]` are read out. Multi-piece skills
concatenate reads in order.

## Gate — both borders located to account (`src/mind/mechanisms/extraction.ts`)

Frames are evidence only when `locate` succeeds. An unanchored read (no frame
located, `accounted === []`) is discarded — not an extraction. An open-ended
read (only one border located) stays unaccounted.

## Cost (`src/mind/graph-search.ts`)

Mechanism weight is `moves + PASS * unaccounted_bytes` with
`moves = CONCEPT + STEP * accounted.length`. Comparison is at `STEP` grade, then
scaffolding, then list order.

## Selective accounting

Frames are always accounted when located. The read span between them is
accounted only when bounded on both sides (`preBounded && postBounded`);
otherwise it is PASS-priced like uncovered bytes, so a correct bounded
extraction can outweigh an echoing juxtaposition.

## Provenance

`extract` (single-piece) or synthesised multi-piece read.

## Pins

- `test/00-extract.test.mjs` — skill transfer across values and relations
- `test/68-extraction-unanchored.test.mjs` — unanchored gate (empty accounted is
  silence)
