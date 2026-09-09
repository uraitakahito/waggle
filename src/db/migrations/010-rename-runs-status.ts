/**
 * 010-rename-runs-status
 *
 * `runs.status` を `runs.state` に改める。**同じものに 2 つ名前があった。**
 *
 * ## 何がずれていたか
 *
 * `006` と `007` は同じ形の表を作る —— `finished_at` も `error` も同名で、
 * 「走行中は高々 1 本」の部分 unique index も同じ形。それでいて、状態の列だけ
 * 名前が違っていた:
 *
 *   crawls_single_active_idx  … WHERE state  = 'running'
 *   runs_single_active_idx    … WHERE status = 'running'
 *
 * 型に至っては文字通り同一だった:
 *
 *   export type RunStatus  = "running" | "succeeded" | "failed";
 *   export type CrawlState = "running" | "succeeded" | "failed";
 *
 * ## 規則: 進行中の値を持つなら `state`
 *
 * BrowserHive は `CaptureState` (進行) と `CaptureStatus` (結末) を意図して分けて
 * いる。waggle は**両方の語を借りたが、区別は借りていない** —— どの列も進行と結末を
 * 1 つに畳んでいる。だから区別を輸入するのではなく、1 語に決める。
 *
 *   crawls.state        running / succeeded / failed          進行中あり → state ✓
 *   crawl_pages.state   pending / captured / failed / skipped 進行中あり → state ✓
 *   PageReport.status   captured / failed / skipped           進行中なし → status ✓
 *   runs.status         running / succeeded / failed          進行中あり → **違反**
 *
 * 線の上の `PageReport.status` はこの規則に合っている。書き込む先の
 * `crawl_pages.state` と名前が違うのは、**値集合が違うから**であってずれではない。
 *
 * ## index の述語は追随する
 *
 * PostgreSQL の `RENAME COLUMN` は、依存するオブジェクト —— 部分 index の述語を
 * 含む —— を一緒に書き換える。だから index を作り直す必要は無い (実測で確認)。
 *
 * **名前は `runs_single_active_idx` のまま**にすること。`isUniqueViolation` が
 * 制約名を文字列で照合しているので、index を改名すると 409 が出なくなる。
 */
import type { Kysely } from "kysely";
import { sql } from "kysely";

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`ALTER TABLE runs RENAME COLUMN status TO state`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`ALTER TABLE runs RENAME COLUMN state TO status`.execute(db);
};
