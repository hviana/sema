// value.ts — the ALU value model.
//
// One tagged union carries every kind of quantity the ALU computes on, so a
// single Operation registry can dispatch on the tag rather than maintaining
// disjoint kernels.  The four domains are exactly the strata the kernel needs:
//
//   • bit    — a logic value 0|1.  The completeness layer (nand and the gates
//              derived from it) lives here.
//   • int    — an EXACT integer (JS bigint).  The "everything derives from nand"
//              bootstrap runs here: add is a ripple of full_adders, multiply is
//              shift-add, and so on.  bigint keeps the proof exact past 2^53.
//   • real   — an IEEE double.  The limit layer (converge, exp, sin, …) is
//              intrinsically continuous, so it runs on the host's native reals
//              rather than a fixed-point reimplementation atop bits.
//   • symbol — a raw BYTE SPAN that is not a number.  SEMA is byte-native and
//              multimodal: a symbol's bytes may name a written form, a region of
//              an image, a fragment of audio — any learned form, in any
//              modality.  ALU never interprets those bytes; it treats a symbol
//              as an opaque token.  This is the carrier for the POLYMORPHIC
//              inverse: the inverse of a number is its negation, but the inverse
//              of a symbol is its RESONANT OPPOSITE — found in the resonance
//              space, not by arithmetic (e.g. the bytes of "large" resolve to
//              "small", but the mechanism is modality-agnostic — see
//              resonance.ts).  Resonance is the only thing that can read meaning
//              from a symbol, and ALU reaches it only through an injected
//              capability, never directly.
//
//   • nd     — an N-DIMENSIONAL value: an ordered list of elements, each of which
//              is ITSELF a Value of ANY domain — a scalar (bit/int/real/symbol)
//              OR another nd.  So nd is recursive (a tensor is an nd of nds), it
//              is RAGGED (rows need not be equal length — it is a list, not a
//              rectangular array), and it is HETEROGENEOUS (a row may mix a
//              number, a symbol, and a sub-list).  This one recursive case is the
//              whole generalisation: there is no separate "vector" vs "matrix"
//              type, only nd nesting, and the rank is read off the nesting depth.
//              Every scalar operation lifts over it automatically (broadcast, see
//              operation.ts), and the structural operations (the nd kernel) build
//              the list-processing layer — map/reduce/filter/find/… — on a tiny
//              core of nd/length/at, exactly as logic builds on nand.
//
// The module is pure: it knows nothing of SEMA, the store, or the search.  The
// only host coupling is the injected ValueCodec, whose default lives here.
// ── constructors ──────────────────────────────────────────────────────────
export const bit = (b) => ({ domain: "bit", b });
export const int = (n) => ({ domain: "int", n });
export const real = (x) => ({ domain: "real", x });
/** A symbolic value: an opaque byte span of any modality (see module note). */
export const symbol = (bytes) => ({
  domain: "symbol",
  bytes,
});
/** An n-dimensional value: an ordered list of element values (each any domain,
 *  including a nested nd).  See the module note on nd. */
export const nd = (items) => ({ domain: "nd", items });
/** The domain tag of a value. */
export const tagOf = (v) => v.domain;
/** Whether a value is a numeric SCALAR (bit, int, or real) — an nd is not, even
 *  if every element is numeric (it is a container; reduce it to a scalar). */
export function isNumeric(v) {
  return v.domain === "bit" || v.domain === "int" || v.domain === "real";
}
/** Whether a value is the n-dimensional container. */
export function isNd(v) {
  return v.domain === "nd";
}
/** Collect, into `out`, every SYMBOL byte span reachable inside a value — itself
 *  when it is a symbol, or each element recursively when it is an nd.  These are
 *  the spans whose MEANING (a resonant opposite, the operation a higher-order op
 *  argument names) the host pre-resolves before a computation; numbers carry no
 *  meaning to resolve, so they are skipped. */
export function symbolSpans(v, out) {
  if (v.domain === "symbol") {
    out.push(v.bytes);
  } else if (isNd(v)) {
    for (const e of v.items) {
      symbolSpans(e, out);
    }
  }
}
// ── coercions (the functor's object map between domains) ────────────────────
/** A value as a JS number — bit→0|1, int→Number, real as-is.  Throws on a
 *  symbol, because arithmetic on an opaque form is a programming error the
 *  caller (or the graph adapter's try/catch) should surface, never silently
 *  coerce to NaN. */
