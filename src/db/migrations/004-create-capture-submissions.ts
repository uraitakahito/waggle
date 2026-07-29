/**
 * 004-create-capture-submissions
 *
 * Remembers, at submit time, which organization a capture was run for.
 *
 * ## Why this table has to exist
 *
 * The ledger is filled from two directions. The poller knows the organization
 * because it just submitted the job. The manifest reconciler does not: it
 * reads `.result.json` out of the bucket, and BrowserHive has no concept of an
 * organization, so nothing in that document says who the capture was for.
 *
 * The alternative — encoding the organization inside `correlationId` and
 * parsing it back out — was rejected. A convention held only by agreement gets
 * broken by the first caller that submits a capture by hand; a table does not.
 *
 * Written before the request is sent, so a capture that BrowserHive accepts
 * can always be attributed even if waggle dies immediately after.
 *
 * ## `urls.org_id`
 *
 * Which organization a URL is captured for is an input to the capture, not a
 * property of the artifact, so it belongs next to the URL. Existing rows get
 * `default` — there is no organization directory yet, and the identifier is
 * just a string that has to agree with the `organization:<id>` tuples.
 */
import type { Kysely } from "kysely";
import { sql } from "kysely";

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .alterTable("urls")
    .addColumn("org_id", "text", (col) => col.notNull().defaultTo("default"))
    .execute();

  await db.schema
    .createTable("capture_submissions")
    // #region capture-submissions-columns
    // BrowserHive's task id is the join key back to a result report.
    .addColumn("task_id", "uuid", (col) => col.primaryKey())
    .addColumn("correlation_id", "text")
    .addColumn("org_id", "text", (col) => col.notNull())
    // The user who asked for it, when there was one. NULL for scheduled runs
    // that belong to the organization rather than a person.
    .addColumn("submitted_by", "text")
    .addColumn("source_url", "text", (col) => col.notNull())
    .addColumn("submitted_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    // #endregion capture-submissions-columns
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable("capture_submissions").execute();
  await db.schema.alterTable("urls").dropColumn("org_id").execute();
};
