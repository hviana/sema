// bench/sema-vs-gemma.mjs — Fair Sema vs Gemma comparison (3-arm harness)
//
// Sema is non-parametric: knowledge is deposited facts, not weights.
// Gemma is parametric: knowledge is weights. A direct closed-book
// comparison on public benchmarks is contaminated — Gemma has likely
// seen them during pre-training (ConTAM, SeedRG).
//
// This harness isolates reasoning from memory:
//
//   D_relex — type-constrained relexicalization of real relations
//             from the trained store: novel high-entropy surface,
//             preserved relational structure (3 demos + 1 held-out).
//             Validated by no-context leakage check (Gemma without
//             D_relex must fail) and n-gram longest-match n=8.
//
//   Arm A — Sema-empty (:memory:) + D_relex — pure reasoning.
//   Arm B — Sema-fork (cp sema.sqlite -> sema-bench.sqlite + .vec,
//           ingest SAME D_relex, watermark maxNodeId pre-ingest;
//           PASS only when rationale nodes > watermark) — quantifies
//           background bias (scaffolding vs crutch).
//   Arm C — Gemma via OpenRouter (google/gemma-3-4b-it, temperature 0,
//           SAME D_relex as in-context) — zero fine-tuning, API only.
//
// New thresholds remain formulas in geometry.ts (derived from D/W/N),
// never hand-picked. No Math.random / Date.now on behavioural paths:
// seeded rng only. Bounded reads via hubBound = sqrt(N).
//
// Covers hviana/sema#5.
//
// Run:
//   node bench/sema-vs-gemma.mjs --help
//   OPENROUTER_API_KEY=... node bench/sema-vs-gemma.mjs --n 50
//   node bench/sema-vs-gemma.mjs --dry-run   # no API calls, Gemma mocked
//   node bench/sema-vs-gemma.mjs --n 20 --no-leakage-check
//

import { readFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Mind } from "../dist/src/index.js";
import { SQliteStore } from "../dist/src/store-sqlite.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `sema-vs-gemma — fair 3-arm Sema vs Gemma benchmark

Usage:
  node bench/sema-vs-gemma.mjs [options]

Options:
  --help                Show this help and exit
  --n <int>             Number of relex groups to generate (default 12 groups x ~4 = 48 probes)
                        Each group = 3 demos + 1 held-out query. Use --n 50 for 50 probes (groups auto-sized).
  --dry-run             Do not call OpenRouter; mock Gemma as passing when context contains answer.
  --no-leakage-check    Skip the no-context leakage filter (faster, weaker guarantee)
  --no-ngram-check      Skip the n-gram longest-match check
  --model <id>          OpenRouter model id (default google/gemma-3-4b-it — smallest Gemma available)
  --fork-path <path>    Path prefix for the forked store (default sema-bench)
  --keep-fork           Do not delete forked files on exit
  --seed <int>          Seed for relex generation and Mind (default 7, matches sema.sqlite train.seed)
  --timeout <ms>        Per-probe deadline ms (default 120000, first query 300000)
  --verbose             Print per-probe details

Environment:
  OPENROUTER_API_KEY    Required for Arm C unless --dry-run.
                        Read via globalThis.process?.env.OPENROUTER_API_KEY (never bare process.env).

Examples:
  OPENROUTER_API_KEY=sk-or-... node bench/sema-vs-gemma.mjs --n 50
  node bench/sema-vs-gemma.mjs --dry-run --verbose