export function asReal(v) {
  switch (v.domain) {
    case "bit":
      return v.b;
    case "int":
      return Number(v.n);
    case "real":
      return v.x;
    case "symbol":
      throw new TypeError("asReal: a symbol value has no numeric reading");
    case "nd":
      // An nd has no scalar reading: a scalar primitive never sees one, because
      // broadcast (operation.ts) lifts it element-wise first.  Reaching here
      // means a structural op was mis-called on a list as if it were a scalar.
      throw new TypeError("asReal: an nd value has no scalar numeric reading");
  }
}
/** A value as an exact bigint — real is truncated toward zero (a real that is
 *  not integral loses its fraction; callers wanting exactness keep it int). */
export function asInt(v) {
  switch (v.domain) {
    case "bit":
      return BigInt(v.b);
    case "int":
      return v.n;
    case "real":
      return BigInt(Math.trunc(v.x));
    case "symbol":
      throw new TypeError("asInt: a symbol value has no integer reading");
    case "nd":
      throw new TypeError("asInt: an nd value has no scalar integer reading");
  }
}
/** A value as a logic bit — nonzero numbers read as 1, zero as 0.  Throws on a
 *  symbol (an opaque form is not a truth value). */
export function asBit(v) {
  switch (v.domain) {
    case "bit":
      return v.b;
    case "int":
      return v.n === 0n ? 0 : 1;
    case "real":
      return v.x === 0 ? 0 : 1;
    case "symbol":
      throw new TypeError("asBit: a symbol value is not a truth value");
    case "nd":
      throw new TypeError("asBit: an nd value is not a scalar truth value");
  }
}
/** Promote a value into a target numeric domain (bit ⊂ int ⊂ real).  Used when
 *  a mixed-domain expression must agree on one domain before a primitive runs —
 *  the rule is the natural lattice: any real operand pulls the whole expression
 *  to real, otherwise any int pulls it to int, otherwise bit. */
export function coerce(v, domain) {
  if (v.domain === domain) {
    return v;
  }
  switch (domain) {
    case "bit":
      return bit(asBit(v));
    case "int":
      return int(asInt(v));
    case "real":
      return real(asReal(v));
  }
}
/** The common numeric domain of a list of operands, by the bit ⊂ int ⊂ real
 *  lattice: real if any operand is real, else int if any is int, else bit.
 *  Throws if any operand is a symbol.  This is how a polymorphic arithmetic op
 *  decides whether to take the exact bigint path or the native-double path. */
export function joinDomain(args) {
  let d = "bit";
  for (const a of args) {
    if (a.domain === "symbol") {
      throw new TypeError("joinDomain: cannot join a symbol value numerically");
    }
    if (a.domain === "nd") {
      throw new TypeError("joinDomain: cannot join an nd value numerically");
    }
    if (a.domain === "real") {
      return "real";
    }
    if (a.domain === "int" && d === "bit") {
      d = "int";
    }
  }
  return d;
}
const ASCII = {
  decode: (b) => {
    let s = "";
    for (let i = 0; i < b.length; i++) {
      s += String.fromCharCode(b[i]);
    }
    return s;
  },
  encode: (s) => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      out[i] = s.charCodeAt(i) & 0xff;
    }
    return out;
  },
};
/** A decimal numeral, sign, optional fraction, optional exponent — the syntax
 *  {@link parseScalar} accepts as a number.  Anything else is a symbol. */
const NUMERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Concatenate byte arrays — used to build an nd literal's encoding without
 *  routing a (possibly non-ASCII, multimodal) symbol's bytes through a string. */
