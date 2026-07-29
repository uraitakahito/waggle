/**
 * 003-create-fga-outbox
 *
 * The transactional outbox that keeps the ledger and OpenFGA from drifting.
 *
 * Inserting an `archives` row and writing the matching relationship tuples are
 * two different systems: the tuple write goes over OpenFGA's HTTP API, which no
 * Postgres transaction can span. Doing both directly means one can succeed
 * while the other fails, and the two failure modes are both bad — an archive
 * nobody can reach, or a permission that outlives the thing it pointed at.
 *
 * So the tuple write is recorded here, in the same transaction as the archive
 * row. Either both land or neither does. A worker then drains this table with
 * at-least-once delivery; duplicate tuple writes are idempotent on OpenFGA's
 * side, so retrying is safe.
 *
 * `payload` is a whole OpenFGA write request (`{ writes: [...] }`) rather than
 * one tuple per row, so a set of tuples that belongs together is delivered
 * together.
 */
import type { Kysely, SqlBool } from "kysely";
import { sql } from "kysely";

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable("fga_outbox")
    // #region fga-outbox-columns
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("payload", "jsonb", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    // NULL until delivered. The worker never deletes rows: a processed row is
    // the evidence that a tuple was written, which is worth keeping when
    // reconciling a ledger against OpenFGA.
    .addColumn("processed_at", "timestamptz")
    .addColumn("attempts", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("last_error", "text")
    // #endregion fga-outbox-columns
    .execute();

  // The worker's hot path is "oldest unprocessed first". A partial index keeps
  // delivered rows out of it, so the index stays the size of the backlog rather
  // than the size of history — the same reasoning as `urls_enabled_id_idx`.
  await db.schema
    .createIndex("fga_outbox_pending_idx")
    .on("fga_outbox")
    .column("id")
    .where(sql<SqlBool>`processed_at IS NULL`)
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable("fga_outbox").execute();
};