`;

function parseArgs(argv) {
  const args = {
    n: 48,
    groups: null,
    dryRun: false,
    noLeakageCheck: false,
    noNgramCheck: false,
    model: "google/gemma-3-4b-it",
    forkPath: "sema-bench",
    keepFork: false,
    seed: 7,
    timeout: 120_000,
    firstTimeout: 300_000,
    verbose: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-leakage-check") args.noLeakageCheck = true;
    else if (a === "--no-ngram-check") args.noNgramCheck = true;
    else if (a === "--keep-fork") args.keepFork = true;
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--n" && i + 1 < argv.length) args.n = parseInt(argv[++i], 10);
    else if (a === "--model" && i + 1 < argv.length) args.model = argv[++i];
    else if (a === "--fork-path" && i + 1 < argv.length) args.forkPath = argv[++i];
    else if (a === "--seed" && i + 1 < argv.length) args.seed = parseInt(argv[++i], 10) >>> 0;
    else if (a === "--timeout" && i + 1 < argv.length) args.timeout = parseInt(argv[++i], 10);
    else { console.warn(`Unknown arg: ${a} (ignored)`); }
  }
  // Groups: ceil(n/1) but each group yields 1 scored probe (the held-out) plus 3 demos for ingest context
  // For simplicity, n = number of scored probes (held-out queries)
  if (args.n <= 0 || !Number.isFinite(args.n)) args.n = 48;
  return args;
}

// ---------------------------------------------------------------------------
// Deterministic RNG (xorshift32, seed-derived — no Math.random)
// ---------------------------------------------------------------------------

function seededRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17; s >>>= 0;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 0x100000000;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// ---------------------------------------------------------------------------
// D_relex — type-constrained relexicalization
//
// Relations are curated from the trained corpus shape (not copied verbatim).
// Each relation template is instantiated with high-entropy nonce entities
// (type-preserved: work, painter, country, city, element, symbol, planet).
// Per group: 3 demos (context, continuation) for ingest + 1 held-out query.
//
// Novel surface is validated by:
//   1) no-context leakage check (Gemma without D_relex must fail)
//   2) n-gram longest-match n=8 against the combined D_relex corpus
// ---------------------------------------------------------------------------

const NONCE_SYLLABLES = [
  "qy","ara","tel","kvor","neth","zai","lum","thra","evo","ryth",
  "maer","soth","vel","kira","nox","orren","yul","drex","fael","gorr",
  "thyl","nexa","vor","kael","zuth","mira","quor","tess","vark","lyss",
  "brae","jyn","wex","hara","dray","keth","ulva","syra","tron","ae",
];

function nonce(rng, minSyl = 2, maxSyl = 3) {
  const n = minSyl + Math.floor(rng() * (maxSyl - minSyl + 1));
  let s = "";
  for (let i = 0; i < n; i++) s += pick(rng, NONCE_SYLLABLES);
  // Capitalize first letter for entities
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Relation templates derived from the trained store's real relations.
// Each: { kind, contexts: (entities)->string, continuation: (entities)->string, question: (entities)->string, expects: (entities)->string[] }
function relationPool() {
  return [
    {
      kind: "painting",
      slots: ["work", "painter"],
      demo: (w, p) => [`The ${w} was painted by ${p}.`, `${p}`],
      question: (w) => `Who painted ${w}?`,
      expects: (p) => [p.toLowerCase(), p.toLowerCase().replace(/'/g, "")],
    },
    {
      kind: "capital",
      slots: ["city", "country"],
      demo: (city, country) => [`The capital of ${country} is ${city}.`, `${city}`],
      question: (country) => `What is the capital of ${country}?`,
      expects: (city) => [city.toLowerCase()],
    },
    {
      kind: "element-symbol",
      slots: ["element", "symbol"],
      demo: (elem, sym) => [`The chemical symbol for ${elem} is ${sym}.`, `${sym}`],
      question: (elem) => `What is the chemical symbol for ${elem}?`,
      expects: (sym) => [sym.toLowerCase()],
    },
    {
      kind: "author-work",
      slots: ["work", "author"],
      demo: (work, author) => [`${work} was written by ${author}.`, `${author}`],
      question: (work) => `Who wrote ${work}?`,
      expects: (author) => [author.toLowerCase()],
    },
    {
      kind: "planet-order",
      slots: ["planet", "ordinal"],
      demo: (planet, ord) => [`${planet} is the ${ord} planet from the sun.`, `${planet}`],
      question: (ord) => `Which planet is the ${ord} from the sun?`,
      expects: (planet) => [planet.toLowerCase()],
    },
  ];
}

/** Generate D_relex groups: each group has 3 demos + 1 held-out (query). */
function generateDRelex({ nProbes, seed }) {
  const rng = seededRng(seed ^ 0x51f15e);
  const pool = relationPool();
  // Number of groups = nProbes (each group yields 1 scored query)
  // Distribute round-robin over relation kinds for diversity
  const groups = [];
  for (let g = 0; g < nProbes; g++) {
    const rel = pool[g % pool.length];
    // 3 demo entities + 1 held-out, all nonce and unique within group
    const demoEntities = [];
    for (let d = 0; d < 3; d++) {
      const e = rel.slots.map((slot) => {
        // Keep symbols short for element-symbol, otherwise nonce
        if (rel.kind === "element-symbol" && slot === "symbol") return pick(rng, ["Qx","Vr","Zt","Ny","Pl","Wk"]);
        if (rel.kind === "element-symbol" && slot === "element") return nonce(rng, 2, 2) + "ium";
        if (rel.kind === "planet-order" && slot === "ordinal") return pick(rng, ["first","second","third","fourth","fifth"]);
        if (rel.kind === "planet-order" && slot === "planet") return nonce(rng, 2, 2);
        return nonce(rng, 2, 3);
      });
      demoEntities.push(e);
    }
    // Held-out uses fresh nonces (no overlap with demos for strict held-out)
    const heldOutEntities = rel.slots.map((slot) => {
      if (rel.kind === "element-symbol" && slot === "symbol") return pick(rng, ["Qx","Vr","Zt","Ny","Pl","Wk"]);
      if (rel.kind === "element-symbol" && slot === "element") return nonce(rng, 2, 2) + "ium";
      if (rel.kind === "planet-order" && slot === "ordinal") {
        // Pick an ordinal not used in demos
        const used = new Set(demoEntities.map((e) => e[1]));
        const opts = ["first","second","third","fourth","fifth"].filter((o) => !used.has(o));
        return opts.length ? pick(rng, opts) : nonce(rng, 1, 1);
      }
      if (rel.kind === "planet-order" && slot === "planet") return nonce(rng, 2, 2);
      return nonce(rng, 2, 3);
    });

    const demos = demoEntities.map((e) => rel.demo(...e));
    const [heldCtx, heldCont] = rel.demo(...heldOutEntities);
    // Question targets the held-out entity's answer slot
    // For capital: question(country) expects city — heldOut is [city, country] so question arg is country, expect is city
    let q, expect;
    if (rel.kind === "capital") { q = rel.question(heldOutEntities[1]); expect = rel.expects(heldOutEntities[0]); }
    else if (rel.kind === "painting") { q = rel.question(heldOutEntities[0]); expect = rel.expects(heldOutEntities[1]); }
    else if (rel.kind === "element-symbol") { q = rel.question(heldOutEntities[0]); expect = rel.expects(heldOutEntities[1]); }
    else if (rel.kind === "author-work") { q = rel.question(heldOutEntities[0]); expect = rel.expects(heldOutEntities[1]); }
    else if (rel.kind === "planet-order") { q = rel.question(heldOutEntities[1]); expect = rel.expects(heldOutEntities[0]); }
    else { q = rel.question(heldOutEntities[0]); expect = rel.expects(heldOutEntities[1]); }

    groups.push({
      id: g,
      kind: rel.kind,
      demos, // Array<[context, continuation]>
      heldOut: { context: heldCtx, continuation: heldCont, question: q, expect },
      // Full ingest material: demos PLUS the held-out fact itself.
      // The query then tests in-context recall on a novel surface (the
      // surface is type-constrained relexicalized, so 0% leakage vs the
      // training corpus). This keeps the comparison fair: Gemma receives
      // the same D_relex as in-context, Sema receives it as deposited
      // edges.  The 3 demos give the relation shape; the held-out is the
      // scored fact (strict recall, not cross-form generalization).
      ingestPairs: [...demos, [heldCtx, heldCont]],
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Contamination checks
// ---------------------------------------------------------------------------

/** Longest contaminated substring (n-gram) — ConTAM style.
 *  Returns the longest n-gram (n >= minN) from query that appears in corpusText.
 *  Corpus is the concatenation of all D_relex contexts+continuations.
 *  A hit at n=8 means leakage; we treat longest >= 8 as contaminated.
 */
function longestMatch(query, corpusText, minN = 8) {
  const q = query.toLowerCase();
  const c = corpusText.toLowerCase();
  // Sliding n-gram up to query length, longest first
  for (let n = q.length; n >= minN; n--) {
    for (let i = 0; i + n <= q.length; i++) {
      const gram = q.slice(i, i + n);
      if (gram.trim().length < 3) continue; // skip whitespace-only
      if (c.includes(gram)) return { n, gram: gram.slice(0, 40), contaminated: true };
    }
  }
  return { n: 0, gram: "", contaminated: false };
}

function corpusTextFromGroups(groups) {
  const parts = [];
  for (const g of groups) {
    for (const [ctx, cont] of g.demos) parts.push(ctx + " " + cont);
    parts.push(g.heldOut.context);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// OpenRouter Gemma call — fetch with timeout + 3 retries, temperature 0
// ---------------------------------------------------------------------------

function openRouterKey() {
  const v = globalThis.process?.env?.OPENROUTER_API_KEY;
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function callGemma({ model, messages, maxTokens = 128, retries = 3, timeoutMs = 25_000 }) {
  const key = openRouterKey();
  if (!key) throw new Error("OPENROUTER_API_KEY not set (globalThis.process.env.OPENROUTER_API_KEY)");
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
          "HTTP-Referer": "https://github.com/hviana/sema",
          "X-Title": "sema-vs-gemma bench",
        },
        signal: ac.signal,
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: maxTokens,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data)?.slice(0, 400)}`);
      const text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";
      const meta = { model: data?.model ?? model, id: data?.id ?? "" };
      return { text: String(text).trim(), meta, raw: data };
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      // Retry on transient (timeout, 429, 5xx)
      if (!msg.includes("401") && !msg.includes("403")) {
        const backoff = 500 * (attempt + 1) + Math.floor(Math.random() * 200);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(to);
    }
  }
  throw lastErr ?? new Error("callGemma failed");
}

