// alu — the ALU sub-library: a tiny irreducible kernel from which arithmetic,
// logic, and numerical computation are all DERIVED.
//
// Self-contained in the spirit of derive/ and rabitq-hnsw/: it imports only the
// pure byte helpers (../../bytes.js) and nothing else from SEMA.  The host
// reaches meaning (operator synonymy, the symbolic inverse) through the injected
// AluResonance, pre-resolved into a synchronous snapshot before the search runs.
// See ./../README.md for the kernel and its derivation DAG.
export { asBit, asInt, asReal, bit, coerce, decimalCodec, formatReal, int, isNd, isNumeric, joinDomain, nd, parseValue, real, symbol, symbolSpans, tagOf, } from "./value.js";
export { NO_RESONANCE, OperationRegistry, } from "./operation.js";
export { NO_ALU_RESONANCE, prefetchOpposites, prefetchRecognisedOps, prefetchResonance, } from "./resonance.js";
export { ExprGrammar, freeVariables, tokenize, } from "./expr.js";
export { QueryParser, STRUCTURAL_HOST, } from "./parser.js";
export { registerNd } from "./kernel-nd.js";
export { registerLogic } from "./kernel-logic.js";
export { addBits, compareBits, mulBits, negateBits, registerBits, signBits, } from "./kernel-bits.js";
export { dot, linsolve, matMul, matVec, polyEval, registerArith, } from "./kernel-arith.js";
export { converge, cosSeries, diff, expSeries, integrate, interpolate, logNewton, odeSolve, optimize, powerEig, registerNumeric, regress, sinSeries, solve, sqrtNewton, topSingular, } from "./kernel-numeric.js";
export { Alu, } from "./alu.js";
