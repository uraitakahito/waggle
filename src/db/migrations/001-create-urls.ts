/**
 * 001-create-urls
 *
 * waggle の URL の出どころになる `urls` テーブルを作る。
 *
 * `url_hash` は `url` の SHA-256 で、pgcrypto の `digest()` が計算し、生成列として
 * 保存する。こうすると、アプリケーション側でハッシュを取らなくても unique index が
 * それを覆える。unique index が使うのは生の 32 バイト BYTEA —— 呼ぶ側がハッシュを
 * 直接読む必要は無いはず。
 *
 * `urls_enabled_id_idx` は、読み込み側がよく通る道 (`WHERE enabled ORDER BY id`) を
 * 覆う partial index。無効な行まで index に入れても場所の無駄になる。
 */
import type { Kysely, SqlBool } from "kysely";
import { sql } from "kysely";

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  await db.schema
    .createTable("urls")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    // #region urls-columns
    .addColumn("url", "text", (col) => col.notNull().check(sql`url <> '' AND url = btrim(url)`))
    .addColumn("url_hash", sql`bytea`, (col) =>
      col.generatedAlwaysAs(sql`digest(url, 'sha256')`).stored(),
    )
    .addColumn("labels", sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn("enabled", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    // #endregion urls-columns
    .execute();

  await db.schema.createIndex("urls_url_hash_key").on("urls").column("url_hash").unique().execute();

  await db.schema
    .createIndex("urls_enabled_id_idx")
    .on("urls")
    .column("id")
    .where(sql<SqlBool>`enabled`)
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable("urls").execute();
  // pgcrypto はそのまま残す —— 他のオブジェクトが依存しているかもしれない。
};