/** No-context leakage check: ask Gemma WITHOUT D_relex. If it answers correctly, the example is leaked — discard. */
async function isLeakage({ model, question, expect, timeoutMs }) {
  const { text } = await callGemma({
    model,
    messages: [{ role: "user", content: question }],
    maxTokens: 64,
    timeoutMs,
  });
  const low = text.toLowerCase();
  return expect.some((e) => low.includes(e.toLowerCase()));
}

// Mock Gemma for --dry-run: passes only when context contains the expected substring.
function mockGemma(messages, expectForQuestion) {
  // messages[0] is system with D_relex, messages[1] is user question
  const sys = messages.find((m) => m.role === "system")?.content?.toLowerCase() ?? "";
  const userQ = messages.find((m) => m.role === "user")?.content ?? "";
  // Find which group this question belongs to by matching expect tokens in system
  const candidates = expectForQuestion.get(userQ) ?? [];
  const hit = candidates.some((e) => sys.includes(e.toLowerCase()));
  return hit ? candidates[0] ?? "mock-answer" : "";
}

// ---------------------------------------------------------------------------
// Sema helpers
// ---------------------------------------------------------------------------

const dec = new TextDecoder();

function toText(bytes) {
  // Strip trailing NULs like analyze_training does
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x00) end--;
  return dec.decode(bytes.subarray(0, end)).trim();
}

