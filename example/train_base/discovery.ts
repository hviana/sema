// train_base/discovery.ts — where a stage's WORK-LIST comes from.
//
// Four remote strategies and two local ones, each generic over the dataset it
// is pointed at. What stays with a corpus is its POLICY — which subset of the
// listing to keep, how to name the resume unit — because that is a curriculum
// decision, not a protocol one.
//
// A note that has bitten this code twice, in both directions: a dataset id
// ("owner/name") is a PATH here and its "/" must NOT be percent-encoded, while
// a branch name ("refs/convert/parquet") is a single path SEGMENT and its "/"
// MUST be.

import { getJson, getJsonPaged, type HttpOptions } from "./http.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** A note a listing needs to make about ITSELF — an accepted-but-unexpected
 *  split name, say. Distinct from a failure: the run continues, but silently
 *  continuing would hide why fewer units appeared than expected. */
export type Note = (msg: string) => void;

/** One listed file: where it is, and how big it is.
 *
 *  The SIZE is carried because the panel is otherwise dishonest. Corpus
 *  progress used to be measured against a total that GREW as each file was
 *  opened, so the bar ran to 100% at the end of every file and then fell back
 *  when the next one was added — 100%, 50%, 100%, 66%… Both listing APIs
 *  already return the size, so the denominator can simply be known before the
 *  first byte is read. */
export interface Listed {
  path: string;
  /** Bytes, or 0 when the source did not say. */
  size: number;
}

