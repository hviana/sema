// train_base/corpora/converted-parquet.ts — the work-list shape three corpora
// share.
//
// Read from Hugging Face's auto-converted `refs/convert/parquet` branch, not
// from main: a dataset's own Parquet may be written as ONE giant row-group
// (SODA's is 1,191,582 rows) and a column chunk is per-group, so any read of it
// materialises the whole file. The converted branch uses uniform 10,000-row
// groups.

import { LOCAL_PATH } from "../config.js";
import { hfConvertedParquet, localFiles } from "../discovery.js";
import { localDir, type Unit } from "../stage.js";
import type { TrainCtx } from "../runtime.js";
import { DIM, R } from "../ui.js";
import { join } from "node:path";

/** The work-list of a corpus read from Hugging Face's auto-converted
 *  `refs/convert/parquet` branch. Shared by 2Wiki, SODA and MASSIVE: they
 *  differ in their dataset, their budget and their adapter — nothing else. */
export function convertedParquetUnits(opts: {
  id: string;
  label: string;
  dataset: string;
  config: string;
  splits: string[];
  /** Subdirectory of LOCAL_PATH holding pre-downloaded shards. */
  localSub: string;
}): (ctx: TrainCtx) => Promise<Unit[] | null> {
  return async (ctx: TrainCtx) => {
    if (LOCAL_PATH) {
      const dir = localDir(opts.localSub);
      const names = localFiles(dir, /\.parquet$/i);
      if (names.length === 0) {
        ctx.progress.log(
          `  ${DIM}· no ${opts.label} *.parquet in ${dir} — skipping${R}`,
        );
        return null;
      }
      return names.map((n) => ({
        key: n,
        name: n,
        display: `${opts.label} ${n}`,
        local: join(dir, n),
      }));
    }
    const paths = await hfConvertedParquet(
      opts.dataset,
      opts.config,
      opts.splits,
      opts.label,
      ctx.http,
    );
    return paths.map((path) => ({
      key: path,
      name: path,
      display: `${opts.label} ${path}`,
      url: `https://huggingface.co/datasets/${opts.dataset}` +
        `/resolve/refs%2Fconvert%2Fparquet/${path}`,
    }));
  };
}
