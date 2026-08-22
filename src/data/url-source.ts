/**
 * Postgres を裏に持つ URL の出どころ。
 *
 * `db/migrations/0001_create_urls.sql` が作った `urls` テーブルから行を選ぶ。
 * よく通る道のクエリは `urls_enabled_id_idx` の partial index が覆っている。
 *
 * `labels` は `TEXT[]` の列 —— pg はこれを `string[]` で返し、`DataEntry.labels` と
 * ちょうど一致する。変換は要らない。
 */
import type { Pool } from "pg";

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

interface UrlRow {
  url: string;
  labels: string[];
  org_id: string;
}

export const loadUrls = async (pool: Pool, query: UrlSourceQuery): Promise<DataEntry[]> => {
  const sql =
    query.limit !== undefined
      ? "SELECT url, labels, org_id FROM urls WHERE enabled ORDER BY id ASC LIMIT $1"
      : "SELECT url, labels, org_id FROM urls WHERE enabled ORDER BY id ASC";
  const params = query.limit !== undefined ? [query.limit] : [];
  const result = await pool.query<UrlRow>(sql, params);
  return result.rows.map((row) => ({ url: row.url, labels: row.labels, orgId: row.org_id }));
};
