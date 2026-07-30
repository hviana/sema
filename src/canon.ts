// canon.ts — content canonicalization for equivalence-class resolution.
//
// The store is content-addressed on RAW bytes: "What", "WHAT" and "what" are
// three different hashes, so a query whose surface form varies from the
// trained form resolves to nothing even though the CONTENT is the same.  A
// CANONICALIZER maps every surface variant of the same content onto one
// canonical byte string; the store keeps a small hash index from canonical
// keys to node ids (see Store.canonAdd/canonFind), and resolution falls back
// to that index when the exact content-addressed lookup misses.
//
// The canonicalizer is MODALITY-SPECIFIC and always INJECTED — nothing in the
// store or the mind's core knows what "case" or "whitespace" is.  The text
// canonicalizer below is the one `respondText`/`respondTurnText` pass down;
// a grid or audio modality would supply its own (or none).
//
// Canonical keys are equivalence-class LABELS, never content: they are hashed
// and verified (canon(stored bytes) must equal canon(query bytes) before an
// id is accepted), so a hash collision costs a read, never a wrong id — the
// same discipline as the node table's own `h` index.

/** A content canonicalizer: maps a byte span to the canonical representative
 *  of its equivalence class.  Must be pure and deterministic.  Returning the
 *  input unchanged is always sound (the class is then {input}). */
export type Canon = (bytes: Uint8Array) => Uint8Array;

const dec = new TextDecoder("utf-8", { fatal: false });
const enc = new TextEncoder();

/** The TEXT canonicalizer: Unicode-aware equivalence over every character
 *  variation that does not change what the text SAYS —
 *
 *   • compatibility normalization (NFKC): full-width forms, ligatures,
 *     composed vs decomposed accents collapse to one representation;
 *   • case folding (locale-independent lowercase after NFKC — the standard
 *     simple fold);
 *   • whitespace: every INTERIOR run of Unicode whitespace becomes one plain
 *     space.  EDGE whitespace is preserved verbatim: a span's leading or
 *     trailing separator belongs BETWEEN forms, not to the form — trimming
 *     it would let a recognised span swallow the boundary byte that
 *     separates it from its neighbour (observed: "ice fire" composing to
 *     "coldhot" because the span "ice " matched the stored "ice").
 *
 *  "WHAT  IS", "What is" and "ｗｈａｔ is" share one canonical form.  This is
 *  deliberately conservative: punctuation, digits and word order are content
 *  and pass through untouched. */
export function textCanon(bytes: Uint8Array): Uint8Array {
  const s = dec
    .decode(bytes)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(\S)\s+(?=\S)/g, "$1 ");
  return enc.encode(s);
}

/** 32-bit FNV-1a over a canonical key — the integer the store's canon index
 *  is keyed on.  Same construction as the node table's content hash; a
 *  collision is resolved by verifying canon(stored) === key, never trusted. */
export function canonHash(key: Uint8Array): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The span of `bytes` between its first and last non-whitespace byte — the
 *  QUESTION, with the caller's edge spacing dropped.  Returns a subarray (no
 *  copy), and the original when there is nothing to trim.
 *
 *  THIS LIVES HERE, not in the core byte utilities, for the reason stated at
 *  the top of this file: "nothing in the store or the mind's core knows what
 *  'case' or 'whitespace' is".  Edge spacing is a TEXT fact — for a binary or
 *  grid modality 0x20 is content, not presentation — so it belongs beside the
 *  text canonicalizer, is injected on the same modality test, and never leaks
 *  into a mechanism.  A modality that supplies its own canon supplies its own
 *  reading of "edge" too, or none.
 *
 *  Why trimming is sound HERE when {@link textCanon} deliberately refuses it:
 *  canon preserves edge whitespace because the hazard is a recognised SUB-span
 *  swallowing the boundary byte that separates it from its neighbour (observed:
 *  "ice " matching the stored "ice").  At the outer edges of a WHOLE input
 *  there is no neighbour — nothing precedes byte 0, nothing follows the last
 *  byte — so that hazard cannot arise, and only there. */
export function textEdgeTrim(bytes: Uint8Array): Uint8Array {
  const space = (b: number) =>
    b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
  let from = 0;
  let to = bytes.length;
  while (from < to && space(bytes[from])) from++;
  while (to > from && space(bytes[to - 1])) to--;
  return from === 0 && to === bytes.length ? bytes : bytes.subarray(from, to);
}

/** Where a modality's atomic content runs begin and end.
 *
 *  THE MIND HAS NO CHARACTER CLASS.  A mechanism that needs to know which
 *  spans of an input are candidate constituents must ASK the modality, exactly
 *  as the ALU's parser asks its host's geometric segmenter rather than deciding
 *  for itself whether bytes are "just a separator" (see alu/src/parser.ts), and
 *  exactly as resolution asks the injected {@link Canon} rather than knowing
 *  what "case" is.  Nothing is privileged as "the" separator, because the core
 *  never sees one: it sees spans.
 *
 *  This is NOT the perception tree's `segment`.  That reports the fold's own
 *  content-defined chunks, which are the right unit for geometry and cut across
 *  content freely ("The ca" / "pital of" is a real segmentation of a trained
 *  form).  A `Segmenter` reports the MODALITY's units instead — for text, runs
 *  between spacing and delimiters — which is the unit a substitution must
 *  respect if the result is to be a form the corpus could hold.  A modality
 *  with no such notion supplies none, and mechanisms that need one stay silent
 *  rather than inventing it. */
export interface Segmenter {
  /** Offsets at which a unit-aligned span may begin or end, ascending, always
   *  including 0 and `bytes.length`. */
  bounds(bytes: Uint8Array): number[];
  /** `[start, end)` of every atomic content run within `[from, to)`. */
  units(bytes: Uint8Array, from: number, to: number): Array<[number, number]>;
}

/** The TEXT segmenter: units are runs between whitespace and the delimiters
 *  that end a written form.  Byte-level on purpose — a multi-byte UTF-8
 *  sequence contains no ASCII delimiter byte, so its characters group into one
 *  unit without decoding.  This is the ONE place the spelling of text spacing
 *  is written down, and it is injected, never imported by a mechanism. */
export const textSegmenter: Segmenter = {
  bounds(bytes: Uint8Array): number[] {
    const set = new Set<number>([0, bytes.length]);
    for (let i = 0; i < bytes.length; i++) {
      if (isTextDelimiter(bytes[i])) {
        set.add(i);
        set.add(i + 1);
      }
    }
    return [...set].sort((a, b) => a - b);
  },
  units(bytes: Uint8Array, from: number, to: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let start = -1;
    for (let i = from; i < to; i++) {
      if (isTextDelimiter(bytes[i])) {
        if (start >= 0) out.push([start, i]);
        start = -1;
      } else if (start < 0) start = i;
    }
    if (start >= 0) out.push([start, to]);
    return out;
  },
};

/** Whitespace plus the punctuation that delimits a written form. */
function isTextDelimiter(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d ||
    b === 0x3f || b === 0x2e || b === 0x2c || b === 0x21 ||
    b === 0x22 || b === 0x27;
}
