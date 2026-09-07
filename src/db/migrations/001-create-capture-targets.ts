/**
 * 001-create-capture-targets
 *
 * waggle が撮る対象の一覧、`capture_targets` テーブルを作る。1 行が「有効な
 * あいだ、周回のたびに 1 件ずつ取り込みを投げる対象」で、`capture_submissions`
 * が投げた 1 回、`archives` が返ってきた結果を持つ。
 *
 * かつて `urls` という名前だった。中身の**型**(URL)は言うが**役割**(撮る対象・
 * 繰り返し・止められる)を何も言っていなかったので改名した。改名は ALTER では
 * なく履歴の書き換えで行っており、**ファイル名も変えてある** —— そうすると
 * 古い DB では kysely が corrupted migrations で止まる。中身だけ変えると
 * migration は成功してしまい、実行時まで壊れに気づけない。
 *
 * `url_hash` は `url` の SHA-256 で、pgcrypto の `digest()` が計算し、生成列として
 * 保存する。こうすると、アプリケーション側でハッシュを取らなくても unique index が
 * それを覆える。unique index が使うのは生の 32 バイト BYTEA —— 呼ぶ側がハッシュを
 * 直接読む必要は無いはず。
 *
 * `capture_targets_enabled_id_idx` は、読み込み側がよく通る道 (`WHERE enabled ORDER BY id`) を
 * 覆う partial index。無効な行まで index に入れても場所の無駄になる。
 */
import type { Kysely, SqlBool } from "kysely";
import { sql } from "kysely";

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  await db.schema
    .createTable("capture_targets")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    // #region capture-targets-columns
    .addColumn("url", "text", (col) => col.notNull().check(sql`url <> '' AND url = btrim(url)`))
    .addColumn("url_hash", sql`bytea`, (col) =>
      col.generatedAlwaysAs(sql`digest(url, 'sha256')`).stored(),
    )
    .addColumn("labels", sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn("enabled", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    // #endregion capture-targets-columns
    .execute();

  await db.schema
    .createIndex("capture_targets_url_hash_key")
    .on("capture_targets")
    .column("url_hash")
    .unique()
    .execute();

  await db.schema
    .createIndex("capture_targets_enabled_id_idx")
    .on("capture_targets")
    .column("id")
    .where(sql<SqlBool>`enabled`)
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable("capture_targets").execute();
  // pgcrypto はそのまま残す —— 他のオブジェクトが依存しているかもしれない。
};
