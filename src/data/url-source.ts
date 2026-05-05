/**
 * URL source backed by Postgres.
 *
 * Selects rows from the `urls` table created by
 * `db/migrations/0001_create_urls.sql`. The hot-path query is covered
 * by the `urls_enabled_id_idx` partial index.
 *
 * `labels` is a `TEXT[]` column — pg returns it as `string[]`, which
 * matches `DataEntry.labels` exactly. No coercion needed.
 */
import type { Pool } from "pg";

export interface DataEntry {
  labels: string[];
  url: string;
}

export interface UrlSourceQuery {
  limit?: number;
}

interface UrlRow {
  url: string;
  labels: string[];
}

export const loadUrls = async (pool: Pool, query: UrlSourceQuery): Promise<DataEntry[]> => {
  const sql =
    query.limit !== undefined
      ? "SELECT url, labels FROM urls WHERE enabled ORDER BY id ASC LIMIT $1"
      : "SELECT url, labels FROM urls WHERE enabled ORDER BY id ASC";
  const params = query.limit !== undefined ? [query.limit] : [];
  const result = await pool.query<UrlRow>(sql, params);
  return result.rows.map((row) => ({ url: row.url, labels: row.labels }));
};
