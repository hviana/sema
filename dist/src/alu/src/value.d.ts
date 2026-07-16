/** Which stratum a {@link Value} belongs to.  Four scalar domains + the
 *  recursive container `nd`. */
export type Domain = "bit" | "int" | "real" | "symbol" | "nd";
/** A quantity the ALU computes on — a tagged union over the scalar domains plus
 *  the recursive n-dimensional container.  An `nd`'s `items` are themselves
 *  Values of any domain, so nesting (a matrix = an nd of nd) and heterogeneity
 *  (a list mixing numbers, symbols, sub-lists) are the same case. */
export type Value = {
  domain: "bit";
  b: 0 | 1;
} | {
  domain: "int";
  n: bigint;
} | {
  domain: "real";
  x: number;
} | {
  domain: "symbol";
  bytes: Uint8Array;
} | {
  domain: "nd";
  items: Value[];
};
export declare const bit: (b: 0 | 1) => Value;
export declare const int: (n: bigint) => Value;
export declare const real: (x: number) => Value;
/** A symbolic value: an opaque byte span of any modality (see module note). */
export declare const symbol: (bytes: Uint8Array) => Value;
/** An n-dimensional value: an ordered list of element values (each any domain,
 *  including a nested nd).  See the module note on nd. */
export declare const nd: (items: Value[]) => Value;
/** The domain tag of a value. */
export declare const tagOf: (v: Value) => Domain;
/** Whether a value is a numeric SCALAR (bit, int, or real) — an nd is not, even
 *  if every element is numeric (it is a container; reduce it to a scalar). */
export declare function isNumeric(v: Value): boolean;
/** Whether a value is the n-dimensional container. */
export declare function isNd(v: Value): v is {
  domain: "nd";
  items: Value[];
};
/** Collect, into `out`, every SYMBOL byte span reachable inside a value — itself
 *  when it is a symbol, or each element recursively when it is an nd.  These are
 *  the spans whose MEANING (a resonant opposite, the operation a higher-order op
 *  argument names) the host pre-resolves before a computation; numbers carry no
 *  meaning to resolve, so they are skipped. */
export declare function symbolSpans(v: Value, out: Uint8Array[]): void;
/** A value as a JS number — bit→0|1, int→Number, real as-is.  Throws on a
 *  symbol, because arithmetic on an opaque form is a programming error the
 *  caller (or the graph adapter's try/catch) should surface, never silently
 *  coerce to NaN. */
export declare function asReal(v: Value): number;
/** A value as an exact bigint — real is truncated toward zero (a real that is
 *  not integral loses its fraction; callers wanting exactness keep it int). */
export declare function asInt(v: Value): bigint;
/** A value as a logic bit — nonzero numbers read as 1, zero as 0.  Throws on a
 *  symbol (an opaque form is not a truth value). */
export declare function asBit(v: Value): 0 | 1;
/** Promote a value into a target numeric domain (bit ⊂ int ⊂ real).  Used when
 *  a mixed-domain expression must agree on one domain before a primitive runs —
 *  the rule is the natural lattice: any real operand pulls the whole expression
 *  to real, otherwise any int pulls it to int, otherwise bit. */
export declare function coerce(v: Value, domain: "bit" | "int" | "real"): Value;
/** The common numeric domain of a list of operands, by the bit ⊂ int ⊂ real
 *  lattice: real if any operand is real, else int if any is int, else bit.
 *  Throws if any operand is a symbol.  This is how a polymorphic arithmetic op
 *  decides whether to take the exact bigint path or the native-double path. */
export declare function joinDomain(args: Value[]): "bit" | "int" | "real";
/** The host's bridge between byte spans and values.  ALU emits and consumes
 *  bytes only through this, so the surrounding system owns how a number is
 *  spelled.  A default ({@link decimalCodec}) is provided. */
export interface ValueCodec {
  encode(v: Value): Uint8Array;
  decode(bytes: Uint8Array): Value | null;
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
export declare function parseValue(bytes: Uint8Array): Value;
/** Canonically format a real as a decimal string: round to `precision` places,
 *  then trim trailing zeros (and a bare trailing point), normalising -0 to 0.
 *  Determinism here is load-bearing — the search keys an output span by its
 *  bytes, so two derivations of the same number MUST spell it identically. */
export declare function formatReal(x: number, precision: number): string;
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
export declare function decimalCodec(precision: number): ValueCodec;