function concatBytes(arrs) {
  let len = 0;
  for (const a of arrs) {
    len += a.length;
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
/** Parse a SCALAR span: a clean integer numeral → exact int, a fractional/
 *  exponent numeral → real, anything else → a symbol carrying `bytes` verbatim.
 *  Strict, so it never hijacks a form that merely begins with a digit. */
function parseScalar(bytes, s) {
  if (s.length > 0 && NUMERAL.test(s)) {
    if (/[.eE]/.test(s)) {
      const x = Number(s);
      if (Number.isFinite(x)) {
        return real(x);
      }
    } else {
      // A clean integer: strip a leading '+' that BigInt rejects.
      try {
        return int(BigInt(s[0] === "+" ? s.slice(1) : s));
      } catch {
        /* fall through to symbol */
      }
    }
  }
  return symbol(bytes);
}
/** Parse a byte span into a SCALAR value: a clean integer numeral → exact int, a
 *  fractional/exponent numeral → real, anything else → a symbol carrying its
 *  bytes verbatim for the polymorphic inverse.
 *
 *  This is the IRREDUCIBLE FLOOR — and the ONLY structure read at the value
 *  model's base: a number-form's digits ground a quantity, the exact analogue of
 *  the byte alphabet grounding a symbol.  It does NOT read n-dimensional
 *  STRUCTURE (no bracket/comma grammar); recognising a list — a run of element
 *  values joined by a consistent separator — is layered ONE level up, in the
 *  facade's {@link "./alu.js".Alu.recogniseValue} (over the operand scanner),
 *  which calls this for each element.  So the codec's `decode` (which delegates
 *  here) is scalar-only: a bracket literal decodes to an opaque symbol.
 *
 *  Numerals are ASCII by construction; for any other byte content the bytes are
 *  preserved opaquely, so a symbol of any modality round-trips untouched. */
export function parseValue(bytes) {
  return parseScalar(bytes, ASCII.decode(bytes));
}
/** Canonically format a real as a decimal string: round to `precision` places,
 *  then trim trailing zeros (and a bare trailing point), normalising -0 to 0.
 *  Determinism here is load-bearing — the search keys an output span by its
 *  bytes, so two derivations of the same number MUST spell it identically. */
export function formatReal(x, precision) {
  if (!Number.isFinite(x)) {
    return String(x); // "Infinity" / "NaN" / "-Infinity"
  }
  let s = x.toFixed(precision);
  if (s.indexOf(".") >= 0) {
    s = s.replace(/\.?0+$/, "");
  }
  if (s === "-0" || s === "") {
    s = "0";
  }
  return s;
}
/** The default codec: integers as exact decimals, reals canonically formatted,
 *  bits as "0"/"1", symbols as their own bytes (verbatim, any modality), and an
 *  nd as a bracket literal `[e0,e1,…]` of its element encodings (recursive, so a
 *  nested list nests its brackets and a symbol element keeps its raw bytes).
 *  `precision` controls real rounding (see {@link formatReal}).
 *
 *  The bracket layout is the CANONICAL OUTPUT spelling of an `nd` — one
 *  deterministic form, the analogue of decimal for a number, so the search's
 *  chart memoises identical results identically.  It is an ENCODE-only grammar:
 *  {@link parseValue} (hence `decode`) reads only scalars, never structure — a
 *  bracket literal decodes back to an opaque symbol.  Reading list STRUCTURE from
 *  bytes is layered one level up, in {@link "./alu.js".Alu.recogniseValue}. */
export function decimalCodec(precision) {
  const enc = (v) => {
    switch (v.domain) {
      case "bit":
        return ASCII.encode(String(v.b));
      case "int":
        return ASCII.encode(v.n.toString());
      case "real":
        return ASCII.encode(formatReal(v.x, precision));
      case "symbol":
        return v.bytes;
      case "nd": {
        // [e0,e1,…] at the byte level, so a symbol element's arbitrary
        // (possibly non-ASCII / multimodal) bytes pass through untouched.
        const OPEN = ASCII.encode("[");
        const CLOSE = ASCII.encode("]");
        const COMMA = ASCII.encode(",");
        const parts = [OPEN];
        for (let i = 0; i < v.items.length; i++) {
          if (i > 0) {
            parts.push(COMMA);
          }
          parts.push(enc(v.items[i]));
        }
        parts.push(CLOSE);
        return concatBytes(parts);
      }
    }
  };
  return {
    encode: enc,
    decode(bytes) {
      return parseValue(bytes);
    },
  };
}
