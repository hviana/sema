// alu — the ALU sub-library: a tiny irreducible kernel from which arithmetic,
// logic, and numerical computation are all DERIVED.
//
// Self-contained in the spirit of derive/ and rabitq-hnsw/: it imports only the
// pure byte helpers (../../bytes.js) and nothing else from SEMA.  The host
// reaches meaning (operator synonymy, the symbolic inverse) through the injected
// AluResonance, pre-resolved into a synchronous snapshot before the search runs.
// See ./../README.md for the kernel and its derivation DAG.

export {
  asBit,
  asInt,
  asReal,
  bit,
  coerce,
  decimalCodec,
  type Domain,
  formatReal,
  int,
  isNd,
  isNumeric,
  joinDomain,
  nd,
  parseValue,
  real,
  symbol,
  symbolSpans,
  tagOf,
  type Value,
  type ValueCodec,
} from "./value.js";

export {
  type Arity,
  type EvalExpr,
  type InfixSyntax,
  NO_RESONANCE,
  type OpContext,
  type Operation,
  OperationRegistry,
  type OpFn,
  type OpRuntime,
  type OpTraits,
  type ResonanceSync,
} from "./operation.js";

export {
  type AluResonance,
  type ConceptAnchor,
  NO_ALU_RESONANCE,
  prefetchOpposites,
  prefetchRecognisedOps,
  prefetchResonance,
} from "./resonance.js";

export {
  type ApplyScalar,
  ExprGrammar,
  freeVariables,
  type IsUnaryFn,
  type Token,
  tokenize,
} from "./expr.js";

export {
  type AluHost,
  type ComputedSpan,
  QueryParser,
  type Span,
  STRUCTURAL_HOST,
} from "./parser.js";

export { registerNd } from "./kernel-nd.js";
export { registerLogic } from "./kernel-logic.js";
export {
  addBits,
  compareBits,
  mulBits,
  negateBits,
  registerBits,
  signBits,
} from "./kernel-bits.js";
export {
  dot,
  linsolve,
  matMul,
  matVec,
  polyEval,
  registerArith,
} from "./kernel-arith.js";
export {
  converge,
  cosSeries,
  diff,
  expSeries,
  integrate,
  interpolate,
  logNewton,
  odeSolve,
  optimize,
  powerEig,
  registerNumeric,
  regress,
  sinSeries,
  solve,
  sqrtNewton,
  topSingular,
} from "./kernel-numeric.js";

export {
  Alu,
  type AluOptions,
  type OperandSpan,
  type OperatorSpan,
} from "./alu.js";
