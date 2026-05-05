/**
 * 001-create-urls
 *
 * Creates the `urls` table that backs waggle's URL source.
 *
 * `url_hash` is a SHA-256 of `url`, computed by pgcrypto's `digest()`
 * and stored as a generated column so the unique index covers it
 * without application-side hashing. The raw 32-byte BYTEA backs the
 * unique index — callers should never need to read the hash directly.
 *
 * `urls_enabled_id_idx` is a partial index covering the loader's hot
 * path (`WHERE enabled ORDER BY id`). Indexing disabled rows would be
 * wasted space.
 */
import type { Kysely, SqlBool } from "kysely";
import { sql } from "kysely";

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  await db.schema
    .createTable("urls")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("url", "text", (col) => col.notNull().check(sql`url <> '' AND url = btrim(url)`))
    .addColumn("url_hash", sql`bytea`, (col) =>
      col.generatedAlwaysAs(sql`digest(url, 'sha256')`).stored(),
    )
    .addColumn("labels", sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn("enabled", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
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
  // pgcrypto is left in place — other objects may depend on it.
};
