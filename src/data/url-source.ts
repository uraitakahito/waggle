/**
 * Postgres を裏に持つ URL の出どころ。
 *
 * `db/migrations/001-create-capture-targets.ts` が作った `capture_targets` テーブルから
 * 行を選ぶ。
 * よく通る道のクエリは `capture_targets_enabled_id_idx` の partial index が覆っている。
 *
 * `labels` は `TEXT[]` の列 —— pg はこれを `string[]` で返し、`DataEntry.labels` と
 * ちょうど一致する。変換は要らない。
 */
import type { Pool } from "pg";
import type { Kysely } from "kysely";
import type { Database } from "../db/database.js";

export interface DataEntry {
  labels: string[];
  url: string;
  /**
   * この取り込みがどの組織のために走るか。`capture_submissions` まで持ち回るので、
   * 後になって残っているのが「組織について何も知らない bucket の manifest」だけに
   * なっても、結果の帰属を言える。
   */
  orgId: string;
}

export interface UrlSourceQuery {
  limit?: number;
}

interface CaptureTargetRow {
  url: string;
  labels: string[];
  org_id: string;
}

export const loadUrls = async (pool: Pool, query: UrlSourceQuery): Promise<DataEntry[]> => {
  const sql =
    query.limit !== undefined
      ? "SELECT url, labels, org_id FROM capture_targets WHERE enabled ORDER BY id ASC LIMIT $1"
      : "SELECT url, labels, org_id FROM capture_targets WHERE enabled ORDER BY id ASC";
  const params = query.limit !== undefined ? [query.limit] : [];
  const result = await pool.query<CaptureTargetRow>(sql, params);
  return result.rows.map((row) => ({ url: row.url, labels: row.labels, orgId: row.org_id }));
};

/**
 * クロールの種として `capture_targets` を読む。
 *
 * ## なぜ `loadUrls` と別なのか
 *
 * 呼ぶ側が違う。あちらは CLI の経路で生の `pg.Pool` を持ち、こちらは API の経路で
 * Kysely を持つ。`run.ts` (と `loadUrls`) は畳んだあとに消えるので、二重に見えるのは
 * その間だけ。
 *
 * ## 組織で絞る
 *
 * `run.ts` は「他組織の対象が混じっていたら投げる」という仮の検査をしていた。
 * ここでは**絞り込みにしてある** —— クロールは `org_id` を 1 つ持つ行なので、
 * 別の組織の対象を混ぜると帰属が言えなくなる。テナントが増えたときに、
 * 「他人の対象まで取ってしまった」ではなく「自分のぶんだけ取った」になる形。
 *
 * 順は `id` 昇順。`capture_targets_enabled_id_idx` の partial index が覆う。
 */
export const loadTargets = async (
  db: Kysely<Database>,
  query: { orgId: string; limit?: number },
): Promise<{ url: string }[]> => {
  let q = db
    .selectFrom("captureTargets")
    .select("url")
    .where("enabled", "=", true)
    .where("orgId", "=", query.orgId)
    .orderBy("id", "asc");
  if (query.limit !== undefined) q = q.limit(query.limit);
  return q.execute();
};