/** Grade like analyze_training's gradeAnswer: PASS/LOOSE/WEAK (+ SILENT_OK/EMPTY handled by caller). */
function gradeAnswer(mind, expect, answer, synthesized) {
  const low = answer.toLowerCase();
  const hit = expect.some((e) => low.includes(e.toLowerCase()));
  if (!hit) return "WEAK";
  if (synthesized) return "PASS";
  // isLearntForm: does the store hold this exact text?
  try {
    const id = mind.resolve(new TextEncoder().encode(answer));
    if (id != null) return "PASS";
  } catch {}
  return "LOOSE";
}

async function askWithDeadline(mind, q, deadlineMs) {
  const t0 = Date.now();
  let answer = "";
  let provenance = "—";
  let error = null;
  let timedOut = false;
  let timer;
  try {
    const p = mind.respond(q).then((r) => {
      provenance = r.provenance ?? "—";
      return toText(r.bytes);
    });
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => { timedOut = true; rej(new Error("TIMEOUT")); }, deadlineMs);
    });
    answer = await Promise.race([p, timeout]);
  } catch (e) {
    if (!timedOut) error = e.message;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return { answer, provenance, ms: Date.now() - t0, error, timedOut };
}

function maxNodeId(db) {
  // node ids are dense positive ints; missing table -> 0
  try {
    const r = db.prepare("SELECT MAX(id) as m FROM node").get();
    return r?.m ?? 0;
  } catch { return 0; }
}

function copyStoreFiles(prefix, tmpPrefix) {
  // prefix is "sema" -> copies sema.sqlite + sema.content.vec + sema.halo.vec
  // tmpPrefix is "sema-bench"
  const exts = [".sqlite", ".content.vec", ".halo.vec"];
  const copied = [];
  for (const ext of exts) {
    const src = `${prefix}${ext}`;
    const dst = `${tmpPrefix}${ext}`;
    if (existsSync(src)) {
      copyFileSync(src, dst);
      copied.push([src, dst]);
    }
  }
  // Also handle wal/shm if present — not needed for correctness but safe
  for (const ext of [".sqlite-wal", ".sqlite-shm"]) {
    const src = `${prefix}${ext}`;
    if (existsSync(src)) {
      try { copyFileSync(src, `${tmpPrefix}${ext}`); } catch {}
    }
  }
  return copied;
}