const sizeOf = (e: any): number => {
  const n = Number(e?.size ?? e?.lfs?.size ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Files under `path` in a Hugging Face dataset repo's main branch, filtered to
 *  an extension. Returns repo-relative paths (e.g. "smolsent/ha_en.jsonl"),
 *  sorted, so a run's unit order is stable across machines. */
export async function hfTree(
  dataset: string,
  path: string,
  ext: RegExp,
  label: string,
  opts: HttpOptions,
): Promise<Listed[]> {
  // The dataset id is a PATH here, so its "/" must not be percent-encoded.
  // `recursive=true` returns every file under `path`, 1,000 at a time — hence
  // the PAGED fetch: a truncated work-list would train part of a corpus and
  // then call it finished.
  const url = `https://huggingface.co/api/datasets/${dataset}` +
    `/tree/main/${path}?recursive=true`;
  const body = await getJsonPaged(url, label, opts);
  const out: Listed[] = body
    .filter((e: any) => e?.type === "file" && ext.test(e?.path))
    .map((e: any) => ({ path: String(e.path), size: sizeOf(e) }));
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** A dataset's Parquet shards on Hugging Face's auto-converted
 *  `refs/convert/parquet` branch, restricted to `config` and to `splits`.
 *
 *  The converted branch is used rather than `main` because a dataset's own
 *  Parquet may be written as ONE giant row-group (SODA's is 1,191,582 rows),
 *  and a column chunk is per-group, so reading any part of it materialises all
 *  of it. The converted branch is uniformly 10,000-row groups.
 *
 *  Paths look like "<config>/<split>/0000.parquet". The BRANCH name is a single
 *  path SEGMENT here, so its "/" is percent-encoded — unlike a dataset id,
 *  whose "/" must not be. */
export async function hfConvertedParquet(
  dataset: string,
  config: string,
  splits: string[],
  label: string,
  opts: HttpOptions,
  note?: Note,
): Promise<Listed[]> {
  const body = await getJsonPaged(
    `https://huggingface.co/api/datasets/${dataset}` +
      `/tree/refs%2Fconvert%2Fparquet/${config}?recursive=true`,
    `GET ${label} tree`,
    opts,
  );
  const paths: Listed[] = body
    .filter((e: any) => e?.type === "file" && /\.parquet$/i.test(e?.path))
    .map((e: any) => ({ path: String(e.path), size: sizeOf(e) }));
  paths.sort((a, b) => a.path.localeCompare(b.path));

  // The tree is rooted at `config`, so the split is the second-to-last part.
  const splitOf = (p: string) => p.split("/").slice(-2)[0] ?? "";
  const present = new Set(paths.map((p) => splitOf(p.path)));

  // MATCH THE SPLIT AGAINST WHAT THE BRANCH ACTUALLY CARRIES. An exact name is
  // not guaranteed: the converter renames a split it could not finish, and
  // shards a very large one. Observed on real datasets today —
  //   allenai/c4            → partial-train, partial-validation
  //   HuggingFaceFW/fineweb → train-part0
  // — neither of which equals "train". The old exact-match filter returned []
  // for both, and an empty work-list is reported as "no files found — skipping",
  // which reads like a normal outcome rather than a corpus being dropped whole.
  const wanted = new Set<string>();
  for (const want of splits) {
    const pick = present.has(want)
      ? want
      : [...present].find((s) => s === `partial-${want}`) ??
        [...present].find((s) => s.startsWith(`${want}-part`));
    if (!pick) {
      // Loud, not empty: a requested split that simply is not there is a
      // configuration error, and silence would hide the whole corpus.
      throw new Error(
        `${label}: split "${want}" is not on the converted branch — it ` +
          `carries ${[...present].join(", ") || "no parquet at all"}`,
      );
    }
    if (pick !== want) {
      note?.(
        `${label}: split "${want}" is published as "${pick}"` +
          (pick.startsWith("partial-")
            ? " — Hugging Face has only PARTIALLY converted this dataset, so " +
              "the shards below are not the whole split"
            : ""),
      );
    }
    wanted.add(pick);
  }
  return paths.filter((p) => wanted.has(splitOf(p.path)));
}

/** File NAMES (not paths) in one directory of a GitHub repo, filtered to an
 *  extension and sorted. Used for corpora served from GitHub raw rather than
 *  Hugging Face — where the HF mirrors are loading-script repos with no data
 *  files, the official GitHub copy is the one carrying the licence notice. */
export async function githubContents(
  repo: string,
  dir: string,
  ext: RegExp,
  label: string,
  opts: HttpOptions,
): Promise<Listed[]> {
  const body = await getJson(
    `https://api.github.com/repos/${repo}/contents/${dir}`,
    label,
    opts,
  );
  const entries: unknown[] = Array.isArray(body) ? body : [];
  // The contents API returns at most 1,000 entries for a directory and does NOT
  // paginate them — it simply stops, with no Link header and no error. A
  // directory at that boundary is therefore indistinguishable from a truncated
  // one, so the only honest response is to refuse rather than train part of it
  // and record the part as the whole.
  if (entries.length >= 1000) {
    throw new Error(
      `${label}: GitHub returned ${entries.length} entries, the point at ` +
        `which the contents API truncates without saying so — this listing ` +
        `cannot be trusted to be complete`,
    );
  }
  const names: Listed[] = entries
    .filter((e: any) => e?.type === "file" && ext.test(e?.name))
    .map((e: any) => ({ path: String(e.name), size: sizeOf(e) }));
  names.sort((a, b) => a.path.localeCompare(b.path));
  return names;
}

/** Every file in a local directory matching `ext`, sorted. A missing directory
 *  is an empty list, not an error: LOCAL_PATH is an offline convenience and a
 *  stage with no local copy simply reports that and moves on. */
export function localFiles(dir: string, ext: RegExp): Listed[] {
  try {
    return readdirSync(dir)
      .filter((f: string) => ext.test(f))
      .sort()
      .map((f: string) => {
        let size = 0;
        try {
          size = statSync(join(dir, f)).size;
        } catch { /* unreadable — the read will report it */ }
        return { path: f, size };
      });
  } catch {
    return []; // no such directory
  }
}

/** The FIRST file in a local directory matching any of `exts`, in directory
 *  order (deliberately NOT sorted — this mirrors the single-file stages, which
 *  take whichever copy the filesystem hands back first). Null when none match
 *  or the directory is absent. */
export function localFind(dir: string, ...exts: RegExp[]): string | null {
  try {
    return readdirSync(dir).find((f: string) =>
      exts.some((re) => re.test(f))
    ) ?? null;
  } catch {
    return null; // no such directory
  }
}
