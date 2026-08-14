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

import { getJson, type HttpOptions } from "./http.js";
import { readdirSync } from "node:fs";

/** Files under `path` in a Hugging Face dataset repo's main branch, filtered to
 *  an extension. Returns repo-relative paths (e.g. "smolsent/ha_en.jsonl"),
 *  sorted, so a run's unit order is stable across machines. */
export async function hfTree(
  dataset: string,
  path: string,
  ext: RegExp,
  label: string,
  opts: HttpOptions,
): Promise<string[]> {
  // The dataset id is a PATH here, so its "/" must not be percent-encoded.
  // `recursive=true` returns every file under `path`.
  const url = `https://huggingface.co/api/datasets/${dataset}` +
    `/tree/main/${path}?recursive=true`;
  const body = await getJson(url, label, opts);
  const paths: string[] = Array.isArray(body)
    ? body
      .filter((e: any) => e?.type === "file" && ext.test(e?.path))
      .map((e: any) => String(e.path))
    : [];
  paths.sort();
  return paths;
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
): Promise<string[]> {
  const body = await getJson(
    `https://huggingface.co/api/datasets/${dataset}` +
      `/tree/refs%2Fconvert%2Fparquet/${config}?recursive=true`,
    `GET ${label} tree`,
    opts,
  );
  const paths: string[] = Array.isArray(body)
    ? body
      .filter((e: any) => e?.type === "file" && /\.parquet$/i.test(e?.path))
      .map((e: any) => String(e.path))
    : [];
  paths.sort();
  const want = new Set(splits);
  return paths.filter((p) => {
    const parts = p.split("/");
    // The tree is rooted at `config`, so the split is the second-to-last part.
    return want.has(parts[parts.length - 2] ?? "");
  });
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
): Promise<string[]> {
  const body = await getJson(
    `https://api.github.com/repos/${repo}/contents/${dir}`,
    label,
    opts,
  );
  const names: string[] = Array.isArray(body)
    ? body
      .filter((e: any) => e?.type === "file" && ext.test(e?.name))
      .map((e: any) => String(e.name))
    : [];
  names.sort();
  return names;
}

/** Every file in a local directory matching `ext`, sorted. A missing directory
 *  is an empty list, not an error: LOCAL_PATH is an offline convenience and a
 *  stage with no local copy simply reports that and moves on. */
export function localFiles(dir: string, ext: RegExp): string[] {
  try {
    return readdirSync(dir).filter((f: string) => ext.test(f)).sort();
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