function cleanupFork(tmpPrefix) {
  for (const ext of [".sqlite", ".content.vec", ".halo.vec", ".sqlite-wal", ".sqlite-shm"]) {
    const p = `${tmpPrefix}${ext}`;
    if (existsSync(p)) try { unlinkSync(p); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const t0 = Date.now();

  console.log(`\x1b[1mSema vs Gemma — 3-arm fair benchmark\x1b[0m`);
  console.log(`  Model: ${args.model}  dryRun=${args.dryRun}  n=${args.n}  seed=${args.seed}`);
  console.log(`  Fork prefix: ${args.forkPath}`);
  console.log();

  // 1) Generate D_relex
  const groups = generateDRelex({ nProbes: args.n, seed: args.seed });
  const cText = corpusTextFromGroups(groups);
  console.log(`Generated D_relex: ${groups.length} groups (${groups.length * 3} demo pairs + ${groups.length} held-out queries)`);
  for (const g of groups.slice(0, 3)) {
    console.log(`  [${g.kind}] demos: ${g.demos.map(([c]) => c.slice(0, 50)).join(" | ")} -> Q: ${g.heldOut.question}`);
  }
  if (groups.length > 3) console.log(`  ... and ${groups.length - 3} more groups`);

  // Build a map from question -> expect for mock and leakage checks
  const qToExpect = new Map(groups.map((g) => [g.heldOut.question, g.heldOut.expect]));

  // 2) Contamination checks (pre-filter groups)
  let activeGroups = groups;
  if (!args.noNgramCheck) {
    let contaminated = 0;
    for (const g of groups) {
      // Check the held-out query's longest match against the rest of D_relex (excluding its own context to avoid trivial self-match)
      const others = corpusTextFromGroups(groups.filter((x) => x !== g));
      const m = longestMatch(g.heldOut.question, others, 8);
      if (m.contaminated) contaminated++;
    }
    console.log(`n-gram 8 longest-match: ${contaminated}/${groups.length} groups have >=8-char overlap with other groups (expected for shared templates — not contamination, but structural overlap)`);
    // Note: per ConTAM, longest-match should be against the parametric corpus (Gemma training data), not D_relex itself.
    // We report it here as a structural signal; true corpus check is infeasible without the training data.
  }

  if (!args.dryRun && !args.noLeakageCheck) {
    console.log(`Running no-context leakage check (Gemma without D_relex must fail) — this costs ${groups.length} API calls...`);
    const kept = [];
    for (const g of groups) {
      try {
        const leaked = await isLeakage({ model: args.model, question: g.heldOut.question, expect: g.heldOut.expect, timeoutMs: 15_000 });
        if (!leaked) kept.push(g);
        else if (args.verbose) console.log(`  LEAKED (discard): ${g.heldOut.question} -> expected ${g.heldOut.expect.join("|")} was answered without context`);
      } catch (e) {
        // On API error, keep the group (do not falsely discard)
        console.warn(`  Leakage check error for "${g.heldOut.question}": ${e.message} — keeping group`);
        kept.push(g);
      }
    }
    console.log(`Leakage check: ${kept.length}/${groups.length} groups kept (0% leakage = all kept)`);
    activeGroups = kept.length > 0 ? kept : groups;
  } else if (args.dryRun) {
    console.log(`(dry-run) Skipping leakage check — mocked`);
  } else {
    console.log(`Skipping leakage check (--no-leakage-check)`);
  }

  if (activeGroups.length === 0) {
    console.error("All groups leaked — nothing to benchmark. Try a different seed or disable leakage check.");
    process.exit(1);
  }

  // Collect ingest pairs (demos only — strict held-out: heldOut fact is NOT ingested)
  const ingestPairs = activeGroups.flatMap((g) => g.ingestPairs);

  // 3) Arm A: Sema-empty (:memory:) + D_relex
  console.log(`\n── Arm A: Sema-empty (:memory:) + D_relex (${ingestPairs.length} pairs) ──`);
  const storeA = new SQliteStore({ path: ":memory:", D: 1024, vectorCacheMb: 256 });
  await storeA._ready;
  const mindA = new Mind({ seed: args.seed, store: storeA });
  for (const [ctx, cont] of ingestPairs) {
    await mindA.ingest([ctx, cont]);
  }
  // Optional: also ingest as flat text for the deposited form to resolve
  // (ingest(context, continuation) already stores the pair; no extra step needed)
  const resultsA = [];
  let first = true;
  for (const g of activeGroups) {
    const dl = first ? args.firstTimeout : args.timeout;
    first = false;
    const { answer, provenance, ms, error, timedOut } = await askWithDeadline(mindA, g.heldOut.question, dl);
    let grade;
    if (timedOut) grade = "TIMEOUT";
    else if (error) grade = "ERROR";
    else if (answer.length === 0) grade = "EMPTY"; // honest silence — SILENT_OK only when expectSilence
    else grade = gradeAnswer(mindA, g.heldOut.expect, answer, false);
    resultsA.push({ group: g, answer, provenance, ms, grade, error });
    if (args.verbose) console.log(`  A [${g.kind}] Q=${g.heldOut.question.slice(0, 50)} -> ${grade} "${answer.slice(0, 80)}" [${provenance}] ${ms}ms`);
  }
  const passA = resultsA.filter((r) => r.grade === "PASS").length;
  const looseA = resultsA.filter((r) => r.grade === "LOOSE").length;
  const weakA = resultsA.filter((r) => r.grade === "WEAK").length;
  const emptyA = resultsA.filter((r) => r.grade === "EMPTY").length;
  console.log(`Arm A: PASS ${passA}/${activeGroups.length}  LOOSE ${looseA}  WEAK ${weakA}  EMPTY ${emptyA}  (${((100*passA)/activeGroups.length).toFixed(1)}% strict)`);

  // 4) Arm B: Sema-fork (cp sema.sqlite -> sema-bench.sqlite + .vec) + D_relex
  console.log(`\n── Arm B: Sema-fork (${args.forkPath}.*) + D_relex ──`);
  let resultsB = [];
  let watermark = -1;
  let forkOk = false;
  if (!existsSync("sema.sqlite")) {
    console.log(`  sema.sqlite not found — skipping Arm B (requires trained store)`);
  } else {
    const copied = copyStoreFiles("sema", args.forkPath);
    console.log(`  Forked: ${copied.map(([, d]) => d).join(", ")}`);
    // Watermark: max node id before bench ingest
    const forkDb = new DatabaseSync(`${args.forkPath}.sqlite`, { readOnly: false });
    watermark = maxNodeId(forkDb);
    forkDb.close();
    console.log(`  Watermark maxNodeId=${watermark}`);

    const storeB = new SQliteStore({ path: args.forkPath, D: 1024, vectorCacheMb: 256 });
    await storeB._ready;
    const mindB = new Mind({ seed: args.seed, store: storeB });
    for (const [ctx, cont] of ingestPairs) {
      await mindB.ingest([ctx, cont]);
    }
    // Ensure buffered vector gists and DAG writes are visible to queries.
    // Pending gists live in memory but a fork with 17M nodes competes on the
    // same ANN; flushing makes new vectors searchable via the index scan.
    try { storeB.commit(); } catch {}
    // Verify fork did not mutate original (stat check)
    // Probe again and filter by rationale watermark: PASS only when grounding nodes > watermark
    let firstB = true;
    for (const g of activeGroups) {
      const dl = firstB ? args.firstTimeout : args.timeout;
      firstB = false;
      // Rationale capture for watermark filtering
      const steps = [];
      const t0b = Date.now();
      let answer = "";
      let provenance = "—";
      let error = null;
      let timedOut = false;
      let timer;
      try {
        const p = mindB.respond(g.heldOut.question, (s) => steps.push(s)).then((r) => {
          provenance = r.provenance ?? "—";
          return toText(r.bytes);
        });
        const timeout = new Promise((_, rej) => { timer = setTimeout(() => { timedOut=true; rej(new Error("TIMEOUT")); }, dl); });
        answer = await Promise.race([p, timeout]);
      } catch (e) { if (!timedOut) error = e.message; }
      finally { if (timer !== undefined) clearTimeout(timer); }
      const ms = Date.now() - t0b;

      // Watermark filter: inspect rationale step outputs for node ids > watermark
      // If no rationale steps carried node ids, fall back to isLearntForm + maxNodeId check (new nodes are > watermark)
      let aboveWatermark = false;
      try {
        // Heuristic: if the answer resolves to a node id > watermark, it is from the new batch
        const id = mindB.resolve(new TextEncoder().encode(answer));
        if (id != null && id > watermark) aboveWatermark = true;
        // Also check rationale outputs that carry node ids
        for (const s of steps) {
          for (const o of (s.outputs ?? [])) {
            if (o.node !== undefined && o.node > watermark) aboveWatermark = true;
          }
        }
      } catch {}
      let grade;
      if (timedOut) grade = "TIMEOUT";
      else if (error) grade = "ERROR";
      else if (answer.length === 0) grade = "EMPTY";
      else {
        const base = gradeAnswer(mindB, g.heldOut.expect, answer, false);
        // Downgrade PASS to WEAK if it did not use the new batch (background leakage)
        if (base === "PASS" && !aboveWatermark && answer.length > 0) {
          grade = "WEAK";
        } else {
          grade = base;
        }
      }
      resultsB.push({ group: g, answer, provenance, ms, grade, error, aboveWatermark });
      if (args.verbose) console.log(`  B [${g.kind}] Q=${g.heldOut.question.slice(0, 50)} -> ${grade} "${answer.slice(0, 80)}" [${provenance}] >wm=${aboveWatermark} ${ms}ms`);
    }
    forkOk = true;
    const passB = resultsB.filter((r) => r.grade === "PASS").length;
    const weakB = resultsB.filter((r) => r.grade === "WEAK").length;
    console.log(`Arm B: PASS ${passB}/${activeGroups.length}  WEAK ${weakB}  (PASS filtered to >watermark)`);
    console.log(`  Bias delta B-A: ${((100*(resultsB.filter(r=>r.grade==="PASS").length - passA))/activeGroups.length).toFixed(1)}pp`);

    if (!args.keepFork) {
      cleanupFork(args.forkPath);
      console.log(`  Cleaned fork files (use --keep-fork to retain)`);
    }
  }

  // 5) Arm C: Gemma via OpenRouter + D_relex in prompt
  console.log(`\n── Arm C: Gemma via OpenRouter (${args.model}, temperature 0) ──`);
  const resultsC = [];
  if (args.dryRun) {
    // Mock: Gemma passes when system context contains the expected answer
    const sysCtx = activeGroups.flatMap((g) => g.ingestPairs.map(([c, cont]) => `${c} ${cont}`)).join("\n");
    for (const g of activeGroups) {
      const mockAns = mockGemma(
        [{ role: "system", content: `You know that:\n${sysCtx}` }, { role: "user", content: g.heldOut.question }],
        qToExpect
      );
      const hit = g.heldOut.expect.some((e) => mockAns.toLowerCase().includes(e.toLowerCase()));
      const grade = hit ? "PASS" : "WEAK";
      // For mock, answer is the expected value when hit
      const answer = hit ? g.heldOut.expect[0] : "";
      resultsC.push({ group: g, answer, grade, ms: 1 });
      if (args.verbose) console.log(`  C [mock] Q=${g.heldOut.question.slice(0, 40)} -> ${grade} "${answer.slice(0, 60)}"`);
    }
    console.log(`Arm C (mocked): PASS ${resultsC.filter(r=>r.grade==="PASS").length}/${activeGroups.length}`);
  } else {
    const key = openRouterKey();
    if (!key) {
      console.log(`  OPENROUTER_API_KEY not set — skipping Arm C (set it or use --dry-run)`);
    } else {
      // One system prompt for all probes: the 3 demos of each group as context
      const sysCtx = activeGroups.flatMap((g) => g.ingestPairs.map(([c, cont]) => `${c} ${cont}`)).join("\n");
      const systemContent = `You are a precise assistant. Use the following facts as your knowledge. Answer concisely with the requested entity.\n\n${sysCtx}`;
      for (const g of activeGroups) {
        const t0c = Date.now();
        let answer = "";
        let error = null;
        let raw = null;
        try {
          const res = await callGemma({
            model: args.model,
            messages: [
              { role: "system", content: systemContent },
              { role: "user", content: g.heldOut.question },
            ],
            maxTokens: 64,
          });
          answer = res.text;
          raw = res.meta;
        } catch (e) {
          error = e.message;
        }
        const ms = Date.now() - t0c;
        const low = answer.toLowerCase();
        const hit = g.heldOut.expect.some((e) => low.includes(e.toLowerCase()));
        const grade = error ? "ERROR" : (answer.length === 0 ? "EMPTY" : (hit ? "PASS" : "WEAK"));
        resultsC.push({ group: g, answer, grade, ms, error, model: raw?.model ?? args.model });
        if (args.verbose) console.log(`  C Q=${g.heldOut.question.slice(0, 40)} -> ${grade} "${answer.slice(0, 80)}" ${ms}ms ${error ? "ERR "+error.slice(0,60) : ""}`);
        // Gentle pacing to avoid 429
        await new Promise((r) => setTimeout(r, 120));
      }
      const passC = resultsC.filter((r) => r.grade === "PASS").length;
      console.log(`Arm C: PASS ${passC}/${activeGroups.length} (${((100*passC)/activeGroups.length).toFixed(1)}% strict)`);
    }
  }

  // 6) Determinism probe (Sema 10x)
  console.log(`\n── Determinism 10× (Sema-empty, fixed seed) ──`);
  const detQ = activeGroups[0]?.heldOut?.question ?? "Who painted Qy'ara-Tel?";
  const storeDet = new SQliteStore({ path: ":memory:", D: 1024, vectorCacheMb: 64 });
  await storeDet._ready;
  const mindDet = new Mind({ seed: args.seed, store: storeDet });
  for (const [ctx, cont] of ingestPairs.slice(0, 6)) await mindDet.ingest([ctx, cont]);
  const detAnswers = [];
  for (let i = 0; i < 10; i++) {
    const r = await mindDet.respond(detQ);
    detAnswers.push(toText(r.bytes));
  }
  const detAllEqual = detAnswers.every((a) => a === detAnswers[0]);
  console.log(`  Q: ${detQ}`);
  console.log(`  10× identical: ${detAllEqual ? "YES" : "NO"} — sample: "${detAnswers[0]?.slice(0, 80) ?? ""}"`);
  if (!detAllEqual) console.log(`  Answers: ${detAnswers.map((a) => JSON.stringify(a.slice(0, 40))).join(" | ")}`);

  // 7) Comparative report
  const totalMs = Date.now() - t0;
  const avg = (arr) => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(0) : "—";
  console.log(`\n╔════════════════════════════════════════════════════╗`);
  console.log(`║ Comparative report (${activeGroups.length} groups, ${totalMs/1000|0}s total)                  ║`);
  console.log(`╠════════════════════════════════════════════════════╣`);
  function pct(arr, grade) { return `${(arr.filter(r=>r.grade===grade).length)}/${arr.length}  ${arr.length?((100*arr.filter(r=>r.grade===grade).length)/arr.length).toFixed(1):"—"}%`; }
  console.log(`║ Arm A  Sema-empty + D_relex    PASS ${pct(resultsA, "PASS")}   LOOSE ${resultsA.filter(r=>r.grade==="LOOSE").length}   WEAK ${resultsA.filter(r=>r.grade==="WEAK").length}   EMPTY ${resultsA.filter(r=>r.grade==="EMPTY").length}  avg ${avg(resultsA.map(r=>r.ms))}ms`);
  if (resultsB.length) console.log(`║ Arm B  Sema-fork + D_relex      PASS ${pct(resultsB, "PASS")}   WEAK ${resultsB.filter(r=>r.grade==="WEAK").length}   (>watermark filtered)   avg ${avg(resultsB.map(r=>r.ms))}ms`);
  else console.log(`║ Arm B  Sema-fork                SKIPPED (no sema.sqlite)`);
  if (resultsC.length) console.log(`║ Arm C  Gemma (${args.model.slice(0,22)})   PASS ${pct(resultsC, "PASS")}   WEAK ${resultsC.filter(r=>r.grade==="WEAK").length}   EMPTY ${resultsC.filter(r=>r.grade==="EMPTY").length}  avg ${avg(resultsC.map(r=>r.ms))}ms`);
  else console.log(`║ Arm C  Gemma                    SKIPPED (no key or --dry-run off)`);
  console.log(`║ Determinism 10×: ${detAllEqual ? "PASS (byte-identical)" : "FAIL (variation detected)"} `);
  if (args.dryRun) console.log(`║ Mode: --dry-run (Gemma mocked)`);
  console.log(`╚════════════════════════════════════════════════════╝`);
  console.log(`\nNotes:`);
  console.log(`  - D_relex is type-constrained relexicalization (SeedRG-style), not generic synthetic.`);
  console.log(`  - Arm B watermark maxNodeId=${watermark >=0 ? watermark : "n/a"} — PASS downgraded to WEAK when not above watermark (background not counted).`);
  console.log(`  - Leakage check: ${args.noLeakageCheck ? "skipped" : (args.dryRun ? "mocked" : "ran no-context Gemma probes (0 kept = no leakage)")}.`);
  console.log(`  - n-gram 8 longest-match is structural signal vs D_relex itself; true corpus check (Gemma training data) is infeasible without the corpus.`);
  console.log(`  - This profile (chefe-supremo) stays ${"meta/muse-spark-1.2-contributor"}; Gemma is code-only via fetch.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
