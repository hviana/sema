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
