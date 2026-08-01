/**
 * 002-create-archives
 *
 * The ledger: one row per WACZ that BrowserHive actually produced.
 *
 * Every column here is *location and provenance* — where the object is and
 * what produced it. There is deliberately no `org_id` or `owner_id`: who may
 * read an archive is a relationship, and relationships live in OpenFGA as
 * tuples. Putting an owner column here would create a second, competing
 * answer to the same question.
 *
 * `(bucket, object_key)` is unique because the same capture can be reported
 * more than once — the poller and the manifest reconciler can both arrive at
 * it, and either can be retried. The constraint is what makes those paths
 * safely idempotent rather than a source of duplicates.
 */
import type { Kysely } from "kysely";
import { sql } from "kysely";

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  await db.schema
    .createTable("archives")
    // #region archives-columns
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("task_id", "uuid", (col) => col.notNull())
    .addColumn("correlation_id", "text")
    .addColumn("bucket", "text", (col) => col.notNull())
    .addColumn("object_key", "text", (col) => col.notNull())
    .addColumn("source_url", "text", (col) => col.notNull())
    .addColumn("labels", sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    // CaptureResultReport.completeness.complete. `false` means the archive is
    // missing at least one body — either a URL only ever seen as a 304, or one
    // BrowserHive dropped for exceeding a size cap (v1.11.0 added the second
    // case; before it, capped captures reported `true`). Worth knowing before
    // handing the archive to waxlens. NULL when the capture predates the field
    // or did not record one.
    .addColumn("wacz_complete", "boolean")
    // BrowserHive's own timestamp for the capture, not waggle's receive time:
    // the reconciler may register a row hours later and must not reorder history.
    .addColumn("captured_at", "timestamptz", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    // #endregion archives-columns
    .execute();

  // The idempotency guarantee both write paths rely on.
  await db.schema
    .createIndex("archives_bucket_object_key_key")
    .on("archives")
    .columns(["bucket", "object_key"])
    .unique()
    .execute();

  // The reconciler asks "do I already know this task?" for every manifest it
  // finds, and the API lists newest-first.
  await db.schema.createIndex("archives_task_id_idx").on("archives").column("task_id").execute();
  await db.schema
    .createIndex("archives_captured_at_idx")
    .on("archives")
    .expression(sql`captured_at DESC`)
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable("archives").execute();
  // pgcrypto is left in place — 001 depends on it too.
};
